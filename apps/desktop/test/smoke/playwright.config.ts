import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Electron smoke tests. They drive the real built app (`dist/`) through
// Playwright's Electron support. On the build server they run inside the
// Playwright Docker image under Xvfb (`pnpm --filter @realtimedocs/desktop run
// test:smoke`); that is Linux/Xvfb evidence only and says nothing about
// Windows or macOS transparency, tray, shortcuts or capture behaviour.
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // One Electron app at a time: the tests use fixed loopback ports and global shortcuts.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: path.resolve(import.meta.dirname, '../../test-results/smoke'),
});
