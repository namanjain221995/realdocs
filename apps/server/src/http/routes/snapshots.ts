/**
 * Named snapshots and restore (docs/architecture.md §5.5). Restoring starts a
 * new document generation; nothing of the abandoned generation can be written
 * afterwards, and its last state is kept as an automatic `pre_restore` snapshot.
 */
import {
  CreateSnapshotRequest,
  DEFAULT_LIMITS,
  type RestoreSnapshotResponse,
  type SnapshotResponse,
  type SnapshotsResponse,
} from '@realtimedocs/contracts';
import { collectAssetIds } from '@realtimedocs/editor/export';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../../audit';
import { newId } from '../../auth/tokens';
import type { Queryable } from '../../db/pool';
import { SNAPSHOT_COLUMNS, type SnapshotRow } from '../../db/rows';
import { loadDurableState, toAccessInfo, toDocumentSummary } from '../../documents/store';
import { mergeToState, reencodeFresh, stateToJson } from '../../documents/ydoc';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { documentAccess, requireManage } from '../auth';
import { toApiSnapshot } from '../mappers';
import { param, parseInput, uuidParam } from '../util';

const MAX_NAMED_SNAPSHOTS = 200;

export function registerSnapshotRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const { db, workspace, config } = ctx;

  async function insertSnapshot(
    tx: Queryable,
    input: {
      documentId: string;
      name: string;
      kind: 'named' | 'pre_restore';
      generation: number;
      state: Uint8Array;
      createdBy: string | null;
    },
  ): Promise<SnapshotRow> {
    // Referenced assets are recorded so the cleanup job keeps them while the snapshot exists.
    const assetIds = collectAssetIds(stateToJson(input.state));
    const result = await tx.query<SnapshotRow>(
      `WITH s AS (
         INSERT INTO snapshots
           (id, workspace_id, document_id, name, kind, generation, state, size_bytes, asset_ids,
            created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10)
         RETURNING *
       )
       SELECT ${SNAPSHOT_COLUMNS} FROM s`,
      [
        newId(),
        workspace.id,
        input.documentId,
        input.name,
        input.kind,
        input.generation,
        Buffer.from(input.state.buffer, input.state.byteOffset, input.state.byteLength),
        input.state.byteLength,
        assetIds,
        input.createdBy,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('snapshot insert returned no row');
    return row;
  }

  app.get('/api/documents/:documentId/snapshots', async (request): Promise<SnapshotsResponse> => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    requireManage(access);
    const result = await db.query<SnapshotRow>(
      `SELECT ${SNAPSHOT_COLUMNS} FROM snapshots s
        WHERE s.document_id = $1 AND s.workspace_id = $2
        ORDER BY s.created_at DESC, s.id`,
      [access.document.id, workspace.id],
    );
    return { snapshots: result.rows.map(toApiSnapshot) };
  });

  app.post(
    '/api/documents/:documentId/snapshots',
    async (request, reply): Promise<SnapshotResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      requireManage(access);
      const body = parseInput(CreateSnapshotRequest, request.body);
      const document = access.document;

      // A snapshot records durable state; let acknowledged edits finish committing first.
      await ctx.collab.flushDocument(document.id, document.generation, 3_000);
      const row = await db.tx(async (tx) => {
        const count = await tx.query<{ count: number }>(
          `SELECT count(*) AS count FROM snapshots
            WHERE document_id = $1 AND workspace_id = $2 AND kind = 'named'`,
          [document.id, workspace.id],
        );
        if ((count.rows[0]?.count ?? 0) >= MAX_NAMED_SNAPSHOTS) {
          throw errors.conflict(
            `A document can keep up to ${MAX_NAMED_SNAPSHOTS} named snapshots. Delete one first.`,
          );
        }
        const durable = await loadDurableState(tx, workspace.id, document.id);
        if (!durable) throw errors.notFound();
        const snapshot = await insertSnapshot(tx, {
          documentId: document.id,
          name: body.name,
          kind: 'named',
          generation: durable.generation,
          state: mergeToState(durable.state, durable.updates),
          createdBy: access.actor.userId,
        });
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
          action: 'snapshot.created',
          targetType: 'snapshot',
          targetId: snapshot.id,
          details: { documentId: document.id, generation: durable.generation },
          requestId: request.id,
        });
        return snapshot;
      });
      reply.code(201);
      return { snapshot: toApiSnapshot(row) };
    },
  );

  app.post(
    '/api/documents/:documentId/snapshots/:snapshotId/restore',
    async (request): Promise<RestoreSnapshotResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      requireManage(access);
      const snapshotId = uuidParam(request, 'snapshotId');
      const documentId = access.document.id;
      if (access.document.status !== 'active') {
        throw errors.conflict('Unarchive the document before restoring a snapshot.');
      }

      // Best effort: let acknowledged edits commit so they are part of the pre-restore snapshot.
      await ctx.collab.flushDocument(documentId, access.document.generation, 3_000);

      const outcome = await db.tx(async (tx) => {
        // Locks the document row: from here until commit no update can be appended.
        const durable = await loadDurableState(tx, workspace.id, documentId, true);
        if (!durable) throw errors.notFound();
        if (durable.status !== 'active') {
          throw errors.conflict('Unarchive the document before restoring a snapshot.');
        }
        const found = await tx.query<{ name: string; state: Buffer }>(
          `SELECT name, state FROM snapshots
            WHERE id = $1 AND document_id = $2 AND workspace_id = $3`,
          [snapshotId, documentId, workspace.id],
        );
        const source = found.rows[0];
        if (!source) throw errors.notFound('That snapshot does not exist.');

        const preRestore = await insertSnapshot(tx, {
          documentId,
          name: `Before restoring "${source.name}"`.slice(0, DEFAULT_LIMITS.snapshotNameMaxLength),
          kind: 'pre_restore',
          generation: durable.generation,
          state: mergeToState(durable.state, durable.updates),
          createdBy: access.actor.userId,
        });

        // The new generation starts from a fresh Yjs history of the snapshot's
        // content, so it shares no struct ids with the abandoned generation.
        const oldGeneration = durable.generation;
        const newGeneration = oldGeneration + 1;
        const state = reencodeFresh(stateToJson(source.state), source.state);
        await tx.query(
          `UPDATE documents
              SET generation = $1, head_seq = 0, content_updated_at = now(), updated_at = now()
            WHERE id = $2 AND workspace_id = $3`,
          [newGeneration, documentId, workspace.id],
        );
        await tx.query(
          `INSERT INTO doc_states (document_id, generation, workspace_id, state, upto_seq)
           VALUES ($1, $2, $3, $4, 0)`,
          [documentId, newGeneration, workspace.id, Buffer.from(state)],
        );
        // The abandoned generation lives on only in the pre-restore snapshot.
        await tx.query('DELETE FROM doc_updates WHERE document_id = $1 AND generation <= $2', [
          documentId,
          oldGeneration,
        ]);
        await tx.query('DELETE FROM doc_states WHERE document_id = $1 AND generation <= $2', [
          documentId,
          oldGeneration,
        ]);
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
          action: 'snapshot.restored',
          targetType: 'snapshot',
          targetId: snapshotId,
          details: { documentId, fromGeneration: oldGeneration, toGeneration: newGeneration },
          requestId: request.id,
        });
        return { preRestore, oldGeneration, newGeneration, snapshotName: source.name };
      });

      // Tell the old room, close it, and make sure its queue can never be written.
      ctx.collab.announceGeneration(documentId, outcome.oldGeneration, outcome.newGeneration, {
        snapshotName: outcome.snapshotName,
        byName: access.actor.name,
      });

      const refreshed = await documentAccess(ctx, request, documentId);
      return {
        document: toDocumentSummary(
          refreshed.document,
          toAccessInfo(refreshed),
          config.retention.trashDays,
        ),
        preRestoreSnapshot: toApiSnapshot(outcome.preRestore),
      };
    },
  );

  app.delete('/api/documents/:documentId/snapshots/:snapshotId', async (request, reply) => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    requireManage(access);
    const snapshotId = uuidParam(request, 'snapshotId');
    await db.tx(async (tx) => {
      const removed = await tx.query(
        'DELETE FROM snapshots WHERE id = $1 AND document_id = $2 AND workspace_id = $3',
        [snapshotId, access.document.id, workspace.id],
      );
      if ((removed.rowCount ?? 0) === 0) throw errors.notFound('That snapshot does not exist.');
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
        action: 'snapshot.deleted',
        targetType: 'snapshot',
        targetId: snapshotId,
        details: { documentId: access.document.id },
        requestId: request.id,
      });
    });
    return reply.code(204).send();
  });
}
