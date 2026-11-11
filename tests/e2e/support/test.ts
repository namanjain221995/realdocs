/**
 * Helpers of the acceptance specs. Nothing is mocked: every request goes to the
 * real server of `stack.mjs`. Modelled on `apps/web/test-real/support/test.ts`,
 * which cannot be imported (it reads the web agent's state file at import time).
 *
 * Every page of every browser context a spec opens is watched; the spec fails on
 * a Content-Security-Policy violation, an uncaught page error or an unexpected
 * console error.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test as base,
  type TestInfo,
} from '@playwright/test';

export { expect };

export interface Account {
  email: string;
  displayName: string;
  password: string;
}
interface StackState {
  baseUrl: string;
  controlUrl: string;
  controlToken: string;
  admin: Account;
}

const stateFile = fileURLToPath(new URL('../.stage/state.json', import.meta.url));
export const stack = JSON.parse(readFileSync(stateFile, 'utf8')) as StackState;
export const admin: Account = stack.admin;

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
  /** Dialogs (alert, confirm, prompt, beforeunload) any page opened. A script that runs shows up here. */
  readonly dialogs: string[] = [];

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
    page.on('dialog', (dialog) => {
      this.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      void dialog.dismiss().catch(() => undefined);
    });
  }

  unexpected(): string[] {
    const expected = [...EXPECTED_CONSOLE_NOISE, ...this.allowed];
    return this.found.filter((problem) => !expected.some((pattern) => pattern.test(problem)));
  }
}

interface Fixtures {
  problems: Problems;
  /** A further, isolated browser profile (a guest, another account). Closed after the spec. */
  openContext: () => Promise<BrowserContext>;
}

function contextOptions(testInfo: TestInfo): Parameters<Browser['newContext']>[0] {
  const { baseURL, timezoneId, locale, userAgent, viewport } = testInfo.project.use;
  return { baseURL, timezoneId, locale, userAgent, viewport };
}

/** The app's saved theme choice (`rd.theme`), set before any page script runs. */
export async function useSavedTheme(
  context: BrowserContext,
  theme: 'light' | 'dark',
): Promise<void> {
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem('rd.theme', value);
    } catch {
      // Storage unavailable: the default theme applies.
    }
  }, theme);
}

export const test = base.extend<Fixtures>({
  problems: [
    async ({ context }, provide) => {
      const problems = new Problems();
      await problems.watchContext(context);
      await provide(problems);
      expect(problems.dialogs, 'dialogs opened by a page').toEqual([]);
      expect(problems.unexpected(), 'CSP violations, page errors and console errors').toEqual([]);
    },
    { auto: true },
  ],
  openContext: async ({ browser, problems, colorScheme, reducedMotion }, provide, testInfo) => {
    const opened: BrowserContext[] = [];
    await provide(async () => {
      const context = await browser.newContext({
        ...contextOptions(testInfo),
        ...(colorScheme ? { colorScheme } : {}),
        ...(reducedMotion ? { reducedMotion } : {}),
      });
      if (colorScheme === 'light' || colorScheme === 'dark')
        await useSavedTheme(context, colorScheme);
      await problems.watchContext(context);
      opened.push(context);
      return context;
    });
    for (const context of opened) await context.close();
  },
});

export function unique(label: string): string {
  return `${label} ${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------- sign-in */

export async function signIn(page: Page, account: Account = admin): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
}

/* ------------------------------------------------ the server's public API */

export interface ApiResult<T> {
  status: number;
  body: T;
}

/** Calls the API from inside the page, as the page's own principal (cookies and CSRF token). */
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
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // not JSON
      }
      return { status: response.status, body: parsed as never };
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
  const url = new URL(body.url, stack.baseUrl);
  return { id: body.share.id, path: `${url.pathname}${url.search}${url.hash}` };
}

/* ---------------------------------------------------------------- editor */

export const editorRoot = (page: Page) => page.getByTestId('rd-editor');
export const editorContent = (page: Page) => page.getByTestId('rd-editor-content');
export const saveState = (page: Page) => page.getByTestId('rd-status-save');
export const connectionState = (page: Page) => page.getByTestId('rd-status-connection');

export async function expectEditorReady(page: Page): Promise<void> {
  await expect(editorRoot(page)).toHaveAttribute('data-ready', 'true');
  await expect(connectionState(page)).toHaveAttribute('data-state', 'live');
}

export async function openDocument(page: Page, documentId: string): Promise<void> {
  await page.goto(`/d/${documentId}`);
  await expectEditorReady(page);
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

export async function exportedMarkdown(page: Page, documentId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/export?format=md`);
    return response.ok ? response.text() : `HTTP ${response.status}`;
  }, documentId);
}

export async function exportedJson(page: Page, documentId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/export?format=json`);
    return response.ok ? response.text() : `HTTP ${response.status}`;
  }, documentId);
}

/** Paragraph texts of the editor as the reader sees them. */
export async function paragraphs(page: Page): Promise<string[]> {
  return editorContent(page)
    .locator('p')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        // Other people's caret labels are drawn inside the paragraph; they are not content.
        const copy = node.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.rd-caret').forEach((caret) => caret.remove());
        return (copy.textContent ?? '').trim();
      }),
    );
}

/** Number of non-overlapping occurrences of `needle` in `text`. */
export function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/* --------------------------------------------------------------- control */

async function control(path: string): Promise<void> {
  const response = await fetch(`${stack.controlUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.controlToken}` },
  });
  if (!response.ok)
    throw new Error(`control ${path}: HTTP ${response.status} ${await response.text()}`);
}
export const killServer = (): Promise<void> => control('/server/kill');
export const stopServer = (): Promise<void> => control('/server/stop');
export const startServer = (): Promise<void> => control('/server/start');
/** Restarts the server with settings such as `COLLAB_TICKET_TTL_SECONDS=1`; no argument restores the defaults. */
export const configureServer = (settings: Record<string, string> = {}): Promise<void> =>
  control(`/server/config?${new URLSearchParams(settings).toString()}`);
export const stopDatabase = (): Promise<void> => control('/db/stop');
export const startDatabase = (): Promise<void> => control('/db/start');

/* --------------------------------------------------------------- images */

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A valid PNG filled with one colour; different colours give different bytes. */
export function solidPng(rgb: [number, number, number], width = 48, height = 32): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A real paste event with HTML (and optional plain text), through the editor's own pipeline. */
export async function pasteHtml(page: Page, html: string, text?: string): Promise<'event' | 'api'> {
  return page.evaluate(
    ({ html, text }) => {
      const target = document.querySelector('[data-testid="rd-editor-content"]') as HTMLElement & {
        editor: {
          view: { pasteHTML(html: string): void };
          commands: {
            insertContentAt(position: number, content: unknown): boolean;
            focus(position: 'end'): boolean;
          };
          state: { doc: { content: { size: number } } };
        };
      };
      // Where the paste lands is not what is under test: put the caret in a fresh paragraph at the end
      // (a click in the middle of the document would select, and the paste would then replace, whatever is there).
      target.editor.commands.insertContentAt(target.editor.state.doc.content.size, {
        type: 'paragraph',
      });
      target.editor.commands.focus('end');
      try {
        const transfer = new DataTransfer();
        transfer.setData('text/html', html);
        if (text !== undefined) transfer.setData('text/plain', text);
        const event = new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        });
        if (event.clipboardData?.getData('text/html') === html) {
          target.dispatchEvent(event);
          return 'event' as const;
        }
      } catch {
        // fall through
      }
      target.editor.view.pasteHTML(html);
      return 'api' as const;
    },
    { html, text },
  );
}
