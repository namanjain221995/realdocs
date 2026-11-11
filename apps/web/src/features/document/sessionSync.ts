/**
 * Keeping the document screen in step with the live editing session.
 *
 * The collaboration session learns first when something about the document
 * changes for this reader: access revoked or expired, the role switched, a
 * snapshot restored (new generation), the document trashed.
 *
 * - Access revoked or expired: only the session knows the reason (the
 *   document endpoint just stops answering), so the screen switches to its
 *   "access ended" state directly from the session.
 * - Role, generation, document trashed or deleted: the header, the
 *   administrator controls and the dedicated error screens are driven by the
 *   document summary (`GET /api/documents/:id`), so the summary is read again
 *   and everything else follows from it.
 */
import type { DocumentSummary } from '@realtimedocs/contracts';
import type { EditorMountStatus } from './EditorMount';

/** The parts of a session status that can make the fetched summary stale. */
export interface SummaryRelevantStatus {
  connection: EditorMountStatus['connection'];
  role: EditorMountStatus['role'];
  generation: EditorMountStatus['generation'];
}

export function summaryRelevant(status: EditorMountStatus): SummaryRelevantStatus {
  return { connection: status.connection, role: status.role, generation: status.generation };
}

/** Why this reader can no longer open the document, as the server told the session. */
export type AccessEndReason = 'access_revoked' | 'access_expired';

export function accessEndReason(
  status: Pick<EditorMountStatus, 'connection'>,
): AccessEndReason | null {
  return status.connection === 'access_revoked' || status.connection === 'access_expired'
    ? status.connection
    : null;
}

/**
 * True when the summary should be fetched again. `previous` is the status the
 * last decision was made for, so a mismatch that the server keeps reporting
 * (or a flurry of unrelated status updates) causes one refetch, not a loop.
 */
export function shouldRefetchSummary(
  previous: SummaryRelevantStatus | null,
  status: SummaryRelevantStatus,
  summary: Pick<DocumentSummary, 'generation'> & {
    access: Pick<DocumentSummary['access'], 'role'>;
  },
): boolean {
  const unchanged =
    previous !== null &&
    previous.connection === status.connection &&
    previous.role === status.role &&
    previous.generation === status.generation;
  if (unchanged) return false;
  // Trashed or deleted: the summary request answers with the screen to show.
  if (status.connection === 'document_unavailable') return true;
  if (status.role !== null && status.role !== summary.access.role) return true;
  if (status.generation !== null && status.generation !== summary.generation) return true;
  return false;
}
