import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Explicit root so `vitest run -c packages/ui/vitest.config.ts` works from the repo root too.
  root: import.meta.dirname,
  test: {
    name: 'ui',
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
  },
});
