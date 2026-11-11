/**
 * "Open in Desktop": a 60-second single-use code, bound to the caller's
 * principal and one document, is redeemed by the desktop main process for a
 * document-scoped bearer session (docs/architecture.md §4).
 */
import {
  DesktopRedeemRequest,
  TTL,
  buildDesktopHandoffUrl,
  type DesktopHandoffResponse,
  type DesktopSessionResponse,
} from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { resolveAccess } from '../../access/resolve';
import { tryAudit, writeAudit } from '../../audit';
import {
  createSession,
  findSessionsByIds,
  revokeSessionTree,
  sessionStatus,
} from '../../auth/sessions';
import { newId, randomToken, sha256 } from '../../auth/tokens';
import { errors } from '../../errors';
import { guestName } from '../../util/identity';
import type { RouteDeps } from '../app';
import { documentAccess, getAuth } from '../auth';
import { param, parseInput } from '../util';

interface HandoffRow {
  id: string;
  documentId: string;
  sessionId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export function registerDesktopRoutes(app: FastifyInstance, { ctx, limits }: RouteDeps): void {
  const { db, workspace, config } = ctx;

  app.post(
    '/api/documents/:documentId/desktop-handoff',
    async (request, reply): Promise<DesktopHandoffResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      await limits.collabTicket.consume(request, `handoff:${access.principalSessionId}`);
      const code = randomToken();
      const expiresAt = new Date(Date.now() + TTL.desktopHandoffCodeMs);
      await db.query(
        `INSERT INTO desktop_handoffs (id, workspace_id, code_hash, document_id, session_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          newId(),
          workspace.id,
          sha256(code),
          access.document.id,
          // The session behind the caller's effective permission.
          access.principalSessionId,
          expiresAt,
        ],
      );
      reply.code(201);
      return {
        code,
        url: buildDesktopHandoffUrl({
          serverOrigin: config.publicOrigin,
          documentId: access.document.id,
          code,
        }),
        expiresAt: expiresAt.toISOString(),
      };
    },
  );

  // Public: called by the desktop main process, which has no session yet.
  app.post(
    '/api/desktop/redeem',
    { config: { originOptional: true } },
    async (request, reply): Promise<DesktopSessionResponse> => {
      await limits.desktopRedeemIp.assertAllowed(request, request.ip);
      const body = parseInput(DesktopRedeemRequest, request.body);

      const fail = async (reason: string) => {
        await limits.desktopRedeemIp.recordFailure(request, request.ip);
        await tryAudit(db, ctx.logger, {
          workspaceId: workspace.id,
          actor: { kind: 'system', name: 'anonymous' },
          action: 'desktop.redeem_failed',
          targetType: 'document',
          details: { reason },
          requestId: request.id,
        });
        // One answer for unknown, used, expired and mismatched codes.
        return errors.handoffInvalid();
      };

      const outcome = await db.tx(async (tx) => {
        const found = await tx.query<HandoffRow>(
          `SELECT id, document_id AS "documentId", session_id AS "sessionId",
                  expires_at AS "expiresAt", used_at AS "usedAt"
             FROM desktop_handoffs
            WHERE code_hash = $1 AND workspace_id = $2
              FOR UPDATE`,
          [sha256(body.code), workspace.id],
        );
        const handoff = found.rows[0];
        if (!handoff) return { failure: 'unknown' as const };
        if (handoff.usedAt) return { failure: 'used' as const };
        // Single use, whatever happens next: a code that was presented is spent.
        await tx.query('UPDATE desktop_handoffs SET used_at = now() WHERE id = $1', [handoff.id]);
        if (handoff.expiresAt.getTime() <= Date.now()) return { failure: 'expired' as const };
        if (handoff.documentId !== body.documentId) return { failure: 'wrong_document' as const };

        // The principal that asked for the handoff must still have access.
        const [parent] = await findSessionsByIds(tx, workspace.id, [handoff.sessionId]);
        if (!parent || sessionStatus(parent, config.sessions) !== 'valid') {
          return { failure: 'parent_gone' as const };
        }
        const deps = { ...ctx.accessDeps, db: tx };
        const parentAccess = await resolveAccess(deps, [parent], handoff.documentId);
        if (!parentAccess.ok) return { failure: 'parent_gone' as const };

        const created = await createSession(tx, config.sessions, {
          workspaceId: workspace.id,
          kind: 'desktop',
          documentId: handoff.documentId,
          parentSessionId: parent.id,
          ...(parent.userId
            ? { userId: parent.userId }
            : { shareGrantId: parent.shareGrantId, guestName: parent.guestName ?? guestName() }),
        });
        const access = await resolveAccess(deps, [created.session], handoff.documentId);
        if (!access.ok) return { failure: 'parent_gone' as const };
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: {
            kind: access.actor.kind,
            userId: access.actor.userId,
            name: access.actor.name,
          },
          action: 'desktop.session_created',
          targetType: 'document',
          targetId: handoff.documentId,
          details: { via: access.via },
          requestId: request.id,
        });
        return { failure: undefined, token: created.token, access };
      });

      if (outcome.failure !== undefined) throw await fail(outcome.failure);
      const { access, token } = outcome;
      reply.code(201);
      return {
        token,
        documentId: access.document.id,
        title: access.document.title,
        role: access.role,
        expiresAt: access.expiresAt ? access.expiresAt.toISOString() : null,
        accountId: access.accountId,
      };
    },
  );

  app.get('/api/desktop/session', async (request): Promise<DesktopSessionResponse> => {
    const auth = await getAuth(ctx, request);
    if (!auth.bearer || !auth.bearer.documentId) throw errors.unauthenticated();
    const access = await documentAccess(ctx, request, auth.bearer.documentId);
    return {
      documentId: access.document.id,
      title: access.document.title,
      role: access.role,
      expiresAt: access.expiresAt ? access.expiresAt.toISOString() : null,
      accountId: access.accountId,
    };
  });

  app.post('/api/desktop/logout', async (request, reply) => {
    const auth = await getAuth(ctx, request);
    if (auth.bearer && !auth.bearer.revokedAt) {
      const revoked = await revokeSessionTree(db, auth.bearer.id, 'desktop_logout');
      await ctx.collab.reevaluateSessions(revoked);
    }
    return reply.code(204).send();
  });
}
