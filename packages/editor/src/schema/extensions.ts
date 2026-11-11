/**
 * The single authoritative RealtimeDocs document schema, expressed as Tiptap
 * extensions without any DOM, node view or browser dependency.
 *
 * - The server builds a ProseMirror schema from these to create, seed,
 *   duplicate and export documents.
 * - The browser/desktop editor uses the *same* list and swaps in richer
 *   variants (node views, commands) via `overrides`, keyed by extension name.
 *   An override must keep the node/mark name, content expression and
 *   attributes identical; anything else requires bumping
 *   `DOCUMENT_SCHEMA_VERSION` in @realtimedocs/contracts.
 */
import type { AnyExtension } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Highlight } from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import type { Schema } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { ALLOWED_LINK_PROTOCOLS, isSafeLinkHref } from './links';
import { AttachmentNode, BlockFormat, CalloutNode, DiagramNode, ImageNode } from './nodes';

export const HEADING_LEVELS = [1, 2, 3, 4] as const;
export const TEXT_ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
/** Font sizes offered by the toolbar. Other pasted sizes are preserved if they parse. */
export const FONT_SIZES = ['11px', '12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];

export interface SchemaExtensionOptions {
  /**
   * Replacement extensions keyed by extension `name` (for example
   * `{ image: ImageWithNodeView, codeBlock: CodeBlockLowlight }`).
   */
  overrides?: Record<string, AnyExtension>;
  /** Extra StarterKit options merged over the schema defaults (browser-only plugins). */
  starterKit?: Parameters<typeof StarterKit.configure>[0];
}

export function createSchemaExtensions(options: SchemaExtensionOptions = {}): AnyExtension[] {
  const base: AnyExtension[] = [
    StarterKit.configure({
      // History is collaboration-aware (Yjs UndoManager), never ProseMirror's own.
      undoRedo: false,
      // Replaced below so the language attribute and highlighting stay under our control.
      codeBlock: false,
      heading: { levels: [...HEADING_LEVELS] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        protocols: ALLOWED_LINK_PROTOCOLS.map((protocol) => protocol.slice(0, -1)),
        isAllowedUri: (url) => isSafeLinkHref(url),
        shouldAutoLink: (url) => isSafeLinkHref(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
      ...options.starterKit,
    }),
    TextStyle,
    Color,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: [...TEXT_ALIGNMENTS],
    }),
    BlockFormat,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlock.configure({ defaultLanguage: null }),
    ImageNode,
    AttachmentNode,
    DiagramNode,
    CalloutNode,
  ];

  const overrides = options.overrides ?? {};
  const used = new Set<string>();
  const result = base.map((extension) => {
    const replacement = overrides[extension.name];
    if (!replacement) return extension;
    used.add(extension.name);
    return replacement;
  });
  const unknown = Object.keys(overrides).filter((name) => !used.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown schema extension override(s): ${unknown.join(', ')}`);
  }
  return result;
}

let cachedSchema: Schema | null = null;

/** ProseMirror schema of the authoritative document format (memoised). */
export function getDocumentSchema(): Schema {
  cachedSchema ??= getSchema(createSchemaExtensions());
  return cachedSchema;
}

/** JSON-serialisable ProseMirror node. */
export interface DocJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocJSON[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** Content of a brand-new document. Written exactly once, by the server. */
export const EMPTY_DOCUMENT: DocJSON = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};
