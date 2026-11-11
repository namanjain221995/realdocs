import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export const APP_NAME = 'RealtimeDocs';

/** `Documents – RealtimeDocs`; just the product name when there is no page title. */
export function pageTitle(title: string | null | undefined): string {
  const trimmed = title?.trim();
  return trimmed ? `${trimmed} – ${APP_NAME}` : APP_NAME;
}

/** Keeps `document.title` in step with the current screen. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}

/** Returns `value` once it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** `navigator.onLine`, kept current. It can say "online" on a dead network; treat it as a hint. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// One shared clock for every relative timestamp on the page.
const clockListeners = new Set<() => void>();
let clockTimer: number | null = null;
let clockNow = Date.now();
const CLOCK_INTERVAL_MS = 30_000;

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockNow = Date.now();
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      for (const each of clockListeners) each();
    }, CLOCK_INTERVAL_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** The current time, refreshed every 30 seconds while anything is subscribed. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow,
    () => clockNow,
  );
}

/**
 * Whole seconds left until `untilMs` (epoch ms), ticking once a second, or 0
 * when `untilMs` is null or has passed.
 */
export function useCountdown(untilMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (untilMs === null) return undefined;
    setNow(Date.now());
    const handle = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= untilMs) window.clearInterval(handle);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [untilMs]);
  if (untilMs === null) return 0;
  return Math.max(0, Math.ceil((untilMs - now) / 1000));
}

/**
 * A value that follows its source (here: the address) but shows a choice at
 * once, while the navigation that records the choice is still on its way.
 * Tabs kept in the address need it: without it, a second key pressed in that
 * moment is judged against the tab that was selected before the first one.
 */
export function useEagerValue<T>(source: T): [T, (next: T) => void] {
  const [state, setState] = useState({ source, value: source });
  // The source moved (navigation finished, back or forward was used): follow it.
  if (!Object.is(state.source, source)) setState({ source, value: source });
  const value = Object.is(state.source, source) ? state.value : source;
  const choose = useCallback((next: T) => {
    setState((current) => ({ source: current.source, value: next }));
  }, []);
  return [value, choose];
}
