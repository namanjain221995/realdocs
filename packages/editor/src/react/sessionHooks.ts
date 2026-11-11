/** React bindings of the collaboration session's status store. */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { CollabSession } from '../collab/session';
import type { SessionStatus } from '../collab/status';

export function useSessionStatus(session: CollabSession): SessionStatus {
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const read = useCallback(() => session.getStatus(), [session]);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Subscribes to one derived value of the status. The component re-renders
 * only when that value changes, not on every acknowledged keystroke.
 * `selector` must be a stable function (define it at module level).
 */
export function useSessionSelector<T>(
  session: CollabSession,
  selector: (status: SessionStatus) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cache = useRef<{ status: SessionStatus; value: T } | null>(null);
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const read = useCallback(() => {
    const status = session.getStatus();
    const previous = cache.current;
    if (previous && previous.status === status) return previous.value;
    const next = selector(status);
    const value = previous && isEqual(previous.value, next) ? previous.value : next;
    cache.current = { status, value };
    return value;
  }, [session, selector, isEqual]);
  return useSyncExternalStore(subscribe, read, read);
}
