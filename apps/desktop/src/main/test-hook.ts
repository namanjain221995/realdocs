/**
 * Test-only diagnostics hook for the automated smoke test.
 *
 * It exists only when ALL of these are true:
 * - the bundle was built with `__RD_TEST_HOOK__ = true` (development/test
 *   builds; the packaging build sets it to `false`, and the bundler then drops
 *   this module's call site and code),
 * - the app is not packaged (`app.isPackaged === false`),
 * - the environment contains `RD_DESKTOP_TEST_HOOK=1`.
 *
 * The hook gives the test runner (which already has full main-process access
 * through the debugger) convenient entry points into the same code paths that
 * the tray, the global shortcuts and the operating system use. It is attached
 * to the main process's `globalThis`; no renderer can reach it.
 */
import type { AppController } from './controller';
import type { EncryptionAdapter } from './credential-store';

export const TEST_HOOK_MARKER = 'rd-desktop-test-hook';
export const TEST_KEYSTORE_MARKER = 'rd-desktop-test-keystore';

export interface TestHook {
  marker: typeof TEST_HOOK_MARKER;
  controller: AppController;
}

export function installTestHook(controller: AppController): void {
  (globalThis as { __rdTest?: TestHook }).__rdTest = { marker: TEST_HOOK_MARKER, controller };
}

/**
 * A stand-in for the operating system's secret store, for automated tests on
 * machines that have none (the Linux test container offers only Chromium's
 * `basic_text` backend, which the app rightly refuses to treat as encryption).
 * It lets a test exercise everything around the store — writing the session
 * file, restoring it after a restart, validating it with the server, deleting
 * it — but it is NOT encryption: the bytes are merely not the plain text.
 *
 * Reachable only through the test hook's conditions (see above) plus
 * `RD_DESKTOP_TEST_KEYSTORE=1`; the packaging build compiles it out, and the
 * package inspection checks that the marker is absent.
 */
export function createTestKeystore(): EncryptionAdapter {
  const prefix = `${TEST_KEYSTORE_MARKER}:`;
  const mask = 0x5a;
  return {
    availability: () =>
      Promise.resolve({
        available: true,
        backend: 'test_keystore',
        detail:
          'TEST BUILD: the session is stored with a stand-in key store that is not encryption.',
      }),
    encrypt: (plainText) =>
      Promise.resolve(
        Buffer.from(Buffer.from(`${prefix}${plainText}`, 'utf8').map((byte) => byte ^ mask)),
      ),
    decrypt: (data) => {
      const text = Buffer.from(data.map((byte) => byte ^ mask)).toString('utf8');
      return text.startsWith(prefix)
        ? Promise.resolve(text.slice(prefix.length))
        : Promise.reject(new Error('not written by the test key store'));
    },
  };
}
