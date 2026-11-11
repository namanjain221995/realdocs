/**
 * DOM-free exporters: `@realtimedocs/editor/export`.
 *
 * Pure functions over ProseMirror JSON as produced by the authoritative
 * schema (`../schema`). They run in Node.js (server export endpoint) and in
 * the browser.
 *
 * Markdown export — what is kept and what is dropped
 * --------------------------------------------------
 * Kept: headings, paragraphs, hard breaks, bold, italic, strikethrough, inline
 * code, links (safe protocols only), bullet/ordered/task lists with nesting,
 * block quotes, code blocks with their language, tables (GitHub-flavoured),
 * images (`![alt](assets/<file>)` plus caption), attachments (links),
 * Mermaid diagrams (```mermaid fenced blocks) and horizontal rules.
 * Underline and highlight have no Markdown syntax and are written as the
 * inline HTML elements `<u>` and `<mark>`.
 *
 * Dropped (no portable Markdown equivalent): text colour, highlight colour,
 * font size, text alignment, indentation, line spacing, image width and
 * alignment, table column widths, merged table cells (`colspan`/`rowspan`
 * cells are written once and padded with empty cells) and block structure
 * inside table cells (flattened to one line, paragraphs joined with `<br>`).
 */
import type { DocJSON } from '../schema/extensions';
import { sanitizeLinkHref } from '../schema/links';
import {
  CALLOUT_VARIANTS,
  NODE_ATTACHMENT,
  NODE_CALLOUT,
  NODE_DIAGRAM,
  NODE_IMAGE,
  type CalloutVariant,
} from '../schema/nodes';

const CALLOUT_TEXT_LABELS: Readonly<Record<CalloutVariant, string>> = {
  info: 'Note',
  tip: 'Tip',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
};

/** GitHub-style alert keywords for Markdown export. */
const CALLOUT_MARKDOWN_ALERTS: Readonly<Record<CalloutVariant, string>> = {
  info: 'NOTE',
  tip: 'TIP',
  success: 'IMPORTANT',
  warning: 'WARNING',
  danger: 'CAUTION',
};

function calloutVariant(node: DocJSON): CalloutVariant {
  const value = node.attrs?.variant;
  return typeof value === 'string' && (CALLOUT_VARIANTS as readonly string[]).includes(value)
    ? (value as CalloutVariant)
    : 'info';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Mark = NonNullable<DocJSON['marks']>[number];

function children(node: DocJSON): DocJSON[] {
  return Array.isArray(node.content) ? node.content : [];
}

function attr(node: DocJSON, name: string): unknown {
  return node.attrs ? node.attrs[name] : undefined;
}

function stringAttr(node: DocJSON, name: string): string {
  const value = attr(node, name);
  return typeof value === 'string' ? value : '';
}

function assetIdOf(node: DocJSON): string | null {
  const value = attr(node, 'assetId');
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

/** Text of a node and its descendants, without any formatting. */
function plainInline(node: DocJSON): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return children(node).map(plainInline).join('');
}

// ── Asset references ────────────────────────────────────────────────────────

/**
 * Ids of every uploaded asset the document references (images and
 * attachments), unique, in document order. Nodes that are still uploading
 * (no `assetId` yet) are skipped.
 */
export function collectAssetIds(doc: DocJSON): string[] {
  const seen = new Set<string>();
  const visit = (node: DocJSON) => {
    if (node.type === NODE_IMAGE || node.type === NODE_ATTACHMENT) {
      const id = assetIdOf(node);
      if (id) seen.add(id);
    }
    for (const child of children(node)) visit(child);
  };
  visit(doc);
  return [...seen];
}

// ── Plain text ──────────────────────────────────────────────────────────────

function plainBlocks(nodes: DocJSON[], indent: string): string[] {
  const lines: string[] = [];
  const push = (text: string) => {
    for (const line of text.split('\n')) lines.push(line === '' ? '' : `${indent}${line}`);
  };
  const gap = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  };

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        gap();
        push(plainInline(node));
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        gap();
        const start = Number(attr(node, 'start'));
        let number = Number.isInteger(start) && start >= 0 ? start : 1;
        for (const item of children(node)) {
          let marker = '- ';
          if (node.type === 'orderedList') {
            marker = `${number}. `;
            number += 1;
          } else if (node.type === 'taskList') {
            marker = attr(item, 'checked') === true ? '[x] ' : '[ ] ';
          }
          const body = plainBlocks(children(item), '').filter((line) => line !== '');
          const [first = '', ...rest] = body;
          lines.push(`${indent}${marker}${first}`);
          for (const line of rest) {
            lines.push(line === '' ? '' : `${indent}${' '.repeat(marker.length)}${line}`);
          }
        }
        break;
      }
      case 'blockquote':
        gap();
        for (const line of plainBlocks(children(node), ''))
          lines.push(`${indent}> ${line}`.trimEnd());
        break;
      case NODE_CALLOUT:
        gap();
        push(`[${CALLOUT_TEXT_LABELS[calloutVariant(node)]}]`);
        for (const line of plainBlocks(children(node), ''))
          lines.push(line === '' ? '' : `${indent}${line}`);
        break;
      case 'codeBlock':
      case NODE_DIAGRAM:
        gap();
        push(plainInline(node));
        break;
      case 'table':
        gap();
        for (const row of children(node)) {
          lines.push(
            indent +
              children(row)
                .map((cell) =>
                  plainBlocks(children(cell), '')
                    .filter((line) => line !== '')
                    .join(' '),
                )
                .join('\t'),
          );
        }
        break;
      case NODE_IMAGE: {
        gap();
        const label = stringAttr(node, 'alt') || stringAttr(node, 'name') || 'image';
        push(`[Image: ${label}]`);
        const caption = stringAttr(node, 'caption');
        if (caption) push(caption);
        break;
      }
      case NODE_ATTACHMENT:
        gap();
        push(`[Attachment: ${stringAttr(node, 'name') || 'file'}]`);
        break;
      case 'horizontalRule':
        gap();
        push('----------');
        break;
      default:
        // Unknown block: keep whatever text it contains.
        if (children(node).length > 0) {
          gap();
          for (const line of plainBlocks(children(node), indent)) lines.push(line);
        } else if (node.type === 'text') {
          push(node.text ?? '');
        }
    }
  }
  return lines;
}

/** Plain-text rendering: text only, one blank line between blocks. */
export function toPlainText(doc: DocJSON): string {
  const lines = plainBlocks(children(doc), '');
  // Empty paragraphs at either end would only add blank lines.
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

// ── Markdown ────────────────────────────────────────────────────────────────

export interface MarkdownAssetInfo {
  kind: 'image' | 'attachment';
  /** Sanitised display name stored on the node. */
  name: string;
}

export interface MarkdownOptions {
  /**
   * Maps an asset id to the file name used under `assets/` (for example in the
   * zip produced by the `md-zip` export). Return null when the asset is not
   * available; the node is then written as a text placeholder.
   * Defaults to the name stored on the node.
   */
  assetFileName?: (assetId: string, info: MarkdownAssetInfo) => string | null;
}

/** Inline marks in the order they are opened (outermost first). */
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'highlight'] as const;
type InlineMark = (typeof MARK_ORDER)[number];

interface Segment {
  text: string;
  /** Formatting marks, canonical order. */
  marks: InlineMark[];
  /** Safe link target when `marks` contains `link`. */
  href: string | null;
  code: boolean;
  hardBreak: boolean;
}

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>~|])/g, '\\$1');
}

/** Escapes characters that would start a block construct at the beginning of a line. */
function escapeLineStart(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
        .replace(/^(\s*)([-+])(\s|$)/, '$1\\$2$3')
        .replace(/^(\s*)(\d+)([.)])(\s|$)/, '$1$2\\$3$4')
        .replace(/^(\s*)(={3,}|-{3,})\s*$/, '$1\\$2'),
    )
    .join('\n');
}

function inlineCode(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const content = text.replace(/\n/g, ' ');
  const padded = /^`|`$|^ .* $/.test(content) ? ` ${content} ` : content;
  return `${fence}${padded}${fence}`;
}

function linkDestination(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href;
}

const OPEN: Record<Exclude<InlineMark, 'link'>, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  underline: '<u>',
  highlight: '<mark>',
};
const CLOSE: Record<Exclude<InlineMark, 'link'>, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  underline: '</u>',
  highlight: '</mark>',
};

function toSegment(node: DocJSON): Segment | null {
  if (node.type === 'hardBreak') {
    return { text: '', marks: [], href: null, code: false, hardBreak: true };
  }
  if (node.type !== 'text' || !node.text) return null;
  const marks: Mark[] = node.marks ?? [];
  const has = (type: string) => marks.some((mark) => mark.type === type);
  const linkMark = marks.find((mark) => mark.type === 'link');
  const href = linkMark ? sanitizeLinkHref(linkMark.attrs?.href) : null;
  const active: InlineMark[] = MARK_ORDER.filter((type) =>
    type === 'link' ? href !== null : has(type),
  );
  return { text: node.text, marks: active, href, code: has('code'), hardBreak: false };
}

function sameLink(a: Segment | undefined, b: Segment): boolean {
  return a !== undefined && a.href === b.href;
}

/**
 * Splits leading/trailing whitespace off formatted segments. Whitespace keeps
 * only the marks it shares with its neighbour, so no delimiter ever opens
 * before a space or closes after one (which Markdown would not treat as
 * emphasis).
 */
function expelWhitespace(segments: Segment[]): Segment[] {
  const pieces: Segment[] = [];
  for (const segment of segments) {
    if (segment.hardBreak || segment.code || segment.marks.length === 0) {
      pieces.push(segment);
      continue;
    }
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(segment.text);
    const lead = match?.[1] ?? '';
    const core = match?.[2] ?? '';
    const trail = match?.[3] ?? '';
    if (lead) pieces.push({ ...segment, text: lead, marks: [...segment.marks], hardBreak: false });
    if (core) pieces.push({ ...segment, text: core });
    if (trail)
      pieces.push({ ...segment, text: trail, marks: [...segment.marks], hardBreak: false });
  }
  const isSpace = (piece: Segment) => !piece.hardBreak && !piece.code && piece.text.trim() === '';
  const neighbourMarks = (
    index: number,
    step: number,
  ): { marks: InlineMark[]; piece?: Segment } => {
    for (let i = index + step; i >= 0 && i < pieces.length; i += step) {
      const piece = pieces[i] as Segment;
      if (!isSpace(piece)) return { marks: piece.hardBreak ? [] : piece.marks, piece };
    }
    return { marks: [] };
  };
  return pieces.map((piece, index) => {
    if (!isSpace(piece) || piece.marks.length === 0) return piece;
    const before = neighbourMarks(index, -1);
    const after = neighbourMarks(index, 1);
    const marks = piece.marks.filter((mark) => {
      if (!before.marks.includes(mark) || !after.marks.includes(mark)) return false;
      if (mark !== 'link') return true;
      return (
        before.piece !== undefined &&
        after.piece !== undefined &&
        sameLink(before.piece, piece) &&
        sameLink(after.piece, piece)
      );
    });
    return { ...piece, marks, href: marks.includes('link') ? piece.href : null };
  });
}

function renderInline(nodes: DocJSON[], context: { table: boolean }): string {
  const segments = expelWhitespace(
    nodes.map(toSegment).filter((segment): segment is Segment => segment !== null),
  );
  let output = '';
  /** Currently open marks, outermost first. */
  const open: { mark: InlineMark; href: string | null }[] = [];

  const closeFrom = (depth: number) => {
    while (open.length > depth) {
      const entry = open.pop();
      if (!entry) break;
      output +=
        entry.mark === 'link' ? `](${linkDestination(entry.href ?? '')})` : CLOSE[entry.mark];
    }
  };

  for (const segment of segments) {
    if (segment.hardBreak) {
      closeFrom(0);
      output += context.table ? '<br>' : '\\\n';
      continue;
    }
    // Keep the longest prefix of open marks that this segment still has.
    let keep = 0;
    while (keep < open.length && keep < segment.marks.length) {
      const entry = open[keep];
      const wanted = segment.marks[keep];
      if (!entry || entry.mark !== wanted) break;
      if (entry.mark === 'link' && entry.href !== segment.href) break;
      keep += 1;
    }
    closeFrom(keep);
    for (const mark of segment.marks.slice(keep)) {
      output += mark === 'link' ? '[' : OPEN[mark];
      open.push({ mark, href: mark === 'link' ? segment.href : null });
    }
    if (segment.code) {
      const code = inlineCode(segment.text);
      output += context.table ? code.replace(/\|/g, '\\|') : code;
    } else {
      output += escapeText(segment.text).replace(/\n/g, context.table ? '<br>' : '\\\n');
    }
  }
  closeFrom(0);
  return output;
}

function fence(content: string, info: string): string {
  const runs = content.match(/`{3,}/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 2);
  const marker = '`'.repeat(longest + 1);
  const body = content.endsWith('\n') ? content : `${content}\n`;
  return `${marker}${info}\n${body}${marker}`;
}

function indentBlock(text: string, prefix: string, firstPrefix: string): string {
  return text
    .split('\n')
    .map((line, index) => {
      if (index === 0) return `${firstPrefix}${line}`;
      return line === '' ? '' : `${prefix}${line}`;
    })
    .join('\n');
}

interface RenderContext {
  assetFileName: NonNullable<MarkdownOptions['assetFileName']>;
}

function assetLink(
  node: DocJSON,
  kind: 'image' | 'attachment',
  context: RenderContext,
): string | null {
  const id = assetIdOf(node);
  if (!id) return null;
  const file = context.assetFileName(id, { kind, name: stringAttr(node, 'name') });
  if (!file) return null;
  // Path segments are encoded so spaces and brackets cannot break the link.
  return `assets/${encodeURIComponent(file).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`;
}

function renderList(node: DocJSON, context: RenderContext): string {
  const items = children(node);
  const start = Number(attr(node, 'start'));
  let number = Number.isInteger(start) && start >= 0 ? start : 1;
  // A list is "tight" (no blank lines between items) when every item is a
  // single paragraph, optionally followed by nested lists.
  const tight = items.every((item) => {
    const blocks = children(item);
    return blocks.every((block, index) =>
      index === 0
        ? block.type === 'paragraph'
        : ['bulletList', 'orderedList', 'taskList'].includes(block.type),
    );
  });
  const rendered = items.map((item) => {
    let marker = '- ';
    if (node.type === 'orderedList') {
      marker = `${number}. `;
      number += 1;
    } else if (node.type === 'taskList') {
      marker = attr(item, 'checked') === true ? '- [x] ' : '- [ ] ';
    }
    // Continuation lines align with the item text of a plain list marker.
    const indent = ' '.repeat(node.type === 'orderedList' ? marker.length : 2);
    const body = renderBlocks(children(item), context, tight);
    return indentBlock(body === '' ? '' : body, indent, marker).trimEnd();
  });
  return rendered.join(tight ? '\n' : '\n\n');
}

function flattenCell(cell: DocJSON): string {
  const parts: string[] = [];
  const visit = (node: DocJSON) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = renderInline(children(node), { table: true });
      if (text !== '') parts.push(text);
      return;
    }
    if (node.type === 'codeBlock' || node.type === NODE_DIAGRAM) {
      const text = plainInline(node);
      if (text !== '') parts.push(inlineCode(text.replace(/\n/g, ' ')).replace(/\|/g, '\\|'));
      return;
    }
    if (node.type === NODE_IMAGE || node.type === NODE_ATTACHMENT) {
      const label = stringAttr(node, 'alt') || stringAttr(node, 'name');
      if (label) parts.push(escapeText(`[${label}]`));
      return;
    }
    for (const child of children(node)) visit(child);
  };
  for (const child of children(cell)) visit(child);
  return parts.join('<br>');
}

function renderTable(node: DocJSON): string {
  const rows = children(node).map((row) => {
    const cells: string[] = [];
    let header = true;
    for (const cell of children(row)) {
      if (cell.type !== 'tableHeader') header = false;
      cells.push(flattenCell(cell));
      const span = Number(attr(cell, 'colspan'));
      for (let extra = 1; Number.isInteger(span) && extra < span; extra += 1) cells.push('');
    }
    return { cells, header: header && cells.length > 0 };
  });
  if (rows.length === 0) return '';
  const width = Math.max(1, ...rows.map((row) => row.cells.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`;
  const lines: string[] = [];
  const [first, ...rest] = rows;
  const body = first?.header ? rest : rows;
  // GitHub-flavoured Markdown requires a header row; use an empty one if the table has none.
  lines.push(line(first?.header ? first.cells : []));
  lines.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
  for (const row of body) lines.push(line(row.cells));
  return lines.join('\n');
}

function renderBlock(node: DocJSON, context: RenderContext): string {
  switch (node.type) {
    case 'paragraph':
      return escapeLineStart(renderInline(children(node), { table: false }));
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attr(node, 'level')) || 1));
      const text = renderInline(children(node), { table: false }).replace(/\\\n/g, ' ');
      return `${'#'.repeat(level)} ${text}`.trimEnd();
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return renderList(node, context);
    case 'blockquote':
      return renderBlocks(children(node), context, false)
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n');
    case NODE_CALLOUT:
      return [
        `> [!${CALLOUT_MARKDOWN_ALERTS[calloutVariant(node)]}]`,
        ...renderBlocks(children(node), context, false)
          .split('\n')
          .map((line) => (line === '' ? '>' : `> ${line}`)),
      ].join('\n');
    case 'codeBlock': {
      const language = stringAttr(node, 'language').replace(/[^A-Za-z0-9_+#.-]/g, '');
      return fence(plainInline(node), language);
    }
    case NODE_DIAGRAM: {
      const language = stringAttr(node, 'language') || 'mermaid';
      return fence(plainInline(node), language.replace(/[^A-Za-z0-9_+#.-]/g, ''));
    }
    case 'table':
      return renderTable(node);
    case 'horizontalRule':
      return '---';
    case NODE_IMAGE: {
      const alt = stringAttr(node, 'alt');
      const caption = stringAttr(node, 'caption');
      const target = assetLink(node, 'image', context);
      const image = target
        ? `![${escapeText(alt).replace(/\n/g, ' ')}](${target})`
        : `*${escapeText(`[image: ${alt || stringAttr(node, 'name') || 'not available'}]`)}*`;
      return caption ? `${image}\n\n*${escapeText(caption).replace(/\n/g, ' ')}*` : image;
    }
    case NODE_ATTACHMENT: {
      const name = stringAttr(node, 'name') || 'file';
      const target = assetLink(node, 'attachment', context);
      return target
        ? `[${escapeText(name)}](${target})`
        : `*${escapeText(`[attachment: ${name}]`)}*`;
    }
    default:
      // Unknown block from a newer schema: keep its text instead of dropping it.
      if (children(node).some((child) => child.type === 'text')) {
        return escapeLineStart(renderInline(children(node), { table: false }));
      }
      return renderBlocks(children(node), context, false);
  }
}

function renderBlocks(nodes: DocJSON[], context: RenderContext, tight: boolean): string {
  return nodes
    .map((node) => renderBlock(node, context))
    .filter((block) => block !== '')
    .join(tight ? '\n' : '\n\n');
}

/** Markdown rendering (CommonMark plus GitHub tables, task lists and strikethrough). */
export function toMarkdown(doc: DocJSON, options: MarkdownOptions = {}): string {
  const context: RenderContext = {
    assetFileName: options.assetFileName ?? ((_id, info) => info.name || null),
  };
  const body = renderBlocks(children(doc), context, false);
  return body === '' ? '' : `${body}\n`;
}
