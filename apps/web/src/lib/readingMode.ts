/**
 * Reading mode: a phone- and tablet-friendly way to keep a document in front
 * of you during a meeting. Large text, Follow Latest on, almost no chrome,
 * dark by default. Per device (`localStorage`), never part of the document.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { readStoredJson, removeStored, writeStoredJson } from './storage';

export const READING_KEY = 'rd.reading.v1';
/** The editor accepts 0.8 – 1.8; reading mode starts large. */
export const READING_SCALE_MIN = 1;
export const READING_SCALE_MAX = 1.8;
export const READING_SCALE_STEP = 0.1;

export interface ReadingMode {
  enabled: boolean;
  fontScale: number;
  /** Dark unless the reader chose light. */
  light: boolean;
}

export const DEFAULT_READING_MODE: ReadingMode = { enabled: false, fontScale: 1.4, light: false };

export function clampReadingScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_READING_MODE.fontScale;
  const stepped = Math.round(value / READING_SCALE_STEP) * READING_SCALE_STEP;
  return Math.round(Math.min(READING_SCALE_MAX, Math.max(READING_SCALE_MIN, stepped)) * 100) / 100;
}

export function parseReadingMode(raw: unknown): ReadingMode {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_READING_MODE;
  const { enabled, fontScale, light } = raw as Record<string, unknown>;
  return {
    enabled: enabled === true,
    fontScale:
      typeof fontScale === 'number' ? clampReadingScale(fontScale) : DEFAULT_READING_MODE.fontScale,
    light: light === true,
  };
}

let current: ReadingMode | null = null;
const listeners = new Set<() => void>();

function load(): ReadingMode {
  current ??= parseReadingMode(readStoredJson(READING_KEY));
  return current;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== READING_KEY) return;
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

function save(next: ReadingMode): void {
  current = next;
  // The default (off, untouched) leaves nothing behind.
  if (!next.enabled && next.fontScale === DEFAULT_READING_MODE.fontScale && !next.light) {
    removeStored(READING_KEY);
  } else {
    writeStoredJson(READING_KEY, next);
  }
  emit();
}

export function useReadingMode(): {
  reading: ReadingMode;
  update: (patch: Partial<ReadingMode>) => void;
} {
  const reading = useSyncExternalStore(subscribe, load, () => DEFAULT_READING_MODE);
  const update = useCallback((patch: Partial<ReadingMode>) => {
    const merged = { ...load(), ...patch };
    save({ ...merged, fontScale: clampReadingScale(merged.fontScale) });
  }, []);
  return { reading, update };
}

/** Test helper. */
export function resetReadingModeCacheForTests(): void {
  current = null;
}
