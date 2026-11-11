/**
 * PostgreSQL implementation of the durable update log.
 *
 * Each call is ONE statement and therefore one transaction: it locks the
 * `documents` row, verifies generation and head sequence, writes, and moves
 * `head_seq`. A statement that finds a different generation or head sequence
 * writes nothing at all.
 */
import type { Queryable } from '../db/pool';
import { GenerationMismatchError, SequenceConflictError, type LogStore } from './durable-log';

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
  }): Promise<number> {
    const result = await this.db.query<AppendRow>(
      `WITH doc AS (
         SELECT id, generation, head_seq
           FROM documents
          WHERE id = $1::uuid AND workspace_id = $2::uuid
            FOR UPDATE
       ), ins AS (
         INSERT INTO doc_updates (document_id, generation, seq, workspace_id, "update")
         SELECT doc.id, doc.generation, doc.head_seq + 1, $2::uuid, $5::bytea
           FROM doc
          WHERE doc.generation = $3::integer AND doc.head_seq = $4::bigint
         RETURNING seq
       ), upd AS (
         UPDATE documents d
            SET head_seq = ins.seq, content_updated_at = now()
           FROM ins
          WHERE d.id = $1::uuid AND d.workspace_id = $2::uuid
         RETURNING d.id
       )
       SELECT (SELECT generation FROM doc) AS generation,
              (SELECT head_seq FROM doc) AS "headSeq",
              (SELECT seq FROM ins) AS seq,
              (SELECT count(*) FROM upd) AS updated`,
      [
        input.documentId,
        this.workspaceId,
        input.generation,
        input.expectedHeadSeq,
        Buffer.from(input.update.buffer, input.update.byteOffset, input.update.byteLength),
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
  }): Promise<void> {
    const result = await this.db.query<CompactRow>(
      `WITH doc AS (
         SELECT id, generation, head_seq
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
       )
       SELECT (SELECT generation FROM doc) AS generation,
              (SELECT head_seq FROM doc) AS "headSeq",
              (SELECT count(*) FROM up) AS stored,
              (SELECT count(*) FROM del) AS deleted`,
      [
        input.documentId,
        this.workspaceId,
        input.generation,
        input.uptoSeq,
        Buffer.from(input.state.buffer, input.state.byteOffset, input.state.byteLength),
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
}
