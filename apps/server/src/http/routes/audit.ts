import type { AuditEvent, AuditResponse } from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from '../app';
import { requireAdmin } from '../auth';
import { parseInput } from '../util';

const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

interface AuditRow {
  id: string;
  at: Date;
  actorName: string | null;
  actorKind: 'user' | 'guest' | 'system';
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
}

function cleanDetails(details: Record<string, unknown> | null): AuditEvent['details'] {
  const clean: AuditEvent['details'] = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      clean[key] = value;
    }
  }
  return clean;
}

export function registerAuditRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  app.get('/api/audit', async (request): Promise<AuditResponse> => {
    await requireAdmin(ctx, request);
    const { limit } = parseInput(AuditQuery, request.query);
    const result = await ctx.db.query<AuditRow>(
      `SELECT id, at, actor_name AS "actorName", actor_kind AS "actorKind", action,
              target_type AS "targetType", target_id AS "targetId", details
         FROM audit_events
        WHERE workspace_id = $1
        ORDER BY at DESC, id
        LIMIT $2`,
      [ctx.workspace.id, limit],
    );
    return {
      events: result.rows.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        actorName: row.actorName,
        actorKind: row.actorKind,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        details: cleanDetails(row.details),
      })),
    };
  });
}
