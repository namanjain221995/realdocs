/**
 * Attribution and semantic summary of document changes (docs/version-history.md).
 *
 * The collaboration server knows, for every Yjs transaction it applies, which
 * authenticated connection sent it. `HistoryRecorder` turns the Yjs events of
 * that transaction into counts and kinds ("12 characters inserted", "image
 * added"), and the durable log stores them, with the actor and the update
 * bytes, in `doc_history`. Summaries never contain document text.
 */
import { Y_FRAGMENT_FIELD, Y_PAGE_FIELD } from '@realtimedocs/contracts';
import * as Y from 'yjs';

export type HistoryActorKind = 'user' | 'guest' | 'service' | 'system';

export interface HistoryActor {
  kind: HistoryActorKind;
  userId: string | null;
  grantId: string | null;
  name: string;
  /** `candidate`, `interviewer`, or the document role of the connection. */
  participantRole: string | null;
  sessionId: string | null;
  connectionId: string | null;
  clientId: number | null;
}

export const SYSTEM_ACTOR: HistoryActor = {
  kind: 'system',
  userId: null,
  grantId: null,
  name: 'System',
  participantRole: null,
  sessionId: null,
  connectionId: null,
  clientId: null,
};

export type OperationType =
  | 'baseline'
  | 'checkpoint'
  | 'page_settings_changed'
  | 'paste'
  | 'image_inserted'
  | 'image_removed'
  | 'attachment_inserted'
  | 'attachment_removed'
  | 'table_inserted'
  | 'text_inserted'
  | 'text_deleted'
  | 'text_replaced'
  | 'formatting_changed'
  | 'structure_changed'
  | 'edit';

export interface ChangeSummary {
  insertedChars: number;
  deletedChars: number;
  /** Node type → count. */
  insertedBlocks: Record<string, number>;
  removedBlocks: Record<string, number>;
  formatChanges: number;
  attributeChanges: number;
  /** Page setting → previous and new value (numbers and short strings only). */
  pageSettings: Record<string, { from: unknown; to: unknown }>;
  attachmentsAdded: string[];
  attachmentsRemoved: string[];
  /** What the client said it was doing. Informational: a client can lie. */
  clientHint: 'paste' | null;
  /** Yjs transactions folded into this summary. */
  transactions: number;
}

export function emptySummary(): ChangeSummary {
  return {
    insertedChars: 0,
    deletedChars: 0,
    insertedBlocks: {},
    removedBlocks: {},
    formatChanges: 0,
    attributeChanges: 0,
    pageSettings: {},
    attachmentsAdded: [],
    attachmentsRemoved: [],
    clientHint: null,
    transactions: 0,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_NODES = new Set(['image', 'attachment']);
const ASSET_ATTRIBUTE = 'assetId';
/** A summary is metadata; a hostile client must not be able to make it large. */
const MAX_KEYS = 40;
const MAX_ATTACHMENTS = 200;
/** One transaction that inserts this much text at once was not typed. */
const BULK_INSERT_CHARS = 200;

function bump(counts: Record<string, number>, key: string, by = 1): void {
  const name = key.slice(0, 48);
  if (Object.hasOwn(counts, name)) counts[name] = (counts[name] ?? 0) + by;
  else if (Object.keys(counts).length < MAX_KEYS) counts[name] = by;
}

function pushUnique(list: string[], value: unknown): void {
  if (typeof value !== 'string' || !UUID.test(value)) return;
  if (list.length >= MAX_ATTACHMENTS || list.includes(value)) return;
  list.push(value);
}

/** Attribute of a type that may already be deleted (its map entries are then deleted too). */
function rawAttribute(type: Y.XmlElement, key: string): unknown {
  // `_map` and `_start` are Yjs internals: the public API hides deleted items,
  // and what was just deleted is exactly what is summarised here.
  const item = (type as unknown as { _map?: Map<string, Y.Item> })._map?.get(key);
  if (!item) return undefined;
  const content = item.content.getContent() as unknown[];
  return content[content.length - 1];
}

interface SubtreeStats {
  chars: number;
  blocks: Record<string, number>;
  assets: string[];
}

/** Text length, node types and asset ids below `type`, deleted items included. */
function walkSubtree(type: Y.AbstractType<unknown>, stats: SubtreeStats, depth = 0): void {
  if (depth > 64) return;
  if (type instanceof Y.XmlElement) {
    bump(stats.blocks, type.nodeName);
    if (ASSET_NODES.has(type.nodeName))
      pushUnique(stats.assets, rawAttribute(type, ASSET_ATTRIBUTE));
  }
  let item = (type as unknown as { _start: Y.Item | null })._start;
  while (item) {
    const content = item.content;
    if (content instanceof Y.ContentString) stats.chars += content.str.length;
    else if (content instanceof Y.ContentType) {
      walkSubtree(content.type as Y.AbstractType<unknown>, stats, depth + 1);
    }
    item = item.right;
  }
}

function plainValue(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value.slice(0, 32);
  if (typeof value === 'boolean' || value === null) return value;
  return value === undefined ? null : '[complex]';
}

/** Folds the events of one Yjs transaction into `summary`. */
export function summarizeEvents(
  events: Y.YEvent<Y.AbstractType<unknown>>[],
  summary: ChangeSummary,
): void {
  for (const event of events) {
    const target = event.target;

    if (target instanceof Y.Map) {
      // The shared page settings (top-level map `page`).
      for (const [key, change] of event.changes.keys) {
        if (Object.keys(summary.pageSettings).length >= MAX_KEYS) break;
        const previous = summary.pageSettings[key.slice(0, 32)];
        summary.pageSettings[key.slice(0, 32)] = {
          from: previous ? previous.from : plainValue(change.oldValue),
          to: plainValue((target as Y.Map<unknown>).get(key)),
        };
      }
      continue;
    }

    if (target instanceof Y.XmlText) {
      for (const part of event.changes.delta) {
        if (typeof part.insert === 'string') summary.insertedChars += part.insert.length;
        else if (part.delete !== undefined) summary.deletedChars += part.delete;
        else if (
          part.retain !== undefined &&
          (part as { attributes?: Record<string, unknown> }).attributes
        ) {
          summary.formatChanges += 1;
        }
      }
      continue;
    }

    // XmlElement or the fragment itself: children added or removed, attributes changed.
    for (const item of event.changes.added) {
      if (!(item.content instanceof Y.ContentType)) continue;
      const stats: SubtreeStats = { chars: 0, blocks: {}, assets: [] };
      walkSubtree(item.content.type as Y.AbstractType<unknown>, stats);
      summary.insertedChars += stats.chars;
      for (const [name, count] of Object.entries(stats.blocks))
        bump(summary.insertedBlocks, name, count);
      for (const asset of stats.assets) pushUnique(summary.attachmentsAdded, asset);
    }
    for (const item of event.changes.deleted) {
      if (!(item.content instanceof Y.ContentType)) continue;
      const stats: SubtreeStats = { chars: 0, blocks: {}, assets: [] };
      walkSubtree(item.content.type as Y.AbstractType<unknown>, stats);
      summary.deletedChars += stats.chars;
      for (const [name, count] of Object.entries(stats.blocks))
        bump(summary.removedBlocks, name, count);
      for (const asset of stats.assets) pushUnique(summary.attachmentsRemoved, asset);
    }
    if (target instanceof Y.XmlElement) {
      for (const [key, change] of event.changes.keys) {
        if (ASSET_NODES.has(target.nodeName) && key === ASSET_ATTRIBUTE) {
          // An upload finished (placeholder → asset) or an asset was swapped.
          pushUnique(summary.attachmentsRemoved, change.oldValue);
          pushUnique(summary.attachmentsAdded, target.getAttribute(key));
        } else {
          summary.attributeChanges += 1;
        }
      }
    }
  }
  // Characters inside a removed and re-inserted block are not a change of text:
  // the editor binding rewrites a paragraph when it is split or merged.
  summary.transactions += 1;
}

export function mergeSummaries(into: ChangeSummary, from: ChangeSummary): ChangeSummary {
  into.insertedChars += from.insertedChars;
  into.deletedChars += from.deletedChars;
  for (const [name, count] of Object.entries(from.insertedBlocks))
    bump(into.insertedBlocks, name, count);
  for (const [name, count] of Object.entries(from.removedBlocks))
    bump(into.removedBlocks, name, count);
  into.formatChanges += from.formatChanges;
  into.attributeChanges += from.attributeChanges;
  for (const [key, change] of Object.entries(from.pageSettings)) {
    const previous = into.pageSettings[key];
    into.pageSettings[key] = { from: previous ? previous.from : change.from, to: change.to };
  }
  for (const asset of from.attachmentsAdded) pushUnique(into.attachmentsAdded, asset);
  for (const asset of from.attachmentsRemoved) pushUnique(into.attachmentsRemoved, asset);
  into.clientHint ??= from.clientHint;
  into.transactions += from.transactions;
  return into;
}

/** The one word the timeline shows for a row; the summary keeps the details. */
export function classify(summary: ChangeSummary): OperationType {
  const has = (counts: Record<string, number>, name: string): boolean => (counts[name] ?? 0) > 0;
  const net = (name: string): number =>
    (summary.insertedBlocks[name] ?? 0) - (summary.removedBlocks[name] ?? 0);

  if (Object.keys(summary.pageSettings).length > 0) return 'page_settings_changed';
  if (summary.clientHint === 'paste') return 'paste';
  if (summary.attachmentsAdded.length > 0 || net('image') > 0 || net('attachment') > 0) {
    return net('attachment') > 0 && net('image') <= 0 ? 'attachment_inserted' : 'image_inserted';
  }
  if (summary.attachmentsRemoved.length > 0 || net('image') < 0 || net('attachment') < 0) {
    return net('attachment') < 0 && net('image') >= 0 ? 'attachment_removed' : 'image_removed';
  }
  if (net('table') > 0) return 'table_inserted';
  // Large insertion in a single transaction: pasted or inserted by a tool, not typed.
  if (
    summary.transactions === 1 &&
    summary.insertedChars - summary.deletedChars >= BULK_INSERT_CHARS
  ) {
    return 'paste';
  }
  const inserted = summary.insertedChars;
  const deleted = summary.deletedChars;
  if (inserted > 0 && deleted > 0)
    return inserted === deleted ? 'structure_changed' : 'text_replaced';
  if (inserted > 0) return 'text_inserted';
  if (deleted > 0) return 'text_deleted';
  if (summary.formatChanges > 0 || summary.attributeChanges > 0) return 'formatting_changed';
  if (has(summary.insertedBlocks, 'paragraph') || Object.keys(summary.removedBlocks).length > 0) {
    return 'structure_changed';
  }
  return 'edit';
}

/** Net change of the text length, for the timeline. */
export function sizeDelta(summary: ChangeSummary): number {
  return summary.insertedChars - summary.deletedChars;
}

/**
 * Watches one loaded document and keeps the summary of the transaction that
 * is being applied. Yjs calls deep observers before it emits `update` for the
 * same transaction, so `take()` inside the `update` handler returns exactly
 * the summary of that update.
 */
export class HistoryRecorder {
  private current: ChangeSummary | null = null;
  private readonly fragment: Y.XmlFragment;
  private readonly page: Y.Map<unknown>;
  private readonly observer = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    this.current ??= emptySummary();
    try {
      summarizeEvents(events, this.current);
    } catch {
      // A summary is best effort; the update itself is always recorded.
    }
  };

  constructor(document: Y.Doc) {
    this.fragment = document.getXmlFragment(Y_FRAGMENT_FIELD);
    this.page = document.getMap(Y_PAGE_FIELD);
    this.fragment.observeDeep(this.observer);
    this.page.observeDeep(this.observer);
  }

  /** Summary of the transaction whose `update` event is being handled. */
  take(): ChangeSummary {
    const summary = this.current ?? emptySummary();
    this.current = null;
    if (summary.transactions === 0) summary.transactions = 1;
    return summary;
  }

  destroy(): void {
    this.fragment.unobserveDeep(this.observer);
    this.page.unobserveDeep(this.observer);
  }
}

/** Asset ids referenced anywhere in the document (for checkpoint rows). */
export function collectAssetIdsFromDoc(document: Y.Doc): string[] {
  const stats: SubtreeStats = { chars: 0, blocks: {}, assets: [] };
  const fragment = document.getXmlFragment(Y_FRAGMENT_FIELD);
  for (const child of fragment.toArray()) {
    if (child instanceof Y.XmlElement) collectLive(child, stats.assets);
  }
  return stats.assets;
}

function collectLive(element: Y.XmlElement, assets: string[], depth = 0): void {
  if (depth > 64) return;
  if (ASSET_NODES.has(element.nodeName)) {
    const value: unknown = element.getAttribute(ASSET_ATTRIBUTE);
    if (typeof value === 'string' && UUID.test(value) && !assets.includes(value))
      assets.push(value);
  }
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlElement) collectLive(child, assets, depth + 1);
  }
}
