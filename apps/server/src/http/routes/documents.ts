import {
  CreateDocumentRequest,
  DEFAULT_LIMITS,
  ListDocumentsQuery,
  UpdateDocumentRequest,
  type AccessInfo,
  type AccessListResponse,
  type DocumentResponse,
  type DocumentsResponse,
  type EffectiveRole,
} from '@realtimedocs/contracts';
import { collectAssetIds } from '@realtimedocs/editor/export';
import { NODE_ATTACHMENT, NODE_IMAGE, type DocJSON } from '@realtimedocs/editor/schema';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AccessGranted } from '../../access/resolve';
import { drainAssetDeletions, findReadyAssets } from '../../assets/service';
import { newStorageKey } from '../../assets/storage';
import { writeAudit } from '../../audit';
import { newId } from '../../auth/tokens';
import { DOCUMENT_COLUMNS, type DocumentRow } from '../../db/rows';
import {
  getDocument,
  insertDocument,
  loadDurableState,
  toAccessInfo,
  toDocumentSummary,
} from '../../documents/store';
import { encodeInitialState, pageSettingsFromState, stateToJson } from '../../documents/ydoc';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { documentAccess, requireAccount, requireAdmin, requireManage } from '../auth';
import { parseInput, param } from '../util';
import { listMembers } from './members';
import { listShares } from './shares';

const DEFAULT_TITLE = 'Untitled document';
const LIST_LIMIT = 500;
const RECENT_LIMIT = 12;

/** Escapes LIKE wildcards so a search term is matched literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Replaces asset ids in image and attachment nodes; returns a deep copy. */
export function rewriteAssetIds(node: DocJSON, mapping: ReadonlyMap<string, string>): DocJSON {
  const copy: DocJSON = { ...node };
  if (node.attrs) copy.attrs = { ...node.attrs };
  if ((node.type === NODE_IMAGE || node.type === NODE_ATTACHMENT) && copy.attrs) {
    const current = copy.attrs.assetId;
    if (typeof current === 'string' && mapping.has(current)) {
      copy.attrs.assetId = mapping.get(current);
    }
    // An upload that was still in flight in the source can never finish in the copy.
    copy.attrs.uploadId = null;
  }
  if (node.content) copy.content = node.content.map((child) => rewriteAssetIds(child, mapping));
  return copy;
}

export function registerDocumentRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const { db, workspace, config, storage } = ctx;
  const trashDays = config.retention.trashDays;

  const summarize = (access: AccessGranted) =>
    toDocumentSummary(access.document, toAccessInfo(access), trashDays);

  /** Fresh summary after a mutation (status changes also change the effective role). */
  async function respond(request: FastifyRequest, documentId: string): Promise<DocumentResponse> {
    const access = await documentAccess(ctx, request, documentId, { allowTrashed: true });
    return { document: summarize(access) };
  }

  app.get('/api/documents', async (request): Promise<DocumentsResponse> => {
    const { user, session } = await requireAccount(ctx, request);
    const query = parseInput(ListDocumentsQuery, request.query);
    const status =
      query.view === 'archived' ? 'archived' : query.view === 'trash' ? 'trashed' : 'active';
    const isAdmin = user.role === 'admin';
    // The trash is an administrator view; members never see trashed documents.
    if (status === 'trashed' && !isAdmin) return { documents: [] };

    const params: unknown[] = [workspace.id, status];
    let search = '';
    if (query.q) {
      params.push(likePattern(query.q));
      search = `AND d.title ILIKE $${params.length} ESCAPE '\\'`;
    }
    const order =
      query.view === 'recent'
        ? `ORDER BY GREATEST(d.content_updated_at, d.updated_at) DESC, d.id LIMIT ${RECENT_LIMIT}`
        : query.view === 'trash'
          ? `ORDER BY d.trashed_at DESC NULLS LAST, d.id LIMIT ${LIST_LIMIT}`
          : `ORDER BY d.updated_at DESC, d.id LIMIT ${LIST_LIMIT}`;

    let rows: (DocumentRow & { memberRole?: 'viewer' | 'editor' })[];
    if (isAdmin) {
      const result = await db.query<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM documents d
          WHERE d.workspace_id = $1 AND d.status = $2 ${search} ${order}`,
        params,
      );
      rows = result.rows;
    } else {
      params.push(user.id);
      const result = await db.query<DocumentRow & { memberRole: 'viewer' | 'editor' }>(
        `SELECT ${DOCUMENT_COLUMNS}, m.role AS "memberRole"
           FROM documents d
           JOIN document_members m
             ON m.document_id = d.id AND m.workspace_id = d.workspace_id AND m.user_id = $${params.length}
          WHERE d.workspace_id = $1 AND d.status = $2 ${search} ${order}`,
        params,
      );
      rows = result.rows;
    }

    const documents = rows.map((row) => {
      const granted: EffectiveRole = isAdmin ? 'admin' : (row.memberRole ?? 'viewer');
      const access: AccessInfo = {
        // Same cap as resolveAccess: only active documents can be edited.
        role: row.status === 'active' ? granted : 'viewer',
        via: isAdmin ? 'workspace_admin' : 'membership',
        expiresAt: session.expiresAt.toISOString(),
        accountId: user.id,
      };
      return toDocumentSummary(row, access, trashDays);
    });
    return { documents };
  });

  app.post('/api/documents', async (request, reply): Promise<DocumentResponse> => {
    const admin = await requireAdmin(ctx, request);
    const body = parseInput(CreateDocumentRequest, request.body);
    const created = await db.tx(async (tx) => {
      // The initial Yjs state is created here, once, together with the row.
      const row = await insertDocument(tx, {
        workspaceId: workspace.id,
        title: body.title ?? DEFAULT_TITLE,
        createdBy: admin.user.id,
      });
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: admin.user.id, name: admin.user.displayName },
        action: 'document.created',
        targetType: 'document',
        targetId: row.id,
        requestId: request.id,
      });
      return row;
    });
    reply.code(201);
    return respond(request, created.id);
  });

  app.get('/api/documents/:documentId', async (request): Promise<DocumentResponse> => {
    return respond(request, param(request, 'documentId'));
  });

  app.patch('/api/documents/:documentId', async (request): Promise<DocumentResponse> => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    requireManage(access);
    const body = parseInput(UpdateDocumentRequest, request.body);
    const id = access.document.id;
    await db.tx(async (tx) => {
      await tx.query(
        'UPDATE documents SET title = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3',
        [body.title, id, workspace.id],
      );
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
        action: 'document.renamed',
        targetType: 'document',
        targetId: id,
        requestId: request.id,
      });
    });
    return respond(request, id);
  });

  app.post('/api/documents/:documentId/duplicate', async (request, reply) => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    requireManage(access);
    const source = access.document;

    // Copy what is durable: give in-flight edits a moment to commit first.
    await ctx.collab.flushDocument(source.id, source.generation, 3_000);
    const durable = await loadDurableState(db, workspace.id, source.id);
    if (!durable) throw errors.notFound();
    const json = stateToJson(durable.state, durable.updates);
    const assets = await findReadyAssets(db, workspace.id, source.id, collectAssetIds(json));
    const copies = assets.map((asset) => ({ asset, id: newId(), key: newStorageKey() }));
    const keys = copies.map((copy) => copy.key);

    // Register the new files before they exist, so a crash cannot leak them.
    if (keys.length > 0) {
      await db.query(
        `INSERT INTO asset_deletions (storage_key, not_before)
         SELECT key, now() + interval '1 hour' FROM unnest($1::text[]) AS key`,
        [keys],
      );
    }
    let created: DocumentRow;
    try {
      for (const copy of copies) await storage.copy(copy.asset.storageKey, copy.key);
      const mapping = new Map(copies.map((copy) => [copy.asset.id, copy.id]));
      // A new Yjs history: the copy shares nothing with the source document.
      const state = encodeInitialState(
        rewriteAssetIds(json, mapping),
        false,
        pageSettingsFromState(durable.state, durable.updates),
      );
      const title = `Copy of ${source.title}`.slice(0, DEFAULT_LIMITS.titleMaxLength);

      created = await db.tx(async (tx) => {
        const row = await insertDocument(tx, {
          workspaceId: workspace.id,
          title,
          createdBy: access.actor.userId,
          state,
        });
        for (const copy of copies) {
          await tx.query(
            `INSERT INTO assets
               (id, workspace_id, document_id, kind, storage_key, name, mime, size_bytes, width,
                height, sha256, status, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ready', $12)`,
            [
              copy.id,
              workspace.id,
              row.id,
              copy.asset.kind,
              copy.key,
              copy.asset.name,
              copy.asset.mime,
              copy.asset.sizeBytes,
              copy.asset.width,
              copy.asset.height,
              copy.asset.sha256,
              access.actor.userId,
            ],
          );
        }
        await tx.query('DELETE FROM asset_deletions WHERE storage_key = ANY($1::text[])', [keys]);
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
          action: 'document.duplicated',
          targetType: 'document',
          targetId: row.id,
          details: { sourceId: source.id, assetsCopied: copies.length },
          requestId: request.id,
        });
        return row;
      });
    } catch (error) {
      // Nothing references the copied files; remove them and their queue entries now.
      for (const key of keys) await storage.remove(key).catch(() => undefined);
      await db
        .query('DELETE FROM asset_deletions WHERE storage_key = ANY($1::text[])', [keys])
        .catch(() => undefined);
      throw error;
    }
    reply.code(201);
    return respond(request, created.id);
  });

  type Lifecycle = 'archive' | 'unarchive' | 'trash' | 'restore';
  const LIFECYCLE_AUDIT: Record<Lifecycle, string> = {
    archive: 'document.archived',
    unarchive: 'document.unarchived',
    trash: 'document.trashed',
    restore: 'document.restored_from_trash',
  };

  async function lifecycle(request: FastifyRequest, action: Lifecycle): Promise<DocumentResponse> {
    const access = await documentAccess(ctx, request, param(request, 'documentId'), {
      allowTrashed: true,
    });
    requireManage(access);
    const id = access.document.id;

    await db.tx(async (tx) => {
      const locked = await tx.query<{ status: DocumentRow['status']; archivedAt: Date | null }>(
        `SELECT status, archived_at AS "archivedAt" FROM documents
          WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [id, workspace.id],
      );
      const current = locked.rows[0];
      if (!current) throw errors.notFound();
      const { status } = current;

      if (action === 'archive') {
        if (status === 'trashed') throw errors.documentTrashed();
        if (status === 'archived') return;
        await tx.query(
          `UPDATE documents SET status = 'archived', archived_at = now(), updated_at = now()
            WHERE id = $1`,
          [id],
        );
      } else if (action === 'unarchive') {
        if (status === 'trashed') throw errors.documentTrashed();
        if (status === 'active') return;
        await tx.query(
          `UPDATE documents SET status = 'active', archived_at = NULL, updated_at = now()
            WHERE id = $1`,
          [id],
        );
      } else if (action === 'trash') {
        if (status === 'trashed') return;
        // archived_at is kept so "restore" can return the document to where it was.
        await tx.query(
          `UPDATE documents SET status = 'trashed', trashed_at = now(), updated_at = now()
            WHERE id = $1`,
          [id],
        );
      } else {
        if (status !== 'trashed') return;
        await tx.query(
          `UPDATE documents
              SET status = CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END,
                  trashed_at = NULL, updated_at = now()
            WHERE id = $1`,
          [id],
        );
      }
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
        action: LIFECYCLE_AUDIT[action],
        targetType: 'document',
        targetId: id,
        details: { from: status },
        requestId: request.id,
      });
    });

    // Open connections become read-only (archive), editable again (unarchive)
    // or are closed (trash).
    await ctx.collab.reevaluateDocument(id);
    return respond(request, id);
  }

  app.post('/api/documents/:documentId/archive', (request) => lifecycle(request, 'archive'));
  app.post('/api/documents/:documentId/unarchive', (request) => lifecycle(request, 'unarchive'));
  app.post('/api/documents/:documentId/trash', (request) => lifecycle(request, 'trash'));
  app.post('/api/documents/:documentId/restore', (request) => lifecycle(request, 'restore'));

  app.delete('/api/documents/:documentId', async (request, reply) => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'), {
      allowTrashed: true,
    });
    requireManage(access);
    const id = access.document.id;
    await db.tx(async (tx) => {
      const current = await getDocument(tx, workspace.id, id);
      if (!current) throw errors.notFound();
      if (current.status !== 'trashed') {
        throw errors.conflict('Move the document to the trash before deleting it permanently.');
      }
      await tx.query(
        `INSERT INTO asset_deletions (storage_key)
         SELECT storage_key FROM assets WHERE document_id = $1 AND workspace_id = $2
         ON CONFLICT DO NOTHING`,
        [id, workspace.id],
      );
      await tx.query('DELETE FROM documents WHERE id = $1 AND workspace_id = $2', [
        id,
        workspace.id,
      ]);
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
        action: 'document.deleted',
        targetType: 'document',
        targetId: id,
        requestId: request.id,
      });
    });
    await ctx.collab.reevaluateDocument(id);
    // The rows are gone; now the bytes. Anything that fails here is retried by cleanup.
    await drainAssetDeletions(db, storage).catch((err: unknown) => {
      request.log.warn({ err }, 'asset files of a deleted document could not be removed yet');
    });
    return reply.code(204).send();
  });

  app.get('/api/documents/:documentId/access', async (request): Promise<AccessListResponse> => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    requireManage(access);
    const id = access.document.id;
    const [members, shares] = await Promise.all([listMembers(ctx, id), listShares(ctx, id)]);
    return { members, shares, live: ctx.collab.liveParticipants(id) };
  });
}
