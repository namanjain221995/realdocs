/**
 * Keeps the screen awake while `active` is true, with the Screen Wake Lock API.
 *
 * The browser drops the lock whenever the page is hidden, so it is asked for
 * again when the page becomes visible. It is released when `active` turns
 * false and when the component using the hook goes away. Browsers without the
 * API (or that refuse) report `unsupported` / `denied`, and the screen may sleep.
 */
import { useEffect, useState } from 'react';

export type WakeLockStatus = 'off' | 'active' | 'unsupported' | 'denied';

interface Sentinel extends EventTarget {
  release: () => Promise<void>;
}

interface WakeLockApi {
  request: (type: 'screen') => Promise<Sentinel>;
}

function wakeLockApi(): WakeLockApi | null {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return api && typeof api.request === 'function' ? api : null;
}

export function isWakeLockSupported(): boolean {
  return wakeLockApi() !== null;
}

export function useWakeLock(active: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>('off');

  useEffect(() => {
    if (!active) {
      setStatus('off');
      return undefined;
    }
    const api = wakeLockApi();
    if (!api) {
      setStatus('unsupported');
      return undefined;
    }

    let disposed = false;
    let sentinel: Sentinel | null = null;
    let pending = false;

    const acquire = async (): Promise<void> => {
      if (disposed || sentinel || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const lock = await api.request('screen');
        if (disposed) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) {
            sentinel = null;
            if (!disposed) setStatus('off');
          }
        });
        setStatus('active');
      } catch {
        if (!disposed) setStatus('denied');
      } finally {
        pending = false;
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void acquire();
    };

    document.addEventListener('visibilitychange', onVisibility);
    void acquire();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const held = sentinel;
      sentinel = null;
      if (held) void held.release().catch(() => undefined);
    };
  }, [active]);

  return status;
}
