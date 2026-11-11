import { defineConfig } from 'vitest/config';

// Unit tests for the desktop companion. Everything under test here is pure or
// takes its Electron dependencies as injected interfaces, so the suite runs in
// plain Node.js without an Electron binary or a display.
export default defineConfig({
  test: {
    name: 'desktop',
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
  },
});
