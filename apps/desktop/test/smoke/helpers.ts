import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { readDisplay, type DisplayPicture } from '../lib/xwd.mjs';
import type { RdDesktopApi } from '../../src/shared/bridge';
import type { AppState } from '../../src/shared/state';

const require = createRequire(import.meta.url);

export const DESKTOP_ROOT = path.resolve(import.meta.dirname, '../..');
export const DIST = path.join(DESKTOP_ROOT, 'dist');
export const SCREENSHOTS = path.join(DESKTOP_ROOT, 'test-results', 'smoke', 'screens');
/** In a Node.js (non-Electron) process, `require('electron')` is the path of the binary. */
export const ELECTRON_BINARY = require('electron') as unknown as string;

/** Desktop agent scratch ports (see docs/notes/build-brief.md). */
export const PORT_A = 4441;
export const PORT_B = 4442;
export const SERVER_A = `http://127.0.0.1:${PORT_A}`;
export const SERVER_B = `http://127.0.0.1:${PORT_B}`;

export const DOC_ID = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
export const GRANT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
/** An asset of the stand-in server whose address redirects to the other server. */
export const REDIRECTING_ASSET_ID = '0b6d9d1e-52f4-4c0e-9d53-6f4a6f0a7c11';
export const SECRET = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
export const SECRET_2 = 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2H1g0F9e';
export const TOKEN = 'smoke-desktop-session-token-0123456789abcdefghij';

/**
 * Chromium's own sandbox stays ON by default. The unprivileged test container
 * only needs Docker's seccomp filter relaxed (`--security-opt
 * seccomp=unconfined`, set by scripts/smoke.mjs) so Chromium can create its
 * user namespaces. `RD_SMOKE_NO_SANDBOX=1` is the documented fallback for
 * environments where even that is impossible.
 */
const SANDBOX_ARGS = process.env.RD_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];

export function makeUserData(seed?: (directory: string) => void): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-smoke-'));
  seed?.(directory);
  return directory;
}

export interface LaunchOptions {
  userData?: string;
  env?: Record<string, string>;
  args?: string[];
  /** The built app to start. Default: the development build in `dist/`. */
  appDirectory?: string;
}

export interface RunningApp {
  app: ElectronApplication;
  panel: Page;
  userData: string;
  stderr: string[];
  close: () => Promise<void>;
}

export async function launchApp(options: LaunchOptions = {}): Promise<RunningApp> {
  const userData = options.userData ?? makeUserData();
  const app = await _electron.launch({
    executablePath: ELECTRON_BINARY,
    args: [...SANDBOX_ARGS, ...(options.args ?? []), options.appDirectory ?? DIST],
    env: {
      ...(process.env as Record<string, string>),
      RD_DESKTOP_USER_DATA: userData,
      RD_DESKTOP_TEST_HOOK: '1',
      ...options.env,
    },
    timeout: 60_000,
  });
  const stderr: string[] = [];
  app.process().stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
  const panel = await app.firstWindow({ timeout: 60_000 });
  await panel.waitForSelector('[data-testid="rd-panel"][data-collapsed]', { timeout: 30_000 });
  return {
    app,
    panel,
    userData,
    stderr,
    close: async () => {
      await app.close().catch(() => undefined);
    },
  };
}

/** Starts a second process of the app with the same profile (deep links arrive this way on Windows/Linux). */
export function launchSecondInstance(
  userData: string,
  extraArgs: string[],
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON_BINARY, [...SANDBOX_ARGS, DIST, ...extraArgs], {
      env: { ...process.env, RD_DESKTOP_USER_DATA: userData, RD_DESKTOP_TEST_HOOK: '1' },
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error('The second instance did not exit: the single-instance lock was not honoured.'),
      );
    }, 30_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.on('error', reject);
  });
}

// ── Renderer helpers ───────────────────────────────────────────────────────

declare global {
  interface Window {
    rdDesktop?: RdDesktopApi;
  }
}

export function getState(page: Page): Promise<AppState> {
  return page.evaluate(() => {
    if (!window.rdDesktop) throw new Error('bridge missing');
    return window.rdDesktop.getState();
  });
}

/** The complete state, as the main process holds it. (The panel is given a reduced copy.) */
export function getMainState(app: ElectronApplication): Promise<AppState> {
  return app.evaluate(() =>
    (
      globalThis as unknown as { __rdTest: { controller: { getState(): AppState } } }
    ).__rdTest.controller.getState(),
  );
}

export async function waitForState(
  page: Page,
  predicate: (state: AppState) => boolean,
  description: string,
  timeoutMs = 15_000,
): Promise<AppState> {
  const deadline = Date.now() + timeoutMs;
  let last: AppState | null = null;
  while (Date.now() < deadline) {
    try {
      last = await getState(page);
      if (predicate(last)) return last;
    } catch {
      // The panel reloads when the server changes (new Content-Security-Policy);
      // a call made during the reload fails and is simply retried.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for: ${description}. Last panel state: ${JSON.stringify(last?.panel)}`,
  );
}

export async function screenshot(page: Page, name: string, transparent = true): Promise<string> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  const file = path.join(SCREENSHOTS, `${name}.png`);
  await page.screenshot({ path: file, omitBackground: transparent });
  return file;
}

// ── Main-process helpers ───────────────────────────────────────────────────

export interface WindowFacts {
  kind: string;
  url: string;
  bounds: { x: number; y: number; width: number; height: number };
  contentBounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  focused: boolean;
  resizable: boolean;
  maximizable: boolean;
  alwaysOnTop: boolean;
  backgroundColor: string;
  sandbox: unknown;
  contextIsolation: unknown;
  nodeIntegration: unknown;
  webSecurity: unknown;
}

/** Facts about every app window, read from Electron itself (not from the app's own state). */
export function windowFacts(app: ElectronApplication): Promise<WindowFacts[]> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => {
      const url = window.webContents.getURL();
      // `getLastWebPreferences` exists at runtime but is not part of Electron's
      // documented API, so it is used only if present and only as supporting
      // evidence; the tests rely on what the page can actually do.
      const reader = (
        window.webContents as unknown as {
          getLastWebPreferences?: () => Record<string, unknown> | null;
        }
      ).getLastWebPreferences;
      const preferences = typeof reader === 'function' ? reader.call(window.webContents) : null;
      return {
        kind: /\/(\w+)\.html/.exec(url)?.[1] ?? 'unknown',
        url,
        bounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        visible: window.isVisible(),
        focused: window.isFocused(),
        resizable: window.isResizable(),
        maximizable: window.isMaximizable(),
        alwaysOnTop: window.isAlwaysOnTop(),
        backgroundColor: window.getBackgroundColor(),
        sandbox: preferences?.sandbox,
        contextIsolation: preferences?.contextIsolation,
        nodeIntegration: preferences?.nodeIntegration,
        webSecurity: preferences?.webSecurity,
      };
    }),
  );
}

export async function panelFacts(app: ElectronApplication): Promise<WindowFacts> {
  const facts = (await windowFacts(app)).find((window) => window.kind === 'panel');
  if (!facts) throw new Error('panel window not found');
  return facts;
}

export interface AppResponse {
  status: number;
  csp: string | null;
  contentType: string | null;
  nosniff: string | null;
}

/**
 * Requests an `app://` URL through the app's own session from the main
 * process. (A page cannot `fetch` it: the policy's `connect-src` forbids that.)
 */
export function appFetch(
  app: ElectronApplication,
  target: string,
  method = 'GET',
): Promise<AppResponse | 'failed'> {
  return app.evaluate(
    async ({ session }, [url, verb]) => {
      try {
        const response = await session
          .fromPartition('persist:realtimedocs')
          .fetch(url as string, { method: verb as string });
        // Always drain the body: an unread main-process response keeps its request alive.
        await response.arrayBuffer().catch(() => undefined);
        return {
          status: response.status,
          csp: response.headers.get('content-security-policy'),
          contentType: response.headers.get('content-type'),
          nosniff: response.headers.get('x-content-type-options'),
        };
      } catch {
        return 'failed' as const;
      }
    },
    [target, method],
  );
}

/**
 * Replaces `shell.openExternal` with a recorder so the test can see which
 * links would be handed to the operating system without opening anything.
 */
export async function recordExternalOpens(
  app: ElectronApplication,
): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const calls: string[] = [];
    (globalThis as { __externalOpens?: string[] }).__externalOpens = calls;
    shell.openExternal = (url: string) => {
      calls.push(url);
      return Promise.resolve();
    };
  });
  return () =>
    app.evaluate(() => (globalThis as { __externalOpens?: string[] }).__externalOpens ?? []);
}

// ── The main process's own dialogs ─────────────────────────────────────────

export interface DialogCall {
  /** Kind of the window the dialog was attached to (`panel`, `settings`) or null. */
  parent: string | null;
  type: string | null;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number | null;
  cancelId: number | null;
  /** The app handed over a signal with which it can withdraw the question. */
  withdrawable: boolean;
}

export interface DialogControl {
  /** Every message box the main process asked for, oldest first. */
  calls: () => Promise<DialogCall[]>;
  /**
   * `real`: the native dialog is shown (nothing in a test can press its
   * buttons; `cancelOpen` closes it the way Escape would). `yes` / `no`: no
   * dialog is shown and the answer is given at once, by pressing the button
   * that is, or is not, "Cancel".
   */
  answerWith: (mode: 'real' | 'yes' | 'no') => Promise<void>;
  /** Closes the native dialogs that are open, as if each had been cancelled. Returns how many. */
  cancelOpen: () => Promise<number>;
}

/**
 * Takes control of `dialog.showMessageBox` in the main process. Pages cannot
 * reach that function at all; this is the test standing in for the person at
 * the keyboard, and recording what the app asked.
 */
export async function controlDialogs(app: ElectronApplication): Promise<DialogControl> {
  await app.evaluate(({ dialog }) => {
    interface Control {
      mode: 'real' | 'yes' | 'no';
      calls: unknown[];
      open: AbortController[];
    }
    const holder = globalThis as { __rdDialogs?: Control };
    if (holder.__rdDialogs) return;
    const control: Control = { mode: 'real', calls: [], open: [] };
    holder.__rdDialogs = control;
    const real = dialog.showMessageBox.bind(dialog) as (
      ...args: unknown[]
    ) => Promise<Electron.MessageBoxReturnValue>;
    dialog.showMessageBox = ((...args: unknown[]) => {
      const parent = args.length === 2 ? (args[0] as Electron.BrowserWindow) : null;
      const options = (args.length === 2 ? args[1] : args[0]) as Electron.MessageBoxOptions;
      const buttons = options.buttons ?? [];
      control.calls.push({
        parent: parent
          ? (/\/(\w+)\.html/.exec(parent.webContents.getURL())?.[1] ?? 'unknown')
          : null,
        type: options.type ?? null,
        message: options.message,
        detail: options.detail ?? '',
        buttons,
        defaultId: options.defaultId ?? null,
        cancelId: options.cancelId ?? null,
        withdrawable: options.signal instanceof AbortSignal,
      });
      if (control.mode !== 'real') {
        const cancel = buttons.indexOf('Cancel');
        const other = buttons.findIndex((label) => label !== 'Cancel');
        return Promise.resolve({
          response: control.mode === 'yes' ? other : cancel,
          checkboxChecked: false,
        });
      }
      const cancelled = new AbortController();
      control.open.push(cancelled);
      const signal = options.signal
        ? AbortSignal.any([options.signal, cancelled.signal])
        : cancelled.signal;
      return parent ? real(parent, { ...options, signal }) : real({ ...options, signal });
    }) as typeof dialog.showMessageBox;
  });
  type Holder = {
    __rdDialogs: { mode: string; calls: DialogCall[]; open: AbortController[] };
  };
  return {
    calls: () => app.evaluate(() => (globalThis as unknown as Holder).__rdDialogs.calls),
    answerWith: (mode) =>
      app.evaluate((_electron, value) => {
        (globalThis as unknown as Holder).__rdDialogs.mode = value;
      }, mode),
    cancelOpen: () =>
      app.evaluate(() => {
        const control = (globalThis as unknown as Holder).__rdDialogs;
        const open = control.open.splice(0);
        for (const entry of open) entry.abort();
        return open.length;
      }),
  };
}

export interface SaveDialogCall {
  /** Kind of the window the dialog was attached to, or null. */
  parent: string | null;
  title: string | null;
  /** The file name the app proposed. */
  defaultName: string;
  /** The folder the app proposed. */
  defaultFolder: string;
  properties: string[];
}

export interface SaveDialogControl {
  calls: () => Promise<SaveDialogCall[]>;
  /** From now on the dialog answers at once: with this file, or (null) as if cancelled. */
  answerWith: (filePath: string | null) => Promise<void>;
  /** From now on the dialog stays open until `release`. */
  hold: () => Promise<void>;
  /** Answers every dialog that is being held, and stops holding. */
  release: (filePath: string | null) => Promise<void>;
}

/**
 * Stands in for the person at the operating system's save dialog, which
 * nothing in a test can click. Pages cannot reach `dialog.showSaveDialog`.
 */
export async function controlSaveDialog(app: ElectronApplication): Promise<SaveDialogControl> {
  await app.evaluate(({ dialog }) => {
    interface Control {
      answer: string | null;
      held: boolean;
      waiting: ((filePath: string | null) => void)[];
      calls: unknown[];
    }
    const holder = globalThis as { __rdSaveDialog?: Control };
    if (holder.__rdSaveDialog) return;
    const control: Control = { answer: null, held: false, waiting: [], calls: [] };
    holder.__rdSaveDialog = control;
    const result = (filePath: string | null): Electron.SaveDialogReturnValue =>
      filePath === null ? { canceled: true, filePath: '' } : { canceled: false, filePath };
    dialog.showSaveDialog = ((...args: unknown[]) => {
      const parent = args.length === 2 ? (args[0] as Electron.BrowserWindow) : null;
      const options = (args.length === 2 ? args[1] : args[0]) as Electron.SaveDialogOptions;
      const proposed = options.defaultPath ?? '';
      const separator = Math.max(proposed.lastIndexOf('/'), proposed.lastIndexOf('\\'));
      control.calls.push({
        parent: parent
          ? (/\/(\w+)\.html/.exec(parent.webContents.getURL())?.[1] ?? 'unknown')
          : null,
        title: options.title ?? null,
        defaultName: proposed.slice(separator + 1),
        defaultFolder: proposed.slice(0, Math.max(separator, 0)),
        properties: options.properties ?? [],
      });
      if (control.held) {
        return new Promise<Electron.SaveDialogReturnValue>((resolve) => {
          control.waiting.push((filePath) => resolve(result(filePath)));
        });
      }
      return Promise.resolve(result(control.answer));
    }) as typeof dialog.showSaveDialog;
  });
  type Holder = {
    __rdSaveDialog: {
      answer: string | null;
      held: boolean;
      waiting: ((filePath: string | null) => void)[];
      calls: SaveDialogCall[];
    };
  };
  return {
    calls: () => app.evaluate(() => (globalThis as unknown as Holder).__rdSaveDialog.calls),
    answerWith: (filePath) =>
      app.evaluate((_electron, value) => {
        const control = (globalThis as unknown as Holder).__rdSaveDialog;
        control.held = false;
        control.answer = value;
      }, filePath),
    hold: () =>
      app.evaluate(() => {
        (globalThis as unknown as Holder).__rdSaveDialog.held = true;
      }),
    release: (filePath) =>
      app.evaluate((_electron, value) => {
        const control = (globalThis as unknown as Holder).__rdSaveDialog;
        control.held = false;
        for (const answer of control.waiting.splice(0)) answer(value);
      }, filePath),
  };
}

/**
 * A picture of the whole X display, native dialogs included, saved next to the
 * page screenshots. Null when the display is not an Xvfb started with a
 * framebuffer directory (scripts/smoke.mjs does that; `--native` runs do not).
 */
export function displayPicture(name: string): (DisplayPicture & { file: string }) | null {
  const picture = readDisplay(process.env.RD_XVFB_FBDIR);
  if (!picture) return null;
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  const file = path.join(SCREENSHOTS, `${name}.png`);
  fs.writeFileSync(file, picture.png);
  return { ...picture, file };
}

// ── Fake RealtimeDocs server ───────────────────────────────────────────────

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  upgrade: boolean;
}

export interface FakeServer {
  origin: string;
  requests: RecordedRequest[];
  /** Number of times the handoff code was presented (the second use is refused). */
  redeemCount: () => number;
  setPublicOrigin: (origin: string) => void;
  clear: () => void;
  close: () => Promise<void>;
}

const CORS = {
  'access-control-allow-origin': 'app://realtimedocs',
  'access-control-allow-headers': 'content-type, accept, x-rd-csrf',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  vary: 'origin',
};

// 1x1 transparent PNG.
export const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export async function startFakeServer(port: number, redirectTarget?: string): Promise<FakeServer> {
  const origin = `http://127.0.0.1:${port}`;
  const requests: RecordedRequest[] = [];
  let publicOrigin = origin;
  let redeems = 0;

  const json = (response: http.ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json', ...CORS });
    response.end(JSON.stringify(body));
  };
  const apiError = (response: http.ServerResponse, status: number, code: string) =>
    json(response, status, { error: { code, message: code } });

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', origin);
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        headers: request.headers,
        body,
        upgrade: false,
      });
      const authorization = request.headers.authorization ?? null;

      if (request.method === 'OPTIONS') {
        response.writeHead(204, CORS);
        response.end();
        return;
      }
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /api/meta':
          json(response, 200, {
            name: 'RealtimeDocs',
            version: '0.1.0-smoke',
            schemaVersion: 1,
            minClientSchemaVersion: 1,
            protocolVersion: 1,
            publicOrigin,
            limits: {},
            imageMimeTypes: [],
            attachmentExtensions: [],
          });
          return;
        case 'POST /api/share/exchange': {
          const parsed = JSON.parse(body || '{}') as {
            grantId?: string;
            secret?: string;
            mode?: string;
          };
          if (parsed.grantId !== GRANT_ID || parsed.secret !== SECRET || parsed.mode !== 'bearer') {
            apiError(response, 404, 'share_invalid');
            return;
          }
          json(response, 200, {
            documentId: DOC_ID,
            title: 'Smoke test notes',
            role: 'viewer',
            expiresAt: null,
            token: TOKEN,
          });
          return;
        }
        case 'POST /api/desktop/redeem': {
          const parsed = JSON.parse(body || '{}') as { documentId?: string; code?: string };
          redeems += 1;
          // Single use: the same code works once.
          if (parsed.documentId !== DOC_ID || parsed.code !== SECRET || redeems > 1) {
            apiError(response, 400, 'handoff_invalid');
            return;
          }
          json(response, 200, {
            token: TOKEN,
            documentId: DOC_ID,
            title: 'Handoff document',
            role: 'editor',
            expiresAt: null,
            accountId: GRANT_ID,
          });
          return;
        }
        case 'GET /api/desktop/session':
          if (authorization !== `Bearer ${TOKEN}`) {
            apiError(response, 401, 'unauthenticated');
            return;
          }
          json(response, 200, {
            documentId: DOC_ID,
            title: 'Handoff document',
            role: 'editor',
            expiresAt: null,
            accountId: GRANT_ID,
          });
          return;
        case 'POST /api/desktop/logout':
          response.writeHead(204, CORS);
          response.end();
          return;
        case `POST /api/documents/${DOC_ID}/collab-ticket`:
          // This stand-in has no collaboration endpoint. "Busy" keeps the
          // editor in its retry loop instead of a final state; live documents
          // are covered by the real-stack suite (test/real).
          apiError(response, 503, 'server_busy');
          return;
        case 'POST /api/echo':
        case 'GET /api/echo':
        case 'GET /public/echo':
          // Never echoes the header value back: the page only learns whether one was present.
          json(response, 200, { path: url.pathname, hadAuthorization: authorization !== null });
          return;
        case 'GET /api/redirect-same-origin':
          response.writeHead(307, { location: '/public/echo', ...CORS });
          response.end();
          return;
        case 'GET /api/redirect-api':
          // Stays on the same server and inside the API.
          response.writeHead(307, { location: '/api/echo', ...CORS });
          response.end();
          return;
        case 'GET /api/redirect-foreign':
          response.writeHead(307, { location: `${redirectTarget ?? origin}/api/echo`, ...CORS });
          response.end();
          return;
        case `GET /api/documents/${DOC_ID}/assets/${GRANT_ID}`:
          response.writeHead(200, {
            'content-type': 'image/png',
            'cache-control': 'no-store',
            // A name no honest server would send: a path out of the folder the person chose.
            'content-disposition': `attachment; filename="x"; filename*=UTF-8''..%2F..%2F.ssh%2Fauthorized_keys`,
          });
          response.end(PIXEL);
          return;
        case `GET /api/documents/${DOC_ID}/assets/${REDIRECTING_ASSET_ID}`:
          // Something the real server never does: send an asset request elsewhere.
          response.writeHead(307, { location: `${redirectTarget ?? origin}/api/echo` });
          response.end();
          return;
        default:
          apiError(response, 404, 'not_found');
      }
    });
  });

  // Minimal WebSocket handshake so the upgrade request's headers can be inspected.
  server.on('upgrade', (request, socket) => {
    requests.push({
      method: request.method ?? '',
      path: new URL(request.url ?? '/', origin).pathname,
      headers: request.headers,
      body: '',
      upgrade: true,
    });
    const key = request.headers['sec-websocket-key'] ?? '';
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    setTimeout(() => socket.destroy(), 200);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    origin,
    requests,
    redeemCount: () => redeems,
    setPublicOrigin: (value) => {
      publicOrigin = value;
    },
    clear: () => {
      requests.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function handoffUrl(server: string, code = SECRET): string {
  const query = new URLSearchParams({ server, doc: DOC_ID, code });
  return `realtimedocs://open?${query.toString()}`;
}

export function shareUrl(server: string, secret = SECRET): string {
  return `${server}/s/${GRANT_ID}#${secret}`;
}

// ── PNG decoding (to check real pixels of a screenshot) ────────────────────

export interface DecodedPng {
  width: number;
  height: number;
  pixel: (x: number, y: number) => [number, number, number, number];
}

/** Decodes the 8-bit RGBA, non-interlaced PNGs that Chromium screenshots produce. */
export function decodePng(file: string): DecodedPng {
  const data = fs.readFileSync(file);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9] ?? 0;
      if (body[8] !== 8 || (colorType !== 6 && colorType !== 2) || body[12] !== 0) {
        throw new Error('Unsupported PNG format');
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const index = y * stride + x * channels;
      return [
        pixels[index] ?? 0,
        pixels[index + 1] ?? 0,
        pixels[index + 2] ?? 0,
        channels === 4 ? (pixels[index + 3] ?? 0) : 255,
      ];
    },
  };
}
