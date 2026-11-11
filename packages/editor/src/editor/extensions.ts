/**
 * The browser editor's extension set.
 *
 * Built from the lead's DOM-free schema (`createSchemaExtensions`) with
 * overrides that only add node views, commands and plugins: node and mark
 * names, content expressions and attributes stay identical to the schema the
 * server uses.
 */
import { mergeAttributes, type AnyExtension, type RawCommands } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Highlight } from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { columnResizing, columnResizingPluginKey } from '@tiptap/pm/tables';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Y_FRAGMENT_FIELD } from '@realtimedocs/contracts';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { normalizeColor, readableInk } from '../clipboard/css';
import { Clipboard } from '../clipboard/extension';
import type { PasteReport } from '../clipboard/report';
import {
  AttachmentNode,
  DiagramNode,
  ImageNode,
  NODE_DIAGRAM,
  createSchemaExtensions,
} from '../schema';
import { Uploads } from '../uploads/extension';
import type { UploadLimits } from '../uploads/limits';
import type { UploadManager } from '../uploads/manager';
import { safeColumnWidth, safeInteger } from './attrs';
import { BlockFormatCommands } from './blockFormat';
import { Carets, ReadOnlyGuard, RemoteChangeTracker } from './collabPlugins';
import { FindReplace } from './findReplace';
import { createHighlightPlugin } from './highlight';
import { AttachmentView } from './nodeViews/AttachmentView';
import { CodeBlockView } from './nodeViews/CodeBlockView';
import { DiagramView } from './nodeViews/DiagramView';
import { ImageView } from './nodeViews/ImageView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    rdDiagram: {
      /** Inserts a Mermaid diagram block with starter source. */
      insertDiagram: (source?: string) => ReturnType;
    };
  }
}

export const DIAGRAM_STARTER = `flowchart LR
  A[Start] --> B{Decision}
  B -->|Yes| C[Result]
  B -->|No| D[Other result]`;

const ImageWithView = ImageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

const AttachmentWithView = AttachmentNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});

const DiagramWithView = DiagramNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView);
  },

  addCommands(): Partial<RawCommands> {
    return {
      insertDiagram:
        (source) =>
        ({ commands }) =>
          commands.insertContent({
            type: NODE_DIAGRAM,
            attrs: { language: 'mermaid' },
            content: [{ type: 'text', text: (source ?? DIAGRAM_STARTER).slice(0, 20_000) }],
          }),
    };
  },

  addKeyboardShortcuts() {
    const inDiagram = (): boolean =>
      this.editor.state.selection.$from.parent.type.name === NODE_DIAGRAM;
    /** Leaves the source: to the next block, creating a paragraph if none exists. */
    const exit = (): boolean => {
      const { state, view } = this.editor;
      const { $from } = state.selection;
      const after = $from.after();
      const tr = state.tr;
      const paragraph = state.schema.nodes.paragraph;
      if (!tr.doc.resolve(after).nodeAfter && paragraph) tr.insert(after, paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1));
      view.dispatch(tr.scrollIntoView());
      return true;
    };
    return {
      Tab: () => {
        if (!inDiagram() || !this.editor.isEditable) return false;
        return this.editor.commands.insertContent('  ');
      },
      'Shift-Tab': () => inDiagram(),
      'Mod-Enter': () => (inDiagram() ? exit() : false),
      ArrowDown: () => {
        if (!inDiagram()) return false;
        const { selection, doc } = this.editor.state;
        const { $from, empty } = selection;
        const atEnd = empty && $from.parentOffset === $from.parent.content.size;
        // Only when there is nowhere to go: the last block of the document.
        if (!atEnd || doc.resolve($from.after()).nodeAfter) return false;
        return exit();
      },
    };
  },
});

/**
 * Same mark and attribute as the schema's highlight; only the rendering
 * differs: the colour is validated and paired with an ink that stays readable
 * on it in both themes.
 */
const ReadableHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normalizeColor(element.getAttribute('data-color')) ??
          normalizeColor(element.style.backgroundColor),
        renderHTML: (attributes: { color?: unknown }) => {
          const color = normalizeColor(
            typeof attributes.color === 'string' ? attributes.color : null,
          );
          if (!color) return {};
          return {
            'data-color': color,
            style: `background-color: ${color}; color: ${readableInk(color)}`,
          };
        },
      },
    };
  },
}).configure({ multicolor: true });

const CodeBlockWithView = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createHighlightPlugin(this.name)];
  },
}).configure({ defaultLanguage: null, enableTabIndentation: true, tabSize: 2 });

/** Columns rendered for one table when it is serialized (copy, static HTML). */
const MAX_RENDERED_COLUMNS = 200;

const TableWithResizing = Table.extend({
  /**
   * Same markup as the stock renderer (used when a table is copied). Column
   * widths and spans are attribute values from the shared document and end up
   * in `style` attributes, so they are read defensively here.
   */
  renderHTML({ node, HTMLAttributes }) {
    const minWidth = this.options.cellMinWidth;
    const cols: DOMOutputSpec[] = [];
    let total = 0;
    let fixed = true;
    const row = node.firstChild;
    if (row) {
      for (let index = 0; index < row.childCount; index += 1) {
        const cell = row.child(index);
        const span = safeInteger(cell.attrs.colspan, 1, MAX_RENDERED_COLUMNS) ?? 1;
        const widths: unknown = cell.attrs.colwidth;
        for (let offset = 0; offset < span && cols.length < MAX_RENDERED_COLUMNS; offset += 1) {
          const width = Array.isArray(widths) ? safeColumnWidth(widths[offset]) : null;
          total += width ?? minWidth;
          if (width === null) fixed = false;
          cols.push([
            'col',
            { style: width === null ? `min-width: ${minWidth}px` : `width: ${width}px` },
          ]);
        }
      }
    }
    const style = fixed && cols.length > 0 ? `width: ${total}px` : `min-width: ${total}px`;
    return [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style }),
      ['colgroup', {}, ...cols],
      ['tbody', 0],
    ];
  },

  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    // The stock extension only registers column resizing when the editor is
    // editable at creation time. Editability changes live here (role changes,
    // first sync), and the plugin itself ignores input while read-only.
    const hasResizing = plugins.some(
      (plugin) => (plugin.spec.key as unknown) === columnResizingPluginKey,
    );
    if (hasResizing) return plugins;
    return [
      columnResizing({
        handleWidth: this.options.handleWidth,
        cellMinWidth: this.options.cellMinWidth,
        defaultCellMinWidth: this.options.cellMinWidth,
        View: null,
        lastColumnResizable: this.options.lastColumnResizable,
      }),
      ...plugins,
    ];
  },
}).configure({ resizable: true, allowTableNodeSelection: true, cellMinWidth: 56 });

export interface EditorExtensionOptions {
  documentId: string;
  /** Collaborative document; omit for static rendering. */
  collaboration?: {
    ydoc: Y.Doc;
    awareness: Awareness;
    /** Shared content that the schema cannot represent was found (kept, editing paused). */
    onInvalidContent: (error: Error) => void;
  };
  uploads: UploadManager | null;
  canEdit: () => boolean;
  limits: () => UploadLimits;
  onPasteReport: (report: PasteReport) => void;
  onRejectedFiles: (messages: string[]) => void;
  openLink: (href: string) => void;
  onLinkActivated: (anchor: HTMLAnchorElement) => void;
}

export function createEditorExtensions(options: EditorExtensionOptions): AnyExtension[] {
  const extensions = createSchemaExtensions({
    overrides: {
      image: ImageWithView,
      attachment: AttachmentWithView,
      diagram: DiagramWithView,
      codeBlock: CodeBlockWithView,
      table: TableWithResizing,
      blockFormat: BlockFormatCommands,
      highlight: ReadableHighlight,
    },
    starterKit: {
      // A trailing-paragraph plugin would write to the document on its own,
      // on every client including viewers. A paragraph is added on demand
      // instead (see `insertFiles` and the click handler of the editor).
      trailingNode: false,
      dropcursor: { class: 'rd-dropcursor', width: 2, color: false },
    },
  });

  extensions.push(
    FindReplace,
    Uploads.configure({
      manager: options.uploads,
      canEdit: options.canEdit,
      limits: options.limits,
      onRejected: options.onRejectedFiles,
    }),
    Clipboard.configure({
      documentId: options.documentId,
      uploads: options.uploads,
      canEdit: options.canEdit,
      limits: options.limits,
      onReport: options.onPasteReport,
      openLink: options.openLink,
      onLinkActivated: options.onLinkActivated,
    }),
  );

  const collaboration = options.collaboration;
  if (collaboration) {
    extensions.push(
      Collaboration.configure({
        document: collaboration.ydoc,
        field: Y_FRAGMENT_FIELD,
        // Content this client's schema does not know is kept in the shared
        // document; the editor shows what it can and stops writing.
        ySyncOptions: { onInvalidContent: collaboration.onInvalidContent },
      }),
      Carets.configure({ awareness: collaboration.awareness, canPublish: options.canEdit }),
      ReadOnlyGuard.configure({ canEdit: options.canEdit }),
      RemoteChangeTracker,
      Placeholder.configure({
        placeholder: 'Start writing…',
        showOnlyWhenEditable: true,
        showOnlyCurrent: false,
      }),
    );
  }
  return extensions;
}
