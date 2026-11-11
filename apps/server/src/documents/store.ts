/** Database access for document rows and their durable collaborative state. */
import {
  DOCUMENT_SCHEMA_VERSION,
  type AccessInfo,
  type DocumentSummary,
} from '@realtimedocs/contracts';
import type { DocJSON } from '@realtimedocs/editor/schema';
import type { AccessGranted } from '../access/resolve';
import { newId } from '../auth/tokens';
import type { Queryable } from '../db/pool';
import { DOCUMENT_COLUMNS, type DocumentRow } from '../db/rows';
import { encodeInitialState } from './ydoc';

export class LogCorruptError extends Error {
  constructor(documentId: string, detail: string) {
    super(`update log of document ${documentId} is not contiguous: ${detail}`);
    this.name = 'LogCorruptError';
  }
}

export interface DurableState {
  generation: number;
  headSeq: number;
  uptoSeq: number;
  status: DocumentRow['status'];
  /** Compacted state covering every update with seq <= uptoSeq. */
  state: Uint8Array | null;
  /** Updates uptoSeq + 1 … headSeq, in order. */
  updates: Uint8Array[];
}

interface DurableRow {
  generation: number;
  headSeq: number;
  uptoSeq: number;
  status: DocumentRow['status'];
  state: Buffer | null;
  updates: Buffer[] | null;
  seqs: (string | number)[] | null;
}

/**
 * Reads the durable collaborative state of a document's current generation in
 * one statement, i.e. from one consistent snapshot. `forUpdate` additionally
 * locks the document row (use inside a transaction that changes generations).
 */
export async function loadDurableState(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  forUpdate = false,
): Promise<DurableState | null> {
  if (forUpdate) {
    await db.query('SELECT 1 FROM documents WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [
      documentId,
      workspaceId,
    ]);
  }
  const result = await db.query<DurableRow>(
    `SELECT d.generation, d.head_seq AS "headSeq", d.status,
            s.state, COALESCE(s.upto_seq, 0) AS "uptoSeq",
            u.updates, u.seqs
       FROM documents d
       LEFT JOIN doc_states s ON s.document_id = d.id AND s.generation = d.generation
       LEFT JOIN LATERAL (
         SELECT array_agg(x."update" ORDER BY x.seq) AS updates,
                array_agg(x.seq ORDER BY x.seq) AS seqs
           FROM doc_updates x
          WHERE x.document_id = d.id AND x.generation = d.generation
            AND x.seq > COALESCE(s.upto_seq, 0)
       ) u ON true
      WHERE d.id = $1 AND d.workspace_id = $2`,
    [documentId, workspaceId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const updates = row.updates ?? [];
  const seqs = (row.seqs ?? []).map(Number);
  seqs.forEach((seq, index) => {
    if (seq !== row.uptoSeq + index + 1) {
      throw new LogCorruptError(
        documentId,
        `expected seq ${row.uptoSeq + index + 1}, found ${seq}`,
      );
    }
  });
  if (row.uptoSeq + seqs.length !== row.headSeq) {
    throw new LogCorruptError(
      documentId,
      `head_seq is ${row.headSeq} but the log ends at ${row.uptoSeq + seqs.length}`,
    );
  }
  return {
    generation: row.generation,
    headSeq: row.headSeq,
    uptoSeq: row.uptoSeq,
    status: row.status,
    state: row.state,
    updates,
  };
}

export async function getDocument(
  db: Queryable,
  workspaceId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  const result = await db.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents d WHERE d.id = $1 AND d.workspace_id = $2`,
    [documentId, workspaceId],
  );
  return result.rows[0] ?? null;
}

export interface NewDocument {
  workspaceId: string;
  title: string;
  createdBy: string | null;
  /** Initial content; the Yjs state is created here, exactly once. */
  content?: DocJSON;
  /** Pre-encoded initial state (takes precedence over `content`). */
  state?: Uint8Array;
}

/** Inserts the document row and its initial Yjs state. Call inside a transaction. */
export async function insertDocument(db: Queryable, input: NewDocument): Promise<DocumentRow> {
  const id = newId();
  const state = input.state ?? encodeInitialState(input.content);
  await db.query(
    `INSERT INTO documents (id, workspace_id, title, schema_version, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.workspaceId, input.title, DOCUMENT_SCHEMA_VERSION, input.createdBy],
  );
  await db.query(
    `INSERT INTO doc_states (document_id, generation, workspace_id, state, upto_seq)
     VALUES ($1, 1, $2, $3, 0)`,
    [id, input.workspaceId, Buffer.from(state)],
  );
  const row = await getDocument(db, input.workspaceId, id);
  if (!row) throw new Error('document insert returned no row');
  return row;
}

export function toAccessInfo(access: AccessGranted): AccessInfo {
  return {
    role: access.role,
    via: access.via,
    expiresAt: access.expiresAt ? access.expiresAt.toISOString() : null,
    accountId: access.accountId,
  };
}

export function toDocumentSummary(
  row: DocumentRow,
  access: AccessInfo,
  trashRetentionDays: number,
): DocumentSummary {
  const purgeAfter =
    row.status === 'trashed' && row.trashedAt
      ? new Date(row.trashedAt.getTime() + trashRetentionDays * 86_400_000).toISOString()
      : null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    generation: row.generation,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contentUpdatedAt: row.contentUpdatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    trashedAt: row.trashedAt ? row.trashedAt.toISOString() : null,
    purgeAfter,
    createdByName: row.createdByName,
    access,
  };
}
