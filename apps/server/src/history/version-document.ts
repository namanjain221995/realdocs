/**
 * The pure parts of the "version history document" (docs/version-history.md): turning a document
 * into lines, comparing two versions line by line, deciding where one version ends and the next
 * begins, formatting times, and writing the text. Nothing here reads the database.
 */
import type {
  VersionHistoryImage,
  VersionHistoryResponse,
  VersionHistoryVersion,
} from '@realtimedocs/contracts';
import type { DocJSON } from '@realtimedocs/editor/schema';

// ── Lines of a document ─────────────────────────────────────────────────────

/** One line of a version's text: plain text, or the place of an image or an attached file. */
export type SnapshotLine =
  | { kind: 'text'; text: string }
  | { kind: 'image'; id: string }
  | { kind: 'file'; id: string; name: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CALLOUT_LABELS: Readonly<Record<string, string>> = {
  info: 'Note',
  tip: 'Tip',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
};

function children(node: DocJSON): DocJSON[] {
  return Array.isArray(node.content) ? node.content : [];
}

function stringAttr(node: DocJSON, name: string): string {
  const value = node.attrs?.[name];
  return typeof value === 'string' ? value : '';
}

function assetIdOf(node: DocJSON): string | null {
  const value = node.attrs?.assetId;
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function inlineText(node: DocJSON): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return children(node).map(inlineText).join('');
}

/** A line of text without control characters (a tab stays: table cells are joined with it). */
function cleanLine(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const control =
      (code < 0x20 && code !== 0x09) || code === 0x7f || code === 0x2028 || code === 0x2029;
    out += control ? ' ' : char;
  }
  return out;
}

/** A header field or a name on one line: no line breaks, no control characters. */
export function oneLine(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? ' ' : char;
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

function prefixed(lines: SnapshotLine[], first: string, rest: string): SnapshotLine[] {
  return lines.map((line, index) =>
    line.kind === 'text'
      ? { kind: 'text', text: `${index === 0 ? first : rest}${line.text}` }
      : line,
  );
}

function blockLines(nodes: readonly DocJSON[]): SnapshotLine[] {
  const lines: SnapshotLine[] = [];
  const pushText = (text: string): void => {
    // A paragraph with line breaks is several lines; control characters would break the layout.
    for (const part of text.split('\n')) {
      lines.push({ kind: 'text', text: cleanLine(part) });
    }
  };
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
      case 'diagram':
        pushText(inlineText(node));
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const start = Number(node.attrs?.start);
        let number = Number.isInteger(start) && start >= 0 ? start : 1;
        for (const item of children(node)) {
          let marker = '- ';
          if (node.type === 'orderedList') {
            marker = `${number}. `;
            number += 1;
          } else if (node.type === 'taskList') {
            marker = item.attrs?.checked === true ? '[x] ' : '[ ] ';
          }
          const body = blockLines(children(item));
          if (body.length === 0) pushText(marker.trimEnd());
          else lines.push(...prefixed(body, marker, ' '.repeat(marker.length)));
        }
        break;
      }
      case 'blockquote':
        lines.push(...prefixed(blockLines(children(node)), '> ', '> '));
        break;
      case 'callout': {
        const variant = stringAttr(node, 'variant');
        pushText(`[${CALLOUT_LABELS[variant] ?? 'Note'}]`);
        lines.push(...blockLines(children(node)));
        break;
      }
      case 'table':
        for (const row of children(node)) {
          pushText(
            children(row)
              .map((cell) =>
                blockLines(children(cell))
                  .map((line) => (line.kind === 'text' ? line.text.trim() : ''))
                  .filter((text) => text !== '')
                  .join(' '),
              )
              .join('\t'),
          );
        }
        break;
      case 'image': {
        const id = assetIdOf(node);
        // An image that is still uploading has no id yet: it becomes a line once it has one.
        if (id) lines.push({ kind: 'image', id });
        const caption = stringAttr(node, 'caption');
        if (caption) pushText(caption);
        break;
      }
      case 'attachment': {
        const id = assetIdOf(node);
        if (id) lines.push({ kind: 'file', id, name: oneLine(stringAttr(node, 'name')) || 'file' });
        break;
      }
      case 'horizontalRule':
        pushText('----------');
        break;
      default:
        // An unknown block: keep whatever text it contains.
        if (children(node).length > 0) lines.push(...blockLines(children(node)));
        else if (node.type === 'text') pushText(node.text ?? '');
    }
  }
  return lines;
}

/**
 * The document as lines, one per block (a paragraph with line breaks is several). Unlike the
 * plain-text export there is no blank line between blocks, and an image is a line of its own.
 * Empty paragraphs at the very beginning and end are dropped.
 */
export function documentLines(doc: DocJSON): SnapshotLine[] {
  const lines = blockLines(children(doc));
  const blank = (line: SnapshotLine | undefined): boolean =>
    line?.kind === 'text' && line.text.trim() === '';
  while (lines.length > 0 && blank(lines[lines.length - 1])) lines.pop();
  while (lines.length > 0 && blank(lines[0])) lines.shift();
  return lines;
}

/** Characters a list of lines contributes to the size budget. */
export function sizeOfLines(lines: readonly SnapshotLine[]): number {
  let size = 0;
  for (const line of lines) size += line.kind === 'text' ? line.text.length + 1 : 96;
  return size;
}

// ── Assets named in the text ────────────────────────────────────────────────

export interface NamedAsset {
  kind: 'image' | 'attachment';
  /** `<asset id>.<extension>`. */
  fileName: string;
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/** `<asset id>.<extension from the stored content type>`; the stored name decides only as a fallback. */
export function imageFileName(id: string, mime: string, storedName: string): string {
  const known = MIME_EXTENSIONS[mime.toLowerCase().split(';')[0]?.trim() ?? ''];
  if (known) return `${id}.${known}`;
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(storedName);
  return `${id}.${match?.[1] ? match[1].toLowerCase() : 'bin'}`;
}

export type AssetNames = ReadonlyMap<string, NamedAsset>;

function imagePath(id: string, assets: AssetNames): string | null {
  const asset = assets.get(id);
  return asset && asset.kind === 'image' ? `images/${asset.fileName}` : null;
}

/** A line as it stands in "CURRENT SNAPSHOT" and "CURRENT FINAL CONTENT". */
export function renderLine(line: SnapshotLine, assets: AssetNames): string {
  if (line.kind === 'text') return line.text;
  if (line.kind === 'image') {
    return `[IMAGE ${line.id}] ${imagePath(line.id, assets) ?? '(file not available)'}`;
  }
  return `[FILE ${line.id}] ${line.name}`;
}

export function renderLines(lines: readonly SnapshotLine[], assets: AssetNames): string {
  return lines.map((line) => renderLine(line, assets)).join('\n');
}

// ── Comparing two versions ──────────────────────────────────────────────────

/** What makes two lines "the same line": the trimmed text, or the id of an image or a file. */
export function lineKey(line: SnapshotLine): string | null {
  if (line.kind === 'image') return `\u0000image:${line.id}`;
  if (line.kind === 'file') return `\u0000file:${line.id}`;
  const text = line.text.trim();
  // Blank lines are never listed.
  return text === '' ? null : text;
}

function surplus(of: readonly SnapshotLine[], against: readonly SnapshotLine[]): SnapshotLine[] {
  const remaining = new Map<string, number>();
  for (const line of against) {
    const key = lineKey(line);
    if (key !== null) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const result: SnapshotLine[] = [];
  for (const line of of) {
    const key = lineKey(line);
    if (key === null) continue;
    const left = remaining.get(key) ?? 0;
    if (left > 0) remaining.set(key, left - 1);
    else result.push(line);
  }
  return result;
}

export interface LineDiff {
  /** Lines of `next` that `previous` did not have, in the order of `next`. */
  added: SnapshotLine[];
  /** Lines of `previous` that `next` no longer has, in the order of `previous`. */
  removed: SnapshotLine[];
}

/**
 * Line-level difference as a multiset: a line that occurs twice now and once before is added
 * once. A line that was edited therefore appears under both headings (old text removed, new text
 * added), exactly as in the owner's sample documents.
 */
export function diffLines(
  previous: readonly SnapshotLine[],
  next: readonly SnapshotLine[],
): LineDiff {
  return { added: surplus(next, previous), removed: surplus(previous, next) };
}

function describeAdded(line: SnapshotLine, assets: AssetNames): string {
  if (line.kind === 'text') return line.text.trim();
  if (line.kind === 'image') {
    return `[IMAGE ${line.id}] image pasted (${imagePath(line.id, assets) ?? 'file not available'})`;
  }
  return `[FILE ${line.id}] file attached (${line.name})`;
}

function describeRemoved(line: SnapshotLine): string {
  if (line.kind === 'text') return line.text.trim();
  if (line.kind === 'image') return `[IMAGE ${line.id}] image removed`;
  return `[FILE ${line.id}] file removed`;
}

// ── What a change is called ─────────────────────────────────────────────────

export type VersionAction = VersionHistoryVersion['action'];

/** The word for one recorded change, from the classification the history stores with it. */
export function actionOfOperation(operation: string): VersionAction {
  switch (operation) {
    case 'paste':
    case 'image_inserted':
    case 'attachment_inserted':
      return 'Pasted';
    case 'text_deleted':
    case 'image_removed':
    case 'attachment_removed':
      return 'Deleted';
    case 'formatting_changed':
    case 'page_settings_changed':
      return 'Formatted';
    case 'text_inserted':
    case 'text_replaced':
    case 'structure_changed':
    case 'table_inserted':
      return 'Typed';
    default:
      return 'Mixed';
  }
}

/**
 * One word for a version made of several changes: the one kind they share, ignoring formatting
 * when anything else happened (bold while typing is typing), otherwise "Mixed".
 */
export function actionOfVersion(actions: Iterable<VersionAction>): VersionAction {
  const kinds = new Set(actions);
  if (kinds.size > 1) kinds.delete('Formatted');
  if (kinds.size === 1) return [...kinds][0] as VersionAction;
  return kinds.size === 0 ? 'Formatted' : 'Mixed';
}

// ── Where a version ends ────────────────────────────────────────────────────

export interface GroupingOptions {
  gapSeconds: number;
  maxSpanSeconds: number;
}

export interface OpenGroup {
  /** Who: one editor per version. */
  actorKey: string;
  firstAt: number;
  lastAt: number;
  /** A paste is a version of its own, so that its time is exact. */
  paste: boolean;
}

/**
 * Does a change by `actorKey` at `at` (milliseconds) still belong to the open version? No when
 * another person made it, when it is a paste or follows one, when the same person paused for
 * longer than the gap, or when the version would cover more than the maximum span.
 */
export function continuesGroup(
  group: OpenGroup | null,
  actorKey: string,
  at: number,
  paste: boolean,
  options: GroupingOptions,
): boolean {
  if (group === null || group.actorKey !== actorKey) return false;
  if (paste || group.paste) return false;
  if (at - group.lastAt > options.gapSeconds * 1000) return false;
  return at - group.firstAt <= options.maxSpanSeconds * 1000;
}

// ── Times ───────────────────────────────────────────────────────────────────

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** `2026-06-29 20:49:26 UTC` */
export function formatUtc(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

const ZONE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  'Asia/Kolkata': 'IST',
  'Asia/Calcutta': 'IST',
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
  GMT: 'UTC',
};

/** `IST` for India, `UTC` for UTC, otherwise the zone's short name (`PST`) or `GMT+1`. */
export function zoneAbbreviation(date: Date, timezone: string): string {
  const fixed = ZONE_ABBREVIATIONS[timezone];
  if (fixed) return fixed;
  const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(date)
    .find((item) => item.type === 'timeZoneName');
  return part?.value ?? timezone;
}

function clockParts(date: Date, timezone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h12',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
    period: get('dayPeriod').toUpperCase().startsWith('P') ? 'PM' : 'AM',
  };
}

/** `2026-06-30 02:21:18 AM IST`: the 12-hour form of the owner's sample documents. */
export function formatEditedAt(date: Date, timezone: string): string {
  const clock = clockParts(date, timezone);
  return `${clock.date} ${clock.time} ${clock.period} ${zoneAbbreviation(date, timezone)}`;
}

/** `02:21:18 AM`: the time of one added or removed line, in the same zone as "Edited At". */
export function formatLineTime(date: Date, timezone: string): string {
  const clock = clockParts(date, timezone);
  return `${clock.time} ${clock.period}`;
}

// ── Who ─────────────────────────────────────────────────────────────────────

/** The editor of a version as the history rows name them (server-set, never from the client). */
export interface VersionActor {
  kind: 'user' | 'guest' | 'service' | 'system';
  userId: string | null;
  grantId: string | null;
  name: string;
  /** `candidate`, `interviewer`, or the document role of the connection. */
  role: string | null;
}

export type VersionEditor = VersionHistoryVersion['editor'];

/** `Meera Iyer (Interviewer, meera@acme.example)`, `Guest Amber Lynx (Guest)`, `System`. */
export function editedByText(editor: VersionEditor): string {
  if (editor.kind === 'system') return editor.name;
  return `${editor.name} (${editor.role}${editor.email ? `, ${editor.email}` : ''})`;
}

// ── Assembling the versions ─────────────────────────────────────────────────

/** When lines came and went inside one version: line key → server times (milliseconds), in order. */
export type LineTimes = Map<string, number[]>;

/** Notes the lines one recorded change added and removed, with the time of that change. */
export function recordLineTimes(
  previous: readonly SnapshotLine[],
  next: readonly SnapshotLine[],
  at: number,
  added: LineTimes,
  removed: LineTimes,
): void {
  const diff = diffLines(previous, next);
  for (const [lines, times] of [
    [diff.added, added],
    [diff.removed, removed],
  ] as const) {
    for (const line of lines) {
      const key = lineKey(line);
      if (key === null) continue;
      const list = times.get(key);
      if (list) list.push(at);
      else times.set(key, [at]);
    }
  }
}

/** A version as the replay produced it: lines, not yet text. */
export interface RawVersion {
  startedAt: Date;
  editedAt: Date;
  actor: VersionActor;
  action: VersionAction;
  lines: SnapshotLine[];
  /** Exact times of the lines this version added and removed, where the replay took them. */
  addedAt?: LineTimes;
  removedAt?: LineTimes;
}

export interface VersionAccumulator {
  versions: RawVersion[];
  /** Lines of the newest state seen, whether or not it became a version. */
  current: SnapshotLine[];
  /** Characters kept in `versions` so far. */
  size: number;
  truncated: boolean;
}

export function newAccumulator(): VersionAccumulator {
  return { versions: [], current: [], size: 0, truncated: false };
}

/**
 * Offers the state at the end of a stretch of work. It becomes a version only when it adds or
 * removes a line or an image compared with the state before it: formatting, caret movement and
 * blank lines alone do not. `budget` bounds the characters kept; past it the list of versions is
 * cut (the newest state is still tracked, so the final content stays complete).
 */
export function offerVersion(
  accumulator: VersionAccumulator,
  candidate: RawVersion,
  budget: { maxVersions: number; maxCharacters: number },
): boolean {
  const diff = diffLines(accumulator.current, candidate.lines);
  accumulator.current = candidate.lines;
  if (diff.added.length === 0 && diff.removed.length === 0) return false;
  const size = sizeOfLines(candidate.lines);
  if (
    accumulator.truncated ||
    accumulator.versions.length >= budget.maxVersions ||
    accumulator.size + size > budget.maxCharacters
  ) {
    accumulator.truncated = true;
    return false;
  }
  accumulator.versions.push(candidate);
  accumulator.size += size;
  return true;
}

export interface VersionHistoryHeader {
  document: { id: string; title: string; url: string };
  session: VersionHistoryResponse['session'];
  trackingStartedAt: Date | null;
  finalizedAt: Date | null;
  timezone: string;
}

export interface ImageFacts {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  url: string;
}

/** Takes the time recorded for a line: the newest for an added line, the oldest for a removed one. */
function takeTime(
  times: LineTimes | undefined,
  line: SnapshotLine,
  newest: boolean,
  fallback: Date,
): Date {
  const key = lineKey(line);
  const list = key === null ? undefined : times?.get(key);
  const value = newest ? list?.pop() : list?.shift();
  return value === undefined ? fallback : new Date(value);
}

/**
 * Turns the replayed versions into the response: numbers them, compares each with the one before,
 * puts a time on every added and removed line, names the editor, and works out in which versions
 * every image was present.
 */
export function assembleVersionHistory(
  header: VersionHistoryHeader,
  accumulator: VersionAccumulator,
  assets: AssetNames,
  images: ReadonlyMap<string, ImageFacts>,
  editorOf: (actor: VersionActor) => VersionEditor,
): VersionHistoryResponse {
  const versions: VersionHistoryVersion[] = [];
  const firstSeen = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  let previous: SnapshotLine[] = [];
  accumulator.versions.forEach((raw, index) => {
    const version = index + 1;
    const diff = diffLines(previous, raw.lines);
    const present = [
      ...new Set(raw.lines.flatMap((line) => (line.kind === 'image' ? [line.id] : []))),
    ];
    for (const id of present) {
      if (!firstSeen.has(id)) firstSeen.set(id, version);
      lastSeen.set(id, version);
    }
    const detail = (text: string, at: Date) => ({
      text,
      at: at.toISOString(),
      atText: formatLineTime(at, header.timezone),
    });
    const addedDetail = diff.added.map((line) =>
      detail(describeAdded(line, assets), takeTime(raw.addedAt, line, true, raw.editedAt)),
    );
    const removedDetail = diff.removed.map((line) =>
      detail(describeRemoved(line), takeTime(raw.removedAt, line, false, raw.editedAt)),
    );
    const editor = editorOf(raw.actor);
    versions.push({
      version,
      startedAt: raw.startedAt.toISOString(),
      startedAtText: formatEditedAt(raw.startedAt, header.timezone),
      editedAt: raw.editedAt.toISOString(),
      editedAtText: formatEditedAt(raw.editedAt, header.timezone),
      editedBy: editedByText(editor),
      editor,
      action: raw.action,
      added: addedDetail.map((item) => item.text),
      removed: removedDetail.map((item) => item.text),
      addedDetail,
      removedDetail,
      snapshot: renderLines(raw.lines, assets),
      images: present,
    });
    previous = raw.lines;
  });

  const inFinal = new Set(
    accumulator.current.flatMap((line) => (line.kind === 'image' ? [line.id] : [])),
  );
  const imageList: VersionHistoryImage[] = [];
  for (const [id, first] of firstSeen) {
    const facts = images.get(id);
    // Only files of this very document are ever listed.
    if (!facts) continue;
    imageList.push({
      ...facts,
      firstVersion: first,
      lastVersion: inFinal.has(id) ? null : (lastSeen.get(id) ?? first),
    });
  }

  return {
    document: {
      id: header.document.id,
      title: oneLine(header.document.title),
      url: header.document.url,
    },
    session: header.session,
    trackingStartedAt: header.trackingStartedAt?.toISOString() ?? null,
    finalizedAt: header.finalizedAt?.toISOString() ?? null,
    timezone: header.timezone,
    versions,
    finalContent: renderLines(accumulator.current, assets),
    images: imageList,
    truncated: accumulator.truncated,
  };
}

// ── The text form ───────────────────────────────────────────────────────────

const RULE = '='.repeat(50);

function bullets(lines: readonly { text: string; atText: string }[], none: string): string[] {
  return lines.length === 0
    ? [`- (${none})`]
    : lines.map((line) => `- [${line.atText}] ${line.text}`);
}

/**
 * `doc.txt`. The separators, labels, blank lines and time formats follow the owner's sample
 * documents (`example/`); the header carries this product's own fields, every added and removed
 * line carries the time of the change that made it, and a version names its editor and action.
 */
export function renderVersionHistoryText(history: VersionHistoryResponse): string {
  const out: string[] = [
    'DOCUMENT VERSION HISTORY',
    `Document ID: ${history.document.id}`,
    `Document URL: ${history.document.url}`,
    `Title: ${history.document.title}`,
  ];
  if (history.session) {
    const { session } = history;
    out.push(`Session ID: ${session.id}`);
    if (session.candidate) out.push(`Candidate: ${oneLine(session.candidate)}`);
    out.push(`Company: ${oneLine(session.company)}`);
    out.push(
      `Round: ${session.round.number}${session.round.name ? ` ${oneLine(session.round.name)}` : ''}`,
    );
  }
  out.push(
    `Tracking Started: ${
      history.trackingStartedAt
        ? formatUtc(new Date(history.trackingStartedAt))
        : '(no history recorded)'
    }`,
    '',
    '',
  );
  for (const version of history.versions) {
    const spansTime =
      new Date(version.editedAt).getTime() - new Date(version.startedAt).getTime() > 1000;
    out.push(
      RULE,
      `VERSION ${version.version}`,
      ...(spansTime ? [`Started At: ${version.startedAtText}`] : []),
      `Edited At: ${version.editedAtText}`,
      `Edited By: ${version.editedBy}`,
      `Action: ${version.action}`,
      '',
      'ADDED:',
      ...bullets(version.addedDetail, 'nothing added'),
      '',
      'REMOVED:',
      ...bullets(version.removedDetail, 'nothing removed'),
      '',
      'CURRENT SNAPSHOT:',
      version.snapshot,
      '',
    );
  }
  if (history.truncated) {
    out.push(
      RULE,
      `NOTE: only the first ${history.versions.length} versions are listed (size limit). The final content below is complete.`,
      '',
    );
  }
  out.push(
    RULE,
    'CURRENT FINAL CONTENT',
    history.finalContent,
    '',
    '',
    RULE,
    `FINALIZED AT: ${
      history.finalizedAt ? formatUtc(new Date(history.finalizedAt)) : '(no history recorded)'
    }`,
  );
  return `${out.join('\n')}\n`;
}

/** The JSON form without the snapshots: `manifest.json` of the archive. */
export function versionHistoryManifest(history: VersionHistoryResponse): Omit<
  VersionHistoryResponse,
  'versions' | 'finalContent'
> & {
  versions: Omit<VersionHistoryVersion, 'snapshot'>[];
} {
  const { finalContent: _finalContent, versions, ...rest } = history;
  return {
    ...rest,
    versions: versions.map(({ snapshot: _snapshot, ...version }) => version),
  };
}
