/** Pure helpers of the service-API admin pages (kept free of React so they are unit-tested). */
import type { ApiKeyState, InterviewStatus, WebhookDeliveryStatus } from '@realtimedocs/contracts';
import type { Tone } from '@realtimedocs/ui';
import type { SessionAction, SessionListFilters } from './serviceApi';

export const STATUS_LABEL: Record<InterviewStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

export const STATUS_TONE: Record<InterviewStatus, Tone> = {
  scheduled: 'info',
  in_progress: 'success',
  completed: 'neutral',
  cancelled: 'warning',
  archived: 'neutral',
};

export const KEY_STATE_TONE: Record<ApiKeyState, Tone> = {
  active: 'success',
  expired: 'warning',
  revoked: 'danger',
};

export const DELIVERY_TONE: Record<WebhookDeliveryStatus, Tone> = {
  pending: 'info',
  delivered: 'success',
  failed: 'warning',
  dead: 'danger',
};

export interface AllowedActions {
  start: boolean;
  complete: boolean;
  cancel: boolean;
  archive: boolean;
}

/** The session state machine: scheduled -> start|cancel|archive, in_progress -> complete|cancel|archive. */
export function allowedSessionActions(status: InterviewStatus): AllowedActions {
  switch (status) {
    case 'scheduled':
      return { start: true, complete: false, cancel: true, archive: true };
    case 'in_progress':
      return { start: false, complete: true, cancel: true, archive: true };
    case 'completed':
    case 'cancelled':
      return { start: false, complete: false, cancel: false, archive: true };
    case 'archived':
      return { start: false, complete: false, cancel: false, archive: false };
  }
}

export const ACTION_COPY: Record<
  SessionAction | 'archive',
  { label: string; title: string; message: string; danger: boolean }
> = {
  start: {
    label: 'Start',
    title: 'Start this interview?',
    message: 'The session moves to In progress. Participants keep their current links.',
    danger: false,
  },
  complete: {
    label: 'Complete',
    title: 'Complete this interview?',
    message:
      'The session is marked completed and every participant link stops opening the document. This cannot be undone.',
    danger: true,
  },
  cancel: {
    label: 'Cancel session',
    title: 'Cancel this interview?',
    message:
      'The session is cancelled and every participant link stops opening the document. This cannot be undone.',
    danger: true,
  },
  archive: {
    label: 'Archive',
    title: 'Archive this interview?',
    message:
      'The session is archived and its links stop working. The record and audit trail are kept.',
    danger: true,
  },
};

/** Lines of free text to a list of non-empty, trimmed, unique entries (commas also separate). */
export function parseLines(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\n,]+/)) {
    const value = part.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

/** `YYYY-MM-DD` (a date input) to the last instant (or first, with `end: false`) of that local day. */
export function localDateToIso(date: string, end: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const value = end
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

export interface SessionFilterForm {
  status: string;
  candidate: string;
  interviewer: string;
  company: string;
  round: string;
  from: string;
  to: string;
  q: string;
}

export const EMPTY_FILTERS: SessionFilterForm = {
  status: '',
  candidate: '',
  interviewer: '',
  company: '',
  round: '',
  from: '',
  to: '',
  q: '',
};

const STATUSES = new Set<string>(Object.keys(STATUS_LABEL));

/** The server query for the filter form; empty fields are left out. */
export function toSessionQuery(form: SessionFilterForm): SessionListFilters {
  const query: SessionListFilters = {};
  if (STATUSES.has(form.status)) query.status = form.status as InterviewStatus;
  if (form.candidate.trim()) query.candidateEmail = form.candidate.trim();
  if (form.interviewer.trim()) query.interviewerEmail = form.interviewer.trim();
  if (form.company.trim()) query.company = form.company.trim();
  const round = Number.parseInt(form.round, 10);
  if (Number.isInteger(round) && round >= 1 && round <= 99) query.round = round;
  const from = localDateToIso(form.from, false);
  if (from) query.from = from;
  const to = localDateToIso(form.to, true);
  if (to) query.to = to;
  if (form.q.trim()) query.q = form.q.trim();
  return query;
}

/** "Round 2 — System design" or "Round 2". */
export function roundLabel(round: { number: number; name: string | null }): string {
  return round.name ? `Round ${round.number} — ${round.name}` : `Round ${round.number}`;
}

export const LINK_STATE_LABEL = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
  none: 'No link',
} as const;

export function eventLabel(event: string): string {
  return event.replace(/[._]/g, ' ');
}
