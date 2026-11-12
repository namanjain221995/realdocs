/**
 * Custom nodes of the authoritative RealtimeDocs document schema.
 *
 * This file is DOM-free: it only declares node specs, attributes and their
 * HTML (de)serialisation, so the server can build the same schema to create,
 * seed and export documents. The browser editor extends these nodes with node
 * views, commands and plugins (see ../extensions) without changing their
 * names, content expressions or attributes.
 *
 * Asset-backed nodes store stable asset ids and metadata only — never base64
 * payloads, blob: URLs or signed URLs. `uploadId` marks a node whose bytes are
 * still being uploaded by some client; it is replaced by `assetId` once the
 * upload succeeds.
 */
import {
  PARAGRAPH_INDENT_MAX_MM,
  normalizeParagraphIndents,
  paragraphIndentMm,
} from '@realtimedocs/contracts';
import { Extension, Node, mergeAttributes } from '@tiptap/core';

export const NODE_IMAGE = 'image';
export const NODE_ATTACHMENT = 'attachment';
export const NODE_DIAGRAM = 'diagram';
export const NODE_CALLOUT = 'callout';

/** Callout styles. Rendered as `data-variant`; anything else falls back to `info`. */
export const CALLOUT_VARIANTS = ['info', 'tip', 'success', 'warning', 'danger'] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export const IMAGE_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type ImageAlignment = (typeof IMAGE_ALIGNMENTS)[number];

export interface ImageAttrs {
  assetId: string | null;
  uploadId: string | null;
  alt: string;
  caption: string;
  /** Rendered width as a percentage (10–100) of the content column; null = natural size. */
  width: number | null;
  align: ImageAlignment;
  naturalWidth: number | null;
  naturalHeight: number | null;
  name: string;
}

export interface AttachmentAttrs {
  assetId: string | null;
  uploadId: string | null;
  name: string;
  sizeBytes: number | null;
  mime: string;
}

export const DIAGRAM_LANGUAGES = ['mermaid'] as const;
export type DiagramLanguage = (typeof DIAGRAM_LANGUAGES)[number];

export const MAX_INDENT = 8;
export const LINE_HEIGHTS = ['1', '1.15', '1.5', '2'] as const;
export type LineHeight = (typeof LINE_HEIGHTS)[number];

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/*
 * Attribute values are validated twice: when HTML is parsed (pasted or loaded
 * content) and again when a node is rendered. The second check matters because
 * a collaborator's client can write any JSON value into any attribute through
 * Yjs, and ProseMirror does not validate attributes that arrive that way. A
 * value that is not of the expected shape is never written into markup, a
 * `style` attribute or a child position of the rendered element.
 */

function idAttr(value: unknown): string | null {
  return typeof value === 'string' && ID_RE.test(value) ? value : null;
}

function intAttr(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function textAttr(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function choiceAttr<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && (choices as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** A stored ruler indent in millimetres, or null for "none" (also for anything invalid). */
function indentAttr(value: unknown, min: number): number | null {
  const mm = paragraphIndentMm(value, min, PARAGRAPH_INDENT_MAX_MM);
  return mm === 0 ? null : mm;
}

/**
 * Markup of a paragraph's or heading's horizontal position: the Tab level (`indent`, 2em each)
 * plus the ruler indents. Every number is clamped here, at render time, because a collaborator's
 * client can store anything in these attributes.
 *
 * Lengths use `--rd-mm`, the size of one millimetre on the surface that shows the document (the
 * editor defines it so that indents shrink with a narrow page exactly like the page margins);
 * outside the editor, for example in copied HTML, the fallback is a true millimetre. The `min()`
 * keeps a text column whatever the numbers and the page are.
 */
export function paragraphIndentMarkup(attrs: Record<string, unknown>): Record<string, string> {
  const level = intAttr(attrs.indent, 0, MAX_INDENT) ?? 0;
  const { left, right, firstLine } = normalizeParagraphIndents({
    left: attrs.indentLeft,
    right: attrs.indentRight,
    firstLine: attrs.indentFirstLine,
  });
  const out: Record<string, string> = {};
  const style: string[] = [];
  const mm = (value: number): string => `calc(var(--rd-mm, 3.7795px) * ${value})`;
  if (left !== 0) {
    out['data-indent-left'] = String(left);
    style.push(
      level > 0
        ? `margin-left: calc(${level * 2}em + min(${mm(left)}, 40%))`
        : `margin-left: min(${mm(left)}, 40%)`,
    );
  } else if (level > 0) {
    style.push(`margin-left: ${level * 2}em`);
  }
  if (right !== 0) {
    out['data-indent-right'] = String(right);
    style.push(`margin-right: min(${mm(right)}, 40%)`);
  }
  if (firstLine !== 0) {
    out['data-indent-first-line'] = String(firstLine);
    style.push(`text-indent: ${mm(firstLine)}`);
  }
  if (style.length > 0) out.style = style.join('; ');
  return out;
}

function lineHeightAttr(value: unknown): LineHeight | null {
  return typeof value === 'string' && (LINE_HEIGHTS as readonly string[]).includes(value)
    ? (value as LineHeight)
    : null;
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;

function mimeAttr(value: unknown): string {
  return typeof value === 'string' && MIME_RE.test(value) ? value : 'application/octet-stream';
}

export const ImageNode = Node.create({
  name: NODE_IMAGE,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (el) => idAttr(el.getAttribute('data-asset-id')),
        renderHTML: (attrs) => {
          const assetId = idAttr(attrs.assetId);
          return assetId ? { 'data-asset-id': assetId } : {};
        },
      },
      uploadId: {
        default: null,
        parseHTML: (el) => idAttr(el.getAttribute('data-upload-id')),
        renderHTML: (attrs) => {
          const uploadId = idAttr(attrs.uploadId);
          return uploadId ? { 'data-upload-id': uploadId } : {};
        },
      },
      alt: {
        default: '',
        parseHTML: (el) => textAttr(el.getAttribute('data-alt'), 1000),
        renderHTML: (attrs) => {
          const alt = textAttr(attrs.alt, 1000);
          return alt ? { 'data-alt': alt } : {};
        },
      },
      caption: {
        default: '',
        parseHTML: (el) => textAttr(el.getAttribute('data-caption'), 1000),
        renderHTML: (attrs) => {
          const caption = textAttr(attrs.caption, 1000);
          return caption ? { 'data-caption': caption } : {};
        },
      },
      width: {
        default: null,
        parseHTML: (el) => intAttr(el.getAttribute('data-width'), 10, 100),
        renderHTML: (attrs) => {
          const width = intAttr(attrs.width, 10, 100);
          return width === null ? {} : { 'data-width': String(width) };
        },
      },
      align: {
        default: 'center',
        parseHTML: (el) => choiceAttr(el.getAttribute('data-align'), IMAGE_ALIGNMENTS, 'center'),
        renderHTML: (attrs) => ({
          'data-align': choiceAttr(attrs.align, IMAGE_ALIGNMENTS, 'center'),
        }),
      },
      naturalWidth: {
        default: null,
        parseHTML: (el) => intAttr(el.getAttribute('data-natural-width'), 1, 100_000),
        renderHTML: (attrs) => {
          const naturalWidth = intAttr(attrs.naturalWidth, 1, 100_000);
          return naturalWidth === null ? {} : { 'data-natural-width': String(naturalWidth) };
        },
      },
      naturalHeight: {
        default: null,
        parseHTML: (el) => intAttr(el.getAttribute('data-natural-height'), 1, 100_000),
        renderHTML: (attrs) => {
          const naturalHeight = intAttr(attrs.naturalHeight, 1, 100_000);
          return naturalHeight === null ? {} : { 'data-natural-height': String(naturalHeight) };
        },
      },
      name: {
        default: '',
        parseHTML: (el) => textAttr(el.getAttribute('data-name'), 255),
        renderHTML: (attrs) => {
          const name = textAttr(attrs.name, 255);
          return name ? { 'data-name': name } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="image"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Read as strings, never as given: an array here would be taken for markup.
    const alt = textAttr(node.attrs.alt, 1000);
    const caption = textAttr(node.attrs.caption, 1000);
    const figure = mergeAttributes(HTMLAttributes, { 'data-type': 'image' });
    // No `src`: bytes are only reachable through the authorized asset endpoint
    // and are resolved by the renderer at display time.
    const img: [string, Record<string, string>] = ['img', { alt, draggable: 'false' }];
    return caption ? ['figure', figure, img, ['figcaption', {}, caption]] : ['figure', figure, img];
  },
});

export const AttachmentNode = Node.create({
  name: NODE_ATTACHMENT,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (el) => idAttr(el.getAttribute('data-asset-id')),
        renderHTML: (attrs) => {
          const assetId = idAttr(attrs.assetId);
          return assetId ? { 'data-asset-id': assetId } : {};
        },
      },
      uploadId: {
        default: null,
        parseHTML: (el) => idAttr(el.getAttribute('data-upload-id')),
        renderHTML: (attrs) => {
          const uploadId = idAttr(attrs.uploadId);
          return uploadId ? { 'data-upload-id': uploadId } : {};
        },
      },
      name: {
        default: '',
        parseHTML: (el) => textAttr(el.getAttribute('data-name'), 255),
        renderHTML: (attrs) => ({ 'data-name': textAttr(attrs.name, 255) }),
      },
      sizeBytes: {
        default: null,
        parseHTML: (el) => intAttr(el.getAttribute('data-size'), 0, Number.MAX_SAFE_INTEGER),
        renderHTML: (attrs) => {
          const sizeBytes = intAttr(attrs.sizeBytes, 0, Number.MAX_SAFE_INTEGER);
          return sizeBytes === null ? {} : { 'data-size': String(sizeBytes) };
        },
      },
      mime: {
        default: 'application/octet-stream',
        parseHTML: (el) => mimeAttr(el.getAttribute('data-mime')),
        renderHTML: (attrs) => ({ 'data-mime': mimeAttr(attrs.mime) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="attachment"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'attachment' }),
      textAttr(node.attrs.name, 255),
    ];
  },
});

/**
 * Editable diagram source (Mermaid). The source is ordinary collaborative
 * text, so concurrent edits merge character by character. The preview is a
 * render-time concern of the browser node view and is never stored.
 */
export const DiagramNode = Node.create({
  name: NODE_DIAGRAM,
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      language: {
        default: 'mermaid',
        parseHTML: (el) =>
          choiceAttr(el.getAttribute('data-language'), DIAGRAM_LANGUAGES, 'mermaid'),
        renderHTML: (attrs) => ({
          'data-language': choiceAttr(attrs.language, DIAGRAM_LANGUAGES, 'mermaid'),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'pre[data-type="diagram"]', preserveWhitespace: 'full', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-type': 'diagram' }), ['code', {}, 0]];
  },
});

/**
 * A highlighted note around ordinary text blocks (schema version 2). It holds paragraphs,
 * headings, lists and code; no tables, images or diagrams, which keeps it readable in the
 * narrow presenter panel and in plain-text exports. Clients older than schema version 2 get
 * `update_required` for a document that a version-2 client has edited, so they never open
 * (and silently drop) a callout they do not understand.
 */
export const CalloutNode = Node.create({
  name: NODE_CALLOUT,
  group: 'block',
  content: '(paragraph | heading | bulletList | orderedList | taskList | codeBlock)+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el) => choiceAttr(el.getAttribute('data-variant'), CALLOUT_VARIANTS, 'info'),
        renderHTML: (attrs) => ({
          'data-variant': choiceAttr(attrs.variant, CALLOUT_VARIANTS, 'info'),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout', role: 'note' }), 0];
  },
});

/**
 * Block-level formatting shared by paragraphs and headings: indentation level
 * and line spacing. (Alignment comes from the TextAlign extension.)
 */
export const BlockFormat = Extension.create({
  name: 'blockFormat',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => intAttr(el.getAttribute('data-indent'), 0, MAX_INDENT) ?? 0,
            renderHTML: (attrs) => {
              // The left margin itself is written by `indentLeft` (level and ruler indent add up).
              const indent = intAttr(attrs.indent, 0, MAX_INDENT) ?? 0;
              return indent > 0 ? { 'data-indent': String(indent) } : {};
            },
          },
          // Ruler indents in millimetres (schema version 3). `null` means none, so a paragraph
          // without indents is stored exactly as before. The three are rendered together by
          // `indentLeft`: one `style` for the element, built from clamped numbers only.
          indentLeft: {
            default: null,
            parseHTML: (el) => indentAttr(el.getAttribute('data-indent-left'), 0),
            renderHTML: (attrs) => paragraphIndentMarkup(attrs),
          },
          indentRight: {
            default: null,
            parseHTML: (el) => indentAttr(el.getAttribute('data-indent-right'), 0),
            renderHTML: () => ({}),
          },
          indentFirstLine: {
            default: null,
            parseHTML: (el) =>
              indentAttr(el.getAttribute('data-indent-first-line'), -PARAGRAPH_INDENT_MAX_MM),
            renderHTML: () => ({}),
          },
          lineHeight: {
            default: null,
            parseHTML: (el) => lineHeightAttr(el.getAttribute('data-line-height')),
            renderHTML: (attrs) => {
              // Only the listed values are ever written into a `style` attribute.
              const lineHeight = lineHeightAttr(attrs.lineHeight);
              return lineHeight
                ? { 'data-line-height': lineHeight, style: `line-height: ${lineHeight}` }
                : {};
            },
          },
        },
      },
    ];
  },
});
