import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the web app against the REAL stack: the real server (API,
 * collaboration endpoint, static web app with its own CSP header) and a real
 * PostgreSQL. Nothing is mocked. The stack is started separately:
 *
 *   node apps/web/test-real/stack.mjs up        # keeps running; `down` stops it
 *
 * and the tests run inside the Playwright image (see `docs/notes/web.md`).
 * `outage.spec.ts` stops and restarts the server, so it has its own projects
 * and runs on its own, one worker at a time, after everything else:
 *
 *   … playwright test -c playwright.real.config.ts --project=chromium --project=firefox --project=webkit
 *   … playwright test -c playwright.real.config.ts --project=outage-chromium --project=outage-firefox --project=outage-webkit --workers=1
 *
 * `RD_REAL_BASE_URL=http://127.0.0.1:4431` points the same tests at a Vite
 * development server that proxies to the real server.
 */
const BASE_URL = process.env.RD_REAL_BASE_URL ?? 'http://127.0.0.1:4430';

const browsers = [
  ['chromium', devices['Desktop Chrome']],
  ['firefox', devices['Desktop Firefox']],
  ['webkit', devices['Desktop Safari']],
] as const;

export default defineConfig({
  testDir: './test-real',
  outputDir: './test-results/real',
  globalSetup: './test-real/support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 3,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'UTC',
    locale: 'en-GB',
  },
  projects: [
    ...browsers.map(([name, device]) => ({
      name,
      use: { ...device },
      // Pictures for review are taken in Chromium only.
      testIgnore: name === 'chromium' ? /outage\.spec\.ts/ : /(outage|screenshots)\.spec\.ts/,
    })),
    ...browsers.map(([name, device]) => ({
      name: `outage-${name}`,
      use: { ...device },
      testMatch: /outage\.spec\.ts/,
    })),
  ],
});
