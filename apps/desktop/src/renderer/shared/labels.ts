/** Display text for connection, save and access states. Shared by the panel header and settings. */
import type { ConnectionState, EffectiveRole, SaveState } from '@realtimedocs/contracts';
import type { Tone } from '@realtimedocs/ui';
import type { AppState } from '../../shared/state';

export interface StatusChip {
  label: string;
  tone: Tone;
  pulse: boolean;
  /** Longer explanation for tooltips. */
  hint: string;
}

const CONNECTION: Record<ConnectionState, StatusChip> = {
  connecting: {
    label: 'Connecting',
    tone: 'warning',
    pulse: true,
    hint: 'Connecting to the server.',
  },
  live: {
    label: 'Live',
    tone: 'success',
    pulse: false,
    hint: 'Connected. Changes appear as they are made.',
  },
  reconnecting: {
    label: 'Reconnecting',
    tone: 'warning',
    pulse: true,
    hint: 'The connection dropped. Trying again.',
  },
  offline: {
    label: 'Offline',
    tone: 'neutral',
    pulse: false,
    hint: 'Not connected to the server.',
  },
  access_expired: {
    label: 'Access expired',
    tone: 'danger',
    pulse: false,
    hint: 'The link or session for this document has expired.',
  },
  access_revoked: {
    label: 'Access revoked',
    tone: 'danger',
    pulse: false,
    hint: 'Access revoked: the link or session no longer opens this document.',
  },
  update_required: {
    label: 'Update required',
    tone: 'danger',
    pulse: false,
    hint: 'This app is too old for the document. Install the current version.',
  },
  document_unavailable: {
    label: 'Unavailable',
    tone: 'danger',
    pulse: false,
    hint: 'The document was moved to the trash or deleted.',
  },
};

export type EndedAccess = 'access_revoked' | 'access_expired' | 'document_unavailable';

/**
 * Why the last document session ended, read from the code of the notice the
 * main process raised when the server confirmed it. Null for every other notice.
 */
export function endedAccess(noticeCode: string | null | undefined): EndedAccess | null {
  switch (noticeCode) {
    case 'share_revoked':
    case 'forbidden':
      return 'access_revoked';
    case 'share_expired':
    case 'session_expired':
    case 'unauthenticated':
      return 'access_expired';
    case 'not_found':
    case 'document_trashed':
      return 'document_unavailable';
    default:
      return null;
  }
}

/** `data-state` of the header's connection chip. */
export function connectionStateName(state: AppState): string {
  const { session, report, notice } = state.connection;
  if (session) return report?.connection ?? 'connecting';
  return endedAccess(notice?.code) ?? 'idle';
}

export function connectionChip(state: AppState): StatusChip {
  const { session, report, busy, server, notice } = state.connection;
  if (busy === 'opening') {
    return { label: 'Opening', tone: 'warning', pulse: true, hint: 'Opening the document.' };
  }
  if (busy === 'confirming' && !session) {
    return {
      label: 'Waiting for your answer',
      tone: 'warning',
      pulse: true,
      hint: 'Answer the question in the dialog.',
    };
  }
  if (!session) {
    // The session is gone, but the reason it ended stays visible until the
    // notice is dismissed or another document is opened.
    const ended = endedAccess(notice?.code);
    if (ended) return CONNECTION[ended];
    if (!server.origin) {
      return {
        label: 'No server',
        tone: 'neutral',
        pulse: false,
        hint: 'No server is set. Open Settings.',
      };
    }
    return { label: 'No document', tone: 'neutral', pulse: false, hint: 'No document is open.' };
  }
  // Until the editor session has reported, it is on its first connection attempt.
  return CONNECTION[report?.connection ?? 'connecting'];
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  pending: 'Changes pending',
  error: 'Not saved',
  read_only: '',
};

export function saveLabel(state: AppState): string {
  const { session, report } = state.connection;
  // Before the server has reported a role there is nothing truthful to say about saving.
  if (!session || !report || report.role === null) {
    return report && (report.save === 'pending' || report.save === 'error')
      ? SAVE_LABELS[report.save]
      : '';
  }
  return SAVE_LABELS[report.save];
}

/** `data-state` of the header's save label; empty when nothing is shown. */
export function saveStateName(state: AppState): string {
  return saveLabel(state) ? (state.connection.report?.save ?? '') : '';
}

export function accessChip(state: AppState): { label: string; tone: Tone; hint: string } | null {
  const session = state.connection.session;
  if (!session) return null;
  const role: EffectiveRole = state.connection.report?.role ?? session.role;
  if (role === 'viewer') {
    return {
      label: 'View only',
      tone: 'neutral',
      hint: 'You can read this document but not change it.',
    };
  }
  if (role === 'admin') {
    return { label: 'Admin', tone: 'accent', hint: 'You can edit and manage this document.' };
  }
  return { label: 'Can edit', tone: 'accent', hint: 'You can edit this document.' };
}

export function documentTitle(state: AppState): string {
  const session = state.connection.session;
  if (!session) return 'RealtimeDocs';
  return (state.connection.report?.title ?? session.title).trim() || 'Untitled document';
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
