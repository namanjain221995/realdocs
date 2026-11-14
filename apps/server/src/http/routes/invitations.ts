/**
 * Account invitations. A separate concept from document share links: an
 * invitation creates an account and never grants access to a document.
 */
import {
  AcceptInvitationRequest,
  CreateInvitationRequest,
  InvitationLookupRequest,
  buildInvitationUrl,
  type CreateInvitationResponse,
  type InvitationLookupResponse,
  type InvitationsResponse,
} from '@realtimedocs/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { tryAudit, writeAudit } from '../../audit';
import { hashPassword } from '../../auth/password';
import { createSession } from '../../auth/sessions';
import { newId, randomToken, safeEqual, sha256 } from '../../auth/tokens';
import type { Queryable } from '../../db/pool';
import { sqlState } from '../../db/pool';
import { USER_COLUMNS, type UserRow } from '../../db/rows';
import { errors } from '../../errors';
import { linkAccountToInterviewSessions } from '../../service/interviewer-accounts';
import type { RouteDeps } from '../app';
import { requireAdmin, setSessionCookie } from '../auth';
import {
  invitationState,
  toApiInvitation,
  toSessionResponse,
  type InvitationRow,
} from '../mappers';
import { parseInput, uuidParam } from '../util';

const INVITATION_COLUMNS = `
  i.id, i.email::text AS email, i.role, i.created_at AS "createdAt",
  (SELECT u.display_name FROM users u WHERE u.id = i.created_by) AS "createdByName",
  i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt",
  (SELECT u.display_name FROM users u WHERE u.id = i.accepted_by) AS "acceptedByName",
  i.revoked_at AS "revokedAt"`;

interface InvitationWithSecret extends InvitationRow {
  secretHash: Buffer;
}

export function registerInvitationRoutes(app: FastifyInstance, { ctx, limits }: RouteDeps): void {
  const { db, workspace, config } = ctx;

  app.get('/api/invitations', async (request): Promise<InvitationsResponse> => {
    await requireAdmin(ctx, request);
    const result = await db.query<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM invitations i
        WHERE i.workspace_id = $1 ORDER BY i.created_at DESC LIMIT 500`,
      [workspace.id],
    );
    return { invitations: result.rows.map(toApiInvitation) };
  });

  app.post('/api/invitations', async (request, reply): Promise<CreateInvitationResponse> => {
    const admin = await requireAdmin(ctx, request);
    const body = parseInput(CreateInvitationRequest, request.body);
    const email = body.email ? body.email.trim().toLowerCase() : null;
    if (email) {
      const existing = await db.query(
        'SELECT 1 FROM users WHERE workspace_id = $1 AND email = $2',
        [workspace.id, email],
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw errors.conflict('An account with this email address already exists.');
      }
    }
    const id = newId();
    const secret = randomToken();
    const expiresAt = new Date(Date.now() + body.expiresInHours * 3_600_000);
    const row = await db.tx(async (tx) => {
      const inserted = await tx.query<InvitationRow>(
        `WITH i AS (
           INSERT INTO invitations (id, workspace_id, secret_hash, email, role, created_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *
         )
         SELECT ${INVITATION_COLUMNS} FROM i`,
        [id, workspace.id, sha256(secret), email, body.role, admin.user.id, expiresAt],
      );
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: admin.user.id, name: admin.user.displayName },
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: id,
        details: { role: body.role, hasEmail: email !== null, expiresInHours: body.expiresInHours },
        requestId: request.id,
      });
      const created = inserted.rows[0];
      if (!created) throw new Error('invitation insert returned no row');
      return created;
    });
    reply.code(201);
    // The secret travels in the URL fragment and is shown exactly once.
    return {
      invitation: toApiInvitation(row),
      url: buildInvitationUrl(config.publicOrigin, id, secret),
    };
  });

  app.delete('/api/invitations/:invitationId', async (request, reply) => {
    const admin = await requireAdmin(ctx, request);
    const invitationId = uuidParam(request, 'invitationId');
    await db.tx(async (tx) => {
      const updated = await tx.query(
        `UPDATE invitations SET revoked_at = COALESCE(revoked_at, now())
          WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL`,
        [invitationId, workspace.id],
      );
      if ((updated.rowCount ?? 0) === 0) {
        const exists = await tx.query(
          'SELECT 1 FROM invitations WHERE id = $1 AND workspace_id = $2',
          [invitationId, workspace.id],
        );
        if ((exists.rowCount ?? 0) === 0) throw errors.notFound('That invitation does not exist.');
        throw errors.conflict('This invitation has already been accepted.');
      }
      await writeAudit(tx, {
        workspaceId: workspace.id,
        actor: { kind: 'user', userId: admin.user.id, name: admin.user.displayName },
        action: 'invitation.revoked',
        targetType: 'invitation',
        targetId: invitationId,
        requestId: request.id,
      });
    });
    return reply.code(204).send();
  });

  /** Finds a usable invitation for the given id and secret, or throws. */
  async function usableInvitation(
    queryable: Queryable,
    request: FastifyRequest,
    invitationId: string,
    secret: string,
    lock: boolean,
  ): Promise<InvitationWithSecret> {
    const found = await queryable.query<InvitationWithSecret>(
      `SELECT ${INVITATION_COLUMNS}, i.secret_hash AS "secretHash"
         FROM invitations i WHERE i.id = $1 AND i.workspace_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
      [invitationId, workspace.id],
    );
    const invitation = found.rows[0];
    // Always compare, so unknown ids and wrong secrets take the same time.
    const matches = safeEqual(sha256(secret), invitation?.secretHash ?? sha256(''));
    const state = invitation ? invitationState(invitation) : 'revoked';
    if (!invitation || !matches || state === 'accepted' || state === 'revoked') {
      await limits.inviteIp.recordFailure(request, request.ip);
      await tryAudit(db, ctx.logger, {
        workspaceId: workspace.id,
        actor: { kind: 'system', name: 'anonymous' },
        action: 'invitation.rejected',
        targetType: 'invitation',
        targetId: invitation?.id ?? null,
        details: { known: Boolean(invitation), state: invitation ? state : 'unknown' },
        requestId: request.id,
      });
      throw errors.inviteInvalid();
    }
    if (state === 'expired') throw errors.inviteExpired();
    return invitation;
  }

  app.post('/api/invitations/lookup', async (request): Promise<InvitationLookupResponse> => {
    await limits.inviteIp.assertAllowed(request, request.ip);
    const body = parseInput(InvitationLookupRequest, request.body);
    const invitation = await usableInvitation(db, request, body.invitationId, body.secret, false);
    return {
      email: invitation.email,
      role: invitation.role,
      workspaceName: workspace.name,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  });

  app.post('/api/invitations/accept', async (request, reply) => {
    await limits.inviteIp.assertAllowed(request, request.ip);
    const body = parseInput(AcceptInvitationRequest, request.body);
    // Hash before taking any lock: it is slow by design.
    const passwordHash = await hashPassword(body.password);

    let outcome;
    try {
      outcome = await db.tx(async (tx) => {
        const invitation = await usableInvitation(
          tx,
          request,
          body.invitationId,
          body.secret,
          true,
        );
        const requested = body.email ? body.email.trim().toLowerCase() : null;
        const invited = invitation.email ? invitation.email.toLowerCase() : null;
        if (invited && requested && invited !== requested) {
          throw errors.validation('This invitation was issued for a different email address.', [
            { path: 'email', message: 'Use the email address the invitation was issued for.' },
          ]);
        }
        const email = invited ?? requested;
        if (!email) {
          throw errors.validation('An email address is required.', [
            { path: 'email', message: 'Enter your email address.' },
          ]);
        }
        const userId = newId();
        const inserted = await tx.query<UserRow>(
          `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${USER_COLUMNS}`,
          [userId, workspace.id, email, body.displayName, passwordHash, invitation.role],
        );
        const user = inserted.rows[0];
        if (!user) throw new Error('user insert returned no row');
        await tx.query(
          'UPDATE invitations SET accepted_at = now(), accepted_by = $1 WHERE id = $2',
          [userId, invitation.id],
        );
        // Only an address the administrator wrote into the invitation is taken as the person's
        // own: an address typed in here is a claim the server cannot check.
        if (invited) {
          await linkAccountToInterviewSessions(tx, workspace.id, {
            id: userId,
            email,
            displayName: user.displayName,
          });
        } else {
          await tx.query('UPDATE users SET address_confirmed = false WHERE id = $1', [userId]);
        }
        const created = await createSession(tx, config.sessions, {
          workspaceId: workspace.id,
          kind: 'user',
          userId,
        });
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId, name: user.displayName },
          action: 'invitation.accepted',
          targetType: 'invitation',
          targetId: invitation.id,
          details: { role: invitation.role },
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
}
