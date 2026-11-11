import { SetMemberRequest, type Member, type MembersResponse } from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../../audit';
import type { AppContext } from '../../context';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { documentAccess, requireManage } from '../auth';
import { toApiMember, type MemberRow } from '../mappers';
import { param, parseInput, uuidParam } from '../util';

export async function listMembers(ctx: AppContext, documentId: string): Promise<Member[]> {
  const result = await ctx.db.query<MemberRow>(
    `SELECT m.user_id AS "userId", u.email::text AS email, u.display_name AS "displayName",
            m.role, u.status AS "userStatus", m.granted_at AS "grantedAt"
       FROM document_members m
       JOIN users u ON u.id = m.user_id AND u.workspace_id = m.workspace_id
      WHERE m.document_id = $1 AND m.workspace_id = $2
      ORDER BY u.display_name, u.id`,
    [documentId, ctx.workspace.id],
  );
  return result.rows.map(toApiMember);
}

export function registerMemberRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const { db, workspace } = ctx;

  app.get('/api/documents/:documentId/members', async (request): Promise<MembersResponse> => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    requireManage(access);
    return { members: await listMembers(ctx, access.document.id) };
  });

  app.put(
    '/api/documents/:documentId/members/:userId',
    async (request): Promise<MembersResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      requireManage(access);
      const userId = uuidParam(request, 'userId');
      const body = parseInput(SetMemberRequest, request.body);
      const documentId = access.document.id;

      await db.tx(async (tx) => {
        // The account must exist in this workspace: memberships never cross tenants.
        const user = await tx.query('SELECT 1 FROM users WHERE id = $1 AND workspace_id = $2', [
          userId,
          workspace.id,
        ]);
        if ((user.rowCount ?? 0) === 0) throw errors.notFound('That account does not exist.');
        const previous = await tx.query<{ role: string }>(
          'SELECT role FROM document_members WHERE document_id = $1 AND user_id = $2',
          [documentId, userId],
        );
        await tx.query(
          `INSERT INTO document_members (document_id, user_id, workspace_id, role, granted_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (document_id, user_id)
           DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = now()`,
          [documentId, userId, workspace.id, body.role, access.actor.userId],
        );
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
          action: previous.rows[0] ? 'member.role_changed' : 'member.added',
          targetType: 'document',
          targetId: documentId,
          details: { userId, role: body.role, previousRole: previous.rows[0]?.role ?? null },
          requestId: request.id,
        });
      });
      // Applies upgrades and downgrades to open connections right away.
      await ctx.collab.reevaluateDocument(documentId);
      return { members: await listMembers(ctx, documentId) };
    },
  );

  app.delete(
    '/api/documents/:documentId/members/:userId',
    async (request): Promise<MembersResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      requireManage(access);
      const userId = uuidParam(request, 'userId');
      const documentId = access.document.id;

      await db.tx(async (tx) => {
        const removed = await tx.query(
          `DELETE FROM document_members
            WHERE document_id = $1 AND user_id = $2 AND workspace_id = $3`,
          [documentId, userId, workspace.id],
        );
        if ((removed.rowCount ?? 0) === 0) return;
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
          action: 'member.removed',
          targetType: 'document',
          targetId: documentId,
          details: { userId },
          requestId: request.id,
        });
      });
      await ctx.collab.reevaluateDocument(documentId);
      return { members: await listMembers(ctx, documentId) };
    },
  );
}
