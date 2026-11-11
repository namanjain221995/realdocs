import { defineConfig } from 'vitest/config';

// Integration tests against real services: a PostgreSQL container started by
// the global setup and the built server bundle spawned as a child process.
// Files run one at a time because some of them stop PostgreSQL or kill the server.
export default defineConfig({
  test: {
    name: 'server-integration',
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    retry: 0,
  },
});
