/**
 * Small collaboration-related plugins:
 *
 * - `ReadOnlyGuard`: while the session may not edit, no local transaction can
 *   change the document, whatever a plugin or command tries. Changes coming
 *   from Yjs (remote edits) always pass.
 * - `RemoteChangeTracker`: remembers where the latest remote change happened
 *   (for Follow Latest) without touching scroll, focus or selection.
 * - `Carets`: remote cursors, with cursor publishing disabled for viewers.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { yCursorPlugin, ySyncPluginKey } from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';

interface SyncMeta {
  isChangeOrigin?: boolean;
  isUndoRedoOperation?: boolean;
}

/** Transactions carrying this meta may change the document while read-only. */
export const ALLOW_WHILE_READ_ONLY = 'rdAllowWhileReadOnly';

export const ReadOnlyGuard = Extension.create<{ canEdit: () => boolean }>({
  name: 'rdReadOnlyGuard',
  // Decide before any other plugin sees the transaction.
  priority: 1100,

  addOptions() {
    return { canEdit: () => true };
  },

  addProseMirrorPlugins() {
    const { canEdit } = this.options;
    return [
      new Plugin({
        key: new PluginKey('rdReadOnlyGuard'),
        filterTransaction(transaction) {
          if (!transaction.docChanged) return true;
          if (transaction.getMeta(ySyncPluginKey) !== undefined) return true;
          if (transaction.getMeta(ALLOW_WHILE_READ_ONLY)) return true;
          return canEdit();
        },
      }),
    ];
  },
});

export interface RemoteChangeState {
  /** Increases with every remote document change. */
  version: number;
  /** Document position at the end of the latest remote change. */
  position: number | null;
}

export const remoteChangeKey = new PluginKey<RemoteChangeState>('rdRemoteChange');

export function getRemoteChange(state: EditorState): RemoteChangeState {
  return remoteChangeKey.getState(state) ?? { version: 0, position: null };
}

export const RemoteChangeTracker = Extension.create({
  name: 'rdRemoteChange',

  addProseMirrorPlugins() {
    return [
      new Plugin<RemoteChangeState>({
        key: remoteChangeKey,
        state: {
          init: () => ({ version: 0, position: null }),
          apply(tr, value) {
            if (!tr.docChanged) return value;
            const sync = tr.getMeta(ySyncPluginKey) as SyncMeta | undefined;
            // Local undo/redo also arrives through the Yjs binding.
            const remote = sync?.isChangeOrigin === true && sync.isUndoRedoOperation !== true;
            if (!remote) {
              return value.position === null
                ? value
                : { ...value, position: tr.mapping.map(value.position, -1) };
            }
            let position: number | null = null;
            tr.mapping.maps.forEach((map, index) => {
              map.forEach((_oldStart, _oldEnd, _newStart, newEnd) => {
                // Bring the end of this step's range into the final document.
                position = tr.mapping.slice(index + 1).map(newEnd, -1);
              });
            });
            if (position === null) return value;
            return {
              version: value.version + 1,
              position: Math.min(position, tr.doc.content.size),
            };
          },
        },
      }),
    ];
  },
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function buildCaret(user: { name: string; color: string }): HTMLElement {
  const color = HEX_COLOR.test(user.color) ? user.color : '#8a8f98';
  const caret = document.createElement('span');
  caret.className = 'rd-caret';
  caret.style.setProperty('--rd-caret-color', color);
  const label = document.createElement('span');
  label.className = 'rd-caret__label';
  // textContent: a display name is never interpreted as markup.
  label.textContent = user.name.slice(0, 40);
  caret.append(document.createTextNode('\u2060'), label, document.createTextNode('\u2060'));
  return caret;
}

export interface CaretOptions {
  awareness: Awareness | null;
  /** Viewers see carets of editors but never publish their own cursor. */
  canPublish: () => boolean;
}

export const Carets = Extension.create<CaretOptions>({
  name: 'rdCarets',

  addOptions() {
    return { awareness: null, canPublish: () => false };
  },

  addProseMirrorPlugins() {
    const { awareness, canPublish } = this.options;
    if (!awareness) return [];
    // The cursor plugin only needs these members. Routing its writes through a
    // facade keeps a read-only client from publishing a cursor field at all.
    const facade = {
      get clientID() {
        return awareness.clientID;
      },
      getStates: () => awareness.getStates(),
      getLocalState: () => awareness.getLocalState(),
      setLocalStateField(field: string, value: unknown) {
        if (field === 'cursor' && value !== null && !canPublish()) {
          const local = awareness.getLocalState() as { cursor?: unknown } | null;
          if (local?.cursor != null) awareness.setLocalStateField('cursor', null);
          return;
        }
        awareness.setLocalStateField(field, value);
      },
      on: (name: string, listener: (...args: unknown[]) => void) =>
        awareness.on(name as 'change', listener),
      off: (name: string, listener: (...args: unknown[]) => void) =>
        awareness.off(name as 'change', listener),
    } as unknown as Awareness;

    return [
      yCursorPlugin(facade, {
        cursorBuilder: (user) => buildCaret(user),
        selectionBuilder: (user) => {
          const color = HEX_COLOR.test(user.color) ? user.color : '#8a8f98';
          return { class: 'rd-caret-selection', style: `background-color: ${color}33` };
        },
      }),
    ];
  },
});
