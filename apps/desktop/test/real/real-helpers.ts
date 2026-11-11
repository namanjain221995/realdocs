/**
 * Shared steps of the real-stack specs: starting the desktop app, pointing it
 * at the real server, opening documents the way a user would, and reading
 * facts about windows from Electron itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  DESKTOP_ROOT,
  launchApp,
  waitForState,
  type LaunchOptions,
  type RunningApp,
} from '../smoke/helpers';
import { RemoteClient } from './collab-client';
import { SERVER_ORIGIN, adminAccount } from './stack';

export const SCREENS = path.join(DESKTOP_ROOT, 'test-results', 'real', 'screens');

export async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SCREENS, { recursive: true });
  const file = path.join(SCREENS, `${name}.png`);
  await page.screenshot({ path: file, omitBackground: true });
  return file;
}

type ControllerResult = { ok: true } | { ok: false; code: string; message: string };

/** Calls a method of the app controller through the test hook, reporting a thrown error as data. */
export function callController(
  app: ElectronApplication,
  method: string,
  ...args: unknown[]
): Promise<ControllerResult> {
  return app.evaluate(
    async (_electron, [name, parameters]) => {
      const controller = (
        globalThis as unknown as {
          __rdTest: { controller: Record<string, (...values: unknown[]) => unknown> };
        }
      ).__rdTest.controller;
      try {
        await controller[name as string]?.(...(parameters as unknown[]));
        return { ok: true as const };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        return {
          ok: false as const,
          code: failure.code ?? 'unknown',
          message: failure.message ?? '',
        };
      }
    },
    [method, args] as const,
  );
}

/** Reads a value from the app controller through the test hook. */
export function readController<T>(app: ElectronApplication, method: string): Promise<T> {
  return app.evaluate((_electron, name) => {
    const controller = (
      globalThis as unknown as {
        __rdTest: { controller: Record<string, () => unknown> };
      }
    ).__rdTest.controller;
    return controller[name]?.() as never;
  }, method) as Promise<T>;
}

export interface ConsoleEntry {
  window: string;
  level: string;
  source: string;
  line: number;
  message: string;
}

export interface PolicyViolation {
  window: string;
  directive: string;
  blocked: string;
  source: string;
  line: number;
}

/** Console warnings and errors of every renderer, recorded by the main process. */
export const consoleEntries = (app: ElectronApplication) =>
  readController<ConsoleEntry[]>(app, 'rendererConsoleEntries');

/** Refused Content-Security-Policy actions, reported by the preload script. */
export const policyViolations = (app: ElectronApplication) =>
  readController<PolicyViolation[]>(app, 'policyViolationRecords');

/** Starts the app with the real server already configured (as after a first run). */
export async function launchConnected(options: LaunchOptions = {}): Promise<RunningApp> {
  const running = await launchApp(options);
  const state = await waitForState(running.panel, () => true, 'first state');
  // A first start opens the Safe Share Guide; a person closes it before working.
  if (state.guide.open) {
    await running.panel.click('[data-testid="rd-share-guide-dismiss"]');
    await waitForState(running.panel, (current) => !current.guide.open, 'guide closed');
  }
  if (state.connection.server.origin !== SERVER_ORIGIN) {
    // The panel reloads when the server changes (new Content-Security-Policy).
    // Mark the current page so the wait below is for the new one.
    await running.panel.evaluate(() => {
      (globalThis as { __beforeServerChange?: boolean }).__beforeServerChange = true;
    });
    expect(await callController(running.app, 'setServer', SERVER_ORIGIN)).toEqual({ ok: true });
    await running.panel.waitForFunction(
      () =>
        (globalThis as { __beforeServerChange?: boolean }).__beforeServerChange === undefined &&
        document.querySelector('[data-testid="rd-panel"][data-collapsed]') !== null,
      undefined,
      { timeout: 30_000 },
    );
  }
  await waitForState(
    running.panel,
    (current) =>
      current.connection.server.origin === SERVER_ORIGIN &&
      current.connection.server.status === 'ok',
    'the real server to check out',
  );
  await running.panel.waitForSelector('[data-testid="rd-paste-input"]', { timeout: 30_000 });
  return running;
}

/** Pastes a share link into the panel's own field and presses Open, like a user. */
export async function pasteShareLink(panel: Page, url: string): Promise<void> {
  await panel.locator('[data-testid="rd-paste-input"]').fill(url);
  await panel.locator('[data-testid="rd-paste-submit"]').click();
}

/** The header says Live and the editor has applied the first sync. */
export async function waitLive(panel: Page, timeoutMs = 30_000): Promise<void> {
  await expect(panel.locator('[data-testid="rd-header-connection"]')).toHaveAttribute(
    'data-state',
    'live',
    { timeout: timeoutMs },
  );
  await expect(panel.locator('[data-testid="rd-editor"]')).toHaveAttribute('data-ready', 'true', {
    timeout: timeoutMs,
  });
}

export const editorContent = (panel: Page) => panel.locator('[data-testid="rd-editor-content"]');

// ── Documents and links, created by the administrator over HTTP ────────────

export interface ShareLink {
  id: string;
  url: string;
}

export async function createShare(
  documentId: string,
  role: 'viewer' | 'editor',
  expiresAt?: string,
): Promise<ShareLink> {
  const admin = await adminAccount();
  const created = await admin.api.shares.create(documentId, {
    role,
    ...(expiresAt ? { expiresAt } : {}),
  });
  return { id: created.share.id, url: created.url };
}

/** The sample document the server's `seed-sample` command created. */
export async function sampleDocumentId(): Promise<string> {
  const admin = await adminAccount();
  const { documents } = await admin.api.documents.list({ view: 'active', q: 'sample' });
  const sample = documents.find((document) => document.title.includes('sample'));
  if (!sample) throw new Error('The sample document was not found.');
  return sample.id;
}

/** A new document with the given paragraphs, written through the collaboration endpoint and stored. */
export async function createDocument(title: string, paragraphs: string[] = []): Promise<string> {
  const admin = await adminAccount();
  const { document } = await admin.api.documents.create({ title });
  if (paragraphs.length > 0) {
    const writer = await RemoteClient.connect(admin.api, document.id, SERVER_ORIGIN);
    writer.appendParagraphs(paragraphs);
    await writer.saved();
    writer.destroy();
  }
  return document.id;
}

/** A collaborator signed in as the administrator, connected to `documentId`. */
export async function remoteEditor(documentId: string): Promise<RemoteClient> {
  const admin = await adminAccount();
  return RemoteClient.connect(admin.api, documentId, SERVER_ORIGIN);
}

// ── Window facts, read from Electron (not from the app's own state) ────────

export interface FocusFacts {
  /** Kind of the focused window (`panel`, `settings`, …) or `none`. */
  focused: string;
  panelFocused: boolean;
  panelVisible: boolean;
  panelMinimized: boolean;
  panelBounds: { x: number; y: number; width: number; height: number };
}

export function focusFacts(app: ElectronApplication): Promise<FocusFacts> {
  return app.evaluate(({ BrowserWindow }) => {
    const kind = (window: Electron.BrowserWindow | null) =>
      window ? (/\/(\w+)\.html/.exec(window.webContents.getURL())?.[1] ?? 'unknown') : 'none';
    const panel = BrowserWindow.getAllWindows().find((window) => kind(window) === 'panel');
    if (!panel) throw new Error('panel window not found');
    return {
      focused: kind(BrowserWindow.getFocusedWindow()),
      panelFocused: panel.isFocused(),
      panelVisible: panel.isVisible(),
      panelMinimized: panel.isMinimized(),
      panelBounds: panel.getBounds(),
    };
  });
}

export function focusWindow(app: ElectronApplication, kind: string): Promise<void> {
  return app.evaluate(({ BrowserWindow }, target) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes(`/${target}.html`))
      ?.focus();
  }, kind);
}

export async function pageByKind(app: ElectronApplication, kind: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((page) => page.url().includes(`/${kind}.html`)), {
      timeout: 20_000,
    })
    .toBe(true);
  const page = app.windows().find((candidate) => candidate.url().includes(`/${kind}.html`));
  if (!page) throw new Error(`${kind} window did not open`);
  return page;
}

// ── Steps shared by several specs ───────────────────────────────────────────

export const headerConnection = (panel: Page) =>
  panel.locator('[data-testid="rd-header-connection"]');
export const headerSave = (panel: Page) => panel.locator('[data-testid="rd-header-save"]');

/**
 * Reads an attribute with a plain script evaluation. After the app has refused
 * a navigation, Playwright's locators keep waiting for that navigation to
 * finish; an evaluation does not.
 */
export function attributeOf(page: Page, selector: string, name: string): Promise<string | null> {
  return page.evaluate(
    ([target, attribute]) => document.querySelector(target)?.getAttribute(attribute) ?? null,
    [selector, name] as const,
  );
}

/** The state of the header's connection chip, read as `attributeOf` does. */
export const connectionStateOf = (panel: Page) =>
  attributeOf(panel, '[data-testid="rd-header-connection"]', 'data-state');

/** Opens the settings window from the panel, like the header button does, and returns its page. */
export async function openSettings(running: RunningApp, tab = 'connection'): Promise<Page> {
  await running.panel.evaluate(
    (name) => window.rdDesktop?.window.action('open-settings', { tab: name as 'connection' }),
    tab,
  );
  return pageByKind(running.app, 'settings');
}

/** Pastes the link in a panel that already knows the server, and waits for the live document. */
export async function openShare(running: RunningApp, share: ShareLink): Promise<void> {
  await pasteShareLink(running.panel, share.url);
  await waitForState(
    running.panel,
    (state) => state.connection.session !== null,
    'the document session',
  );
  await waitLive(running.panel);
}

/** Puts the caret at the end of the document and types, like a person would. */
export async function typeAtEnd(panel: Page, text: string): Promise<void> {
  await editorContent(panel).click();
  await panel.keyboard.press('Control+End');
  await panel.keyboard.type(text, { delay: 5 });
}

/** The session token, read inside the main process. Never printed; used to prove it appears nowhere else. */
export function mainProcessToken(app: ElectronApplication): Promise<string | null> {
  return app.evaluate(() => {
    const controller = (
      globalThis as unknown as {
        __rdTest: {
          controller: { connection: { authContext(): { token: string | null } } };
        };
      }
    ).__rdTest.controller;
    return controller.connection.authContext().token;
  });
}

/** Everything a page script could read in the panel: markup, app state, storage, resource URLs. */
export function rendererVisibleText(panel: Page): Promise<string> {
  return panel.evaluate(async () => {
    const state = await window.rdDesktop?.getState();
    const storage = (area: Storage) =>
      Object.keys(area)
        .map((key) => `${key}=${area.getItem(key) ?? ''}`)
        .join('\n');
    const databases =
      typeof indexedDB.databases === 'function'
        ? (await indexedDB.databases()).map((database) => database.name ?? '').join('\n')
        : '';
    return [
      document.documentElement.outerHTML,
      JSON.stringify(state),
      storage(localStorage),
      storage(sessionStorage),
      databases,
      document.cookie,
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .join('\n'),
    ].join('\n');
  });
}

/** The server's log of this run (it runs outside the test container; the file is shared). */
export function serverLogText(): string {
  return fs.readFileSync(path.join(DESKTOP_ROOT, '.stage', 'real', 'server.log'), 'utf8');
}
