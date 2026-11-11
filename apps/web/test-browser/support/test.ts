/**
 * Test harness for the mocked-API browser tests.
 *
 * Every test gets:
 *  - `api`: a fresh `MockApi` answering all `/api` requests (installed even
 *    when the test does not mention it, so nothing can reach a real server);
 *  - a browser clock frozen at `NOW`, so relative times are deterministic;
 *  - automatic failure on: a request without a mock, a contract violation,
 *    a Content-Security-Policy violation, an uncaught page error or an
 *    unexpected console error.
 */
import type { User } from '@realtimedocs/contracts';
import { expect, type Page, test as base } from '@playwright/test';
import { NOW } from './fixtures';
import { MockApi } from './mockApi';

export { expect };
export * from './fixtures';
export { MockApi, PUBLIC_ORIGIN, seedShareLink } from './mockApi';

interface Fixtures {
  api: MockApi;
}

/** Browsers log every failed or non-2xx request to the console; the tests assert on the UI instead. */
const EXPECTED_CONSOLE_NOISE = [
  /Failed to load resource/i,
  /the server responded with a status of/i,
  /net::ERR_/i,
  /NetworkError when attempting to fetch resource/i,
  /Load failed/i,
  /access control checks/i,
];

const allowedConsole = new WeakMap<Page, RegExp[]>();

/** Declares a console error this test provokes on purpose (beyond failed requests). */
export function allowConsoleErrors(page: Page, pattern: RegExp): void {
  allowedConsole.set(page, [...(allowedConsole.get(page) ?? []), pattern]);
}

export const test = base.extend<Fixtures>({
  api: [
    async ({ page }, use) => {
      const api = new MockApi();
      const problems: string[] = [];
      const cspViolations: string[] = [];

      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
      await page.exposeBinding('__rdReportCsp', (_source, detail: string) => {
        cspViolations.push(detail);
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = (window as unknown as { __rdReportCsp?: (detail: string) => void })
            .__rdReportCsp;
          report?.(`${event.violatedDirective} blocked ${event.blockedURI}`);
        });
      });
      // The desktop builds are not published unless a test says so (a test's own route wins).
      await page.route('**/download/**', (route) =>
        route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
      );
      await page.clock.setFixedTime(new Date(NOW));
      await api.install(page);

      await use(api);

      const expected = [...EXPECTED_CONSOLE_NOISE, ...(allowedConsole.get(page) ?? [])];
      const unexpected = problems.filter(
        (problem) => !expected.some((pattern) => pattern.test(problem)),
      );
      expect(api.unhandled, 'API requests that no mock answered').toEqual([]);
      expect(api.violations, 'contract violations').toEqual([]);
      expect(cspViolations, 'Content-Security-Policy violations').toEqual([]);
      expect(unexpected, 'console errors and uncaught exceptions').toEqual([]);
    },
    { auto: true },
  ],
});

/** Starts the test already signed in (the session endpoint answers with this account). */
export function signedInAs(api: MockApi, user: User): void {
  api.signIn(user);
}

export type ThemeName = 'dark' | 'light';

/** Chooses the theme before the app loads, the way a returning visitor would have it saved. */
export async function setSavedTheme(page: Page, theme: ThemeName): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('rd.theme', value);
    } catch {
      // Storage may be unavailable before the first navigation; the default theme applies.
    }
  }, theme);
}

/** True when the page is wider than the viewport, i.e. it scrolls sideways. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
}

/** Everything in web storage, to assert that a secret was never persisted. */
export async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const dump: Record<string, string> = {};
    for (const [name, store] of [
      ['local', window.localStorage],
      ['session', window.sessionStorage],
    ] as const) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (key !== null) dump[`${name}:${key}`] = store.getItem(key) ?? '';
      }
    }
    return JSON.stringify(dump) + document.cookie;
  });
}
