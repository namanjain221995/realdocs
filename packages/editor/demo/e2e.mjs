// Real-browser check of the editor package.
//
// Needs the fixture server (4421) and the built harness (4420):
//   pnpm --filter @realtimedocs/editor run demo:server
//   pnpm --filter @realtimedocs/editor run demo:build
//   pnpm --filter @realtimedocs/editor run demo:preview
// then, from the repository root:
//   docker run --rm --name rd-ed-e2e --network host --user 1000:1000 -e HOME=/tmp \
//     -e BROWSER=chromium -v "$PWD":/work -w /work \
//     mcr.microsoft.com/playwright:v1.64.1-noble node packages/editor/demo/e2e.mjs
//
// BROWSER=chromium|firefox|webkit, ONLY=name,name to run a subset.
// Prints PASS/FAIL per check, writes screenshots to demo/screenshots/ and a
// summary to demo/screenshots/results-<browser>.jsonl (one JSON object per line). Exits non-zero on failure.
/* global document, window, getComputedStyle, DOMParser, CSS, ClipboardEvent, DataTransfer, DragEvent --
   browser globals, used only inside the functions Playwright serializes and runs in the page. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium, firefox, webkit } from '@playwright/test';
import { GOOGLE_DOCS_HTML, MALICIOUS_CORPUS, WORD_HTML } from '../test/fixtures/clipboard.ts';

const BROWSER = process.env.BROWSER ?? 'chromium';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const BASE = process.env.DEMO_URL ?? 'http://127.0.0.1:4420';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });

const launcher = { chromium, firefox, webkit }[BROWSER];
if (!launcher) throw new Error(`unknown browser ${BROWSER}`);
const browser = await launcher.launch();

const results = [];
const notes = {};
let sceneCounter = 0;

/** Thrown by a check that cannot be carried out in this browser build (reported, not counted as a pass). */
class NotVerifiable extends Error {}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

async function check(name, run, options = {}) {
  if (ONLY && !ONLY.has(name)) return;
  if (options.browsers && !options.browsers.includes(BROWSER)) {
    results.push({ name, status: 'skipped', detail: `only on ${options.browsers.join(', ')}` });
    console.log(`SKIP ${name} (only on ${options.browsers.join(', ')})`);
    return;
  }
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ name, status: 'pass', detail: detail ?? '', ms: Date.now() - started });
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    if (error instanceof NotVerifiable) {
      results.push({ name, status: 'skipped', detail: error.message });
      console.log(`SKIP ${name} (${error.message})`);
      return;
    }
    results.push({ name, status: 'fail', detail: String(error?.message ?? error) });
    console.log(`FAIL ${name}: ${error?.stack ?? error}`);
  }
}

// ── PNG fixtures ────────────────────────────────────────────────────────────

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour PNG as base64. */
function png(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

const RED = png(120, 80, [220, 40, 40]);
const BLUE = png(100, 60, [40, 90, 220]);
const GREEN = png(90, 90, [40, 170, 90]);
const WIDE = png(300, 120, [150, 90, 220]);

// ── Page helpers ────────────────────────────────────────────────────────────

const paneSel = (name) => `[data-pane="${name}"]`;
const contentSel = (name) => `${paneSel(name)} [data-testid="rd-editor-content"]`;
const pane = (page, name) => page.locator(paneSel(name));
const content = (page, name) => page.locator(contentSel(name));
const status = (page, name) => page.evaluate((n) => window.__rd.status(n), name);
const json = (page, name) => page.evaluate((n) => window.__rd.json(n), name);
const control = (page, command) => page.evaluate((c) => window.__rd.control(c), command);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${BROWSER}-${name}.png`) });

async function waitLive(page, name) {
  await page.waitForSelector(
    `${paneSel(name)} [data-testid="rd-status-connection"][data-state="live"]`,
    { timeout: 20000 },
  );
  await page.waitForFunction((n) => window.__rd.status(n)?.ready === true, name);
}

async function waitSaved(page, name) {
  await page.waitForFunction(
    (n) => {
      const current = window.__rd.status(n);
      return current && current.save === 'saved' && current.pendingChanges === 0;
    },
    name,
    { timeout: 15000 },
  );
}

async function open(options = {}) {
  const {
    kind = 'sample',
    panes = 'editor,viewer',
    viewport = { width: 1280, height: 860 },
    query = '',
    contextOptions = {},
    init,
    pagePath = '/',
  } = options;
  const scene = `${BROWSER}-${Date.now()}-${++sceneCounter}`;
  const context = await browser.newContext({ viewport, ...contextOptions });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const problems = [];
  const external = [];
  const requests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('dialog', (dialog) => {
    problems.push(`dialog: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    requests.push(url);
    if (new URL(url).origin !== new URL(BASE).origin) external.push(url);
  });
  await page.goto(`${BASE}${pagePath}?scene=${scene}&kind=${kind}&panes=${panes}${query}`);
  await page.waitForSelector('[data-testid="demo-ready"]', { timeout: 20000 });
  if (!query.includes('static=1')) {
    for (const name of panes.split(',')) await waitLive(page, name);
  }
  const mod = (await page.evaluate(() => /Mac|iP(hone|[oa]d)/.test(navigator.platform)))
    ? 'Meta'
    : 'Control';
  return { context, page, scene, problems, external, requests, mod, close: () => context.close() };
}

/** Flat list of text per top-level block, and node types, of a pane's document. */
function blocks(doc) {
  const text = (node) =>
    node.text !== undefined ? node.text : (node.content ?? []).map(text).join('');
  return (doc?.content ?? []).map((node) => ({
    type: node.type,
    text: text(node),
    attrs: node.attrs ?? {},
  }));
}

function findNodes(doc, type) {
  const found = [];
  const walk = (node) => {
    if (node.type === type) found.push(node);
    for (const child of node.content ?? []) walk(child);
  };
  if (doc) walk(doc);
  return found;
}

/** Tiptap focuses in the next animation frame: wait until the keys will land there. */
async function focusAt(page, name, where) {
  await page.evaluate(
    ({ selector, position }) => {
      document.querySelector(selector).editor.commands.focus(position);
    },
    { selector: contentSel(name), position: where },
  );
  await page.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    contentSel(name),
  );
}

/** Puts the cursor at the end of the last node of `type` and waits for the focus. */
async function focusEndOfNode(page, name, type) {
  await page.evaluate(
    ({ selector, nodeType }) => {
      const editor = document.querySelector(selector).editor;
      let end = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === nodeType) end = pos + node.nodeSize - 1;
      });
      editor.commands.focus(end);
    },
    { selector: contentSel(name), nodeType: type },
  );
  await page.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    contentSel(name),
  );
}

/** The toolbar hands the focus back to the document in the next frame: wait for it before typing. */
const editorFocused = (page, name) =>
  page.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    contentSel(name),
  );

const focusEnd = (page, name) => focusAt(page, name, 'end');
const focusStart = (page, name) => focusAt(page, name, 'start');

/** CSP reports raised while the sanitizer parses hostile markup (see docs/notes/editor.md). */
const onlyInlineHandlerReports = (violations) =>
  violations.every((entry) => entry.startsWith('script-src-attr blocked inline'));

/**
 * Pastes through a synthetic clipboard event when the browser lets a script
 * attach data to one; otherwise through ProseMirror's paste entry points
 * (same pipeline, no DOM event). Returns which path was used.
 */
async function paste(page, name, payload) {
  const data = { selector: contentSel(name), html: null, text: null, files: [], ...payload };
  const mode = await page.evaluate(({ selector, html, text, files }) => {
    const target = document.querySelector(selector);
    const toFile = (file) =>
      new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, {
        type: file.type,
      });
    try {
      const transfer = new DataTransfer();
      if (html !== null) transfer.setData('text/html', html);
      if (text !== null) transfer.setData('text/plain', text);
      for (const file of files) transfer.items.add(toFile(file));
      const event = new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      });
      const carried =
        event.clipboardData &&
        ((html !== null && event.clipboardData.getData('text/html') === html) ||
          (html === null && text !== null && event.clipboardData.getData('text/plain') === text) ||
          (html === null && text === null && event.clipboardData.files.length === files.length));
      if (carried) {
        target.dispatchEvent(event);
        return 'clipboard-event';
      }
    } catch {
      // Fall through to the editor entry points.
    }
    const editor = target.editor;
    if (files.length > 0 && html === null) editor.commands.insertFiles(files.map(toFile));
    else if (html !== null) editor.view.pasteHTML(html);
    else editor.view.pasteText(text ?? '');
    return 'editor-api';
  }, data);
  notes.pasteMode = mode;
  return mode;
}

async function imagesLoaded(page, selector, count) {
  await page.waitForFunction(
    ({ selector: s, count: n }) => {
      const images = [...document.querySelectorAll(s)];
      return (
        images.length === n && images.every((image) => image.complete && image.naturalWidth > 0)
      );
    },
    { selector, count },
    { timeout: 20000 },
  );
}

const clean = (session) => {
  assertEqual(session.problems, [], 'console errors / dialogs');
};

/**
 * Like `clean`, for checks that feed hostile markup to the page: Chromium logs
 * a console error for every inline event handler the policy blocks while the
 * sanitizer parses the payload. Those (and only those) are expected.
 */
const cleanExceptBlockedHandlers = (session) => {
  assertEqual(
    session.problems.filter(
      (problem) => !/inline event handler|Content Security Policy/i.test(problem),
    ),
    [],
    'console errors / dialogs',
  );
};

/** Waits until ProseMirror has picked up the DOM selection of exactly `text`. */
const waitSelection = (page, name, text) =>
  page.waitForFunction(
    ({ selector, expected }) => {
      const { state } = document.querySelector(selector).editor;
      return state.doc.textBetween(state.selection.from, state.selection.to) === expected;
    },
    { selector: contentSel(name), expected: text },
  );

/**
 * Diagrams whose own configuration tries to add CSS that loads from another
 * origin (4421 is not the page's origin), HTML labels or a looser security
 * level; the last one tries the same through a node style.
 */
const DIAGRAM_CONFIG_PROBES = [
  '%%{init: {"themeCSS": "@import url(http://127.0.0.1:4421/rd-leak-probe.css); svg { background: url(http://127.0.0.1:4421/rd-leak-probe.png); } .node rect { fill: #123456; }", "fontFamily": "x; } svg { background: url(http://127.0.0.1:4421/rd-leak-probe-2.png)", "securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%\nflowchart LR\n  P[Probe one] --> Q[Target]',
  '---\nconfig:\n  themeCSS: "@import url(http://127.0.0.1:4421/rd-leak-probe-4.css); .node rect { fill: #123456; }"\n  securityLevel: loose\n  htmlLabels: true\n---\nflowchart LR\n  R[Probe two] --> S[Target]',
  'flowchart LR\n  T[Probe three] --> U[Target]\n  style T fill:#f9f,background:url(http://127.0.0.1:4421/rd-leak-probe-3.png)',
];

/**
 * Appends the probe diagrams to the document, waits until every diagram shows
 * an image or an error, and asserts that none of the configuration got
 * through. Whether a request left the page is checked by the caller.
 */
async function insertConfigProbeDiagrams(page, name) {
  const existing = await page.evaluate((selector) => {
    let count = 0;
    document.querySelector(selector).editor.state.doc.descendants((node) => {
      if (node.type.name === 'diagram') count += 1;
    });
    return count;
  }, contentSel(name));
  for (const source of DIAGRAM_CONFIG_PROBES) {
    await page.evaluate(
      ({ selector, text }) => {
        const editor = document.querySelector(selector).editor;
        editor.commands.insertContentAt(editor.state.doc.content.size, {
          type: 'diagram',
          content: [{ type: 'text', text }],
        });
      },
      { selector: contentSel(name), text: source },
    );
  }
  const expected = existing + DIAGRAM_CONFIG_PROBES.length;
  await page.waitForFunction(
    ({ s, count }) => {
      const diagrams = [...document.querySelectorAll(`${s} .rd-diagram`)];
      return (
        diagrams.length === count &&
        diagrams.every(
          (diagram) =>
            diagram.querySelector('.rd-diagram__image')?.complete ||
            diagram.querySelector('[data-testid="rd-diagram-error"]'),
        )
      );
    },
    { s: contentSel(name), count: expected },
    { timeout: 30000 },
  );
  await page.waitForTimeout(500);
  const probed = await page.evaluate(
    ({ s, skip }) =>
      [...document.querySelectorAll(`${s} .rd-diagram`)].slice(skip).map((diagram) => {
        const image = diagram.querySelector('.rd-diagram__image');
        const svg = image ? decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)) : '';
        return {
          rendered: Boolean(image),
          directiveCss: svg.includes('#123456'),
          remoteUrl: svg.includes('rd-leak-probe'),
          foreignObject: /<foreignObject/i.test(svg),
        };
      }),
    { s: contentSel(name), skip: existing },
  );
  assertEqual(
    [probed[0].rendered, probed[1].rendered],
    [true, true],
    'diagrams with a configuration block still render',
  );
  for (const [index, entry] of probed.entries()) {
    assertEqual(
      [entry.directiveCss, entry.remoteUrl, entry.foreignObject],
      [false, false, false],
      `probe diagram ${index + 1} cannot add CSS, remote URLs or HTML labels`,
    );
  }
  return probed;
}

// ── Checks ──────────────────────────────────────────────────────────────────

await check('load', async () => {
  const session = await open();
  const { page } = session;
  await waitSaved(page, 'editor');
  const editor = await status(page, 'editor');
  const viewer = await status(page, 'viewer');
  assertEqual(
    [editor.connection, editor.save, editor.canEdit],
    ['live', 'saved', true],
    'editor status',
  );
  assertEqual(
    [viewer.connection, viewer.save, viewer.canEdit],
    ['live', 'read_only', false],
    'viewer status',
  );
  assertEqual(
    await pane(page, 'editor').locator('[data-testid="rd-toolbar"]').count(),
    1,
    'editor toolbar',
  );
  assertEqual(
    await pane(page, 'viewer').locator('[data-testid="rd-toolbar"]').count(),
    0,
    'viewer toolbar',
  );
  assertEqual(
    await content(page, 'editor').getAttribute('contenteditable'),
    'true',
    'editor editable',
  );
  assertEqual(
    await content(page, 'viewer').getAttribute('contenteditable'),
    'false',
    'viewer editable',
  );
  assertEqual(
    await pane(page, 'editor').locator('[data-testid="rd-status-save"]').getAttribute('data-state'),
    'saved',
    'save indicator',
  );
  assertEqual(editor.participants.length, 2, 'participants');
  await page.waitForTimeout(1500);
  assertEqual(await page.evaluate(() => window.__rd.violations), [], 'CSP violations');
  assertEqual(session.external, [], 'requests to other origins');
  clean(session);
  await shot(page, 'load-1280');
  await session.close();
  return 'both panes live; no CSP violation; no foreign request';
});

await check('typing-formatting', async () => {
  const session = await open({ kind: 'empty' });
  const { page, mod } = session;
  const tool = (id) => pane(page, 'editor').locator(`[data-testid="${id}"]`);
  await content(page, 'editor').click();
  await page.keyboard.type('Quarterly review');
  await tool('rd-tool-block').selectOption('heading1');
  await content(page, 'editor').press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain then ');
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type('bold');
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type(' and ');
  await tool('rd-tool-italic').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type('italic');
  await tool('rd-tool-italic').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type(' and ');
  await tool('rd-tool-underline').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type('underlined');
  await tool('rd-tool-underline').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type(' text.');
  await page.keyboard.press('Enter');
  await tool('rd-tool-bullets').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type('First item');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second item');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Indented paragraph');
  await page.keyboard.press('Tab');
  await tool('rd-tool-align-center').click();
  await editorFocused(page, 'editor');
  await page.keyboard.press('Enter');
  await tool('rd-tool-size').selectOption('24px');
  await content(page, 'editor').focus();
  await page.keyboard.type('Large');

  const viewer = content(page, 'viewer');
  await viewer.locator('h1', { hasText: 'Quarterly review' }).waitFor();
  await viewer.locator('strong', { hasText: 'bold' }).waitFor();
  await viewer.locator('em', { hasText: 'italic' }).waitFor();
  await viewer.locator('u', { hasText: 'underlined' }).waitFor();
  await viewer.locator('ul li', { hasText: 'Second item' }).waitFor();
  await viewer.locator('p[data-indent="1"]', { hasText: 'Indented paragraph' }).waitFor();
  await viewer.locator('span[style*="font-size: 24px"]', { hasText: 'Large' }).waitFor();
  assertEqual(
    await viewer
      .locator('p[data-indent="1"]')
      .first()
      .evaluate((element) => getComputedStyle(element).textAlign),
    'center',
    'alignment in viewer',
  );

  // Highlight and a link through the toolbar popovers.
  await content(page, 'editor').locator('strong', { hasText: 'bold' }).dblclick();
  await waitSelection(page, 'editor', 'bold');
  await pane(page, 'editor').getByRole('button', { name: 'Highlight' }).click();
  await page.getByRole('button', { name: 'Yellow' }).click();
  await viewer.locator('mark', { hasText: 'bold' }).waitFor();
  await content(page, 'editor').locator('em', { hasText: 'italic' }).dblclick();
  await waitSelection(page, 'editor', 'italic');
  await page.keyboard.press(`${mod}+k`);
  const linkInput = page.locator('[data-testid="rd-link-input"]');
  await linkInput.fill('javascript:alert(1)');
  await page.locator('[data-testid="rd-link-apply"]').click();
  await page.getByText('Enter a web address').waitFor();
  assertEqual(await viewer.locator('a').count(), 0, 'unsafe link rejected');
  await linkInput.fill('example.com/plan');
  await page.locator('[data-testid="rd-link-apply"]').click();
  await viewer.locator('a[href="https://example.com/plan"]', { hasText: 'italic' }).waitFor();

  await waitSaved(page, 'editor');
  // A viewer cannot type.
  const before = JSON.stringify(await json(page, 'viewer'));
  await viewer.locator('h1').click();
  await page.keyboard.type('zzz');
  await page.waitForTimeout(300);
  assertEqual(JSON.stringify(await json(page, 'viewer')), before, 'viewer document unchanged');
  assertEqual(
    JSON.stringify(await json(page, 'editor')),
    before,
    'editor document unchanged by viewer',
  );
  clean(session);
  await shot(page, 'typing-formatting');
  await session.close();
  return 'heading, bold, italic, underline, list, indent, alignment, size, highlight, link reached the viewer';
});

await check('more-formatting', async () => {
  const session = await open({ kind: 'empty' });
  const { page, mod } = session;
  const editorPane = pane(page, 'editor');
  const tool = (id) => editorPane.locator(`[data-testid="${id}"]`);
  const button = (name) => editorPane.getByRole('button', { name, exact: true });
  const viewer = content(page, 'viewer');
  await content(page, 'editor').click();
  await page.keyboard.type('struck and coloured');
  await page.keyboard.press(`${mod}+a`);
  await tool('rd-tool-strike').click();
  await viewer.locator('s', { hasText: 'struck and coloured' }).waitFor();
  await button('Text colour').click();
  await page.getByRole('button', { name: 'Red', exact: true }).click();
  // (The reader also sees the editor's selection, itself a coloured span.)
  await viewer
    .locator('span[style*="color"]:not(.rd-caret-selection)', { hasText: 'struck and coloured' })
    .first()
    .waitFor();
  await tool('rd-tool-spacing').click();
  await page.getByRole('menuitemcheckbox', { name: 'Double' }).click();
  await viewer.locator('p[data-line-height="2"]').waitFor();
  const spacing = await viewer
    .locator('p[data-line-height="2"]')
    .evaluate(
      (element) =>
        Number.parseFloat(getComputedStyle(element).lineHeight) /
        Number.parseFloat(getComputedStyle(element).fontSize),
    );
  assert(Math.abs(spacing - 2) < 0.05, `line spacing applied in the viewer (${spacing})`);

  // Lists, a checklist that is ticked, a quote and a separator.
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await button('Numbered list').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type('one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await viewer.locator('ol li', { hasText: 'two' }).waitFor();
  await button('Checklist').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type('ship it');
  await viewer
    .locator('ul[data-type="taskList"] li[data-checked="false"]', { hasText: 'ship it' })
    .waitFor();
  await content(page, 'editor').locator('ul[data-type="taskList"] input[type="checkbox"]').click();
  await viewer
    .locator('ul[data-type="taskList"] li[data-checked="true"]', { hasText: 'ship it' })
    .waitFor();
  // A reader cannot tick the box.
  const box = viewer.locator('ul[data-type="taskList"] input[type="checkbox"]');
  await box.click({ force: true }).catch(() => {});
  await page.waitForTimeout(250);
  assertEqual(
    await viewer.locator('ul[data-type="taskList"] li[data-checked="true"]').count(),
    1,
    'checkbox unchanged by a reader',
  );
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await button('Quote').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type('quoted words');
  await viewer.locator('blockquote', { hasText: 'quoted words' }).waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await button('Separator').click();
  await editorFocused(page, 'editor');
  await viewer.locator('hr').waitFor();

  // Indent and outdent through the toolbar and the keyboard.
  await page.keyboard.type('indented twice');
  await tool('rd-tool-indent').click();
  await editorFocused(page, 'editor');
  await page.keyboard.press('Tab');
  await viewer.locator('p[data-indent="2"]', { hasText: 'indented twice' }).waitFor();
  await tool('rd-tool-outdent').click();
  await editorFocused(page, 'editor');
  await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(
    (s) =>
      [...document.querySelectorAll(`${s} p`)].some(
        // (The paragraph also holds the other person's caret label.)
        (p) => p.textContent.includes('indented twice') && !p.hasAttribute('data-indent'),
      ),
    contentSel('viewer'),
  );
  // Tab kept the focus in the document.
  assertEqual(
    await page.evaluate(
      (selector) => document.activeElement === document.querySelector(selector),
      contentSel('editor'),
    ),
    true,
    'Tab does not leave the document',
  );

  // Blocks from the toolbar: code and a diagram.
  await page.keyboard.press('Enter');
  await tool('rd-tool-codeblock').click();
  await editorFocused(page, 'editor');
  await page.keyboard.type('let x = 1;');
  await viewer.locator('.rd-code pre', { hasText: 'let x = 1;' }).waitFor();
  await tool('rd-tool-diagram').click();
  await imagesLoaded(page, `${contentSel('viewer')} .rd-diagram__image`, 1);

  // Undo and redo buttons.
  const before = JSON.stringify(await json(page, 'editor'));
  await tool('rd-tool-undo').click();
  await page.waitForFunction(
    (n) => !JSON.stringify(window.__rd.json(n)).includes('"type":"diagram"'),
    'viewer',
  );
  await tool('rd-tool-redo').click();
  await page.waitForFunction(
    (n) => JSON.stringify(window.__rd.json(n)).includes('"type":"diagram"'),
    'viewer',
  );
  assertEqual(JSON.stringify(await json(page, 'editor')), before, 'redo restores the document');
  await waitSaved(page, 'editor');
  clean(session);
  await content(page, 'editor').evaluate((element) =>
    element.closest('.rd-editor__scroll').scrollTo(0, 0),
  );
  await shot(page, 'more-formatting');
  await session.close();
  return 'strike, text colour, line spacing, numbered list, checklist (ticked by the editor, not by the reader), quote, separator, indent/outdent, code block, diagram, undo/redo reached the viewer';
});

await check('image-tools', async () => {
  const session = await open({ kind: 'empty' });
  const { page } = session;
  const viewer = content(page, 'viewer');
  await content(page, 'editor').click();
  await page.keyboard.type('Picture');
  await pane(page, 'editor')
    .locator('[data-testid="rd-image-input"]')
    .setInputFiles([
      { name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(WIDE, 'base64') },
    ]);
  await imagesLoaded(page, `${contentSel('viewer')} .rd-image__img`, 1);
  await imagesLoaded(page, `${contentSel('editor')} .rd-image__img`, 1);
  const figure = content(page, 'editor').locator('.rd-image');
  const attrs = async () => findNodes(await json(page, 'viewer'), 'image')[0].attrs;
  assertEqual(
    [(await attrs()).naturalWidth, (await attrs()).naturalHeight],
    [300, 120],
    'natural size stored',
  );

  await figure.locator('.rd-image__img').click();
  const tools = figure.locator('.rd-node-tools');
  await tools.waitFor();
  await tools.getByRole('button', { name: 'Align left' }).click();
  await page.waitForSelector(`${contentSel('viewer')} .rd-image[data-align="left"]`);
  await tools.getByRole('button', { name: 'Align right' }).click();
  await page.waitForSelector(`${contentSel('viewer')} .rd-image[data-align="right"]`);
  const edges = await page.evaluate((s) => {
    const image = document.querySelector(`${s} .rd-image__frame`).getBoundingClientRect();
    const column = document.querySelector(s).getBoundingClientRect();
    return Math.round(column.right - image.right);
  }, contentSel('viewer'));
  assert(Math.abs(edges) <= 2, `right-aligned image sits at the right edge (${edges}px away)`);
  await tools.getByRole('button', { name: 'Align centre' }).click();
  await page.waitForSelector(`${contentSel('viewer')} .rd-image[data-align="center"]`);

  // Resize with the buttons, then by dragging a handle; the ratio never changes.
  await tools.getByRole('button', { name: 'Larger' }).click();
  await page.waitForFunction(
    (n) => /"width":\d+/.test(JSON.stringify(window.__rd.json(n))),
    'viewer',
  );
  const widthAfterButton = (await attrs()).width;
  const handle = figure.locator('.rd-image__handle--end');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 15, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(
    ({ n, previous }) => {
      const match = /"width":(\d+)/.exec(JSON.stringify(window.__rd.json(n)));
      return match && Number(match[1]) !== previous;
    },
    { n: 'viewer', previous: widthAfterButton },
  );
  const widthAfterDrag = (await attrs()).width;
  assert(
    widthAfterDrag > widthAfterButton,
    `dragging outwards enlarges (${widthAfterButton}% → ${widthAfterDrag}%)`,
  );
  for (const name of ['editor', 'viewer']) {
    const ratio = await page.evaluate((s) => {
      const image = document.querySelector(`${s} .rd-image__img`).getBoundingClientRect();
      return image.width / image.height;
    }, contentSel(name));
    assert(
      Math.abs(ratio - 300 / 120) < 0.03,
      `${name}: aspect ratio preserved (${ratio.toFixed(3)})`,
    );
  }
  const overflow = await page.evaluate((s) => {
    const image = document.querySelector(`${s} .rd-image__img`).getBoundingClientRect();
    const column = document.querySelector(s).getBoundingClientRect();
    return image.right - column.right;
  }, contentSel('viewer'));
  assert(overflow <= 1, 'image stays inside the column');

  // Alt text and caption.
  await tools.getByRole('button', { name: 'Alt text' }).click();
  await page.getByLabel('Alt text', { exact: true }).last().fill('A violet rectangle');
  await page.getByRole('button', { name: 'Save' }).click();
  await viewer.locator('img.rd-image__img[alt="A violet rectangle"]').waitFor();
  await figure.locator('.rd-image__img').click();
  await tools.getByRole('button', { name: 'Caption' }).click();
  await page.getByLabel('Caption', { exact: true }).last().fill('Figure 1: test picture');
  await page.getByRole('button', { name: 'Save' }).click();
  await viewer.locator('figcaption', { hasText: 'Figure 1: test picture' }).waitFor();
  await waitSaved(page, 'editor');
  await figure.locator('.rd-image__img').click();
  await tools.waitFor();
  await shot(page, 'image-tools');
  // A reader gets no tools.
  await viewer.locator('.rd-image__img').click();
  await page.waitForTimeout(200);
  assertEqual(await viewer.locator('.rd-node-tools').count(), 0, 'no image tools for a reader');
  // Remove.
  await figure.locator('.rd-image__img').click();
  await tools.getByRole('button', { name: 'Remove image' }).click();
  await page.waitForFunction(
    (n) => !JSON.stringify(window.__rd.json(n)).includes('"type":"image"'),
    'viewer',
  );
  await waitSaved(page, 'editor');
  clean(session);
  await session.close();
  return `file picker upload; alignment left/right/centre; resized ${widthAfterButton}% → ${widthAfterDrag}% with the ratio kept; alt text and caption reached the viewer; removed`;
});

await check('table', async () => {
  const session = await open({ kind: 'empty' });
  const { page } = session;
  const menu = async (item) => {
    await pane(page, 'editor').locator('[data-testid="rd-tool-table"]').click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await content(page, 'editor').click();
  await menu('Insert table');
  for (const value of ['Phase', 'Owner', 'Status', 'Pilot', 'Asha', 'Done']) {
    await page.keyboard.type(value);
    await page.keyboard.press('Tab');
  }
  const viewer = content(page, 'viewer');
  await viewer.locator('td', { hasText: 'Done' }).waitFor();
  assertEqual(
    [await viewer.locator('th').count(), await viewer.locator('td').count()],
    [3, 6],
    'cells',
  );
  await menu('Insert row below');
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} td`).length === 9,
    contentSel('viewer'),
  );
  await menu('Insert column right');
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} th`).length === 4,
    contentSel('viewer'),
  );
  await menu('Delete row');
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} tr`).length === 3,
    contentSel('viewer'),
  );
  await menu('Delete column');
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} th`).length === 3,
    contentSel('viewer'),
  );

  // Column resizing by dragging a cell border.
  const first = content(page, 'editor').locator('th').first();
  const box = await first.boundingBox();
  const edge = box.x + box.width - 1;
  const middle = box.y + box.height / 2;
  await page.mouse.move(edge, middle);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(edge - 80, middle, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (n) => JSON.stringify(window.__rd.json(n)).includes('"colwidth":['),
    'viewer',
    { timeout: 5000 },
  );
  const widths = await page.evaluate((s) => {
    const cells = [...document.querySelectorAll(`${s} th`)];
    return cells.map((cell) => Math.round(cell.getBoundingClientRect().width));
  }, contentSel('viewer'));
  assert(widths[0] < widths[1], `first column narrower after resize (${widths.join(', ')})`);
  await waitSaved(page, 'editor');
  clean(session);
  await shot(page, 'table');
  await session.close();
  return `insert/delete rows and columns; resized column widths in viewer ${widths.join('/')}`;
});

await check('code-block', async () => {
  const session = await open({
    contextOptions:
      BROWSER === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {},
  });
  const { page } = session;
  for (const name of ['editor', 'viewer']) {
    await page.waitForSelector(`${contentSel(name)} .rd-code .hljs-string`, { timeout: 15000 });
  }
  const code = content(page, 'editor').locator('.rd-code');
  await code.scrollIntoViewIfNeeded();
  assertEqual(await code.locator('select').inputValue(), 'typescript', 'language');
  const styles = await code.locator('pre').evaluate((element) => {
    const computed = getComputedStyle(element);
    return [computed.whiteSpace, computed.overflowX];
  });
  assertEqual(styles, ['pre', 'auto'], 'code keeps whitespace and scrolls in its block');
  const source = await code.locator('pre').innerText();
  await code.getByRole('button', { name: 'Copy' }).click();
  await code.getByRole('button', { name: 'Copied' }).waitFor();
  let clipboard = 'not readable in this browser';
  if (BROWSER === 'chromium') {
    clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assertEqual(clipboard.trim(), source.trim(), 'clipboard text');
    clipboard = 'clipboard text matches';
  }
  // Typing in the block re-highlights after the debounce, whitespace intact.
  assert((await code.locator('.hljs-comment').count()) > 0, 'TypeScript comment highlighted');
  const keywords = await code.locator('.hljs-keyword').count();
  await code.locator('pre').click();
  await focusEndOfNode(page, 'editor', 'codeBlock');
  await page.keyboard.press('Enter');
  await page.keyboard.type('    const indented = true;');
  await page.waitForFunction(
    ({ s, n }) => document.querySelectorAll(`${s} .rd-code .hljs-keyword`).length > n,
    { s: contentSel('viewer'), n: keywords },
    { timeout: 8000 },
  );
  const text = await content(page, 'viewer').locator('.rd-code pre').innerText();
  assert(text.includes('\n    const indented = true;'), 'leading spaces preserved in viewer');
  await code.locator('select').selectOption('python');
  await page.waitForSelector(`${contentSel('viewer')} .rd-code[data-language="python"]`);
  // The new grammar is applied: `//` is a comment in TypeScript, not in Python.
  for (const name of ['editor', 'viewer']) {
    await page.waitForFunction(
      (s) => document.querySelectorAll(`${s} .rd-code .hljs-comment`).length === 0,
      contentSel(name),
      { timeout: 8000 },
    );
  }
  clean(session);
  await shot(page, 'code-block');
  await session.close();
  return `highlighted in both panes; copy: ${clipboard}; whitespace preserved; language change synced`;
});

await check('mermaid', async () => {
  const session = await open();
  const { page } = session;
  for (const name of ['editor', 'viewer']) {
    await imagesLoaded(page, `${contentSel(name)} .rd-diagram__image`, 1);
  }
  const info = await page.evaluate((s) => {
    const image = document.querySelector(`${s} .rd-diagram__image`);
    return {
      scheme: image.src.slice(0, 19),
      liveSvg: document.querySelectorAll(`${s} .rd-diagram__preview svg`).length,
      leftovers: document.querySelectorAll('body > [id^="drd-mermaid"], body > [id^="rd-mermaid"]')
        .length,
      width: image.naturalWidth,
    };
  }, contentSel('viewer'));
  assertEqual(
    [info.scheme, info.liveSvg, info.leftovers],
    ['data:image/svg+xml;', 0, 0],
    'inert image',
  );
  await content(page, 'viewer').locator('.rd-diagram').scrollIntoViewIfNeeded();
  await content(page, 'editor').locator('.rd-diagram').scrollIntoViewIfNeeded();
  await shot(page, 'mermaid-preview');

  // Break the source by typing, read the error, repair it.
  const diagram = content(page, 'editor').locator('.rd-diagram');
  // "Edit source" opens the source and puts the cursor at its end.
  await diagram.getByRole('button', { name: 'Edit source' }).click();
  await page.waitForFunction((selector) => {
    const element = document.querySelector(selector);
    const { $from } = element.editor.state.selection;
    return (
      document.activeElement === element &&
      $from.parent.type.name === 'diagram' &&
      $from.parentOffset === $from.parent.content.size
    );
  }, contentSel('editor'));
  const linesBefore = (await diagram.locator('pre.rd-diagram__source').innerText())
    .trimEnd()
    .split('\n').length;
  await page.keyboard.press('Enter');
  await page.keyboard.type('  A --> --> ((( broken');
  for (const name of ['editor', 'viewer']) {
    await page.waitForSelector(`${contentSel(name)} [data-testid="rd-diagram-error"]`, {
      timeout: 15000,
    });
  }
  // The message names the line that was just typed (it may take one more render to settle).
  await page.waitForFunction(
    ({ s, line }) =>
      (
        document.querySelector(`${s} [data-testid="rd-diagram-error"] pre`)?.textContent ?? ''
      ).includes(`line ${line}`),
    { s: contentSel('viewer'), line: linesBefore + 1 },
    { timeout: 15000 },
  );
  const message = await content(page, 'viewer')
    .locator('[data-testid="rd-diagram-error"] pre')
    .innerText();
  assert(message.trim().length > 10, 'readable error text');
  assertEqual(
    await content(page, 'viewer').locator('.rd-diagram__image[data-stale]').count(),
    1,
    'last good preview kept',
  );
  await content(page, 'viewer').locator('.rd-diagram').scrollIntoViewIfNeeded();
  await shot(page, 'mermaid-error');
  for (let index = 0; index < '  A --> --> ((( broken'.length + 1; index += 1) {
    await page.keyboard.press('Backspace');
  }
  for (const name of ['editor', 'viewer']) {
    await page.waitForSelector(`${contentSel(name)} [data-testid="rd-diagram-error"]`, {
      state: 'detached',
      timeout: 15000,
    });
  }

  assertEqual(
    await page.evaluate(() => window.__rd.violations),
    [],
    'CSP violations for ordinary diagrams',
  );

  // A hostile diagram: nothing runs, nothing is fetched.
  await focusEnd(page, 'editor');
  await page.evaluate((selector) => {
    document
      .querySelector(selector)
      .editor.commands.insertDiagram(
        'flowchart LR\n  A["<img src=x onerror=\'window.__pwned=1\'>label"] --> B["<script>window.__pwned=2</script>ok"]\n  click A href "javascript:window.__pwned=3" "tip"\n  click B call window.__pwn()',
      );
  }, contentSel('editor'));
  await page.waitForFunction(
    (s) => {
      const diagrams = document.querySelectorAll(`${s} .rd-diagram`);
      const last = diagrams[diagrams.length - 1];
      return (
        diagrams.length === 2 &&
        (last.querySelector('.rd-diagram__image')?.complete ||
          last.querySelector('[data-testid="rd-diagram-error"]'))
      );
    },
    contentSel('viewer'),
    { timeout: 20000 },
  );
  await page.waitForTimeout(500);
  const hostile = await page.evaluate((s) => {
    const diagrams = document.querySelectorAll(`${s} .rd-diagram`);
    const image = diagrams[diagrams.length - 1].querySelector('.rd-diagram__image');
    const svg = image ? decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)) : '';
    return {
      pwned: window.__pwned ?? null,
      rendered: Boolean(image),
      bad: /<script|onerror|javascript:|<foreignObject|<iframe/i.test(svg),
    };
  }, contentSel('viewer'));
  assertEqual([hostile.pwned, hostile.bad], [null, false], 'hostile diagram is inert');
  // Configuration inside a diagram cannot add CSS: a blocked attempt would
  // show up below as a style-src or img-src report.
  notes.diagramConfigProbes = await insertConfigProbeDiagrams(page, 'editor');
  const reports = await page.evaluate(() => window.__rd.violations);
  assert(onlyInlineHandlerReports(reports), `unexpected CSP reports: ${reports.join('; ')}`);
  notes.mermaidHostileReports = reports.length;
  assertEqual(session.external, [], 'requests to other origins');
  cleanExceptBlockedHandlers(session);
  await session.close();
  return `rendered as ${info.scheme} image (${info.width}px wide) under the strict CSP with 0 violations; syntax error shown as text ("${message.trim().split('\n')[0].slice(0, 60)}"); hostile diagram ${hostile.rendered ? 'rendered' : 'rejected'} without executing`;
});

await check('paste-images-order', async () => {
  const session = await open({ kind: 'empty', panes: 'editor,viewer' });
  const { page } = session;
  await control(page, { action: 'uploadDelay', filename: 'pasted-image-1.png', ms: 2500 });
  await control(page, { action: 'uploadDelay', filename: 'pasted-image-2.png', ms: 300 });
  await content(page, 'editor').click();
  const mode = await paste(page, 'editor', {
    html:
      `<p>Alpha text</p><img src="data:image/png;base64,${RED}" alt="red picture">` +
      `<p>Middle text</p><img src="data:image/png;base64,${BLUE}"><p>Omega text</p>`,
  });
  await page.waitForFunction(
    (s) =>
      document.querySelectorAll(
        `${s} [data-testid="rd-upload-placeholder"][data-upload-state="uploading"]`,
      ).length === 2,
    contentSel('editor'),
  );
  // The other client sees placeholders that are uploading elsewhere.
  await page.waitForFunction(
    (s) =>
      document.querySelectorAll(
        `${s} [data-testid="rd-upload-placeholder"][data-upload-state="pending-remote"]`,
      ).length === 2,
    contentSel('viewer'),
  );
  await shot(page, 'paste-uploading');
  // Move the cursor away and keep typing while the uploads run.
  await content(page, 'editor').locator('p', { hasText: 'Omega text' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' — typed while uploading');
  // The second image finishes first.
  await page.waitForFunction(
    (n) => {
      const images = [];
      const walk = (node) => {
        if (node.type === 'image') images.push(node.attrs);
        for (const child of node.content ?? []) walk(child);
      };
      walk(window.__rd.json(n));
      return images.length === 2 && images[0].uploadId && !images[0].assetId && images[1].assetId;
    },
    'editor',
    { timeout: 10000 },
  );
  await page.waitForFunction(
    (n) => !JSON.stringify(window.__rd.json(n)).match(/"uploadId":"[0-9a-f-]+"/),
    'editor',
    { timeout: 15000 },
  );
  await waitSaved(page, 'editor');
  const doc = await json(page, 'viewer');
  const order = blocks(doc).map((block) =>
    block.type === 'image' ? `image:${block.attrs.name}` : block.text,
  );
  assertEqual(
    order,
    [
      'Alpha text',
      'image:pasted-image-1.png',
      'Middle text',
      'image:pasted-image-2.png',
      'Omega text — typed while uploading',
    ],
    'order after out-of-order completion',
  );
  const images = findNodes(doc, 'image');
  assert(
    images.every(
      (image) => /^[0-9a-f-]{36}$/.test(image.attrs.assetId) && image.attrs.uploadId == null,
    ),
    'asset ids set',
  );
  assertEqual(images[0].attrs.alt, 'red picture', 'alt text kept');
  assert(!/data:|blob:/.test(JSON.stringify(doc)), 'no bytes or temporary URLs in the document');
  await imagesLoaded(page, `${contentSel('viewer')} .rd-image__img`, 2);
  const natural = await page.evaluate(
    (s) =>
      [...document.querySelectorAll(`${s} .rd-image__img`)].map((image) => [
        image.naturalWidth,
        new URL(image.src).pathname.includes('/api/documents/'),
      ]),
    contentSel('viewer'),
  );
  assertEqual(
    natural,
    [
      [120, true],
      [100, true],
    ],
    'viewer shows the right bytes through the asset endpoint',
  );
  clean(session);
  await shot(page, 'paste-images-done');
  await session.close();
  return `pasted via ${mode}; image 2 completed before image 1; order kept; cursor had moved`;
});

await check('paste-files-and-attachments', async () => {
  const session = await open({ kind: 'empty' });
  const { page } = session;
  await content(page, 'editor').click();
  await page.keyboard.type('Screenshot below');
  const mode = await paste(page, 'editor', {
    files: [{ name: 'screenshot.png', type: 'image/png', base64: GREEN }],
  });
  await imagesLoaded(page, `${contentSel('viewer')} .rd-image__img`, 1);
  // File picker: an attachment and a type that is not allowed.
  await pane(page, 'editor')
    .locator('[data-testid="rd-attachment-input"]')
    .setInputFiles([
      {
        name: 'meeting-notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('notes '.repeat(400)),
      },
      { name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') },
    ]);
  const chip = content(page, 'viewer').locator('.rd-attachment__chip', {
    hasText: 'meeting-notes.txt',
  });
  await chip.waitFor({ timeout: 15000 });
  await chip.locator('a[download]').waitFor();
  const notice = pane(page, 'editor').locator('[data-testid="rd-editor-notice"]');
  await notice.waitFor();
  assert((await notice.innerText()).includes('setup.exe'), 'rejected file is named');
  const href = await chip.locator('a[download]').getAttribute('href');
  assert(/\/assets\/[0-9a-f-]{36}\?download=1$/.test(href), `download link ${href}`);
  const doc = await json(page, 'viewer');
  assertEqual(findNodes(doc, 'attachment').length, 1, 'one attachment node');
  // Drag and drop of a file.
  const dropped = await page.evaluate(
    ({ selector, base64 }) => {
      const target = document.querySelector(selector);
      try {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'dropped.png', {
            type: 'image/png',
          }),
        );
        const rect = target.getBoundingClientRect();
        const init = {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 40,
          clientY: rect.top + 20,
        };
        target.dispatchEvent(new DragEvent('dragover', init));
        target.dispatchEvent(new DragEvent('drop', init));
        return true;
      } catch {
        return false;
      }
    },
    { selector: contentSel('editor'), base64: BLUE },
  );
  let dropNote = 'synthetic drop not possible in this browser';
  if (dropped) {
    await imagesLoaded(page, `${contentSel('viewer')} .rd-image__img`, 2);
    dropNote = 'dropped image uploaded';
  }
  notes.syntheticDrop = dropped;
  await waitSaved(page, 'editor');
  clean(session);
  await shot(page, 'attachments');
  await session.close();
  return `clipboard file via ${mode}; attachment chip with download link; .exe rejected with a message; ${dropNote}`;
});

await check('paste-remote-report', async () => {
  const session = await open({ kind: 'empty' });
  const { page } = session;
  await content(page, 'editor').click();
  const mode = await paste(page, 'editor', {
    html:
      '<p>See <img src="https://example.com/chart.png" alt="Sales chart"> and ' +
      '<span style="font-family: Papyrus; color: #ff0000">fancy red</span>.</p>' +
      '<iframe src="https://example.com/embed"></iframe><script>window.__pwned = 1</script>' +
      '<p onclick="window.__pwned = 2">after</p>',
  });
  const report = pane(page, 'editor').locator('[data-testid="rd-paste-report"]');
  await report.waitFor();
  const text = await report.innerText();
  for (const expected of [
    'kept as a link',
    'Fonts were replaced',
    'embedded object',
    'active content',
  ]) {
    assert(text.includes(expected), `report mentions "${expected}": ${text}`);
  }
  const viewer = content(page, 'viewer');
  await viewer
    .locator('a[href="https://example.com/chart.png"]', { hasText: 'Image: Sales chart' })
    .waitFor();
  assertEqual(
    await viewer.locator('img:not(.ProseMirror-separator)').count(),
    0,
    'no image element for a remote image',
  );
  await viewer.locator('span[style*="color"]', { hasText: 'fancy red' }).waitFor();
  await shot(page, 'paste-report');

  // Real application dialects.
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await paste(page, 'editor', { html: GOOGLE_DOCS_HTML });
  await report.locator('text=Google Docs').waitFor();
  await viewer.locator('h1', { hasText: 'Quarterly plan' }).waitFor();
  await viewer.locator('ul[data-type="taskList"] li', { hasText: 'Done item' }).waitFor();
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await paste(page, 'editor', { html: WORD_HTML });
  await report.locator('text=Microsoft Word').waitFor();
  await page.waitForFunction(
    (c) =>
      [...document.querySelectorAll(`${c} ol li`)].filter((item) => item.textContent === 'Step two')
        .length === 2,
    contentSel('viewer'),
  );
  assertEqual(await viewer.locator('table').count(), 2, 'tables from Docs and Word');

  // Plain text stays plain.
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await paste(page, 'editor', { text: 'plain line one\nplain <b>line</b> two' });
  await viewer.locator('p', { hasText: 'plain <b>line</b> two' }).waitFor();

  await page.waitForTimeout(400);
  assertEqual(await page.evaluate(() => window.__pwned ?? null), null, 'nothing executed');
  assertEqual(session.external, [], 'no request to a remote host');
  await waitSaved(page, 'editor');
  cleanExceptBlockedHandlers(session);
  await session.close();
  return `pasted via ${mode}; remote image became a labelled link; report lists fonts, embedded object and active content; nothing fetched`;
});

await check('real-clipboard', async () => {
  // Real copy and paste events through the browser's own clipboard (no synthetic event).
  const session = await open({
    contextOptions:
      BROWSER === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {},
  });
  const { page, mod } = session;
  const occurrences = (name, pattern) =>
    page.evaluate(
      ({ n, source }) =>
        (JSON.stringify(window.__rd.json(n)).match(new RegExp(source, 'g')) ?? []).length,
      { n: name, source: pattern },
    );
  const waitOccurrences = (name, pattern, count, timeout = 6000) =>
    page
      .waitForFunction(
        ({ n, source, expected }) =>
          (JSON.stringify(window.__rd.json(n)).match(new RegExp(source, 'g')) ?? []).length ===
          expected,
        { n: name, source: pattern, expected: count },
        { timeout },
      )
      .then(() => true)
      .catch(() => false);

  // 1. A formatted selection: heading, ordered list and a link, copied with the keyboard.
  await page.evaluate((selector) => {
    const editor = document.querySelector(selector).editor;
    let from = 0;
    let to = 0;
    editor.state.doc.forEach((node, pos) => {
      if (node.type.name === 'heading' && node.textContent === 'Agenda') from = pos + 1;
      if (node.type.name === 'orderedList' && from && !to) to = pos + node.nodeSize - 3;
    });
    editor.chain().setTextSelection({ from, to }).focus().run();
  }, contentSel('editor'));
  await page.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    contentSel('editor'),
  );
  assertEqual(await occurrences('editor', '"text":"Agenda"'), 1, 'one Agenda heading before');
  await page.keyboard.press(`${mod}+c`);
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`${mod}+v`);
  if (!(await waitOccurrences('viewer', '"text":"Agenda"', 2))) {
    await session.close();
    throw new NotVerifiable(
      `${mod}+C / ${mod}+V did not move data through the clipboard of this headless ${BROWSER} build`,
    );
  }
  const doc = await json(page, 'viewer');
  const lists = findNodes(doc, 'orderedList');
  assertEqual(lists.length, 2, 'ordered list pasted as a list');
  assertEqual(
    lists.map((list) => list.content.length),
    [3, 3],
    'all list items pasted',
  );
  assertEqual(await occurrences('viewer', '"type":"link"'), 2, 'link mark kept by copy and paste');
  assertEqual(
    findNodes(doc, 'heading').filter((node) => blocks({ content: [node] })[0].text === 'Agenda')
      .length,
    2,
    'heading pasted as a heading',
  );
  // Copying inside the product is lossless: nothing to report.
  assertEqual(
    await pane(page, 'editor').locator('[data-testid="rd-paste-report"]').count(),
    0,
    'no paste report for content copied from the same document',
  );

  // 2. The code block's Copy button, pasted back as text.
  const code = content(page, 'editor').locator('.rd-code').first();
  await code.scrollIntoViewIfNeeded();
  await code.getByRole('button', { name: 'Copy' }).click();
  await code.getByRole('button', { name: 'Copied' }).waitFor();
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`${mod}+v`);
  const buttonCopy = await waitOccurrences('viewer', 'indicator\\.textContent', 2);
  notes.copyButtonReachedClipboard = buttonCopy;
  assert(buttonCopy, 'text copied by the Copy button can be pasted');
  // Pasted text is text: the template literal's markup-like characters are not interpreted.
  assertEqual(
    findNodes(await json(page, 'viewer'), 'codeBlock').length >= 1,
    true,
    'document intact',
  );
  await waitSaved(page, 'editor');
  clean(session);
  await session.close();
  return `real ${mod}+C / ${mod}+V: heading, list and link survived a copy inside the document; the Copy button's text was pasted back`;
});

await check('hindi-emoji', async () => {
  const session = await open({ kind: 'empty' });
  const { page } = session;
  const typed = 'नमस्ते दुनिया, यह एक परीक्षण है 🚀✨ mixed with English 👩‍💻 क्षत्रिय';
  await content(page, 'editor').click();
  await page.keyboard.type(typed);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('दूसरी पंक्ति 😀');
  await page.waitForFunction(({ n, t }) => JSON.stringify(window.__rd.json(n)).includes(t), {
    n: 'viewer',
    t: 'दूसरी पंक्ति 😀',
  });
  const viewerBlocks = blocks(await json(page, 'viewer'));
  assertEqual(
    viewerBlocks.map((block) => block.text),
    [typed, 'दूसरी पंक्ति 😀'],
    'text in the viewer',
  );
  // Backspace removes whole characters, never half of a surrogate pair.
  await page.keyboard.press('Backspace');
  await page.waitForFunction((n) => !JSON.stringify(window.__rd.json(n)).includes('😀'), 'viewer');
  const after = blocks(await json(page, 'viewer'))[1].text;
  assert(
    !/[\ud800-\udfff]/.test(after.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')),
    'no lone surrogate',
  );
  await waitSaved(page, 'editor');
  clean(session);
  await shot(page, 'hindi-emoji');
  await session.close();
  return 'Devanagari conjuncts, ZWJ emoji and mixed text identical in both panes';
});

await check(
  'ime-composition',
  async () => {
    const session = await open({ kind: 'empty' });
    const { page } = session;
    const client = await page.context().newCDPSession(page);
    await content(page, 'editor').click();
    await page.keyboard.type('Before ');
    // An upload that finishes while the composition is still open.
    await control(page, { action: 'uploadDelay', filename: 'during-ime.png', ms: 500 });
    await paste(page, 'editor', {
      files: [{ name: 'during-ime.png', type: 'image/png', base64: RED }],
    });
    await content(page, 'editor').locator('p', { hasText: 'Before' }).click();
    await page.keyboard.press('End');
    const compose = (text) =>
      client.send('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
    await compose('に');
    await compose('にほ');
    await compose('にほん');
    const during = await page.evaluate((selector) => {
      const editor = document.querySelector(selector).editor;
      return { composing: editor.view.composing, text: editor.state.doc.textContent };
    }, contentSel('editor'));
    assert(during.composing, 'composition is active');
    // Wait until the upload itself has finished on the server.
    await page.waitForTimeout(1500);
    const held = await page.evaluate((selector) => {
      const editor = document.querySelector(selector).editor;
      let pending = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'image' && node.attrs.uploadId) pending += 1;
      });
      return { composing: editor.view.composing, pending };
    }, contentSel('editor'));
    assertEqual(
      held,
      { composing: true, pending: 1 },
      'no document change dispatched during composition',
    );
    await client.send('Input.insertText', { text: '日本' });
    await page.keyboard.type(' after');
    await page.waitForFunction(
      (n) => !JSON.stringify(window.__rd.json(n)).match(/"uploadId":"[0-9a-f-]+"/),
      'viewer',
      { timeout: 10000 },
    );
    const text = blocks(await json(page, 'viewer')).map((block) => block.text);
    assert(text.includes('Before 日本 after'), `composed text intact: ${JSON.stringify(text)}`);
    await waitSaved(page, 'editor');
    clean(session);
    await session.close();
    return 'CDP Input.imeSetComposition: upload completion waited for the end of the composition; text intact in the viewer';
  },
  { browsers: ['chromium'] },
);

await check(
  'ime-remote-edits',
  async () => {
    // Somebody else types while this user has an IME composition open.
    const session = await open({ kind: 'empty', panes: 'editor,editor2' });
    const { page } = session;
    const client = await page.context().newCDPSession(page);
    await content(page, 'editor').click();
    await page.keyboard.type('Alpha ');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Beta');
    await page.waitForFunction(
      (n) => JSON.stringify(window.__rd.json(n)).includes('Beta'),
      'editor2',
    );
    await content(page, 'editor').locator('p', { hasText: 'Alpha' }).click();
    await page.keyboard.press('End');
    const compose = (text) =>
      client.send('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
    const composing = () =>
      page.evaluate(
        (selector) => document.querySelector(selector).editor.view.composing,
        contentSel('editor'),
      );
    const remoteInsert = (where, text) =>
      page.evaluate(
        ({ selector, at, value }) => {
          const editor = document.querySelector(selector).editor;
          const first = editor.state.doc.child(0);
          const position =
            at === 'other-block'
              ? editor.state.doc.content.size - 1
              : at === 'same-start'
                ? 1
                : first.nodeSize + 1;
          // No focus change: this is the other person's editor.
          editor.view.dispatch(editor.state.tr.insertText(value, position));
        },
        { selector: contentSel('editor2'), at: where, value: text },
      );
    await compose('に');
    await compose('にほ');
    assert(await composing(), 'composition is active');
    // 1. A remote edit in another paragraph.
    await remoteInsert('other-block', ' remote');
    await page.waitForFunction(
      (n) => JSON.stringify(window.__rd.json(n)).includes('Beta remote'),
      'editor',
    );
    const afterOtherBlock = await composing();
    await compose('にほん');
    // 2. A remote edit at the start of the very paragraph being composed in.
    await remoteInsert('same-start', 'X');
    await page.waitForFunction(
      (n) => JSON.stringify(window.__rd.json(n)).includes('XAlpha'),
      'editor',
    );
    const afterSameBlock = await composing();
    await client.send('Input.insertText', { text: '日本' });
    await page.keyboard.type(' done');
    await page.waitForFunction(
      (n) => JSON.stringify(window.__rd.json(n)).includes('done'),
      'editor2',
    );
    await waitSaved(page, 'editor');
    const here = blocks(await json(page, 'editor')).map((block) => block.text);
    const there = blocks(await json(page, 'editor2')).map((block) => block.text);
    notes.imeRemote = { afterOtherBlock, afterSameBlock, text: here };
    assertEqual(here, there, 'both editors converged');
    assertEqual(
      here,
      ['XAlpha 日本 done', 'Beta remote'],
      'composed text intact next to the remote edits',
    );
    assert(afterOtherBlock, 'a remote edit in another paragraph does not end the composition');
    clean(session);
    await session.close();
    return `remote edits arrived during a composition (CDP): composition ${afterOtherBlock ? 'continued' : 'ended'} after an edit in another paragraph and ${afterSameBlock ? 'continued' : 'ended'} after one in the same paragraph; final text identical in both editors`;
  },
  { browsers: ['chromium'] },
);

await check('find-replace', async () => {
  const session = await open();
  const { page, mod } = session;
  await content(page, 'editor').locator('h1').click();
  await page.keyboard.press(`${mod}+f`);
  const editorPane = pane(page, 'editor');
  const input = editorPane.locator('[data-testid="rd-find-input"]');
  await input.waitFor();
  await input.fill('the');
  const count = editorPane.locator('[data-testid="rd-find-count"]');
  await page.waitForFunction(
    (s) =>
      /^\d+ of \d+$/.test(
        document.querySelector(`${s} [data-testid="rd-find-count"]`)?.textContent ?? '',
      ),
    paneSel('editor'),
  );
  const total = Number((await count.innerText()).split(' of ')[1]);
  assertEqual(
    await content(page, 'editor').locator('.rd-find-match').count(),
    total,
    'decorations',
  );
  const position = Number((await count.innerText()).split(' of ')[0]);
  await input.press('Enter');
  await page.waitForFunction(
    ({ s, expected }) =>
      document.querySelector(`${s} [data-testid="rd-find-count"]`)?.textContent === expected,
    { s: paneSel('editor'), expected: `${(position % total) + 1} of ${total}` },
  );
  assertEqual(
    await content(page, 'editor').locator('.rd-find-match--current').count(),
    1,
    'one current match',
  );
  // Decorations are local: the viewer shows none and its document is untouched.
  assertEqual(
    await content(page, 'viewer').locator('.rd-find-match').count(),
    0,
    'no decorations in viewer',
  );
  await editorPane.locator('[data-testid="rd-replace-input"]').fill('THE');
  await editorPane.locator('[data-testid="rd-replace-one"]').click();
  await page.waitForFunction(
    ({ s, expected }) =>
      (document.querySelector(`${s} [data-testid="rd-find-count"]`)?.textContent ?? '').endsWith(
        `of ${expected}`,
      ),
    { s: paneSel('editor'), expected: total },
  );
  // Case-insensitive search still finds the replaced word; replace all removes every match.
  await editorPane.getByRole('button', { name: 'Match case' }).click();
  await page.waitForFunction(
    ({ s, expected }) =>
      (document.querySelector(`${s} [data-testid="rd-find-count"]`)?.textContent ?? '').endsWith(
        `of ${expected}`,
      ),
    { s: paneSel('editor'), expected: total - 1 },
  );
  await editorPane.locator('[data-testid="rd-replace-all"]').click();
  await page.waitForFunction(
    (s) =>
      document.querySelector(`${s} [data-testid="rd-find-count"]`)?.textContent === 'No results',
    paneSel('editor'),
  );
  await page.waitForFunction((n) => !/\bthe\b/.test(JSON.stringify(window.__rd.json(n))), 'viewer');
  const replaced = (JSON.stringify(await json(page, 'viewer')).match(/THE/g) ?? []).length;
  assert(replaced >= total, `replacements reached the viewer (${replaced} of ${total})`);

  // Viewer: find only.
  const viewerPane = pane(page, 'viewer');
  await viewerPane.locator('[data-testid="rd-find-open"]').click();
  const viewerInput = viewerPane.locator('[data-testid="rd-find-input"]');
  await viewerInput.fill('Rollout');
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} .rd-find-match`).length > 0,
    contentSel('viewer'),
  );
  assertEqual(
    await viewerPane.locator('[data-testid="rd-replace-input"]').count(),
    0,
    'no replace for viewers',
  );
  const before = JSON.stringify(await json(page, 'viewer'));
  await viewerInput.press('Enter');
  // Matches inside a code block are highlighted too …
  await viewerInput.fill('indicator');
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} .rd-code .rd-find-match`).length > 0,
    contentSel('viewer'),
  );
  // … and stepping onto a match inside a collapsed diagram source reveals it.
  await viewerInput.fill('PostgreSQL');
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} .rd-diagram__source .rd-find-match`).length > 0,
    contentSel('viewer'),
  );
  const sourceShown = () =>
    page.evaluate((s) => {
      const current = document.querySelector(`${s} .rd-find-match--current`);
      const source = current?.closest('.rd-diagram__source');
      return source ? source.getBoundingClientRect().height > 0 : null;
    }, contentSel('viewer'));
  let revealed = await sourceShown();
  for (let step = 0; step < 6 && revealed === null; step += 1) {
    await viewerInput.press('Enter');
    await page.waitForTimeout(120);
    revealed = await sourceShown();
  }
  assertEqual(revealed, true, 'current match inside a collapsed diagram source is shown');
  await viewerInput.press('Escape');
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} .rd-find-match`).length === 0,
    contentSel('viewer'),
  );
  assertEqual(
    JSON.stringify(await json(page, 'viewer')),
    before,
    'viewer document unchanged by find',
  );
  await waitSaved(page, 'editor');
  clean(session);
  await session.close();
  return `${total} matches highlighted, stepped, replaced one, replaced all; viewer find works read-only`;
});

async function followLatestScenario(options = {}) {
  const session = await open({ kind: 'long', ...options });
  const { page } = session;
  const scroller = `${paneSel('viewer')} .rd-editor__scroll`;
  const toggle = pane(page, 'viewer').locator('[data-testid="rd-follow-latest"]');
  assertEqual(await toggle.getAttribute('data-state'), 'off', 'off by default');
  const position = () =>
    page.evaluate((s) => Math.round(document.querySelector(s).scrollTop), scroller);
  // Off: a remote change at the end does not move the reader.
  await focusEnd(page, 'editor');
  await page.keyboard.type('First remote line.');
  await page.waitForFunction(
    (n) => JSON.stringify(window.__rd.json(n)).includes('First remote line.'),
    'viewer',
  );
  await page.waitForTimeout(400);
  assertEqual(await position(), 0, 'no scrolling while Follow Latest is off');

  await toggle.click();
  await page.waitForSelector(
    `${paneSel('viewer')} [data-testid="rd-follow-latest"][data-state="on"]`,
  );
  const focusBefore = await page.evaluate(
    () => document.activeElement?.closest('[data-pane]')?.dataset.pane ?? null,
  );
  await focusEnd(page, 'editor');
  await page.keyboard.type(' Second remote line.');
  await page.waitForFunction(
    (s) => {
      const element = document.querySelector(s);
      return element.scrollTop > element.scrollHeight - element.clientHeight - 600;
    },
    scroller,
    { timeout: 8000 },
  );
  const focusAfter = await page.evaluate(
    () => document.activeElement?.closest('[data-pane]')?.dataset.pane ?? null,
  );
  assertEqual(focusAfter, 'editor', 'focus stays with the typing editor');
  // The smooth scroll may still be running: wait until the change is in view.
  await page.waitForFunction(
    ({ s, c }) => {
      const view = document.querySelector(s).getBoundingClientRect();
      const paragraphs = [...document.querySelectorAll(`${c} p`)];
      const target = paragraphs.find((p) => p.textContent.includes('Second remote line.'));
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      return rect.bottom > view.top && rect.bottom <= view.bottom;
    },
    { s: scroller, c: contentSel('viewer') },
    { timeout: 8000 },
  );
  assertEqual(
    await toggle.getAttribute('data-state'),
    'on',
    'still following after its own scrolling',
  );
  await page.waitForTimeout(1100);

  // The reader scrolls back: following pauses, nothing moves, a jump control appears.
  await page.locator(scroller).hover();
  await page.mouse.wheel(0, -1500);
  await page.waitForSelector(
    `${paneSel('viewer')} [data-testid="rd-follow-latest"][data-state="paused"]`,
  );
  await page.waitForTimeout(300);
  const paused = await position();
  await focusEnd(page, 'editor');
  await page.keyboard.type(' Third remote line.');
  const jump = pane(page, 'viewer').locator('[data-testid="rd-jump-latest"]');
  await jump.waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  assert(Math.abs((await position()) - paused) <= 2, 'reader was not moved while paused');
  await shot(page, 'follow-latest-paused');
  await jump.click();
  await page.waitForFunction(
    (s) => {
      const element = document.querySelector(s);
      return element.scrollTop > element.scrollHeight - element.clientHeight - 600;
    },
    scroller,
    { timeout: 8000 },
  );
  await page.waitForSelector(
    `${paneSel('viewer')} [data-testid="rd-follow-latest"][data-state="on"]`,
  );
  assertEqual(await jump.count(), 0, 'jump control gone after resuming');

  // Selecting text pauses as well.
  await page.waitForTimeout(1100);
  await content(page, 'viewer').locator('p').last().dblclick();
  await page.waitForSelector(
    `${paneSel('viewer')} [data-testid="rd-follow-latest"][data-state="paused"]`,
  );
  clean(session);
  await session.close();
  return `off by default; followed without taking focus (focus before: ${focusBefore}); paused on scroll and on selection; jump resumed`;
}

/**
 * Init script that makes a browser behave like one without CSS scroll
 * anchoring: `overflow-anchor` is reported as unsupported and switched off.
 */
const WITHOUT_NATIVE_ANCHORING = () => {
  const supports = CSS.supports.bind(CSS);
  CSS.supports = (...args) =>
    String(args[0]).includes('overflow-anchor') ? false : supports(...args);
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '* { overflow-anchor: none !important; }';
    document.head.append(style);
  });
};

await check('follow-latest', () => followLatestScenario());

await check('follow-latest-manual', async () => {
  // Follow Latest together with the manual anchoring fallback.
  const detail = await followLatestScenario({ init: WITHOUT_NATIVE_ANCHORING });
  return `with native scroll anchoring disabled: ${detail}`;
});

async function scrollStability(options = {}) {
  const session = await open({ kind: 'long', ...options });
  const { page } = session;
  const scroller = `${paneSel('viewer')} .rd-editor__scroll`;
  await page.evaluate((s) => {
    document.querySelector(s).scrollTop = 1700;
  }, scroller);
  await page.waitForTimeout(200);
  let anchorText = null;
  const measure = () =>
    page.evaluate(
      ({ s, c, text }) => {
        const view = document.querySelector(s).getBoundingClientRect();
        const all = [...document.querySelector(c).children];
        const element = text
          ? all.find((child) => child.textContent === text)
          : all.find((child) => child.getBoundingClientRect().top >= view.top + 4);
        return { text: element.textContent, top: element.getBoundingClientRect().top - view.top };
      },
      { s: scroller, c: contentSel('viewer'), text: anchorText },
    );
  const before = await measure();
  anchorText = before.text;
  // Another person adds several blocks above the reader's viewport …
  await focusStart(page, 'editor');
  for (let index = 1; index <= 5; index += 1) {
    await page.keyboard.type(`Inserted above ${index}`);
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(
    (n) => JSON.stringify(window.__rd.json(n)).includes('Inserted above 5'),
    'viewer',
  );
  await page.waitForTimeout(400);
  const afterInsert = await measure();
  // … and removes some again.
  for (
    let index = 0;
    index < 'Inserted above 5'.length + 'Inserted above 4'.length + 3;
    index += 1
  ) {
    await page.keyboard.press('Backspace');
  }
  await page.waitForFunction(
    (n) => !JSON.stringify(window.__rd.json(n)).includes('Inserted above 4'),
    'viewer',
  );
  await page.waitForTimeout(400);
  const afterDelete = await measure();
  const native = await page.evaluate(() => CSS.supports('overflow-anchor', 'auto'));
  const drift = Math.max(
    Math.abs(afterInsert.top - before.top),
    Math.abs(afterDelete.top - before.top),
  );
  clean(session);
  await session.close();
  return { drift, native };
}

await check('scroll-stability', async () => {
  const { drift, native } = await scrollStability();
  notes.nativeScrollAnchoring = native;
  assert(drift <= 3, `reader moved by ${drift.toFixed(1)}px (native anchoring: ${native})`);
  return `blocks inserted and removed above the viewport; the reader's first visible block moved at most ${drift.toFixed(1)}px (${native ? 'native CSS scroll anchoring' : 'manual anchoring fallback'})`;
});

await check('scroll-stability-manual', async () => {
  // The fallback for browsers without CSS scroll anchoring: pretend this one
  // has none and switch the native behaviour off.
  const { drift, native } = await scrollStability({ init: WITHOUT_NATIVE_ANCHORING });
  assertEqual(native, false, 'native anchoring reported as unavailable');
  assert(drift <= 3, `reader moved by ${drift.toFixed(1)}px with the manual fallback`);
  return `same scenario with native anchoring disabled: the manual fallback kept the reader within ${drift.toFixed(1)}px`;
});

await check('undo-isolation', async () => {
  const session = await open({ kind: 'empty', panes: 'editor,editor2' });
  const { page, mod } = session;
  await content(page, 'editor').click();
  await page.keyboard.type('AAA from Asha');
  await page.waitForFunction(
    (n) => JSON.stringify(window.__rd.json(n)).includes('AAA from Asha'),
    'editor2',
  );
  await focusEnd(page, 'editor2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('BBB from Miguel');
  await page.waitForFunction(
    (n) => JSON.stringify(window.__rd.json(n)).includes('BBB from Miguel'),
    'editor',
  );
  await page.waitForTimeout(700);
  // Asha undoes: only her own text goes away.
  await content(page, 'editor').focus();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press(`${mod}+z`);
    const text = JSON.stringify(await json(page, 'editor'));
    if (!text.includes('AAA')) break;
  }
  await page.waitForFunction(
    (n) => !JSON.stringify(window.__rd.json(n)).includes('AAA'),
    'editor2',
  );
  for (const name of ['editor', 'editor2']) {
    const text = JSON.stringify(await json(page, name));
    assert(text.includes('BBB from Miguel'), `${name} keeps the other user's text`);
    assert(!text.includes('AAA'), `${name} lost only the undone text`);
  }
  // More undo steps never reach the other user's edit.
  for (let step = 0; step < 5; step += 1) await page.keyboard.press(`${mod}+z`);
  await page.waitForTimeout(300);
  assert(
    JSON.stringify(await json(page, 'editor2')).includes('BBB from Miguel'),
    'still there after extra undo',
  );
  await pane(page, 'editor').locator('[data-testid="rd-tool-redo"]').click();
  await page.waitForFunction((n) => JSON.stringify(window.__rd.json(n)).includes('AAA'), 'editor2');
  await waitSaved(page, 'editor');
  clean(session);
  await session.close();
  return "undo removed only the local user's text in both editors; redo restored it";
});

await check('upload-states', async () => {
  const session = await open({ kind: 'empty', panes: 'editor,editor2' });
  const { page, mod } = session;
  const imageCount = async (name) => findNodes(await json(page, name), 'image').length;
  const file = (name, base64 = RED) => ({ files: [{ name, type: 'image/png', base64 }] });
  await content(page, 'editor').click();
  await page.keyboard.type('Uploads');

  // Cancel: no node stays, nothing arrives later.
  await control(page, { action: 'uploadDelay', filename: 'cancel-me.png', ms: 2500 });
  await paste(page, 'editor', file('cancel-me.png'));
  const placeholder = content(page, 'editor').locator('[data-testid="rd-upload-placeholder"]');
  await placeholder.waitFor();
  assert(/Uploading|Waiting|Processing/.test(await placeholder.innerText()), 'progress text');
  // The other editor sees it as uploading elsewhere, with a remove action.
  const remote = content(page, 'editor2').locator(
    '[data-testid="rd-upload-placeholder"][data-upload-state="pending-remote"]',
  );
  await remote.waitFor();
  assert((await remote.innerText()).includes('another device'), 'remote placeholder label');
  await remote.getByRole('button', { name: 'Remove' }).waitFor();
  await shot(page, 'upload-remote-placeholder');
  await placeholder.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} [data-testid="rd-upload-placeholder"]`).length === 0,
    contentSel('editor2'),
  );
  await page.waitForTimeout(3000);
  assertEqual(
    [await imageCount('editor'), await imageCount('editor2')],
    [0, 0],
    'cancelled upload inserted nothing',
  );

  // A transient failure heals by itself: the file waits, is sent again and arrives,
  // without the person doing anything. (Giving up after the last attempt and the
  // manual Retry button are covered by the unit tests; the backoff makes them too
  // slow for a browser check.)
  await control(page, { action: 'failUploads', count: 1 });
  await paste(page, 'editor', file('retry-me.png', BLUE));
  const waiting = content(page, 'editor').locator('[data-testid="rd-upload-placeholder"]');
  await waiting.waitFor();
  await page.waitForFunction(
    (s) =>
      /Waiting to retry/.test(
        document.querySelector(`${s} [data-testid="rd-upload-placeholder"]`)?.textContent ?? '',
      ),
    contentSel('editor'),
  );
  assertEqual(
    await content(page, 'editor')
      .locator('[data-testid="rd-upload-placeholder"][data-upload-state="failed"]')
      .count(),
    0,
    'a transient failure is not shown as failed',
  );
  await shot(page, 'upload-retrying');
  await imagesLoaded(page, `${contentSel('editor2')} .rd-image__img`, 1);

  // Undo while uploading: no later insertion. Redo after completion: the node gets its asset.
  await control(page, { action: 'uploadDelay', filename: 'undo-me.png', ms: 1500 });
  await focusEnd(page, 'editor');
  await paste(page, 'editor', file('undo-me.png', GREEN));
  await content(page, 'editor').locator('[data-testid="rd-upload-placeholder"]').waitFor();
  await content(page, 'editor').focus();
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} [data-testid="rd-upload-placeholder"]`).length === 0,
    contentSel('editor'),
  );
  await page.waitForTimeout(2200);
  assertEqual(
    [await imageCount('editor'), await imageCount('editor2')],
    [1, 1],
    'nothing inserted after undo',
  );
  await page.keyboard.press(`${mod}+Shift+z`);
  await page.waitForFunction(
    (n) => {
      const images = [];
      const walk = (node) => {
        if (node.type === 'image') images.push(node.attrs);
        for (const child of node.content ?? []) walk(child);
      };
      walk(window.__rd.json(n));
      return images.length === 2 && images.every((image) => image.assetId && !image.uploadId);
    },
    'editor2',
    { timeout: 10000 },
  );
  await imagesLoaded(page, `${contentSel('editor2')} .rd-image__img`, 2);

  // The completion is not an undo step of its own: one undo removes the image again.
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction(
    (n) => JSON.stringify(window.__rd.json(n)).split('"type":"image"').length - 1 === 1,
    'editor2',
  );
  await waitSaved(page, 'editor');
  // The deliberately failed upload is the only error the browser may log.
  assertEqual(
    session.problems.filter((problem) => !problem.includes('503')),
    [],
    'console errors / dialogs',
  );
  await session.close();
  return 'cancel, failure + retry, undo while uploading (no insertion), redo after completion (asset id), remote placeholder with remove';
});

await check('status-truth', async () => {
  const session = await open({ kind: 'empty' });
  const { page, context } = session;
  const save = () =>
    pane(page, 'editor').locator('[data-testid="rd-status-save"]').getAttribute('data-state');
  await content(page, 'editor').click();
  await control(page, { action: 'holdDatabase', value: true });
  await page.keyboard.type('held');
  await page.waitForSelector(
    `${paneSel('editor')} [data-testid="rd-status-save"][data-state="saving"]`,
  );
  // The viewer already shows the text, but it is not durable and not "Saved".
  await content(page, 'viewer').locator('p', { hasText: 'held' }).waitFor();
  await page.waitForTimeout(700);
  assertEqual(await save(), 'saving', 'still saving while the commit is held');
  assert(!(await control(page, { action: 'durable' })).text.includes('held'), 'not durable yet');
  await control(page, { action: 'holdDatabase', value: false });
  await waitSaved(page, 'editor');
  assert((await control(page, { action: 'durable' })).text.includes('held'), 'durable after Saved');

  await control(page, { action: 'failDatabase', value: true });
  await page.keyboard.type(' failing');
  await page.waitForSelector(
    `${paneSel('editor')} [data-testid="rd-status-save"][data-state="error"]`,
  );
  await shot(page, 'status-error');
  await control(page, { action: 'failDatabase', value: false });
  await waitSaved(page, 'editor');

  // Network loss: offline + pending, then live + saved.
  await context.setOffline(true);
  await page.waitForSelector(
    `${paneSel('editor')} [data-testid="rd-status-connection"]:is([data-state="offline"],[data-state="reconnecting"])`,
    { timeout: 45000 },
  );
  const offlineState = await pane(page, 'editor')
    .locator('[data-testid="rd-status-connection"]')
    .getAttribute('data-state');
  await page.keyboard.type(' offline');
  await page.waitForSelector(
    `${paneSel('editor')} [data-testid="rd-status-save"][data-state="pending"]`,
  );
  await shot(page, 'status-offline');
  await context.setOffline(false);
  await page.waitForSelector(
    `${paneSel('editor')} [data-testid="rd-status-connection"][data-state="live"]`,
    { timeout: 45000 },
  );
  await waitSaved(page, 'editor');
  assert(
    (await control(page, { action: 'durable' })).text.includes('held failing offline'),
    'offline work is durable',
  );
  notes.offlineState = offlineState;
  await session.close();
  return `Saving while the commit was held, Saved only after it; error on a failing commit; ${offlineState} + pending without network, then Saved`;
});

await check('roles-and-generation', async () => {
  const session = await open({ kind: 'empty' });
  const { page } = session;
  await content(page, 'editor').click();
  await page.keyboard.type('before downgrade');
  await waitSaved(page, 'editor');
  await control(page, { action: 'setRole', principal: 'editor', role: 'viewer' });
  await page.waitForSelector(
    `${paneSel('editor')} [data-testid="rd-editor"][data-editable="false"]`,
  );
  assertEqual(
    await pane(page, 'editor').locator('[data-testid="rd-toolbar"]').count(),
    0,
    'toolbar removed',
  );
  assertEqual(
    await content(page, 'editor').getAttribute('contenteditable'),
    'false',
    'not editable',
  );
  await pane(page, 'editor')
    .locator('[data-testid="rd-banner-notice"][data-kind="role_changed"]')
    .waitFor();
  assertEqual(
    await pane(page, 'editor').locator('[data-testid="rd-status-save"]').getAttribute('data-state'),
    'read_only',
    'view only',
  );
  await control(page, { action: 'setRole', principal: 'editor', role: 'editor' });
  await page.waitForSelector(
    `${paneSel('editor')} [data-testid="rd-editor"][data-editable="true"]`,
    { timeout: 15000 },
  );
  await waitLive(page, 'editor');
  await focusEnd(page, 'editor');
  await page.keyboard.type(' and after upgrade');
  await content(page, 'viewer')
    .locator('p', { hasText: 'before downgrade and after upgrade' })
    .waitFor();
  await waitSaved(page, 'editor');

  // Snapshot restore: both panes move to the new generation.
  await control(page, { action: 'restore' });
  for (const name of ['editor', 'viewer']) {
    await page.waitForFunction(
      (n) => window.__rd.status(n)?.generation === 2 && window.__rd.status(n)?.ready,
      name,
      { timeout: 20000 },
    );
    await content(page, name).locator('p', { hasText: 'Restored from a snapshot.' }).waitFor();
    await pane(page, name)
      .locator('[data-testid="rd-banner-notice"][data-kind="restored"]')
      .waitFor();
  }
  assert(
    !(await content(page, 'viewer').innerText()).includes('before downgrade'),
    'old generation not shown',
  );
  await shot(page, 'restored');

  // Revocation ends the viewer's session.
  await control(page, { action: 'revoke', principal: 'viewer' });
  await page.waitForSelector(
    `${paneSel('viewer')} [data-testid="rd-status-connection"][data-state="access_revoked"]`,
  );
  await pane(page, 'viewer').locator('[data-testid="rd-banner-terminal"]').waitFor();
  await shot(page, 'revoked');
  await session.close();
  return 'live downgrade and upgrade; snapshot restore rebinds both editors; revocation shows the terminal state';
});

for (const width of [1280, 820, 360]) {
  await check(`responsive-${width}`, async () => {
    const session = await open({ viewport: { width, height: width === 360 ? 740 : 900 } });
    const { page } = session;
    await page.waitForSelector(`${contentSel('editor')} .rd-diagram__image`);
    await page.waitForTimeout(600);
    const layout = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-testid="rd-toolbar"] .rd-toolbar__scroll');
      const editor = document.querySelector('[data-pane="editor"] [data-testid="rd-editor"]');
      const wide = [...document.querySelectorAll('[data-pane="editor"] .rd-doc > *')].filter(
        (element) =>
          element.getBoundingClientRect().right > editor.getBoundingClientRect().right + 1,
      );
      return {
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        toolbarScrolls: toolbar ? toolbar.scrollWidth > toolbar.clientWidth : null,
        toolbarWidth: toolbar ? toolbar.clientWidth : null,
        blocksWiderThanEditor: wide.length,
      };
    });
    assert(layout.pageOverflow <= 0, `page overflows sideways by ${layout.pageOverflow}px`);
    assertEqual(layout.blocksWiderThanEditor, 0, 'blocks wider than the editor');
    await shot(page, `responsive-${width}`);
    // Scroll the table and the code block into view for a second picture.
    await content(page, 'editor').locator('table').scrollIntoViewIfNeeded();
    await shot(page, `responsive-${width}-table`);
    await content(page, 'editor').locator('.rd-code').scrollIntoViewIfNeeded();
    await shot(page, `responsive-${width}-code`);
    clean(session);
    await session.close();
    return `no sideways page overflow; toolbar ${layout.toolbarWidth}px wide, scrolls inside itself: ${layout.toolbarScrolls}`;
  });
}

await check('mobile-wide-content', async () => {
  const session = await open({
    kind: 'empty',
    panes: 'editor',
    viewport: { width: 360, height: 740 },
  });
  const { page } = session;
  await content(page, 'editor').click();
  await page.evaluate((selector) => {
    const editor = document.querySelector(selector).editor;
    editor.commands.insertTable({ rows: 2, cols: 9, withHeaderRow: true });
    // After the table, not inside its last cell.
    editor.commands.insertContentAt(editor.state.doc.content.size, [
      {
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [{ type: 'text', text: `const veryLongLine = "${'x'.repeat(220)}";` }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `https://example.com/${'long-url-segment/'.repeat(12)}` }],
      },
      {
        type: 'diagram',
        content: [
          {
            type: 'text',
            text: 'flowchart LR\n  A[Draft] --> B[Review] --> C[Legal] --> D[Approval] --> E[Publish] --> F[Archive] --> G[Audit]',
          },
        ],
      },
    ]);
  }, contentSel('editor'));
  await imagesLoaded(page, `${contentSel('editor')} .rd-diagram__image`, 1);
  await page.waitForTimeout(500);
  const layout = await page.evaluate((s) => {
    const table = document.querySelector(`${s} .tableWrapper`);
    const pre = document.querySelector(`${s} .rd-code pre`);
    const canvas = document.querySelector(`${s} .rd-diagram__canvas`);
    const topLevel = [...document.querySelector(s).children].map(
      (child) => child.localName + (child.className ? `.${child.className.split(' ')[0]}` : ''),
    );
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      tableScrolls: table.scrollWidth > table.clientWidth,
      codeScrolls: pre.scrollWidth > pre.clientWidth,
      diagramScrolls: canvas.scrollWidth > canvas.clientWidth,
      diagramWidth: Math.round(canvas.querySelector('img').getBoundingClientRect().width),
      editorOverflow:
        document.querySelector('.rd-editor__scroll').scrollWidth -
        document.querySelector('.rd-editor__scroll').clientWidth,
      topLevel,
    };
  }, contentSel('editor'));
  assert(layout.pageOverflow <= 0, 'page does not overflow');
  assert(
    layout.editorOverflow <= 0,
    `document area does not scroll sideways (${layout.editorOverflow})`,
  );
  assert(
    layout.tableScrolls && layout.codeScrolls,
    'table and code scroll inside their own blocks',
  );
  assert(
    layout.diagramScrolls,
    `a wide diagram scrolls inside its own block (${layout.diagramWidth}px)`,
  );
  assert(layout.topLevel.length >= 4, `blocks follow the table: ${layout.topLevel.join(', ')}`);
  await shot(page, 'mobile-wide-content');
  await content(page, 'editor').locator('.rd-diagram').scrollIntoViewIfNeeded();
  await shot(page, 'mobile-wide-diagram');
  clean(session);
  await session.close();
  return `a 9-column table, a 240-character code line and a ${layout.diagramWidth}px diagram scroll in their own blocks at 360px`;
});

await check('keyboard-and-shortcuts', async () => {
  const session = await open({ kind: 'empty', panes: 'editor' });
  const { page } = session;
  await content(page, 'editor').click();
  await page.keyboard.type('Keyboard');
  await page.keyboard.press('Alt+F10');
  const inToolbar = () =>
    page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="rd-toolbar"]')));
  assert(await inToolbar(), 'Alt+F10 moves focus to the toolbar');
  const first = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await page.keyboard.press('ArrowRight');
  const second = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  assert(first !== second && (await inToolbar()), 'arrow keys move between controls');
  const hint = async (target) => {
    await target.page.locator('[data-testid="rd-tool-bold"]').hover();
    const tip = target.page.locator('[role="tooltip"]', { hasText: 'Bold' });
    await tip.waitFor();
    return tip.innerText();
  };
  // The hint names the modifier ProseMirror binds `Mod-` to in this browser.
  const here = await hint(session);
  const expected = session.mod === 'Meta' ? '⌘B' : 'Ctrl+B';
  assert(here.includes(expected), `hint for ${session.mod} on this platform: ${here}`);
  // ... and that key really toggles bold.
  await content(page, 'editor').click();
  await page.keyboard.press(`${session.mod}+a`);
  await page.keyboard.press(`${session.mod}+b`);
  await content(page, 'editor').locator('strong', { hasText: 'Keyboard' }).waitFor();
  await session.close();
  const mac = await open({
    kind: 'empty',
    panes: 'editor',
    init: () => {
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    },
  });
  const there = await hint(mac);
  assert(there.includes('⌘B'), `Command hint on macOS: ${there}`);
  await mac.close();
  return `toolbar reachable by keyboard (${first} → ${second}); hints: "${here.replace(/\s+/g, ' ')}" / "${there.replace(/\s+/g, ' ')}"`;
});

await check('typing-performance', async () => {
  const session = await open({ kind: 'long', query: '&strict=0' });
  const { page } = session;
  await content(page, 'editor').locator('p', { hasText: 'Filler paragraph 20.' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' warm up');
  await waitSaved(page, 'editor');
  await page.waitForTimeout(500);
  await page
    .evaluate(() => {
      window.__events = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'keydown' || entry.name === 'beforeinput' || entry.name === 'input') {
            window.__events.push(entry.processingEnd - entry.processingStart);
          }
        }
      }).observe({ type: 'event', durationThreshold: 0, buffered: false });
    })
    .catch(() => {});
  const before = await page.evaluate(() => ({ ...window.__rd.commits }));
  const text = ' the quick brown fox jumps over the lazy dog again and again';
  await page.keyboard.type(text, { delay: 15 });
  await waitSaved(page, 'editor');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ ...window.__rd.commits }));
  const delta = (id) => (after[id] ?? 0) - (before[id] ?? 0);
  const timings = await page.evaluate(() => window.__events ?? []);
  timings.sort((a, b) => a - b);
  const at = (q) =>
    timings.length
      ? timings[Math.min(timings.length - 1, Math.floor(q * timings.length))].toFixed(1)
      : 'n/a';
  const summary = {
    keystrokes: text.length,
    editorCommits: delta('editor:editor'),
    viewerCommits: delta('editor:viewer'),
    statusCommits: delta('status:editor'),
    handlerMs: { samples: timings.length, p50: at(0.5), p95: at(0.95), max: at(0.999) },
  };
  notes.typing = summary;
  assertEqual(
    summary.editorCommits,
    0,
    'React commits inside DocumentEditor while typing plain text',
  );
  assertEqual(summary.viewerCommits, 0, 'React commits inside the viewer while receiving text');
  await session.close();
  return `${text.length} keystrokes in a 60-block document: ${summary.editorCommits} React commits in the editor, ${summary.viewerCommits} in the viewer, ${summary.statusCommits} in the status indicator; input handlers p50 ${at(0.5)}ms, p95 ${at(0.95)}ms, max ${at(0.999)}ms (${timings.length} events)`;
});

await check('print-view', async () => {
  const session = await open({ query: '&static=1&theme=light' });
  const { page } = session;
  await page.waitForSelector('[data-testid="rd-static-content"] .rd-diagram__image', {
    timeout: 20000,
  });
  await page.waitForSelector('[data-testid="rd-static-content"] .hljs-string', { timeout: 15000 });
  assertEqual(
    await page.locator('[data-testid="rd-static-content"]').getAttribute('contenteditable'),
    'false',
    'static',
  );
  await page.screenshot({ path: path.join(OUT, `${BROWSER}-static-screen.png`), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  const print = await page.evaluate(() => ({
    actions: getComputedStyle(document.querySelector('.rd-block-bar__actions')).display,
    codeWrap: getComputedStyle(document.querySelector('.rd-code__pre')).whiteSpace,
    background: getComputedStyle(document.querySelector('.rd-editor')).backgroundColor,
    color: getComputedStyle(document.querySelector('.rd-doc')).color,
  }));
  assertEqual([print.actions, print.codeWrap], ['none', 'pre-wrap'], 'print rules');
  await page.screenshot({ path: path.join(OUT, `${BROWSER}-static-print.png`), fullPage: true });
  clean(session);
  await session.close();
  return `static renderer shows diagram and highlighted code; print: controls hidden, code wraps, ${print.color} on ${print.background}`;
});

await check('themes', async () => {
  const light = await open({ query: '&theme=light' });
  await light.page.waitForSelector(`${contentSel('editor')} .rd-diagram__image`);
  await light.page.waitForTimeout(500);
  await shot(light.page, 'theme-light');
  await content(light.page, 'editor').locator('.rd-diagram').scrollIntoViewIfNeeded();
  await shot(light.page, 'theme-light-diagram');
  await light.close();
  const panel = await open({
    query: '&variant=panel&tone=dark&scale=1.25&width=narrow',
    viewport: { width: 720, height: 460 },
    panes: 'viewer',
  });
  await panel.page.waitForTimeout(500);
  await shot(panel.page, 'panel-720x460');
  const size = await panel.page.evaluate(
    (s) => Number.parseFloat(getComputedStyle(document.querySelector(s)).fontSize),
    contentSel('viewer'),
  );
  assert(Math.abs(size - 20) < 0.6, `font scale applied (${size}px)`);
  await panel.close();
  return `light theme and compact panel rendered; font scale 1.25 gives ${size}px`;
});

await check('malicious-corpus', async () => {
  const session = await open({ kind: 'empty', panes: 'editor' });
  const { page } = session;
  const failures = [];
  for (const entry of MALICIOUS_CORPUS) {
    const verdict = await page.evaluate((html) => {
      const result = window.__rd.processPaste(html);
      if (result.html === null) return { ok: false, why: 'pipeline refused HTML' };
      const doc = new DOMParser().parseFromString(result.html, 'text/html');
      const banned = [
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'style',
        'link',
        'meta',
        'base',
        'svg',
        'math',
        'video',
        'audio',
        'template',
      ];
      for (const element of doc.body.querySelectorAll('*')) {
        if (banned.includes(element.localName))
          return { ok: false, why: `element ${element.localName}` };
        for (const attribute of element.attributes) {
          if (attribute.name.startsWith('on'))
            return { ok: false, why: `attribute ${attribute.name}` };
          if (
            ['src', 'srcset', 'action', 'formaction', 'background', 'ping'].includes(attribute.name)
          ) {
            return { ok: false, why: `attribute ${attribute.name}` };
          }
          if (
            /javascript:|vbscript:|data:text\/html|expression\s*\(|url\s*\(/i.test(attribute.value)
          ) {
            return { ok: false, why: `value of ${attribute.name}` };
          }
        }
      }
      return { ok: true };
    }, entry.html);
    if (!verdict.ok) failures.push(`${entry.name}: ${verdict.why}`);
    // And for real, into the live editor.
    await focusEnd(page, 'editor');
    await paste(page, 'editor', { html: entry.html });
  }
  await page.waitForTimeout(800);
  assertEqual(failures, [], 'sanitized output');
  const state = await page.evaluate(() => ({
    pwned: window.__pwned ?? null,
    attrs: JSON.stringify(window.__rd.json('editor')),
    active: document.querySelectorAll(
      '[data-testid="rd-editor-content"] script, [data-testid="rd-editor-content"] iframe, [data-testid="rd-editor-content"] object, [data-testid="rd-editor-content"] [onerror], [data-testid="rd-editor-content"] [onclick]',
    ).length,
  }));
  assertEqual(
    [state.pwned, state.active],
    [null, 0],
    'nothing executed, nothing active in the DOM',
  );
  const hrefs = [...state.attrs.matchAll(/"href":"([^"]*)"/g)].map((match) => match[1]);
  assert(
    hrefs.every((href) => /^(https?:|mailto:|tel:)/.test(href)),
    `only safe link schemes: ${hrefs.join(', ')}`,
  );
  assertEqual(session.external, [], 'no request to another origin');
  const reports = await page.evaluate(() => window.__rd.violations);
  assert(onlyInlineHandlerReports(reports), `unexpected CSP reports: ${reports.join('; ')}`);
  notes.corpusInlineHandlerReports = reports.length;
  cleanExceptBlockedHandlers(session);
  await session.close();
  return `${MALICIOUS_CORPUS.length} hostile payloads sanitized by this browser's DOM and pasted into the live editor: nothing executed, no foreign request (${reports.length} inline handlers were additionally blocked and reported by the policy while the sanitizer parsed them)`;
});

await check('malicious-corpus-without-csp', async () => {
  // The same payloads on a page with NO Content-Security-Policy: the
  // sanitizers have to keep everything inert on their own.
  const session = await open({ kind: 'empty', panes: 'editor', pagePath: '/nocsp.html' });
  const { page } = session;
  assertEqual(
    await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')),
    null,
    'page has no policy',
  );
  for (const entry of MALICIOUS_CORPUS) {
    await focusEnd(page, 'editor');
    await page.keyboard.press('Enter');
    await paste(page, 'editor', { html: entry.html });
  }
  await focusEnd(page, 'editor');
  await page.evaluate((selector) => {
    document
      .querySelector(selector)
      .editor.commands.insertDiagram(
        'flowchart LR\n  A["<img src=x onerror=\'window.__pwned=1\'>label"] --> B["<script>window.__pwned=2</script>ok"]\n  click A href "javascript:window.__pwned=3" "tip"',
      );
  }, contentSel('editor'));
  const probed = await insertConfigProbeDiagrams(page, 'editor');
  notes.diagramConfigProbesWithoutCsp = probed;
  // Every link the payloads left behind has a safe scheme, and clicking it
  // (the editor shows its link popover) runs no script and opens no page.
  const hrefs = await content(page, 'editor')
    .locator('a')
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
  assert(
    hrefs.every((href) => /^(https?:|mailto:|tel:)/.test(href)),
    `only safe link schemes: ${hrefs.join(', ')}`,
  );
  const links = hrefs.length;
  await content(page, 'editor')
    .locator('a')
    .evaluateAll((anchors) => {
      for (const anchor of anchors) anchor.click();
    });
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    pwned: window.__pwned ?? null,
    violations: window.__rd.violations.length,
  }));
  assertEqual([state.pwned, state.violations], [null, 0], 'nothing executed without a policy');
  assertEqual(session.context.pages().length, 1, 'no page opened by a link click');
  assertEqual(session.external, [], 'no request to another origin');
  clean(session);
  await session.close();
  return `no policy on the page: ${MALICIOUS_CORPUS.length} payloads pasted and ${probed.length + 1} hostile diagrams inserted, ${links} link(s) left (all http/https/mailto/tel) and clicked, nothing executed, no dialog, no console error, no foreign request`;
});

await check('hostile-attributes', async () => {
  // Attribute values written by another client (no parse rule of this editor
  // is involved): they must not become CSS, URLs or markup in anyone's page.
  // Run without a policy, so a remote fetch would not be blocked for us.
  const session = await open({ kind: 'empty', panes: 'editor,viewer', pagePath: '/nocsp.html' });
  const { page } = session;
  const injection =
    '1; position: fixed; inset: 0; z-index: 99999; background-image: url(http://127.0.0.1:4421/rd-leak-attr.png)';
  await page.evaluate(
    ({ selector, css }) => {
      const editor = document.querySelector(selector).editor;
      const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
      editor.commands.insertContentAt(editor.state.doc.content.size, [
        {
          type: 'paragraph',
          attrs: { lineHeight: css, indent: '2em; position: fixed', textAlign: `center; ${css}` },
          content: [
            text('hostile paragraph '),
            text('coloured', [
              {
                type: 'textStyle',
                attrs: { color: `red; ${css}`, fontSize: '12px; position: fixed' },
              },
            ]),
            text(' marked', [{ type: 'highlight', attrs: { color: `#ffff00; ${css}` } }]),
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: [`120px; ${css}`] },
                  content: [{ type: 'paragraph', content: [text('cell')] }],
                },
              ],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: '"><img src=x onerror="window.__pwned=1">' },
          content: [text('code')],
        },
        {
          type: 'image',
          attrs: {
            assetId: '../../../../control?rd-leak-traversal=1',
            alt: '"><script>window.__pwned=2</script>',
            caption: '<img src=x onerror="window.__pwned=3">',
            width: '50%; position: fixed',
            align: 'left" onmouseover="window.__pwned=4',
            name: 'hostile.png',
          },
        },
        {
          type: 'attachment',
          attrs: {
            assetId: 'javascript:window.__pwned=5',
            name: 'hostile.pdf',
            sizeBytes: '1; x',
            mime: 'text/html',
          },
        },
        {
          type: 'image',
          attrs: { uploadId: '../../x', name: 'hostile-upload.png' },
        },
        { type: 'paragraph', content: [text('end of hostile content')] },
      ]);
    },
    { selector: contentSel('editor'), css: injection },
  );
  await content(page, 'viewer').locator('p', { hasText: 'end of hostile content' }).waitFor();
  await page.waitForTimeout(1200);

  for (const name of ['editor', 'viewer']) {
    const verdict = await page.evaluate((s) => {
      const root = document.querySelector(s);
      const bad = [];
      for (const element of root.querySelectorAll('*')) {
        const inline = element.getAttribute('style') ?? '';
        if (/position\s*:|inset\s*:|url\s*\(|z-index/i.test(inline))
          bad.push(`style="${inline.slice(0, 80)}"`);
        const computed = getComputedStyle(element);
        if (computed.position === 'fixed') bad.push(`${element.localName} is position: fixed`);
        if (computed.backgroundImage.includes('rd-leak'))
          bad.push(`${element.localName} has a remote background`);
        for (const attribute of element.attributes) {
          if (attribute.name.startsWith('on')) bad.push(`attribute ${attribute.name}`);
        }
        if (element.localName === 'script') bad.push('script element');
      }
      const sources = [...root.querySelectorAll('img')].map(
        (image) => image.getAttribute('src') ?? '',
      );
      const links = [...root.querySelectorAll('a')].map(
        (anchor) => anchor.getAttribute('href') ?? '',
      );
      return {
        bad,
        sources: sources.filter((source) => !source.startsWith('data:')),
        links,
        text: root.textContent,
        unavailable: root.querySelectorAll('.rd-image__missing').length,
        pwned: window.__pwned ?? null,
      };
    }, contentSel(name));
    assertEqual(verdict.bad, [], `${name}: nothing injected into styles, handlers or elements`);
    assertEqual(verdict.pwned, null, `${name}: nothing executed`);
    assertEqual(verdict.sources, [], `${name}: no image request built from a hostile id`);
    assert(
      verdict.links.every((href) => !/javascript:|rd-leak/i.test(href)),
      `${name}: no link built from a hostile id (${verdict.links.join(', ')})`,
    );
    assertEqual(verdict.unavailable, 2, `${name}: both hostile images are shown as unavailable`);
    assert(
      verdict.text.includes('hostile paragraph coloured marked'),
      `${name}: the text is still readable`,
    );
    assert(verdict.text.includes('hostile.pdf'), `${name}: the attachment is listed by name`);
  }
  const leaked = session.requests.filter((url) => /rd-leak/.test(url));
  assertEqual(leaked, [], 'no request built from an attribute value');
  assertEqual(session.external, [], 'no request to another origin');
  clean(session);
  await shot(page, 'hostile-attributes');
  await session.close();
  return 'hostile line height, indent, alignment, colours, column width, language, asset and upload ids arrived through Yjs: no injected CSS, no handler, no request, nothing executed (editor and viewer, no policy on the page)';
});

// ── Callout toolbar, copy link, copy code, cancelled uploads ────────────────

await check('callout-toolbar', async () => {
  const session = await open({ kind: 'empty', panes: 'editor,viewer' });
  const { page, mod } = session;
  const viewerCallouts = () => content(page, 'viewer').locator('div[data-type="callout"]');
  const callouts = async () => findNodes(await json(page, 'editor'), 'callout');
  const trigger = pane(page, 'editor').locator('[data-testid="rd-tool-callout"]');
  await content(page, 'editor').click();
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Beta');
  await waitSaved(page, 'editor');

  // No native <select> popup for the callout: a DOM menu with menuitem roles.
  // The toolbar recomputes its state on the next animation frame after a transaction, so a
  // read right after an action (or after waiting on the other pane) can still see the old
  // value. Wait up to 3 s for the expected value, then assert it.
  const pressedSettles = async (expected) => {
    for (let i = 0; i < 30 && (await trigger.getAttribute('aria-pressed')) !== expected; i += 1) {
      await page.waitForTimeout(100);
    }
    return trigger.getAttribute('aria-pressed');
  };
  assertEqual(await pressedSettles('false'), 'false', 'inactive outside a callout');
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Callout' });
  await menu.waitFor();
  assertEqual(
    await menu.getByRole('menuitemcheckbox').allInnerTexts(),
    ['Note', 'Tip', 'Success', 'Warning', 'Danger'],
    'one short label per variant',
  );
  await page.locator('[data-testid="rd-callout-tip"]').click();
  await viewerCallouts().locator('p', { hasText: 'Beta' }).waitFor();
  assertEqual(
    (await callouts()).map((node) => [node.attrs.variant, node.content.length]),
    [['tip', 1]],
    'the current block only is wrapped',
  );
  assertEqual(await pressedSettles('true'), 'true', 'active inside a callout');
  assertEqual(await viewerCallouts().getAttribute('data-variant'), 'tip', 'variant in viewer');
  // The label inside the box is CSS text from the variant; no style attribute carries the variant.
  const label = await viewerCallouts().evaluate((element) => ({
    text: getComputedStyle(element, '::before').content,
    style: element.getAttribute('style'),
  }));
  assertEqual(label, { text: '"Tip"', style: null }, 'CSS label, no style attribute');
  await editorFocused(page, 'editor');
  await shot(page, 'callout-tip');

  // Change the variant with the mouse, then with the keyboard.
  await waitSaved(page, 'editor');
  await trigger.click();
  assertEqual(
    await page.locator('[data-testid="rd-callout-tip"]').getAttribute('aria-checked'),
    'true',
    'current variant ticked',
  );
  await page.locator('[data-testid="rd-callout-warning"]').click();
  await viewerCallouts().and(page.locator('[data-variant="warning"]')).waitFor();
  assertEqual(
    await viewerCallouts().evaluate((element) => getComputedStyle(element, '::before').content),
    '"Warning"',
    'label follows the variant',
  );
  await editorFocused(page, 'editor');
  // WebKit can take the first key press before it routes keys to the just-focused editor; then
  // the arrows would move the text cursor instead. Wait until focus is really in the toolbar
  // (one more Alt+F10 at most), then walk it with the arrow keys.
  const toolbarFocused = () =>
    page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="rd-toolbar"]')));
  for (let attempt = 0; attempt < 2 && !(await toolbarFocused()); attempt += 1) {
    await page.keyboard.press('Alt+F10');
    for (let i = 0; i < 20 && !(await toolbarFocused()); i += 1) await page.waitForTimeout(50);
  }
  assert(await toolbarFocused(), 'Alt+F10 moves focus into the toolbar');
  let reached = false;
  for (let step = 0; step < 60 && !reached; step += 1) {
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') === 'rd-tool-callout',
    );
    if (!reached) await page.keyboard.press('ArrowRight');
  }
  assert(reached, 'the callout control is reachable with the arrow keys of the toolbar');
  await page.keyboard.press('Enter');
  await menu.waitFor();
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  for (let step = 0; step < 8 && (await active()) !== 'rd-callout-danger'; step += 1) {
    await page.keyboard.press('ArrowDown');
  }
  assertEqual(await active(), 'rd-callout-danger', 'arrow keys reach the item');
  await page.keyboard.press('Enter');
  await viewerCallouts()
    .and(page.locator('[data-variant="danger"]'))
    .waitFor({ timeout: 5000 })
    .catch(async (error) => {
      throw new Error(`${error.message}; doc ${JSON.stringify(await json(page, 'editor'))}`);
    });
  await editorFocused(page, 'editor');

  // Remove: the content stays, the box goes; undo brings it back, redo removes it again.
  // (The undo manager merges steps closer than 500 ms: let the variant change settle first.)
  await waitSaved(page, 'editor');
  await page.waitForTimeout(700);
  await trigger.click();
  await page.locator('[data-testid="rd-callout-remove"]').click();
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} div[data-type="callout"]`).length === 0,
    contentSel('viewer'),
  );
  assertEqual(
    blocks(await json(page, 'editor')).map((block) => block.text),
    ['Alpha', 'Beta'],
    'text kept after removing the callout',
  );
  assertEqual(await pressedSettles('false'), 'false', 'inactive again');
  await editorFocused(page, 'editor');
  await page.keyboard.press(`${mod}+z`);
  await viewerCallouts().and(page.locator('[data-variant="danger"]')).waitFor();
  await page.keyboard.press(`${mod}+Shift+z`);
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} div[data-type="callout"]`).length === 0,
    contentSel('viewer'),
  );
  await page.keyboard.press(`${mod}+z`);
  await viewerCallouts().waitFor();

  // A viewer has no editing control at all.
  assertEqual(
    await pane(page, 'viewer').locator('[data-testid="rd-tool-callout"]').count(),
    0,
    'viewer',
  );
  assertEqual(
    await pane(page, 'viewer').locator('[data-testid="rd-toolbar"]').count(),
    0,
    'viewer',
  );
  await waitSaved(page, 'editor');
  clean(session);
  await session.close();
  return 'insert (current block), change variant (mouse + keyboard), remove, undo/redo; CSS label; viewer has no control';
});

await check('copy-link', async () => {
  const session = await open({
    kind: 'empty',
    panes: 'editor',
    contextOptions:
      BROWSER === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {},
  });
  const { page, mod } = session;
  const href = 'https://example.com/plan?a=1&b=2#part';
  await content(page, 'editor').click();
  await page.keyboard.type('Read the plan');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+k`);
  await page.locator('[data-testid="rd-link-input"]').fill(href);
  await page.locator('[data-testid="rd-link-apply"]').click();
  const anchor = content(page, 'editor').locator('a').first();
  await anchor.waitFor();
  // A new link has nothing to copy yet; an existing one is opened in the editor with Copy link.
  await anchor.click();
  const copy = page.locator('[data-testid="rd-link-copy"]');
  await copy.waitFor();
  assertEqual(await copy.innerText(), 'Copy link', 'label before copying');
  await copy.click();
  await page.getByRole('button', { name: 'Copied' }).waitFor();
  let how = 'button confirmed the copy';
  if (BROWSER === 'chromium') {
    assertEqual(await page.evaluate(() => navigator.clipboard.readText()), href, 'clipboard text');
    how = 'clipboard text equals the address';
  }
  // Paste it back into a new paragraph with the real shortcut: the address, as text.
  await page.keyboard.press('Escape');
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`${mod}+v`);
  const texts = async () => blocks(await json(page, 'editor')).map((block) => block.text);
  await page
    .waitForFunction(
      (expected) => JSON.stringify(window.__rd.json('editor')).includes(expected),
      JSON.stringify(href).slice(1, -1),
      { timeout: 6000 },
    )
    .catch(() => {});
  const pasted = (await texts()).some((text) => text === href);
  if (BROWSER === 'chromium') assert(pasted, 'pasted text is the copied address');
  // The popover never copies an unsafe address: the field is validated first.
  await anchor.click();
  await copy.waitFor();
  await page.locator('[data-testid="rd-link-input"]').fill('javascript:alert(1)');
  assert(await copy.isDisabled(), 'Copy link disabled for an unsafe address');
  assertEqual(session.problems, [], 'console errors / dialogs');
  await session.close();
  return `${how}; ${pasted ? 'pasted back as text' : 'paste-back not observable here'}; disabled for javascript:`;
});

await check('copy-code', async () => {
  const session = await open({
    panes: 'editor,viewer',
    contextOptions:
      BROWSER === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {},
  });
  const { page, mod } = session;
  const code = content(page, 'viewer').locator('.rd-code');
  await code.scrollIntoViewIfNeeded();
  const source = (await code.locator('pre').innerText()).replace(/\r/g, '');
  // The Copy button is there for a reader who cannot edit, too.
  await code.getByRole('button', { name: 'Copy' }).click();
  await code.getByRole('button', { name: 'Copied' }).waitFor();
  await focusEnd(page, 'editor');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`${mod}+v`);
  const wanted = source.split('\n').filter((line) => line.trim() !== '');
  const landed = await page
    .waitForFunction(
      (lines) => {
        const text = JSON.stringify(window.__rd.json('editor'));
        return lines.every((line) => text.includes(JSON.stringify(line).slice(1, -1)));
      },
      wanted,
      { timeout: 6000 },
    )
    .then(() => true)
    .catch(() => false);
  assert(landed, 'every line of the code block arrived in the pasted text');
  assertEqual(session.problems, [], 'console errors / dialogs');
  await session.close();
  return `viewer's Copy button: ${wanted.length} lines pasted back unchanged`;
});

await check('upload-cancel', async () => {
  const session = await open({ kind: 'empty', panes: 'editor,editor2' });
  const { page, mod } = session;
  const placeholders = (name) =>
    content(page, name).locator('[data-testid="rd-upload-placeholder"]');
  const uploadNodes = async (name) =>
    findNodes(await json(page, name), 'image').concat(
      findNodes(await json(page, name), 'attachment'),
    );
  await content(page, 'editor').click();
  await page.keyboard.type('Cancel');
  await waitSaved(page, 'editor');
  // Five files, three at a time: two are still waiting in the queue.
  const names = ['c1.png', 'c2.png', 'c3.png', 'c4.png', 'c5.png'];
  for (const name of names)
    await control(page, { action: 'uploadDelay', filename: name, ms: 8000 });
  await paste(page, 'editor', {
    files: names.map((name) => ({ name, type: 'image/png', base64: RED })),
  });
  await page.waitForFunction(
    (s) => document.querySelectorAll(`${s} [data-testid="rd-upload-placeholder"]`).length === 5,
    contentSel('editor'),
  );
  const queued = placeholders('editor').filter({ hasText: 'Waiting' });
  assert((await queued.count()) >= 1, 'a file waits in the queue');
  // Cancel a waiting one and an active one; the other three finish.
  await queued.last().getByRole('button', { name: 'Cancel' }).click();
  await placeholders('editor')
    .filter({ hasNotText: 'Waiting' })
    .filter({ has: page.getByRole('button', { name: 'Cancel' }) })
    .first()
    .getByRole('button', { name: 'Cancel' })
    .click({ timeout: 5000 })
    .catch(async (error) => {
      throw new Error(
        `${error.message}; placeholders: ${JSON.stringify(await placeholders('editor').allInnerTexts())}`,
      );
    });
  for (const name of ['editor', 'editor2']) {
    await page.waitForFunction(
      (s) => document.querySelectorAll(`${s} [data-testid="rd-upload-placeholder"]`).length <= 3,
      contentSel(name),
    );
  }
  // Let the rest finish: afterwards exactly the uncancelled files are in the document, all with an asset.
  await page.waitForFunction(
    (n) => {
      const images = [];
      const walk = (node) => {
        if (node.type === 'image') images.push(node.attrs);
        for (const child of node.content ?? []) walk(child);
      };
      walk(window.__rd.json(n));
      return images.length === 3 && images.every((image) => image.assetId && !image.uploadId);
    },
    'editor2',
    { timeout: 30000 },
  );
  await page.waitForTimeout(3000);
  assertEqual(
    [(await uploadNodes('editor')).length, (await uploadNodes('editor2')).length],
    [3, 3],
    'only the three uncancelled files, in both panes',
  );
  assertEqual(await placeholders('editor').count(), 0, 'no placeholder left');
  // Undo takes the images back out; nothing that was cancelled comes back.
  const imagesLeft = async () => (await uploadNodes('editor')).length;
  for (let step = 0; step < 6 && (await imagesLeft()) > 0; step += 1) {
    await content(page, 'editor').focus();
    await page.keyboard.press(`${mod}+z`);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  assertEqual(
    [
      await imagesLeft(),
      (await uploadNodes('editor2')).length,
      await placeholders('editor').count(),
    ],
    [0, 0, 0],
    'undo leaves no image, no placeholder',
  );
  assert(!JSON.stringify(await json(page, 'editor2')).includes('uploadId'), 'no upload id left');
  assertEqual(
    session.problems.filter((problem) => !problem.includes('503')),
    [],
    'console errors / dialogs',
  );
  await session.close();
  return 'queued and active uploads cancelled: placeholders vanished in both panes, only the other three arrived, undo leaves no image and no placeholder';
});

// ── Page settings, page surface and ruler ───────────────────────────────────

const WIDE_2 = { width: 2800, height: 900 };
const pageSel = (name) => `${paneSel(name)} .rd-editor__page`;
const rulerSel = (name) => `${paneSel(name)} [data-testid="rd-ruler"]`;
const handleSel = (name, side) => `${paneSel(name)} [data-testid="rd-ruler-${side}"]`;
const pageMapOf = (page, name) =>
  page.evaluate((n) => window.__rd.panes[n].session.ydoc.getMap('page').toJSON(), name);
const pageBox = (page, name) =>
  page.evaluate((selector) => {
    const element = document.querySelector(selector);
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      left: rect.left,
      top: rect.top,
      pl: parseFloat(style.paddingLeft),
      pr: parseFloat(style.paddingRight),
      pt: parseFloat(style.paddingTop),
      pb: parseFloat(style.paddingBottom),
      background: style.backgroundColor,
    };
  }, pageSel(name));
const near = (actual, expected, tolerance, message) =>
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ±${tolerance}, got ${actual}`,
  );
/** Number of undo steps the editor pane's own undo manager holds. */
const undoDepth = (page, name) =>
  page.evaluate((n) => {
    const view = document.querySelector(`[data-pane="${n}"] [data-testid="rd-editor-content"]`)
      .editor.view;
    const plugin = view.state.plugins.find((p) => p.key?.startsWith?.('y-undo'));
    return plugin?.getState(view.state)?.undoManager.undoStack.length ?? -1;
  }, name);

await check('page-surface', async () => {
  const session = await open({ panes: 'editor,viewer', viewport: WIDE_2 });
  const { page } = session;
  // The whole sheet and ruler are drawn for the editor; a read-only viewer gets the sheet only.
  const editor = await pageBox(page, 'editor');
  near(editor.width, 793.7 + 0, 3, 'A4 width in CSS px');
  near(editor.pl, 96, 1.5, 'left margin 25.4 mm = 96 px');
  near(editor.pt, 96, 1.5, 'top margin');
  assert((await page.locator(rulerSel('editor')).count()) === 1, 'the editor has a ruler');
  assert((await page.locator(rulerSel('viewer')).count()) === 0, 'a viewer has no ruler');
  assertEqual(
    await page.locator(`${paneSel('editor')} [data-testid="rd-ruler"] [role="slider"]`).count(),
    2,
    'two margin markers',
  );
  const left = page.locator(handleSel('editor', 'left'));
  assertEqual(
    [
      await left.getAttribute('aria-valuenow'),
      await left.getAttribute('aria-valuemin'),
      await left.getAttribute('aria-valuetext'),
      await left.getAttribute('aria-label'),
    ],
    ['25.4', '0', '25.4 mm', 'Left margin'],
    'slider semantics',
  );
  // Ruler and page share one left edge and one width.
  const ruler = await page.evaluate(
    (s) => document.querySelector(s).getBoundingClientRect().toJSON(),
    rulerSel('editor'),
  );
  near(ruler.width, editor.width, 1, 'ruler as wide as the page');
  near(ruler.left, editor.left, 1, 'ruler aligned with the page');
  const viewer = await pageBox(page, 'viewer');
  near(viewer.width, 793.7, 3, 'viewer page width');
  // A long document makes the sheet grow with it: the sheet always contains its text.
  const longSession = await open({
    panes: 'editor',
    kind: 'long',
    viewport: { width: 1280, height: 860 },
  });
  const contained = await longSession.page.evaluate((selector) => {
    const sheet = document.querySelector(selector);
    const text = sheet.querySelector('.ProseMirror').getBoundingClientRect();
    return { sheet: sheet.getBoundingClientRect().bottom, text: text.bottom, tall: text.height };
  }, pageSel('editor'));
  assert(contained.tall > 2000, 'the long document is long');
  assert(
    contained.sheet >= contained.text,
    `sheet contains its text (${JSON.stringify(contained)})`,
  );
  await longSession.close();
  await shot(page, 'page-surface');
  assertEqual(await page.evaluate(() => window.__rd.violations), [], 'no CSP violations');
  assertEqual(session.problems, [], 'console errors');
  await session.close();
  return `A4 sheet ${Math.round(editor.width)} px wide with 96 px margins, ruler aligned, no ruler for the viewer`;
});

await check('ruler-drag', async () => {
  const session = await open({
    panes: 'editor,editor2,viewer',
    viewport: { width: 3000, height: 900 },
  });
  const { page } = session;
  assertEqual(await pageMapOf(page, 'editor'), {}, 'fresh document has no page settings');
  const handle = page.locator(handleSel('editor', 'left'));
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const before = await undoDepth(page, 'editor');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 4 });
  await page.mouse.move(x + 60, y, { steps: 6 });
  // While the button is down: local preview and a tooltip, nothing shared yet.
  const tip = await page.locator(`${paneSel('editor')} [data-testid="rd-ruler-tip"]`).textContent();
  assert(/^\d+(\.\d)? mm$/.test(tip ?? ''), `tooltip shows the measurement (${tip})`);
  const live = await pageBox(page, 'editor');
  near(live.pl, 96 + 60, 6, 'the text area follows the pointer');
  assertEqual(await pageMapOf(page, 'editor'), {}, 'nothing is written while dragging');
  assertEqual(await pageMapOf(page, 'viewer'), {}, 'nothing reached the viewer');
  await page.mouse.up();
  await page.waitForFunction(
    (n) => window.__rd.panes[n].session.ydoc.getMap('page').get('marginLeft') !== undefined,
    'viewer',
  );
  const stored = await pageMapOf(page, 'editor');
  const keys = Object.keys(stored);
  assertEqual(keys, ['marginLeft'], 'only the dragged margin is written');
  near(stored.marginLeft, 25.4 + 60 / (793.7 / 210), 1.2, 'dragged margin in mm');
  assert(
    Number.isInteger(stored.marginLeft),
    `snapped to a whole millimetre (${stored.marginLeft})`,
  );
  assertEqual(await undoDepth(page, 'editor'), before + 1, 'one drag is one undo step');
  assertEqual(
    (await pageMapOf(page, 'editor2')).marginLeft,
    stored.marginLeft,
    'the second editor has the same margin',
  );
  const viewerBox = await pageBox(page, 'viewer');
  near(viewerBox.pl, (stored.marginLeft * 96) / 25.4, 1.5, 'the viewer renders the new margin');
  // Escape cancels a drag.
  const box2 = await handle.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + 80, box2.y + 5, { steps: 5 });
  await handle.press('Escape');
  await page.mouse.up();
  assertEqual((await pageMapOf(page, 'editor')).marginLeft, stored.marginLeft, 'Escape cancelled');
  near(
    (await pageBox(page, 'editor')).pl,
    (stored.marginLeft * 96) / 25.4,
    1.5,
    'preview reverted',
  );
  await shot(page, 'ruler-drag');
  assertEqual(session.problems, [], 'console errors');
  await session.close();
  return `dragged left margin to ${stored.marginLeft} mm: preview locally, one write on release, synced to 2 clients, one undo step`;
});

await check('ruler-keyboard', async () => {
  const session = await open({ panes: 'editor,viewer', viewport: WIDE_2 });
  const { page } = session;
  const left = page.locator(handleSel('editor', 'left'));
  const right = page.locator(handleSel('editor', 'right'));
  const value = async (handle) => Number(await handle.getAttribute('aria-valuenow'));
  await left.focus();
  await page.keyboard.press('ArrowRight');
  assertEqual(await value(left), 26, 'one step right: 25.4 snaps to 26 mm');
  await page.keyboard.press('ArrowRight');
  assertEqual(await value(left), 27, 'next step');
  await page.keyboard.press('Shift+ArrowRight');
  assertEqual(await value(left), 37, 'Shift = ten steps');
  await page.keyboard.press('ArrowLeft');
  assertEqual(await value(left), 36, 'ArrowLeft');
  await page.keyboard.press('Home');
  assertEqual(await value(left), 0, 'Home = smallest margin');
  await page.keyboard.press('ArrowLeft');
  assertEqual(await value(left), 0, 'not below zero');
  await page.keyboard.press('End');
  // 210 mm paper, 25.4 mm on the other side, 50 mm of text kept.
  assertEqual(await value(left), 100, 'End = largest margin (100 mm)');
  assertEqual(await left.getAttribute('aria-valuemax'), '100', 'valuemax');
  // With a wide opposite margin the text area limit applies instead.
  assertEqual(
    await right.getAttribute('aria-valuemax'),
    '60',
    'right valuemax leaves 50 mm of text',
  );
  await right.focus();
  await page.keyboard.press('End');
  assertEqual(await value(right), 60, 'minimum text width enforced');
  await page.keyboard.press('ArrowLeft');
  assertEqual(await value(right), 60, 'cannot grow past the limit');
  await page.keyboard.press('Home');
  assertEqual(await value(right), 0, 'right Home');
  // The right marker moves with the arrows: Right makes its margin smaller.
  await right.focus();
  await page.keyboard.press('ArrowRight');
  assertEqual(await value(right), 0, 'right marker, ArrowRight shrinks the margin (not below 0)');
  await page.keyboard.press('ArrowLeft');
  assertEqual(await value(right), 1, 'ArrowLeft grows the right margin');
  await page.keyboard.press('ArrowUp');
  assertEqual(await right.getAttribute('aria-valuetext'), '2 mm', 'ArrowUp raises the margin');
  await page.waitForFunction(
    () => window.__rd.panes.viewer.session.ydoc.getMap('page').get('marginLeft') === 100,
  );
  const viewerBox = await pageBox(page, 'viewer');
  near(viewerBox.pl, (100 * 96) / 25.4, 1.5, 'viewer follows');
  // Inches: sixteenths.
  await page.evaluate(() => window.__rd.panes.editor.session.ydoc.getMap('page').set('unit', 'in'));
  await page.waitForFunction(
    (selector) => document.querySelector(selector).getAttribute('data-unit') === 'in',
    rulerSel('editor'),
  );
  await left.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assertEqual(await value(left), 1.6, '1/16 in = 1.6 mm');
  assertEqual(await left.getAttribute('aria-valuetext'), '0.06 in', 'valuetext in inches');
  await page.keyboard.press('Shift+ArrowRight');
  assertEqual(await left.getAttribute('aria-valuetext'), '0.69 in', 'ten more sixteenths');
  assertEqual(session.problems, [], 'console errors');
  await session.close();
  return 'arrows, shift, home, end, minimum width, mm and 1/16 in steps, right marker direction, aria values';
});

await check('page-undo', async () => {
  const session = await open({ panes: 'editor,editor2', kind: 'empty', viewport: WIDE_2 });
  const { page, mod } = session;
  const left = page.locator(handleSel('editor', 'left'));
  const value = async (handle) => Number(await handle.getAttribute('aria-valuenow'));
  await focusAt(page, 'editor', 'end');
  await page.keyboard.type('Hello');
  await left.focus();
  await page.keyboard.press('Shift+ArrowRight');
  assertEqual(await value(left), 35, 'margin changed');
  // A collaborator's margin change must not be undone by this person's undo.
  await page.evaluate(() =>
    window.__rd.panes.editor2.session.ydoc.getMap('page').set('marginTop', 40),
  );
  await page.waitForFunction(
    () => window.__rd.panes.editor.session.ydoc.getMap('page').get('marginTop') === 40,
  );
  // Ctrl+Z on the marker undoes the margin, not the typing.
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction(
    () => window.__rd.panes.editor.session.ydoc.getMap('page').get('marginLeft') === undefined,
  );
  assertEqual(await value(left), 25.4, 'marginLeft back to the default');
  assertEqual((await pageMapOf(page, 'editor')).marginTop, 40, "the collaborator's change stays");
  await page.waitForFunction(
    () => window.__rd.panes.editor2.session.ydoc.getMap('page').get('marginLeft') === undefined,
  );
  assert(
    blocks(await json(page, 'editor')).some((b) => b.text.includes('Hello')),
    'the text is still there',
  );
  await page.keyboard.press(`${mod}+Shift+z`);
  assertEqual(await value(left), 35, 'redo');
  // From the document: undo steps through margin, then typing.
  await content(page, 'editor').focus();
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction(
    () => window.__rd.panes.editor.session.ydoc.getMap('page').get('marginLeft') === undefined,
  );
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction(
    (selector) => !document.querySelector(selector).textContent.includes('Hello'),
    contentSel('editor'),
  );
  assertEqual(session.problems, [], 'console errors');
  await session.close();
  return "margin change undone and redone from the ruler and from the document, in order with typing, without touching a collaborator's change";
});

await check('page-setup-dialog', async () => {
  const session = await open({ panes: 'editor,viewer', viewport: WIDE_2 });
  const { page } = session;
  await page.locator('[data-testid="rd-tool-page-setup"]').click();
  const dialog = page.locator('[data-testid="page-setup"]');
  await dialog.waitFor();
  await dialog.locator('select[data-testid="page-setup-size"]').selectOption('letter');
  await page.waitForFunction(
    () => window.__rd.panes.viewer.session.ydoc.getMap('page').get('size') === 'letter',
  );
  await dialog.locator('[data-testid="page-setup-orientation"] >> text=Landscape').click();
  await page.waitForFunction(
    () => window.__rd.panes.viewer.session.ydoc.getMap('page').get('orientation') === 'landscape',
  );
  // Letter landscape is 279.4 mm wide: the sheet and the ruler follow in both panes.
  const wide = await pageBox(page, 'editor');
  near(wide.width, (279.4 * 96) / 25.4, 3, 'Letter landscape width');
  const viewerWide = await pageBox(page, 'viewer');
  near(viewerWide.width, (279.4 * 96) / 25.4, 3, 'the viewer follows');
  // Typed margins: units, validation.
  const field = dialog.locator('[data-testid="page-setup-marginLeft"]');
  await field.fill('2.5 cm');
  await field.press('Enter');
  await page.waitForFunction(
    () => window.__rd.panes.viewer.session.ydoc.getMap('page').get('marginLeft') === 25,
  );
  await field.fill('900');
  await page.waitForTimeout(100);
  assert(
    /more than 100/.test(await dialog.textContent()),
    'validation message for an excessive margin',
  );
  await field.press('Enter');
  assertEqual((await pageMapOf(page, 'editor')).marginLeft, 25, 'invalid entry not written');
  await field.fill('abc');
  assert(/Enter a length/.test(await dialog.textContent()), 'validation message for text');
  await field.press('Tab');
  await dialog.locator('[data-testid="page-setup-unit"] >> text=Inches').click();
  await page.waitForFunction(
    () => window.__rd.panes.viewer.session.ydoc.getMap('page').get('unit') === 'in',
  );
  assertEqual(await field.inputValue(), '0.98 in', 'margin shown in inches');
  await dialog.locator('select[data-testid="page-setup-background"]').selectOption('cream');
  await page.waitForFunction(
    () => window.__rd.panes.viewer.session.ydoc.getMap('page').get('background') === 'cream',
  );
  const cream = await pageBox(page, 'viewer');
  assertEqual(cream.background, 'rgb(247, 241, 225)', 'cream paper in the viewer');
  await shot(page, 'page-setup');
  await dialog.locator('[data-testid="page-setup-reset"]').click();
  await page.waitForFunction(
    () => Object.keys(window.__rd.panes.viewer.session.ydoc.getMap('page').toJSON()).length === 0,
  );
  const reset = await pageBox(page, 'viewer');
  near(reset.width, 793.7, 3, 'back to A4 portrait');
  assertEqual(session.problems, [], 'console errors');
  await session.close();
  return 'Page setup changes size, orientation, margins (typed, validated), unit and colour live in both panes; reset empties the map';
});

await check('page-viewer-cannot-write', async () => {
  const session = await open({ panes: 'editor,viewer', viewport: WIDE_2 });
  const { page } = session;
  assertEqual(
    await page.locator('[data-pane="viewer"] [data-testid="rd-tool-page-setup"]').count(),
    0,
    'no Page setup button for a viewer',
  );
  // Even a forced local write is not accepted by the server and never reaches the editor.
  await page.evaluate(() =>
    window.__rd.panes.viewer.session.ydoc.getMap('page').set('marginLeft', 90),
  );
  await page.waitForTimeout(1500);
  assertEqual((await pageMapOf(page, 'editor')).marginLeft, undefined, 'the editor never sees it');
  await session.close();
  return 'no control for a viewer; a forced write is refused by the server';
});

await check('page-hostile-values', async () => {
  const session = await open({ panes: 'editor,viewer', viewport: WIDE_2 });
  const { page } = session;
  await page.evaluate(() => {
    const map = window.__rd.panes.editor.session.ydoc.getMap('page');
    map.set('marginLeft', 1e12);
    map.set('marginRight', 'calc(100vw)');
    map.set('size', 'url(//evil.example/x)');
    map.set('background', 'red; background-image: url(//evil.example/y)');
    map.set('marginTop', -50);
    map.set('unit', { x: 1 });
  });
  await page.waitForFunction(
    () => window.__rd.panes.viewer.session.ydoc.getMap('page').get('marginTop') === -50,
  );
  await page.waitForTimeout(300);
  const box = await pageBox(page, 'viewer');
  near(box.width, 793.7, 3, 'size falls back to A4');
  near(box.pl, (100 * 96) / 25.4, 1.5, 'huge left margin clamps to 100 mm');
  near(box.pr, 96, 1.5, 'right margin falls back');
  near(box.pt, 0, 1.5, 'negative top margin clamps to 0');
  const ruler = page.locator(handleSel('editor', 'left'));
  assertEqual(
    await ruler.getAttribute('aria-valuetext'),
    '100 mm',
    'ruler uses the normalised value',
  );
  assert(
    !(await page.evaluate(() => document.documentElement.outerHTML)).includes('evil.example'),
    'nothing hostile reached the DOM',
  );
  assertEqual(await page.evaluate(() => window.__rd.violations), [], 'no CSP violations');
  assertEqual(session.external, [], 'no external requests');
  await session.close();
  return 'out-of-range, wrong-type and CSS-looking values render as defaults or clamps; no request, no CSP violation';
});

await check('page-fit-320', async () => {
  const session = await open({
    panes: 'editor',
    viewport: { width: 320, height: 640 },
    contextOptions: { hasTouch: true },
  });
  const { page } = session;
  const metrics = () =>
    page.evaluate((selector) => {
      const scroll = document.querySelector('[data-pane="editor"] .rd-editor__scroll');
      const pageElement = document.querySelector(selector);
      const rect = pageElement.getBoundingClientRect();
      const style = getComputedStyle(pageElement);
      return {
        docScroll: document.documentElement.scrollWidth,
        scrollerOverflow: scroll.scrollWidth - scroll.clientWidth,
        left: rect.left,
        right: rect.right,
        pl: parseFloat(style.paddingLeft),
        contentWidth: rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
    }, pageSel('editor'));
  let m = await metrics();
  assert(m.docScroll <= 320, `no horizontal page scroll (${m.docScroll})`);
  assert(m.scrollerOverflow <= 0, `no horizontal scroll in the editor (${m.scrollerOverflow})`);
  assert(m.left >= 0 && m.right <= 320, `page inside the viewport (${m.left}..${m.right})`);
  // Margins scale with the sheet: 25.4/210 of the width, not 96 px.
  near(m.pl, (m.right - m.left) * (25.4 / 210), 2, 'proportional margin');
  assert(m.contentWidth > 150, `text area stays usable (${m.contentWidth})`);
  // The ruler fits too, and a marker still works by keyboard.
  const left = page.locator(handleSel('editor', 'left'));
  await left.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForFunction(
    () => window.__rd.panes.editor.session.ydoc.getMap('page').get('marginLeft') === 35,
  );
  m = await metrics();
  assert(
    m.docScroll <= 320 && m.scrollerOverflow <= 0,
    'still no horizontal scroll with a wider margin',
  );
  // Caret and selection geometry: every sampled position maps back to itself from its own coordinates.
  const roundTrip = await page.evaluate((selector) => {
    const view = document.querySelector(selector).editor.view;
    const bad = [];
    let tested = 0;
    view.state.doc.descendants((node, pos) => {
      if (!node.isText || tested > 40) return;
      for (const offset of [1, Math.floor(node.text.length / 2)]) {
        if (offset < 1 || offset >= node.text.length) continue;
        const at = pos + offset;
        const rect = view.coordsAtPos(at);
        const hit = view.posAtCoords({ left: rect.left + 0.5, top: (rect.top + rect.bottom) / 2 });
        tested += 1;
        if (!hit || Math.abs(hit.pos - at) > 1) bad.push({ at, hit: hit?.pos ?? null });
      }
    });
    return { tested, bad: bad.slice(0, 5), badCount: bad.length };
  }, contentSel('editor'));
  assert(roundTrip.tested >= 10, 'enough positions were sampled');
  assert(roundTrip.badCount <= 1, `caret coordinates round-trip (${JSON.stringify(roundTrip)})`);
  await shot(page, 'page-fit-320');
  assertEqual(session.problems, [], 'console errors');
  await session.close();
  return `320 px: sheet fills the width, margins ${m.pl.toFixed(1)} px, no horizontal scroll, ${roundTrip.tested} caret positions round-trip`;
});

await check('page-reading-layout', async () => {
  const session = await open({ panes: 'editor', query: '&variant=panel' });
  const { page } = session;
  const layout = await page.evaluate(
    (root) => {
      const element = document.querySelector(root);
      const pageElement = element.querySelector('.rd-editor__page');
      return {
        layout: element.getAttribute('data-layout'),
        maxWidth: getComputedStyle(pageElement).maxWidth,
        border: getComputedStyle(pageElement).borderTopWidth,
        ruler: element.querySelectorAll('[data-testid="rd-ruler"]').length,
      };
    },
    `${paneSel('editor')} .rd-editor`,
  );
  assertEqual(layout.layout, 'reading', 'panel keeps the reading layout');
  assertEqual(layout.ruler, 0, 'no ruler in the panel');
  assertEqual(layout.border, '0px', 'no sheet border in the panel');
  assertEqual(layout.maxWidth, '780px', 'reading width unchanged');
  await session.close();
  return 'the compact panel keeps its per-user reading width and shows no sheet or ruler';
});

await browser.close();

const failed = results.filter((result) => result.status === 'fail');
const passed = results.filter((result) => result.status === 'pass');
const skipped = results.filter((result) => result.status === 'skipped');
// One JSON object per line: the summary first, then one line per check. A
// partial run (ONLY=…) never overwrites the results of a complete one.
const summary = {
  browser: BROWSER,
  version: browser.version(),
  passed: passed.length,
  failed: failed.length,
  skipped: skipped.length,
  notes,
};
writeFileSync(
  path.join(OUT, `results-${BROWSER}${ONLY ? '-partial' : ''}.jsonl`),
  `${[summary, ...results].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
);
console.log(
  `\n${BROWSER} ${browser.version()}: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
);
console.log(`notes: ${JSON.stringify(notes)}`);
process.exit(failed.length > 0 ? 1 : 0);
