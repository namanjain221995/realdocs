/**
 * Indentation and line spacing for paragraphs and headings.
 *
 * Extends the schema's `blockFormat` extension (attributes stay exactly as
 * the lead defined them) with commands and the Tab / Shift-Tab bindings used
 * outside lists, tables and code.
 */
import type { GlobalAttributes, RawCommands } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { BlockFormat, LINE_HEIGHTS, MAX_INDENT, type LineHeight } from '../schema';
import { safeIndent, safeLineHeight } from './attrs';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockFormat: {
      /** Increases the indentation of the selected paragraphs and headings. */
      indent: () => ReturnType;
      outdent: () => ReturnType;
      /** Sets the line spacing of the selected blocks; null restores the default. */
      setLineHeight: (value: LineHeight | null) => ReturnType;
    };
  }
}

const FORMATTABLE = new Set(['paragraph', 'heading']);
/** Ancestors in which Tab already means something else. */
const TAB_OWNERS = new Set([
  'listItem',
  'taskItem',
  'tableCell',
  'tableHeader',
  'codeBlock',
  'diagram',
]);

function selectedBlocks(state: EditorState): { node: PMNode; pos: number }[] {
  const blocks: { node: PMNode; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (FORMATTABLE.has(node.type.name)) {
      blocks.push({ node, pos });
      return false;
    }
    return true;
  });
  return blocks;
}

function changeIndent(state: EditorState, tr: Transaction, delta: number): boolean {
  let changed = false;
  for (const { node, pos } of selectedBlocks(state)) {
    const current = safeIndent(node.attrs.indent);
    const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
    if (next === current) continue;
    tr.setNodeAttribute(pos, 'indent', next);
    changed = true;
  }
  return changed;
}

function insideTabOwner(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (TAB_OWNERS.has($from.node(depth).type.name)) return true;
  }
  return false;
}

export const BlockFormatCommands = BlockFormat.extend({
  // After lists, tables and code blocks had their chance at Tab.
  priority: 50,

  /**
   * Same attributes as the schema; only their rendering is stricter. The
   * values end up in a `style` attribute, and a value written by another
   * client could otherwise carry extra declarations (`1; position: fixed; …`).
   */
  addGlobalAttributes(this: { parent?: (() => GlobalAttributes) | null }): GlobalAttributes {
    return (this.parent?.() ?? []).map((entry) => ({
      ...entry,
      attributes: {
        ...entry.attributes,
        indent: {
          ...entry.attributes.indent,
          renderHTML: (attributes: Record<string, unknown>) => {
            const indent = safeIndent(attributes.indent);
            return indent > 0
              ? { 'data-indent': String(indent), style: `margin-left: ${indent * 2}em` }
              : {};
          },
        },
        lineHeight: {
          ...entry.attributes.lineHeight,
          renderHTML: (attributes: Record<string, unknown>) => {
            const lineHeight = safeLineHeight(attributes.lineHeight);
            return lineHeight
              ? { 'data-line-height': lineHeight, style: `line-height: ${lineHeight}` }
              : {};
          },
        },
      },
    }));
  },

  addCommands(): Partial<RawCommands> {
    return {
      indent:
        () =>
        ({ state, tr, dispatch }) => {
          const changed = changeIndent(state, tr, 1);
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      outdent:
        () =>
        ({ state, tr, dispatch }) => {
          const changed = changeIndent(state, tr, -1);
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      setLineHeight:
        (value) =>
        ({ state, tr, dispatch }) => {
          if (value !== null && !(LINE_HEIGHTS as readonly string[]).includes(value)) return false;
          const blocks = selectedBlocks(state);
          if (blocks.length === 0) return false;
          if (dispatch) {
            for (const { pos } of blocks) tr.setNodeAttribute(pos, 'lineHeight', value);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { state } = this.editor;
        if (!this.editor.isEditable || insideTabOwner(state)) return false;
        this.editor.commands.indent();
        // Keep focus in the document even at the maximum level.
        return true;
      },
      'Shift-Tab': () => {
        const { state } = this.editor;
        if (!this.editor.isEditable || insideTabOwner(state)) return false;
        this.editor.commands.outdent();
        return true;
      },
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    };
  },
});
