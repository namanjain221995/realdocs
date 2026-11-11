/**
 * Document share links (docs/architecture.md §4). Only the SHA-256 of a link's
 * secret is stored; the full URL is returned once, at creation or rotation.
 */
import {
  CreateShareRequest,
  ShareExchangeRequest,
  UpdateShareRequest,
  buildShareUrl,
  isUuid,
  shareCookieName,
  type ShareExchangeResponse,
  type ShareGrant,
  type ShareResponse,
  type ShareWithUrlResponse,
  type SharesResponse,
} from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { tryAudit, writeAudit } from '../../audit';
import {
  createSession,
  findSessionByToken,
  revokeGrantSessions,
  revokeSessionTree,
} from '../../auth/sessions';
import { newId, randomToken, safeEqual, sha256 } from '../../auth/tokens';
import type { AppContext } from '../../context';
import type { Queryable } from '../../db/pool';
import { GRANT_COLUMNS, type GrantRow } from '../../db/rows';
import { getDocument } from '../../documents/store';
import { errors } from '../../errors';
import { guestName } from '../../util/identity';
import type { RouteDeps } from '../app';
import { cookieOptions, documentAccess, requireManage, shareCookiePath } from '../auth';
import { grantState, toApiShare } from '../mappers';
import { param, parseInput, uuidParam } from '../util';

type GrantWithSessions = GrantRow & { activeSessions: number };

const ACTIVE_SESSIONS = `
  (SELECT count(*) FROM sessions s
    WHERE s.share_grant_id = g.id AND s.revoked_at IS NULL AND s.expires_at > now())
  AS "activeSessions"`;

async function loadShare(
  db: Queryable,
  ctx: AppContext,
  documentId: string,
  shareId: string,
  lock = false,
): Promise<GrantWithSessions | null> {
  const result = await db.query<GrantWithSessions>(
    `SELECT ${GRANT_COLUMNS}, ${ACTIVE_SESSIONS} FROM share_grants g
      WHERE g.id = $1 AND g.document_id = $2 AND g.workspace_id = $3 ${lock ? 'FOR UPDATE OF g' : ''}`,
    [shareId, documentId, ctx.workspace.id],
  );
  return result.rows[0] ?? null;
}

function present(ctx: AppContext, row: GrantWithSessions): ShareGrant {
  const live = ctx.collab.liveConnectionsByGrant(row.documentId).get(row.id) ?? 0;
  return toApiShare(row, row.activeSessions, live);
}

export async function listShares(ctx: AppContext, documentId: string): Promise<ShareGrant[]> {
  const result = await ctx.db.query<GrantWithSessions>(
    `SELECT ${GRANT_COLUMNS}, ${ACTIVE_SESSIONS} FROM share_grants g
      WHERE g.document_id = $1 AND g.workspace_id = $2
      ORDER BY g.created_at DESC, g.id`,
    [documentId, ctx.workspace.id],
  );
  const live = ctx.collab.liveConnectionsByGrant(documentId);
  return result.rows.map((row) => toApiShare(row, row.activeSessions, live.get(row.id) ?? 0));
}

function futureOrNull(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date = new Date(value);
  if (date.getTime() <= Date.now()) {
    throw errors.validation('The expiry must be in the future.', [
      { path: 'expiresAt', message: 'Choose a time in the future, or revoke the link instead.' },
    ]);
  }
  return date;
}

export function registerShareRoutes(app: FastifyInstance, { ctx, limits }: RouteDeps): void {
  const { db, workspace, config } = ctx;

  app.get('/api/documents/:documentId/shares', async (request): Promise<SharesResponse> => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    requireManage(access);
    return { shares: await listShares(ctx, access.document.id) };
  });

  app.post(
    '/api/documents/:documentId/shares',
    async (request, reply): Promise<ShareWithUrlResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      requireManage(access);
      // View-only unless the administrator explicitly asks for an edit link.
      const body = parseInput(CreateShareRequest, request.body);
      const expiresAt = futureOrNull(body.expiresAt) ?? null;
      const id = newId();
      const secret = randomToken();
      const documentId = access.document.id;

      const share = await db.tx(async (tx) => {
        await tx.query(
          `INSERT INTO share_grants
             (id, workspace_id, document_id, role, secret_hash, label, created_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            workspace.id,
            documentId,
            body.role,
            sha256(secret),
            body.label,
            access.actor.userId,
            expiresAt,
          ],
        );
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
          action: 'share.created',
          targetType: 'share',
          targetId: id,
          details: { documentId, role: body.role, expires: expiresAt !== null },
          requestId: request.id,
        });
        const row = await loadShare(tx, ctx, documentId, id);
        if (!row) throw new Error('share insert returned no row');
        return row;
      });
      reply.code(201);
      return { share: present(ctx, share), url: buildShareUrl(config.publicOrigin, id, secret) };
    },
  );

  app.patch(
    '/api/documents/:documentId/shares/:shareId',
    async (request): Promise<ShareResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      requireManage(access);
      const shareId = uuidParam(request, 'shareId');
      const body = parseInput(UpdateShareRequest, request.body);
      const expiresAt = futureOrNull(body.expiresAt);
      const documentId = access.document.id;

      const share = await db.tx(async (tx) => {
        const current = await loadShare(tx, ctx, documentId, shareId, true);
        if (!current) throw errors.notFound('That share link does not exist.');
        if (current.revokedAt) throw errors.conflict('A revoked link cannot be changed.');
        await tx.query(
          `UPDATE share_grants SET role = $1, label = $2, expires_at = $3
            WHERE id = $4 AND workspace_id = $5`,
          [
            body.role ?? current.role,
            body.label ?? current.label,
            expiresAt === undefined ? current.expiresAt : expiresAt,
            shareId,
            workspace.id,
          ],
        );
        if (expiresAt) {
          // Derived sessions never outlive the link.
          await tx.query(
            `UPDATE sessions SET expires_at = LEAST(expires_at, $1)
              WHERE share_grant_id = $2 AND revoked_at IS NULL`,
            [expiresAt, shareId],
          );
        }
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
          action: 'share.updated',
          targetType: 'share',
          targetId: shareId,
          details: {
            documentId,
            roleFrom: current.role,
            roleTo: body.role ?? current.role,
            expiryChanged: expiresAt !== undefined,
          },
          requestId: request.id,
        });
        const row = await loadShare(tx, ctx, documentId, shareId);
        if (!row) throw new Error('share disappeared during update');
        return row;
      });
      // Downgrades, upgrades and earlier expiries reach open connections now.
      await ctx.collab.reevaluateDocument(documentId);
      return { share: present(ctx, share) };
    },
  );

  app.post(
    '/api/documents/:documentId/shares/:shareId/revoke',
    async (request): Promise<ShareResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      requireManage(access);
      const shareId = uuidParam(request, 'shareId');
      const documentId = access.document.id;

      const outcome = await db.tx(async (tx) => {
        const current = await loadShare(tx, ctx, documentId, shareId, true);
        if (!current) throw errors.notFound('That share link does not exist.');
        let revoked: string[] = [];
        if (!current.revokedAt) {
          // The grant and every session derived from it end in one transaction.
          await tx.query('UPDATE share_grants SET revoked_at = now() WHERE id = $1', [shareId]);
          revoked = await revokeGrantSessions(tx, shareId, 'share_revoked');
          await writeAudit(tx, {
            workspaceId: workspace.id,
            actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
            action: 'share.revoked',
            targetType: 'share',
            targetId: shareId,
            details: { documentId, sessionsEnded: revoked.length },
            requestId: request.id,
          });
        }
        const row = await loadShare(tx, ctx, documentId, shareId);
        if (!row) throw new Error('share disappeared during revocation');
        return { row, revoked };
      });
      // Disconnect recipients that are connected right now; unused tickets die too.
      await ctx.collab.reevaluateSessions(outcome.revoked);
      await ctx.collab.reevaluateDocument(documentId);
      return { share: present(ctx, outcome.row) };
    },
  );

  app.post(
    '/api/documents/:documentId/shares/:shareId/rotate',
    async (request, reply): Promise<ShareWithUrlResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      requireManage(access);
      const shareId = uuidParam(request, 'shareId');
      const documentId = access.document.id;
      const id = newId();
      const secret = randomToken();

      const outcome = await db.tx(async (tx) => {
        const current = await loadShare(tx, ctx, documentId, shareId, true);
        if (!current) throw errors.notFound('That share link does not exist.');
        if (grantState(current) !== 'active') {
          throw errors.conflict('Only an active link can be rotated. Create a new link instead.');
        }
        // Rotation = revoke the old grant with everything derived from it + a new grant.
        await tx.query('UPDATE share_grants SET revoked_at = now() WHERE id = $1', [shareId]);
        const revoked = await revokeGrantSessions(tx, shareId, 'share_rotated');
        await tx.query(
          `INSERT INTO share_grants
             (id, workspace_id, document_id, role, secret_hash, label, created_by, expires_at,
              rotated_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            workspace.id,
            documentId,
            current.role,
            sha256(secret),
            current.label,
            access.actor.userId,
            current.expiresAt,
            shareId,
          ],
        );
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'user', userId: access.actor.userId, name: access.actor.name },
          action: 'share.rotated',
          targetType: 'share',
          targetId: shareId,
          details: { documentId, newShareId: id, sessionsEnded: revoked.length },
          requestId: request.id,
        });
        const row = await loadShare(tx, ctx, documentId, id);
        if (!row) throw new Error('rotated share was not created');
        return { row, revoked };
      });
      await ctx.collab.reevaluateSessions(outcome.revoked);
      await ctx.collab.reevaluateDocument(documentId);
      reply.code(201);
      return {
        share: present(ctx, outcome.row),
        url: buildShareUrl(config.publicOrigin, id, secret),
      };
    },
  );

  // Public: exchanges a share link (grant id + secret from the URL fragment,
  // sent in the body) for a session scoped to that one document.
  app.post(
    '/api/share/exchange',
    { config: { originOptional: true } },
    async (request, reply): Promise<ShareExchangeResponse> => {
      const body = parseInput(ShareExchangeRequest, request.body);
      await limits.shareExchangeIp.assertAllowed(request, request.ip);
      await limits.shareExchangeGrant.assertAllowed(request, body.grantId);

      const found = await db.query<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM share_grants g WHERE g.id = $1 AND g.workspace_id = $2`,
        [body.grantId, workspace.id],
      );
      const grant = found.rows[0];
      // Compare even when the grant is unknown, so both cases take the same time.
      const matches = safeEqual(sha256(body.secret), grant?.secretHash ?? sha256(''));
      if (!grant || !matches) {
        await limits.shareExchangeIp.recordFailure(request, request.ip);
        await limits.shareExchangeGrant.recordFailure(request, body.grantId);
        if (grant) {
          await tryAudit(db, ctx.logger, {
            workspaceId: workspace.id,
            actor: { kind: 'system', name: 'anonymous' },
            action: 'share.exchange_failed',
            targetType: 'share',
            targetId: grant.id,
            requestId: request.id,
          });
        }
        throw errors.shareInvalid();
      }
      // Only someone holding the secret learns the state of the link.
      const state = grantState(grant);
      if (state === 'revoked') throw errors.shareRevoked();
      if (state === 'expired') throw errors.shareExpired();
      const document = await getDocument(db, workspace.id, grant.documentId);
      if (!document) throw errors.shareInvalid();
      if (document.status === 'trashed') throw errors.documentTrashed();

      // Every exchange is its own session. (The share cookie is scoped to the
      // document's API path, so it is not even sent to this endpoint.)
      const created = await db.tx(async (tx) => {
        const session = await createSession(tx, config.sessions, {
          workspaceId: workspace.id,
          // 'bearer' is the desktop "Paste share link" flow: a document-scoped desktop session.
          kind: body.mode === 'bearer' ? 'desktop' : 'share',
          shareGrantId: grant.id,
          documentId: document.id,
          guestName: guestName(),
          notAfter: grant.expiresAt,
        });
        await tx.query('UPDATE share_grants SET last_used_at = now() WHERE id = $1', [grant.id]);
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: { kind: 'guest', name: session.session.guestName },
          action: 'share.exchanged',
          targetType: 'share',
          targetId: grant.id,
          details: { documentId: document.id, mode: body.mode, role: grant.role },
          requestId: request.id,
        });
        return session;
      });
      const sessionExpiresAt = created.session.expiresAt;
      let token: string | undefined;
      if (body.mode === 'bearer') {
        token = created.token;
      } else {
        // Scoped to this document's endpoints, so several shared documents can be open at once.
        reply.setCookie(
          shareCookieName(document.id),
          created.token,
          cookieOptions(ctx, shareCookiePath(document.id), created.session.expiresAt),
        );
      }

      const expiresAt =
        grant.expiresAt && grant.expiresAt < sessionExpiresAt ? grant.expiresAt : sessionExpiresAt;
      return {
        documentId: document.id,
        title: document.title,
        role: grant.role,
        expiresAt: expiresAt.toISOString(),
        ...(token ? { token } : {}),
      };
    },
  );

  // A guest leaves: ends the share session and clears its cookie.
  app.post('/api/documents/:documentId/share-session/end', async (request, reply) => {
    const documentId = param(request, 'documentId');
    if (!isUuid(documentId)) return reply.code(204).send();
    const cookieName = shareCookieName(documentId);
    const session = await findSessionByToken(db, workspace.id, request.cookies[cookieName]);
    reply.clearCookie(cookieName, cookieOptions(ctx, shareCookiePath(documentId)));
    if (session && session.kind === 'share' && session.documentId === documentId) {
      const revoked = await revokeSessionTree(db, session.id, 'guest_ended', 'parent_logout');
      await ctx.collab.reevaluateSessions(revoked);
    }
    return reply.code(204).send();
  });
}
