import { expect, test } from '@playwright/test';
import { launchApp, recordExternalOpens, windowFacts, type RunningApp } from './helpers';

// This file has its own app instance: after the app cancels a navigation,
// Playwright's frame tracker keeps "waiting for navigation to finish", which
// would stall locator-based tests that share the window. Everything here
// therefore uses `evaluate` and main-process facts.

let running: RunningApp;

test.beforeAll(async () => {
  running = await launchApp();
});

test.afterAll(async () => {
  await running.close();
});

test('navigation and popups to external URLs are blocked; safe links go to the OS handler', async () => {
  const pageUrl = () =>
    running.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getURL() ?? '',
    );
  const opened = await recordExternalOpens(running.app);
  const before = (await windowFacts(running.app)).length;

  // In-page navigation attempts.
  await running.panel.evaluate(() => {
    window.location.href = 'https://example.com/phish';
  });
  await running.panel.waitForTimeout(400);
  expect(await pageUrl()).toBe('app://realtimedocs/panel.html');
  await running.panel.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://example.com/clicked';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  await running.panel.waitForTimeout(400);
  expect(await pageUrl()).toBe('app://realtimedocs/panel.html');
  // The other packaged page is not reachable by navigation either.
  await running.panel.evaluate(() => {
    window.location.href = 'app://realtimedocs/settings.html';
  });
  await running.panel.waitForTimeout(400);
  expect(await pageUrl()).toBe('app://realtimedocs/panel.html');

  // window.open by script alone, with no click or key press in the panel for a
  // few seconds: never a window, and nothing goes to the operating system.
  await running.panel.waitForTimeout(5200);
  const scripted = await running.panel.evaluate(() =>
    window.open('https://example.com/scripted-without-input', '_blank'),
  );
  expect(scripted).toBeNull();
  await running.panel.waitForTimeout(300);
  expect(await opened()).toEqual([]);
  expect(running.stderr.join('')).toContain('external.refused_no_input');

  // Right after a real key press (input the operating system delivered):
  // still never a window, but safe links go to the operating system.
  await running.panel.keyboard.press('Shift');
  const popups = await running.panel.evaluate(() => {
    const targets = [
      'https://example.com/docs?x=1',
      'mailto:someone@example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'app://realtimedocs/settings.html',
      'about:blank',
      'data:text/html,<script>alert(1)</script>',
    ];
    return targets.map((target) => window.open(target, '_blank') === null);
  });
  expect(popups.every(Boolean)).toBe(true);

  // A burst gets one link through (the first safe one); a person never clicks
  // faster than the limiter allows, so space the next two out.
  await running.panel.waitForTimeout(800);
  await running.panel.keyboard.press('Shift');
  await running.panel.evaluate(() => {
    window.open('mailto:someone@example.com', '_blank');
  });
  await running.panel.waitForTimeout(800);
  // target=_blank link.
  await running.panel.keyboard.press('Shift');
  await running.panel.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://example.org/blank';
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  await running.panel.waitForTimeout(800);

  expect((await windowFacts(running.app)).length).toBe(before);
  expect((await opened()).sort()).toEqual([
    'https://example.com/docs?x=1',
    'https://example.org/blank',
    'mailto:someone@example.com',
  ]);

  // The explicit bridge call applies the same rule.
  await running.panel.waitForTimeout(800);
  const results = await running.panel.evaluate(async () => ({
    ok: await window.rdDesktop?.openExternal('https://example.net/ok'),
    file: await window.rdDesktop?.openExternal('file:///etc/passwd'),
    script: await window.rdDesktop?.openExternal('javascript:alert(1)'),
    unc: await window.rdDesktop?.openExternal('\\\\attacker\\share\\x.exe'),
    custom: await window.rdDesktop?.openExternal('realtimedocs://open?server=x'),
  }));
  expect(results.ok).toEqual({ ok: true, data: null });
  for (const key of ['file', 'script', 'unc', 'custom'] as const) {
    expect(results[key], key).toMatchObject({ ok: false, error: { code: 'link_blocked' } });
  }
  expect(await opened()).toContain('https://example.net/ok');
  expect(
    (await opened()).some((url) => url.startsWith('file:') || url.startsWith('javascript:')),
  ).toBe(false);
});

test('a cancelled navigation leaves the page loaded, responsive and still bridged', async () => {
  const facts = await running.app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    return {
      url: contents?.getURL(),
      loading: contents?.isLoading(),
      crashed: contents?.isCrashed(),
    };
  });
  expect(facts).toEqual({ url: 'app://realtimedocs/panel.html', loading: false, crashed: false });
  const alive = await running.panel.evaluate(async () => {
    const state = await window.rdDesktop?.getState();
    return {
      rendered: document.querySelector('[data-testid="rd-panel-header"]') !== null,
      revision: typeof state?.revision,
    };
  });
  expect(alive).toEqual({ rendered: true, revision: 'number' });
});
