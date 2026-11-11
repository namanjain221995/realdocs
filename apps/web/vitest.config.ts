import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'web',
    // Browser-facing code runs under happy-dom. These are unit tests of the
    // app's own logic; browser behaviour is covered by `test-browser/`.
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
