import { defineConfig, devices } from '@playwright/test';

/**
 * Acceptance specs against the real stack of `stack.mjs` (real server, real
 * PostgreSQL, real web build with the server's own CSP). Nothing is mocked.
 * Run them with `pnpm test:e2e` (see docs/testing.md).
 *
 * Specs that stop or kill the shared server, or the database, run in the
 * `disruptive-*` projects. `run.mjs` runs those after the others with
 * `--workers=1`; never run them next to other specs.
 */
const browsers = [
  ['chromium', devices['Desktop Chrome']],
  ['firefox', devices['Desktop Firefox']],
  ['webkit', devices['Desktop Safari']],
] as const;

const DISRUPTIVE = /(restart|db-outage|ticket-renewal)\.spec\.ts/;

export default defineConfig({
  testDir: './specs',
  outputDir: './.stage/test-results',
  globalSetup: './support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 3,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4330',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'UTC',
    locale: 'en-GB',
  },
  projects: [
    ...browsers.map(([name, device]) => ({
      name,
      use: { ...device },
      testIgnore: DISRUPTIVE,
    })),
    ...browsers.map(([name, device]) => ({
      name: `disruptive-${name}`,
      use: { ...device },
      testMatch: DISRUPTIVE,
    })),
  ],
});
