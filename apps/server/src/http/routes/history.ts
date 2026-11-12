/**
 * Version history for administrators (docs/version-history.md).
 *
 * Reading the history of a document shows who did what and, in a revision's
 * diff and preview, document text. Every route therefore requires manage
 * rights on the document, and looking at a revision, exporting and restoring
 * are themselves written to the audit trail.
 *
 * Restoring never rewrites history: "name" stores the revision as a named
 * snapshot, which the existing snapshot restore turns into a new generation
 * (the head moves forward; every earlier row stays), and "copy" creates a new
 * document from the revision.
 */
import {
  CopyRevisionRequest,
  DEFAULT_LIMITS,
  HistoryQuery,
  NameRevisionRequest,
  type CopyRevisionResponse,
  type HistoryResponse,
  type HistoryRevisionResponse,
  type SnapshotResponse,
} from '@realtimedocs/contracts';
import { collectAssetIds, toMarkdown, toPlainText } from '@realtimedocs/editor/export';
import { EMPTY_DOCUMENT } from '@realtimedocs/editor/schema';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tryAudit, writeAudit } from '../../audit';
import { newId } from '../../auth/tokens';
import { SNAPSHOT_COLUMNS, type SnapshotRow } from '../../db/rows';
import { insertDocument } from '../../documents/store';
import { errors } from '../../errors';
import { diffDocuments } from '../../history/diff';
import {
  getHistoryEntry,
  listDocumentEvents,
  listHistory,
  previousRevision,
  rebuildRevision,
} from '../../history/service';
import type { RouteDeps } from '../app';
import { documentAccess, requireManage } from '../auth';
import { toApiSnapshot } from '../mappers';
import { param, parseInput } from '../util';

const MAX_NAMED_SNAPSHOTS = 200;
const EXPORT_MAX_ROWS = 50_000;

const ExportQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });
const RevisionExportQuery = z.object({
  format: z.enum(['json', 'markdown', 'text']).default('json'),
});

function revisionParam(request: FastifyRequest): number {
  const raw = param(request, 'revision');
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) throw errors.notFound();
  return Number(raw);
}

/** A CSV cell that a spreadsheet will not run as a formula. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function registerHistoryRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const { db, workspace, config, logger } = ctx;

  async function manage(request: FastifyRequest) {
    const access = await documentAccess(ctx, request, param(request, 'documentId'), {
      allowTrashed: true,
    });
    requireManage(access);
    return access;
  }

  const actorOf = (access: Awaited<ReturnType<typeof manage>>) =>
    ({ kind: 'user', userId: access.actor.userId, name: access.actor.name }) as const;

  app.get('/api/documents/:documentId/history', async (request): Promise<HistoryResponse> => {
    const access = await manage(request);
    const query = parseInput(HistoryQuery, request.query);
    const [page, events] = await Promise.all([
      listHistory(db, workspace.id, access.document.id, query),
      query.before === undefined
        ? listDocumentEvents(db, workspace.id, access.document.id, 200)
        : Promise.resolve([]),
    ]);
    if (query.before === undefined) {
      await tryAudit(db, logger, {
        workspaceId: workspace.id,
        actor: actorOf(access),
        action: 'history.viewed',
        targetType: 'document',
        targetId: access.document.id,
        requestId: request.id,
      });
    }
    return { ...page, events, retentionDays: config.history.retentionDays };
  });

  // Registered before `/:revision` so that "export" is never read as a revision.
  app.get('/api/documents/:documentId/history/export', async (request, reply) => {
    const access = await manage(request);
    const { format } = parseInput(ExportQuery, request.query);
    const { entries } = await listHistory(db, workspace.id, access.document.id, {
      limit: 200,
    });
    // Page through everything retained (newest first), up to a fixed ceiling.
    const all = [...entries];
    let before = all.at(-1)?.revision;
    while (before !== undefined && all.length < EXPORT_MAX_ROWS) {
      const next = await listHistory(db, workspace.id, access.document.id, { limit: 200, before });
      if (next.entries.length === 0) break;
      all.push(...next.entries);
      before = next.nextBefore ?? undefined;
    }
    await writeAudit(db, {
      workspaceId: workspace.id,
      actor: actorOf(access),
      action: 'history.exported',
      targetType: 'document',
      targetId: access.document.id,
      details: { format, rows: all.length },
      requestId: request.id,
    });
    const name = `history-${access.document.id}`;
    reply.header('x-content-type-options', 'nosniff');
    if (format === 'json') {
      reply.header('content-type', 'application/json; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${name}.json"`);
      return { documentId: access.document.id, exportedAt: new Date().toISOString(), entries: all };
    }
    const header = [
      'revision',
      'generation',
      'operation',
      'actor_kind',
      'actor_name',
      'actor_role',
      'actor_user_id',
      'session_id',
      'connection_id',
      'server_received_at',
      'server_committed_at',
      'client_occurred_at',
      'content_size_delta',
      'inserted_chars',
      'deleted_chars',
      'attachments_added',
      'attachments_removed',
      'transaction_id',
    ];
    const lines = all.map((entry) =>
      [
        entry.revision,
        entry.generation,
        entry.operation,
        entry.actor.kind,
        entry.actor.name,
        entry.actor.role,
        entry.actor.userId,
        entry.actor.sessionId,
        entry.actor.connectionId,
        entry.receivedAt,
        entry.committedAt,
        entry.clientOccurredAt,
        entry.contentSizeDelta,
        entry.summary.insertedChars ?? 0,
        entry.summary.deletedChars ?? 0,
        (entry.summary.attachmentsAdded ?? []).join(' '),
        (entry.summary.attachmentsRemoved ?? []).join(' '),
        entry.transactionId,
      ]
        .map(csvCell)
        .join(','),
    );
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${name}.csv"`);
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  });

  app.get(
    '/api/documents/:documentId/history/:revision',
    async (request): Promise<HistoryRevisionResponse> => {
      const access = await manage(request);
      const revision = revisionParam(request);
      const documentId = access.document.id;
      const entry = await getHistoryEntry(db, workspace.id, documentId, revision);
      const after = await rebuildRevision(db, workspace.id, documentId, revision);
      const previous = await previousRevision(
        db,
        workspace.id,
        documentId,
        revision,
        entry.generation,
      );
      const before =
        previous === null ? null : await rebuildRevision(db, workspace.id, documentId, previous);
      const diff = diffDocuments(before?.content ?? EMPTY_DOCUMENT, after.content);
      await tryAudit(db, logger, {
        workspaceId: workspace.id,
        actor: actorOf(access),
        action: 'history.revision_viewed',
        targetType: 'document',
        targetId: documentId,
        details: { revision },
        requestId: request.id,
      });
      return {
        entry,
        diff: diff.lines,
        diffTruncated: diff.truncated,
        content: after.content,
        pageSettings: after.pageSettings,
      };
    },
  );

  app.get('/api/documents/:documentId/history/:revision/export', async (request, reply) => {
    const access = await manage(request);
    const revision = revisionParam(request);
    const { format } = parseInput(RevisionExportQuery, request.query);
    const state = await rebuildRevision(db, workspace.id, access.document.id, revision);
    await writeAudit(db, {
      workspaceId: workspace.id,
      actor: actorOf(access),
      action: 'history.revision_exported',
      targetType: 'document',
      targetId: access.document.id,
      details: { revision, format },
      requestId: request.id,
    });
    const name = `revision-${revision}`;
    reply.header('x-content-type-options', 'nosniff');
    if (format === 'json') {
      reply.header('content-type', 'application/json; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${name}.json"`);
      return { revision, content: state.content, pageSettings: state.pageSettings };
    }
    reply.header('content-type', 'text/plain; charset=utf-8');
    reply.header(
      'content-disposition',
      `attachment; filename="${name}.${format === 'markdown' ? 'md' : 'txt'}"`,
    );
    return format === 'markdown' ? toMarkdown(state.content) : toPlainText(state.content);
  });

  // Keeps a revision as a named version (a snapshot), which can then be restored.
  app.post(
    '/api/documents/:documentId/history/:revision/name',
    async (request, reply): Promise<SnapshotResponse> => {
      const access = await manage(request);
      const revision = revisionParam(request);
      const body = parseInput(NameRevisionRequest, request.body);
      const documentId = access.document.id;
      const state = await rebuildRevision(db, workspace.id, documentId, revision);
      const row = await db.tx(async (tx) => {
        const count = await tx.query<{ n: string }>(
          `SELECT count(*) AS n FROM snapshots
            WHERE document_id = $1 AND workspace_id = $2 AND kind = 'named'`,
          [documentId, workspace.id],
        );
        if (Number(count.rows[0]?.n ?? 0) >= MAX_NAMED_SNAPSHOTS) {
          throw errors.conflict('This document has the maximum number of named versions.');
        }
        const inserted = await tx.query<SnapshotRow>(
          `WITH s AS (
             INSERT INTO snapshots
               (id, workspace_id, document_id, name, kind, generation, state, size_bytes,
                asset_ids, created_by)
             VALUES ($1, $2, $3, $4, 'named', $5, $6, $7, $8::uuid[], $9)
             RETURNING *
           )
           SELECT ${SNAPSHOT_COLUMNS} FROM s`,
          [
            newId(),
            workspace.id,
            documentId,
            body.name.slice(0, DEFAULT_LIMITS.snapshotNameMaxLength),
            state.generation,
            Buffer.from(state.state),
            state.state.byteLength,
            // Kept by the asset cleanup for as long as the named version exists.
            collectAssetIds(state.content),
            access.actor.userId,
          ],
        );
        const snapshot = inserted.rows[0];
        if (!snapshot) throw new Error('snapshot insert returned no row');
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: actorOf(access),
          action: 'history.revision_named',
          targetType: 'snapshot',
          targetId: snapshot.id,
          details: { documentId, revision },
          requestId: request.id,
        });
        return snapshot;
      });
      reply.code(201);
      return { snapshot: toApiSnapshot(row) };
    },
  );

  // A new document with the content of the revision; the source is untouched.
  app.post(
    '/api/documents/:documentId/history/:revision/copy',
    async (request, reply): Promise<CopyRevisionResponse> => {
      const access = await manage(request);
      const revision = revisionParam(request);
      const body = parseInput(CopyRevisionRequest, request.body ?? {});
      const documentId = access.document.id;
      const state = await rebuildRevision(db, workspace.id, documentId, revision);
      const title = (body.title ?? `${access.document.title} (revision ${revision})`).slice(
        0,
        DEFAULT_LIMITS.titleMaxLength,
      );
      const created = await db.tx(async (tx) => {
        const document = await insertDocument(tx, {
          workspaceId: workspace.id,
          title,
          createdBy: access.actor.userId,
          // The complete state, so page settings travel with the content.
          state: state.state,
        });
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: actorOf(access),
          action: 'history.revision_copied',
          targetType: 'document',
          targetId: document.id,
          details: { documentId, revision },
          requestId: request.id,
        });
        return document;
      });
      reply.code(201);
      return { documentId: created.id, title: created.title };
    },
  );
}
