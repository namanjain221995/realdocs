/**
 * Version history of a document: attributed, server-timestamped changes.
 * Rows never contain document text; text appears only in the diff and the
 * content of a revision, which administrators request explicitly.
 */
import { z } from './zod';

export const HISTORY_OPERATIONS = [
  'baseline',
  'checkpoint',
  'page_settings_changed',
  'paste',
  'image_inserted',
  'image_removed',
  'attachment_inserted',
  'attachment_removed',
  'table_inserted',
  'text_inserted',
  'text_deleted',
  'text_replaced',
  'formatting_changed',
  'structure_changed',
  'edit',
] as const;
export const HistoryOperation = z.enum(HISTORY_OPERATIONS);
export type HistoryOperation = z.infer<typeof HistoryOperation>;

export const HistorySummary = z.object({
  insertedChars: z.number(),
  deletedChars: z.number(),
  insertedBlocks: z.record(z.string(), z.number()),
  removedBlocks: z.record(z.string(), z.number()),
  formatChanges: z.number(),
  attributeChanges: z.number(),
  pageSettings: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })),
  attachmentsAdded: z.array(z.string()),
  attachmentsRemoved: z.array(z.string()),
  clientHint: z.literal('paste').nullable(),
  transactions: z.number(),
});
export type HistorySummary = z.infer<typeof HistorySummary>;

export const HistoryEntry = z.object({
  /** Revision number: monotonic per document, assigned by the server. */
  revision: z.number().int(),
  generation: z.number().int(),
  kind: z.enum(['update', 'checkpoint']),
  operation: HistoryOperation,
  actor: z.object({
    kind: z.enum(['user', 'guest', 'service', 'system']),
    userId: z.string().nullable(),
    name: z.string(),
    /** `candidate`, `interviewer`, `editor`, `admin` … */
    role: z.string().nullable(),
    sessionId: z.string().nullable(),
    /** One browser tab or desktop window. */
    connectionId: z.string().nullable(),
  }),
  /** Server clocks, ISO 8601 with milliseconds. */
  receivedAt: z.string(),
  committedAt: z.string(),
  /** The client's own clock, when it sent one. Informational and untrusted. */
  clientOccurredAt: z.string().nullable(),
  transactionId: z.string(),
  contentSizeDelta: z.number().int(),
  summary: HistorySummary.partial(),
  attachmentIds: z.array(z.string()),
  schemaVersion: z.number().int(),
  updateBytes: z.number().int(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const HistoryQuery = z.object({
  /** Return revisions below this one (newest first). */
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Case-insensitive part of the editor's name. */
  actor: z.string().trim().min(1).max(100).optional(),
  operation: HistoryOperation.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

/** Administrative events of the same document (title, links, restore …), newest first. */
export const HistoryEvent = z.object({
  id: z.string(),
  at: z.string(),
  action: z.string(),
  actorName: z.string().nullable(),
  actorKind: z.string(),
});
export type HistoryEvent = z.infer<typeof HistoryEvent>;

export const HistoryResponse = z.object({
  entries: z.array(HistoryEntry),
  /** Pass as `before` for the next page; null at the end. */
  nextBefore: z.number().int().nullable(),
  events: z.array(HistoryEvent),
  /** Days history is kept; 0 means it is not removed by age. */
  retentionDays: z.number().int(),
});
export type HistoryResponse = z.infer<typeof HistoryResponse>;

export const HistoryDiffLine = z.object({
  op: z.enum(['equal', 'insert', 'delete']),
  text: z.string(),
});
export type HistoryDiffLine = z.infer<typeof HistoryDiffLine>;

export const HistoryRevisionResponse = z.object({
  entry: HistoryEntry,
  /** Text of the document before and after this revision, block by block. */
  diff: z.array(HistoryDiffLine),
  /** The diff was cut because the document is very large. */
  diffTruncated: z.boolean(),
  /** ProseMirror JSON of the document at this revision. */
  content: z.unknown(),
  pageSettings: z.unknown(),
});
export type HistoryRevisionResponse = z.infer<typeof HistoryRevisionResponse>;

export const NameRevisionRequest = z.object({
  name: z.string().trim().min(1).max(120),
});
export type NameRevisionRequest = z.infer<typeof NameRevisionRequest>;

export const CopyRevisionRequest = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});
export type CopyRevisionRequest = z.infer<typeof CopyRevisionRequest>;

export const CopyRevisionResponse = z.object({ documentId: z.string(), title: z.string() });
export type CopyRevisionResponse = z.infer<typeof CopyRevisionResponse>;
