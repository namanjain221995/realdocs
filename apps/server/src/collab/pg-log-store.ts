/**
 * PostgreSQL implementation of the durable update log.
 *
 * Each call is ONE statement and therefore one transaction: it locks the
 * `documents` row, verifies generation and head sequence, writes, and moves
 * `head_seq`. A statement that finds a different generation or head sequence
 * writes nothing at all.
 */
import type { Queryable } from '../db/pool';
import { randomUUID } from 'node:crypto';
import {
  GenerationMismatchError,
  SequenceConflictError,
  type HistoryCheckpoint,
  type HistorySegment,
  type LogStore,
} from './durable-log';

const bytes = (data: Uint8Array): Buffer =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength);

/** Columns of a history segment that travel as JSON (everything except the update bytes). */
function segmentJson(segment: HistorySegment, transactionId: string): Record<string, unknown> {
  return {
    operationType: segment.operationType,
    actorKind: segment.actor.kind,
    userId: segment.actor.userId,
    grantId: segment.actor.grantId,
    name: segment.actor.name.slice(0, 200),
    participantRole: segment.actor.participantRole,
    sessionId: segment.actor.sessionId,
    connectionId: segment.actor.connectionId,
    clientId: segment.actor.clientId,
    transactionId,
    receivedAt: segment.receivedAt.toISOString(),
    clientOccurredAt: segment.clientOccurredAt?.toISOString() ?? null,
    contentSizeDelta: segment.contentSizeDelta,
    summary: segment.summary,
    attachmentIds: segment.attachmentIds,
  };
}

interface AppendRow {
  generation: number | null;
  headSeq: number | string | null;
  seq: number | string | null;
}

interface CompactRow {
  generation: number | null;
  headSeq: number | string | null;
  stored: number | string;
}

export class PgLogStore implements LogStore {
  constructor(
    private readonly db: Queryable,
    private readonly workspaceId: string,
  ) {}

  async append(input: {
    documentId: string;
    generation: number;
    expectedHeadSeq: number;
    update: Uint8Array;
    history?: HistorySegment[];
  }): Promise<number> {
    const history = input.history ?? [];
    // One id for everything committed together, so rows of one commit can be found again.
    const transactionId = randomUUID();
    const result = await this.db.query<AppendRow>(
      `WITH doc AS (
         SELECT id, generation, head_seq, history_seq, schema_version
           FROM documents
          WHERE id = $1::uuid AND workspace_id = $2::uuid
            FOR UPDATE
       ), ins AS (
         INSERT INTO doc_updates (document_id, generation, seq, workspace_id, "update")
         SELECT doc.id, doc.generation, doc.head_seq + 1, $2::uuid, $5::bytea
           FROM doc
          WHERE doc.generation = $3::integer AND doc.head_seq = $4::bigint
         RETURNING seq
       ), hist AS (
         -- The attributed parts of the same commit: written or not written together with it.
         INSERT INTO doc_history
           (document_id, hseq, workspace_id, generation, seq, kind, operation_type,
            actor_kind, actor_user_id, actor_grant_id, actor_name, participant_role,
            session_id, connection_id, client_id, transaction_id,
            server_received_at, client_occurred_at, content_size_delta, summary,
            attachment_ids, schema_version, "update")
         SELECT doc.id, doc.history_seq + m.ord, $2::uuid, doc.generation, ins.seq, 'update',
                m.meta->>'operationType',
                m.meta->>'actorKind', (m.meta->>'userId')::uuid, (m.meta->>'grantId')::uuid,
                m.meta->>'name', m.meta->>'participantRole',
                (m.meta->>'sessionId')::uuid, m.meta->>'connectionId',
                (m.meta->>'clientId')::bigint, (m.meta->>'transactionId')::uuid,
                (m.meta->>'receivedAt')::timestamptz, (m.meta->>'clientOccurredAt')::timestamptz,
                (m.meta->>'contentSizeDelta')::integer, m.meta->'summary',
                ARRAY(SELECT jsonb_array_elements_text(m.meta->'attachmentIds'))::uuid[],
                doc.schema_version, b.data
           FROM ins, doc,
                jsonb_array_elements($6::jsonb) WITH ORDINALITY AS m(meta, ord)
           JOIN unnest($7::bytea[]) WITH ORDINALITY AS b(data, ord) ON b.ord = m.ord
         RETURNING hseq
       ), upd AS (
         UPDATE documents d
            SET head_seq = ins.seq, content_updated_at = now(),
                history_seq = d.history_seq + $8::integer
           FROM ins
          WHERE d.id = $1::uuid AND d.workspace_id = $2::uuid
         RETURNING d.id
       )
       SELECT (SELECT generation FROM doc) AS generation,
              (SELECT head_seq FROM doc) AS "headSeq",
              (SELECT seq FROM ins) AS seq,
              (SELECT count(*) FROM upd) AS updated,
              (SELECT count(*) FROM hist) AS recorded`,
      [
        input.documentId,
        this.workspaceId,
        input.generation,
        input.expectedHeadSeq,
        bytes(input.update),
        JSON.stringify(history.map((segment) => segmentJson(segment, transactionId))),
        history.map((segment) => bytes(segment.update)),
        history.length,
      ],
    );
    const row = result.rows[0];
    if (!row || row.generation === null) {
      throw new GenerationMismatchError('document no longer exists');
    }
    if (Number(row.generation) !== input.generation) throw new GenerationMismatchError();
    if (row.seq === null) {
      throw new SequenceConflictError(
        `expected head_seq ${input.expectedHeadSeq}, found ${row.headSeq ?? 'none'}`,
      );
    }
    // bigint columns arrive as strings unless the driver was told otherwise.
    return Number(row.seq);
  }

  async compact(input: {
    documentId: string;
    generation: number;
    uptoSeq: number;
    state: Uint8Array;
    checkpoint?: HistoryCheckpoint;
  }): Promise<void> {
    const result = await this.db.query<CompactRow>(
      `WITH doc AS (
         SELECT id, generation, head_seq, history_seq, schema_version
           FROM documents
          WHERE id = $1::uuid AND workspace_id = $2::uuid
            FOR UPDATE
       ), ok AS (
         SELECT id FROM doc WHERE generation = $3::integer AND head_seq = $4::bigint
       ), up AS (
         INSERT INTO doc_states (document_id, generation, workspace_id, state, upto_seq, updated_at)
         SELECT ok.id, $3::integer, $2::uuid, $5::bytea, $4::bigint, now() FROM ok
         ON CONFLICT (document_id, generation)
         DO UPDATE SET state = EXCLUDED.state, upto_seq = EXCLUDED.upto_seq, updated_at = now()
         RETURNING document_id
       ), del AS (
         -- Only rows at or below the boundary; anything newer is untouched.
         DELETE FROM doc_updates u
          USING up
          WHERE u.document_id = up.document_id AND u.generation = $3::integer
            AND u.seq <= $4::bigint
         RETURNING u.seq
       ), cp AS (
         -- Optional history checkpoint: the same complete state, kept for good.
         INSERT INTO doc_history
           (document_id, hseq, workspace_id, generation, seq, kind, operation_type,
            actor_kind, actor_name, transaction_id, server_received_at,
            attachment_ids, schema_version, "update")
         SELECT doc.id, doc.history_seq + 1, $2::uuid, $3::integer, $4::bigint, 'checkpoint',
                $6::text, 'system', 'System', $8::uuid, clock_timestamp(),
                $7::uuid[], doc.schema_version, $5::bytea
           FROM doc JOIN up ON up.document_id = doc.id
          WHERE $6::text IS NOT NULL
         RETURNING hseq
       ), bump AS (
         UPDATE documents d SET history_seq = cp.hseq FROM cp
          WHERE d.id = $1::uuid AND d.workspace_id = $2::uuid
         RETURNING d.id
       )
       SELECT (SELECT generation FROM doc) AS generation,
              (SELECT head_seq FROM doc) AS "headSeq",
              (SELECT count(*) FROM up) AS stored,
              (SELECT count(*) FROM del) AS deleted,
              (SELECT count(*) FROM bump) AS checkpointed`,
      [
        input.documentId,
        this.workspaceId,
        input.generation,
        input.uptoSeq,
        bytes(input.state),
        input.checkpoint?.operationType ?? null,
        input.checkpoint?.attachmentIds ?? [],
        randomUUID(),
      ],
    );
    const row = result.rows[0];
    if (!row || row.generation === null) {
      throw new GenerationMismatchError('document no longer exists');
    }
    if (Number(row.generation) !== input.generation) throw new GenerationMismatchError();
    if (Number(row.stored) !== 1) {
      throw new SequenceConflictError(
        `compaction boundary ${input.uptoSeq} does not match head_seq ${row.headSeq ?? 'none'}`,
      );
    }
  }

  async baseline(input: {
    documentId: string;
    generation: number;
    headSeq: number;
    state: Uint8Array;
    attachmentIds: string[];
  }): Promise<void> {
    const result = await this.db.query<{
      generation: number | null;
      headSeq: number | string | null;
    }>(
      `WITH doc AS (
         SELECT id, generation, head_seq, history_seq, schema_version
           FROM documents
          WHERE id = $1::uuid AND workspace_id = $2::uuid
            FOR UPDATE
       ), cp AS (
         INSERT INTO doc_history
           (document_id, hseq, workspace_id, generation, seq, kind, operation_type,
            actor_kind, actor_name, transaction_id, server_received_at,
            attachment_ids, schema_version, "update")
         SELECT doc.id, doc.history_seq + 1, $2::uuid, doc.generation, doc.head_seq, 'checkpoint',
                'baseline', 'system', 'System', $7::uuid, clock_timestamp(),
                $6::uuid[], doc.schema_version, $5::bytea
           FROM doc
          WHERE doc.generation = $3::integer AND doc.head_seq = $4::bigint
            -- Nothing to do when the history already reaches the head of the log
            -- (another instance recorded the starting state first).
            AND NOT EXISTS (
              SELECT 1 FROM doc_history h
               WHERE h.document_id = doc.id AND h.generation = doc.generation
                 AND h.seq >= doc.head_seq)
         RETURNING hseq
       ), bump AS (
         UPDATE documents d SET history_seq = cp.hseq FROM cp
          WHERE d.id = $1::uuid AND d.workspace_id = $2::uuid
         RETURNING d.id
       )
       SELECT (SELECT generation FROM doc) AS generation,
              (SELECT head_seq FROM doc) AS "headSeq",
              (SELECT count(*) FROM bump) AS recorded`,
      [
        input.documentId,
        this.workspaceId,
        input.generation,
        input.headSeq,
        bytes(input.state),
        input.attachmentIds,
        randomUUID(),
      ],
    );
    const row = result.rows[0];
    if (!row || row.generation === null) {
      throw new GenerationMismatchError('document no longer exists');
    }
    if (Number(row.generation) !== input.generation) throw new GenerationMismatchError();
    if (Number(row.headSeq) !== input.headSeq) {
      throw new SequenceConflictError(
        `baseline expected head_seq ${input.headSeq}, found ${row.headSeq ?? 'none'}`,
      );
    }
  }
}
