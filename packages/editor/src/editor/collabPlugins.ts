/**
 * Small collaboration-related plugins:
 *
 * - `ReadOnlyGuard`: while the session may not edit, no local transaction can
 *   change the document, whatever a plugin or command tries. Changes coming
 *   from Yjs (remote edits) always pass.
 * - `RemoteChangeTracker`: remembers where the latest remote change happened
 *   (for Follow Latest) without touching scroll, focus or selection.
 * - `Carets`: remote cursors, with cursor publishing disabled for viewers.
 * - `CaretKeeper`: keeps the local caret in its own block when a remote change adds
 *   an identical block (for example an empty paragraph) before it.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import {
  relativePositionToAbsolutePosition,
  yCursorPlugin,
  ySyncPluginKey,
  type ProsemirrorBinding,
} from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

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

/**
 * True when the shared type a relative position points into still exists: neither it nor one of
 * its ancestors was deleted. Such a position is exact; nothing has to be guessed.
 */
function anchoredInLiveType(doc: Y.Doc, position: Y.RelativePosition): boolean {
  let type: Y.AbstractType<unknown> | null;
  try {
    type = Y.createAbsolutePositionFromRelativePosition(position, doc)?.type ?? null;
  } catch {
    return false;
  }
  if (type === null) return false;
  for (
    let item = type._item;
    item !== null;
    item = (item.parent as Y.AbstractType<unknown>)._item
  ) {
    if (item.deleted) return false;
    if (!(item.parent instanceof Y.AbstractType)) return false;
  }
  return true;
}

/**
 * After a remote change the binding restores the local selection from Yjs relative positions and
 * then, for a caret at the start of a text block, second-guesses the result by looking for "the
 * n-th block with this type and text". When a remote editor has just added an identical block
 * before the caret's block (two people pressing Enter at the same place both create an empty
 * paragraph), that guess moves the caret into the other person's block, and the next keystrokes
 * land there. The relative position itself is exact as long as the block it points into still
 * exists, so in that case it wins over the guess. A block that was deleted and created again
 * (the case the guess exists for) is left to the binding.
 */
export const CaretKeeper = Extension.create({
  name: 'rdCaretKeeper',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('rdCaretKeeper'),
        appendTransaction(transactions, _oldState, newState) {
          const remote = transactions.some((transaction) => {
            const sync = transaction.getMeta(ySyncPluginKey) as SyncMeta | undefined;
            return sync?.isChangeOrigin === true && sync.isUndoRedoOperation !== true;
          });
          if (!remote || !(newState.selection instanceof TextSelection)) return null;
          const binding = (
            ySyncPluginKey.getState(newState) as { binding?: ProsemirrorBinding } | undefined
          )?.binding;
          const before = binding?.beforeTransactionSelection;
          if (!binding || !before || before.type !== 'text') return null;
          if (before.anchor === null || before.head === null) return null;
          if (binding.invalidContentError !== null) return null;
          if (
            !anchoredInLiveType(binding.doc, before.anchor) ||
            !anchoredInLiveType(binding.doc, before.head)
          ) {
            return null;
          }
          const { doc, type, mapping } = binding;
          const anchor = relativePositionToAbsolutePosition(doc, type, before.anchor, mapping);
          const head = relativePositionToAbsolutePosition(doc, type, before.head, mapping);
          if (anchor === null || head === null) return null;
          const size = newState.doc.content.size;
          if (anchor < 0 || head < 0 || anchor > size || head > size) return null;
          const { selection } = newState;
          if (selection.anchor === anchor && selection.head === head) return null;
          const $anchor = newState.doc.resolve(anchor);
          const $head = newState.doc.resolve(head);
          // Only exact text positions: anything else is left as the binding set it.
          if (!$anchor.parent.isTextblock || !$head.parent.isTextblock) return null;
          return newState.tr
            .setSelection(TextSelection.create(newState.doc, anchor, head))
            .setMeta('addToHistory', false);
        },
      }),
    ];
  },
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function buildCaret(user: { name: string; color: string; roleLabel?: unknown }): HTMLElement {
  const color = HEX_COLOR.test(user.color) ? user.color : '#8a8f98';
  const caret = document.createElement('span');
  caret.className = 'rd-caret';
  caret.style.setProperty('--rd-caret-color', color);
  const label = document.createElement('span');
  label.className = 'rd-caret__label';
  // textContent: a display name is never interpreted as markup.
  // Interview participants carry a server-set role label: "Aarav — Candidate".
  const roleLabel =
    typeof user.roleLabel === 'string' && user.roleLabel !== '' ? user.roleLabel.slice(0, 20) : '';
  label.textContent = roleLabel
    ? `${user.name.slice(0, 40)} \u2014 ${roleLabel}`
    : user.name.slice(0, 40);
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
