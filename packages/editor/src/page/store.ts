/**
 * Page settings in the shared Yjs document (top-level Y.Map `Y_PAGE_FIELD`).
 *
 * Reading always goes through `normalizePageSettings`: another client can
 * write any JSON into the map, and the editor never trusts it. Writing sends
 * only the keys that changed, in one transaction, so one gesture is one undo
 * step and one update on the wire.
 */
import {
  DEFAULT_PAGE_SETTINGS,
  normalizePageSettings,
  samePageSettings,
  Y_PAGE_FIELD,
  type PageSettings,
} from '@realtimedocs/contracts';
import type * as Y from 'yjs';

export function pageMap(ydoc: Y.Doc): Y.Map<unknown> {
  return ydoc.getMap<unknown>(Y_PAGE_FIELD);
}

/** The current, valid settings of the document. */
export function readPageSettings(ydoc: Y.Doc): PageSettings {
  return normalizePageSettings(pageMap(ydoc).toJSON());
}

/**
 * Applies `patch` on top of the current settings and writes the keys whose
 * normalised value changed. Returns false when nothing needed writing.
 * `origin` identifies the transaction (the undo manager tracks it).
 */
export function setPageSettings(
  ydoc: Y.Doc,
  patch: Partial<PageSettings>,
  origin: unknown = null,
): boolean {
  const map = pageMap(ydoc);
  const current = normalizePageSettings(map.toJSON());
  const next = normalizePageSettings({ ...current, ...patch });
  if (samePageSettings(current, next)) return false;
  ydoc.transact(() => {
    for (const key of Object.keys(DEFAULT_PAGE_SETTINGS) as (keyof PageSettings)[]) {
      if (current[key] !== next[key]) map.set(key, next[key]);
    }
  }, origin);
  return true;
}

/** Removes every stored key, which means "all defaults". One transaction. */
export function resetPageSettings(ydoc: Y.Doc, origin: unknown = null): boolean {
  const map = pageMap(ydoc);
  if (map.size === 0) return false;
  ydoc.transact(() => map.clear(), origin);
  return true;
}

export interface PageSettingsStore {
  get(): PageSettings;
  subscribe(listener: () => void): () => void;
}

/**
 * An external store for `useSyncExternalStore`: the snapshot keeps its identity
 * until the normalised value changes, so unrelated map writes do not re-render.
 */
export function createPageSettingsStore(ydoc: Y.Doc): PageSettingsStore {
  const map = pageMap(ydoc);
  let snapshot = normalizePageSettings(map.toJSON());
  const refresh = (): boolean => {
    const next = normalizePageSettings(map.toJSON());
    if (samePageSettings(snapshot, next)) return false;
    snapshot = next;
    return true;
  };
  return {
    get() {
      refresh();
      return snapshot;
    },
    subscribe(listener) {
      const onChange = (): void => {
        if (refresh()) listener();
      };
      map.observe(onChange);
      return () => map.unobserve(onChange);
    },
  };
}
