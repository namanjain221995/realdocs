/**
 * Narrow editor state for the toolbar.
 *
 * The toolbar must not re-render on every keystroke. The state is computed at
 * most once per animation frame after a transaction, in one pass over the
 * selection, and published only when a field actually changed.
 */
import type { Editor } from '@tiptap/core';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { useEffect, useState } from 'react';
import { CALLOUT_VARIANTS, type CalloutVariant } from '../schema';

export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  color: string;
  highlight: string;
  fontSize: string;
  /** `paragraph`, `heading1` … `heading4`, or `other`. */
  block: string;
  align: string;
  lineHeight: string;
  indent: number;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  inTable: boolean;
  /** Variant of the callout around the selection, or `''` outside a callout. */
  callout: CalloutVariant | '';
  /** A callout can be wrapped around the current block(s) (false inside one). */
  canCallout: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const EMPTY_TOOLBAR_STATE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  link: false,
  color: '',
  highlight: '',
  fontSize: '',
  block: 'paragraph',
  align: 'left',
  lineHeight: '',
  indent: 0,
  bulletList: false,
  orderedList: false,
  taskList: false,
  blockquote: false,
  codeBlock: false,
  inTable: false,
  callout: '',
  canCallout: false,
  canUndo: false,
  canRedo: false,
};

export function readToolbarState(editor: Editor): ToolbarState {
  const { state } = editor;
  const { $from, empty } = state.selection;
  const next: ToolbarState = { ...EMPTY_TOOLBAR_STATE };

  const marks = empty
    ? (state.storedMarks ?? $from.marks())
    : $from.marksAcross(state.selection.$to);
  for (const mark of marks ?? []) {
    switch (mark.type.name) {
      case 'bold':
        next.bold = true;
        break;
      case 'italic':
        next.italic = true;
        break;
      case 'underline':
        next.underline = true;
        break;
      case 'strike':
        next.strike = true;
        break;
      case 'code':
        next.code = true;
        break;
      case 'link':
        next.link = true;
        break;
      case 'highlight':
        next.highlight = typeof mark.attrs.color === 'string' ? mark.attrs.color : 'default';
        break;
      case 'textStyle':
        if (typeof mark.attrs.color === 'string') next.color = mark.attrs.color;
        if (typeof mark.attrs.fontSize === 'string') next.fontSize = mark.attrs.fontSize;
        break;
      default:
        break;
    }
  }

  const parent = $from.parent;
  if (parent.type.name === 'heading') next.block = `heading${String(parent.attrs.level)}`;
  else if (parent.type.name === 'paragraph') next.block = 'paragraph';
  else next.block = 'other';
  if (typeof parent.attrs.textAlign === 'string') next.align = parent.attrs.textAlign;
  if (typeof parent.attrs.lineHeight === 'string') next.lineHeight = parent.attrs.lineHeight;
  next.indent = Number(parent.attrs.indent) || 0;
  next.codeBlock = parent.type.name === 'codeBlock';

  // The innermost list decides which list button is active.
  let listSeen = false;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (!listSeen && (name === 'bulletList' || name === 'orderedList' || name === 'taskList')) {
      listSeen = true;
      next[name] = true;
    } else if (name === 'blockquote') next.blockquote = true;
    else if (name === 'table') next.inTable = true;
    else if (name === 'callout' && next.callout === '') {
      // The variant comes from the shared document: only listed values count.
      const variant: unknown = $from.node(depth).attrs.variant;
      next.callout =
        CALLOUT_VARIANTS.find((candidate) => candidate === variant) ?? CALLOUT_VARIANTS[0];
    }
  }
  next.canCallout = next.callout === '' && editor.can().wrapIn('callout');

  const undo = yUndoPluginKey.getState(state)?.undoManager;
  next.canUndo = (undo?.undoStack.length ?? 0) > 0;
  next.canRedo = (undo?.redoStack.length ?? 0) > 0;
  return next;
}

function sameState(a: ToolbarState, b: ToolbarState): boolean {
  for (const key of Object.keys(a) as (keyof ToolbarState)[]) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function useToolbarState(editor: Editor | null): ToolbarState {
  const [state, setState] = useState<ToolbarState>(EMPTY_TOOLBAR_STATE);

  useEffect(() => {
    if (!editor) return undefined;
    let frame: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const compute = (): void => {
      frame = null;
      timer = null;
      if (editor.isDestroyed) return;
      const next = readToolbarState(editor);
      setState((previous) => (sameState(previous, next) ? previous : next));
    };
    const schedule = (): void => {
      if (frame !== null || timer !== null) return;
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(compute);
      else timer = setTimeout(compute, 16);
    };
    schedule();
    editor.on('transaction', schedule);
    // The undo stack also changes without a ProseMirror transaction of ours.
    editor.on('focus', schedule);
    return () => {
      editor.off('transaction', schedule);
      editor.off('focus', schedule);
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
    };
  }, [editor]);

  return state;
}
