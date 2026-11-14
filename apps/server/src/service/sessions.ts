/**
 * Interview sessions: one session = one document = one collaboration room.
 * Every participant's access link is an ordinary share grant
 * (`share_grants.participant_id`), so expiry, revocation, rotation and live
 * disconnection are the existing share-link machinery.
 *
 * These functions serve both the service API (`/api/v1`, an API key) and the
 * admin UI (`/api/admin`, a signed-in administrator); the caller passes the
 * `OperationActor`.
 */
import {
  buildShareUrl,
  type AddParticipantRequest,
  type CreateInterviewSessionRequest,
  type CreateInterviewSessionResponse,
  type InterviewSession,
  type InterviewSessionsPage,
  type InterviewStatus,
  type ListInterviewSessionsQuery,
  type ParticipantRole,
  type ParticipantWithAccess,
  type RotateLinksResponse,
  type SessionAuditPage,
  type SessionDocumentResponse,
  type SessionParticipant,
  type SessionPermissions,
  type UpdateInterviewSessionRequest,
  DEFAULT_SESSION_PERMISSIONS,
  SessionPermissions as SessionPermissionsSchema,
} from '@realtimedocs/contracts';
import { writeAudit, type AuditDetails } from '../audit';
import { revokeGrantSessions } from '../auth/sessions';
import { newId, randomToken, sha256 } from '../auth/tokens';
import type { AppContext } from '../context';
import type { Db, Queryable } from '../db/pool';
import { insertDocument, loadDurableState } from '../documents/store';
import { stateToJson, ydocToJson } from '../documents/ydoc';
import { errors } from '../errors';
import { auditActorOf, type OperationActor } from './actor';
import { decodeCursor, encodeCursor } from './pagination';
import { isClosedStatus, isEditableStatus, nextStatus, type SessionAction } from './state-machine';
import { uniqueTitle } from './title';
import {
  linkInterviewerAccounts,
  setLinkedInterviewerRole,
  unlinkInterviewerAccounts,
  type MemberRole,
} from './interviewer-accounts';
import { emitWebhookEvent } from './webhooks';

const MAX_INTERVIEWERS = 20;

/** Runs in the creating transaction (the idempotency record is completed there). */
export type CreateFinalizer = (
  tx: Queryable,
  response: CreateInterviewSessionResponse,
) => Promise<void>;

interface SessionRow {
  id: string;
  documentId: string;
  status: InterviewStatus;
  companyName: string;
  roundNumber: number;
  roundName: string | null;
  scheduledAt: Date;
  timezone: string;
  expiresAt: Date;
  permissions: Partial<SessionPermissions>;
  metadata: Record<string, string>;
  generatedTitle: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  archivedAt: Date | null;
}

const SESSION_COLUMNS = `
  s.id, s.document_id AS "documentId", s.status, s.company_name AS "companyName",
  s.round_number AS "roundNumber", s.round_name AS "roundName", s.scheduled_at AS "scheduledAt",
  s.timezone, s.expires_at AS "expiresAt", s.permissions, s.metadata,
  s.generated_title AS "generatedTitle", d.title, s.created_at AS "createdAt",
  s.updated_at AS "updatedAt", s.started_at AS "startedAt", s.completed_at AS "completedAt",
  s.cancelled_at AS "cancelledAt", s.archived_at AS "archivedAt"`;

const SESSION_FROM = 'interview_sessions s JOIN documents d ON d.id = s.document_id';

interface ParticipantRow {
  id: string;
  sessionId: string;
  role: ParticipantRole;
  name: string;
  email: string;
  shareGrantId: string | null;
  firstJoinedAt: Date | null;
  lastJoinedAt: Date | null;
  removedAt: Date | null;
  grantRevokedAt: Date | null;
  grantExpiresAt: Date | null;
  accountLinked: boolean;
}

const PARTICIPANT_COLUMNS = `
  p.id, p.session_id AS "sessionId", p.role, p.name, p.email::text AS email,
  p.share_grant_id AS "shareGrantId", p.first_joined_at AS "firstJoinedAt",
  p.last_joined_at AS "lastJoinedAt", p.removed_at AS "removedAt",
  g.revoked_at AS "grantRevokedAt", g.expires_at AS "grantExpiresAt",
  EXISTS (SELECT 1 FROM document_members m WHERE m.interview_participant_id = p.id)
    AS "accountLinked"`;

const PARTICIPANT_FROM =
  'interview_participants p LEFT JOIN share_grants g ON g.id = p.share_grant_id';

function effectivePermissions(raw: Partial<SessionPermissions>): SessionPermissions {
  return SessionPermissionsSchema.parse({ ...DEFAULT_SESSION_PERMISSIONS, ...raw });
}

function adminUrl(id: string): string {
  return `/admin/interview-sessions/${id}`;
}

function linkState(row: ParticipantRow): SessionParticipant['linkState'] {
  if (!row.shareGrantId) return 'none';
  if (row.grantRevokedAt) return 'revoked';
  if (row.grantExpiresAt && row.grantExpiresAt.getTime() <= Date.now()) return 'expired';
  return 'active';
}

function toParticipant(row: ParticipantRow, live: Map<string, number>): SessionParticipant {
  return {
    participantId: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    firstJoinedAt: row.firstJoinedAt ? row.firstJoinedAt.toISOString() : null,
    lastJoinedAt: row.lastJoinedAt ? row.lastJoinedAt.toISOString() : null,
    removedAt: row.removedAt ? row.removedAt.toISOString() : null,
    linkState: row.removedAt ? 'revoked' : linkState(row),
    liveConnections: row.shareGrantId ? (live.get(row.shareGrantId) ?? 0) : 0,
    accountLinked: row.accountLinked,
  };
}

function toSession(
  ctx: AppContext,
  row: SessionRow,
  participants: ParticipantRow[],
): InterviewSession {
  const live = ctx.collab.liveConnectionsByGrant(row.documentId);
  return {
    sessionId: row.id,
    documentId: row.documentId,
    title: row.title,
    generatedTitle: row.generatedTitle,
    status: row.status,
    companyName: row.companyName,
    // Strings, like the values the create request takes.
    round: { number: String(row.roundNumber), name: row.roundName },
    scheduledAt: row.scheduledAt.toISOString(),
    timezone: row.timezone,
    expiresAt: row.expiresAt.toISOString(),
    permissions: effectivePermissions(row.permissions),
    metadata: row.metadata,
    participants: participants.map((p) => toParticipant(p, live)),
    adminUrl: adminUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

async function loadSessionRow(
  db: Queryable,
  workspaceId: string,
  id: string,
  lock = false,
): Promise<SessionRow | null> {
  const result = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM ${SESSION_FROM}
      WHERE s.id = $1 AND s.workspace_id = $2 ${lock ? 'FOR UPDATE OF s' : ''}`,
    [id, workspaceId],
  );
  return result.rows[0] ?? null;
}

async function loadParticipants(
  db: Queryable,
  workspaceId: string,
  sessionIds: readonly string[],
): Promise<ParticipantRow[]> {
  if (sessionIds.length === 0) return [];
  const result = await db.query<ParticipantRow>(
    `SELECT ${PARTICIPANT_COLUMNS} FROM ${PARTICIPANT_FROM}
      WHERE p.session_id = ANY($1::uuid[]) AND p.workspace_id = $2
      ORDER BY (p.role = 'candidate') DESC, p.created_at, p.id`,
    [sessionIds, workspaceId],
  );
  return result.rows;
}

async function requireSession(
  db: Queryable,
  workspaceId: string,
  id: string,
  lock = false,
): Promise<SessionRow> {
  const row = await loadSessionRow(db, workspaceId, id, lock);
  if (!row) throw errors.notFound('That interview session does not exist.');
  return row;
}

async function presentSession(
  ctx: AppContext,
  db: Queryable,
  id: string,
): Promise<InterviewSession> {
  const row = await requireSession(db, ctx.workspace.id, id);
  const participants = await loadParticipants(db, ctx.workspace.id, [id]);
  return toSession(ctx, row, participants);
}

export async function getSession(ctx: AppContext, id: string): Promise<InterviewSession> {
  return presentSession(ctx, ctx.db, id);
}

// ── Grants of participants ──────────────────────────────────────────────────

function grantRoleFor(role: ParticipantRole, permissions: SessionPermissions): 'viewer' | 'editor' {
  const canEdit =
    role === 'candidate' ? permissions.candidateCanEdit : permissions.interviewerCanEdit;
  return canEdit ? 'editor' : 'viewer';
}

/** The role of an interviewer's account membership: what their link allows. */
function memberRoleFor(permissions: SessionPermissions): MemberRole {
  return grantRoleFor('interviewer', permissions);
}

interface NewGrant {
  grantId: string;
  secret: string;
  url: string;
}

async function insertGrant(
  ctx: AppContext,
  tx: Queryable,
  input: {
    documentId: string;
    participantId: string;
    role: ParticipantRole;
    name: string;
    permissions: SessionPermissions;
    expiresAt: Date;
    createdBy: string | null;
    rotatedFrom?: string | null;
  },
): Promise<NewGrant> {
  const grantId = newId();
  const secret = randomToken();
  await tx.query(
    `INSERT INTO share_grants
       (id, workspace_id, document_id, role, secret_hash, label, created_by, expires_at,
        rotated_from, participant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      grantId,
      ctx.workspace.id,
      input.documentId,
      grantRoleFor(input.role, input.permissions),
      sha256(secret),
      `${input.role}: ${input.name}`.slice(0, 80),
      input.createdBy,
      input.expiresAt,
      input.rotatedFrom ?? null,
      input.participantId,
    ],
  );
  await tx.query('UPDATE interview_participants SET share_grant_id = $1 WHERE id = $2', [
    grantId,
    input.participantId,
  ]);
  return { grantId, secret, url: buildShareUrl(ctx.config.publicOrigin, grantId, secret) };
}

function creatorId(actor: OperationActor): string | null {
  return actor.kind === 'user' ? actor.userId : null;
}

function withAccess(
  participant: { id: string; role: ParticipantRole; name: string; email: string },
  grant: NewGrant,
  expiresAt: Date,
): ParticipantWithAccess {
  return {
    participantId: participant.id,
    role: participant.role,
    name: participant.name,
    email: participant.email,
    access: { url: grant.url, expiresAt: expiresAt.toISOString() },
  };
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createSession(
  ctx: AppContext,
  actor: OperationActor,
  input: CreateInterviewSessionRequest,
  requestId: string,
  finalize?: CreateFinalizer,
): Promise<CreateInterviewSessionResponse> {
  const { db, workspace } = ctx;
  const permissions = effectivePermissions(input.permissions ?? {});
  // The request takes the round as a string of digits (or, still, a number); it is stored as an integer.
  const roundNumber = Number(input.round.number);
  const scheduledAt = new Date(input.scheduledAt);
  const expiresAt = new Date(input.expiresAt);
  const title = await uniqueTitle(
    {
      candidateName: input.candidate.name,
      companyName: input.companyName,
      roundNumber: roundNumber,
      scheduledAt,
      timezone: input.timezone,
    },
    async (candidate) => {
      const taken = await db.query(
        `SELECT 1 FROM documents WHERE workspace_id = $1 AND status <> 'trashed' AND lower(title) = lower($2) LIMIT 1`,
        [workspace.id, candidate],
      );
      return taken.rows.length > 0;
    },
  );

  const sessionId = newId();
  return db.tx(async (tx) => {
    const document = await insertDocument(tx, {
      workspaceId: workspace.id,
      title,
      createdBy: creatorId(actor),
    });
    await tx.query(
      `INSERT INTO interview_sessions
         (id, workspace_id, document_id, status, company_name, round_number, round_name,
          scheduled_at, timezone, expires_at, permissions, metadata, generated_title,
          created_by_key_id, created_by_user_id)
       VALUES ($1, $2, $3, 'scheduled', $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14)`,
      [
        sessionId,
        workspace.id,
        document.id,
        input.companyName,
        roundNumber,
        input.round.name ?? null,
        scheduledAt,
        input.timezone,
        expiresAt,
        JSON.stringify(permissions),
        JSON.stringify(input.metadata ?? {}),
        title,
        actor.kind === 'service' ? actor.keyId : null,
        creatorId(actor),
      ],
    );

    const people: { role: ParticipantRole; name: string; email: string }[] = [
      { role: 'candidate', ...input.candidate },
      ...input.interviewers.map((person) => ({ role: 'interviewer' as const, ...person })),
    ];
    const participants: ParticipantWithAccess[] = [];
    for (const person of people) {
      const participantId = newId();
      await tx.query(
        `INSERT INTO interview_participants (id, workspace_id, session_id, role, name, email)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [participantId, workspace.id, sessionId, person.role, person.name, person.email],
      );
      const grant = await insertGrant(ctx, tx, {
        documentId: document.id,
        participantId,
        role: person.role,
        name: person.name,
        permissions,
        expiresAt,
        createdBy: creatorId(actor),
      });
      participants.push(withAccess({ id: participantId, ...person }, grant, expiresAt));
    }
    // Interviewers who have an account also get the document in their own list.
    const linked = new Set(
      await linkInterviewerAccounts(tx, {
        workspaceId: workspace.id,
        sessionId,
        documentId: document.id,
        role: memberRoleFor(permissions),
        grantedBy: creatorId(actor),
        audit: { actor: auditActorOf(actor), requestId },
      }),
    );
    for (const participant of participants) {
      participant.accountLinked = linked.has(participant.participantId);
    }

    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: auditActorOf(actor),
      action: 'interview_session.created',
      targetType: 'interview_session',
      targetId: sessionId,
      details: {
        documentId: document.id,
        participants: participants.length,
        round: roundNumber,
        ...(input.metadata?.externalInterviewId
          ? { externalInterviewId: input.metadata.externalInterviewId }
          : {}),
      },
      requestId,
    });
    await emitWebhookEvent(tx, workspace.id, 'session.created', {
      sessionId,
      documentId: document.id,
      status: 'scheduled',
      scheduledAt: scheduledAt.toISOString(),
      roundNumber: String(roundNumber),
      participants: participants.map((p) => ({ participantId: p.participantId, role: p.role })),
      ...(input.metadata?.externalInterviewId
        ? { externalInterviewId: input.metadata.externalInterviewId }
        : {}),
    });

    const candidate = participants[0] as ParticipantWithAccess;
    const firstInterviewer = participants[1] as ParticipantWithAccess;
    const response: CreateInterviewSessionResponse = {
      sessionId,
      documentId: document.id,
      title,
      status: 'scheduled',
      candidateAccess: candidate.access,
      interviewerAccess: firstInterviewer.access,
      participants,
      adminUrl: adminUrl(sessionId),
      createdAt: document.createdAt.toISOString(),
    };
    if (finalize) await finalize(tx, response);
    return response;
  });
}

// ── List ────────────────────────────────────────────────────────────────────

function like(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export async function listSessions(
  ctx: AppContext,
  query: ListInterviewSessionsQuery,
): Promise<InterviewSessionsPage> {
  const params: unknown[] = [ctx.workspace.id];
  const where: string[] = ['s.workspace_id = $1'];
  const add = (sql: string, ...values: unknown[]) => {
    const placeholders = values.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    where.push(sql.replace(/\?/g, () => placeholders.shift() as string));
  };
  if (query.status) add('s.status = ?', query.status);
  if (query.company) add(`s.company_name ILIKE ? ESCAPE '\\'`, like(query.company));
  if (query.round) add('s.round_number = ?', query.round);
  if (query.from) add('s.scheduled_at >= ?::timestamptz', query.from);
  if (query.to) add('s.scheduled_at <= ?::timestamptz', query.to);
  if (query.q)
    add(
      `(d.title ILIKE ? ESCAPE '\\' OR s.generated_title ILIKE ? ESCAPE '\\')`,
      like(query.q),
      like(query.q),
    );
  const person = (role: ParticipantRole, email: string) =>
    add(
      `EXISTS (SELECT 1 FROM interview_participants p WHERE p.session_id = s.id AND p.role = '${role}'
                  AND (p.email::text ILIKE ? ESCAPE '\\' OR p.name ILIKE ? ESCAPE '\\'))`,
      like(email),
      like(email),
    );
  if (query.candidateEmail) person('candidate', query.candidateEmail);
  if (query.interviewerEmail) person('interviewer', query.interviewerEmail);
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    add(
      `(date_trunc('milliseconds', s.created_at), s.id) < (?::timestamptz, ?::uuid)`,
      cursor.at,
      cursor.id,
    );
  }
  params.push(query.limit + 1);
  const result = await ctx.db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM ${SESSION_FROM}
      WHERE ${where.join(' AND ')}
      ORDER BY date_trunc('milliseconds', s.created_at) DESC, s.id DESC
      LIMIT $${params.length}`,
    params,
  );
  const more = result.rows.length > query.limit;
  const rows = more ? result.rows.slice(0, query.limit) : result.rows;
  const participants = await loadParticipants(
    ctx.db,
    ctx.workspace.id,
    rows.map((row) => row.id),
  );
  const last = rows[rows.length - 1];
  return {
    items: rows.map((row) =>
      toSession(
        ctx,
        row,
        participants.filter((p) => p.sessionId === row.id),
      ),
    ),
    nextCursor: more && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

// ── Update ──────────────────────────────────────────────────────────────────

function requireEditable(row: SessionRow): void {
  if (!isEditableStatus(row.status)) {
    throw errors.conflict(`A ${row.status} session cannot be changed.`);
  }
}

async function disconnect(
  ctx: AppContext,
  sessionIds: readonly string[],
  documentId: string,
): Promise<void> {
  await ctx.collab.reevaluateSessions([...sessionIds]);
  await ctx.collab.reevaluateDocument(documentId);
}

export async function updateSession(
  ctx: AppContext,
  actor: OperationActor,
  id: string,
  input: UpdateInterviewSessionRequest,
  requestId: string,
): Promise<InterviewSession> {
  const { db, workspace } = ctx;
  const outcome = await db.tx(async (tx) => {
    const current = await requireSession(tx, workspace.id, id, true);
    requireEditable(current);
    const permissions = effectivePermissions({
      ...current.permissions,
      ...(input.permissions ?? {}),
    });
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : current.expiresAt;
    const changed: string[] = [];
    if (input.scheduledAt) changed.push('scheduledAt');
    if (input.timezone) changed.push('timezone');
    if (input.expiresAt) changed.push('expiresAt');
    if (input.permissions) changed.push('permissions');
    if (input.companyName) changed.push('companyName');
    if (input.round) changed.push('round');
    if (input.metadata) changed.push('metadata');

    await tx.query(
      `UPDATE interview_sessions
          SET scheduled_at = $3, timezone = $4, expires_at = $5, permissions = $6::jsonb,
              company_name = $7, round_number = $8, round_name = $9, metadata = $10::jsonb,
              updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [
        id,
        workspace.id,
        input.scheduledAt ? new Date(input.scheduledAt) : current.scheduledAt,
        input.timezone ?? current.timezone,
        expiresAt,
        JSON.stringify(permissions),
        input.companyName ?? current.companyName,
        input.round?.number ?? current.roundNumber,
        input.round && 'name' in input.round ? (input.round.name ?? null) : current.roundName,
        JSON.stringify(input.metadata ?? current.metadata),
      ],
    );

    const affected: string[] = [];
    if (input.expiresAt || input.permissions) {
      // Links follow the session: expiry and (for edit/view-only) the grant role.
      const grants = await tx.query<{ id: string; role: ParticipantRole }>(
        `SELECT g.id, p.role FROM interview_participants p
           JOIN share_grants g ON g.id = p.share_grant_id
          WHERE p.session_id = $1 AND p.removed_at IS NULL AND g.revoked_at IS NULL`,
        [id],
      );
      for (const grant of grants.rows) {
        await tx.query('UPDATE share_grants SET expires_at = $2, role = $3 WHERE id = $1', [
          grant.id,
          expiresAt,
          grantRoleFor(grant.role, permissions),
        ]);
        affected.push(grant.id);
      }
      if (input.expiresAt) {
        await tx.query(
          `UPDATE sessions SET expires_at = LEAST(expires_at, $1)
            WHERE share_grant_id = ANY($2::uuid[]) AND revoked_at IS NULL`,
          [expiresAt, affected],
        );
      }
    }
    if (input.permissions) {
      await setLinkedInterviewerRole(tx, workspace.id, id, memberRoleFor(permissions), {
        actor: auditActorOf(actor),
        requestId,
      });
    }
    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: auditActorOf(actor),
      action: 'interview_session.updated',
      targetType: 'interview_session',
      targetId: id,
      details: { documentId: current.documentId, changed: changed.join(',') },
      requestId,
    });
    return { documentId: current.documentId };
  });
  // Role changes and earlier expiries reach open connections now.
  await ctx.collab.reevaluateDocument(outcome.documentId);
  return presentSession(ctx, db, id);
}

// ── Participants ────────────────────────────────────────────────────────────

export async function addParticipant(
  ctx: AppContext,
  actor: OperationActor,
  id: string,
  input: AddParticipantRequest,
  requestId: string,
): Promise<{ sessionId: string; participant: ParticipantWithAccess }> {
  const { db, workspace } = ctx;
  return db.tx(async (tx) => {
    const current = await requireSession(tx, workspace.id, id, true);
    requireEditable(current);
    const count = await tx.query<{ count: number }>(
      `SELECT count(*) AS count FROM interview_participants
        WHERE session_id = $1 AND role = 'interviewer' AND removed_at IS NULL`,
      [id],
    );
    if ((count.rows[0]?.count ?? 0) >= MAX_INTERVIEWERS) {
      throw errors.conflict(`A session has at most ${MAX_INTERVIEWERS} interviewers.`);
    }
    const permissions = effectivePermissions(current.permissions);
    const participantId = newId();
    await tx.query(
      `INSERT INTO interview_participants (id, workspace_id, session_id, role, name, email)
       VALUES ($1, $2, $3, 'interviewer', $4, $5)`,
      [participantId, workspace.id, id, input.name, input.email],
    );
    const grant = await insertGrant(ctx, tx, {
      documentId: current.documentId,
      participantId,
      role: 'interviewer',
      name: input.name,
      permissions,
      expiresAt: current.expiresAt,
      createdBy: creatorId(actor),
    });
    const linked = await linkInterviewerAccounts(tx, {
      workspaceId: workspace.id,
      sessionId: id,
      documentId: current.documentId,
      role: memberRoleFor(permissions),
      grantedBy: creatorId(actor),
      participantIds: [participantId],
      audit: { actor: auditActorOf(actor), requestId },
    });
    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: auditActorOf(actor),
      action: 'interview_session.participant_added',
      targetType: 'interview_session',
      targetId: id,
      details: { documentId: current.documentId, participantId, role: 'interviewer' },
      requestId,
    });
    return {
      sessionId: id,
      participant: {
        ...withAccess(
          { id: participantId, role: 'interviewer', name: input.name, email: input.email },
          grant,
          current.expiresAt,
        ),
        accountLinked: linked.includes(participantId),
      },
    };
  });
}

/** Revokes a participant's current link and every browser/desktop session derived from it. */
async function revokeParticipantLinks(
  tx: Queryable,
  participantIds: readonly string[],
): Promise<string[]> {
  const grants = await tx.query<{ id: string }>(
    `SELECT g.id FROM share_grants g WHERE g.participant_id = ANY($1::uuid[]) AND g.revoked_at IS NULL`,
    [participantIds],
  );
  const sessions: string[] = [];
  for (const grant of grants.rows) {
    await tx.query('UPDATE share_grants SET revoked_at = now() WHERE id = $1', [grant.id]);
    sessions.push(...(await revokeGrantSessions(tx, grant.id, 'share_revoked')));
  }
  return sessions;
}

export async function removeParticipant(
  ctx: AppContext,
  actor: OperationActor,
  id: string,
  participantId: string,
  requestId: string,
): Promise<InterviewSession> {
  const { db, workspace } = ctx;
  const outcome = await db.tx(async (tx) => {
    const current = await requireSession(tx, workspace.id, id, true);
    const found = await tx.query<{ role: ParticipantRole; removedAt: Date | null }>(
      `SELECT role, removed_at AS "removedAt" FROM interview_participants
        WHERE id = $1 AND session_id = $2 FOR UPDATE`,
      [participantId, id],
    );
    const participant = found.rows[0];
    if (!participant) throw errors.notFound('That participant does not exist.');
    if (participant.removedAt) throw errors.conflict('That participant was already removed.');
    await tx.query('UPDATE interview_participants SET removed_at = now() WHERE id = $1', [
      participantId,
    ]);
    const sessions = await revokeParticipantLinks(tx, [participantId]);
    // The membership that was created for this interviewer goes with them; one an administrator
    // added by hand stays.
    await unlinkInterviewerAccounts(tx, workspace.id, [participantId], {
      actor: auditActorOf(actor),
      requestId,
    });
    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: auditActorOf(actor),
      action: 'interview_session.participant_removed',
      targetType: 'interview_session',
      targetId: id,
      details: { documentId: current.documentId, participantId, role: participant.role },
      requestId,
    });
    await emitWebhookEvent(tx, workspace.id, 'access.revoked', {
      sessionId: id,
      documentId: current.documentId,
      participantIds: [participantId],
      roles: [participant.role],
      reason: 'participant_removed',
    });
    return { sessions, documentId: current.documentId };
  });
  await disconnect(ctx, outcome.sessions, outcome.documentId);
  return presentSession(ctx, db, id);
}

export async function rotateLinks(
  ctx: AppContext,
  actor: OperationActor,
  id: string,
  participantIds: readonly string[] | undefined,
  requestId: string,
): Promise<RotateLinksResponse> {
  const { db, workspace } = ctx;
  const outcome = await db.tx(async (tx) => {
    const current = await requireSession(tx, workspace.id, id, true);
    requireEditable(current);
    const permissions = effectivePermissions(current.permissions);
    const result = await tx.query<{
      id: string;
      role: ParticipantRole;
      name: string;
      email: string;
      shareGrantId: string | null;
    }>(
      `SELECT id, role, name, email::text AS email, share_grant_id AS "shareGrantId"
         FROM interview_participants
        WHERE session_id = $1 AND removed_at IS NULL
          AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
        ORDER BY (role = 'candidate') DESC, created_at, id
          FOR UPDATE`,
      [id, participantIds ? [...participantIds] : null],
    );
    if (participantIds) {
      const missing = participantIds.filter((pid) => !result.rows.some((row) => row.id === pid));
      if (missing.length > 0) throw errors.notFound('One of those participants does not exist.');
    }
    const sessions: string[] = [];
    const rotated: ParticipantWithAccess[] = [];
    for (const person of result.rows) {
      sessions.push(...(await revokeParticipantLinks(tx, [person.id])));
      const grant = await insertGrant(ctx, tx, {
        documentId: current.documentId,
        participantId: person.id,
        role: person.role,
        name: person.name,
        permissions,
        expiresAt: current.expiresAt,
        createdBy: creatorId(actor),
        rotatedFrom: person.shareGrantId,
      });
      rotated.push(withAccess(person, grant, current.expiresAt));
    }
    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: auditActorOf(actor),
      action: 'interview_session.links_rotated',
      targetType: 'interview_session',
      targetId: id,
      details: { documentId: current.documentId, participants: rotated.length },
      requestId,
    });
    if (rotated.length > 0) {
      await emitWebhookEvent(tx, workspace.id, 'access.revoked', {
        sessionId: id,
        documentId: current.documentId,
        participantIds: rotated.map((p) => p.participantId),
        roles: rotated.map((p) => p.role),
        reason: 'links_rotated',
      });
    }
    return { sessions, rotated, documentId: current.documentId };
  });
  await disconnect(ctx, outcome.sessions, outcome.documentId);
  return { sessionId: id, participants: outcome.rotated };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

const TRANSITION_AUDIT: Record<SessionAction, string> = {
  start: 'interview_session.started',
  complete: 'interview_session.completed',
  cancel: 'interview_session.cancelled',
  archive: 'interview_session.archived',
};

const TRANSITION_VERB: Record<SessionAction, string> = {
  start: 'started',
  complete: 'completed',
  cancel: 'cancelled',
  archive: 'archived',
};

const TRANSITION_COLUMN: Record<SessionAction, string> = {
  start: 'started_at',
  complete: 'completed_at',
  cancel: 'cancelled_at',
  archive: 'archived_at',
};

/**
 * start / complete / cancel / archive. Completing or cancelling revokes the
 * candidate's links (the candidate is told the session is closed); the
 * interviewers keep read-only access until their links expire. Archiving
 * revokes every link and archives the document; nothing is deleted.
 */
export async function transitionSession(
  ctx: AppContext,
  actor: OperationActor,
  id: string,
  action: SessionAction,
  requestId: string,
): Promise<InterviewSession> {
  const { db, workspace } = ctx;
  const outcome = await db.tx(async (tx) => {
    const current = await requireSession(tx, workspace.id, id, true);
    const target = nextStatus(current.status, action);
    if (!target) {
      throw errors.conflict(`A ${current.status} session cannot be ${TRANSITION_VERB[action]}.`);
    }
    await tx.query(
      `UPDATE interview_sessions SET status = $3, ${TRANSITION_COLUMN[action]} = now(), updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [id, workspace.id, target],
    );

    let sessions: string[] = [];
    let revokedRoles: ParticipantRole[] = [];
    let revokedIds: string[] = [];
    if (action === 'complete' || action === 'cancel' || action === 'archive') {
      const people = await tx.query<{ id: string; role: ParticipantRole }>(
        `SELECT id, role FROM interview_participants
          WHERE session_id = $1 AND removed_at IS NULL
            AND ($2 OR role = 'candidate')`,
        [id, action === 'archive'],
      );
      revokedIds = people.rows.map((p) => p.id);
      revokedRoles = people.rows.map((p) => p.role);
      sessions = await revokeParticipantLinks(tx, revokedIds);
    }
    // Account memberships of interviewers follow their links: read-only once the interview is
    // over, gone when the session is archived.
    if (action === 'complete' || action === 'cancel') {
      await setLinkedInterviewerRole(tx, workspace.id, id, 'viewer', {
        actor: auditActorOf(actor),
        requestId,
      });
    }
    if (action === 'archive') {
      const everyone = await tx.query<{ id: string }>(
        'SELECT id FROM interview_participants WHERE session_id = $1',
        [id],
      );
      await unlinkInterviewerAccounts(
        tx,
        workspace.id,
        everyone.rows.map((row) => row.id),
        { actor: auditActorOf(actor), requestId },
      );
    }
    if (action === 'archive') {
      const archived = await tx.query(
        `UPDATE documents SET status = 'archived', archived_at = now(), updated_at = now()
          WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
        [current.documentId, workspace.id],
      );
      if (archived.rowCount) {
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actor: auditActorOf(actor),
          action: 'document.archived',
          targetType: 'document',
          targetId: current.documentId,
          details: { from: 'active', sessionId: id },
          requestId,
        });
      }
    }
    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: auditActorOf(actor),
      action: TRANSITION_AUDIT[action],
      targetType: 'interview_session',
      targetId: id,
      details: { documentId: current.documentId, from: current.status, to: target },
      requestId,
    });
    const base = { sessionId: id, documentId: current.documentId };
    if (action === 'start') {
      await emitWebhookEvent(tx, workspace.id, 'session.started', { ...base, status: target });
    } else if (action === 'complete') {
      await emitWebhookEvent(tx, workspace.id, 'session.completed', { ...base, status: target });
    } else if (action === 'cancel') {
      await emitWebhookEvent(tx, workspace.id, 'session.cancelled', { ...base, status: target });
    }
    if (revokedIds.length > 0) {
      await emitWebhookEvent(tx, workspace.id, 'access.revoked', {
        ...base,
        participantIds: revokedIds,
        roles: revokedRoles,
        reason: action === 'archive' ? 'session_archived' : `session_${target}`,
      });
    }
    return { sessions, documentId: current.documentId };
  });
  await disconnect(ctx, outcome.sessions, outcome.documentId);
  return presentSession(ctx, db, id);
}

// ── Audit and document ──────────────────────────────────────────────────────

interface AuditRow {
  id: string;
  at: Date;
  actorKind: 'user' | 'guest' | 'system' | 'service';
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
}

export async function sessionAuditTrail(
  ctx: AppContext,
  id: string,
  query: { limit: number; cursor?: string },
): Promise<SessionAuditPage> {
  const session = await requireSession(ctx.db, ctx.workspace.id, id);
  const params: unknown[] = [ctx.workspace.id, id, session.documentId];
  let cursorSql = '';
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    params.push(cursor.at, cursor.id);
    cursorSql = `AND (date_trunc('milliseconds', at), id) < ($4::timestamptz, $5::uuid)`;
  }
  params.push(query.limit + 1);
  const result = await ctx.db.query<AuditRow>(
    `SELECT id, at, actor_kind AS "actorKind", actor_name AS "actorName", action,
            target_type AS "targetType", target_id AS "targetId", details
       FROM audit_events
      WHERE workspace_id = $1
        AND ((target_type = 'interview_session' AND target_id = $2)
          OR (target_type = 'document' AND target_id = $3::text)
          OR (target_type = 'share' AND details ->> 'documentId' = $3::text))
        ${cursorSql}
      ORDER BY date_trunc('milliseconds', at) DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  const more = result.rows.length > query.limit;
  const rows = more ? result.rows.slice(0, query.limit) : result.rows;
  const last = rows[rows.length - 1];
  return {
    items: rows.map((row) => {
      const details: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(row.details ?? {})) {
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
          details[key] = value as string | number | boolean | null;
        }
      }
      return {
        id: row.id,
        at: row.at.toISOString(),
        actorKind: row.actorKind,
        actorName: row.actorName,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        details,
      };
    }),
    nextCursor: more && last ? encodeCursor(last.at, last.id) : null,
  };
}

export async function sessionDocument(
  ctx: AppContext,
  id: string,
): Promise<SessionDocumentResponse> {
  const session = await requireSession(ctx.db, ctx.workspace.id, id);
  const doc = await ctx.db.query<{
    id: string;
    title: string;
    status: 'active' | 'archived' | 'trashed';
    generation: number;
    updatedAt: Date;
    contentUpdatedAt: Date;
  }>(
    `SELECT id, title, status, generation, updated_at AS "updatedAt",
            content_updated_at AS "contentUpdatedAt"
       FROM documents WHERE id = $1 AND workspace_id = $2`,
    [session.documentId, ctx.workspace.id],
  );
  const row = doc.rows[0];
  if (!row) throw errors.notFound();
  const live = ctx.collab.liveDocument(row.id, row.generation);
  let content;
  if (live) {
    content = ydocToJson(live);
  } else {
    const durable = await loadDurableState(ctx.db, ctx.workspace.id, row.id);
    if (!durable) throw errors.notFound();
    content = stateToJson(durable.state, durable.updates);
  }
  return {
    documentId: row.id,
    title: row.title,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    contentUpdatedAt: row.contentUpdatedAt.toISOString(),
    content: content as unknown as Record<string, unknown>,
  };
}

/** The document of a session, for routes that work on the document itself. */
export async function sessionDocumentRef(
  ctx: AppContext,
  sessionId: string,
): Promise<{ id: string; title: string }> {
  const session = await requireSession(ctx.db, ctx.workspace.id, sessionId);
  return { id: session.documentId, title: session.title };
}

/** A document of this workspace by its id (trashed ones included: their history stays readable). */
export async function workspaceDocumentRef(
  ctx: AppContext,
  documentId: string,
): Promise<{ id: string; title: string }> {
  const result = await ctx.db.query<{ id: string; title: string }>(
    'SELECT id, title FROM documents WHERE id = $1 AND workspace_id = $2',
    [documentId, ctx.workspace.id],
  );
  const row = result.rows[0];
  if (!row) throw errors.notFound('That document does not exist.');
  return row;
}

/** Admin reads of a session, its document or its audit trail are themselves audited. */
export async function auditAdminView(
  ctx: AppContext,
  actor: Extract<OperationActor, { kind: 'user' }>,
  sessionId: string,
  what: 'session' | 'document' | 'audit',
  requestId: string,
): Promise<void> {
  const details: AuditDetails = { view: what };
  await writeAudit(ctx.db, {
    workspaceId: ctx.workspace.id,
    actor: auditActorOf(actor),
    action: 'admin.session_viewed',
    targetType: 'interview_session',
    targetId: sessionId,
    details,
    requestId,
  });
}

// ── Collaboration hooks ─────────────────────────────────────────────────────

/** What the collaboration layer needs to call the hooks below. */
export interface ServiceDeps {
  db: Db;
  workspace: { id: string };
}

/** Records a participant's connection; the first one also queues `participant.joined`. */
export async function recordParticipantJoin(
  ctx: ServiceDeps,
  participantId: string,
): Promise<void> {
  await ctx.db.tx(async (tx) => {
    const found = await tx.query<{
      sessionId: string;
      role: ParticipantRole;
      first: boolean;
      documentId: string;
    }>(
      `SELECT p.session_id AS "sessionId", p.role, p.first_joined_at IS NULL AS first,
              s.document_id AS "documentId"
         FROM interview_participants p JOIN interview_sessions s ON s.id = p.session_id
        WHERE p.id = $1 AND p.workspace_id = $2 FOR UPDATE OF p`,
      [participantId, ctx.workspace.id],
    );
    const row = found.rows[0];
    if (!row) return;
    await tx.query(
      `UPDATE interview_participants
          SET last_joined_at = now(), first_joined_at = COALESCE(first_joined_at, now())
        WHERE id = $1`,
      [participantId],
    );
    if (row.first) {
      await emitWebhookEvent(tx, ctx.workspace.id, 'participant.joined', {
        sessionId: row.sessionId,
        documentId: row.documentId,
        participantId,
        role: row.role,
      });
    }
  });
}

/**
 * Called by the collaboration layer when a document receives its first
 * committed edit. Idempotent per session: the event is queued once, however
 * often this is called.
 */
export async function emitDocumentFirstEdited(
  ctx: ServiceDeps,
  documentId: string,
): Promise<boolean> {
  return ctx.db.tx(async (tx) => {
    const claimed = await tx.query<{ id: string }>(
      `UPDATE interview_sessions SET first_edited_at = now()
        WHERE document_id = $1 AND workspace_id = $2 AND first_edited_at IS NULL
        RETURNING id`,
      [documentId, ctx.workspace.id],
    );
    const session = claimed.rows[0];
    if (!session) return false;
    await emitWebhookEvent(tx, ctx.workspace.id, 'document.first_edited', {
      sessionId: session.id,
      documentId,
    });
    return true;
  });
}

export { isClosedStatus };
