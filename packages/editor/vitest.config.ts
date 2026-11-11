import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'editor',
    // Browser-facing code runs under happy-dom; DOM-free suites opt out with
    // `// @vitest-environment node` at the top of the file.
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
