import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import {
  getMainState,
  getState,
  launchApp,
  makeUserData,
  panelFacts,
  screenshot,
  waitForState,
  type RunningApp,
} from './helpers';

const SCREEN = { width: 1600, height: 900 };

function seedPreferences(contents: unknown | string): string {
  return makeUserData((directory) => {
    fs.writeFileSync(
      path.join(directory, 'preferences.json'),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );
  });
}

function onScreen(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return (
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.x + bounds.width <= SCREEN.width &&
    bounds.y + bounds.height <= SCREEN.height
  );
}

type Controller = Record<string, (...values: unknown[]) => unknown>;

function hook<T>(app: ElectronApplication, method: string, ...args: unknown[]): Promise<T> {
  return app.evaluate(
    async (_electron, [name, parameters]) => {
      const controller = (globalThis as unknown as { __rdTest: { controller: Controller } })
        .__rdTest.controller;
      try {
        return {
          ok: true,
          value: await controller[name as string]?.(...(parameters as unknown[])),
        };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        return { ok: false, code: failure.code ?? 'unknown', message: failure.message ?? '' };
      }
    },
    [method, args] as const,
  ) as Promise<T>;
}

test.describe('saved window position', () => {
  const cases: [
    string,
    { x: number; y: number; width: number; height: number },
    number | null,
    string,
  ][] = [
    [
      'far beyond the right/bottom edge on a monitor that no longer exists',
      { x: 5000, y: 5000, width: 720, height: 460 },
      424242,
      'saved_display_missing',
    ],
    [
      'far to the left of every display',
      { x: -4000, y: 100, width: 720, height: 460 },
      null,
      'off_screen',
    ],
    ['mostly off the right edge', { x: 1500, y: 200, width: 720, height: 460 }, null, 'off_screen'],
    [
      'title strip above the top edge',
      { x: 300, y: -200, width: 720, height: 460 },
      null,
      'off_screen',
    ],
    ['larger than the screen', { x: 0, y: 0, width: 5000, height: 4000 }, null, 'size_adjusted'],
  ];

  for (const [name, bounds, displayId, reason] of cases) {
    test(`is recovered when the saved rectangle is ${name} (private mode off)`, async () => {
      const userData = seedPreferences({
        version: 2,
        window: {
          bounds,
          displayId,
          expandedHeight: bounds.height,
          collapsed: false,
          pinned: true,
        },
        appearance: { backgroundAlpha: 0.5, foreground: 'dark' },
        // Without private mode a panel is simply pulled back onto a display.
        capture: { enabled: false, chosen: true },
        guidance: { shareGuideSeen: true },
      });
      const running = await launchApp({ userData });
      try {
        const facts = await panelFacts(running.app);
        expect(facts.visible).toBe(true);
        expect(onScreen(facts.bounds), JSON.stringify(facts.bounds)).toBe(true);
        expect(facts.bounds.width).toBeGreaterThanOrEqual(360);
        const state = await getState(running.panel);
        expect(state.panel.lastRecovery?.reason).toBe(reason);
        // The rest of the file was kept.
        expect(state.appearance.backgroundAlpha).toBe(0.5);
        expect(state.appearance.foreground).toBe('dark');
        // The corrected position is what gets saved.
        await hook(running.app, 'flushPreferences');
        const saved = JSON.parse(
          fs.readFileSync(path.join(userData, 'preferences.json'), 'utf8'),
        ) as {
          window: { bounds: { x: number; y: number; width: number; height: number } };
        };
        expect(onScreen(saved.window.bounds)).toBe(true);
      } finally {
        await running.close();
      }
    });
  }

  test('with private mode on, a panel whose display is gone is parked, not moved; only the user brings it back', async () => {
    const userData = seedPreferences({
      version: 2,
      window: {
        bounds: { x: 5000, y: 5000, width: 720, height: 460 },
        displayId: 424242,
        expandedHeight: 460,
        collapsed: false,
        pinned: true,
      },
      guidance: { shareGuideSeen: true },
    });
    const running = await launchApp({ userData });
    try {
      const state = await getMainState(running.app);
      expect(state.capture.requested).toBe(true);
      expect(state.panel.parked).toBe('display_removed');
      // Hidden, not moved onto the display that is left (it may be the shared one).
      expect((await panelFacts(running.app)).visible).toBe(false);
      expect(onScreen((await panelFacts(running.app)).bounds)).toBe(true);
      // The tray tooltip says so, without any document content.
      const tooltip = await hook<{ value: string }>(running.app, 'trayTooltipText');
      expect(tooltip.value).toContain('notes display disconnected');
      // Nothing that is not the user brings it back: a display change, a show from a notice.
      await hook(running.app, 'revalidateDisplays');
      await running.panel.waitForTimeout(300);
      expect((await panelFacts(running.app)).visible).toBe(false);
      // The user's "Show" does.
      await hook(running.app, 'triggerMenuAction', 'show-panel');
      await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);
      const after = await getMainState(running.app);
      expect(after.panel.parked).toBeNull();
      expect(onScreen((await panelFacts(running.app)).bounds)).toBe(true);
      await screenshot(running.panel, 'panel-unparked');
    } finally {
      await running.close();
    }
  });

  test('the emergency item brings a parked, collapsed, click-through panel fully back', async () => {
    const userData = seedPreferences({
      version: 2,
      window: {
        bounds: { x: 5000, y: 5000, width: 720, height: 44 },
        displayId: 424242,
        expandedHeight: 460,
        collapsed: true,
        pinned: true,
      },
      guidance: { shareGuideSeen: true },
    });
    const running = await launchApp({ userData });
    try {
      expect((await getMainState(running.app)).panel.parked).toBe('display_removed');
      await hook(running.app, 'triggerMenuAction', 'return-to-interactive');
      await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);
      const state = await getMainState(running.app);
      expect(state.panel).toMatchObject({ parked: null, collapsed: false, clickThrough: false });
      const facts = await panelFacts(running.app);
      expect(onScreen(facts.bounds), JSON.stringify(facts.bounds)).toBe(true);
      expect(facts.bounds.height).toBeGreaterThan(44);
    } finally {
      await running.close();
    }
  });

  test('a valid saved position is restored exactly', async () => {
    const bounds = { x: 120, y: 240, width: 800, height: 500 };
    const userData = seedPreferences({
      window: { bounds, displayId: null, expandedHeight: 500, pinned: false },
    });
    const running = await launchApp({ userData });
    try {
      const facts = await panelFacts(running.app);
      expect(facts.bounds).toEqual(bounds);
      expect(facts.alwaysOnTop).toBe(false);
      expect((await getState(running.panel)).panel.lastRecovery).toBeNull();
    } finally {
      await running.close();
    }
  });

  test('a window pushed off screen while running is pulled back when the display layout changes', async () => {
    const running = await launchApp();
    try {
      // Put the window where no display is, behind the app's back (as a
      // vanished monitor would leave it), then deliver a display event.
      await running.app.evaluate(({ BrowserWindow, screen }) => {
        const panel = BrowserWindow.getAllWindows()[0];
        panel?.setBounds({ x: 4000, y: 3000, width: 720, height: 460 });
        screen.emit('display-removed', {}, screen.getPrimaryDisplay());
      });
      await expect
        .poll(async () => onScreen((await panelFacts(running.app)).bounds), { timeout: 10_000 })
        .toBe(true);
      const state = await waitForState(
        running.panel,
        (current) => current.panel.lastRecovery !== null,
        'recovery recorded',
      );
      expect(state.panel.lastRecovery?.reason).toBe('off_screen');
      expect(running.stderr.join('')).toContain('panel.bounds_recovered');

      // The same for a metrics change (resolution or scale factor).
      await running.app.evaluate(({ BrowserWindow, screen }) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: -3000, y: 100, width: 720, height: 460 });
        screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), [
          'workArea',
          'scaleFactor',
        ]);
      });
      await expect
        .poll(async () => onScreen((await panelFacts(running.app)).bounds), { timeout: 10_000 })
        .toBe(true);
    } finally {
      await running.close();
    }
  });
});

test.describe('damaged preference files', () => {
  test('unreadable JSON: the app starts with defaults and keeps a backup', async () => {
    const garbage = '{"appearance": {"backgroundAlpha": 0.3, ';
    const userData = seedPreferences(garbage);
    const running = await launchApp({ userData });
    try {
      const state = await getState(running.panel);
      expect(state.preferencesRepaired).toBe(true);
      expect(state.appearance.backgroundAlpha).toBe(0.86);
      // Fresh defaults: private mode on.
      expect(state.capture.requested).toBe(true);
      expect(state.connection.allowInsecureLan).toBe(false);
      expect(onScreen((await panelFacts(running.app)).bounds)).toBe(true);
      expect(fs.readFileSync(path.join(userData, 'preferences.corrupt.json'), 'utf8')).toBe(
        garbage,
      );
      expect(() =>
        JSON.parse(fs.readFileSync(path.join(userData, 'preferences.json'), 'utf8')),
      ).not.toThrow();
    } finally {
      await running.close();
    }
  });

  test('hostile values are neutralised, not applied', async () => {
    const userData = seedPreferences({
      appearance: { backgroundAlpha: -5, fontScale: 1e9, readability: '<script>' },
      window: { bounds: { x: 'NaN', y: null, width: -1, height: 1e99 }, pinLevel: 'kernel' },
      connection: {
        serverOrigin: "https://docs.example.com; script-src 'unsafe-inline' *",
        allowInsecureLan: 'yes',
        acceptedLinkOrigin: 'https://evil.example',
      },
      capture: {
        enabled: 'true',
        verifications: [{ id: '../../x', application: '<img onerror=x>' }],
      },
      shortcuts: { returnToInteractive: 'Control+C', togglePin: 'Alt+F4', toggleVisibility: '' },
      __proto__: { polluted: true },
    });
    const running = await launchApp({ userData });
    try {
      const state = await getState(running.panel);
      expect(state.appearance.backgroundAlpha).toBe(0.1);
      expect(state.appearance.fontScale).toBe(1.8);
      expect(state.appearance.readability).toBe('off');
      expect(state.connection.server.origin).toBeNull();
      expect(state.connection.allowInsecureLan).toBe(false);
      expect(state.connection.acceptedLinkOrigin).toBeNull();
      // Junk never turns private mode off (it is on unless the user chose off).
      expect(state.capture.requested).toBe(true);
      // The retired records of an earlier version are dropped, not kept anywhere.
      const full = await getMainState(running.app);
      expect(JSON.stringify(full)).not.toContain('onerror');
      expect(state.shortcuts.items.map((item) => item.accelerator)).toEqual([
        'Control+Alt+Shift+D',
        'Control+Alt+Shift+T',
      ]);
      expect(state.shortcuts.items.every((item) => item.registered)).toBe(true);
      expect(state.panel.pinLevel).toBe('floating');
      expect(state.preferencesRepaired).toBe(true);
      // The policy the panel was served with contains nothing from the file.
      const policy = await running.app.evaluate(async ({ session }) => {
        const response = await session
          .fromPartition('persist:realtimedocs')
          .fetch('app://realtimedocs/panel.html');
        await response.arrayBuffer();
        return response.headers.get('content-security-policy') ?? '';
      });
      expect(policy).toContain("connect-src 'none'");
      expect(policy).not.toContain('unsafe-inline *');
      expect(policy).not.toContain('example.com');
    } finally {
      await running.close();
    }
  });
});

test.describe('recovery paths', () => {
  test('click-through and hiding are refused when neither a shortcut nor the tray is available', async () => {
    const running = await launchApp({
      env: { RD_DESKTOP_TEST_NO_TRAY: '1', RD_DESKTOP_TEST_FAIL_SHORTCUTS: '1' },
    });
    try {
      const state = await getState(running.panel);
      expect(state.tray.available).toBe(false);
      expect(
        state.shortcuts.items.every((item) => !item.registered && item.error === 'in_use'),
      ).toBe(true);
      expect(state.panel.recoveryPaths).toMatchObject({ shortcut: false, tray: false });
      expect(state.panel.canEnterClickThrough).toBe(false);
      expect(state.panel.clickThroughBlockedReason).toContain('no reliable way back');
      expect(state.panel.canHide).toBe(false);

      // Through the bridge.
      const refused = await running.panel.evaluate(async () => ({
        clickThrough: await window.rdDesktop?.window.setClickThrough(true),
        hide: await window.rdDesktop?.window.action('hide'),
        toggle: await window.rdDesktop?.window.action('toggle-visibility'),
      }));
      expect(refused.clickThrough).toMatchObject({
        ok: false,
        error: { code: 'no_recovery_path' },
      });
      expect(refused.hide).toMatchObject({ ok: false, error: { code: 'no_recovery_path' } });
      expect(refused.toggle).toMatchObject({ ok: false, error: { code: 'no_recovery_path' } });

      // Through the handlers a shortcut or menu would call.
      await hook(running.app, 'triggerMenuAction', 'click-through-mode');
      await hook(running.app, 'triggerShortcut', 'toggleVisibility');
      await hook(running.app, 'triggerMenuAction', 'hide-panel');
      await running.panel.waitForTimeout(300);

      const after = await getState(running.panel);
      expect(after.panel.clickThrough).toBe(false);
      expect((await panelFacts(running.app)).visible).toBe(true);
      // The controls say why instead of silently doing nothing.
      await expect(running.panel.locator('[data-testid="rd-click-through-button"]')).toBeDisabled();
      await expect(running.panel.locator('[data-testid="rd-hide-button"]')).toBeDisabled();
      await expect(running.panel.locator('[data-testid="rd-click-through-badge"]')).toHaveCount(0);
      await screenshot(running.panel, 'panel-no-recovery-path');
    } finally {
      await running.close();
    }
  });

  test('with the shortcuts unavailable the tray alone is enough, and the UI names the way back', async () => {
    const running = await launchApp({ env: { RD_DESKTOP_TEST_FAIL_SHORTCUTS: '1' } });
    try {
      const state = await getState(running.panel);
      expect(state.panel.recoveryPaths).toMatchObject({ shortcut: false, tray: true });
      expect(state.panel.canEnterClickThrough).toBe(true);
      // Each failed shortcut is reported on its own; the tray advertises neither.
      expect(state.shortcuts.items.map((item) => [item.action, item.error])).toEqual([
        ['toggleVisibility', 'in_use'],
        ['returnToInteractive', 'in_use'],
      ]);
      const model = await hook<{ value: { label?: string; accelerator?: string }[] }>(
        running.app,
        'trayMenuModel',
      );
      expect(model.value.some((entry) => entry.accelerator)).toBe(false);
      expect(model.value.map((entry) => entry.label ?? '')).toContain('Return to interactive mode');

      expect(
        await running.panel.evaluate(() => window.rdDesktop?.window.setClickThrough(true)),
      ).toEqual({
        ok: true,
        data: null,
      });
      await waitForState(
        running.panel,
        (current) => current.panel.clickThrough,
        'click-through on',
      );
      const badge = running.panel.locator('[data-testid="rd-click-through-badge"]');
      await expect(badge).toContainText('Use the tray icon to return');
      await expect(badge).not.toContainText('Press');
      await hook(running.app, 'triggerMenuAction', 'return-to-interactive');
      await waitForState(
        running.panel,
        (current) => !current.panel.clickThrough,
        'click-through off',
      );
    } finally {
      await running.close();
    }
  });

  test('a shortcut owned by another running application is detected, reported and can be retried', async () => {
    // The first instance registers the default combinations with the X server.
    const first = await launchApp();
    let second: RunningApp | undefined;
    try {
      expect((await getState(first.panel)).shortcuts.items.every((item) => item.registered)).toBe(
        true,
      );

      // A second, independent instance (its own profile) asks for the same ones.
      const other = await launchApp();
      second = other;
      const state = await getState(other.panel);
      expect(
        state.shortcuts.items.map((item) => [item.action, item.registered, item.error]),
      ).toEqual([
        ['toggleVisibility', false, 'in_use'],
        ['returnToInteractive', false, 'in_use'],
      ]);
      expect(state.panel.recoveryPaths.shortcut).toBe(false);
      // The tray is still there, so the user is not stranded and is told.
      expect(state.panel.canEnterClickThrough).toBe(true);
      const model = await hook<{ value: { label?: string; action?: string; enabled?: boolean }[] }>(
        other.app,
        'trayMenuModel',
      );
      expect(model.value.find((entry) => entry.action === 'return-to-interactive')).toMatchObject({
        enabled: true,
      });

      // Choosing a free combination works at once, for each shortcut on its own...
      expect(
        await hook(other.app, 'setShortcut', 'returnToInteractive', 'Control+Alt+Shift+K'),
      ).toMatchObject({ ok: true });
      let item = (await getState(other.panel)).shortcuts.items.find(
        (entry) => entry.action === 'returnToInteractive',
      );
      expect(item).toMatchObject({
        accelerator: 'Control+Alt+Shift+K',
        registered: true,
        error: null,
        isDefault: false,
      });
      const visibility = (await getState(other.panel)).shortcuts.items.find(
        (entry) => entry.action === 'toggleVisibility',
      );
      expect(visibility).toMatchObject({ registered: false, error: 'in_use' });
      expect((await getState(other.panel)).panel.recoveryPaths.shortcut).toBe(true);
      // ...and choosing one that the other shortcut uses is refused, keeping the working one.
      expect(
        await hook(other.app, 'setShortcut', 'returnToInteractive', 'Control+Alt+Shift+D'),
      ).toMatchObject({ ok: false, code: 'duplicate_shortcut' });
      expect(
        await hook(other.app, 'setShortcut', 'toggleVisibility', 'Control+Alt+Shift+K'),
      ).toMatchObject({ ok: false, code: 'duplicate_shortcut' });
      item = (await getState(other.panel)).shortcuts.items.find(
        (entry) => entry.action === 'returnToInteractive',
      );
      expect(item).toMatchObject({ accelerator: 'Control+Alt+Shift+K', registered: true });

      // Once the other application is gone, "Retry" registers the default.
      await first.close();
      expect(await hook(other.app, 'resetShortcuts', 'toggleVisibility')).toMatchObject({
        ok: true,
      });
      await expect
        .poll(
          async () =>
            (await getState(other.panel)).shortcuts.items.find(
              (entry) => entry.action === 'toggleVisibility',
            )?.registered,
        )
        .toBe(true);
    } finally {
      await second?.close();
      await first.close();
    }
  });
});

test.describe('persistence', () => {
  test('appearance, size, pin and collapse survive a restart; click-through never does', async () => {
    const userData = makeUserData();
    let running = await launchApp({ userData });
    try {
      await running.panel.evaluate(async () => {
        const api = window.rdDesktop;
        if (!api) throw new Error('bridge missing');
        await api.window.setBounds({ x: 200, y: 150, width: 640, height: 400 });
        await api.preferences.update({
          appearance: {
            backgroundAlpha: 0.42,
            fontScale: 1.25,
            readingWidth: 'wide',
            readability: 'outline',
          },
          behaviour: { followLatest: true },
        });
        await api.window.action('unpin');
        await api.window.setClickThrough(true);
      });
      await waitForState(running.panel, (state) => state.panel.clickThrough, 'click-through on');
      await hook(running.app, 'flushPreferences');
    } finally {
      await running.close();
    }

    // Nothing sensitive is written next to the preferences.
    const files = fs.readdirSync(userData);
    expect(files).toContain('preferences.json');
    expect(files).not.toContain('session.bin');
    const saved = fs.readFileSync(path.join(userData, 'preferences.json'), 'utf8');
    expect(saved).not.toMatch(/token|secret|authorization/i);

    running = await launchApp({ userData });
    try {
      const state = await getState(running.panel);
      expect(state.appearance).toMatchObject({
        backgroundAlpha: 0.42,
        fontScale: 1.25,
        readingWidth: 'wide',
        readability: 'outline',
      });
      expect(state.behaviour.followLatest).toBe(true);
      expect(state.panel.pinned).toBe(false);
      expect(state.panel.clickThrough).toBe(false);
      expect(state.preferencesRepaired).toBe(false);
      const facts = await panelFacts(running.app);
      expect(facts.bounds).toEqual({ x: 200, y: 150, width: 640, height: 400 });
      expect(facts.alwaysOnTop).toBe(false);

      // Collapsed state and the height to return to.
      await running.panel.evaluate(() => window.rdDesktop?.window.action('collapse'));
      await waitForState(running.panel, (current) => current.panel.collapsed, 'collapsed');
      await hook(running.app, 'flushPreferences');
    } finally {
      await running.close();
    }

    running = await launchApp({ userData });
    try {
      expect((await getState(running.panel)).panel.collapsed).toBe(true);
      expect((await panelFacts(running.app)).bounds).toEqual({
        x: 200,
        y: 150,
        width: 640,
        height: 44,
      });
      await running.panel.evaluate(() => window.rdDesktop?.window.action('expand'));
      await expect.poll(async () => (await panelFacts(running.app)).bounds.height).toBe(400);
    } finally {
      await running.close();
    }
  });
});
