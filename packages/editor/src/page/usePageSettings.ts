import type { PageSettings } from '@realtimedocs/contracts';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { createPageSettingsStore, resetPageSettings, setPageSettings } from './store';

export interface PageSettingsControls {
  settings: PageSettings;
  /** Writes the changed keys in one transaction (one undo step). No-op when read-only. */
  update: (patch: Partial<PageSettings>) => void;
  reset: () => void;
}

/**
 * Live page settings of a document. `origin` tags the writes so the editor's
 * undo manager records them; `canEdit` guards the writes locally (the server
 * refuses them from read-only connections as well).
 */
export function usePageSettings(
  ydoc: Y.Doc,
  options: { origin?: unknown; canEdit?: boolean } = {},
): PageSettingsControls {
  const { origin = null, canEdit = true } = options;
  const store = useMemo(() => createPageSettingsStore(ydoc), [ydoc]);
  const settings = useSyncExternalStore(store.subscribe, store.get, store.get);
  const update = useCallback(
    (patch: Partial<PageSettings>) => {
      if (canEdit) setPageSettings(ydoc, patch, origin);
    },
    [canEdit, origin, ydoc],
  );
  const reset = useCallback(() => {
    if (canEdit) resetPageSettings(ydoc, origin);
  }, [canEdit, origin, ydoc]);
  return { settings, update, reset };
}
