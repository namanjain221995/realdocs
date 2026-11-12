/**
 * Registers the service API from the route registry: `/api/v1/*` for API
 * keys, `/api/admin/*` (same handlers) for signed-in administrators, and the
 * public OpenAPI document.
 */
import { isUuid } from '@realtimedocs/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type OperationActor } from '../../service/actor';
import { IdempotencyStore, parseIdempotencyKey, requestHash } from '../../service/idempotency';
import { buildOpenApi } from '../../service/openapi';
import type { ServiceRoute } from '../../service/registry';
import { auditAdminView } from '../../service/sessions';
import { SERVICE_ROUTES } from '../../service/v1-routes';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { requireAdmin, requireService } from '../auth';
import { parseInput } from '../util';

export function registerV1Routes(app: FastifyInstance, { ctx, limits }: RouteDeps): void {
  const store = new IdempotencyStore(ctx.db, ctx.workspace.id, ctx.config.sessionSecret);

  async function run(
    route: ServiceRoute,
    request: FastifyRequest,
    reply: FastifyReply,
    actor: OperationActor,
    admin: boolean,
  ): Promise<unknown> {
    // Ids are opaque: a malformed one is just a resource that does not exist.
    const rawParams = (request.params ?? {}) as Record<string, unknown>;
    for (const value of Object.values(rawParams)) {
      if (typeof value !== 'string' || !isUuid(value)) throw errors.notFound();
    }
    const params = route.params ? parseInput(route.params, rawParams) : undefined;
    const query = route.query ? parseInput(route.query, request.query) : undefined;
    const body = route.body ? parseInput(route.body, request.body) : undefined;
    const invoke = (finalize?: Parameters<typeof route.handler>[0]['finalize']) =>
      route.handler({
        ctx,
        actor,
        params,
        query,
        body,
        request,
        requestId: request.id,
        admin,
        finalize,
      } as never);

    let result: unknown;
    const idempotencyKey =
      route.idempotent && !admin ? parseIdempotencyKey(request.headers['idempotency-key']) : null;
    if (idempotencyKey !== null && actor.kind === 'service') {
      const claim = await store.claim(
        actor.keyId,
        idempotencyKey,
        requestHash(route.method.toUpperCase(), request.url.split('?')[0] ?? '', request.body),
      );
      if (claim.kind === 'replay') {
        reply.header('idempotency-replayed', 'true').code(claim.response.status);
        return claim.response.body;
      }
      try {
        result = await invoke((tx, response) =>
          store.complete(tx, actor.keyId, idempotencyKey, { status: route.status, body: response }),
        );
      } catch (error) {
        // Nothing was created: give the key back so the caller can retry with it.
        await store.release(actor.keyId, idempotencyKey).catch(() => undefined);
        throw error;
      }
    } else {
      result = await invoke();
    }

    if (admin && route.adminView && actor.kind === 'user') {
      const sessionId = (params as { id?: string } | undefined)?.id;
      if (sessionId) {
        await auditAdminView(ctx, actor, sessionId, route.adminView, request.id).catch(
          (err: unknown) => request.log.warn({ err }, 'admin view could not be audited'),
        );
      }
    }
    reply.code(route.status);
    if (route.response === null) return reply.send();
    return result;
  }

  for (const route of SERVICE_ROUTES) {
    const method = route.method.toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'DELETE';
    app.route({
      method,
      url: `/api/v1${route.path}`,
      handler: async (request, reply) => {
        const principal = await requireService(ctx, limits, request, route.scope);
        return run(
          route,
          request,
          reply,
          {
            kind: 'service',
            keyId: principal.keyId,
            name: `${principal.name} (${principal.keyPrefix})`,
          },
          false,
        );
      },
    });
    if (route.admin) {
      app.route({
        method,
        url: `/api/admin${route.path}`,
        handler: async (request, reply) => {
          const { user } = await requireAdmin(ctx, request);
          return run(
            route,
            request,
            reply,
            { kind: 'user', userId: user.id, name: user.displayName },
            true,
          );
        },
      });
    }
  }

  // Public and cacheable: the document describes the API, not any deployment data.
  app.get('/api/openapi.json', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return buildOpenApi(SERVICE_ROUTES, ctx.config.publicOrigin);
  });
}
