import { defineConfig } from 'vitest/config';

// Unit tests: no database, no network. Run with
// `pnpm exec vitest run --project server` from the repository root.
export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
