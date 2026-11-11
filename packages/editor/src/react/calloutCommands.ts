/**
 * Toolbar commands for callouts. Kept apart from the React code so they can be
 * tested against a real editor.
 *
 * The variant is an attribute of the node (rendered as `data-variant`); it never
 * becomes a style. Callouts do not nest: inside one, the menu changes or removes
 * it instead of wrapping again.
 */
import type { Editor } from '@tiptap/core';
import type { CalloutVariant } from '../schema';

/** Short label per variant, used by the menu and (in CSS) inside the callout. */
export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  info: 'Note',
  tip: 'Tip',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
};

/** Wraps the block(s) around the selection in a callout. False when the content does not fit. */
export function insertCallout(editor: Editor, variant: CalloutVariant): boolean {
  return editor.chain().focus().toggleWrap('callout', { variant }).run();
}

/** Changes the variant of the callout around the selection. */
export function setCalloutVariant(editor: Editor, variant: CalloutVariant): boolean {
  return editor.chain().focus().updateAttributes('callout', { variant }).run();
}

/** Replaces the callout around the selection with its content (one undo step). */
export function removeCallout(editor: Editor): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type.name !== 'callout') continue;
        if (dispatch) {
          const start = $from.before(depth);
          tr.replaceWith(start, start + node.nodeSize, node.content);
        }
        return true;
      }
      return false;
    })
    .run();
}
