/** API key management for administrators (cookie session + CSRF, like every other admin route). */
import {
  CreateApiKeyRequest,
  type ApiKeyResponse,
  type ApiKeyWithSecret,
  type ApiKeysResponse,
} from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from '../../service/api-keys';
import type { RouteDeps } from '../app';
import { requireAdmin } from '../auth';
import { parseInput, uuidParam } from '../util';

export function registerApiKeyRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  app.get('/api/admin/api-keys', async (request): Promise<ApiKeysResponse> => {
    await requireAdmin(ctx, request);
    return { keys: await listApiKeys(ctx) };
  });

  app.post('/api/admin/api-keys', async (request, reply): Promise<ApiKeyWithSecret> => {
    const { user } = await requireAdmin(ctx, request);
    const body = parseInput(CreateApiKeyRequest, request.body);
    const created = await createApiKey(
      ctx,
      { userId: user.id, name: user.displayName },
      body,
      request.id,
    );
    reply.code(201);
    return created;
  });

  app.post('/api/admin/api-keys/:id/rotate', async (request, reply): Promise<ApiKeyWithSecret> => {
    const { user } = await requireAdmin(ctx, request);
    const rotated = await rotateApiKey(
      ctx,
      { userId: user.id, name: user.displayName },
      uuidParam(request, 'id'),
      request.id,
    );
    reply.code(201);
    return rotated;
  });

  app.post('/api/admin/api-keys/:id/revoke', async (request): Promise<ApiKeyResponse> => {
    const { user } = await requireAdmin(ctx, request);
    const key = await revokeApiKey(
      ctx,
      { userId: user.id, name: user.displayName },
      uuidParam(request, 'id'),
      request.id,
    );
    return { key };
  });
}
