import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Real-stack tests: the desktop app (development build, `dist/`) against the
// real server, a real PostgreSQL and the real editor. Started through
// `pnpm --filter @realtimedocs/desktop run test:real` (scripts/real-stack.mjs),
// which brings the stack up, runs these specs inside the Playwright Docker
// image under Xvfb and tears everything down again.
//
// Linux/Xvfb evidence only. Nothing here says how the panel behaves on
// Windows or macOS.
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.ts',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  // One Electron app at a time, one server: the specs stop and start it.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: path.resolve(import.meta.dirname, '../../test-results/real'),
});
