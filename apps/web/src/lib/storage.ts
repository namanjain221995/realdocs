/**
 * `localStorage` access that never throws (private mode, blocked storage,
 * quota). Only viewer preferences go through here: theme and display
 * preferences. Secrets, tokens and document content are never stored.
 */

export function readStoredJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeStoredJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // The value still applies for this page; it just will not be remembered.
    return false;
  }
}

export function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
