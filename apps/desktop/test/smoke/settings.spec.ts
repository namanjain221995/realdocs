import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  PORT_A,
  SERVER_A,
  appFetch,
  getState,
  launchApp,
  panelFacts,
  screenshot,
  shareUrl,
  startFakeServer,
  waitForState,
  windowFacts,
  type FakeServer,
  type RunningApp,
  controlSaveDialog,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let running: RunningApp;
let server: FakeServer;
let settings: Page;

async function pageByKind(app: ElectronApplication, kind: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((page) => page.url().includes(`/${kind}.html`)), {
      timeout: 20_000,
    })
    .toBe(true);
  const page = app.windows().find((candidate) => candidate.url().includes(`/${kind}.html`));
  if (!page) throw new Error(`${kind} window not found`);
  return page;
}

const tab = (name: RegExp) => settings.getByRole('tab', { name });

test.beforeAll(async () => {
  server = await startFakeServer(PORT_A);
  running = await launchApp();
});

test.afterAll(async () => {
  await running.close();
  await server.close();
});

test('settings opens from the panel menu as an ordinary, isolated, offline window', async () => {
  await running.panel.click('[data-testid="rd-more-button"]');
  await running.panel.click('[data-testid="rd-open-settings"]');
  settings = await pageByKind(running.app, 'settings');
  await settings.waitForSelector('[data-testid="rd-settings"]');

  const facts = (await windowFacts(running.app)).find((window) => window.kind === 'settings');
  expect(facts).toBeDefined();
  expect(facts?.url).toBe('app://realtimedocs/settings.html');
  expect(facts?.visible).toBe(true);
  expect(facts?.resizable).toBe(true);
  expect(facts?.alwaysOnTop).toBe(false);
  expect((await getState(running.panel)).settings.open).toBe(true);

  // Same isolation as the panel, and no network access at all.
  const isolation = await settings.evaluate(() => {
    const scope = globalThis as Record<string, unknown>;
    return {
      require: typeof scope.require,
      process: typeof scope.process,
      bridge: typeof window.rdDesktop,
    };
  });
  expect(isolation).toEqual({ require: 'undefined', process: 'undefined', bridge: 'object' });
  const page = await appFetch(running.app, 'app://realtimedocs/settings.html');
  if (page === 'failed') throw new Error('settings page not served');
  expect(page.csp).toContain("connect-src 'none'");
  expect(
    await settings.evaluate(() =>
      fetch('http://127.0.0.1:4441/api/meta').then(
        () => 'reached',
        () => 'blocked',
      ),
    ),
  ).toBe('blocked');

  // Opening it again focuses the existing window instead of creating another.
  await running.panel.evaluate(() => window.rdDesktop?.window.action('open-settings'));
  await running.panel.waitForTimeout(300);
  expect(
    (await windowFacts(running.app)).filter((window) => window.kind === 'settings'),
  ).toHaveLength(1);
});

test('Connection: set the server, see honest transport and storage status, open a document', async () => {
  await expect(settings.getByText('“localhost” means this computer')).toBeVisible();
  await expect(settings.locator('[data-testid="rd-server-status"]')).toHaveAttribute(
    'data-status',
    'unset',
  );

  // A refused address is explained next to the field; nothing is contacted.
  await settings.fill('[data-testid="rd-server-input"]', 'http://192.168.1.20:4310');
  await settings.click('[data-testid="rd-server-save"]');
  await expect(settings.getByText(/plain HTTP on a private network/)).toBeVisible();
  expect(server.requests).toHaveLength(0);

  await settings.fill('[data-testid="rd-server-input"]', `127.0.0.1:${PORT_A}`);
  await settings.click('[data-testid="rd-server-save"]');
  await expect(settings.locator('[data-testid="rd-server-status"]')).toHaveAttribute(
    'data-status',
    'ok',
  );
  await expect(settings.locator('[data-testid="rd-server-status"]')).toContainText(
    'This computer (localhost)',
  );
  await expect(settings.locator('[data-testid="rd-server-message"]')).toContainText(
    'only works while your tunnel is open',
  );
  // The field shows the normalised origin.
  await expect(settings.locator('[data-testid="rd-server-input"]')).toHaveValue(SERVER_A);

  // Credential storage: this container has no OS secret store, and the app says so.
  const storage = settings.locator('[data-testid="rd-credential-storage"]');
  if (process.platform === 'linux') {
    await expect(storage).toHaveAttribute('data-mode', 'memory_only');
    await expect(storage).toContainText('In memory only');
  }

  // Paste a share link here.
  await settings.fill('[data-testid="rd-settings-paste-input"]', shareUrl(SERVER_A));
  await settings.click('[data-testid="rd-settings-paste-submit"]');
  await expect(settings.locator('[data-testid="rd-session-facts"]')).toContainText(
    'Smoke test notes',
  );
  await expect(settings.locator('[data-testid="rd-session-facts"]')).toContainText('View only');
  await expect(settings.locator('[data-testid="rd-settings-paste-input"]')).toHaveValue('');
  await waitForState(
    running.panel,
    (state) => state.connection.session !== null,
    'document session',
  );

  if (process.platform === 'linux') {
    // Memory-only really means nothing on disk.
    expect(fs.existsSync(path.join(running.userData, 'session.bin'))).toBe(false);
  }
  await screenshot(settings, 'settings-connection', false);
});

test('Appearance: controls change the panel, never the shared document', async () => {
  await tab(/Appearance/).click();
  await settings.locator('[data-testid="rd-settings-alpha"]').fill('0.3');
  await waitForState(
    running.panel,
    (state) => state.appearance.backgroundAlpha === 0.3,
    'alpha from settings',
  );
  await settings.getByRole('radio', { name: 'Scrim' }).click({ force: true });
  await waitForState(running.panel, (state) => state.appearance.readability === 'scrim', 'scrim');
  await expect(running.panel.locator('[data-testid="rd-panel"]')).toHaveAttribute(
    'data-readability',
    'scrim',
  );
  await settings.locator('[data-testid="rd-settings-font"]').fill('1.4');
  await waitForState(running.panel, (state) => state.appearance.fontScale === 1.4, 'font scale');
  await screenshot(running.panel, 'panel-low-alpha-scrim');

  await settings.getByRole('radio', { name: 'Outline' }).click({ force: true });
  await waitForState(
    running.panel,
    (state) => state.appearance.readability === 'outline',
    'outline',
  );
  await screenshot(running.panel, 'panel-low-alpha-outline');

  await settings.click('[data-testid="rd-settings-preset-wide"]');
  await expect.poll(async () => (await panelFacts(running.app)).bounds.width).toBe(960);
  await screenshot(settings, 'settings-appearance', false);

  // None of this produced a request that could change anything on the server.
  // (The editor's collaboration-ticket requests, which this stand-in server
  // refuses, repeat in the background whatever the appearance is; the
  // real-stack suite checks that changing the appearance leaves a live
  // document untouched.)
  const unexpected = server.requests
    .filter(
      (request) =>
        request.method !== 'GET' &&
        request.method !== 'OPTIONS' &&
        request.path !== '/api/share/exchange' &&
        !request.path.endsWith('/collab-ticket'),
    )
    .map((request) => `${request.method} ${request.path}`);
  expect(unexpected).toEqual([]);
  await settings.locator('[data-testid="rd-settings-alpha"]').fill('0.86');
  await settings.getByRole('radio', { name: 'Off' }).click({ force: true });
  await settings.locator('[data-testid="rd-settings-font"]').fill('1');
  await settings.click('[data-testid="rd-settings-preset-standard"]');
});

test('Behaviour: pin, recovery paths, and recording a new global shortcut', async () => {
  await tab(/Behaviour/).click();
  // The switch reflects main-process state, so it changes one round trip after the click.
  const pin = settings.locator('[data-testid="rd-settings-pin"]');
  await expect(pin).toBeChecked();
  await pin.click({ force: true });
  await expect.poll(async () => (await panelFacts(running.app)).alwaysOnTop).toBe(false);
  await expect(pin).not.toBeChecked();
  await pin.click({ force: true });
  await expect.poll(async () => (await panelFacts(running.app)).alwaysOnTop).toBe(true);
  await expect(pin).toBeChecked();

  const recovery = settings.locator('[data-testid="rd-recovery-paths"]');
  await expect(recovery).toContainText('A global shortcut is registered');
  await expect(recovery).toContainText('tray icon is available');
  await expect(recovery).toContainText('Start RealtimeDocs again');
  await expect(settings.locator('[data-testid="rd-click-through-blocked"]')).toHaveCount(0);

  // Both shortcuts are registered and shown with their key caps.
  for (const action of ['toggleVisibility', 'returnToInteractive']) {
    await expect(settings.locator(`[data-testid="rd-shortcut-${action}"]`)).toHaveAttribute(
      'data-registered',
      'true',
    );
  }

  // Record a new combination for the emergency shortcut.
  const recorder = settings.locator('[data-testid="rd-shortcut-record-returnToInteractive"]');
  await recorder.click();
  await expect(recorder).toContainText('Press the new combination');
  // While recording, the global shortcuts are paused so pressing one does nothing.
  expect((await getState(running.panel)).shortcuts.recording).toBe(true);
  // An unsuitable combination is explained and recording continues.
  await settings.keyboard.press('Control+KeyC');
  await expect(settings.locator('[data-testid="rd-shortcut-returnToInteractive"]')).toContainText(
    'Add a second modifier',
  );
  await settings.keyboard.press('Control+Alt+Shift+KeyY');
  await waitForState(
    running.panel,
    (state) =>
      state.shortcuts.items.find((item) => item.action === 'returnToInteractive')?.accelerator ===
      'Control+Alt+Shift+Y',
    'new shortcut saved',
  );
  const state = await getState(running.panel);
  expect(state.shortcuts.recording).toBe(false);
  expect(state.shortcuts.items.every((item) => item.registered)).toBe(true);
  await expect(recorder).toContainText('Y');

  // Reset puts the default back.
  await settings
    .locator('[data-testid="rd-shortcut-returnToInteractive"]')
    .getByRole('button', { name: 'Reset' })
    .click();
  await waitForState(
    running.panel,
    (current) =>
      current.shortcuts.items.find((item) => item.action === 'returnToInteractive')?.accelerator ===
      'Control+Alt+Shift+T',
    'shortcut reset',
  );
  await screenshot(settings, 'settings-behaviour', false);
});

test('Privacy & Capture: the contract labels for this platform, the guide, and no old check form', async () => {
  await tab(/Privacy & Capture/).click();
  const status = settings.locator('[data-testid="rd-capture-status"]');
  const toggle = settings.locator('[data-testid="rd-capture-switch"]');
  const label = settings.locator('[data-testid="rd-capture-label"]');

  if (process.platform === 'linux') {
    // Private mode is on by default; Linux has no OS request, so the status is "Unsupported".
    const state = await getState(running.panel);
    expect(state.capture.requested).toBe(true);
    expect(state.capture.apiAvailable).toBe(false);
    expect(state.capture.results.every((result) => !result.attempted)).toBe(true);
    await expect(status).toHaveAttribute('data-request', 'unsupported');
    await expect(status).toHaveAttribute('data-reason', 'linux_unavailable');
    await expect(label).toHaveText('Unsupported');
    // The same words in the panel's chip.
    await expect(running.panel.locator('[data-testid="rd-header-privacy"]')).toHaveAttribute(
      'data-request',
      'unsupported',
    );
    await expect(running.panel.locator('[data-testid="rd-header-privacy"]')).toContainText(
      'Unsupported',
    );
    const windows = await running.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.isContentProtected()),
    );
    expect(windows.every((value) => value === false)).toBe(true);
    // The user can still turn it off; that is then their decision and says "Protection off".
    await toggle.click({ force: true });
    await expect(status).toHaveAttribute('data-request', 'off');
    await expect(label).toHaveText('Protection off');
    await expect(running.panel.locator('[data-testid="rd-header-privacy"]')).toContainText(
      'Protection off',
    );
    await toggle.click({ force: true });
    await expect(status).toHaveAttribute('data-request', 'unsupported');
  }

  // The Safe Share Guide is part of the tab, with the contract's steps.
  const guide = settings.locator('[data-testid="rd-settings-share-guide"]');
  await expect(guide).toContainText('Safe Share Guide');
  await expect(guide.locator('[data-testid="rd-share-guide-steps"] li')).toHaveCount(4);
  await expect(guide).toContainText(
    'Share a specific browser tab, presentation window, or application instead of your entire screen.',
  );
  await expect(settings.getByText('What to rely on instead')).toBeVisible();
  // The retired manual-check form is gone.
  await expect(settings.locator('[data-testid="rd-verification-form"]')).toHaveCount(0);
  await screenshot(settings, 'settings-privacy', false);
});

test('Privacy Test Center: records are written by the main process, never reach the panel, export via its own dialog', async () => {
  await tab(/Privacy Test Center/).click();
  await expect(settings.locator('[data-testid="rd-test-center"]')).toBeVisible();
  const record = {
    id: '00000000-0000-4000-8000-0000000000a1',
    testedAt: '2026-11-10T10:00:00.000Z',
    // Claims another OS and versions: the main process stamps the detected ones instead.
    appVersion: '9.9.9',
    electronVersion: '1.0.0',
    platform: 'win32',
    osVersion: '10.0.1',
    meetingApp: 'zoom',
    meetingAppVersion: '6.4.1',
    client: { kind: 'native' },
    captureMode: 'entire_display',
    monitors: { count: 1 },
    protectionEnabled: true,
    localResult: 'Panel visible on this computer',
    remote: { observedBy: 'second_device', outcome: 'omitted' },
  };
  const saved = await settings.evaluate(
    (value) => window.rdDesktop?.privacy.save(value as never),
    record,
  );
  expect(saved).toMatchObject({ ok: true });
  if (!saved?.ok) throw new Error('the record was not saved');
  const view = saved.data;
  const state = await getState(settings);
  expect(view.records).toHaveLength(1);
  expect(view.records[0]).toMatchObject({
    platform: state.app.platform,
    osVersion: state.app.systemVersion,
    electronVersion: state.app.electronVersion,
    appVersion: state.app.version,
  });
  // The panel renders other people's content: it can neither read nor write records.
  const fromPanel = await running.panel.evaluate(async () => ({
    snapshot: await window.rdDesktop?.privacy.snapshot(),
    remove: await window.rdDesktop?.privacy.remove('00000000-0000-4000-8000-0000000000a1'),
  }));
  expect(fromPanel.snapshot).toMatchObject({ ok: false, error: { code: 'forbidden_window' } });
  expect(fromPanel.remove).toMatchObject({ ok: false, error: { code: 'forbidden_window' } });
  expect(JSON.stringify(await getState(running.panel))).not.toContain(
    'Panel visible on this computer',
  );

  // Export: the main process asks where to save and writes the file; the page learns only "saved".
  const dialog = await controlSaveDialog(running.app);
  const target = path.join(running.userData, 'exported-records.md');
  await dialog.answerWith(target);
  const exported = await settings.evaluate(() =>
    window.rdDesktop?.privacy.exportRecords('markdown'),
  );
  expect(exported).toEqual({ ok: true, data: { saved: true } });
  expect(fs.readFileSync(target, 'utf8')).toContain('RealtimeDocs Privacy Test Center records');
  expect((await dialog.calls())[0]).toMatchObject({ parent: 'settings' });

  const removed = await settings.evaluate(() =>
    window.rdDesktop?.privacy.remove('00000000-0000-4000-8000-0000000000a1'),
  );
  expect(removed).toMatchObject({ ok: true, data: { records: [] } });
  await screenshot(settings, 'settings-test-center', false);
});

test('Diagnostics: report without secrets, copy to clipboard, and the native resize probe', async () => {
  await tab(/Diagnostics/).click();
  const report = settings.locator('[data-testid="rd-diagnostics-report"]');
  await expect(report).toContainText('Electron 45.2.3');
  await expect(report).toContainText('Global shortcuts:');
  await expect(report).toContainText('Displays:');
  await expect(report).toContainText('Capture exclusion (an operating-system request');
  await expect(report).toContainText('diagnostics module: Diagnostics module not present');
  // The one refused action in this run is the deliberate network probe from the
  // first test in this file; the report names the window, the directive and
  // the origin, and nothing else.
  await expect(report).toContainText('Content-Security-Policy violations in this run:');
  await expect(report).toContainText(`settings: connect-src refused ${SERVER_A}`);
  expect(((await report.textContent()) ?? '').match(/ refused /g)).toHaveLength(1);
  await expect(report).toContainText(`Server: ${SERVER_A}`);
  const text = (await report.textContent()) ?? '';
  expect(text).not.toMatch(/Bearer|smoke-desktop-session-token|A1b2C3d4E5f6/);
  expect(text).toMatch(
    /panel: \d+ × \d+ at \d+, \d+ visible=true alwaysOnTop=true resizable=false/,
  );

  // Copy goes through the UI kit's clipboard helper; permissions stay denied.
  await settings.click('[data-testid="rd-copy-diagnostics"]');
  await expect(settings.locator('[data-testid="rd-copy-diagnostics"]')).toHaveText('Copied');
  const clipboardText = await running.app.evaluate(async ({ clipboard }) =>
    String(await clipboard.readText()),
  );
  expect(clipboardText).toContain('RealtimeDocs Desktop');
  expect(clipboardText).toContain('Global shortcuts:');

  // The probe: transparent and natively resizable, unlike the panel.
  await settings.click('[data-testid="rd-probe-toggle"]');
  const probe = await pageByKind(running.app, 'probe');
  await probe.waitForSelector('[data-testid="rd-probe"]');
  const probeFacts = (await windowFacts(running.app)).find((window) => window.kind === 'probe');
  expect(probeFacts?.resizable).toBe(true);
  expect((await panelFacts(running.app)).resizable).toBe(false);
  await screenshot(probe, 'probe');
  // A programmatic resize reaches the page (what a native edge drag would also do).
  await running.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('probe.html'))
      ?.setSize(520, 360);
  });
  await expect(probe.locator('[data-testid="rd-probe-size"]')).toContainText('520 × 360');

  // Recording a result stores it and closes the probe.
  await probe.click('[data-testid="rd-probe-works"]').catch(() => undefined);
  const state = await waitForState(
    settings,
    (current) => current.probe.record !== null,
    'probe result',
  );
  // The panel is not told what was recorded.
  expect((await getState(running.panel)).probe.record).toBeNull();
  expect(state.probe.record).toMatchObject({
    result: 'works',
    osPlatform: state.app.platform,
    electronVersion: '45.2.3',
  });
  await expect
    .poll(async () => (await windowFacts(running.app)).some((window) => window.kind === 'probe'))
    .toBe(false);
  await expect(settings.locator('[data-testid="rd-probe-record"]')).toContainText(
    'Native resizing worked',
  );
  await screenshot(settings, 'settings-diagnostics', false);
});

test('showing the panel from the tray or a shortcut does not take focus from the settings window', async () => {
  const focusedKind = () =>
    running.app.evaluate(({ BrowserWindow }) => {
      const focused = BrowserWindow.getFocusedWindow();
      return focused
        ? (/\/(\w+)\.html/.exec(focused.webContents.getURL())?.[1] ?? 'unknown')
        : 'none';
    });
  const setFocus = (kind: string) =>
    running.app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes(`${target}.html`))
        ?.focus();
    }, kind);

  // Hide the panel and give the settings window the keyboard.
  await running.panel.evaluate(() => window.rdDesktop?.window.action('hide'));
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(false);
  await setFocus('settings');
  await expect.poll(focusedKind).toBe('settings');
  await settings.locator('[data-testid="rd-settings-tabs"]').waitFor();

  // The tray icon (and a link opened from the browser) shows the panel without
  // activating it. A remote edit never shows the panel at all; that is checked
  // against the real server in test/real.
  await running.app.evaluate(() => {
    (
      globalThis as unknown as {
        __rdTest: { controller: { handleReactivation(options: { focus: boolean }): void } };
      }
    ).__rdTest.controller.handleReactivation({ focus: false });
  });
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);
  await running.panel.waitForTimeout(400);
  // ...and the settings window still has the focus.
  expect(await focusedKind()).toBe('settings');
  expect((await panelFacts(running.app)).focused).toBe(false);

  // The same holds for the global shortcut.
  for (const reveal of ['toggleVisibility'] as const) {
    await running.app.evaluate((_electron, action) => {
      const controller = (
        globalThis as unknown as {
          __rdTest: { controller: { triggerShortcut(value: string): void } };
        }
      ).__rdTest.controller;
      controller.triggerShortcut(action); // hide
      controller.triggerShortcut(action); // show again
    }, reveal);
    await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);
    await running.panel.waitForTimeout(300);
    expect(await focusedKind()).toBe('settings');
  }

  // Control: this environment does report a focus change when a window is
  // activated on purpose, so the assertions above are not vacuous.
  await setFocus('panel');
  await expect.poll(focusedKind).toBe('panel');
  await setFocus('settings');
  await expect.poll(focusedKind).toBe('settings');
});

test('closing the settings window does not quit the app, and it can be reopened', async () => {
  await running.panel.evaluate(() => window.rdDesktop?.window.action('close-settings'));
  await expect
    .poll(async () => (await windowFacts(running.app)).some((window) => window.kind === 'settings'))
    .toBe(false);
  expect((await getState(running.panel)).settings.open).toBe(false);
  expect((await panelFacts(running.app)).visible).toBe(true);
  await running.panel.evaluate(() =>
    window.rdDesktop?.window.action('open-settings', { tab: 'privacy' }),
  );
  const reopened = await pageByKind(running.app, 'settings');
  await reopened.waitForSelector('[data-testid="rd-capture-status"]');
  await expect(reopened.getByRole('tab', { name: /Privacy & Capture/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
