import { UpdateUserRequest, type UsersResponse } from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../../audit';
import { revokeUserSessions } from '../../auth/sessions';
import { USER_COLUMNS, type UserRow } from '../../db/rows';
import type { Queryable } from '../../db/pool';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { requireAdmin } from '../auth';
import { toApiUser } from '../mappers';
import { parseInput, uuidParam } from '../util';

export function registerUserRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const { db, workspace } = ctx;

  async function listUsers(queryable: Queryable): Promise<UsersResponse> {
    const result = await queryable.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE workspace_id = $1 ORDER BY created_at, id`,
      [workspace.id],
    );
    return { users: result.rows.map(toApiUser) };
  }

  app.get('/api/users', async (request) => {
    await requireAdmin(ctx, request);
    return listUsers(db);
  });

  app.patch('/api/users/:userId', async (request) => {
    const admin = await requireAdmin(ctx, request);
    const userId = uuidParam(request, 'userId');
    const body = parseInput(UpdateUserRequest, request.body);
    if (userId === admin.user.id) {
      throw errors.conflict('You cannot change your own role or status.');
    }

    const outcome = await db.tx(async (tx) => {
      const found = await tx.query<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [userId, workspace.id],
      );
      const target = found.rows[0];
      if (!target) throw errors.notFound('That account does not exist.');
      const role = body.role ?? target.role;
      const status = body.status ?? target.status;
      await tx.query(
        `UPDATE users SET role = $1, status = $2, updated_at = now()
          WHERE id = $3 AND workspace_id = $4`,
        [role, status, userId, workspace.id],
      );
      const admins = await tx.query<{ count: number }>(
        `SELECT count(*) AS count FROM users
          WHERE workspace_id = $1 AND role = 'admin' AND status = 'active'`,
        [workspace.id],
      );
      if ((admins.rows[0]?.count ?? 0) < 1) {
        throw errors.conflict('At least one active administrator is required.');
      }
      const revoked =
        status === 'disabled' && target.status !== 'disabled'
          ? await revokeUserSessions(tx, userId, 'user_disabled')
          : [];
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: admin.user.id, name: admin.user.displayName },
        action: 'user.updated',
        targetType: 'user',
        targetId: userId,
        details: {
          roleFrom: target.role,
          roleTo: role,
          statusFrom: target.status,
          statusTo: status,
          sessionsEnded: revoked.length,
        },
        requestId: request.id,
      });
      return { revoked, users: await listUsers(tx) };
    });

    // Role and status both change what the account may do in open documents.
    await ctx.collab.reevaluateSessions(outcome.revoked);
    await ctx.collab.reevaluateUser(userId);
    return outcome.users;
  });
}
