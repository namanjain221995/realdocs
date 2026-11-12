/**
 * Conversions between ProseMirror JSON and Yjs state, using the single
 * authoritative schema from `@realtimedocs/editor/schema`.
 *
 * A document's Yjs state is created exactly once by the server (new document,
 * duplicate, new generation). Clients never initialise content.
 */
import {
  DEFAULT_PAGE_SETTINGS,
  normalizePageSettings,
  Y_FRAGMENT_FIELD,
  Y_PAGE_FIELD,
  type PageSettings,
} from '@realtimedocs/contracts';
import { EMPTY_DOCUMENT, getDocumentSchema, type DocJSON } from '@realtimedocs/editor/schema';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as Y from 'yjs';

/**
 * Encodes ProseMirror JSON as the initial Yjs state of a document or generation.
 * `pageSettings` (already normalised) are written as flat keys of the `page` map, only where they
 * differ from the defaults: an empty map means defaults.
 */
export function encodeInitialState(
  json: DocJSON = EMPTY_DOCUMENT,
  validate = true,
  pageSettings?: PageSettings,
): Uint8Array {
  const schema = getDocumentSchema();
  if (validate) schema.nodeFromJSON(json).check();
  const ydoc = prosemirrorJSONToYDoc(schema, json, Y_FRAGMENT_FIELD);
  try {
    if (pageSettings) {
      const map = ydoc.getMap(Y_PAGE_FIELD);
      for (const key of Object.keys(DEFAULT_PAGE_SETTINGS) as (keyof PageSettings)[]) {
        if (pageSettings[key] !== DEFAULT_PAGE_SETTINGS[key]) map.set(key, pageSettings[key]);
      }
    }
    return Y.encodeStateAsUpdate(ydoc);
  } finally {
    ydoc.destroy();
  }
}

export function ydocToJson(ydoc: Y.Doc): DocJSON {
  const json = yDocToProsemirrorJSON(ydoc, Y_FRAGMENT_FIELD) as DocJSON;
  // An untouched fragment serialises without content; normalise to a valid document.
  if (!Array.isArray(json.content) || json.content.length === 0) return EMPTY_DOCUMENT;
  return json;
}

/** Rebuilds a Y.Doc from a compacted state plus the ordered updates after it. */
export function buildYDoc(state: Uint8Array | null, updates: readonly Uint8Array[] = []): Y.Doc {
  const ydoc = new Y.Doc();
  if (state) Y.applyUpdate(ydoc, state);
  for (const update of updates) Y.applyUpdate(ydoc, update);
  return ydoc;
}

/** The normalised page settings held by a compacted state plus the updates after it. */
export function pageSettingsFromState(
  state: Uint8Array | null,
  updates: readonly Uint8Array[] = [],
): PageSettings {
  const ydoc = buildYDoc(state, updates);
  try {
    return normalizePageSettings(ydoc.getMap(Y_PAGE_FIELD).toJSON());
  } finally {
    ydoc.destroy();
  }
}

export function stateToJson(
  state: Uint8Array | null,
  updates: readonly Uint8Array[] = [],
): DocJSON {
  const ydoc = buildYDoc(state, updates);
  try {
    return ydocToJson(ydoc);
  } finally {
    ydoc.destroy();
  }
}

/** Folds a compacted state and later updates into one full state. */
export function mergeToState(state: Uint8Array | null, updates: readonly Uint8Array[]): Uint8Array {
  const ydoc = buildYDoc(state, updates);
  try {
    return Y.encodeStateAsUpdate(ydoc);
  } finally {
    ydoc.destroy();
  }
}

/**
 * Re-encodes content as a brand-new Yjs history (new client id, no
 * tombstones). Used for a restored generation and for duplicates, so that
 * nothing of the source's Yjs history is shared with the new state.
 * Falls back to the given state when the content does not round-trip.
 */
export function reencodeFresh(
  json: DocJSON,
  fallbackState: Uint8Array,
  pageSettings?: PageSettings,
): Uint8Array {
  try {
    return encodeInitialState(json, false, pageSettings);
  } catch {
    return fallbackState;
  }
}
