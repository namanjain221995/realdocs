import {
  ATTACHMENT_EXTENSIONS,
  COLLAB_PROTOCOL_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  IMAGE_MIME_TYPES,
  type HealthResponse,
  type MetaResponse,
} from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../app';

export function registerMetaRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
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
  };

  // Public: lets a client validate a server address and read the effective limits.
  app.get('/api/meta', async () => meta);

  // Liveness: the process is up and serving. No dependencies are checked.
  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', time: new Date().toISOString() };
  });

  // Readiness: the database answers. 503 while it does not.
  app.get('/api/ready', async (_request, reply) => {
    const ready = await ctx.db.ping(2_000);
    const body: HealthResponse = {
      status: ready ? 'ok' : 'degraded',
      time: new Date().toISOString(),
    };
    return reply.code(ready ? 200 : 503).send(body);
  });
}
