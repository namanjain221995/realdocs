/**
 * A small Markdown renderer for the documents this repository publishes in its
 * own web app (the README and the guides under `docs/`).
 *
 * It builds React elements only. No HTML string is produced or injected
 * anywhere, so markup in a document, such as `<address>` or a whole HTML tag,
 * is shown as the text it is, and a link can only become what the caller's
 * `resolveLink` allows.
 *
 * Supported, because those documents use it: ATX headings (with GitHub's
 * anchors), paragraphs, fenced code, pipe tables, bullet and numbered lists
 * (nested, with task items), block quotes and rules; inline code, emphasis,
 * links and `<https://…>` autolinks.
 *
 * Not supported: raw HTML (shown as text; a comment block is left out), images
 * (the alternative text is shown), reference-style links, setext headings,
 * indented code blocks and hard line breaks.
 */
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

/** What a link in a document becomes. */
export type ResolvedLink =
  { kind: 'internal'; to: string } | { kind: 'external'; href: string } | { kind: 'none' };

export interface MarkdownOptions {
  /**
   * Decides what each link becomes: `internal` is a route of this app,
   * `external` opens in a new tab, and `none` leaves the link's text as plain
   * text. It receives the target exactly as written, in-page anchors (`#id`)
   * included.
   */
  resolveLink: (href: string) => ResolvedLink;
}

/**
 * The anchor GitHub gives a heading: lower case, everything except letters,
 * digits, `_` and `-` removed, spaces turned into hyphens. A slug that repeats
 * within one document is numbered by `renderMarkdown` (`-1`, `-2`, …), as
 * GitHub does.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Alphabetic}\p{M}\p{Nd}\p{Nl}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/* ------------------------------------------------------------------ inline */

type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'em' | 'strong'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

/** A run of `*` or `_` that may still open or close emphasis. */
interface Delimiter {
  type: 'delimiter';
  char: string;
  /** Characters of the run that no emphasis has used yet. */
  count: number;
  /** Length of the run as written. */
  length: number;
  canOpen: boolean;
  canClose: boolean;
}

type Piece = Inline | Delimiter;

interface Bracket {
  /** Position in the piece list of the `[` (or `![`) itself. */
  at: number;
  image: boolean;
  /** False once a link has closed after it: links do not nest. */
  active: boolean;
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;
/** Only addresses a reader can follow become autolinks; `<address>` stays text. */
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/iy;
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/y;
/** The entities of XML and the non-breaking space. Any other name stays as written. */
const ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
]);

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function isPunctuation(char: string | undefined): boolean {
  return char !== undefined && UNICODE_PUNCTUATION.test(char);
}

/** The character that ends just before `index`, as a whole code point. */
function characterBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const unit = text.charCodeAt(index - 1);
  const paired = unit >= 0xdc00 && unit <= 0xdfff && index >= 2;
  return text.slice(index - (paired ? 2 : 1), index);
}

function characterAt(text: string, index: number): string | undefined {
  const code = text.codePointAt(index);
  return code === undefined ? undefined : String.fromCodePoint(code);
}

function unescapePunctuation(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/**
 * Reads a run of `*` or `_` and decides, by CommonMark's flanking rules,
 * whether it may open or close emphasis. `_` inside a word does neither, so
 * `snake_case_names` stay intact.
 */
function readDelimiter(text: string, start: number): Delimiter {
  const char = text[start] ?? '';
  let end = start;
  while (text[end] === char) end += 1;
  const before = characterBefore(text, start);
  const after = characterAt(text, end);
  const leftFlanking =
    !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
  const rightFlanking =
    !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));
  const strict = char === '_';
  return {
    type: 'delimiter',
    char,
    count: end - start,
    length: end - start,
    canOpen: leftFlanking && (!strict || !rightFlanking || isPunctuation(before)),
    canClose: rightFlanking && (!strict || !leftFlanking || isPunctuation(after)),
  };
}

/** Start of the run of exactly `length` backticks that closes a code span, or -1. */
function findBacktickRun(text: string, from: number, length: number): number {
  let index = from;
  while (index < text.length) {
    if (text[index] !== '`') {
      index += 1;
      continue;
    }
    let end = index;
    while (text[end] === '`') end += 1;
    if (end - index === length) return index;
    index = end;
  }
  return -1;
}

function readEntity(text: string, index: number): { value: string; end: number } | null {
  ENTITY.lastIndex = index;
  const match = ENTITY.exec(text);
  if (!match) return null;
  const end = index + match[0].length;
  const name = match[3];
  if (name !== undefined) {
    const value = ENTITIES.get(name);
    return value === undefined ? null : { value, end };
  }
  const code =
    match[1] !== undefined ? Number.parseInt(match[1], 10) : Number.parseInt(match[2] ?? '', 16);
  const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return { value: valid ? String.fromCodePoint(code) : '�', end };
}

function skipSpaces(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/.test(text[index] ?? '')) index += 1;
  return index;
}

/**
 * The `(destination "title")` that follows a link text. Returns the
 * destination and the position after the closing parenthesis, or null when
 * the text at `start` is not such a tail. The title is read and left out.
 */
function readLinkTail(text: string, start: number): { href: string; end: number } | null {
  if (text[start] !== '(') return null;
  let index = skipSpaces(text, start + 1);
  let href = '';
  if (text[index] === '<') {
    const close = text.indexOf('>', index + 1);
    if (close === -1) return null;
    href = text.slice(index + 1, close);
    if (href.includes('<')) return null;
    index = close + 1;
  } else {
    let depth = 0;
    while (index < text.length) {
      const char = text[index] ?? '';
      if (char === '\\' && ASCII_PUNCTUATION.test(text[index + 1] ?? '')) {
        href += text.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (/\s/.test(char)) break;
      if (char === '(') depth += 1;
      if (char === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
      href += char;
      index += 1;
    }
    if (depth !== 0) return null;
  }
  const afterDestination = index;
  index = skipSpaces(text, index);
  const quote = text[index];
  if (index > afterDestination && (quote === '"' || quote === "'" || quote === '(')) {
    const closing = quote === '(' ? ')' : quote;
    let end = index + 1;
    while (end < text.length && text[end] !== closing) end += text[end] === '\\' ? 2 : 1;
    if (end >= text.length) return null;
    index = skipSpaces(text, end + 1);
  }
  if (text[index] !== ')') return null;
  return { href: unescapePunctuation(href), end: index + 1 };
}

/** Unused delimiters are ordinary characters; neighbouring text is joined. */
function settle(pieces: readonly Piece[]): Inline[] {
  const nodes: Inline[] = [];
  for (const piece of pieces) {
    const node: Inline =
      piece.type === 'delimiter' ? { type: 'text', value: piece.char.repeat(piece.count) } : piece;
    const last = nodes.at(-1);
    if (node.type !== 'text') nodes.push(node);
    else if (last?.type === 'text') last.value += node.value;
    else nodes.push({ type: 'text', value: node.value });
  }
  return nodes;
}

/**
 * CommonMark: when either run could both open and close, the two may not pair
 * if their lengths add up to a multiple of three (unless both are multiples).
 */
function breaksRuleOfThree(opener: Delimiter, closer: Delimiter): boolean {
  if (!opener.canClose && !closer.canOpen) return false;
  return (
    (opener.length + closer.length) % 3 === 0 &&
    !(opener.length % 3 === 0 && closer.length % 3 === 0)
  );
}

/** Pairs delimiter runs into emphasis, innermost first, as CommonMark describes. */
function resolveEmphasis(pieces: Piece[]): Inline[] {
  let at = 0;
  while (at < pieces.length) {
    const closer = pieces[at];
    if (closer?.type !== 'delimiter' || !closer.canClose) {
      at += 1;
      continue;
    }
    let openerAt = at - 1;
    let opener: Delimiter | undefined;
    for (; openerAt >= 0; openerAt -= 1) {
      const candidate = pieces[openerAt];
      if (
        candidate?.type === 'delimiter' &&
        candidate.char === closer.char &&
        candidate.canOpen &&
        !breaksRuleOfThree(candidate, closer)
      ) {
        opener = candidate;
        break;
      }
    }
    if (!opener) {
      // Nothing to close. If it cannot open either, it is plain text from here on.
      if (!closer.canOpen) pieces[at] = { type: 'text', value: closer.char.repeat(closer.count) };
      at += 1;
      continue;
    }
    const size = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    opener.count -= size;
    closer.count -= size;
    const node: Inline = {
      type: size === 2 ? 'strong' : 'em',
      children: settle(pieces.slice(openerAt + 1, at)),
    };
    const replacement: Piece[] = [node];
    if (opener.count > 0) replacement.unshift(opener);
    if (closer.count > 0) replacement.push(closer);
    pieces.splice(openerAt, at - openerAt + 1, ...replacement);
    // Either the same closer again (it has characters left) or whatever follows the new node.
    at = openerAt + (opener.count > 0 ? 2 : 1);
  }
  return settle(pieces);
}

function plainText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' || node.type === 'code' ? node.value : plainText(node.children),
    )
    .join('');
}

function parseInline(text: string): Inline[] {
  const pieces: Piece[] = [];
  const brackets: Bracket[] = [];
  let pending = '';
  const flush = (): void => {
    if (pending !== '') pieces.push({ type: 'text', value: pending });
    pending = '';
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    const next = text[index + 1];

    if (char === '\\' && next !== undefined && ASCII_PUNCTUATION.test(next)) {
      pending += next;
      index += 2;
      continue;
    }

    if (char === '`') {
      let length = 1;
      while (text[index + length] === '`') length += 1;
      const close = findBacktickRun(text, index + length, length);
      if (close === -1) {
        pending += text.slice(index, index + length);
        index += length;
        continue;
      }
      // Verbatim, except that one space of padding on both sides is dropped.
      const raw = text.slice(index + length, close);
      const padded = raw.startsWith(' ') && raw.endsWith(' ') && raw.trim() !== '';
      flush();
      pieces.push({ type: 'code', value: padded ? raw.slice(1, -1) : raw });
      index = close + length;
      continue;
    }

    if (char === '<') {
      AUTOLINK.lastIndex = index;
      const match = AUTOLINK.exec(text);
      const address = match?.[1];
      if (match && address !== undefined) {
        flush();
        pieces.push({ type: 'link', href: address, children: [{ type: 'text', value: address }] });
        index += match[0].length;
        continue;
      }
    }

    if (char === '&') {
      const entity = readEntity(text, index);
      if (entity) {
        pending += entity.value;
        index = entity.end;
        continue;
      }
    }

    if (char === '*' || char === '_') {
      const delimiter = readDelimiter(text, index);
      flush();
      pieces.push(delimiter);
      index += delimiter.length;
      continue;
    }

    if (char === '[' || (char === '!' && next === '[')) {
      const image = char === '!';
      flush();
      brackets.push({ at: pieces.length, image, active: true });
      pieces.push({ type: 'text', value: image ? '![' : '[' });
      index += image ? 2 : 1;
      continue;
    }

    if (char === ']') {
      const opener = brackets.pop();
      const tail = opener?.active ? readLinkTail(text, index + 1) : null;
      if (opener && tail) {
        flush();
        const children = resolveEmphasis(pieces.splice(opener.at + 1));
        pieces.pop();
        if (opener.image) {
          // No images: the alternative text stands in.
          pieces.push({ type: 'text', value: plainText(children) });
        } else {
          pieces.push({ type: 'link', href: tail.href, children });
          for (const earlier of brackets) if (!earlier.image) earlier.active = false;
        }
        index = tail.end;
        continue;
      }
    }

    pending += char;
    index += 1;
  }
  flush();
  return resolveEmphasis(pieces);
}

/* ------------------------------------------------------------------ blocks */

type Alignment = 'left' | 'center' | 'right' | null;

type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string; value: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { type: 'table'; align: Alignment[]; head: string[]; rows: string[][] }
  | { type: 'rule' };

interface ListItem {
  /** `null` for an ordinary item, otherwise whether its task box is ticked. */
  checked: boolean | null;
  children: Block[];
}

interface ParsedBlocks {
  blocks: Block[];
  /** A blank line separates two of the blocks, which makes a list loose. */
  spaced: boolean;
}

interface Marker {
  ordered: boolean;
  /** The bullet character, or the delimiter after a number. A list ends where it changes. */
  style: string;
  start: number;
  /** The column at which the item's content begins. */
  indent: number;
  /** What follows the marker on its own line. */
  first: string;
}

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}> ?/;
const BULLET = /^( {0,3})([-*+])(?=[ \t]|$)/;
const NUMBERED = /^( {0,3})(\d{1,9})([.)])(?=[ \t]|$)/;
const TASK = /^\[([ xX])\][ \t]+(?=\S)/;
const COMMENT = /^ {0,3}<!--/;
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Index of the first line at or after `from` that has content, or -1. */
function nextContentLine(lines: readonly string[], from: number): number {
  for (let index = from; index < lines.length; index += 1) {
    if (!isBlank(lines[index])) return index;
  }
  return -1;
}

/** Whether a line opens a fenced code block; an info string after backticks may not contain one. */
function opensFence(line: string): RegExpExecArray | null {
  const match = FENCE.exec(line);
  if (!match) return null;
  return match[2]?.startsWith('`') && match[3]?.includes('`') ? null : match;
}

function readMarker(line: string): Marker | null {
  if (RULE.test(line)) return null;
  const bullet = BULLET.exec(line);
  const numbered = bullet ? null : NUMBERED.exec(line);
  const match = bullet ?? numbered;
  if (!match) return null;
  const rest = line.slice(match[0].length);
  const padding = indentOf(rest);
  const empty = rest.trim() === '';
  // More than four spaces after the marker belong to the content, not to the marker.
  const gap = empty || padding > 4 ? 1 : padding;
  return {
    ordered: numbered !== null,
    style: (bullet ? bullet[2] : numbered?.[3]) ?? '',
    start: numbered ? Number.parseInt(numbered[2] ?? '1', 10) : 1,
    indent: match[0].length + gap,
    first: empty ? '' : rest.slice(gap),
  };
}

/** A line that starts a block of its own, whatever comes before it. */
function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    COMMENT.test(line) ||
    opensFence(line) !== null ||
    readMarker(line) !== null
  );
}

/**
 * Like `startsBlock`, but for a line that directly follows paragraph text:
 * there, as in CommonMark, an empty list item or a numbered item other than
 * `1.` is still part of the paragraph.
 */
function interruptsParagraph(line: string): boolean {
  const marker = readMarker(line);
  if (marker) return marker.first !== '' && (!marker.ordered || marker.start === 1);
  return startsBlock(line);
}

/**
 * True when a quote's or list item's last line is paragraph text. The next
 * line may then continue that paragraph without the quote mark or indentation.
 */
function endsInParagraph(body: readonly string[]): boolean {
  const last = body.at(-1);
  return last !== undefined && !isBlank(last) && !startsBlock(last);
}

/** Cells of one table row. `\|` is a literal pipe, also inside inline code. */
function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index] ?? '';
    if (char === '\\' && row[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** The header and alignment of a table that starts at `start`, or null. */
function readTableHead(
  lines: readonly string[],
  start: number,
): { head: string[]; align: Alignment[] } | null {
  const header = lines[start];
  const delimiters = lines[start + 1];
  if (header === undefined || delimiters === undefined) return null;
  if (!header.includes('|') || !delimiters.includes('|') || !DELIMITER_ROW.test(delimiters)) {
    return null;
  }
  const head = splitRow(header);
  const marks = splitRow(delimiters);
  if (head.length !== marks.length) return null;
  const align = marks.map((mark): Alignment => {
    const left = mark.startsWith(':');
    const right = mark.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return left ? 'left' : null;
  });
  return { head, align };
}

function parseList(
  lines: readonly string[],
  start: number,
  first: Marker,
): { block: Block; next: number } {
  const items: ListItem[] = [];
  let loose = false;
  let index = start;
  let marker: Marker | null = first;

  while (marker) {
    const task = TASK.exec(marker.first);
    const body = [task ? marker.first.slice(task[0].length) : marker.first];
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (isBlank(line)) {
        // A blank line stays inside the item only if indented content follows it.
        const resume = nextContentLine(lines, index);
        if (resume === -1 || indentOf(lines[resume] ?? '') < marker.indent) break;
        for (; index < resume; index += 1) body.push('');
      } else if (indentOf(line) >= marker.indent) {
        body.push(line.slice(marker.indent));
        index += 1;
      } else if (endsInParagraph(body) && !startsBlock(line)) {
        body.push(line.trim());
        index += 1;
      } else {
        break;
      }
    }
    const parsed = parseBlocks(body);
    if (parsed.spaced) loose = true;
    items.push({ checked: task ? task[1] !== ' ' : null, children: parsed.blocks });

    const resume = nextContentLine(lines, index);
    const sibling = resume === -1 ? null : readMarker(lines[resume] ?? '');
    if (!sibling || sibling.ordered !== first.ordered || sibling.style !== first.style) break;
    if (resume > index) loose = true;
    index = resume;
    marker = sibling;
  }

  return {
    block: { type: 'list', ordered: first.ordered, start: first.start, tight: !loose, items },
    next: index,
  };
}

function parseBlocks(lines: readonly string[]): ParsedBlocks {
  const blocks: Block[] = [];
  let spaced = false;
  let blankBefore = false;
  const push = (block: Block): void => {
    if (blankBefore && blocks.length > 0) spaced = true;
    blankBefore = false;
    blocks.push(block);
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (isBlank(line)) {
      blankBefore = true;
      index += 1;
      continue;
    }

    const fence = opensFence(line);
    if (fence) {
      const indent = fence[1]?.length ?? 0;
      const marks = fence[2] ?? '```';
      const closing = new RegExp(`^ {0,3}${marks[0]}{${marks.length},}[ \\t]*$`);
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index] ?? '')) {
        // The content is taken as written, less the indentation of the fence itself.
        const content = lines[index] ?? '';
        body.push(content.slice(Math.min(indent, indentOf(content))));
        index += 1;
      }
      index += 1;
      const language = (fence[3] ?? '').trim().split(/\s+/)[0] ?? '';
      push({ type: 'code', language, value: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = (heading[1]?.length ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
      const text = (heading[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
      push({ type: 'heading', level, text });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (QUOTE.test(current)) body.push(current.replace(QUOTE, ''));
        else if (!isBlank(current) && endsInParagraph(body) && !startsBlock(current)) {
          body.push(current.trim());
        } else break;
        index += 1;
      }
      push({ type: 'quote', children: parseBlocks(body).blocks });
      continue;
    }

    const marker = readMarker(line);
    if (marker) {
      const list = parseList(lines, index, marker);
      push(list.block);
      index = list.next;
      continue;
    }

    if (COMMENT.test(line)) {
      // An HTML comment is a note to editors of the file, not content.
      while (index < lines.length && !(lines[index] ?? '').includes('-->')) index += 1;
      index += 1;
      continue;
    }

    const table = readTableHead(lines, index);
    if (table) {
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = lines[index] ?? '';
        if (isBlank(row) || startsBlock(row)) break;
        const cells = splitRow(row);
        rows.push(table.head.map((_, column) => cells[column] ?? ''));
        index += 1;
      }
      push({ type: 'table', align: table.align, head: table.head, rows });
      continue;
    }

    // A paragraph: soft-wrapped lines are one run of text.
    const text = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (isBlank(current) || interruptsParagraph(current) || readTableHead(lines, index)) break;
      text.push(current.trim());
      index += 1;
    }
    push({ type: 'paragraph', text: text.join(' ') });
  }

  return { blocks, spaced };
}

/* --------------------------------------------------------------- rendering */

interface RenderContext {
  options: MarkdownOptions;
  /** Heading slugs used so far in this document, for numbering repeats. */
  slugs: Map<string, number>;
}

/**
 * `javascript:`, `data:` and `vbscript:` addresses run or embed content
 * instead of navigating, so no link is ever made from one, whatever
 * `resolveLink` answered. Browsers skip whitespace and control characters
 * inside a scheme (`java\nscript:`), so those are removed before comparing.
 */
function isUnsafeUrl(url: string): boolean {
  let compact = '';
  for (const char of url) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x20 && (code < 0x7f || code > 0x9f)) compact += char;
  }
  return /^(?:javascript|data|vbscript):/i.test(compact);
}

/** Numbers a repeated slug the way GitHub does: `usage`, `usage-1`, `usage-2`. */
function uniqueSlug(text: string, used: Map<string, number>): string | undefined {
  const base = headingSlug(text);
  if (base === '') return undefined;
  let slug = base;
  while (used.has(slug)) {
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    slug = `${base}-${count}`;
  }
  used.set(slug, 0);
  return slug;
}

interface ScrollRegionProps {
  as: 'div' | 'pre';
  className: string;
  /** Names the block for assistive technology while it can be scrolled. */
  label: string;
  language?: string;
  children: ReactNode;
}

/**
 * A block that scrolls sideways inside itself when its content is wider than
 * the page (a table, a code sample). Only while it actually overflows is it a
 * tab stop with a name, so that it can be scrolled from the keyboard without
 * adding a stop for every block that fits.
 */
function ScrollRegion({ as: Tag, className, label, language, children }: ScrollRegionProps) {
  const element = useRef<HTMLElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const attach = useCallback((node: HTMLElement | null) => {
    element.current = node;
  }, []);

  useEffect(() => {
    const node = element.current;
    if (!node) return undefined;
    const measure = (): void => setOverflows(node.scrollWidth > node.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={attach}
      className={className}
      data-language={language}
      {...(overflows ? { tabIndex: 0, role: 'group', 'aria-label': label } : null)}
    >
      {children}
    </Tag>
  );
}

function renderInline(nodes: readonly Inline[], context: RenderContext): ReactNode[] {
  return nodes.map((node, key) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'code':
        return <code key={key}>{node.value}</code>;
      case 'em':
        return <em key={key}>{renderInline(node.children, context)}</em>;
      case 'strong':
        return <strong key={key}>{renderInline(node.children, context)}</strong>;
      case 'link': {
        const children = renderInline(node.children, context);
        const target = context.options.resolveLink(node.href);
        if (target.kind === 'internal' && !isUnsafeUrl(target.to)) {
          return (
            <Link key={key} to={target.to}>
              {children}
            </Link>
          );
        }
        if (target.kind === 'external' && !isUnsafeUrl(target.href)) {
          return (
            <a key={key} href={target.href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        }
        return <Fragment key={key}>{children}</Fragment>;
      }
    }
  });
}

function renderItem(item: ListItem, key: number, tight: boolean, context: RenderContext) {
  if (item.checked === null) {
    return <li key={key}>{renderBlocks(item.children, context, tight)}</li>;
  }
  const only = item.children.length === 1 ? item.children[0] : undefined;
  if (only?.type === 'paragraph') {
    // The usual case: the item's text is the label of its box.
    return (
      <li key={key} className="docs-task">
        <label className="docs-task__label">
          <input type="checkbox" className="docs-task__box" checked={item.checked} disabled />{' '}
          <span>{renderInline(parseInline(only.text), context)}</span>
        </label>
      </li>
    );
  }
  const lead = item.children[0];
  const name = lead?.type === 'paragraph' ? plainText(parseInline(lead.text)) : '';
  return (
    <li key={key} className="docs-task">
      <input
        type="checkbox"
        className="docs-task__box"
        checked={item.checked}
        disabled
        aria-label={name || 'Task'}
      />{' '}
      {renderBlocks(item.children, context, tight)}
    </li>
  );
}

function renderBlock(block: Block, key: number, context: RenderContext, tight: boolean) {
  switch (block.type) {
    case 'heading': {
      const inline = parseInline(block.text);
      const Tag = `h${block.level}` as const;
      // Focusable from script, so that following a link to the heading moves the reader there.
      return (
        <Tag key={key} id={uniqueSlug(plainText(inline), context.slugs)} tabIndex={-1}>
          {renderInline(inline, context)}
        </Tag>
      );
    }
    case 'paragraph': {
      const children = renderInline(parseInline(block.text), context);
      // In a tight list the text sits directly in its item.
      return tight ? <Fragment key={key}>{children}</Fragment> : <p key={key}>{children}</p>;
    }
    case 'code':
      return (
        <ScrollRegion
          key={key}
          as="pre"
          className="docs-code"
          label={block.language ? `Code sample, ${block.language}` : 'Code sample'}
          language={block.language || undefined}
        >
          <code>{block.value}</code>
        </ScrollRegion>
      );
    case 'quote':
      return <blockquote key={key}>{renderBlocks(block.children, context)}</blockquote>;
    case 'list': {
      const items = block.items.map((item, at) => renderItem(item, at, block.tight, context));
      return block.ordered ? (
        <ol key={key} start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case 'table': {
      const head = block.head.map((cell) => parseInline(cell));
      return (
        <ScrollRegion
          key={key}
          as="div"
          className="docs-table"
          label={`Table: ${head.map((cell) => plainText(cell)).join(', ')}`}
        >
          <table>
            <thead>
              <tr>
                {head.map((cell, column) => (
                  <th key={column} scope="col" data-align={block.align[column] ?? undefined}>
                    {renderInline(cell, context)}
                  </th>
                ))}
              </tr>
            </thead>
            {block.rows.length > 0 ? (
              <tbody>
                {block.rows.map((row, at) => (
                  <tr key={at}>
                    {row.map((cell, column) => (
                      <td key={column} data-align={block.align[column] ?? undefined}>
                        {renderInline(parseInline(cell), context)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </ScrollRegion>
      );
    }
    case 'rule':
      return <hr key={key} />;
  }
}

function renderBlocks(blocks: readonly Block[], context: RenderContext, tight = false) {
  return blocks.map((block, key) => renderBlock(block, key, context, tight));
}

/**
 * Turns Markdown into React elements. Every link is passed to
 * `options.resolveLink`; headings get the `id` GitHub would give them.
 */
export function renderMarkdown(source: string, options: MarkdownOptions): ReactNode {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // Indentation is counted in spaces; a tab is four of them.
    .map((line) => line.replace(/^[ \t]+/, (indent) => indent.replace(/\t/g, '    ')));
  return renderBlocks(parseBlocks(lines).blocks, { options, slugs: new Map() });
}
