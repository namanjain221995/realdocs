/**
 * Interviewers who have an account (docs/session-integration.md).
 *
 * An interviewer of an interview session always gets a personal link. When their e-mail address
 * is also the address of an active account of the workspace, the server additionally makes that
 * account a member of the session's document, so the document shows up in the person's own
 * documents list after they sign in. Only an account whose address an administrator fixed
 * (`users.address_confirmed`: an invitation issued for that address, or the first administrator)
 * is linked: the product cannot verify an address, and one that a person typed in themselves
 * must never earn them a document. Such a membership remembers the participant it was created
 * for (`document_members.interview_participant_id`): it follows the session (role, removal of
 * the interviewer, archiving), and a membership an administrator added by hand is never touched.
 * Candidates are never linked.
 */
import { writeAudit, type AuditActor } from '../audit';
import type { Queryable } from '../db/pool';

export type MemberRole = 'viewer' | 'editor';

interface LinkAudit {
  actor: AuditActor;
  requestId?: string;
}

async function auditLinked(
  tx: Queryable,
  workspaceId: string,
  audit: LinkAudit,
  action: 'member.added' | 'member.removed' | 'member.role_changed',
  row: { documentId: string; userId: string; participantId: string | null; sessionId?: string },
  role: MemberRole | null,
): Promise<void> {
  await writeAudit(tx, {
    workspaceId,
    actor: audit.actor,
    action,
    targetType: 'document',
    targetId: row.documentId,
    details: {
      userId: row.userId,
      ...(role ? { role } : {}),
      via: 'interview_session',
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.participantId ? { participantId: row.participantId } : {}),
    },
    ...(audit.requestId ? { requestId: audit.requestId } : {}),
  });
}

/**
 * Makes the accounts of a session's interviewers members of its document. Only active accounts
 * with exactly the interviewer's address (case-insensitive); an account that is already a member
 * keeps the membership it has. Returns the participants that were linked.
 */
export async function linkInterviewerAccounts(
  tx: Queryable,
  input: {
    workspaceId: string;
    sessionId: string;
    documentId: string;
    role: MemberRole;
    /** The account that acted, when it was one (recorded as `granted_by`). */
    grantedBy: string | null;
    /** Limit to these participants (a newly added interviewer). */
    participantIds?: readonly string[];
    audit: LinkAudit;
  },
): Promise<string[]> {
  const result = await tx.query<{ userId: string; participantId: string }>(
    `INSERT INTO document_members
       (document_id, user_id, workspace_id, role, granted_by, interview_participant_id)
     SELECT DISTINCT ON (u.id) $2::uuid, u.id, $1::uuid, $4, $5::uuid, p.id
       FROM interview_participants p
       JOIN users u
         ON u.workspace_id = p.workspace_id AND u.email = p.email AND u.status = 'active'
        AND u.address_confirmed
      WHERE p.workspace_id = $1 AND p.session_id = $3 AND p.role = 'interviewer'
        AND p.removed_at IS NULL
        AND ($6::uuid[] IS NULL OR p.id = ANY($6::uuid[]))
      ORDER BY u.id, p.created_at, p.id
     ON CONFLICT (document_id, user_id) DO NOTHING
     RETURNING user_id AS "userId", interview_participant_id AS "participantId"`,
    [
      input.workspaceId,
      input.documentId,
      input.sessionId,
      input.role,
      input.grantedBy,
      input.participantIds ? [...input.participantIds] : null,
    ],
  );
  for (const row of result.rows) {
    await auditLinked(
      tx,
      input.workspaceId,
      input.audit,
      'member.added',
      { documentId: input.documentId, sessionId: input.sessionId, ...row },
      input.role,
    );
  }
  return result.rows.map((row) => row.participantId);
}

/** Removes the memberships that were created for these participants, and only those. */
export async function unlinkInterviewerAccounts(
  tx: Queryable,
  workspaceId: string,
  participantIds: readonly string[],
  audit: LinkAudit,
): Promise<number> {
  if (participantIds.length === 0) return 0;
  const result = await tx.query<{ documentId: string; userId: string; participantId: string }>(
    `DELETE FROM document_members
      WHERE workspace_id = $1 AND interview_participant_id = ANY($2::uuid[])
      RETURNING document_id AS "documentId", user_id AS "userId",
                interview_participant_id AS "participantId"`,
    [workspaceId, [...participantIds]],
  );
  for (const row of result.rows) {
    await auditLinked(tx, workspaceId, audit, 'member.removed', row, null);
  }
  return result.rows.length;
}

/** The linked memberships of a session follow its edit permission (and become read-only when it ends). */
export async function setLinkedInterviewerRole(
  tx: Queryable,
  workspaceId: string,
  sessionId: string,
  role: MemberRole,
  audit: LinkAudit,
): Promise<number> {
  const result = await tx.query<{ documentId: string; userId: string; participantId: string }>(
    `UPDATE document_members m
        SET role = $3
       FROM interview_participants p
      WHERE m.interview_participant_id = p.id AND m.workspace_id = $1
        AND p.session_id = $2 AND m.role <> $3
      RETURNING m.document_id AS "documentId", m.user_id AS "userId",
                m.interview_participant_id AS "participantId"`,
    [workspaceId, sessionId, role],
  );
  for (const row of result.rows) {
    await auditLinked(tx, workspaceId, audit, 'member.role_changed', { ...row, sessionId }, role);
  }
  return result.rows.length;
}

/**
 * For an account that was just created with an address an administrator fixed: the documents of
 * the open interview sessions in which that address is an interviewer. The caller decides that
 * the address is confirmed. Returns the ids of the documents it became a member of.
 */
export async function linkAccountToInterviewSessions(
  tx: Queryable,
  workspaceId: string,
  user: { id: string; email: string; displayName: string },
): Promise<string[]> {
  const result = await tx.query<{ documentId: string; participantId: string; role: MemberRole }>(
    `INSERT INTO document_members
       (document_id, user_id, workspace_id, role, granted_by, interview_participant_id)
     SELECT DISTINCT ON (s.document_id) s.document_id, $2::uuid, $1::uuid,
            CASE WHEN COALESCE((s.permissions ->> 'interviewerCanEdit')::boolean, true)
                 THEN 'editor' ELSE 'viewer' END,
            NULL, p.id
       FROM interview_participants p
       JOIN interview_sessions s ON s.id = p.session_id
      WHERE p.workspace_id = $1 AND p.email = $3::citext AND p.role = 'interviewer'
        AND p.removed_at IS NULL AND s.status IN ('scheduled', 'in_progress')
      ORDER BY s.document_id, p.created_at, p.id
     ON CONFLICT (document_id, user_id) DO NOTHING
     RETURNING document_id AS "documentId", interview_participant_id AS "participantId", role`,
    [workspaceId, user.id, user.email],
  );
  for (const row of result.rows) {
    await auditLinked(
      tx,
      workspaceId,
      { actor: { kind: 'user', userId: user.id, name: user.displayName } },
      'member.added',
      { documentId: row.documentId, userId: user.id, participantId: row.participantId },
      row.role,
    );
  }
  return result.rows.map((row) => row.documentId);
}
