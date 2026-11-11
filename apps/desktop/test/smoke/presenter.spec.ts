/**
 * Private Presenter Mode, as far as Linux under Xvfb can observe it: the
 * user-activation gate against page script, the Safe Share Guide, the private
 * chip, neutral native titles, what the panel's DOM may contain, the
 * composition wait, the two document modes, reading density and permissions.
 *
 * Linux/Xvfb evidence only. Capture exclusion itself, taskbar/Dock omission,
 * Mission Control and every native surface stay NOT TESTED here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { getMainState, getState, launchApp, panelFacts, screenshot, waitForState } from './helpers';

/** Runs `code` in the panel's page as page script would: no user gesture, no input. */
function asPageScript(app: ElectronApplication, code: string): Promise<unknown> {
  return app.evaluate(async ({ BrowserWindow }, source) => {
    const panel = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('/panel.html'),
    );
    if (!panel) throw new Error('no panel');
    return panel.webContents.executeJavaScript(source, false);
  }, code);
}

function hook<T>(app: ElectronApplication, method: string, ...args: unknown[]): Promise<T> {
  return app.evaluate(
    async (_electron, [name, parameters]) => {
      const controller = (
        globalThis as unknown as {
          __rdTest: { controller: Record<string, (...values: unknown[]) => unknown> };
        }
      ).__rdTest.controller;
      return controller[name as string]?.(...(parameters as unknown[]));
    },
    [method, args] as const,
  ) as Promise<T>;
}

async function waitUntilNoActivation(app: ElectronApplication): Promise<void> {
  // Transient user activation lasts a few seconds after the last real input.
  await expect
    .poll(() => asPageScript(app, 'navigator.userActivation.isActive'), { timeout: 15_000 })
    .toBe(false);
}

test('page script without a click or key press can make the panel do nothing that acts', async () => {
  const running = await launchApp();
  try {
    await waitUntilNoActivation(running.app);
    const before = await panelFacts(running.app);
    const results = (await asPageScript(
      running.app,
      `(async () => {
        const api = window.rdDesktop;
        return {
          openSettings: await api.window.action('open-settings'),
          hide: await api.window.action('hide'),
          move: await api.window.setBounds({ x: 10, y: 10 }),
          preset: await api.window.preset('large'),
          clickThrough: await api.window.setClickThrough(true),
          shareLink: await api.connection.openShareLink('https://other.example/s/x#y'),
          disconnect: await api.connection.disconnect(),
          external: await api.openExternal('https://example.com/'),
        };
      })()`,
    )) as Record<string, unknown>;
    for (const [name, result] of Object.entries(results)) {
      expect(result, name).toEqual({
        ok: false,
        error: {
          code: 'no_user_activation',
          message: 'This needs a click or a key press in the panel.',
        },
      });
    }
    // Nothing happened.
    expect(await panelFacts(running.app)).toMatchObject({ visible: true, bounds: before.bounds });
    const state = await getMainState(running.app);
    expect(state.settings.open).toBe(false);
    expect(state.panel.clickThrough).toBe(false);
    // Passive requests still work without activation.
    expect(
      await asPageScript(running.app, 'window.rdDesktop.getState().then((s) => typeof s.revision)'),
    ).toBe('number');
    // A real click on the control does work.
    await running.panel.click('[data-testid="rd-more-button"]');
    await running.panel.click('[data-testid="rd-open-settings"]');
    await expect.poll(async () => (await getMainState(running.app)).settings.open).toBe(true);
  } finally {
    await running.close();
  }
});

test('Safe Share Guide: shown on first launch, dismissed for good, reopened from the tray and from Settings', async () => {
  const running = await launchApp();
  try {
    const card = running.panel.locator('[data-testid="rd-share-guide-card"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Safe Share Guide');
    await expect(card.locator('[data-testid="rd-share-guide-steps"] li')).toHaveCount(4);
    await expect(card.locator('[data-testid="rd-share-guide-platform"]').first()).toContainText(
      'no documented control',
    );
    await screenshot(running.panel, 'panel-safe-share-guide');
    await running.panel.click('[data-testid="rd-share-guide-dismiss"]');
    await expect(card).toHaveCount(0);
    expect((await getState(running.panel)).guide).toEqual({ open: false, seen: true });

    // From the menu (the macOS application menu's item; the tray reaches Settings).
    await hook(running.app, 'triggerMenuAction', 'open-share-guide');
    await expect(card).toBeVisible();
    await running.panel.click('[data-testid="rd-share-guide-dismiss"]');
    await expect(card).toHaveCount(0);

    // From the panel's privacy chip, by keyboard.
    await running.panel.focus('[data-testid="rd-header-privacy"]');
    await running.panel.keyboard.press('Enter');
    const explanation = running.panel.locator('[data-testid="rd-privacy-explanation"]');
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText('Unsupported');
    await running.panel.click('[data-testid="rd-privacy-open-guide"]');
    await expect(card).toBeVisible();
    await running.panel.click('[data-testid="rd-share-guide-dismiss"]');

    // Step 4 links to the Privacy Test Center in Settings.
    await hook(running.app, 'triggerMenuAction', 'open-share-guide');
    await running.panel.click(
      '[data-testid="rd-share-guide-card"] [data-testid="rd-share-guide-test-center"]',
    );
    await expect
      .poll(async () => {
        const state = await getMainState(running.app);
        return state.settings.open && state.settings.tab;
      })
      .toBe('privacy-test-center');
    await hook(running.app, 'flushPreferences');
    const saved = JSON.parse(readFileSync(join(running.userData, 'preferences.json'), 'utf8')) as {
      guidance: { shareGuideSeen: boolean };
    };
    expect(saved.guidance.shareGuideSeen).toBe(true);
  } finally {
    await running.close();
  }

  // Seen once: a restart does not show it again.
  const userData = running.userData;
  const again = await launchApp({ userData });
  try {
    await expect(again.panel.locator('[data-testid="rd-panel-header"]')).toBeVisible();
    await again.panel.waitForTimeout(500);
    await expect(again.panel.locator('[data-testid="rd-share-guide-card"]')).toHaveCount(0);
  } finally {
    await again.close();
  }
});

test('private mode is on by default; on Linux the chip says "Unsupported"; native titles stay neutral', async () => {
  const running = await launchApp();
  try {
    const state = await getState(running.panel);
    expect(state.capture.requested).toBe(true);
    expect(state.capture.status.request).toBe('unsupported');
    const chip = running.panel.locator('[data-testid="rd-header-privacy"]');
    await expect(chip).toHaveAttribute('data-request', 'unsupported');
    await expect(chip).toHaveText('Unsupported');
    // No verification line except under "OS protection accepted".
    await expect(running.panel.locator('[data-testid="rd-header-privacy-secondary"]')).toHaveCount(
      0,
    );
    // The page's title and the native window title are the neutral name.
    expect(await running.panel.title()).toBe('RealtimeDocs');
    expect(await hook<string>(running.app, 'panelNativeTitle')).toBe('RealtimeDocs');
    expect(await hook<string>(running.app, 'trayTooltipText')).toMatch(/^RealtimeDocs — /);
  } finally {
    await running.close();
  }
});

test('the panel page has no native tooltip and no native select, whatever is added to it', async () => {
  const running = await launchApp();
  try {
    const count = (page: Page) =>
      page.evaluate(() => ({
        titles: document.querySelectorAll('[title]').length,
        selects: document.querySelectorAll('select').length,
      }));
    expect(await count(running.panel)).toEqual({ titles: 0, selects: 0 });
    // Something (document content, a future component) adds a title: it is removed at once.
    const kept = await running.panel.evaluate(async () => {
      const element = document.createElement('span');
      element.title = 'Secret line from the document';
      document.body.append(element);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const existing = document.querySelector('[data-testid="rd-panel-header"]');
      existing?.setAttribute('title', 'Another secret');
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        added: element.getAttribute('title'),
        changed: existing?.getAttribute('title') ?? null,
      };
    });
    expect(kept).toEqual({ added: null, changed: null });
    // A native select cannot open its popup.
    const prevented = await running.panel.evaluate(() => {
      const select = document.createElement('select');
      select.append(new Option('one'), new Option('two'));
      document.body.append(select);
      const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      select.dispatchEvent(mouse);
      const key = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      select.dispatchEvent(key);
      select.remove();
      return [mouse.defaultPrevented, key.defaultPrevented];
    });
    expect(prevented).toEqual([true, true]);
  } finally {
    await running.close();
  }
});

test('every window is protected (or, here, recorded) before it is shown, and drawn once before "accepted"', async () => {
  const running = await launchApp();
  try {
    // The frame answer from the preload ends the wait for each shown window.
    await expect
      .poll(async () => {
        const state = await getMainState(running.app);
        const panel = state.capture.results.find((result) => result.window === 'panel');
        return panel ? panel.pendingComposition === false && panel.composedAt !== null : false;
      })
      .toBe(true);
    const state = await getMainState(running.app);
    const panel = state.capture.results.find((result) => result.window === 'panel');
    // Recorded at creation, before the window's first show; Linux makes no OS call.
    expect(panel).toMatchObject({ requested: true, attempted: false });
    expect(Date.parse(panel?.at ?? '')).toBeLessThan(Date.parse(panel?.composedAt ?? ''));
    expect(state.capture.native).toMatchObject({ present: false, reason: 'wrong_platform' });
  } finally {
    await running.close();
  }
});

test('normal window and Private Presenter Mode: switch both ways, each with its own bounds', async () => {
  const running = await launchApp();
  try {
    const presenter = await panelFacts(running.app);
    expect(presenter).toMatchObject({ alwaysOnTop: true, resizable: false });
    await running.panel.click('[data-testid="rd-more-button"]');
    await running.panel.click('[data-testid="rd-switch-mode"]');
    await expect.poll(async () => (await getMainState(running.app)).panel.mode).toBe('normal');
    const normalPage = await waitForPanelPage(running.app);
    await waitForState(normalPage, (state) => state.panel.mode === 'normal', 'normal mode');
    const normal = await panelFacts(running.app);
    expect(normal).toMatchObject({
      visible: true,
      alwaysOnTop: false,
      resizable: true,
      maximizable: true,
    });
    await expect(normalPage.locator('[data-testid="rd-panel"]')).toHaveAttribute(
      'data-mode',
      'normal',
    );
    await expect(normalPage.locator('[data-testid="rd-drag-strip"]')).toHaveCount(0);
    await expect(normalPage.locator('[data-testid="rd-click-through-button"]')).toHaveCount(0);
    // No click-through in a normal window, whoever asks.
    expect(
      await normalPage.evaluate(() => window.rdDesktop?.window.setClickThrough(true)),
    ).toMatchObject({
      ok: false,
      error: { code: 'no_recovery_path' },
    });
    // Its own bounds: move it, switch back, and the panel is where it was.
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().endsWith('/panel.html'))
        ?.setBounds({ x: 50, y: 60, width: 900, height: 600 });
    });
    await normalPage.waitForTimeout(400);
    await normalPage.click('[data-testid="rd-more-button"]');
    await normalPage.click('[data-testid="rd-switch-mode"]');
    await expect.poll(async () => (await getMainState(running.app)).panel.mode).toBe('presenter');
    const back = await waitForPanelPage(running.app);
    await waitForState(back, (state) => state.panel.mode === 'presenter', 'presenter mode');
    expect((await panelFacts(running.app)).bounds).toEqual(presenter.bounds);
    const prefs = await getMainState(running.app);
    expect(prefs.panel.mode).toBe('presenter');
    await screenshot(back, 'panel-back-in-presenter-mode');
  } finally {
    await running.close();
  }
});

async function waitForPanelPage(app: ElectronApplication): Promise<Page> {
  let page: Page | undefined;
  await expect
    .poll(async () => {
      page = app
        .windows()
        .find((candidate) => !candidate.isClosed() && candidate.url().endsWith('/panel.html'));
      if (!page) return false;
      return page
        .evaluate(() => Boolean(document.querySelector('[data-testid="rd-panel-header"]')))
        .catch(() => false);
    })
    .toBe(true);
  if (!page) throw new Error('no panel page');
  return page;
}

test('reading density changes the document spacing only on this computer', async () => {
  const running = await launchApp();
  try {
    const root = running.panel.locator('[data-testid="rd-panel"]');
    await expect(root).toHaveAttribute('data-density', 'comfortable');
    await running.panel.evaluate(() =>
      window.rdDesktop?.preferences.update({ appearance: { density: 'compact' } }),
    );
    await expect(root).toHaveAttribute('data-density', 'compact');
    await running.panel.evaluate(() =>
      window.rdDesktop?.preferences.update({ appearance: { density: 'spacious' } }),
    );
    await expect(root).toHaveAttribute('data-density', 'spacious');
    expect(
      await running.panel.evaluate(() =>
        window.rdDesktop?.preferences.update({ appearance: { density: 'huge' as never } }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  } finally {
    await running.close();
  }
});

test('the app asks for no permission: camera, microphone, screen, notifications, location are denied', async () => {
  const running = await launchApp();
  try {
    const outcomes = await running.panel.evaluate(async () => {
      const attempt = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return 'granted';
        } catch (error) {
          return (error as Error).name;
        }
      };
      return {
        camera: await attempt(() => navigator.mediaDevices.getUserMedia({ video: true })),
        microphone: await attempt(() => navigator.mediaDevices.getUserMedia({ audio: true })),
        screen: await attempt(() => navigator.mediaDevices.getDisplayMedia({ video: true })),
        notifications: await Notification.requestPermission(),
        location: await new Promise((resolve) =>
          navigator.geolocation.getCurrentPosition(
            () => resolve('granted'),
            (error) => resolve(`denied:${error.code}`),
          ),
        ),
      };
    });
    expect(outcomes.camera).not.toBe('granted');
    expect(outcomes.microphone).not.toBe('granted');
    expect(outcomes.screen).not.toBe('granted');
    expect(outcomes.notifications).toBe('denied');
    expect(outcomes.location).toBe('denied:1');
  } finally {
    await running.close();
  }
});
