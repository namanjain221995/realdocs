/**
 * `EncryptionAdapter` backed by Electron's `safeStorage` (Keychain on macOS,
 * DPAPI on Windows, a secret store on Linux).
 *
 * Electron 45 deprecates the synchronous `safeStorage` methods (removal is
 * announced for Electron 46), so the asynchronous API is used throughout.
 *
 * On Linux, Electron falls back to a hard-coded plaintext password when no
 * secret store is available (`getSelectedStorageBackend() === 'basic_text'`).
 * That is not encryption at rest, so it is treated as unavailable and the
 * session stays in memory.
 */
import { safeStorage } from 'electron';
import type { EncryptionAdapter, EncryptionAvailability } from './credential-store';

const AVAILABILITY_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('failed'));
      },
    );
  });
}

export function createSafeStorageAdapter(platform: NodeJS.Platform): EncryptionAdapter {
  return {
    async availability(): Promise<EncryptionAvailability> {
      let backend: string | null = null;
      if (platform === 'linux') {
        backend = safeStorage.getSelectedStorageBackend();
        if (backend === 'basic_text' || backend === 'unknown') {
          return {
            available: false,
            backend,
            detail:
              'No operating-system secret store is available (backend: ' +
              backend +
              '). The session is kept in memory only and ends when the app quits.',
          };
        }
      }
      let available: boolean;
      try {
        available = await withTimeout(
          safeStorage.isAsyncEncryptionAvailable(),
          AVAILABILITY_TIMEOUT_MS,
        );
      } catch {
        return {
          available: false,
          backend,
          detail:
            'The operating system did not answer the secure-storage check. The session is kept in memory only and ends when the app quits.',
        };
      }
      if (!available) {
        return {
          available: false,
          backend,
          detail:
            'Operating-system encryption is not available. The session is kept in memory only and ends when the app quits.',
        };
      }
      const store =
        platform === 'darwin'
          ? 'the macOS Keychain'
          : platform === 'win32'
            ? 'Windows data protection (DPAPI) for your user account'
            : `the ${backend ?? 'system'} secret store`;
      return {
        available: true,
        backend,
        detail: `The session for the last document is stored encrypted with ${store}.`,
      };
    },

    encrypt(plainText: string): Promise<Buffer> {
      return safeStorage.encryptStringAsync(plainText);
    },

    async decrypt(data: Buffer): Promise<string> {
      const { result } = await safeStorage.decryptStringAsync(data);
      return result;
    },
  };
}
