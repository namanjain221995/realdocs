import {
  ChangePasswordRequest,
  LoginRequest,
  SignupRequest,
  UpdateProfileRequest,
  type RevokeOtherSessionsResponse,
} from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { tryAudit, writeAudit } from '../../audit';
import { dummyVerify, hashPassword, needsRehash, verifyPassword } from '../../auth/password';
import { newId } from '../../auth/tokens';
import { createSession, revokeSessionTree, revokeUserSessions } from '../../auth/sessions';
import { sqlState } from '../../db/pool';
import { USER_COLUMNS, type UserRow } from '../../db/rows';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { clearSessionCookie, getAuth, requireAccount, setSessionCookie } from '../auth';
import { SIGNED_OUT, toSessionResponse } from '../mappers';
import { parseInput } from '../util';

interface UserWithHash extends UserRow {
  passwordHash: string;
}

export function registerAuthRoutes(app: FastifyInstance, { ctx, limits }: RouteDeps): void {
  const { db, workspace, config } = ctx;

  app.post('/api/auth/login', async (request, reply) => {
    const body = parseInput(LoginRequest, request.body);
    const email = body.email.trim().toLowerCase();
    await limits.loginIp.assertAllowed(request, request.ip);
    await limits.loginEmail.assertAllowed(request, email);

    const found = await db.query<UserWithHash>(
      `SELECT ${USER_COLUMNS}, password_hash AS "passwordHash"
         FROM users WHERE workspace_id = $1 AND email = $2`,
      [workspace.id, email],
    );
    const user = found.rows[0];
    let valid = false;
    if (user) {
      valid = await verifyPassword(user.passwordHash, body.password);
    } else {
      // Same work as a real check, so timing does not reveal which emails exist.
      await dummyVerify(body.password);
    }
    if (!user || !valid || user.status !== 'active') {
      await limits.loginIp.recordFailure(request, request.ip);
      await limits.loginEmail.recordFailure(request, email);
      await tryAudit(db, ctx.logger, {
        workspaceId: workspace.id,
        actor: { kind: 'system', name: 'anonymous' },
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: user?.id ?? null,
        details: { knownAccount: Boolean(user), disabled: user?.status === 'disabled' },
        requestId: request.id,
      });
      // One message for unknown email, wrong password and disabled account.
      throw errors.unauthenticated('The email address or password is not correct.');
    }

    if (needsRehash(user.passwordHash)) {
      const upgraded = await hashPassword(body.password);
      await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
        upgraded,
        user.id,
      ]);
    }
    const { token, session } = await db.tx(async (tx) => {
      const created = await createSession(tx, config.sessions, {
        workspaceId: workspace.id,
        kind: 'user',
        userId: user.id,
      });
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: user.id, name: user.displayName },
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        requestId: request.id,
      });
      return created;
    });
    setSessionCookie(ctx, reply, token, session.expiresAt);
    return toSessionResponse(ctx, user, session);
  });

  // Optional self-service sign-up (ALLOW_SIGNUP). The account is always a workspace
  // `member` with access to no document. Origin and CSRF rules are the generic ones for
  // unsafe requests, exactly as for POST /api/invitations/accept: an allow-listed Origin and
  // a non-empty X-RD-CSRF header (there is no session token to compare with yet).
  app.post('/api/auth/signup', async (request, reply) => {
    if (!config.allowSignup) throw errors.forbidden('Sign-up is not enabled on this server.');
    const body = parseInput(SignupRequest, request.body);
    const email = body.email.trim().toLowerCase();
    await limits.signupIp.consume(request, request.ip);
    await limits.signupEmail.consume(request, email);
    // Hash before touching the database: an existing address costs the same time.
    const passwordHash = await hashPassword(body.password);

    let outcome;
    try {
      outcome = await db.tx(async (tx) => {
        const userId = newId();
        const inserted = await tx.query<UserRow>(
          `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
           VALUES ($1, $2, $3, $4, $5, 'member')
           RETURNING ${USER_COLUMNS}`,
          [userId, workspace.id, email, body.displayName, passwordHash],
        );
        const user = inserted.rows[0];
        if (!user) throw new Error('user insert returned no row');
        const created = await createSession(tx, config.sessions, {
          workspaceId: workspace.id,
          kind: 'user',
          userId,
        });
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId, name: user.displayName },
          action: 'auth.signup',
          targetType: 'user',
          targetId: userId,
          details: { role: 'member' },
          requestId: request.id,
        });
        return { user, ...created };
      });
    } catch (error) {
      if (sqlState(error) === '23505') {
        throw errors.conflict('An account with this email address already exists.');
      }
      throw error;
    }
    setSessionCookie(ctx, reply, outcome.token, outcome.session.expiresAt);
    reply.code(201);
    return toSessionResponse(ctx, outcome.user, outcome.session);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const auth = await getAuth(ctx, request);
    clearSessionCookie(ctx, reply);
    if (auth.account && auth.accountStatus === 'valid') {
      const session = auth.account;
      const revoked = await db.tx(async (tx) => {
        // Desktop sessions handed off from this browser session end with it.
        const ids = await revokeSessionTree(tx, session.id, 'logout', 'parent_logout');
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: session.userId, name: auth.user?.displayName },
          action: 'auth.logout',
          targetType: 'user',
          targetId: session.userId,
          details: { sessionsEnded: ids.length },
          requestId: request.id,
        });
        return ids;
      });
      await ctx.collab.reevaluateSessions(revoked);
    }
    return reply.code(204).send();
  });

  app.get('/api/auth/session', async (request) => {
    const auth = await getAuth(ctx, request);
    if (!auth.user || !auth.account) return SIGNED_OUT;
    return toSessionResponse(ctx, auth.user, auth.account);
  });

  app.patch('/api/auth/profile', async (request) => {
    const { user, session } = await requireAccount(ctx, request);
    const body = parseInput(UpdateProfileRequest, request.body);
    const updated = await db.query<UserRow>(
      `UPDATE users SET display_name = $1, updated_at = now()
        WHERE id = $2 AND workspace_id = $3
        RETURNING ${USER_COLUMNS}`,
      [body.displayName, user.id, workspace.id],
    );
    return toSessionResponse(ctx, updated.rows[0] ?? user, session);
  });

  app.post('/api/auth/password', async (request, reply) => {
    const { user, session } = await requireAccount(ctx, request);
    const body = parseInput(ChangePasswordRequest, request.body);
    const key = `password:${user.id}`;
    await limits.loginEmail.assertAllowed(request, key);

    const stored = await db.query<{ passwordHash: string }>(
      'SELECT password_hash AS "passwordHash" FROM users WHERE id = $1 AND workspace_id = $2',
      [user.id, workspace.id],
    );
    const current = stored.rows[0]?.passwordHash;
    if (!current || !(await verifyPassword(current, body.currentPassword))) {
      await limits.loginEmail.recordFailure(request, key);
      throw errors.validation('The current password is not correct.', [
        { path: 'currentPassword', message: 'The current password is not correct.' },
      ]);
    }
    const nextHash = await hashPassword(body.newPassword);
    const revoked = await db.tx(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
        nextHash,
        user.id,
      ]);
      // Every other session of the account ends; this one (and its handoffs) stays.
      const ids = await revokeUserSessions(tx, user.id, 'password_changed', session.id);
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: user.id, name: user.displayName },
        action: 'auth.password_changed',
        targetType: 'user',
        targetId: user.id,
        details: { otherSessionsEnded: ids.length },
        requestId: request.id,
      });
      return ids;
    });
    await ctx.collab.reevaluateSessions(revoked);
    return reply.code(204).send();
  });

  // "Sign out everywhere else": ends every other session of the account —
  // other browsers and the desktop sessions created from them. The calling
  // session and the desktop sessions derived from it stay signed in.
  app.post(
    '/api/auth/sessions/revoke-others',
    async (request): Promise<RevokeOtherSessionsResponse> => {
      const { user, session } = await requireAccount(ctx, request);
      const revoked = await db.tx(async (tx) => {
        const ids = await revokeUserSessions(tx, user.id, 'revoked_by_user', session.id);
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: user.id, name: user.displayName },
          action: 'auth.other_sessions_revoked',
          targetType: 'user',
          targetId: user.id,
          details: { sessionsEnded: ids.length },
          requestId: request.id,
        });
        return ids;
      });
      // Live collaboration connections of the ended sessions close now.
      await ctx.collab.reevaluateSessions(revoked);
      return { revoked: revoked.length };
    },
  );
}
