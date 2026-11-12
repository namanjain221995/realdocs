/**
 * Block-level text diff of two document revisions.
 *
 * Works on the plain text of the top-level blocks (one string per block), so
 * the output reads like the document. Longest-common-subsequence with common
 * prefix and suffix removed first; the quadratic part is capped.
 */
import type { HistoryDiffLine } from '@realtimedocs/contracts';
import type { DocJSON } from '@realtimedocs/editor/schema';

/** LCS table cells allowed (blocks × blocks) before the diff degrades to delete-all/insert-all. */
const MAX_CELLS = 4_000_000;
const MAX_OUTPUT_LINES = 2_000;
const MAX_LINE_CHARS = 4_000;

function textOf(node: DocJSON): string {
  if (typeof node.text === 'string') return node.text;
  switch (node.type) {
    case 'image':
      return `[image ${String(node.attrs?.assetId ?? node.attrs?.uploadId ?? '')}]`.trim();
    case 'attachment':
      return `[attachment ${String(node.attrs?.name ?? '')}]`.trim();
    case 'diagram':
      return `[diagram] ${String(node.attrs?.source ?? '')}`.trim();
    case 'horizontalRule':
      return '———';
    case 'hardBreak':
      return ' ';
    default:
      break;
  }
  const parts = (node.content ?? []).map(textOf);
  // Cells and list items are separate pieces of text; inline children are not.
  const separator = node.content?.some((child) => typeof child.text === 'string') ? '' : ' · ';
  return parts.filter((part) => part !== '').join(separator);
}

/** One string per top-level block; lists, tables and callouts are one block each row/item. */
export function blockTexts(doc: DocJSON): string[] {
  const lines: string[] = [];
  const visit = (node: DocJSON): void => {
    const container =
      node.type === 'bulletList' ||
      node.type === 'orderedList' ||
      node.type === 'taskList' ||
      node.type === 'table' ||
      node.type === 'callout' ||
      node.type === 'blockquote';
    if (container) {
      for (const child of node.content ?? []) visit(child);
      return;
    }
    const text = textOf(node).slice(0, MAX_LINE_CHARS);
    // Attributes of the shared document are untrusted: clamp before using one as a count.
    const level = Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) || 1));
    const label = node.type === 'heading' ? `${'#'.repeat(level)} ` : '';
    lines.push(label + text);
  };
  for (const child of doc.content ?? []) visit(child);
  return lines;
}

export function diffLines(
  before: readonly string[],
  after: readonly string[],
): { lines: HistoryDiffLine[]; truncated: boolean } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  const middle: HistoryDiffLine[] = [];

  if (a.length * b.length > MAX_CELLS) {
    for (const text of a) middle.push({ op: 'delete', text });
    for (const text of b) middle.push({ op: 'insert', text });
  } else {
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * width + j] =
          a[i] === b[j]
            ? (table[(i + 1) * width + j + 1] ?? 0) + 1
            : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        middle.push({ op: 'equal', text: a[i] ?? '' });
        i += 1;
        j += 1;
      } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
        middle.push({ op: 'delete', text: a[i] ?? '' });
        i += 1;
      } else {
        middle.push({ op: 'insert', text: b[j] ?? '' });
        j += 1;
      }
    }
    for (; i < a.length; i += 1) middle.push({ op: 'delete', text: a[i] ?? '' });
    for (; j < b.length; j += 1) middle.push({ op: 'insert', text: b[j] ?? '' });
  }

  // Three unchanged blocks of context on each side of the changes.
  const CONTEXT = 3;
  const lines: HistoryDiffLine[] = [
    ...before
      .slice(Math.max(0, start - CONTEXT), start)
      .map((text) => ({ op: 'equal', text }) as const),
    ...middle,
    ...before.slice(endBefore, endBefore + CONTEXT).map((text) => ({ op: 'equal', text }) as const),
  ];
  return {
    lines: lines.slice(0, MAX_OUTPUT_LINES),
    truncated: lines.length > MAX_OUTPUT_LINES,
  };
}

export function diffDocuments(
  before: DocJSON,
  after: DocJSON,
): { lines: HistoryDiffLine[]; truncated: boolean } {
  try {
    return diffLines(blockTexts(before), blockTexts(after));
  } catch {
    // Content that cannot be turned into text must not hide the revision itself.
    return { lines: [], truncated: true };
  }
}
