/**
 * The viewer's own display preferences: font scale, reading width and
 * document tone. They belong to this browser (`localStorage`), apply to how
 * the document is drawn here, and never change the shared document.
 *
 * The shape matches `DisplayPreferences` of `@realtimedocs/editor`; it is
 * declared here so that the editor package stays imported from exactly one
 * place (`features/document/EditorMount.tsx`).
 */
import { useCallback, useSyncExternalStore } from 'react';
import { readStoredJson, removeStored, writeStoredJson } from './storage';

export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.8;
export const FONT_SCALE_STEP = 0.05;

export const READING_WIDTHS = ['narrow', 'normal', 'wide', 'full'] as const;
export type ReadingWidth = (typeof READING_WIDTHS)[number];

export const DOCUMENT_TONES = ['inherit', 'dark', 'light'] as const;
export type DocumentTone = (typeof DOCUMENT_TONES)[number];

export interface DisplayPreferences {
  /** 0.8 – 1.8, multiplies the document font size. */
  fontScale: number;
  readingWidth: ReadingWidth;
  /** Document colours; `inherit` follows the app theme. */
  tone: DocumentTone;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  fontScale: 1,
  readingWidth: 'normal',
  tone: 'inherit',
};

export const DISPLAY_PREFERENCES_KEY = 'rd.display.v1';

export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DISPLAY_PREFERENCES.fontScale;
  const stepped = Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP;
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, stepped));
  return Math.round(clamped * 100) / 100;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * Validates whatever was stored. A missing field takes its default; a field
 * with a value this version does not know discards the whole record, because
 * it was not written by this app.
 */
export function parseDisplayPreferences(raw: unknown): DisplayPreferences {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DEFAULT_DISPLAY_PREFERENCES;
  }
  const { fontScale, readingWidth, tone } = raw as Record<string, unknown>;
  if (fontScale !== undefined && typeof fontScale !== 'number') return DEFAULT_DISPLAY_PREFERENCES;
  if (readingWidth !== undefined && !isOneOf(readingWidth, READING_WIDTHS)) {
    return DEFAULT_DISPLAY_PREFERENCES;
  }
  if (tone !== undefined && !isOneOf(tone, DOCUMENT_TONES)) return DEFAULT_DISPLAY_PREFERENCES;
  return {
    fontScale:
      fontScale === undefined ? DEFAULT_DISPLAY_PREFERENCES.fontScale : clampFontScale(fontScale),
    readingWidth: readingWidth ?? DEFAULT_DISPLAY_PREFERENCES.readingWidth,
    tone: tone ?? DEFAULT_DISPLAY_PREFERENCES.tone,
  };
}

export function isDefaultDisplayPreferences(preferences: DisplayPreferences): boolean {
  return (
    preferences.fontScale === DEFAULT_DISPLAY_PREFERENCES.fontScale &&
    preferences.readingWidth === DEFAULT_DISPLAY_PREFERENCES.readingWidth &&
    preferences.tone === DEFAULT_DISPLAY_PREFERENCES.tone
  );
}

// A tiny store so every mounted consumer (and other tabs) sees one value.
let current: DisplayPreferences | null = null;
const listeners = new Set<() => void>();

function load(): DisplayPreferences {
  current ??= parseDisplayPreferences(readStoredJson(DISPLAY_PREFERENCES_KEY));
  return current;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Another tab changed the preferences: re-read them once and tell everyone. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== DISPLAY_PREFERENCES_KEY) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function setDisplayPreferences(next: DisplayPreferences): void {
  current = parseDisplayPreferences(next);
  if (isDefaultDisplayPreferences(current)) removeStored(DISPLAY_PREFERENCES_KEY);
  else writeStoredJson(DISPLAY_PREFERENCES_KEY, current);
  emit();
}

export interface DisplayPreferencesControls {
  preferences: DisplayPreferences;
  update: (patch: Partial<DisplayPreferences>) => void;
  reset: () => void;
}

export function useDisplayPreferences(): DisplayPreferencesControls {
  const preferences = useSyncExternalStore(subscribe, load, () => DEFAULT_DISPLAY_PREFERENCES);
  const update = useCallback((patch: Partial<DisplayPreferences>) => {
    setDisplayPreferences({ ...load(), ...patch });
  }, []);
  const reset = useCallback(() => {
    setDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES);
  }, []);
  return { preferences, update, reset };
}

/** Test helper: drop the in-memory copy so the next read comes from storage. */
export function resetDisplayPreferencesCacheForTests(): void {
  current = null;
}

/**
 * Follow Latest (scroll along with other people's changes) for readers. Also
 * the reader's own choice, also kept in this browser only.
 */
export const FOLLOW_LATEST_KEY = 'rd.follow-latest.v1';

export function readFollowLatest(): boolean {
  return readStoredJson(FOLLOW_LATEST_KEY) === true;
}

export function writeFollowLatest(value: boolean): void {
  if (value) writeStoredJson(FOLLOW_LATEST_KEY, true);
  else removeStored(FOLLOW_LATEST_KEY);
}
