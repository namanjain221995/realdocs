import type { InterviewStatus, ParticipantRole } from '@realtimedocs/contracts';
import type { Queryable } from '../db/pool';

export interface GrantParticipant {
  participantId: string;
  sessionId: string;
  role: ParticipantRole;
  name: string;
  sessionStatus: InterviewStatus;
}

/** The interview participant a share grant was created for, if it is one. */
export async function findGrantParticipant(
  db: Queryable,
  grantId: string,
): Promise<GrantParticipant | null> {
  const result = await db.query<GrantParticipant>(
    `SELECT p.id AS "participantId", p.session_id AS "sessionId", p.role, p.name,
            s.status AS "sessionStatus"
       FROM share_grants g
       JOIN interview_participants p ON p.id = g.participant_id
       JOIN interview_sessions s ON s.id = p.session_id
      WHERE g.id = $1`,
    [grantId],
  );
  return result.rows[0] ?? null;
}
