import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useIsomorphicLayoutEffect } from './internal/hooks';

/** The user's choice. `system` follows the operating system setting. */
export type Theme = 'dark' | 'light' | 'system';
/** The theme actually applied to the page. */
export type ResolvedTheme = 'dark' | 'light';

export interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

export interface ThemeProviderProps {
  children?: ReactNode;
  /** `localStorage` key the choice is saved under. Defaults to `rd.theme`. */
  storageKey?: string;
  /** Used until the user picks a theme. Defaults to `dark`. */
  defaultTheme?: Theme;
}

const DEFAULT_STORAGE_KEY = 'rd.theme';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light' || value === 'system';
}

function readStoredTheme(storageKey: string): Theme | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : null;
  } catch {
    // Storage can be missing or blocked (private mode, sandboxed frames, quota).
    return null;
  }
}

function writeStoredTheme(storageKey: string, theme: Theme): void {
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // The choice still applies for this session.
  }
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(SYSTEM_DARK_QUERY);
  } catch {
    return null;
  }
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = systemQuery();
  if (!query || typeof query.addEventListener !== 'function') return () => undefined;
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSystemTheme(): ResolvedTheme {
  const query = systemQuery();
  // Without a system signal the product default (dark) applies.
  return query && !query.matches ? 'light' : 'dark';
}

function getServerSystemTheme(): ResolvedTheme {
  return 'dark';
}

/**
 * Holds the theme choice, saves it to `localStorage` and mirrors the resolved
 * theme to `data-theme` on `<html>`, which is what `styles.css` keys off.
 */
export function ThemeProvider({
  children,
  storageKey = DEFAULT_STORAGE_KEY,
  defaultTheme = 'dark',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (typeof window === 'undefined' ? null : readStoredTheme(storageKey)) ?? defaultTheme,
  );
  const systemTheme = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemTheme,
    getServerSystemTheme,
  );
  const resolved: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  useIsomorphicLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  // Follow a change made in another tab or window of the same origin.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== storageKey) return;
      setThemeState(isTheme(event.newValue) ? event.newValue : defaultTheme);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey, defaultTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      writeStoredTheme(storageKey, next);
    },
    [storageKey],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/** Reads and changes the theme. Must be called below a `ThemeProvider`. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme() must be used inside <ThemeProvider>.');
  return value;
}
