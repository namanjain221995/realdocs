/**
 * Pure helpers of the version history screen: wording, time formatting,
 * summaries and the shape of the timeline. No React, no network.
 *
 * Times shown to people are the server's `committedAt` in the viewer's own
 * time zone. The client's reported time is never used for ordering or
 * grouping; it is only displayed, marked as unverified.
 */
import {
  HISTORY_OPERATIONS,
  type HistoryEntry,
  type HistoryEvent,
  type HistoryOperation,
} from '@realtimedocs/contracts';

/** Plain-words label of every operation. The test suite checks that none is missing. */
export const OPERATION_LABELS: Readonly<Record<HistoryOperation, string>> = {
  baseline: 'History starts here',
  checkpoint: 'Checkpoint',
  page_settings_changed: 'Changed page settings',
  paste: 'Pasted content',
  image_inserted: 'Inserted image',
  image_removed: 'Removed image',
  attachment_inserted: 'Inserted attachment',
  attachment_removed: 'Removed attachment',
  table_inserted: 'Inserted table',
  text_inserted: 'Typed text',
  text_deleted: 'Deleted text',
  text_replaced: 'Replaced text',
  formatting_changed: 'Changed formatting',
  structure_changed: 'Changed structure',
  edit: 'Edited',
};

export function operationLabel(operation: string): string {
  return (OPERATION_LABELS as Readonly<Record<string, string>>)[operation] ?? operation;
}

export const OPERATION_OPTIONS: ReadonlyArray<{ value: HistoryOperation; label: string }> =
  HISTORY_OPERATIONS.map((value) => ({ value, label: OPERATION_LABELS[value] }));

const ROLE_LABELS: Readonly<Record<string, string>> = {
  candidate: 'Candidate',
  interviewer: 'Interviewer',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

/** "Interviewer"; guests without a role are "Guest"; an unknown role is shown as the server sent it. */
export function roleLabel(actor: Pick<HistoryEntry['actor'], 'kind' | 'role'>): string {
  if (actor.role) return ROLE_LABELS[actor.role] ?? actor.role;
  if (actor.kind === 'guest') return 'Guest';
  if (actor.kind === 'system' || actor.kind === 'service') return 'System';
  return 'Editor';
}

/* ------------------------------------------------------------------ time */

export interface TimeOptions {
  /** IANA zone; the viewer's own when omitted. Tests pass one. */
  timeZone?: string;
  locale?: string;
}

function parts(ms: number, options: Intl.DateTimeFormatOptions, extra: TimeOptions): string {
  return new Intl.DateTimeFormat(extra.locale, { ...options, timeZone: extra.timeZone }).format(
    new Date(ms),
  );
}

/** `HH:mm:ss` in the viewer's zone (24-hour, second precision). */
export function formatClock(iso: string, extra: TimeOptions = {}): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: extra.timeZone,
  });
  return formatter.format(new Date(ms));
}

/** `YYYY-MM-DD` of the viewer's calendar day. */
export function dayKey(iso: string, extra: TimeOptions = {}): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'unknown';
  const found = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: extra.timeZone,
  }).formatToParts(new Date(ms));
  const get = (type: string) => found.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Thursday, 12 November 2026" in the viewer's locale. */
export function formatDayHeading(iso: string, extra: TimeOptions = {}): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'Unknown date';
  return parts(ms, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, extra);
}

/** The zone's short name ("UTC", "GMT+5:30"), shown once above the timeline. */
export function timeZoneName(at: number, extra: TimeOptions = {}): string {
  const found = new Intl.DateTimeFormat(extra.locale, {
    timeZoneName: 'short',
    timeZone: extra.timeZone,
  }).formatToParts(new Date(at));
  const zone = found.find((part) => part.type === 'timeZoneName')?.value;
  const resolved = extra.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && zone !== resolved ? `${resolved} (${zone})` : (zone ?? resolved);
}

/** Full timestamp with milliseconds, in UTC: `2026-11-12T15:30:02.123Z`. */
export function formatIsoMs(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toISOString();
}

/** `2026-11-12 15:30:02` in the viewer's zone, for automatic names. */
export function formatStamp(iso: string, extra: TimeOptions = {}): string {
  return `${dayKey(iso, extra)} ${formatClock(iso, extra)}`;
}

export function restoredVersionName(
  entry: Pick<HistoryEntry, 'revision' | 'committedAt'>,
  extra: TimeOptions = {},
): string {
  return `Restored from revision ${entry.revision} (${formatStamp(entry.committedAt, extra)})`;
}

/** Start and end of a local calendar day (`YYYY-MM-DD` from a date input) as ISO instants. */
export function dayBoundsIso(value: string, edge: 'start' | 'end'): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, y, m, d] = match;
  const date =
    edge === 'start'
      ? new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0)
      : new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/* --------------------------------------------------------------- summary */

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const MINUS = '−';

function words(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

const MILLIMETRE_KEYS = /^(margin|headerSpacing|footerSpacing)/;

function settingValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (typeof value === 'number') {
    const rounded = Math.round(value * 100) / 100;
    return MILLIMETRE_KEYS.test(key) ? `${rounded} mm` : String(rounded);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return JSON.stringify(value);
}

/** "margin left 25.4 mm → 30 mm" for each changed page setting. */
export function pageSettingChanges(summary: HistoryEntry['summary']): string[] {
  return Object.entries(summary.pageSettings ?? {}).map(
    ([key, change]) =>
      `${words(key)} ${settingValue(key, change.from)} → ${settingValue(key, change.to)}`,
  );
}

function sum(record: Record<string, number> | undefined, skip: readonly string[] = []): number {
  return Object.entries(record ?? {})
    .filter(([name]) => !skip.includes(name))
    .reduce((total, [, count]) => total + count, 0);
}

const NAMED_BLOCKS: ReadonlyArray<[string, string]> = [
  ['image', 'image'],
  ['attachment', 'attachment'],
  ['table', 'table'],
];

/** Short pieces of text describing what a revision changed. Never contains document text. */
export function summaryParts(entry: Pick<HistoryEntry, 'operation' | 'summary'>): string[] {
  const { summary, operation } = entry;
  const out: string[] = [];
  if (operation === 'baseline') return ['Recorded history of this version starts here'];
  const inserted = summary.insertedChars ?? 0;
  const deleted = summary.deletedChars ?? 0;
  if (inserted > 0 && deleted > 0) out.push(`+${inserted} / ${MINUS}${deleted} characters`);
  else if (inserted > 0) out.push(`+${inserted} characters`);
  else if (deleted > 0) out.push(`${MINUS}${deleted} characters`);
  out.push(...pageSettingChanges(summary));
  const named = new Set(NAMED_BLOCKS.map(([name]) => name));
  for (const [name, noun] of NAMED_BLOCKS) {
    const added = summary.insertedBlocks?.[name] ?? 0;
    const removed = summary.removedBlocks?.[name] ?? 0;
    if (added > 0) out.push(plural(added, noun));
    if (removed > 0) out.push(`${plural(removed, noun)} removed`);
  }
  const otherAdded = sum(summary.insertedBlocks, [...named]);
  const otherRemoved = sum(summary.removedBlocks, [...named]);
  if (otherAdded > 0) out.push(`${plural(otherAdded, 'block')} added`);
  if (otherRemoved > 0) out.push(`${plural(otherRemoved, 'block')} removed`);
  const format = summary.formatChanges ?? 0;
  if (format > 0) out.push(`${plural(format, 'formatting change')}`);
  const attributes = summary.attributeChanges ?? 0;
  if (attributes > 0 && format === 0) out.push(plural(attributes, 'attribute change'));
  return out;
}

export function summaryText(entry: Pick<HistoryEntry, 'operation' | 'summary'>): string {
  return summaryParts(entry).join(' · ');
}

/** How a paste was recognised: announced by the client, or inferred from its size. */
export function pasteBasis(entry: Pick<HistoryEntry, 'operation' | 'summary'>): string | null {
  if (entry.operation !== 'paste') return null;
  return entry.summary.clientHint === 'paste'
    ? 'Announced by the editor as a paste'
    : 'Inferred from the size of the change';
}

/** "+1.2 KB" style size change for the detail pane. */
export function formatSizeDelta(bytes: number): string {
  const sign = bytes < 0 ? MINUS : bytes > 0 ? '+' : '';
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${abs} B`;
  return `${sign}${(abs / 1024).toFixed(abs < 10 * 1024 ? 1 : 0)} KB`;
}

/** First 8 characters of an identifier, for display next to a copy button. */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/* ----------------------------------------------------------- audit events */

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'document.created': 'Document created',
  'document.renamed': 'Title changed',
  'document.updated': 'Title changed',
  'document.archived': 'Document archived',
  'document.duplicated': 'Document duplicated',
  'share.created': 'Share link created',
  'share.updated': 'Share link changed',
  'share.revoked': 'Share link revoked',
  'share.rotated': 'Share link replaced',
  'snapshot.created': 'Snapshot saved',
  'snapshot.deleted': 'Snapshot deleted',
  'snapshot.restored': 'Version restored',
  'member.removed': 'Member removed',
  'history.revision_named': 'Version named',
  'history.revision_copied': 'Version restored as a copy',
  'history.revision_exported': 'Revision exported',
  'history.exported': 'Audit trail exported',
  'history.viewed': 'Version history opened',
  'history.revision_viewed': 'Revision viewed',
};

/** "Version restored"; an action the screen does not know is shown as the raw action string. */
export function eventLabel(action: string): string {
  return EVENT_LABELS[action] ?? action;
}

/* -------------------------------------------------------------- timeline */

export type TimelineRow =
  | { type: 'entry'; at: string; entry: HistoryEntry }
  | { type: 'event'; at: string; event: HistoryEvent };

/**
 * Entries (newest first, as the server sends them) with administrative events
 * woven in by time. While more pages exist, events older than the oldest
 * loaded entry are held back: they belong between rows that are not on screen
 * yet and would otherwise float to the bottom of the wrong place.
 */
export function interleave(
  entries: readonly HistoryEntry[],
  events: readonly HistoryEvent[],
  hasMore: boolean,
): TimelineRow[] {
  const oldest = entries.at(-1);
  const floor = hasMore && oldest ? Date.parse(oldest.committedAt) : Number.NEGATIVE_INFINITY;
  const rows: TimelineRow[] = entries.map((entry) => ({
    type: 'entry',
    at: entry.committedAt,
    entry,
  }));
  for (const event of events) {
    if (Date.parse(event.at) >= floor) rows.push({ type: 'event', at: event.at, event });
  }
  // Array.sort is stable: equal instants keep entries (already newest first) before events.
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Who made a change, as one key: two consecutive rows with the same key are one editor's run. */
export function editorKey(actor: HistoryEntry['actor']): string {
  return `${actor.kind}:${actor.userId ?? actor.sessionId ?? actor.name}:${actor.role ?? ''}`;
}

export type TimelineBlock =
  | {
      type: 'editor';
      key: string;
      /** `editorKey` of the run. */
      editor: string;
      actor: HistoryEntry['actor'];
      entries: HistoryEntry[];
    }
  | { type: 'event'; key: string; event: HistoryEvent };

export interface TimelineDay {
  key: string;
  label: string;
  blocks: TimelineBlock[];
}

/** Groups rows by calendar day and, inside a day, consecutive rows of the same editor. */
export function groupTimeline(
  rows: readonly TimelineRow[],
  extra: TimeOptions = {},
): TimelineDay[] {
  const days: TimelineDay[] = [];
  for (const row of rows) {
    const key = dayKey(row.at, extra);
    let day = days.at(-1);
    if (day?.key !== key) {
      day = { key, label: formatDayHeading(row.at, extra), blocks: [] };
      days.push(day);
    }
    if (row.type === 'event') {
      day.blocks.push({ type: 'event', key: `event:${row.event.id}`, event: row.event });
      continue;
    }
    const last = day.blocks.at(-1);
    if (last?.type === 'editor' && last.editor === editorKey(row.entry.actor)) {
      last.entries.push(row.entry);
    } else {
      day.blocks.push({
        type: 'editor',
        key: `editor:${row.entry.revision}`,
        editor: editorKey(row.entry.actor),
        actor: row.entry.actor,
        entries: [row.entry],
      });
    }
  }
  return days;
}

/** "Naman Jain — Interviewer · 14 changes · 15:30:02–15:41:55" (oldest to newest time). */
export function groupLabel(
  block: Extract<TimelineBlock, { type: 'editor' }>,
  extra: TimeOptions = {},
): string {
  const newest = block.entries[0];
  const oldest = block.entries.at(-1);
  const range =
    newest && oldest
      ? `${formatClock(oldest.committedAt, extra)}–${formatClock(newest.committedAt, extra)}`
      : '';
  return `${block.actor.name} — ${roleLabel(block.actor)} · ${plural(block.entries.length, 'change')} · ${range}`;
}

/** Revisions in the order a keyboard moves through them (as displayed). */
export function visibleRevisions(days: readonly TimelineDay[]): number[] {
  return days.flatMap((day) =>
    day.blocks.flatMap((block) =>
      block.type === 'editor' ? block.entries.map((e) => e.revision) : [],
    ),
  );
}

/* ------------------------------------------------------------------ diff */

export type DiffItem =
  | { type: 'line'; op: 'equal' | 'insert' | 'delete'; text: string; index: number }
  | { type: 'gap'; count: number; lines: Array<{ text: string; index: number }>; index: number };

/**
 * Keeps `context` unchanged lines around every change and folds longer runs of
 * unchanged lines into one gap that the reader can open.
 */
export function collapseDiff(
  diff: ReadonlyArray<{ op: 'equal' | 'insert' | 'delete'; text: string }>,
  context = 2,
): DiffItem[] {
  const keep = diff.map((line) => line.op !== 'equal');
  const near = keep.map((_, i) => {
    for (let d = -context; d <= context; d += 1) if (keep[i + d]) return true;
    return false;
  });
  const items: DiffItem[] = [];
  let run: Array<{ text: string; index: number }> = [];
  const flush = (): void => {
    if (run.length === 0) return;
    // A fold of one or two lines is no shorter than the lines themselves.
    if (run.length <= 2) {
      for (const line of run) items.push({ type: 'line', op: 'equal', ...line });
    } else {
      items.push({ type: 'gap', count: run.length, lines: run, index: run[0]?.index ?? 0 });
    }
    run = [];
  };
  diff.forEach((line, index) => {
    if (near[index]) {
      flush();
      items.push({ type: 'line', op: line.op, text: line.text, index });
    } else {
      run.push({ text: line.text, index });
    }
  });
  flush();
  return items;
}
