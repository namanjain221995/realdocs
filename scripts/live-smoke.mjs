#!/usr/bin/env node
// Smoke test of a RUNNING deployment through real browsers. It only creates its own documents
// (titles start with "ZZ live smoke"), trashes them at the end, and never opens a document it did
// not create.
//
//   RD_BASE=https://host RD_EMAIL=… RD_PASSWORD=… node scripts/live-smoke.mjs
//   optional: RD_INVITATION_ID, RD_INVITATION_SECRET  accept this invitation first (a temporary
//             administrator account for the test); RD_DOWNLOAD_DIR  where the clicked desktop
//             download is saved; RD_BROWSER  chromium (default), firefox or webkit.
//
// Run it inside the Playwright image (see docs/deployment.md, "Smoke test of the live site").
// Every check prints one line; the exit code is 1 when a check failed.
/* global document, ClipboardEvent, DataTransfer */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../tests/e2e/package.json', import.meta.url));
const playwright = require('@playwright/test');

const BASE = (process.env.RD_BASE ?? '').replace(/\/$/, '');
const EMAIL = process.env.RD_EMAIL ?? '';
const PASSWORD = process.env.RD_PASSWORD ?? '';
if (!BASE || !EMAIL || !PASSWORD) {
  console.error('RD_BASE, RD_EMAIL and RD_PASSWORD are required.');
  process.exit(64);
}
const downloadDir = process.env.RD_DOWNLOAD_DIR ?? '';
const stamp = new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, '')
  .slice(0, 14);
const TITLE = `ZZ live smoke ${stamp}`;

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
async function step(name, fn) {
  try {
    const detail = await fn();
    check(name, true, typeof detail === 'string' ? detail : '');
    return true;
  } catch (error) {
    check(
      name,
      false,
      String(error?.message ?? error)
        .split('\n')[0]
        .slice(0, 300),
    );
    return false;
  }
}

/** Calls the API from inside the page as the page's own principal. */
function api(page, method, url, body, headers = {}) {
  return page.evaluate(
    async ({ method, url, body, headers }) => {
      const h = { accept: 'application/json', ...headers };
      if (method !== 'GET' && !h.authorization) {
        const session = await (await fetch('/api/auth/session')).json();
        h['x-rd-csrf'] = session.csrfToken ?? '1';
      }
      if (body !== undefined) h['content-type'] = 'application/json';
      const response = await fetch(url, {
        method,
        headers: h,
        credentials: h.authorization ? 'omit' : 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // not JSON
      }
      return { status: response.status, body: parsed };
    },
    { method, url, body, headers },
  );
}

const content = (page) => page.getByTestId('rd-editor-content');
async function editorReady(page) {
  await playwright.expect(page.getByTestId('rd-editor')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await playwright
    .expect(page.getByTestId('rd-status-connection'))
    .toHaveAttribute('data-state', 'live', { timeout: 30_000 });
}
const saved = (page) =>
  playwright
    .expect(page.getByTestId('rd-status-save'))
    .toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
const text = (page) => content(page).innerText();
async function typeAtEnd(page, words) {
  await content(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(words, { delay: 15 });
}

const browserType = playwright[process.env.RD_BROWSER ?? 'chromium'];
const browser = await browserType.launch();
const created = [];
let page;
let owner;
try {
  const context = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  page = await context.newPage();
  owner = page;

  // ── Without an account: the sign-in page and nothing else ─────────────────
  await step('a visitor sees only the sign-in page', async () => {
    for (const path of ['/', '/docs', '/download', '/product', '/guides/windows-client']) {
      const response = await page.goto(path);
      if (response.status() !== 200) throw new Error(`${path}: HTTP ${response.status()}`);
      await playwright
        .expect(page.getByRole('heading', { level: 1, name: 'Sign in' }))
        .toBeVisible({ timeout: 20_000 });
      if (new URL(page.url()).pathname !== '/login')
        throw new Error(`${path} ended on ${page.url()}`);
      if ((await page.getByTestId('landing').count()) > 0)
        throw new Error(`${path} shows the product page`);
    }
    return 'checked /, /docs, /download, /product, /guides/windows-client';
  });
  await step('/api/openapi.json is refused without credentials (401)', async () => {
    const result = await api(page, 'GET', '/api/openapi.json');
    if (result.status !== 401) throw new Error(`HTTP ${result.status}`);
  });
  await step('health and readiness (database)', async () => {
    const health = await api(page, 'GET', '/api/health');
    const ready = await api(page, 'GET', '/api/ready');
    if (health.status !== 200 || ready.status !== 200)
      throw new Error(`health ${health.status}, ready ${ready.status}`);
    return JSON.stringify(ready.body).slice(0, 120);
  });

  // ── Account ──────────────────────────────────────────────────────────────
  if (process.env.RD_INVITATION_ID) {
    await step('temporary account: invitation accepted', async () => {
      const result = await api(page, 'POST', '/api/invitations/accept', {
        invitationId: process.env.RD_INVITATION_ID,
        secret: process.env.RD_INVITATION_SECRET,
        displayName: 'Live smoke test',
        password: PASSWORD,
      });
      if (result.status >= 300)
        throw new Error(`HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
      await api(page, 'POST', '/api/auth/logout');
    });
  }
  const signedIn = await step('login through the form', async () => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // An administrator lands in the administration area, a member on the product page.
    await page.waitForURL((url) => url.pathname !== '/login', { timeout: 20_000 });
    const landedOn = new URL(page.url()).pathname;
    await page.goto('/documents');
    await playwright
      .expect(page.getByRole('heading', { level: 1, name: 'Documents' }))
      .toBeVisible({ timeout: 20_000 });
    return `landed on ${landedOn}`;
  });
  if (!signedIn) throw new Error('cannot continue without a session');

  // ── Pages for signed-in accounts ─────────────────────────────────────────
  await step('product page renders for a signed-in account', async () => {
    await page.goto('/product');
    await playwright.expect(page.getByTestId('landing')).toBeVisible({ timeout: 20_000 });
    await playwright.expect(page.getByTestId('nav-account')).toBeVisible();
    return (await page.locator('h1').first().innerText()).slice(0, 60);
  });
  await step('developer portal /docs renders', async () => {
    await page.goto('/docs');
    await playwright.expect(page.locator('h1').first()).toBeVisible();
    return (await page.locator('h1').first().innerText()).slice(0, 60);
  });
  await step('/api/openapi.json is an OpenAPI document for a signed-in account', async () => {
    const result = await api(page, 'GET', '/api/openapi.json');
    if (result.status !== 200 || !result.body?.openapi) throw new Error(`HTTP ${result.status}`);
    return `openapi ${result.body.openapi}, ${Object.keys(result.body.paths ?? {}).length} paths`;
  });

  await step('admin access: account list', async () => {
    const result = await api(page, 'GET', '/api/users');
    if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
    return `${result.body.users?.length ?? '?'} account(s)`;
  });
  await step('existing documents are listed (not opened, not changed)', async () => {
    const result = await api(page, 'GET', '/api/documents');
    if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
    return `${result.body.documents?.length ?? '?'} document(s) visible to this account`;
  });

  // ── Document, editing, saving, reopening ─────────────────────────────────
  let documentId = '';
  await step('document created', async () => {
    const result = await api(page, 'POST', '/api/documents', { title: TITLE });
    if (result.status >= 300) throw new Error(`HTTP ${result.status}`);
    documentId = result.body.document.id;
    created.push(documentId);
  });
  await step('editor opens and the collaboration socket is live', async () => {
    await page.goto(`/d/${documentId}`);
    await editorReady(page);
  });
  await step('rich text: typing, bold, autosave', async () => {
    await content(page).click();
    await page.keyboard.type('owner line one', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('owner bold line', { delay: 15 });
    await page.keyboard.press('Control+b');
    await saved(page);
    const strong = await content(page).locator('strong').count();
    if (strong < 1) throw new Error('no bold text in the editor');
  });
  await step('reopening shows the saved text', async () => {
    await page.reload();
    await editorReady(page);
    const value = await text(page);
    if (!value.includes('owner line one') || !value.includes('owner bold line'))
      throw new Error(`editor shows: ${value.slice(0, 120)}`);
  });

  // ── Second person through a share link ───────────────────────────────────
  const guestContext = await browser.newContext({ baseURL: BASE });
  const guest = await guestContext.newPage();
  await step('share link opens for a guest editor', async () => {
    const result = await api(page, 'POST', `/api/documents/${documentId}/shares`, {
      role: 'editor',
      label: 'live smoke guest',
    });
    if (result.status >= 300) throw new Error(`HTTP ${result.status}`);
    const url = new URL(result.body.url, BASE);
    await guest.goto(`${url.pathname}${url.search}${url.hash}`);
    await editorReady(guest);
    await playwright.expect(content(guest)).toContainText('owner line one', { timeout: 20_000 });
  });
  await step('two-way live sync', async () => {
    await typeAtEnd(guest, 'guest line two');
    await playwright.expect(content(page)).toContainText('guest line two', { timeout: 20_000 });
    await typeAtEnd(page, 'owner line three');
    await playwright.expect(content(guest)).toContainText('owner line three', { timeout: 20_000 });
    await saved(page);
    await saved(guest);
  });
  await step('image paste uploads and reaches the other person', async () => {
    await content(page).click();
    await page.keyboard.press('Control+End');
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 40;
      const context2d = canvas.getContext('2d');
      context2d.fillStyle = '#2f6fed';
      context2d.fillRect(0, 0, 64, 40);
      // The clipboard of a browser that copied a picture from a web page: HTML with the image.
      const html = `<p><img src="${canvas.toDataURL('image/png')}" alt="smoke"></p>`;
      const data = new DataTransfer();
      data.setData('text/html', html);
      const target = document.querySelector('[data-testid="rd-editor-content"]');
      target.editor.commands.focus('end');
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await playwright.expect(content(page).locator('img')).toHaveCount(1, { timeout: 30_000 });
    await playwright.expect(content(guest).locator('img')).toHaveCount(1, { timeout: 30_000 });
    await saved(page);
    const loaded = await content(guest)
      .locator('img')
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0);
    if (!loaded) throw new Error('the image did not load for the guest');
  });
  await step('page setup: orientation change reaches the other person', async () => {
    await page.getByTestId('open-page-setup').click();
    const control = page.getByTestId('page-setup-orientation');
    await control.getByText('Landscape', { exact: true }).click();
    await page.keyboard.press('Escape');
    await saved(page);
    const result = await api(guest, 'GET', `/api/documents/${documentId}/export?format=json`);
    const json = JSON.stringify(result.body);
    if (!json.includes('landscape')) throw new Error('export does not carry landscape');
  });

  // ── History and restore ──────────────────────────────────────────────────
  let firstRevision = 0;
  await step('version history lists both people', async () => {
    const result = await api(page, 'GET', `/api/documents/${documentId}/history`);
    if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
    const entries = result.body.entries ?? [];
    const names = [...new Set(entries.map((entry) => `${entry.actor.kind}:${entry.actor.name}`))];
    if (entries.length < 2 || names.length < 2)
      throw new Error(`${entries.length} entries, actors ${names.join(', ')}`);
    firstRevision = Math.min(
      ...entries.filter((entry) => entry.kind === 'update').map((entry) => entry.revision),
    );
    return `${entries.length} entries; ${names.join(', ')}`;
  });
  await step('history page opens in the browser', async () => {
    await page.getByTestId('open-history').click();
    await playwright.expect(page.getByTestId('history-page')).toBeVisible({ timeout: 20_000 });
    await playwright.expect(page.getByTestId('history-row').first()).toBeVisible();
    await page.goto(`/d/${documentId}`);
    await editorReady(page);
  });
  await step('restore of an earlier revision becomes the new head', async () => {
    const named = await api(
      page,
      'POST',
      `/api/documents/${documentId}/history/${firstRevision}/name`,
      {
        name: 'live smoke restore point',
      },
    );
    if (named.status >= 300)
      throw new Error(`name: HTTP ${named.status} ${JSON.stringify(named.body).slice(0, 160)}`);
    const snapshotId = named.body.snapshot.id;
    const restored = await api(
      page,
      'POST',
      `/api/documents/${documentId}/snapshots/${snapshotId}/restore`,
      {},
    );
    if (restored.status >= 300)
      throw new Error(
        `restore: HTTP ${restored.status} ${JSON.stringify(restored.body).slice(0, 160)}`,
      );
    await page.goto(`/d/${documentId}`);
    await editorReady(page);
    const value = await text(page);
    if (value.includes('guest line two'))
      throw new Error('later text is still there after the restore');
    const history = await api(page, 'GET', `/api/documents/${documentId}/history`);
    return `editor after restore: ${JSON.stringify(value.slice(0, 40))}; history entries ${history.body.entries.length}`;
  });
  await guestContext.close();

  // ── Service API ──────────────────────────────────────────────────────────
  const sessionBody = {
    candidate: { name: 'Smoke Candidate', email: 'candidate@smoke.invalid' },
    interviewers: [{ name: 'Smoke Interviewer', email: 'interviewer@smoke.invalid' }],
    companyName: 'ZZ live smoke',
    // The API takes strings: the round number is "1", not 1.
    round: { number: '1', name: 'Smoke' },
    scheduledAt: new Date(Date.now() + 3_600_000)
      .toISOString()
      .replace('.000Z', '+00:00')
      .replace(/\.\d{3}Z$/, '+00:00'),
    timezone: 'UTC',
    expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  };
  let keyId = '';
  let key = '';
  await step('session API refuses a request without a key (401)', async () => {
    const none = await api(page, 'POST', '/api/v1/interview-sessions', sessionBody, {
      authorization: 'Bearer rdk_not-a-real-key',
    });
    if (none.status !== 401) throw new Error(`HTTP ${none.status}`);
  });
  await step('API key created by the administrator', async () => {
    const result = await api(page, 'POST', '/api/admin/api-keys', {
      name: `live smoke ${stamp}`,
      scopes: ['sessions:read'],
    });
    if (result.status >= 300) throw new Error(`HTTP ${result.status}`);
    const readOnly = result.body;
    const denied = await api(page, 'POST', '/api/v1/interview-sessions', sessionBody, {
      authorization: `Bearer ${readOnly.secret}`,
      'idempotency-key': `smoke-${stamp}-denied`,
    });
    await api(page, 'POST', `/api/admin/api-keys/${readOnly.id ?? readOnly.key?.id}/revoke`);
    if (denied.status !== 403)
      throw new Error(`a key without sessions:create got HTTP ${denied.status}`);
    const full = await api(page, 'POST', '/api/admin/api-keys', {
      name: `live smoke ${stamp} create`,
      scopes: ['sessions:create', 'sessions:read', 'sessions:close', 'documents:history:read'],
    });
    if (full.status >= 300) throw new Error(`HTTP ${full.status}`);
    key = full.body.secret;
    keyId = full.body.id ?? full.body.key?.id;
    return 'a key without the scope is refused with 403';
  });
  let candidateUrl = '';
  let sessionId = '';
  await step('interview session created through the API (201), idempotent', async () => {
    const headers = { authorization: `Bearer ${key}`, 'idempotency-key': `smoke-${stamp}` };
    const first = await api(page, 'POST', '/api/v1/interview-sessions', sessionBody, headers);
    if (first.status !== 201)
      throw new Error(`HTTP ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);
    const again = await api(page, 'POST', '/api/v1/interview-sessions', sessionBody, headers);
    if (again.body?.sessionId !== first.body.sessionId)
      throw new Error('the repeat created another session');
    created.push(first.body.documentId);
    candidateUrl = first.body.candidateAccess.url;
    sessionId = first.body.sessionId;
    const read = await api(page, 'GET', `/api/v1/interview-sessions/${sessionId}`, undefined, {
      authorization: `Bearer ${key}`,
    });
    if (read.body?.round?.number !== '1')
      throw new Error(`round.number is ${JSON.stringify(read.body?.round?.number)}, not "1"`);
    return first.body.title;
  });
  await step('candidate page: editor works, no desktop download controls', async () => {
    const candidateContext = await browser.newContext({ baseURL: BASE });
    const candidate = await candidateContext.newPage();
    const url = new URL(candidateUrl);
    await candidate.goto(`${url.pathname}${url.search}${url.hash}`);
    await editorReady(candidate);
    await content(candidate).click();
    await candidate.keyboard.type('candidate types', { delay: 15 });
    await saved(candidate);
    const controls = await candidate
      .locator('[data-testid*="download"], a[href*="/download"], [data-testid*="desktop"]')
      .count();
    const words = await candidate.locator('body').innerText();
    await candidateContext.close();
    if (controls > 0 || /download the desktop app|open in desktop/i.test(words))
      throw new Error(`${controls} download/desktop control(s) on the candidate page`);
  });
  await step(
    'version history document through the API: doc.txt, image list, image bytes',
    async () => {
      const auth = { authorization: `Bearer ${key}` };
      const root = `/api/v1/documents/${documentId}/version-history`;
      const text = await api(page, 'GET', root, undefined, auth);
      if (text.status !== 200 || typeof text.body !== 'string')
        throw new Error(`doc.txt: HTTP ${text.status}`);
      if (!text.body.startsWith('DOCUMENT VERSION HISTORY\n'))
        throw new Error('not a version history document');
      if (!text.body.includes('\nVERSION 1\n')) throw new Error('no VERSION 1');
      if (
        !/\n- \[\d\d:\d\d:\d\d (AM|PM)\] \[IMAGE [0-9a-f-]{36}\] image pasted \(images\//.test(
          text.body,
        )
      )
        throw new Error('no "[IMAGE <id>] image pasted" line');
      if (!/\nEdited By: .+ \((Admin|Member|Guest)/.test(text.body))
        throw new Error('no editor with a role');
      const list = await api(page, 'GET', `${root}/images`, undefined, auth);
      const images = list.body?.images ?? [];
      if (list.status !== 200 || images.length !== 1)
        throw new Error(`image list: HTTP ${list.status}, ${images.length} image(s)`);
      const bytes = await page.evaluate(
        async ({ url, authorization }) => {
          const response = await fetch(url, { headers: { authorization }, credentials: 'omit' });
          const data = new Uint8Array(await response.arrayBuffer());
          return {
            status: response.status,
            type: response.headers.get('content-type'),
            size: data.length,
            head: [...data.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(''),
          };
        },
        { url: images[0].url, authorization: auth.authorization },
      );
      if (
        bytes.status !== 200 ||
        bytes.head !== '89504e470d0a1a0a' ||
        bytes.size !== images[0].sizeBytes
      )
        throw new Error(
          `image bytes: HTTP ${bytes.status}, ${bytes.size} bytes, starts ${bytes.head}`,
        );
      const versions = (text.body.match(/\nVERSION \d+\n/g) ?? []).length;
      return `${versions} versions; image ${images[0].fileName}, ${bytes.size} bytes, ${bytes.type}`;
    },
  );
  await step('version history of the interview session through the API', async () => {
    const auth = { authorization: `Bearer ${key}` };
    const text = await api(
      page,
      'GET',
      `/api/v1/interview-sessions/${sessionId}/version-history`,
      undefined,
      auth,
    );
    if (text.status !== 200 || typeof text.body !== 'string')
      throw new Error(`HTTP ${text.status}`);
    for (const expected of [
      `Session ID: ${sessionId}\n`,
      'Candidate: Smoke Candidate\n',
      'Round: 1 Smoke\n',
      'Edited By: Smoke Candidate (Candidate, candidate@smoke.invalid)\n',
      '] candidate types\n',
    ]) {
      if (!text.body.includes(expected)) throw new Error(`missing ${JSON.stringify(expected)}`);
    }
    const json = await api(
      page,
      'GET',
      `/api/v1/interview-sessions/${sessionId}/version-history?format=json`,
      undefined,
      auth,
    );
    if (json.status !== 200 || !Array.isArray(json.body?.versions) || json.body.versions.length < 1)
      throw new Error(`json: HTTP ${json.status}`);
    return `${json.body.versions.length} version(s), finalized ${json.body.finalizedAt}`;
  });
  await step('an API key may read /api/openapi.json', async () => {
    const result = await api(page, 'GET', '/api/openapi.json', undefined, {
      authorization: `Bearer ${key}`,
    });
    if (result.status !== 200 || !result.body?.openapi) throw new Error(`HTTP ${result.status}`);
  });
  await step('revoked API key is refused (401)', async () => {
    await api(page, 'POST', `/api/admin/api-keys/${keyId}/revoke`);
    const result = await api(page, 'GET', '/api/v1/interview-sessions', undefined, {
      authorization: `Bearer ${key}`,
    });
    if (result.status !== 401) throw new Error(`HTTP ${result.status}`);
  });

  // ── Desktop download from the landing page ───────────────────────────────
  await step('desktop release manifest names a current release', async () => {
    const result = await api(page, 'GET', '/api/v1/desktop/releases?channel=stable');
    if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
    const releases = result.body.releases ?? [];
    if (releases.length === 0) throw new Error('no release published');
    return `${releases[0].version}: ${releases[0].artifacts.map((a) => a.fileName).join(', ')}`;
  });
  await step('landing page Download button downloads the package for this computer', async () => {
    // The product page is for signed-in accounts: the same session is used.
    await page.goto('/product');
    const link = page.getByTestId('hero-download-link');
    await playwright.expect(link).toBeVisible({ timeout: 20_000 });
    const expected = await link.getAttribute('data-file');
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const name = download.suggestedFilename();
    if (name !== expected) throw new Error(`downloaded ${name}, expected ${expected}`);
    const file = await download.path();
    const bytes = fs.readFileSync(file);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const shown = await page
      .getByTestId('hero-download-sha256')
      .first()
      .innerText()
      .catch(() => '');
    if (bytes.subarray(0, 2).toString('latin1') !== 'PK') throw new Error('not a ZIP file');
    if (downloadDir) fs.copyFileSync(file, path.join(downloadDir, name));
    return `${name}, ${bytes.length} bytes, sha256 ${sha}${shown.includes(sha) ? ' (matches the page)' : ''}`;
  });
} catch (error) {
  check('run', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  // Trash what this run created; nothing else is touched.
  for (const id of created) {
    try {
      const result = await api(owner, 'POST', `/api/documents/${id}/trash`);
      console.log(`cleanup: document ${id.slice(0, 8)} trashed (HTTP ${result.status})`);
    } catch (error) {
      console.log(
        `cleanup: document ${id.slice(0, 8)} NOT trashed: ${String(error).slice(0, 120)}`,
      );
    }
  }
  await browser.close();
}
console.log(
  failed === 0 ? 'RESULT: live smoke test passed.' : `RESULT: ${failed} check(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
