/**
 * The one place where "may this principal reach this document, and as what?"
 * is decided. HTTP routes, uploads, downloads, exports, snapshot operations,
 * collaboration tickets and live-connection re-evaluation all call
 * `resolveAccess`; nothing else reads memberships or share grants to make an
 * authorization decision.
 */
import {
  roleRank,
  type AccessChange,
  type AccessVia,
  type DocumentRole,
  type EffectiveRole,
  type ErrorCode,
  type InterviewStatus,
  type ParticipantRole,
  type SessionPermissions,
} from '@realtimedocs/contracts';
import { ENDED_REASONS, sessionStatus } from '../auth/sessions';
import { isClosedStatus } from '../service/state-machine';
import type { Config } from '../config';
import type { Queryable } from '../db/pool';
import {
  DOCUMENT_COLUMNS,
  GRANT_COLUMNS,
  USER_COLUMNS,
  type DocumentRow,
  type GrantRow,
  type SessionRow,
  type UserRow,
} from '../db/rows';

export type DenyReason =
  | 'session_ended'
  | 'session_revoked'
  | 'session_expired'
  | 'user_disabled'
  | 'no_membership'
  | 'grant_revoked'
  | 'grant_expired'
  | 'scope_mismatch';

/** What one valid principal contributes. */
export interface PrincipalGrant {
  sessionId: string;
  role: EffectiveRole;
  via: AccessVia;
  expiresAt: Date | null;
  userId: string | null;
  grantId: string | null;
  /** Only a browser session of a workspace administrator may manage a document. */
  manage: boolean;
}

export interface Actor {
  kind: 'user' | 'guest';
  userId: string | null;
  name: string;
  sessionId: string;
}

/** The interview participant behind a share-link permission, when it is one. */
export interface ParticipantAccess {
  sessionId: string;
  participantId: string;
  role: ParticipantRole;
  name: string;
}

/** What the caller may do besides reading and editing. Decided here, enforced by the routes. */
export interface AccessCapabilities {
  canExport: boolean;
  canViewHistory: boolean;
  canShare: boolean;
  canUseDesktop: boolean;
}

interface ParticipantInfo extends ParticipantAccess {
  grantId: string;
  sessionStatus: InterviewStatus;
  permissions: Partial<SessionPermissions>;
}

export interface AccessGranted {
  ok: true;
  document: DocumentRow;
  /** Effective role after the archive cap. Never taken from the client. */
  role: EffectiveRole;
  via: AccessVia;
  /** When the winning permission ends on its own, if it does. */
  expiresAt: Date | null;
  /** Account behind the request, if any (also for share links opened while signed in). */
  accountId: string | null;
  canManage: boolean;
  /**
   * Who is acting, for presence and audit: the signed-in account when there is
   * one (even if the winning permission is a share link), otherwise the guest.
   */
  actor: Actor;
  /** Session behind the winning permission (a desktop handoff is derived from it). */
  principalSessionId: string;
  /** Share grant behind the winning permission, when `via` is `share_link`. */
  grantId: string | null;
  /** Every session that currently contributes a permission. */
  grantingSessionIds: string[];
  /** Interview participant behind the winning permission, if any. */
  participant: ParticipantAccess | null;
  capabilities: AccessCapabilities;
}

export interface AccessDenied {
  ok: false;
  /** Error for an HTTP caller. */
  error: Extract<
    ErrorCode,
    | 'unauthenticated'
    | 'session_expired'
    | 'share_revoked'
    | 'share_expired'
    | 'not_found'
    | 'document_trashed'
    | 'session_closed'
  >;
  /** Reason for a live collaboration connection that just lost access. */
  change: Exclude<AccessChange, 'role_changed'>;
}

export type AccessResult = AccessGranted | AccessDenied;

export interface ResolveOptions {
  /** Administrator lifecycle routes (restore, delete, metadata) may reach trashed documents. */
  allowTrashed?: boolean;
  /**
   * Sessions that contributed a permission the last time this was resolved.
   * Lets a live connection be told precisely why its access ended.
   */
  previouslyGranting?: ReadonlySet<string>;
  now?: number;
}

export interface AccessDeps {
  db: Queryable;
  sessionTtl: Config['sessions'];
  workspaceId: string;
}

const VIA_RANK: Record<AccessVia, number> = { workspace_admin: 3, membership: 2, share_link: 1 };

function minDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function denialToChange(reasons: DenyReason[]): Exclude<AccessChange, 'role_changed'> {
  const has = (...candidates: DenyReason[]) => reasons.some((r) => candidates.includes(r));
  if (has('grant_revoked', 'user_disabled', 'no_membership', 'session_revoked')) return 'revoked';
  if (has('session_ended')) return 'session_ended';
  if (has('grant_expired', 'session_expired')) return 'expired';
  return 'revoked';
}

/**
 * Resolves the access of a set of principals (sessions) to one document.
 *
 * `sessions` are raw rows: expired and revoked ones are expected here and are
 * rejected below, so callers never pre-filter.
 */
export async function resolveAccess(
  deps: AccessDeps,
  sessions: readonly SessionRow[],
  documentId: string,
  options: ResolveOptions = {},
): Promise<AccessResult> {
  const now = options.now ?? Date.now();
  const { db, workspaceId } = deps;
  const own = sessions.filter((session) => session.workspaceId === workspaceId);

  const userIds = [...new Set(own.map((s) => s.userId).filter((id): id is string => id !== null))];
  const grantIds = [
    ...new Set(own.map((s) => s.shareGrantId).filter((id): id is string => id !== null)),
  ];

  const [documentResult, userResult, memberResult, grantResult, participantResult] =
    await Promise.all([
      db.query<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM documents d WHERE d.id = $1 AND d.workspace_id = $2`,
        [documentId, workspaceId],
      ),
      userIds.length > 0
        ? db.query<UserRow>(
            `SELECT ${USER_COLUMNS} FROM users WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
            [userIds, workspaceId],
          )
        : null,
      userIds.length > 0
        ? db.query<{ userId: string; role: DocumentRole }>(
            `SELECT user_id AS "userId", role FROM document_members
            WHERE document_id = $1 AND workspace_id = $2 AND user_id = ANY($3::uuid[])`,
            [documentId, workspaceId, userIds],
          )
        : null,
      grantIds.length > 0
        ? db.query<GrantRow>(
            `SELECT ${GRANT_COLUMNS} FROM share_grants g
            WHERE g.id = ANY($1::uuid[]) AND g.workspace_id = $2 AND g.document_id = $3`,
            [grantIds, workspaceId, documentId],
          )
        : null,
      grantIds.length > 0
        ? db.query<ParticipantInfo>(
            `SELECT g.id AS "grantId", p.id AS "participantId", p.session_id AS "sessionId",
                  p.role, p.name, s.status AS "sessionStatus", s.permissions
             FROM share_grants g
             JOIN interview_participants p ON p.id = g.participant_id
             JOIN interview_sessions s ON s.id = p.session_id
            WHERE g.id = ANY($1::uuid[]) AND g.workspace_id = $2 AND g.document_id = $3`,
            [grantIds, workspaceId, documentId],
          )
        : null,
    ]);

  const document = documentResult.rows[0] ?? null;
  const users = new Map((userResult?.rows ?? []).map((user) => [user.id, user]));
  const memberships = new Map((memberResult?.rows ?? []).map((row) => [row.userId, row.role]));
  const grants = new Map((grantResult?.rows ?? []).map((grant) => [grant.id, grant]));
  const participants = new Map((participantResult?.rows ?? []).map((info) => [info.grantId, info]));

  const granted: PrincipalGrant[] = [];
  const denials = new Map<string, DenyReason>();
  let anyValidPrincipal = false;
  let anySessionExpired = false;
  let shareError: 'share_revoked' | 'share_expired' | 'session_closed' | null = null;
  let accountUser: UserRow | null = null;
  const names = new Map<string, Actor>();

  for (const session of own) {
    const grant = session.shareGrantId ? (grants.get(session.shareGrantId) ?? null) : null;

    // A dead share grant explains itself, whatever happened to the session row.
    const participantInfo = session.shareGrantId
      ? (participants.get(session.shareGrantId) ?? null)
      : null;
    const sessionClosed = participantInfo ? isClosedStatus(participantInfo.sessionStatus) : false;
    if (session.shareGrantId && grant) {
      if (grant.revokedAt) {
        denials.set(session.id, 'grant_revoked');
        // A link that ended because the interview ended says so.
        shareError = sessionClosed ? 'session_closed' : 'share_revoked';
        continue;
      }
      // A candidate is out as soon as the session is over, whatever the state of the link.
      if (sessionClosed && participantInfo?.role === 'candidate') {
        denials.set(session.id, 'grant_revoked');
        shareError = 'session_closed';
        continue;
      }
      if (grant.expiresAt && grant.expiresAt.getTime() <= now) {
        denials.set(session.id, 'grant_expired');
        shareError ??= 'share_expired';
        continue;
      }
    }

    const status = sessionStatus(session, deps.sessionTtl, now);
    if (status === 'revoked') {
      denials.set(
        session.id,
        ENDED_REASONS.has(session.revokedReason ?? '') ? 'session_ended' : 'session_revoked',
      );
      continue;
    }
    if (status === 'expired') {
      denials.set(session.id, 'session_expired');
      anySessionExpired = true;
      continue;
    }

    // Share and desktop sessions are bound to exactly one document.
    if (session.kind !== 'user' && session.documentId !== documentId) {
      anyValidPrincipal = true;
      denials.set(session.id, 'scope_mismatch');
      continue;
    }

    if (session.userId) {
      const user = users.get(session.userId);
      if (!user || user.status !== 'active') {
        denials.set(session.id, 'user_disabled');
        continue;
      }
      anyValidPrincipal = true;
      accountUser ??= user;
      names.set(session.id, {
        kind: 'user',
        userId: user.id,
        name: user.displayName,
        sessionId: session.id,
      });
      if (!document) continue;
      const isBrowser = session.kind === 'user';
      if (user.role === 'admin') {
        granted.push({
          sessionId: session.id,
          // Desktop sessions never carry management rights: administration stays in the browser.
          role: isBrowser ? 'admin' : 'editor',
          via: 'workspace_admin',
          expiresAt: session.expiresAt,
          userId: user.id,
          grantId: null,
          manage: isBrowser,
        });
        continue;
      }
      const membership = memberships.get(user.id);
      if (!membership) {
        denials.set(session.id, 'no_membership');
        continue;
      }
      granted.push({
        sessionId: session.id,
        role: membership,
        via: 'membership',
        expiresAt: session.expiresAt,
        userId: user.id,
        grantId: null,
        manage: false,
      });
      continue;
    }

    // Grant-bound session (share guest, or a desktop session derived from one).
    anyValidPrincipal = true;
    if (!grant) {
      denials.set(session.id, 'scope_mismatch');
      continue;
    }
    names.set(session.id, {
      kind: 'guest',
      userId: null,
      // Interview participants appear under the name the organiser registered.
      name: participantInfo?.name ?? session.guestName ?? 'Guest',
      sessionId: session.id,
    });
    granted.push({
      sessionId: session.id,
      // After the interview, interviewers keep read access until their link expires.
      role: sessionClosed ? 'viewer' : grant.role,
      via: 'share_link',
      expiresAt: minDate(grant.expiresAt, session.expiresAt),
      userId: null,
      grantId: grant.id,
      manage: false,
    });
  }

  const relevantDenials = (): DenyReason[] => {
    const previous = options.previouslyGranting;
    const all = [...denials.entries()];
    const scoped = previous ? all.filter(([sessionId]) => previous.has(sessionId)) : all;
    return (scoped.length > 0 ? scoped : all).map(([, reason]) => reason);
  };

  if (!document || granted.length === 0) {
    let error: AccessDenied['error'];
    if (document && shareError) error = shareError;
    else if (anyValidPrincipal) error = 'not_found';
    else if (anySessionExpired) error = 'session_expired';
    else error = 'unauthenticated';
    return {
      ok: false,
      error,
      change: document ? denialToChange(relevantDenials()) : 'document_unavailable',
    };
  }

  let winner = granted[0] as PrincipalGrant;
  for (const candidate of granted) {
    const better =
      roleRank(candidate.role) > roleRank(winner.role) ||
      (roleRank(candidate.role) === roleRank(winner.role) &&
        VIA_RANK[candidate.via] > VIA_RANK[winner.via]);
    if (better) winner = candidate;
  }
  const canManage = granted.some((grant) => grant.manage);

  if (document.status === 'trashed' && !(options.allowTrashed && canManage)) {
    return { ok: false, error: 'document_trashed', change: 'document_unavailable' };
  }

  // Archived documents are read-only for everyone, administrators included.
  const role: EffectiveRole = document.status === 'active' ? winner.role : 'viewer';
  const accountActor = [...names.values()].find((candidate) => candidate.kind === 'user');
  const actor = accountActor ??
    names.get(winner.sessionId) ?? {
      kind: 'guest' as const,
      userId: null,
      name: 'Guest',
      sessionId: winner.sessionId,
    };

  const winnerParticipant = winner.grantId ? (participants.get(winner.grantId) ?? null) : null;
  const permissions = winnerParticipant?.permissions ?? {};
  const isCandidate = winnerParticipant?.role === 'candidate';
  const capabilities: AccessCapabilities = {
    canExport: isCandidate ? permissions.candidateCanExport === true : true,
    canViewHistory: isCandidate ? permissions.candidateCanViewHistory === true : true,
    canShare: canManage,
    // The desktop app is for staff; a candidate never gets a handoff.
    canUseDesktop: !isCandidate,
  };

  return {
    ok: true,
    document,
    role,
    via: winner.via,
    expiresAt: winner.expiresAt,
    accountId: accountUser?.id ?? null,
    canManage,
    actor,
    principalSessionId: winner.sessionId,
    grantId: winner.grantId,
    grantingSessionIds: granted.map((grant) => grant.sessionId),
    participant: winnerParticipant
      ? {
          sessionId: winnerParticipant.sessionId,
          participantId: winnerParticipant.participantId,
          role: winnerParticipant.role,
          name: winnerParticipant.name,
        }
      : null,
    capabilities,
  };
}
