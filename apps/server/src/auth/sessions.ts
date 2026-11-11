/**
 * Session storage. Tokens are 32 random bytes; only their SHA-256 is stored.
 * Absolute expiry is a column, idle expiry is derived from `last_seen_at`.
 */
import type { Config } from '../config';
import type { Queryable } from '../db/pool';
import { SESSION_COLUMNS, type SessionKind, type SessionRow } from '../db/rows';
import { newId, randomToken, sha256 } from './tokens';

export type SessionStatus = 'valid' | 'expired' | 'revoked';

/** Why a session was revoked; decides what a live connection is told. */
export type RevokeReason =
  | 'logout'
  | 'parent_logout'
  | 'guest_ended'
  | 'desktop_logout'
  | 'password_changed'
  | 'password_reset'
  | 'revoked_by_user'
  | 'user_disabled'
  | 'share_revoked'
  | 'share_rotated';

/** Reasons that mean "the user ended it themselves" rather than "access was taken away". */
export const ENDED_REASONS: ReadonlySet<string> = new Set<RevokeReason>([
  'logout',
  'parent_logout',
  'guest_ended',
  'desktop_logout',
  'password_changed',
  'password_reset',
  'revoked_by_user',
]);

export function idleSecondsFor(kind: SessionKind, ttl: Config['sessions']): number {
  if (kind === 'user') return ttl.userIdleSeconds;
  if (kind === 'share') return ttl.shareIdleSeconds;
  return ttl.desktopIdleSeconds;
}

export function absoluteSecondsFor(kind: SessionKind, ttl: Config['sessions']): number {
  if (kind === 'user') return ttl.userTtlSeconds;
  if (kind === 'share') return ttl.shareTtlSeconds;
  return ttl.desktopTtlSeconds;
}

export function sessionStatus(
  session: SessionRow,
  ttl: Config['sessions'],
  now: number = Date.now(),
): SessionStatus {
  if (session.revokedAt) return 'revoked';
  if (session.expiresAt.getTime() <= now) return 'expired';
  const idleDeadline = session.lastSeenAt.getTime() + idleSecondsFor(session.kind, ttl) * 1000;
  return idleDeadline <= now ? 'expired' : 'valid';
}

export interface NewSession {
  workspaceId: string;
  kind: SessionKind;
  userId?: string | null;
  shareGrantId?: string | null;
  documentId?: string | null;
  parentSessionId?: string | null;
  guestName?: string | null;
  /** Upper bound for the absolute expiry (for example the share grant's expiry). */
  notAfter?: Date | null;
}

export async function createSession(
  db: Queryable,
  ttl: Config['sessions'],
  input: NewSession,
): Promise<{ token: string; session: SessionRow }> {
  const token = randomToken();
  let expiresAt = new Date(Date.now() + absoluteSecondsFor(input.kind, ttl) * 1000);
  if (input.notAfter && input.notAfter < expiresAt) expiresAt = input.notAfter;
  const result = await db.query<SessionRow>(
    `INSERT INTO sessions
       (id, workspace_id, kind, token_hash, user_id, share_grant_id, document_id,
        parent_session_id, guest_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${SESSION_COLUMNS}`,
    [
      newId(),
      input.workspaceId,
      input.kind,
      sha256(token),
      input.userId ?? null,
      input.shareGrantId ?? null,
      input.documentId ?? null,
      input.parentSessionId ?? null,
      input.guestName ?? null,
      expiresAt,
    ],
  );
  const session = result.rows[0];
  if (!session) throw new Error('session insert returned no row');
  return { token, session };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Looks a session up by its raw token. Returns it even when expired or revoked. */
export async function findSessionByToken(
  db: Queryable,
  workspaceId: string,
  token: string | undefined | null,
): Promise<SessionRow | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const result = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE token_hash = $1 AND workspace_id = $2`,
    [sha256(token), workspaceId],
  );
  return result.rows[0] ?? null;
}

export async function findSessionsByIds(
  db: Queryable,
  workspaceId: string,
  ids: readonly string[],
): Promise<SessionRow[]> {
  if (ids.length === 0) return [];
  const result = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
    [ids, workspaceId],
  );
  return result.rows;
}

/** Records activity, at most once a minute per session to keep writes rare. */
export async function touchSessions(db: Queryable, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `UPDATE sessions SET last_seen_at = now()
      WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL
        AND last_seen_at < now() - interval '60 seconds'`,
    [ids],
  );
}

/** Revokes one session and every session derived from it (desktop handoffs). */
export async function revokeSessionTree(
  db: Queryable,
  sessionId: string,
  reason: RevokeReason,
  derivedReason: RevokeReason = reason,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM sessions WHERE id = $1
       UNION
       SELECT s.id FROM sessions s JOIN tree t ON s.parent_session_id = t.id
     )
     UPDATE sessions s
        SET revoked_at = now(),
            revoked_reason = CASE WHEN s.id = $1 THEN $2::text ELSE $3::text END
       FROM tree
      WHERE s.id = tree.id AND s.revoked_at IS NULL
      RETURNING s.id`,
    [sessionId, reason, derivedReason],
  );
  return result.rows.map((row) => row.id);
}

/**
 * Revokes every session of an account: browser sessions and the desktop
 * sessions created from them. `keepSessionId` and everything derived from it
 * (its desktop handoffs, and theirs) stay valid.
 */
export async function revokeUserSessions(
  db: Queryable,
  userId: string,
  reason: RevokeReason,
  keepSessionId: string | null = null,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `WITH RECURSIVE keep AS (
       SELECT id FROM sessions WHERE id = $3::uuid
       UNION
       SELECT s.id FROM sessions s JOIN keep k ON s.parent_session_id = k.id
     )
     UPDATE sessions
        SET revoked_at = now(), revoked_reason = $2::text
      WHERE user_id = $1 AND revoked_at IS NULL
        AND id NOT IN (SELECT id FROM keep)
      RETURNING id`,
    [userId, reason, keepSessionId],
  );
  return result.rows.map((row) => row.id);
}

/** Revokes every session derived from a share grant (browser guests and desktop). */
export async function revokeGrantSessions(
  db: Queryable,
  grantId: string,
  reason: RevokeReason,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $2::text
      WHERE share_grant_id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [grantId, reason],
  );
  return result.rows.map((row) => row.id);
}
