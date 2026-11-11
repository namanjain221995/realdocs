/**
 * Acceptance scenario 14 at the browser level (the browser part: pasted HTML, links, file names,
 * SVG, diagrams and attributes; the privileged desktop actions belong to the desktop suites).
 *
 * In the real web app, served by the real server with its own Content-Security-Policy, the
 * editor's 22-entry malicious clipboard corpus (`packages/editor/test/fixtures/clipboard.ts`)
 * is pasted through real paste events. Nothing may execute (no dialog, no global marker, no
 * request to a foreign host), the editor's DOM may hold no script-capable element, attribute or
 * link address, and the stored document (JSON, Markdown and text export) and what a view-only
 * guest sees must be as clean. A hostile file name, a script-bearing SVG upload and a script
 * inside a diagram are covered as well.
 *
 * The corpus is shared with the editor's own unit and browser checks on purpose; what this adds is
 * the whole product around it: the real CSP, the real session, the stored result and a second viewer.
 */
import type { Page } from '@playwright/test';
import { MALICIOUS_CORPUS } from '../../../packages/editor/test/fixtures/clipboard';
import {
  admin,
  createDocument,
  createShareLink,
  editorContent,
  exportedJson,
  exportedMarkdown,
  exportedText,
  expect,
  expectEditorReady,
  expectSaved,
  openDocument,
  pasteHtml,
  signIn,
  solidPng,
  test,
  unique,
} from '../support/test';

/** Inline handlers are refused by the policy while the sanitiser parses hostile markup; that is the policy working. */
const BLOCKED_BY_POLICY_NOISE = [
  /script-src-attr blocked inline/i,
  /Executing inline event handler violates/i,
  /Refused to execute inline (event handler|script)/i,
  // A pasted <base href="https://evil.example/">: the policy refuses it (`base-uri 'self'`).
  /base-uri blocked https:\/\/evil\.example\//i,
  /Setting the document's base URI to 'https:\/\/evil\.example\/' violates/i,
];

/** Every attribute value of every node and mark of a stored document (text nodes are inert and not looked at). */
function storedAttributeValues(json: string): string[] {
  const values: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk);
    if (node === null || typeof node !== 'object') return;
    const record = node as { attrs?: Record<string, unknown>; marks?: unknown; content?: unknown };
    for (const value of Object.values(record.attrs ?? {}))
      if (typeof value === 'string') values.push(value);
    walk(record.marks);
    walk(record.content);
  };
  walk(JSON.parse(json));
  return values;
}
/** Stored attribute values are data, but none may carry a script scheme or markup characters. */
const ACTIVE_VALUE = /javascript:|vbscript:|data:text\/html|[<>]|expression\s*\(/i;

interface Findings {
  pwned: unknown;
  badElements: string[];
  badAttributes: string[];
  badLinks: string[];
  badImages: string[];
}

/** Everything in the editor that could run code, load a foreign resource or navigate. */
async function inspect(page: Page): Promise<Findings> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="rd-editor-content"]') as HTMLElement;
    const forbidden =
      'script, iframe, object, embed, form, input, button[formaction], style, link, meta, base, svg, math, video, audio, template, noscript';
    const findings: Findings = {
      pwned: (window as unknown as { __pwned?: unknown }).__pwned,
      badElements: [...root.querySelectorAll(forbidden)]
        .filter(
          (element) =>
            !element.closest(
              '[data-rd-ui], .rd-code-block__toolbar, .rd-image__tools, [role="toolbar"], [role="menu"]',
            ),
        )
        .filter((element) => element.localName !== 'svg' && element.localName !== 'button')
        .map((element) => element.localName),
      badAttributes: [],
      badLinks: [],
      badImages: [],
    };
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        if (
          /^on/i.test(attribute.name) ||
          /^(srcdoc|formaction|ping|background)$/i.test(attribute.name)
        ) {
          findings.badAttributes.push(`${element.localName}[${attribute.name}]`);
        }
        if (
          /javascript:|vbscript:|data:text\/html|expression\s*\(/i.test(attribute.value) &&
          attribute.name !== 'data-source'
        ) {
          findings.badAttributes.push(
            `${element.localName}[${attribute.name}]=${attribute.value.slice(0, 40)}`,
          );
        }
      }
    }
    for (const anchor of root.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') ?? '';
      if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) findings.badLinks.push(href);
    }
    for (const image of root.querySelectorAll('img.rd-image__img')) {
      const src = image.getAttribute('src') ?? '';
      if (!/^(\/api\/documents\/[0-9a-f-]{36}\/assets\/[0-9a-f-]{36}|blob:)/i.test(src)) {
        findings.badImages.push(src.slice(0, 80));
      }
    }
    return findings;
  });
}

const CLEAN: Findings = {
  pwned: undefined,
  badElements: [],
  badAttributes: [],
  badLinks: [],
  badImages: [],
};

test('a hostile clipboard corpus pasted into the real app executes nothing and stores nothing active', async ({
  page,
  openContext,
  problems,
}) => {
  test.setTimeout(240_000);
  problems.allow(...BLOCKED_BY_POLICY_NOISE);
  const foreign: string[] = [];
  const watchRequests = (target: Page) =>
    target.on('request', (request) => {
      const { hostname, protocol } = new URL(request.url());
      if (hostname !== '127.0.0.1' && !['blob:', 'data:'].includes(protocol))
        foreign.push(request.url());
    });
  watchRequests(page);

  await signIn(page, admin);
  const id = await createDocument(page, unique('Hostile paste'));
  const share = await createShareLink(page, id, { role: 'viewer' });
  await openDocument(page, id);
  await page.evaluate(() => {
    (window as unknown as { __pwned?: unknown }).__pwned = undefined;
  });

  const how = new Set<string>();
  for (const entry of MALICIOUS_CORPUS) {
    how.add(await pasteHtml(page, entry.html, 'plain text fallback'));
    // Give a payload that would fire on load, error or a timer the chance to do so.
    await page.waitForTimeout(150);
    expect(await inspect(page), `after pasting "${entry.name}"`).toEqual(CLEAN);
  }
  test.info().annotations.push({ type: 'paste path', description: [...how].join(', ') });
  await expectSaved(page);

  // Not vacuous: content arrived (checked again below: the harmless link of the corpus is stored).
  await expect(editorContent(page)).not.toBeEmpty();

  // Click what is left of the links: none may navigate this tab or run code.
  const before = page.url();
  for (const anchor of await editorContent(page).locator('a[href]').all()) {
    await anchor.click({ modifiers: ['ControlOrMeta'] }).catch(() => undefined);
  }
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
  expect(await inspect(page)).toEqual(CLEAN);

  // The stored document.
  const json = await exportedJson(page, id);
  const markdown = await exportedMarkdown(page, id);
  const text = await exportedText(page, id);
  expect(
    storedAttributeValues(json).filter((value) => ACTIVE_VALUE.test(value)),
    'attribute values of the stored document',
  ).toEqual([]);
  const hrefs = [...json.matchAll(/"href"\s*:\s*"([^"]*)"/g)].map((match) => match[1] ?? '');
  expect(hrefs, 'the harmless link of the corpus was kept').toContain('https://example.com/');
  for (const href of hrefs)
    expect(href, 'stored link address').toMatch(/^(https?:\/\/|mailto:|tel:)/i);
  // Markdown must not turn text into an active link either.
  expect(markdown, 'markdown export').not.toMatch(/\]\((javascript|vbscript|data):/i);
  void text;

  // A view-only guest sees the stored document, with the same properties.
  const guest = await (await openContext()).newPage();
  watchRequests(guest);
  await guest.goto(share.path);
  await expectEditorReady(guest);
  await guest.waitForTimeout(500);
  expect(await inspect(guest)).toEqual(CLEAN);

  expect(foreign, 'requests to hosts other than the server').toEqual([]);
});

test('a hostile file name, a script-bearing SVG and a diagram with script cannot run anything', async ({
  page,
  openContext,
  problems,
}) => {
  test.setTimeout(120_000);
  problems.allow(...BLOCKED_BY_POLICY_NOISE);
  await signIn(page, admin);
  const id = await createDocument(page, unique('Hostile files'));
  const share = await createShareLink(page, id, { role: 'viewer' });
  await openDocument(page, id);

  // 1. An image whose file name is markup. The name may be shown, as text only.
  const hostileName = '"><img src=x onerror=window.__pwned=7>.png';
  await page
    .getByTestId('rd-image-input')
    .setInputFiles({ name: hostileName, mimeType: 'image/png', buffer: solidPng([10, 120, 200]) });
  await expect(editorContent(page).locator('img.rd-image__img')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expectSaved(page);
  expect(await inspect(page)).toEqual(CLEAN);

  // 2. SVG uploads: script, event handler and foreignObject are refused by the server; a plain one is accepted.
  const upload = (body: string, name: string) =>
    page.evaluate(
      async ({ id, body, name }) => {
        const session = (await (await fetch('/api/auth/session')).json()) as {
          csrfToken: string | null;
        };
        const form = new FormData();
        form.append('file', new File([body], name, { type: 'image/svg+xml' }));
        const response = await fetch(`/api/documents/${id}/assets`, {
          method: 'POST',
          headers: { 'x-rd-csrf': session.csrfToken ?? '1' },
          body: form,
        });
        const text = await response.text();
        return { status: response.status, body: text.slice(0, 300) };
      },
      { id, body, name },
    );
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  for (const [label, svg] of [
    ['script element', `<svg ${NS} width="10" height="10"><script>window.__pwned=1</script></svg>`],
    [
      'onload handler',
      `<svg ${NS} width="10" height="10" onload="window.__pwned=2"><rect width="5" height="5"/></svg>`,
    ],
    [
      'foreignObject',
      `<svg ${NS} width="10" height="10"><foreignObject><iframe srcdoc="x"/></foreignObject></svg>`,
    ],
    [
      'javascript link',
      `<svg ${NS} width="10" height="10"><a href="javascript:window.__pwned=3"><rect width="5" height="5"/></a></svg>`,
    ],
  ] as const) {
    const result = await upload(svg, `${label.replace(/ /g, '-')}.svg`);
    expect(result.status, `SVG with ${label} is refused (${result.body})`).toBeGreaterThanOrEqual(
      400,
    );
    expect(result.status).toBeLessThan(500);
  }
  const plain = await upload(
    `<svg ${NS} width="10" height="10"><rect width="5" height="5" fill="#336"/></svg>`,
    'plain.svg',
  );
  expect(plain.status, plain.body).toBe(201);

  // The accepted SVG is only ever served inertly: nosniff and a sandboxing policy, and opening it runs nothing.
  const assetUrl = (JSON.parse(plain.body) as { asset?: { id?: string } }).asset?.id;
  expect(assetUrl, 'the accepted SVG has an asset id').toBeTruthy();
  {
    const headers = await page.evaluate(
      async ({ id, asset }) => {
        const response = await fetch(`/api/documents/${id}/assets/${asset}`);
        return {
          status: response.status,
          type: response.headers.get('content-type'),
          nosniff: response.headers.get('x-content-type-options'),
          csp: response.headers.get('content-security-policy'),
        };
      },
      { id, asset: assetUrl },
    );
    expect(headers.status).toBe(200);
    expect(headers.nosniff).toBe('nosniff');
    expect(headers.csp ?? '', 'asset CSP').toMatch(/sandbox/);
  }

  // 3. A diagram whose source carries script, handlers and javascript: links.
  await pasteHtml(
    page,
    `<pre data-type="diagram" data-language="mermaid"><code>flowchart LR\n  A["&lt;img src=x onerror='window.__pwned=4'&gt;label"] --&gt; B["&lt;script&gt;window.__pwned=5&lt;/script&gt;ok"]\n  click A href "javascript:window.__pwned=6" "tip"\n  click B call window.__pwn()</code></pre>`,
  );
  await page.waitForTimeout(1500);
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned),
  ).toBeUndefined();
  expect(await inspect(page)).toEqual(CLEAN);

  // 4. Nothing active in the stored document; a viewer is as clean.
  await expectSaved(page);
  const json = await exportedJson(page, id);
  expect(
    storedAttributeValues(json).filter((value) => ACTIVE_VALUE.test(value)),
    'attribute values of the stored document (a file name is data, markup in it is neutralised)',
  ).toEqual([]);
  const guest = await (await openContext()).newPage();
  await guest.goto(share.path);
  await expectEditorReady(guest);
  await guest.waitForTimeout(1500);
  expect(await inspect(guest)).toEqual(CLEAN);
});
