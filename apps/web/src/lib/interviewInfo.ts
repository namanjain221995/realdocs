/**
 * The optional `interview` field of a document list item (documents that belong to an
 * interview session). Read defensively: absent or malformed means "not an interview document".
 */
export interface InterviewInfo {
  company: string;
  roundText: string;
  candidateName: string;
  scheduledAt: string;
}

export function interviewInfo(document: unknown): InterviewInfo | null {
  const value = (document as { interview?: unknown } | null)?.interview as
    | {
        company?: unknown;
        round?: { number?: unknown; name?: unknown } | null;
        /** The server's field is `candidate` (a name or null). */
        candidate?: unknown;
        scheduledAt?: unknown;
      }
    | null
    | undefined;
  if (!value || typeof value !== 'object' || typeof value.company !== 'string') return null;
  const number = value.round?.number;
  const name = value.round?.name;
  const round =
    typeof number === 'string' || typeof number === 'number' ? `Round ${String(number)}` : '';
  return {
    company: value.company,
    roundText: typeof name === 'string' && name && round ? `${round} — ${name}` : round,
    candidateName: typeof value.candidate === 'string' ? value.candidate : '',
    scheduledAt: typeof value.scheduledAt === 'string' ? value.scheduledAt : '',
  };
}
