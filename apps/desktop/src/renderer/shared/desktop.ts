/**
 * Renderer-side access to the preload bridge: one shared state store for
 * React (`useAppState`) and a helper that turns a failed action into a
 * message. Nothing here knows about Electron beyond `window.rdDesktop`.
 */
import { useSyncExternalStore } from 'react';
import type { RdDesktopApi } from '../../shared/bridge';
import type { IpcResult } from '../../shared/ipc-schemas';
import type { AppEvent, AppState } from '../../shared/state';

/** Null when the page is opened outside the desktop app (for example in a browser). */
export const desktop: RdDesktopApi | null = window.rdDesktop ?? null;

let current: AppState | null = null;
const listeners = new Set<() => void>();
let started = false;

function emit(next: AppState): void {
  // Snapshots can arrive out of order with the initial fetch; keep the newest.
  if (current && next.revision < current.revision) return;
  current = next;
  for (const listener of listeners) listener();
}

function start(): void {
  if (started || !desktop) return;
  started = true;
  desktop.onState(emit);
  void desktop.getState().then(emit, () => undefined);
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The latest state snapshot from the main process, or null until the first one arrives. */
export function useAppState(): AppState | null {
  return useSyncExternalStore(subscribe, () => current);
}

export function onAppEvent(listener: (event: AppEvent) => void): () => void {
  return desktop ? desktop.onEvent(listener) : () => undefined;
}

/**
 * Awaits an action and returns its error message, or null on success. A
 * rejected promise (the bridge itself failed) is reported the same way.
 */
export async function attempt(
  action: Promise<IpcResult<unknown>> | undefined,
): Promise<string | null> {
  if (!action) return 'This action is only available in the desktop app.';
  try {
    const result = await action;
    return result.ok ? null : result.error.message;
  } catch {
    return 'Something went wrong. Please try again.';
  }
}
