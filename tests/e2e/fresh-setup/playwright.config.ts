import { defineConfig, devices } from '@playwright/test';

/** The one spec of `fresh-setup/run.mjs`: a browser against the freshly built Compose deployment. */
export default defineConfig({
  testDir: '.',
  testMatch: /first-document\.spec\.ts/,
  outputDir: '../.stage/fresh/test-results',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.RD_FRESH_URL,
    trace: 'retain-on-failure',
    timezoneId: 'UTC',
    locale: 'en-GB',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
