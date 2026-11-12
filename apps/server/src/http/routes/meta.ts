import {
  ATTACHMENT_EXTENSIONS,
  COLLAB_PROTOCOL_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  IMAGE_MIME_TYPES,
  type HealthResponse,
  type MetaResponse,
} from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { releaseStoreFor } from '../../releases';
import type { RouteDeps } from '../app';

export function registerMetaRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const store = releaseStoreFor(ctx);
  const meta: MetaResponse = {
    name: 'RealtimeDocs',
    version: ctx.version,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    minClientSchemaVersion: ctx.config.minClientSchemaVersion,
    protocolVersion: COLLAB_PROTOCOL_VERSION,
    publicOrigin: ctx.config.publicOrigin,
    limits: { ...ctx.config.limits },
    imageMimeTypes: [...IMAGE_MIME_TYPES],
    attachmentExtensions: [...ATTACHMENT_EXTENSIONS],
    signupEnabled: ctx.config.allowSignup,
    minimumSupportedClientVersion: null,
    recommendedClientVersion: null,
    documentSchemaVersion: DOCUMENT_SCHEMA_VERSION,
    updateUrl: '/api/v1/desktop/update',
  };

  // Public: lets a client validate a server address and read the effective limits.
  // The client-version fields come from the current stable desktop release (null when none).
  app.get('/api/meta', async (): Promise<MetaResponse> => {
    const stable = await store.current('stable');
    return {
      ...meta,
      minimumSupportedClientVersion: stable?.minimumSupportedVersion ?? null,
      recommendedClientVersion: stable?.version ?? null,
    };
  });

  // Liveness: the process is up and serving. No dependencies are checked.
  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', time: new Date().toISOString() };
  });

  // Readiness: the database answers. 503 while it does not.
  app.get('/api/ready', async (_request, reply) => {
    // Not ready while a dependency is down, and from the moment a shutdown begins,
    // so that a load balancer stops sending new connections here.
    const [database, redis] = await Promise.all([
      ctx.db.ping(2_000),
      ctx.cluster ? ctx.cluster.ping(2_000).then((result) => result.ok) : Promise.resolve(true),
    ]);
    const ready = database && redis && !ctx.collab.draining;
    const body: HealthResponse = {
      status: ready ? 'ok' : 'degraded',
      time: new Date().toISOString(),
    };
    return reply.code(ready ? 200 : 503).send(body);
  });
}
