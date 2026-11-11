/**
 * Harness for the real-stack tests. Nothing is mocked here: every request goes
 * to the real server started by `test-real/stack.mjs`.
 *
 * Every page of every browser context a test opens is watched; the test fails
 * on a Content-Security-Policy violation, an uncaught page error or an
 * unexpected console error.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test as base,
  type TestInfo,
  type WebSocketRoute,
} from '@playwright/test';

export { expect };

export interface Account {
  email: string;
  displayName: string;
  password: string;
}

interface StackState {
  baseUrl: string;
  devUrl: string;
  controlUrl: string;
  controlToken: string;
  admin: Account;
}

const stateFile = fileURLToPath(new URL('../../.stage/real/state.json', import.meta.url));
export const stack = JSON.parse(readFileSync(stateFile, 'utf8')) as StackState;
export const admin: Account = stack.admin;

/** Browsers log every failed or refused request; the tests assert on the screen instead. */
const EXPECTED_CONSOLE_NOISE = [
  /Failed to load resource/i,
  /the server responded with a status of/i,
  /net::ERR_/i,
  /NetworkError when attempting to fetch resource/i,
  /Load failed/i,
  /access control checks/i,
];

export class Problems {
  private readonly found: string[] = [];
  private readonly allowed: RegExp[] = [];

  /** Declares a console error this test provokes on purpose. */
  allow(...patterns: RegExp[]): void {
    this.allowed.push(...patterns);
  }

  async watchContext(context: BrowserContext): Promise<void> {
    await context.exposeBinding('__rdReportCsp', (_source, detail: string) => {
      this.found.push(`csp: ${detail}`);
    });
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        const report = (window as unknown as { __rdReportCsp?: (detail: string) => void })
          .__rdReportCsp;
        report?.(`${event.violatedDirective} blocked ${event.blockedURI}`);
      });
    });
    context.on('page', (page) => this.watchPage(page));
    for (const page of context.pages()) this.watchPage(page);
  }

  private watchPage(page: Page): void {
    page.on('console', (message) => {
      if (message.type() === 'error') this.found.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => this.found.push(`uncaught: ${error.message}`));
  }

  /** Everything that was seen, including what `unexpected()` forgives. */
  all(): string[] {
    return [...this.found];
  }

  unexpected(): string[] {
    const expected = [...EXPECTED_CONSOLE_NOISE, ...this.allowed];
    return this.found.filter((problem) => !expected.some((pattern) => pattern.test(problem)));
  }
}

interface Fixtures {
  problems: Problems;
  /** A further, isolated browser profile (a guest, another account). Closed after the test. */
  openContext: () => Promise<BrowserContext>;
}

function contextOptions(testInfo: TestInfo): Parameters<Browser['newContext']>[0] {
  const { baseURL, timezoneId, locale, userAgent, viewport } = testInfo.project.use;
  return { baseURL, timezoneId, locale, userAgent, viewport };
}

export const test = base.extend<Fixtures>({
  // The second argument is Playwright's "use"; it is named `provide` here so
  // that the React hooks lint rule does not mistake it for React's `use`.
  problems: [
    async ({ context }, provide) => {
      const problems = new Problems();
      await problems.watchContext(context);
      await provide(problems);
      expect(problems.unexpected(), 'CSP violations, page errors and console errors').toEqual([]);
    },
    { auto: true },
  ],
  openContext: async ({ browser, problems }, provide, testInfo) => {
    const opened: BrowserContext[] = [];
    await provide(async () => {
      const context = await browser.newContext(contextOptions(testInfo));
      await problems.watchContext(context);
      opened.push(context);
      return context;
    });
    for (const context of opened) await context.close();
  },
});

/** A name that cannot collide with another test or another browser's run of the same test. */
export function unique(label: string): string {
  return `${label} ${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------- sign-in */

export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
}

/* ----------------------------------------------- the server's public API */

export interface ApiResult<T> {
  status: number;
  body: T;
}

/**
 * Calls the server's API from inside the page, as the page's own principal:
 * same origin, same cookies, the session's CSRF token. Used to prepare a
 * scenario quickly; the behaviour under test is always driven through the UI.
 */
export async function callApi<T = unknown>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (method !== 'GET') {
        const session = (await (await fetch('/api/auth/session')).json()) as {
          csrfToken: string | null;
        };
        headers['x-rd-csrf'] = session.csrfToken ?? '1';
      }
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const parse = (): unknown => {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return text;
        }
      };
      return { status: response.status, body: parse() as never };
    },
    { method, path, body },
  );
}

async function ok<T>(result: Promise<ApiResult<T>>, what: string): Promise<T> {
  const { status, body } = await result;
  expect(status, `${what} (HTTP status)`).toBeLessThan(300);
  return body;
}

export async function createDocument(page: Page, title: string): Promise<string> {
  const body = await ok(
    callApi<{ document: { id: string } }>(page, 'POST', '/api/documents', { title }),
    'create document',
  );
  return body.document.id;
}

export interface ShareLink {
  id: string;
  /** Path and fragment of the link, to open with `page.goto`. */
  path: string;
}

/** Creates a share link through the API and returns it relative to the tested origin. */
export async function createShareLink(
  page: Page,
  documentId: string,
  options: { role?: 'viewer' | 'editor'; expiresAt?: string | null; label?: string } = {},
): Promise<ShareLink> {
  const body = await ok(
    callApi<{ share: { id: string }; url: string }>(
      page,
      'POST',
      `/api/documents/${documentId}/shares`,
      options,
    ),
    'create share link',
  );
  return { id: body.share.id, path: relative(body.url) };
}

/* ---------------------------------------------------------------- editor */

export const editorRoot = (page: Page) => page.getByTestId('rd-editor');
export const editorContent = (page: Page) => page.getByTestId('rd-editor-content');
export const saveState = (page: Page) => page.getByTestId('rd-status-save');
export const connectionState = (page: Page) => page.getByTestId('rd-status-connection');

/** Opens a document and waits until the editor has synchronised with the server. */
export async function openDocument(page: Page, documentId: string): Promise<void> {
  await page.goto(`/d/${documentId}`);
  await expectEditorReady(page);
}

export async function expectEditorReady(page: Page): Promise<void> {
  await expect(editorRoot(page)).toHaveAttribute('data-ready', 'true');
  await expect(connectionState(page)).toHaveAttribute('data-state', 'live');
}

/** Puts the caret at the end of the document and types. */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  const content = editorContent(page);
  await content.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

export async function expectSaved(page: Page): Promise<void> {
  await expect(saveState(page)).toHaveAttribute('data-state', 'saved');
}

/** The document as plain text, straight from the server's export. */
export async function exportedText(page: Page, documentId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/export?format=txt`);
    return response.ok ? response.text() : `HTTP ${response.status}`;
  }, documentId);
}

/* --------------------------------------------------------------- control */

/**
 * Restarts the server with `DOWNLOAD_DIR` pointing at a scratch folder that holds
 * one dummy file of `bytes` bytes. `resetDownloads` restarts it with the variable unset.
 */
export const publishDownload = (
  file: string,
  bytes: number,
  release?: { version: string; signed?: boolean },
): Promise<void> =>
  control(
    `/downloads/publish?file=${encodeURIComponent(file)}&bytes=${bytes}` +
      (release
        ? `&version=${encodeURIComponent(release.version)}` +
          (release.signed === undefined ? '' : `&signed=${release.signed}`)
        : ''),
  );
/** Restarts the server with `ALLOW_SIGNUP=true` (or unset). */
export const setSignup = (enabled: boolean): Promise<void> =>
  control(enabled ? '/signup/enable' : '/signup/disable');
export const resetDownloads = (): Promise<void> => control('/downloads/reset');

async function control(path: string): Promise<void> {
  const response = await fetch(`${stack.controlUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.controlToken}` },
  });
  if (!response.ok) throw new Error(`Stack control ${path} failed: HTTP ${response.status}`);
}

/** Kills the server process (no graceful shutdown), as a crash or power loss would. */
export const killServer = (): Promise<void> => control('/server/kill');
/** Stops the server the way an operator does (SIGTERM, graceful shutdown). */
export const stopServer = (): Promise<void> => control('/server/stop');
/** Starts the server again and returns when it answers `/api/ready`. */
export const startServer = (): Promise<void> => control('/server/start');

/* ------------------------------------------------- more editor helpers */

interface TiptapElement extends HTMLElement {
  editor: {
    commands: { focus: (position: 'start' | 'end' | number) => boolean };
    view: { pasteHTML: (html: string) => boolean };
  };
}

const CONTENT = '[data-testid="rd-editor-content"]';

/** The editor takes the focus in the next animation frame: wait until keys will land in it. */
export async function expectEditorFocused(page: Page): Promise<void> {
  await page.waitForFunction(
    (selector) => document.activeElement === document.querySelector(selector),
    CONTENT,
  );
}

/** Puts the caret at the end of the document, as Ctrl+End would, and waits for the focus. */
export async function focusEnd(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    (document.querySelector(selector) as TiptapElement).editor.commands.focus('end');
  }, CONTENT);
  await expectEditorFocused(page);
}

/** Types at the end of the document, on a new line. */
export async function typeLine(page: Page, text: string): Promise<void> {
  await focusEnd(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
}

/** Clicks a toolbar button by its name and waits until the editor has the focus back. */
export async function clickTool(page: Page, name: string): Promise<void> {
  await page.getByTestId('rd-toolbar').getByRole('button', { name, exact: true }).click();
  await expectEditorFocused(page);
}

/** How often `needle` occurs in the text of the open document. */
export async function occurrences(page: Page, needle: string): Promise<number> {
  const text = await editorContent(page).innerText();
  return text.split(needle).length - 1;
}

export type InsertPath = 'paste event' | 'drop event' | 'file chooser';

/**
 * Hands a file to the editor the way a person would: pasted from the
 * clipboard, or dropped, or — when the browser does not let a script attach a
 * file to either event — picked with the toolbar's file chooser. Returns the
 * path that was used, so the report can say what each browser exercised.
 */
export async function insertImageFile(
  page: Page,
  file: { name: string; type: string; bytes: Buffer },
  prefer: InsertPath = 'paste event',
): Promise<InsertPath> {
  await focusEnd(page);
  const used = await page.evaluate(
    ({ selector, name, type, base64, prefer }) => {
      const target = document.querySelector(selector) as HTMLElement;
      const data = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const make = (): DataTransfer | null => {
        try {
          const transfer = new DataTransfer();
          transfer.items.add(new File([data], name, { type }));
          return transfer.files.length === 1 ? transfer : null;
        } catch {
          return null;
        }
      };
      const paste = (): boolean => {
        const transfer = make();
        if (!transfer) return false;
        try {
          const event = new ClipboardEvent('paste', {
            clipboardData: transfer,
            bubbles: true,
            cancelable: true,
          });
          if (event.clipboardData?.files.length !== 1) return false;
          target.dispatchEvent(event);
          return true;
        } catch {
          return false;
        }
      };
      const drop = (): boolean => {
        const transfer = make();
        if (!transfer) return false;
        try {
          const box = target.getBoundingClientRect();
          const event = new DragEvent('drop', {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
            clientX: box.left + 40,
            clientY: box.top + 20,
          });
          if (event.dataTransfer?.files.length !== 1) return false;
          target.dispatchEvent(event);
          return true;
        } catch {
          return false;
        }
      };
      const order = prefer === 'drop event' ? [drop, paste] : [paste, drop];
      if (prefer !== 'file chooser') {
        for (const attempt of order) {
          if (attempt()) return attempt === paste ? 'paste event' : 'drop event';
        }
      }
      return 'file chooser';
    },
    {
      selector: CONTENT,
      name: file.name,
      type: file.type,
      base64: file.bytes.toString('base64'),
      prefer,
    },
  );
  if (used === 'file chooser') {
    await page
      .getByTestId('rd-image-input')
      .setInputFiles({ name: file.name, mimeType: file.type, buffer: file.bytes });
  }
  return used as InsertPath;
}

/** Pastes HTML through the editor's own paste pipeline (sanitiser included). */
export async function pasteHtml(page: Page, html: string): Promise<void> {
  await focusEnd(page);
  await page.evaluate(
    ({ selector, html }) => {
      (document.querySelector(selector) as TiptapElement).editor.view.pasteHTML(html);
    },
    { selector: CONTENT, html },
  );
}

/** Number of images in `scope` that the browser has decoded (bytes arrived and are an image). */
export async function loadedImages(scope: Locator, selector: string): Promise<number> {
  return scope.locator(selector).evaluateAll(
    (images) =>
      images.filter((image) => {
        const element = image as HTMLImageElement;
        return element.complete && element.naturalWidth > 0;
      }).length,
  );
}

/* ------------------------------------------------------- device storage */

/** Prefix of the editor's local recovery databases: one per account, named after its id. */
export const LOCAL_DATABASE = 'realtimedocs-local-v1:';

/** Names of the local recovery databases in this browser profile. */
export async function localDatabases(page: Page): Promise<string[]> {
  return page.evaluate(async (prefix) => {
    const all = await indexedDB.databases();
    return all.map((info) => info.name ?? '').filter((name) => name.startsWith(prefix));
  }, LOCAL_DATABASE);
}

/** Everything a script on this origin can read from web storage. */
export async function webStorage(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
}

/** Names of every IndexedDB database of this origin in this browser profile. */
export async function allDatabases(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((info) => info.name ?? ''));
}

/* -------------------------------------------------------------- network */

/**
 * Control over one page's collaboration connection, for the two things a test
 * cannot do by waiting: delay what the server says (to prove "Saved" waits for
 * it) and cut this page off the network (to leave it with unsent work).
 *
 * Nothing is mocked. Frames are the real ones, passed through unchanged; the
 * connection to the server is opened by the page itself, with its own cookies
 * and origin. Must be attached before the document is opened.
 */
export class Link {
  private holding = false;
  private held: (() => void)[] = [];
  private offline = false;
  private readonly open = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();
  /** Frames the server sent that reached the page. */
  delivered = 0;

  static async attach(page: Page): Promise<Link> {
    const link = new Link();
    await page.routeWebSocket(/\/collab(\?|$)/, (route) => {
      if (link.offline) {
        void route.close({ code: 1001, reason: 'offline (test)' });
        return;
      }
      const server = route.connectToServer();
      const pair = { page: route, server };
      link.open.add(pair);
      route.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const deliver = (): void => {
          link.delivered += 1;
          route.send(message);
        };
        if (link.holding) link.held.push(deliver);
        else deliver();
      });
      const forget = (): void => {
        link.open.delete(pair);
      };
      route.onClose((code, reason) => {
        forget();
        void server.close({ code, reason });
      });
      server.onClose((code, reason) => {
        forget();
        void route.close({ code, reason });
      });
    });
    await page.route(/\/api\/documents\/[^/]+\/collab-ticket$/, (route) =>
      link.offline ? route.abort('internetdisconnected') : route.continue(),
    );
    return link;
  }

  /** From now on, what the server sends waits here instead of reaching the page. */
  hold(): void {
    this.holding = true;
  }

  /** Delivers everything that was held, in order, and stops holding. */
  release(): void {
    this.holding = false;
    for (const deliver of this.held.splice(0)) deliver();
  }

  /** Cuts this page off: the connection drops and no new one can be made. */
  disconnect(): void {
    this.offline = true;
    this.holding = false;
    this.held = [];
    for (const pair of [...this.open]) {
      void pair.page.close({ code: 1001, reason: 'offline (test)' });
      void pair.server.close({ code: 1000, reason: 'offline (test)' });
    }
    this.open.clear();
  }

  reconnect(): void {
    this.offline = false;
  }
}

/** Waits for the live connection; uses the indicator's own "retry now" when it is offered. */
export async function expectReconnected(page: Page, timeout = 45_000): Promise<void> {
  await expect(async () => {
    const state = await connectionState(page).getAttribute('data-state');
    if (state !== 'live') {
      // The button goes away the moment an attempt starts: never wait for it.
      await page
        .getByTestId('rd-status-retry')
        .click({ timeout: 500 })
        .catch(() => undefined);
    }
    expect(state).toBe('live');
  }).toPass({ timeout, intervals: [250, 500, 1000] });
}

/* ---------------------------------------------------------------- people */

function relative(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Invites a member (the administrator's page creates the invitation) and
 * accepts the invitation in `page`, which ends up signed in as the new member.
 */
export async function inviteMember(
  adminPage: Page,
  page: Page,
  label: string,
): Promise<Account & { id: string }> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const account: Account = {
    email: `${label.toLowerCase().replace(/[^a-z]+/g, '.')}.${suffix}@realtimedocs.test`,
    displayName: `${label} ${suffix}`,
    password: `${suffix}-quiet-harbor-lantern-${Math.random().toString(36).slice(2, 10)}`,
  };
  const created = await ok(
    callApi<{ url: string }>(adminPage, 'POST', '/api/invitations', {
      email: account.email,
      role: 'member',
    }),
    'create invitation',
  );
  await page.goto(relative(created.url));
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Name').fill(account.displayName);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Confirm password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  const session = await callApi<{ user: { id: string } }>(page, 'GET', '/api/auth/session');
  return { ...account, id: session.body.user.id };
}

export async function addMember(
  adminPage: Page,
  documentId: string,
  userId: string,
  role: 'viewer' | 'editor',
): Promise<void> {
  await ok(
    callApi(adminPage, 'PUT', `/api/documents/${documentId}/members/${userId}`, { role }),
    'add member',
  );
}

/* ----------------------------------------------------------------- files */

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** A real PNG file: a solid rectangle with a diagonal band, so it is recognisable in a screenshot. */
export function pngFile(width = 96, height = 64): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const band = Math.abs(x - y) < 8;
      rows[row + 1 + x * 3] = band ? 0xff : 0x14;
      rows[row + 2 + x * 3] = band ? 0xd4 : 0xb8;
      rows[row + 3 + x * 3] = band ? 0x3b : 0xa6;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
