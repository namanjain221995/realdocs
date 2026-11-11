/**
 * Client-visible status model of a collaboration session.
 *
 * `deriveStatus` is a pure function from the session's internal facts to the
 * public `SessionStatus`, so the rules ("Saved only after a durable
 * acknowledgement", connection and save state kept separate) can be tested
 * without a network.
 */
import {
  ApiError,
  canEdit as roleCanEdit,
  type AccessChange,
  type ClientErrorCode,
  type CollabAuthFailure,
  type ConnectionState,
  type EffectiveRole,
  type Participant,
  type SaveErrorCode,
  type SaveState,
} from '@realtimedocs/contracts';

export interface SessionNotice {
  id: string;
  kind:
    'restored' | 'role_changed' | 'draft_saved' | 'persistence_degraded' | 'persistence_restored';
  /** Human-readable, already localized English text. */
  message: string;
  draftId?: string;
  role?: EffectiveRole;
}

export interface SessionStatus {
  connection: ConnectionState;
  save: SaveState;
  /** As resolved by the server (never chosen by the client). */
  role: EffectiveRole | null;
  canEdit: boolean;
  generation: number | null;
  /** Local transactions not yet durably acknowledged by the server. */
  pendingChanges: number;
  /** True while updates are sent but the server has not applied them yet. */
  unsynced: boolean;
  /** Epoch ms of the last durable acknowledgement. */
  lastSavedAt: number | null;
  saveError: { code: SaveErrorCode; retrying: boolean } | null;
  persistenceDegraded: boolean;
  reconnectAttempt: number;
  nextRetryAt: number | null;
  accessExpiresAt: string | null;
  /** Server-attested, de-duplicated, excludes nobody. */
  participants: Participant[];
  self: Participant | null;
  notices: SessionNotice[];
  /** True once the first server sync of the current generation has been applied. */
  ready: boolean;
}

export type TerminalState = Extract<
  ConnectionState,
  'access_expired' | 'access_revoked' | 'update_required' | 'document_unavailable'
>;

export const TERMINAL_STATES: readonly TerminalState[] = [
  'access_expired',
  'access_revoked',
  'update_required',
  'document_unavailable',
];

export function isTerminalState(state: ConnectionState): state is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/** Internal facts the public status is derived from. */
export interface StatusModel {
  /** `live` only after the sync handshake of the current connection finished. */
  link: 'idle' | 'connecting' | 'live' | 'waiting';
  terminal: TerminalState | null;
  /** `navigator.onLine` (true when unknown). */
  online: boolean;
  /** True once any connection of this session reached `live`. */
  everLive: boolean;
  role: EffectiveRole | null;
  /** A local replica of the document was loaded from the device store. */
  hasLocalReplica: boolean;
  ready: boolean;
  generation: number | null;
  /** Count of local-origin Yjs transactions (insert, format and delete-only). */
  n: number;
  /** Highest `n` the server acknowledged as committed. */
  acked: number;
  unsynced: boolean;
  /**
   * The server refused an update of the current connection (read-only or not
   * accepting edits). Until a `hello` proof succeeds, markers prove nothing.
   */
  refused: boolean;
  lastSavedAt: number | null;
  saveError: { code: SaveErrorCode; retrying: boolean } | null;
  persistenceDegraded: boolean;
  reconnectAttempt: number;
  nextRetryAt: number | null;
  accessExpiresAt: string | null;
  participants: Participant[];
  self: Participant | null;
  notices: SessionNotice[];
}

export function initialStatusModel(): StatusModel {
  return {
    link: 'idle',
    terminal: null,
    online: true,
    everLive: false,
    role: null,
    hasLocalReplica: false,
    ready: false,
    generation: null,
    n: 0,
    acked: 0,
    unsynced: false,
    refused: false,
    lastSavedAt: null,
    saveError: null,
    persistenceDegraded: false,
    reconnectAttempt: 0,
    nextRetryAt: null,
    accessExpiresAt: null,
    participants: [],
    self: null,
    notices: [],
  };
}

export function deriveConnectionState(model: StatusModel): ConnectionState {
  if (model.terminal) return model.terminal;
  if (model.link === 'live') return 'live';
  if (!model.online) return 'offline';
  if (model.everLive || model.reconnectAttempt > 0) return 'reconnecting';
  return 'connecting';
}

/**
 * `saved` is reported only when the highest acknowledged marker covers every
 * local change. Socket state, the provider's sync flag and state-vector
 * equality are deliberately not inputs of this function.
 */
export function deriveSaveState(model: StatusModel, connection: ConnectionState): SaveState {
  const editable = model.role !== null && roleCanEdit(model.role) && !model.terminal;
  const pending = model.n > model.acked;
  if (!editable && !pending) return 'read_only';
  if (!pending) return 'saved';
  if (!editable) return 'pending';
  if (model.saveError) return 'error';
  if (connection !== 'live' || model.persistenceDegraded || model.refused) return 'pending';
  return 'saving';
}

export function deriveStatus(model: StatusModel): SessionStatus {
  const connection = deriveConnectionState(model);
  const roleAllowsEditing = model.role !== null && roleCanEdit(model.role);
  return {
    connection,
    save: deriveSaveState(model, connection),
    role: model.role,
    canEdit: roleAllowsEditing && !model.terminal && (model.ready || model.hasLocalReplica),
    generation: model.generation,
    pendingChanges: Math.max(0, model.n - model.acked),
    unsynced: model.unsynced,
    lastSavedAt: model.lastSavedAt,
    saveError: model.n > model.acked ? model.saveError : null,
    persistenceDegraded: model.persistenceDegraded,
    reconnectAttempt: model.reconnectAttempt,
    nextRetryAt: model.nextRetryAt,
    accessExpiresAt: model.accessExpiresAt,
    participants: model.participants,
    self: model.self,
    notices: model.notices,
    ready: model.ready,
  };
}

function sameParticipants(a: readonly Participant[], b: readonly Participant[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return (
      right !== undefined &&
      left.id === right.id &&
      left.name === right.name &&
      left.color === right.color &&
      left.role === right.role &&
      left.kind === right.kind
    );
  });
}

function sameNotices(a: readonly SessionNotice[], b: readonly SessionNotice[]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((notice, index) => notice.id === b[index]?.id);
}

/** Structural equality used to keep `getStatus()` referentially stable. */
export function sameStatus(a: SessionStatus, b: SessionStatus): boolean {
  return (
    a.connection === b.connection &&
    a.save === b.save &&
    a.role === b.role &&
    a.canEdit === b.canEdit &&
    a.generation === b.generation &&
    a.pendingChanges === b.pendingChanges &&
    a.unsynced === b.unsynced &&
    a.lastSavedAt === b.lastSavedAt &&
    a.saveError?.code === b.saveError?.code &&
    a.saveError?.retrying === b.saveError?.retrying &&
    a.persistenceDegraded === b.persistenceDegraded &&
    a.reconnectAttempt === b.reconnectAttempt &&
    a.nextRetryAt === b.nextRetryAt &&
    a.accessExpiresAt === b.accessExpiresAt &&
    a.ready === b.ready &&
    sameNotices(a.notices, b.notices) &&
    a.self?.id === b.self?.id &&
    a.self?.name === b.self?.name &&
    a.self?.role === b.self?.role &&
    a.self?.color === b.self?.color &&
    sameParticipants(a.participants, b.participants)
  );
}

/** What the reconnect loop should do after a failed step. */
export type FailureAction =
  | { kind: 'terminal'; state: TerminalState }
  /** Ask for a fresh ticket right away: it reports the new generation. */
  | { kind: 'generation' }
  /** Keep retrying with capped exponential backoff and jitter. */
  | { kind: 'retry'; retryAfterMs?: number };

/** Maps a failed `POST /collab-ticket` to the next step. */
export function mapTicketError(error: unknown): FailureAction {
  if (!(error instanceof ApiError)) return { kind: 'retry' };
  const code: ClientErrorCode = error.code;
  switch (code) {
    case 'share_revoked':
    case 'forbidden':
    case 'not_found':
    case 'share_invalid':
      return { kind: 'terminal', state: 'access_revoked' };
    case 'share_expired':
    case 'session_expired':
    case 'unauthenticated':
      return { kind: 'terminal', state: 'access_expired' };
    case 'update_required':
      return { kind: 'terminal', state: 'update_required' };
    case 'document_trashed':
      return { kind: 'terminal', state: 'document_unavailable' };
    case 'generation_mismatch':
      return { kind: 'generation' };
    case 'rate_limited':
      return {
        kind: 'retry',
        retryAfterMs:
          error.retryAfterSeconds !== undefined
            ? Math.min(120_000, Math.max(0, error.retryAfterSeconds * 1000))
            : undefined,
      };
    default:
      // network_error, server_busy, storage_unavailable, internal and anything
      // unexpected: the server may recover, so keep trying with backoff.
      return { kind: 'retry' };
  }
}

/**
 * Maps a Hocuspocus authentication failure. `access_denied` is not precise
 * enough to pick a terminal state, so the loop requests a new ticket and lets
 * the HTTP error code decide.
 */
export function mapAuthFailure(reason: string): FailureAction {
  switch (reason as CollabAuthFailure) {
    case 'update_required':
      return { kind: 'terminal', state: 'update_required' };
    case 'document_unavailable':
      return { kind: 'terminal', state: 'document_unavailable' };
    case 'generation_mismatch':
      return { kind: 'generation' };
    default:
      return { kind: 'retry' };
  }
}

/** Terminal state for an `access` side-channel message, or null for `role_changed`. */
export function mapAccessChange(change: AccessChange): TerminalState | null {
  switch (change) {
    case 'revoked':
      return 'access_revoked';
    case 'expired':
    case 'session_ended':
      return 'access_expired';
    case 'document_unavailable':
      return 'document_unavailable';
    case 'role_changed':
      return null;
  }
}

/**
 * Maps a WebSocket close event (or the reason carried by a Hocuspocus CLOSE
 * message) of the collaboration endpoint to the next step, following
 * `COLLAB_CLOSE`. The reason string decides; a bare code is only trusted when
 * it cannot be confused with Hocuspocus' own codes (4401 "Unauthorized" is
 * also used for malformed frames, so it falls through to a ticket request,
 * which reports the precise cause).
 */
export function mapCloseEvent(
  event: { code?: number; reason?: string } | undefined,
): FailureAction {
  const reason = event?.reason ?? '';
  switch (reason) {
    case 'access_revoked':
      return { kind: 'terminal', state: 'access_revoked' };
    case 'access_expired':
    case 'session_ended':
      return { kind: 'terminal', state: 'access_expired' };
    case 'document_unavailable':
      return { kind: 'terminal', state: 'document_unavailable' };
    case 'generation_changed':
      return { kind: 'generation' };
    default:
      break;
  }
  if (reason === '') {
    switch (event?.code) {
      case 4410:
        return { kind: 'terminal', state: 'access_expired' };
      case 4404:
        return { kind: 'terminal', state: 'document_unavailable' };
      case 4409:
        return { kind: 'generation' };
      default:
        break;
    }
  }
  return { kind: 'retry' };
}
