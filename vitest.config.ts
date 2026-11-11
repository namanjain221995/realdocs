import { defineConfig } from 'vitest/config';

// Unit tests only. Each package/app owns a `vitest.config.ts` project.
// Integration tests (real PostgreSQL) run via `pnpm test:integration`,
// browser end-to-end tests via `pnpm test:e2e`.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
});
