/** Interview session lifecycle. Anything not listed is refused (409 CONFLICT). */
import type { InterviewStatus } from '@realtimedocs/contracts';

export type SessionAction = 'start' | 'complete' | 'cancel' | 'archive';

const TRANSITIONS: Record<
  SessionAction,
  { from: readonly InterviewStatus[]; to: InterviewStatus }
> = {
  start: { from: ['scheduled'], to: 'in_progress' },
  complete: { from: ['in_progress'], to: 'completed' },
  cancel: { from: ['scheduled', 'in_progress'], to: 'cancelled' },
  archive: { from: ['scheduled', 'in_progress', 'completed', 'cancelled'], to: 'archived' },
};

/** The status after `action`, or null when the action is not allowed from `from`. */
export function nextStatus(from: InterviewStatus, action: SessionAction): InterviewStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(from) ? rule.to : null;
}

/** A session in one of these states can be edited and can gain participants. */
export function isEditableStatus(status: InterviewStatus): boolean {
  return status === 'scheduled' || status === 'in_progress';
}

/** A closed session no longer lets a candidate in; interviewers keep read access until expiry. */
export function isClosedStatus(status: InterviewStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'archived';
}
