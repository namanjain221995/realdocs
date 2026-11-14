/**
 * Reading the version history (docs/version-history.md): the timeline, the
 * document as it was at a revision, and the states needed to restore one.
 * Writing happens only in the durable log (collab/pg-log-store.ts).
 */
import type {
  HistoryEntry,
  HistoryEvent,
  HistoryOperation,
  HistoryQuery,
} from '@realtimedocs/contracts';
import { Y_PAGE_FIELD, normalizePageSettings, type PageSettings } from '@realtimedocs/contracts';
import type { DocJSON } from '@realtimedocs/editor/schema';
import * as Y from 'yjs';
import type { Queryable } from '../db/pool';
import { ydocToJson } from '../documents/ydoc';
import { errors } from '../errors';

interface EntryRow {
  hseq: string | number;
  generation: number;
  kind: 'update' | 'checkpoint';
  operationType: string;
  actorKind: 'user' | 'guest' | 'service' | 'system';
  actorUserId: string | null;
  actorName: string;
  participantRole: string | null;
  sessionId: string | null;
  connectionId: string | null;
  transactionId: string;
  receivedAt: Date;
  committedAt: Date;
  clientOccurredAt: Date | null;
  contentSizeDelta: number;
  summary: Record<string, unknown>;
  attachmentIds: string[];
  schemaVersion: number;
  updateBytes: number;
}

const ENTRY_COLUMNS = `
  h.hseq, h.generation, h.kind, h.operation_type AS "operationType",
  h.actor_kind AS "actorKind", h.actor_user_id AS "actorUserId", h.actor_name AS "actorName",
  h.participant_role AS "participantRole", h.session_id AS "sessionId",
  h.connection_id AS "connectionId", h.transaction_id AS "transactionId",
  h.server_received_at AS "receivedAt", h.server_committed_at AS "committedAt",
  h.client_occurred_at AS "clientOccurredAt", h.content_size_delta AS "contentSizeDelta",
  h.summary, h.attachment_ids AS "attachmentIds", h.schema_version AS "schemaVersion",
  octet_length(h."update") AS "updateBytes"`;

function toEntry(row: EntryRow): HistoryEntry {
  return {
    revision: Number(row.hseq),
    generation: row.generation,
    kind: row.kind,
    operation: row.operationType as HistoryOperation,
    actor: {
      kind: row.actorKind,
      userId: row.actorUserId,
      name: row.actorName,
      role: row.participantRole,
      sessionId: row.sessionId,
      connectionId: row.connectionId,
    },
    receivedAt: row.receivedAt.toISOString(),
    committedAt: row.committedAt.toISOString(),
    clientOccurredAt: row.clientOccurredAt?.toISOString() ?? null,
    transactionId: row.transactionId,
    contentSizeDelta: row.contentSizeDelta,
    summary: row.summary as HistoryEntry['summary'],
    attachmentIds: row.attachmentIds,
    schemaVersion: row.schemaVersion,
    updateBytes: Number(row.updateBytes),
  };
}

export async function listHistory(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  query: HistoryQuery,
): Promise<{ entries: HistoryEntry[]; nextBefore: number | null }> {
  const where = ['h.document_id = $1', 'h.workspace_id = $2', `h.operation_type <> 'checkpoint'`];
  const values: unknown[] = [documentId, workspaceId];
  const add = (clause: string, value: unknown): void => {
    values.push(value);
    where.push(clause.replace('?', `$${values.length}`));
  };
  if (query.before !== undefined) add('h.hseq < ?', query.before);
  if (query.actor !== undefined) {
    // The search text is data: escape the LIKE wildcards.
    add(`h.actor_name ILIKE ? ESCAPE '\\'`, `%${query.actor.replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (query.operation !== undefined) add('h.operation_type = ?', query.operation);
  if (query.from !== undefined) add('h.server_committed_at >= ?', query.from);
  if (query.to !== undefined) add('h.server_committed_at <= ?', query.to);
  values.push(query.limit + 1);
  const result = await db.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM doc_history h
      WHERE ${where.join(' AND ')}
      ORDER BY h.hseq DESC
      LIMIT $${values.length}`,
    values,
  );
  const rows = result.rows.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    entries: rows.map(toEntry),
    nextBefore: result.rows.length > query.limit && last ? Number(last.hseq) : null,
  };
}

/** Administrative events about the document (title, links, snapshots, access), newest first. */
export async function listDocumentEvents(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  limit: number,
): Promise<HistoryEvent[]> {
  const result = await db.query<{
    id: string;
    at: Date;
    action: string;
    actorName: string | null;
    actorKind: string;
  }>(
    // Two indexed lookups (migration 0005) instead of one scan of the workspace's audit log: an
    // event is about the document when it targets it or names it in its details. UNION removes
    // the events that do both.
    `SELECT id, at, action, "actorName", "actorKind"
       FROM (
         (SELECT id, at, action, actor_name AS "actorName", actor_kind AS "actorKind"
            FROM audit_events
           WHERE workspace_id = $1 AND target_id = $2::text
           ORDER BY at DESC, id
           LIMIT $3)
         UNION
         (SELECT id, at, action, actor_name AS "actorName", actor_kind AS "actorKind"
            FROM audit_events
           WHERE workspace_id = $1 AND details ? 'documentId' AND details ->> 'documentId' = $2::text
           ORDER BY at DESC, id
           LIMIT $3)
       ) AS events
      ORDER BY at DESC, id
      LIMIT $3`,
    [workspaceId, documentId, limit],
  );
  return result.rows.map((row) => ({ ...row, at: row.at.toISOString() }));
}

export async function getHistoryEntry(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  revision: number,
): Promise<HistoryEntry> {
  const result = await db.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM doc_history h
      WHERE h.document_id = $1 AND h.workspace_id = $2 AND h.hseq = $3`,
    [documentId, workspaceId, revision],
  );
  const row = result.rows[0];
  if (!row) throw errors.notFound('That revision does not exist or is no longer retained.');
  return toEntry(row);
}

export interface RevisionState {
  /** Complete Yjs state of the document at the revision. */
  state: Uint8Array;
  content: DocJSON;
  pageSettings: PageSettings;
  generation: number;
}

/**
 * The document as it was right after `revision`: the latest checkpoint of the
 * same generation at or before it, plus every later row up to it, in order.
 */
export async function rebuildRevision(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  revision: number,
): Promise<RevisionState> {
  const result = await db.query<{ hseq: string | number; generation: number; update: Buffer }>(
    `WITH target AS (
       SELECT hseq, generation FROM doc_history
        WHERE document_id = $1 AND workspace_id = $2 AND hseq = $3
     ), base AS (
       SELECT max(h.hseq) AS hseq FROM doc_history h, target
        WHERE h.document_id = $1 AND h.generation = target.generation
          AND h.kind = 'checkpoint' AND h.hseq <= target.hseq
     )
     SELECT h.hseq, h.generation, h."update"
       FROM doc_history h, target, base
      WHERE h.document_id = $1 AND h.generation = target.generation
        AND h.hseq >= base.hseq AND h.hseq <= target.hseq
      ORDER BY h.hseq`,
    [documentId, workspaceId, revision],
  );
  const first = result.rows[0];
  if (!first) {
    throw errors.notFound('That revision does not exist or is no longer retained.');
  }
  const ydoc = new Y.Doc();
  try {
    for (const row of result.rows) Y.applyUpdate(ydoc, row.update);
    return {
      state: Y.encodeStateAsUpdate(ydoc),
      content: ydocToJson(ydoc),
      pageSettings: normalizePageSettings(ydoc.getMap(Y_PAGE_FIELD).toJSON()),
      generation: first.generation,
    };
  } finally {
    ydoc.destroy();
  }
}

/** The revision before `revision` in the same generation, or null when it is the first. */
export async function previousRevision(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  revision: number,
  generation: number,
): Promise<number | null> {
  const result = await db.query<{ hseq: string | number | null }>(
    `SELECT max(hseq) AS hseq FROM doc_history
      WHERE document_id = $1 AND workspace_id = $2 AND generation = $3 AND hseq < $4`,
    [documentId, workspaceId, generation, revision],
  );
  const value = result.rows[0]?.hseq;
  return value == null ? null : Number(value);
}
