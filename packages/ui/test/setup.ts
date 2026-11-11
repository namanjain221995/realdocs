import { afterEach, beforeEach } from 'vitest';
import { cleanup } from './helpers';

// Tells React that `act()` is in use, so state updates outside it are reported.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * React reports problems (updates outside act, invalid DOM props, missing
 * keys) through console.error and console.warn. Any such call fails the test
 * unless the test replaced the console method itself.
 */
const reported: string[] = [];
const original = { error: console.error, warn: console.warn };

function record(kind: 'error' | 'warn') {
  return (...args: unknown[]): void => {
    reported.push(`console.${kind}: ${args.map(String).join(' ')}`);
  };
}

beforeEach(() => {
  reported.length = 0;
  console.error = record('error');
  console.warn = record('warn');
});

afterEach(() => {
  console.error = original.error;
  console.warn = original.warn;

  // Suites that opt into the node environment have no DOM to reset.
  if (typeof document !== 'undefined') {
    cleanup();
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
    try {
      window.localStorage.clear();
    } catch {
      // A test may have replaced storage with one that throws.
    }
  }

  if (reported.length > 0) {
    const messages = reported.splice(0).join('\n\n');
    throw new Error(`Unexpected console output during the test:\n\n${messages}`);
  }
});
