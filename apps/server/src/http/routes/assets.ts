import type { AssetResponse } from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { contentDisposition } from '../../assets/filename';
import { findReadyAsset, maxUploadBytes, storeUpload, toApiAsset } from '../../assets/service';
import { tryAudit } from '../../audit';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { documentAccess, requireEdit } from '../auth';
import { param, uuidParam } from '../util';

/**
 * Applied to every asset response. Nothing an uploaded file contains may run
 * or load anything, even if it is opened directly in a browser tab.
 */
const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** Multipart framing (boundaries, part headers) on top of the file bytes. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export function registerAssetRoutes(app: FastifyInstance, { ctx, limits }: RouteDeps): void {
  const { db, workspace, config, storage } = ctx;
  const uploadCap = maxUploadBytes(config.limits);

  // multipart/form-data with one part named `file`. Requires edit access.
  app.post('/api/documents/:documentId/assets', async (request, reply): Promise<AssetResponse> => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    requireEdit(access);
    await limits.upload.consume(request, access.actor.sessionId).catch((error: unknown) => {
      ctx.metrics.uploads.inc({ outcome: 'rate_limited' });
      throw error;
    });

    if (!request.isMultipart()) {
      throw errors.unsupportedMediaType('Uploads must be sent as multipart/form-data.');
    }
    // Refuse obviously oversized requests before reading them.
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > uploadCap + MULTIPART_OVERHEAD_BYTES) {
      throw errors.payloadTooLarge(
        `The file is larger than the ${Math.round(uploadCap / (1024 * 1024))} MB upload limit.`,
        'too_large',
      );
    }

    // One byte above the cap, so the pipeline can tell "exactly at the limit" from "over it".
    const part = await request.file({ limits: { fileSize: uploadCap + 1, files: 1 } });
    if (!part || part.fieldname !== 'file') {
      // Drain an unexpected part so the client can read the error response.
      part?.file.resume();
      throw errors.validation('Send the file in a form field named "file".');
    }

    const asset = await storeUpload(
      { db, storage, limits: config.limits },
      {
        workspaceId: workspace.id,
        documentId: access.document.id,
        rawFilename: part.filename,
        stream: part.file,
        uploadedBy: access.actor.userId,
      },
    ).catch(async (error: unknown) => {
      part.file.resume();
      ctx.metrics.uploads.inc({ outcome: 'rejected' });
      // Rejected active content is a security-relevant event; record it without the file.
      if ((error as { reason?: string } | null)?.reason === 'active_content') {
        await tryAudit(db, ctx.logger, {
          workspaceId: workspace.id,
          actor: { kind: access.actor.kind, userId: access.actor.userId, name: access.actor.name },
          action: 'asset.rejected_active_content',
          targetType: 'document',
          targetId: access.document.id,
          requestId: request.id,
        });
      }
      throw error;
    });

    ctx.metrics.uploads.inc({ outcome: 'stored' });
    ctx.metrics.uploadBytes.inc({}, Number(asset.sizeBytes));
    reply.code(201);
    return { asset: toApiAsset(asset) };
  });

  // Bytes of one asset. Authorized on every request; never cached without revalidation.
  app.get('/api/documents/:documentId/assets/:assetId', async (request, reply) => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    const assetId = uuidParam(request, 'assetId');
    // The asset must belong to this very document: ids from other documents do not resolve.
    const asset = await findReadyAsset(db, workspace.id, access.document.id, assetId);
    if (!asset) throw errors.notFound();

    const etag = `"${asset.sha256.toString('hex').slice(0, 40)}"`;
    const download = (request.query as { download?: string } | undefined)?.download;
    const inline = asset.kind === 'image' && download !== '1' && download !== 'true';

    reply
      .header('etag', etag)
      // Private and revalidated every time, so revoked access takes effect immediately.
      .header('cache-control', 'private, no-cache')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', ASSET_CSP)
      // The desktop renderer embeds images from another origin; access control
      // is the authorization above, not the embedding policy.
      .header('cross-origin-resource-policy', 'cross-origin')
      .header(
        'content-disposition',
        contentDisposition(inline ? 'inline' : 'attachment', asset.name),
      );

    const candidates = String(request.headers['if-none-match'] ?? '')
      .split(',')
      .map((value) => value.trim().replace(/^W\//, ''));
    if (candidates.includes(etag) || candidates.includes('*')) {
      return reply.code(304).send();
    }

    const size = await storage.size(asset.storageKey);
    if (size === null) {
      request.log.error({ assetId: asset.id }, 'asset bytes are missing from storage');
      throw errors.notFound();
    }
    return reply
      .type(inline ? asset.mime : 'application/octet-stream')
      .header('content-length', size)
      .send(storage.createReadStream(asset.storageKey));
  });
}
