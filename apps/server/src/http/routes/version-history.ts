/**
 * The version history document for signed-in administrators (docs/version-history.md):
 * `doc.txt` or JSON, the list of images, one image, and the archive. The same rights as the
 * rest of the version history: manage rights on the document. Every export is audited.
 */
import { VersionHistoryGroupingQuery, VersionHistoryQuery } from '@realtimedocs/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { writeAudit } from '../../audit';
import {
  RawResponse,
  versionHistoryArchive,
  versionHistoryDocument,
  versionHistoryImage,
  versionHistoryImages,
  type VersionHistoryTarget,
} from '../../history/version-history-responses';
import type { RouteDeps } from '../app';
import { documentAccess, requireManage } from '../auth';
import { param, parseInput, uuidParam } from '../util';

/** Sends a text, file or stream answer with the headers every download gets. */
export function sendRaw(reply: FastifyReply, raw: RawResponse): FastifyReply {
  reply.header('x-content-type-options', 'nosniff');
  for (const [name, value] of Object.entries(raw.headers)) reply.header(name, value);
  return reply.type(raw.contentType).send(raw.body);
}

export function registerVersionHistoryRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const { db, workspace } = ctx;

  async function manage(request: FastifyRequest) {
    const access = await documentAccess(ctx, request, param(request, 'documentId'), {
      allowTrashed: true,
    });
    requireManage(access);
    return access;
  }

  function targetOf(access: Awaited<ReturnType<typeof manage>>): VersionHistoryTarget {
    return {
      document: { id: access.document.id, title: access.document.title },
      imageUrlPrefix: `/api/documents/${access.document.id}/version-history/images/`,
    };
  }

  async function audit(
    access: Awaited<ReturnType<typeof manage>>,
    request: FastifyRequest,
    format: string,
  ): Promise<void> {
    await writeAudit(db, {
      workspaceId: workspace.id,
      actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
      action: 'history.exported',
      targetType: 'document',
      targetId: access.document.id,
      details: { format },
      requestId: request.id,
    });
  }

  app.get('/api/documents/:documentId/version-history', async (request, reply) => {
    const access = await manage(request);
    const query = parseInput(VersionHistoryQuery, request.query);
    const result = await versionHistoryDocument(ctx, targetOf(access), query);
    await audit(access, request, `version-history-${query.format}`);
    if (result instanceof RawResponse) return sendRaw(reply, result);
    reply.header('cache-control', 'private, no-cache');
    return result;
  });

  app.get('/api/documents/:documentId/version-history/images', async (request, reply) => {
    const access = await manage(request);
    const query = parseInput(VersionHistoryGroupingQuery, request.query);
    reply.header('cache-control', 'private, no-cache');
    return versionHistoryImages(ctx, targetOf(access), query);
  });

  app.get('/api/documents/:documentId/version-history/images/:imageId', async (request, reply) => {
    const access = await manage(request);
    const imageId = uuidParam(request, 'imageId');
    return sendRaw(reply, await versionHistoryImage(ctx, access.document.id, imageId));
  });

  app.get('/api/documents/:documentId/version-history/archive', async (request, reply) => {
    const access = await manage(request);
    const query = parseInput(VersionHistoryGroupingQuery, request.query);
    const archive = await versionHistoryArchive(ctx, targetOf(access), query, (err) =>
      request.log.error({ err, documentId: access.document.id }, 'version history archive failed'),
    );
    await audit(access, request, 'version-history-archive');
    return sendRaw(reply, archive);
  });
}
