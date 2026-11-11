import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { SETTINGS_TABS } from '../../src/shared/state';
import {
  PORT_A,
  SERVER_A,
  appFetch,
  launchApp,
  shareUrl,
  startFakeServer,
  waitForState,
  type FakeServer,
  type RunningApp,
} from './helpers';

// Every renderer must load and run without a single console error and without
// a single refused Content-Security-Policy action.
//
// Two recorders, both active from before the first page script:
// - the main process records renderer console warnings and errors
//   (AppController.recordRendererConsole);
// - the preload script reports `securitypolicyviolation` events
//   (AppController.reportPolicyViolation).
// The second one matters: a refused `new Function` whose error is caught —
// what zod does when the API contracts are imported, and what `boot.js`
// prevents — raises a violation event but prints nothing to the console.

interface ConsoleEntry {
  window: string;
  level: string;
  source: string;
  line: number;
  message: string;
}

const CSP_MESSAGE = /Content Security Policy|Refused to |violates the following/i;

interface PolicyViolation {
  window: string;
  directive: string;
  blocked: string;
  source: string;
  line: number;
}

/** Refused policy actions the preload script reported (it listens from before the first page script). */
function policyViolations(app: ElectronApplication): Promise<PolicyViolation[]> {
  return app.evaluate(() =>
    (
      globalThis as unknown as {
        __rdTest: { controller: { policyViolationRecords(): PolicyViolation[] } };
      }
    ).__rdTest.controller.policyViolationRecords(),
  );
}

function consoleEntries(app: ElectronApplication): Promise<ConsoleEntry[]> {
  return app.evaluate(() =>
    (
      globalThis as unknown as {
        __rdTest: { controller: { rendererConsoleEntries(): ConsoleEntry[] } };
      }
    ).__rdTest.controller.rendererConsoleEntries(),
  );
}

function pageByKind(app: ElectronApplication, kind: string): Page | undefined {
  return app.windows().find((page) => page.url().includes(`/${kind}.html`));
}

async function waitForPage(app: ElectronApplication, kind: string): Promise<Page> {
  await expect.poll(() => pageByKind(app, kind) !== undefined, { timeout: 20_000 }).toBe(true);
  const page = pageByKind(app, kind);
  if (!page) throw new Error(`${kind} window did not open`);
  return page;
}

test.describe.configure({ mode: 'serial' });

let running: RunningApp;
let server: FakeServer;
const pageErrors: string[] = [];

test.beforeAll(async () => {
  server = await startFakeServer(PORT_A);
  running = await launchApp();
  running.app.on('window', (page) =>
    page.on('pageerror', (error) => pageErrors.push(`${page.url()}: ${error.message}`)),
  );
  running.panel.on('pageerror', (error) => pageErrors.push(`panel: ${error.message}`));
});

test.afterAll(async () => {
  await running.close();
  await server.close();
});

test('the boot script is served as its own file and disables zod code generation on every page', async () => {
  const boot = await appFetch(running.app, 'app://realtimedocs/boot.js');
  if (boot === 'failed') throw new Error('boot.js was not served');
  expect(boot.status).toBe(200);
  expect(boot.contentType).toBe('text/javascript; charset=utf-8');
  expect(boot.nosniff).toBe('nosniff');

  // Each packaged page references it as an external classic script, before its module bundle.
  for (const page of ['panel', 'settings', 'probe']) {
    const html = await running.app.evaluate(async ({ session }, url) => {
      const response = await session.fromPartition('persist:realtimedocs').fetch(url);
      return response.text();
    }, `app://realtimedocs/${page}.html`);
    const bootIndex = html.indexOf('<script src="/boot.js"></script>');
    const moduleIndex = html.indexOf('<script type="module"');
    expect(bootIndex, `${page}: boot script present`).toBeGreaterThan(-1);
    expect(moduleIndex, `${page}: module bundle present`).toBeGreaterThan(-1);
    expect(bootIndex, `${page}: boot script comes first`).toBeLessThan(moduleIndex);
    // And nothing inline.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  }
});

test('panel, settings and probe run with no console error and no policy violation', async () => {
  // Bring the panel to the state that runs the most code: a document session,
  // which mounts the editor, imports the API contracts (zod schemas) and talks
  // to the server. This stand-in server has no collaboration endpoint and
  // answers the editor's ticket requests with "busy", so the editor stays in
  // its retry loop; a live document is checked for the same two things against
  // the real server (test/real).
  await running.app.evaluate(
    async (_electron, [origin, link]) => {
      const controller = (
        globalThis as unknown as {
          __rdTest: {
            controller: {
              setServer(value: string): Promise<void>;
              openShareLink(value: string, source: 'settings'): Promise<void>;
            };
          };
        }
      ).__rdTest.controller;
      await controller.setServer(origin as string);
      await controller.openShareLink(link as string, 'settings');
    },
    [SERVER_A, shareUrl(SERVER_A)] as const,
  );
  await waitForState(
    running.panel,
    (state) => state.connection.session !== null,
    'document session',
  );
  await running.panel.waitForSelector('[data-testid="rd-editor"]', { timeout: 20_000 });
  // The editor asked for a ticket at least once (a failed request the app handles is not a console error).
  await expect
    .poll(() => server.requests.filter((request) => request.path.endsWith('/collab-ticket')).length)
    .toBeGreaterThan(0);

  // The panel really did load zod-backed contracts, with code generation switched off.
  const panelConfig = await running.panel.evaluate(() => {
    const config = (globalThis as { __zod_globalConfig?: { jitless?: boolean } })
      .__zod_globalConfig;
    return { jitless: config?.jitless === true };
  });
  expect(panelConfig).toEqual({ jitless: true });

  // Exercise the panel's own UI.
  await running.panel.click('[data-testid="rd-appearance-button"]');
  await running.panel.waitForSelector('[data-testid="rd-appearance-popover"]');
  await running.panel.keyboard.press('Escape');
  await running.panel.click('[data-testid="rd-more-button"]');
  await running.panel.keyboard.press('Escape');
  await running.panel.click('[data-testid="rd-collapse-button"]');
  await running.panel.click('[data-testid="rd-collapse-button"]');

  // Settings: every tab.
  await running.panel.evaluate(() => window.rdDesktop?.window.action('open-settings'));
  const settings = await waitForPage(running.app, 'settings');
  await settings.waitForSelector('[data-testid="rd-settings"]');
  for (const tab of SETTINGS_TABS) {
    await settings.getByRole('tab').nth(SETTINGS_TABS.indexOf(tab)).click();
    await settings.waitForTimeout(150);
  }
  expect(
    await settings.evaluate(
      () =>
        (globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless,
    ),
  ).toBe(true);

  // The resize probe.
  await settings.evaluate(() => window.rdDesktop?.diagnostics.openProbe());
  const probe = await waitForPage(running.app, 'probe');
  await probe.waitForSelector('[data-testid="rd-probe"]');
  expect(
    await probe.evaluate(
      () =>
        (globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless,
    ),
  ).toBe(true);
  await probe.waitForTimeout(300);

  const reported = await policyViolations(running.app);
  expect(reported, `policy violations: ${JSON.stringify(reported)}`).toEqual([]);
  const entries = await consoleEntries(running.app);
  const errors = entries.filter((entry) => entry.level === 'error');
  const violations = entries.filter((entry) => CSP_MESSAGE.test(entry.message));
  expect(violations, `policy violations in the console: ${JSON.stringify(violations)}`).toEqual([]);
  expect(errors, `console errors: ${JSON.stringify(errors)}`).toEqual([]);
  expect(pageErrors).toEqual([]);
  // Warnings are reported too, so a new one is noticed; none are expected.
  expect(entries, `console warnings: ${JSON.stringify(entries)}`).toEqual([]);

  // Closed from the settings window: a page that closes itself never gets the reply.
  await settings.evaluate(() => window.rdDesktop?.diagnostics.closeProbe());
  await expect.poll(() => pageByKind(running.app, 'probe') === undefined).toBe(true);
});

test('control: what zod would do without the boot script is recorded as a violation', async () => {
  expect(await policyViolations(running.app)).toEqual([]);
  // Probe `new Function` from page code and swallow the error, exactly like
  // zod's capability check. Nothing reaches the console...
  const consoleBefore = (await consoleEntries(running.app)).length;
  const blocked = await running.panel.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        setTimeout(() => {
          try {
            // Deliberate: proves the policy refuses code generation.
            new Function('');
            resolve(false);
          } catch {
            resolve(true);
          }
        }, 0);
      }),
  );
  expect(blocked).toBe(true);
  // ...but the violation is reported, so the test above would fail.
  await expect.poll(async () => (await policyViolations(running.app)).length).toBe(1);
  const [violation] = await policyViolations(running.app);
  expect(violation).toMatchObject({ window: 'panel', directive: 'script-src', blocked: 'eval' });
  expect((await consoleEntries(running.app)).length).toBe(consoleBefore);
  expect(running.stderr.join('')).toContain('"event":"renderer.policy_violation"');

  // A refused inline script is both reported and printed to the console.
  await running.panel.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__neverRuns = true';
    document.head.appendChild(script);
  });
  await expect.poll(async () => (await policyViolations(running.app)).length).toBe(2);
  expect((await policyViolations(running.app))[1]).toMatchObject({
    window: 'panel',
    directive: 'script-src-elem',
    blocked: 'inline',
  });
  await expect
    .poll(async () =>
      (await consoleEntries(running.app)).some((entry) => CSP_MESSAGE.test(entry.message)),
    )
    .toBe(true);
  expect(running.stderr.join('')).toContain('"event":"renderer.console"');
});
