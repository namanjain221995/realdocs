import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the web app against a mocked API.
 *
 * They exercise the user interface only: every `/api` request is answered by
 * `test-browser/support/mockApi.ts`, whose responses are validated against
 * the contract schemas. Nothing here proves server behaviour; the end-to-end
 * suite in `tests/e2e` does that against the real server.
 *
 * The app under test is the production build served by `vite preview` with
 * the production Content-Security-Policy, so run `pnpm --filter
 * @realtimedocs/web run build` first. Port 4435 is in the web agent's range
 * and leaves 4430 to 4432 to the real-stack suite (`playwright.real.config.ts`),
 * so both can run while the real stack is up.
 *
 * Run inside the Playwright image (browsers are not installed on the host):
 *
 *   docker run --rm --name rd-web-pw --network host --user 1000:1000 -e HOME=/tmp \
 *     -v "$PWD":/work -w /work/apps/web mcr.microsoft.com/playwright:v1.64.1-noble \
 *     node /work/node_modules/@playwright/test/cli.js test -c playwright.config.ts
 */
const PORT = 4435;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * `RD_WEB_SERVER=dev` runs the same specs against `vite dev` instead of the
 * production build. That is how React's development checks (StrictMode's
 * double effects, key and nesting warnings) get exercised; the specs that are
 * about the built output (`shell.spec.ts`, screenshots) do not apply there.
 */
const DEV = process.env.RD_WEB_SERVER === 'dev';
const VITE = 'node node_modules/vite/bin/vite.js';
const BUILD_ONLY = /(shell|screenshots)\.spec\.ts/;

export default defineConfig({
  testDir: './test-browser',
  outputDir: './test-results/mocked',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 4,
  // The dev server transforms modules on demand, so its first page loads are slow.
  timeout: DEV ? 60_000 : 30_000,
  expect: { timeout: DEV ? 20_000 : 7_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A fixed zone and locale keep dates in assertions and screenshots stable.
    timezoneId: 'UTC',
    locale: 'en-GB',
  },
  webServer: {
    command: `${VITE} ${DEV ? '' : 'preview'} --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `${BASE_URL}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    // No proxy: a request the mock does not answer must fail, not reach a real server.
    env: { RD_API_PROXY: 'off' },
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: DEV ? BUILD_ONLY : undefined,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: DEV ? BUILD_ONLY : /screenshots\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: DEV ? BUILD_ONLY : /screenshots\.spec\.ts/,
    },
  ],
});
