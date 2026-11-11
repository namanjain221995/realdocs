import { expect, test } from '@playwright/test';
import { BRIDGE_KEYS } from '../../src/shared/bridge';
import {
  appFetch,
  decodePng,
  getState,
  launchApp,
  panelFacts,
  screenshot,
  waitForState,
  windowFacts,
  type RunningApp,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let running: RunningApp;

test.beforeAll(async () => {
  running = await launchApp();
});

test.afterAll(async () => {
  await running.close();
});

test('panel window: hidden-then-shown, transparent page, not resizable, always on top', async () => {
  const facts = await panelFacts(running.app);
  expect(facts.url).toBe('app://realtimedocs/panel.html');
  expect(facts.visible).toBe(true);
  expect(facts.resizable).toBe(false);
  // `maximizable` is documented as not implemented on Linux (always true there).
  if (process.platform !== 'linux') expect(facts.maximizable).toBe(false);
  expect(facts.alwaysOnTop).toBe(true);
  // Initial size, placed inside the 1600x900 test screen.
  expect(facts.bounds.width).toBe(720);
  expect(facts.bounds.height).toBe(460);
  expect(facts.bounds.x).toBeGreaterThanOrEqual(0);
  expect(facts.bounds.x + facts.bounds.width).toBeLessThanOrEqual(1600);
  // No window frame: the content area is the whole window. (Xvfb has no window
  // manager, so this cannot distinguish a frameless window by itself; the
  // `frame: false` option is asserted in the unit tests.)
  expect(facts.contentBounds).toEqual(facts.bounds);
  // `getBackgroundColor()` is not asserted: on Linux it reports "#000000" for a
  // transparent window (no alpha channel), so it cannot show transparency.

  // The page itself paints nothing outside the panel surface: the corners of a
  // screenshot taken without a default background are fully transparent,
  // while the middle of the title strip is opaque-ish surface.
  const file = await screenshot(running.panel, 'panel-initial');
  const png = decodePng(file);
  expect(png.pixel(0, 0)[3]).toBe(0);
  expect(png.pixel(png.width - 1, 0)[3]).toBe(0);
  expect(png.pixel(0, png.height - 1)[3]).toBe(0);
  expect(png.pixel(png.width - 1, png.height - 1)[3]).toBe(0);
  expect(png.pixel(Math.floor(png.width / 2), 22)[3]).toBeGreaterThan(200);

  const backgrounds = await running.panel.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }));
  expect(backgrounds).toEqual({ html: 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)' });
});

test('surface alpha applies to the background only: text and the element stay opaque', async () => {
  const read = () =>
    running.panel.evaluate(() => {
      const root = document.querySelector('[data-testid="rd-panel"]');
      const title = document.querySelector('[data-testid="rd-panel-title"]');
      if (!root || !title) throw new Error('panel not rendered');
      const rootStyle = getComputedStyle(root);
      return {
        opacity: rootStyle.opacity,
        background: rootStyle.backgroundColor,
        text: getComputedStyle(title).color,
        windowOpacity: document.documentElement.style.opacity,
      };
    });

  const before = await read();
  expect(before.opacity).toBe('1');
  expect(before.background).toMatch(/^rgba\(13, 20, 24, 0\.86\)$/);

  const result = await running.panel.evaluate(() =>
    window.rdDesktop?.preferences.update({ appearance: { backgroundAlpha: 0.2 } }),
  );
  expect(result).toEqual({ ok: true, data: null });
  await waitForState(
    running.panel,
    (state) => state.appearance.backgroundAlpha === 0.2,
    'alpha 0.2',
  );
  await expect.poll(async () => (await read()).background).toMatch(/^rgba\(13, 20, 24, 0\.2\)$/);
  const after = await read();
  // Whole-element opacity is never used, and the text colour has no alpha.
  expect(after.opacity).toBe('1');
  expect(after.text).toMatch(/^rgb\(/);
  expect(after.windowOpacity).toBe('');
  // Electron-side: the window itself is not faded either.
  const windowOpacity = await running.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.getOpacity()),
  );
  expect(windowOpacity.every((value) => value === 1)).toBe(true);

  // Out-of-range values are clamped, not applied.
  await running.panel.evaluate(() =>
    window.rdDesktop?.preferences.update({ appearance: { backgroundAlpha: 0 } }),
  );
  await waitForState(
    running.panel,
    (state) => state.appearance.backgroundAlpha === 0.1,
    'alpha clamped to 0.1',
  );
  await running.panel.evaluate(() =>
    window.rdDesktop?.preferences.update({ appearance: { backgroundAlpha: 0.86 } }),
  );
  await waitForState(
    running.panel,
    (state) => state.appearance.backgroundAlpha === 0.86,
    'alpha restored',
  );
});

test('renderer is sandboxed and isolated: no Node.js, only the declared bridge', async () => {
  const facts = await panelFacts(running.app);
  // Supporting evidence from an undocumented getter, when it is available.
  if (facts.sandbox !== undefined) {
    expect(facts.sandbox).toBe(true);
    expect(facts.contextIsolation).toBe(true);
    expect(facts.nodeIntegration).toBe(false);
    expect(facts.webSecurity).toBe(true);
  }

  const globals = await running.panel.evaluate(() => {
    const scope = globalThis as Record<string, unknown>;
    return {
      require: typeof scope.require,
      process: typeof scope.process,
      Buffer: typeof scope.Buffer,
      module: typeof scope.module,
      global: typeof scope.global,
      ipcRenderer: typeof scope.ipcRenderer,
      electron: typeof scope.electron,
      bridgeKeys: Object.keys(window.rdDesktop ?? {}).sort(),
      bridgeFrozen: (() => {
        try {
          (window.rdDesktop as unknown as Record<string, unknown>).evil = () => 1;
          return !('evil' in (window.rdDesktop as object));
        } catch {
          return true;
        }
      })(),
    };
  });
  expect(globals.require).toBe('undefined');
  expect(globals.process).toBe('undefined');
  expect(globals.Buffer).toBe('undefined');
  expect(globals.module).toBe('undefined');
  expect(globals.global).toBe('undefined');
  expect(globals.ipcRenderer).toBe('undefined');
  expect(globals.electron).toBe('undefined');
  expect(globals.bridgeKeys).toEqual([...BRIDGE_KEYS]);
  expect(globals.bridgeFrozen).toBe(true);
});

test('Content-Security-Policy is sent and enforced', async () => {
  const page = await appFetch(running.app, 'app://realtimedocs/panel.html');
  if (page === 'failed') throw new Error('the app page could not be requested');
  expect(page.status).toBe(200);
  expect(page.contentType).toBe('text/html; charset=utf-8');
  expect(page.nosniff).toBe('nosniff');
  // No server configured yet: no network at all.
  expect(page.csp).toBe(
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; " +
      "object-src 'none'; frame-ancestors 'none'",
  );

  const outcome = await running.panel.evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.effectiveDirective),
    );
    const scope = window as unknown as Record<string, unknown>;
    // Code evaluated through the debugger protocol is exempt from the policy's
    // eval restriction, so everything below runs later, from a task the page
    // scheduled itself, where the policy applies as it does to page code.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Inline script element.
    const inline = document.createElement('script');
    inline.textContent = 'window.__inlineRan = true';
    document.head.appendChild(inline);

    // Inline event handler.
    const button = document.createElement('button');
    button.setAttribute('onclick', 'window.__handlerRan = true');
    document.body.appendChild(button);
    button.click();
    button.remove();

    // Remote script.
    const remote = document.createElement('script');
    remote.src = 'https://example.com/evil.js';
    document.head.appendChild(remote);

    // eval and the Function constructor, called from a page task (see above).
    const codeGeneration = await new Promise<{ evalBlocked: boolean; functionBlocked: boolean }>(
      (resolve) => {
        setTimeout(() => {
          let evalBlocked = false;
          let functionBlocked = false;
          try {
            // Deliberate: the test proves the policy forbids it.
            (0, eval)('window.__evalRan = true');
          } catch {
            evalBlocked = true;
          }
          try {
            // Same proof for the Function constructor.
            new Function('window.__functionRan = true')();
          } catch {
            functionBlocked = true;
          }
          resolve({ evalBlocked, functionBlocked });
        }, 0);
      },
    );

    // Network: nothing is reachable, not even the app's own origin.
    const blocked = async (url: string) => {
      try {
        await fetch(url);
        return false;
      } catch {
        return true;
      }
    };
    const fetchBlocked = await blocked('https://example.com/');
    const selfFetchBlocked = await blocked('app://realtimedocs/panel.html');

    // Frames.
    const frame = document.createElement('iframe');
    frame.src = 'https://example.com/';
    document.body.appendChild(frame);

    await new Promise((resolve) => setTimeout(resolve, 300));
    frame.remove();
    return {
      inlineRan: scope.__inlineRan === true,
      handlerRan: scope.__handlerRan === true,
      evalRan: scope.__evalRan === true,
      functionRan: scope.__functionRan === true,
      evalBlocked: codeGeneration.evalBlocked,
      functionBlocked: codeGeneration.functionBlocked,
      fetchBlocked,
      selfFetchBlocked,
      violations: [...new Set(violations)].sort(),
    };
  });
  expect(outcome.inlineRan).toBe(false);
  expect(outcome.handlerRan).toBe(false);
  expect(outcome.evalRan).toBe(false);
  expect(outcome.functionRan).toBe(false);
  expect(outcome.evalBlocked).toBe(true);
  expect(outcome.functionBlocked).toBe(true);
  expect(outcome.fetchBlocked).toBe(true);
  expect(outcome.selfFetchBlocked).toBe(true);
  expect(outcome.violations).toEqual(
    expect.arrayContaining([
      'connect-src',
      'frame-src',
      'script-src',
      'script-src-attr',
      'script-src-elem',
    ]),
  );
});

test('the app scheme serves only the packaged renderer', async () => {
  const status = async (path: string, method = 'GET') => {
    const response = await appFetch(running.app, `app://realtimedocs${path}`, method);
    return response === 'failed' ? 'failed' : response.status;
  };
  expect(await status('/panel.html')).toBe(200);
  expect(await status('/settings.html')).toBe(200);
  expect(await status('/probe.html')).toBe(200);
  const refused: [string, string?][] = [
    ['/../main/main.cjs'],
    ['/main/main.cjs'],
    ['/preload/preload.cjs'],
    ['/package.json'],
    ['/assets/%2e%2e/%2e%2e/main/main.cjs'],
    ['/assets/..%2f..%2fmain%2fmain.cjs'],
    ['/assets/..%5c..%5cmain.cjs'],
    ['/assets/nope.js'],
    ['/assets/'],
    ['/'],
    ['/index.html'],
    ['/panel.html', 'POST'],
    ['/panel.html', 'DELETE'],
  ];
  for (const [path, method] of refused) {
    expect([400, 403, 404, 405, 'failed'], `${method ?? 'GET'} ${path}`).toContain(
      await status(path, method),
    );
  }
  // Another host on the same scheme is not served.
  const foreign = await appFetch(running.app, 'app://evil/panel.html');
  expect(foreign === 'failed' || foreign.status === 403).toBe(true);
  // The settings page gets no network access even when a server is configured later.
  const settings = await appFetch(running.app, 'app://realtimedocs/settings.html');
  if (settings === 'failed') throw new Error('settings page not served');
  expect(settings.csp).toContain("connect-src 'none'");
});

test('IPC rejects malformed input and actions the panel is not allowed to perform', async () => {
  const before = (await panelFacts(running.app)).bounds;
  const results = await running.panel.evaluate(async () => {
    const api = window.rdDesktop as unknown as Record<
      string,
      Record<string, (...args: unknown[]) => Promise<unknown>>
    >;
    return {
      stringBounds: await api.window?.setBounds?.({ width: '900' }),
      hugeBounds: await api.window?.setBounds?.({ width: 1e12 }),
      extraKey: await api.window?.setBounds?.({ width: 800, exec: 'calc.exe' }),
      unknownAction: await api.window?.action?.('exec'),
      unknownPreset: await api.window?.preset?.('fullscreen'),
      badAlpha: await api.preferences?.update?.({ appearance: { backgroundAlpha: 'opaque' } }),
      prefsInjection: await api.preferences?.update?.({
        connection: { serverOrigin: 'https://evil.example' },
      }),
      linkObject: await api.connection?.openShareLink?.({ toString: 'x' }),
      // Allowed for the settings window only.
      setServer: await api.connection?.setServer?.('https://evil.example'),
      insecure: await api.connection?.setOptions?.({ allowInsecureLan: true }),
      captureOff: await api.capture?.setEnabled?.(false),
      shortcut: await api.shortcuts?.set?.('returnToInteractive', 'Control+Alt+Shift+Q'),
      diagnostics: await api.diagnostics?.get?.(),
    };
  });
  for (const key of [
    'stringBounds',
    'hugeBounds',
    'extraKey',
    'unknownAction',
    'unknownPreset',
    'badAlpha',
    'prefsInjection',
    'linkObject',
  ] as const) {
    expect(results[key], key).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  }
  for (const key of ['setServer', 'insecure', 'captureOff', 'shortcut', 'diagnostics'] as const) {
    expect(results[key], key).toMatchObject({ ok: false, error: { code: 'forbidden_window' } });
  }
  // Nothing happened.
  expect((await panelFacts(running.app)).bounds).toEqual(before);
  const state = await getState(running.panel);
  expect(state.connection.server.origin).toBeNull();
  expect(state.connection.allowInsecureLan).toBe(false);
  expect(
    state.shortcuts.items.find((item) => item.action === 'returnToInteractive')?.accelerator,
  ).toBe('Control+Alt+Shift+T');
  // The rejections were logged without echoing the payload.
  const log = running.stderr.join('');
  expect(log).toContain('"event":"ipc.rejected"');
  expect(log).not.toContain('calc.exe');
  expect(log).not.toContain('evil.example');
});

test('bounds requested over IPC are clamped to the limits and kept on screen', async () => {
  await running.panel.evaluate(() =>
    window.rdDesktop?.window.setBounds({ x: 50000, y: -50000, width: 10, height: 10 }),
  );
  await expect.poll(async () => (await panelFacts(running.app)).bounds.width).toBe(360);
  const { bounds } = await panelFacts(running.app);
  expect(bounds.height).toBe(180);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1600);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  await running.panel.evaluate(() =>
    window.rdDesktop?.window.setBounds({ width: 99999, height: 99999 }),
  );
  await expect
    .poll(async () => (await panelFacts(running.app)).bounds.width)
    .toBeLessThanOrEqual(1600);
  expect((await panelFacts(running.app)).bounds.height).toBeLessThanOrEqual(900);
  await running.panel.evaluate(() => window.rdDesktop?.window.preset('standard'));
  await expect.poll(async () => (await panelFacts(running.app)).bounds.width).toBe(720);
});

test('size presets and reset position', async () => {
  for (const [preset, width, height] of [
    ['compact', 480, 300],
    ['wide', 960, 460],
    ['tall', 560, 720],
    ['standard', 720, 460],
  ] as const) {
    await running.panel.evaluate((name) => window.rdDesktop?.window.preset(name), preset);
    await expect
      .poll(async () => {
        const { bounds } = await panelFacts(running.app);
        return `${bounds.width}x${bounds.height}`;
      })
      .toBe(`${width}x${height}`);
  }
  await running.panel.evaluate(() => window.rdDesktop?.window.setBounds({ x: 40, y: 300 }));
  await expect.poll(async () => (await panelFacts(running.app)).bounds.x).toBe(40);
  await running.panel.evaluate(() => window.rdDesktop?.window.action('reset-position'));
  await expect.poll(async () => (await panelFacts(running.app)).bounds.x).toBe(1600 - 720 - 24);
  expect((await panelFacts(running.app)).bounds.y).toBe(72);
});

test('dragging a resize grip resizes the window through the clamped setBounds path', async () => {
  // Start somewhere with room to grow in every direction.
  await running.panel.evaluate(() =>
    window.rdDesktop?.window.setBounds({ x: 300, y: 150, width: 720, height: 460 }),
  );
  await expect.poll(async () => (await panelFacts(running.app)).bounds.x).toBe(300);
  const start = (await panelFacts(running.app)).bounds;

  const drag = async (testId: string, dx: number, dy: number) => {
    const box = await running.panel.locator(`[data-testid="${testId}"]`).boundingBox();
    if (!box) throw new Error(`${testId} not found`);
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await running.panel.mouse.move(from.x, from.y);
    await running.panel.mouse.down();
    // Several moves, as a real drag produces; pointer capture keeps them coming.
    for (let step = 1; step <= 8; step += 1) {
      await running.panel.mouse.move(from.x + (dx * step) / 8, from.y + (dy * step) / 8);
      await running.panel.waitForTimeout(20);
    }
    await running.panel.mouse.up();
  };

  // South-east corner: the top-left corner stays put.
  await drag('rd-grip-se', 120, 80);
  await expect
    .poll(async () => (await panelFacts(running.app)).bounds.width)
    .toBe(start.width + 120);
  const grown = (await panelFacts(running.app)).bounds;
  expect(grown).toEqual({
    x: start.x,
    y: start.y,
    width: start.width + 120,
    height: start.height + 80,
  });
  // The window is still not natively resizable; only our own path changed it.
  expect((await panelFacts(running.app)).resizable).toBe(false);

  // Edges that move the window's origin (west, north). Playwright's synthetic
  // mouse is window-relative, so it cannot stand in for a real pointer here:
  // each step would be re-read against the moved origin. These edges are
  // therefore driven with explicit movement through the same bridge calls the
  // grips make; the real-pointer path (the main process reads the absolute
  // pointer position) is on the native test checklist.
  const bridgeDrag = (edge: 'w' | 'n', dx: number, dy: number) =>
    running.panel.evaluate(
      async ([grip, moveX, moveY]) => {
        const api = window.rdDesktop;
        if (!api) throw new Error('bridge missing');
        await api.window.resizeStart(grip as 'w' | 'n');
        for (let step = 1; step <= 8; step += 1) {
          api.window.resizeMove(((moveX as number) * step) / 8, ((moveY as number) * step) / 8);
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        await api.window.resizeEnd();
      },
      [edge, dx, dy] as const,
    );

  // West edge: the left edge moves, the right edge stays, the height does not change.
  await bridgeDrag('w', -80, 55);
  await expect.poll(async () => (await panelFacts(running.app)).bounds.x).toBe(grown.x - 80);
  const widened = (await panelFacts(running.app)).bounds;
  expect(widened.x + widened.width).toBe(grown.x + grown.width);
  expect(widened.height).toBe(grown.height);
  expect(widened.y).toBe(grown.y);

  // North edge inwards past the minimum height: stops at the minimum, bottom edge fixed.
  await bridgeDrag('n', 0, 2000);
  await expect.poll(async () => (await panelFacts(running.app)).bounds.height).toBe(180);
  const squashed = (await panelFacts(running.app)).bounds;
  expect(squashed.y + squashed.height).toBe(widened.y + widened.height);

  // Dragging far beyond the screen edge is clamped to the work area (1600 x 900 here).
  await drag('rd-grip-se', 5000, 5000);
  await expect
    .poll(async () => {
      const { bounds } = await panelFacts(running.app);
      return bounds.x + bounds.width;
    })
    .toBe(1600);
  const clamped = (await panelFacts(running.app)).bounds;
  expect(clamped.y + clamped.height).toBe(900);

  await running.panel.evaluate(() => window.rdDesktop?.window.preset('standard'));
  await running.panel.evaluate(() => window.rdDesktop?.window.action('reset-position'));
  await expect.poll(async () => (await panelFacts(running.app)).bounds.width).toBe(720);
  await expect.poll(async () => (await panelFacts(running.app)).bounds.x).toBe(1600 - 720 - 24);
});

test('keyboard commands resize, apply presets and collapse while the panel has focus', async () => {
  await running.app.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('panel.html'),
    );
    panel?.focus();
  });
  const start = (await panelFacts(running.app)).bounds;
  await running.panel.keyboard.press('Control+Alt+Shift+ArrowRight');
  await expect
    .poll(async () => (await panelFacts(running.app)).bounds.width)
    .toBe(start.width + 24);
  await running.panel.keyboard.press('Control+Alt+Shift+ArrowDown');
  await expect
    .poll(async () => (await panelFacts(running.app)).bounds.height)
    .toBe(start.height + 24);
  await running.panel.keyboard.press('Control+Alt+Shift+Digit1');
  await expect.poll(async () => (await panelFacts(running.app)).bounds.width).toBe(480);
  await running.panel.keyboard.press('Control+Alt+Shift+KeyC');
  await waitForState(running.panel, (state) => state.panel.collapsed, 'collapsed by keyboard');
  await running.panel.keyboard.press('Control+Alt+Shift+KeyC');
  await waitForState(running.panel, (state) => !state.panel.collapsed, 'expanded by keyboard');
  await running.panel.keyboard.press('Control+Alt+Shift+Digit2');
  await expect.poll(async () => (await panelFacts(running.app)).bounds.width).toBe(720);
});

test('collapse to the title strip and restore', async () => {
  const expanded = (await panelFacts(running.app)).bounds;
  await running.panel.click('[data-testid="rd-collapse-button"]');
  await waitForState(running.panel, (state) => state.panel.collapsed, 'collapsed');
  await expect.poll(async () => (await panelFacts(running.app)).bounds.height).toBe(44);
  expect((await panelFacts(running.app)).bounds.width).toBe(expanded.width);
  // The document area is hidden, not removed: an open document stays connected.
  await expect(running.panel.locator('[data-testid="rd-panel-main"]')).toBeHidden();
  await expect(running.panel.locator('[data-testid="rd-panel-main"]')).toHaveCount(1);
  await expect(running.panel.locator('[data-testid="rd-panel-header"]')).toBeVisible();
  // Only the horizontal grips remain.
  await expect(running.panel.locator('[data-testid="rd-grip-s"]')).toHaveCount(0);
  await expect(running.panel.locator('[data-testid="rd-grip-e"]')).toHaveCount(1);
  await screenshot(running.panel, 'panel-collapsed');

  await running.panel.click('[data-testid="rd-collapse-button"]');
  await waitForState(running.panel, (state) => !state.panel.collapsed, 'expanded');
  await expect
    .poll(async () => (await panelFacts(running.app)).bounds.height)
    .toBe(expanded.height);
});

test('pin toggles always-on-top', async () => {
  await running.panel.click('[data-testid="rd-pin-button"]');
  await expect.poll(async () => (await panelFacts(running.app)).alwaysOnTop).toBe(false);
  expect((await getState(running.panel)).panel.pinned).toBe(false);
  await running.panel.click('[data-testid="rd-pin-button"]');
  await expect.poll(async () => (await panelFacts(running.app)).alwaysOnTop).toBe(true);
});

test('hide and show (button, shortcut handler, tray handler) and close-hides-instead-of-quitting', async () => {
  await running.panel.click('[data-testid="rd-hide-button"]');
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(false);

  // The same handler the global shortcut calls.
  await running.app.evaluate(() => {
    (
      globalThis as unknown as {
        __rdTest: { controller: { triggerShortcut(action: string): void } };
      }
    ).__rdTest.controller.triggerShortcut('toggleVisibility');
  });
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);

  // The tray item.
  await running.app.evaluate(() => {
    (
      globalThis as unknown as {
        __rdTest: { controller: { triggerMenuAction(action: string): void } };
      }
    ).__rdTest.controller.triggerMenuAction('toggle-visibility');
  });
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(false);
  await running.app.evaluate(() => {
    (
      globalThis as unknown as {
        __rdTest: { controller: { triggerMenuAction(action: string): void } };
      }
    ).__rdTest.controller.triggerMenuAction('toggle-visibility');
  });
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);

  // Closing the window (Alt+F4, Command+W) hides it; the app keeps running.
  await running.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('panel.html'))
      ?.close();
  });
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(false);
  expect((await windowFacts(running.app)).length).toBeGreaterThanOrEqual(1);
  // A hidden panel cannot bring itself back: nothing in it can be clicked, so
  // a request from its page is refused (content in the panel must never reveal it).
  expect(await running.panel.evaluate(() => window.rdDesktop?.window.action('show'))).toMatchObject(
    {
      ok: false,
      error: { code: 'panel_hidden' },
    },
  );
  await running.panel.waitForTimeout(300);
  expect((await panelFacts(running.app)).visible).toBe(false);
  // The tray's "Show" does.
  await running.app.evaluate(() => {
    (
      globalThis as unknown as {
        __rdTest: { controller: { triggerMenuAction(action: string): void } };
      }
    ).__rdTest.controller.triggerMenuAction('show-panel');
  });
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);
});

test('click-through: indicator, and three independent ways back', async () => {
  const state = await getState(running.panel);
  expect(state.panel.canEnterClickThrough).toBe(true);
  expect(state.panel.recoveryPaths.shortcut).toBe(true);
  expect(state.panel.recoveryPaths.tray).toBe(true);
  // Mouse-move forwarding (and with it the in-panel badge button) is documented for Windows and macOS only.
  expect(state.panel.recoveryPaths.hoverBadge).toBe(process.platform !== 'linux');

  const enter = async () => {
    const result = await running.panel.evaluate(() =>
      window.rdDesktop?.window.setClickThrough(true),
    );
    expect(result).toEqual({ ok: true, data: null });
    await waitForState(running.panel, (current) => current.panel.clickThrough, 'click-through on');
    await expect(running.panel.locator('[data-testid="rd-click-through-badge"]')).toBeVisible();
    await expect(running.panel.locator('[data-testid="rd-panel"]')).toHaveAttribute(
      'data-click-through',
      'true',
    );
  };
  const expectInteractive = async () => {
    await waitForState(
      running.panel,
      (current) => !current.panel.clickThrough,
      'click-through off',
    );
    await expect(running.panel.locator('[data-testid="rd-click-through-badge"]')).toHaveCount(0);
  };
  const hook = (call: string, argument: string) =>
    running.app.evaluate(
      (_electron, [method, value]) => {
        const controller = (
          globalThis as unknown as {
            __rdTest: { controller: Record<string, (value: string) => void> };
          }
        ).__rdTest.controller;
        controller[method as string]?.(value as string);
      },
      [call, argument],
    );

  // 1. Global shortcut handler.
  await enter();
  await expect(running.panel.locator('[data-testid="rd-click-through-badge"]')).toContainText(
    'Click-through is on',
  );
  await expect(running.panel.locator('[data-testid="rd-click-through-badge"]')).toContainText(
    'Ctrl',
  );
  await screenshot(running.panel, 'panel-click-through');
  // The tray menu marks the mode and offers the way out.
  const model = await running.app.evaluate(() =>
    (
      globalThis as unknown as {
        __rdTest: {
          controller: { trayMenuModel(): { label?: string; enabled?: boolean; action?: string }[] };
        };
      }
    ).__rdTest.controller.trayMenuModel(),
  );
  expect(model.find((entry) => entry.action === 'return-to-interactive')).toMatchObject({
    enabled: true,
    label: 'Return to interactive mode',
  });
  expect(model.find((entry) => entry.action === 'click-through-mode')).toMatchObject({
    checked: true,
  });
  await hook('triggerShortcut', 'returnToInteractive');
  await expectInteractive();

  // 2. Tray / menu-bar item.
  await enter();
  await hook('triggerMenuAction', 'return-to-interactive');
  await expectInteractive();

  // 3. Starting the app again / re-activating it.
  await enter();
  await running.app.evaluate(() => {
    (
      globalThis as unknown as {
        __rdTest: { controller: { handleReactivation(options: { focus: boolean }): void } };
      }
    ).__rdTest.controller.handleReactivation({ focus: false });
  });
  await expectInteractive();

  // Hiding also leaves click-through, so the panel never reappears unclickable.
  await enter();
  await hook('triggerShortcut', 'toggleVisibility');
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(false);
  expect((await getState(running.panel)).panel.clickThrough).toBe(false);
  await hook('triggerShortcut', 'toggleVisibility');
  await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);
});

test('appearance popover and readability aids render', async () => {
  await running.panel.click('[data-testid="rd-appearance-button"]');
  await expect(running.panel.locator('[data-testid="rd-appearance-popover"]')).toBeVisible();
  // Let the opening animation finish, then check the popover itself is opaque:
  // controls must stay legible over whatever the panel shows behind them.
  await running.panel.waitForTimeout(400);
  const popover = await running.panel.evaluate(() => {
    const element = document.querySelector('.rd-popover');
    if (!element) return null;
    const style = getComputedStyle(element);
    return { opacity: style.opacity, background: style.backgroundColor };
  });
  expect(popover?.opacity).toBe('1');
  expect(popover?.background).toMatch(/^rgb\(/);
  await screenshot(running.panel, 'panel-appearance-popover');
  await running.panel.keyboard.press('Escape');
  await expect(running.panel.locator('[data-testid="rd-appearance-popover"]')).toHaveCount(0);

  await running.panel.evaluate(() =>
    window.rdDesktop?.preferences.update({ appearance: { foreground: 'dark' } }),
  );
  await expect(running.panel.locator('html')).toHaveAttribute('data-theme', 'light');
  await screenshot(running.panel, 'panel-dark-text');
  await running.panel.evaluate(() =>
    window.rdDesktop?.preferences.update({ appearance: { foreground: 'light' } }),
  );
  await expect(running.panel.locator('html')).toHaveAttribute('data-theme', 'dark');
});
