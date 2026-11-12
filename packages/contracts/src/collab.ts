/**
 * Collaboration side-channel protocol.
 *
 * Document content travels as ordinary Yjs sync/update messages handled by
 * Hocuspocus. Everything in this file travels as Hocuspocus *stateless*
 * messages (JSON strings) on the same authenticated WebSocket and never
 * touches durable document state.
 *
 * Durable acknowledgement ("Saved")
 * ---------------------------------
 * The client counts its own local Yjs transactions in `n` (a per-session
 * monotonic integer covering insertions, formatting AND deletion-only edits).
 *
 * 1. Live phase: after sending local updates the client sends
 *    `{ t: 'mark', n }`. The server processes one connection's frames strictly
 *    in order, so when it handles the marker every update the client sent
 *    before it has already been applied and appended to the document's
 *    ordered write queue. The server answers `{ t: 'saved', n }` only after
 *    that queue position has been committed to PostgreSQL.
 * 2. (Re)connect phase: after the sync handshake the client sends
 *    `{ t: 'hello', n, snapshot }` where `snapshot` is
 *    base64(Y.encodeSnapshot(Y.snapshot(doc))) — state vector plus delete
 *    set. The server answers `saved` only if its document already contains
 *    every struct AND every deletion in that snapshot and all of it is
 *    committed; otherwise it answers `resync` and the client repeats the sync
 *    handshake and sends `hello` again. This proves offline work arrived,
 *    including deletion-only edits that a state vector alone cannot show.
 *
 * A database failure produces `save-error`, never `saved`. The server keeps
 * retrying and sends `saved` once the commit finally succeeds.
 */
import { z } from './zod';
import { EffectiveRole } from './roles';

// ── Client → server ─────────────────────────────────────────────────────────

export const ClientHello = z.object({
  t: z.literal('hello'),
  n: z.number().int().min(0),
  /** base64 of `Y.encodeSnapshot(Y.snapshot(doc))`. */
  snapshot: z.string().max(8 * 1024 * 1024),
});
export type ClientHello = z.infer<typeof ClientHello>;

/**
 * "Everything I sent on this connection before this message, up to my local
 * change number `n`." The server answers `saved` once all of it is committed.
 *
 * A marker proves nothing about an update the server refused (a read-only
 * connection, or a document that is not accepting edits): after a refusal the
 * server must not answer a marker with `saved`, and the client must not treat a
 * `saved` for a marker sent before the refusal as covering its pending work.
 * Only a new `hello` proof, checked against the server document, clears that state.
 */
export const ClientMark = z.object({ t: z.literal('mark'), n: z.number().int().min(0) });
export type ClientMark = z.infer<typeof ClientMark>;

/**
 * "My next update is a paste." A label for the version history, nothing more:
 * the server attributes and timestamps the update itself and treats this as
 * untrusted. Servers that do not know the message ignore it.
 */
export const ClientHint = z.object({
  t: z.literal('hint'),
  kind: z.literal('paste'),
  /** Client clock (epoch milliseconds). Informational. */
  at: z.number().int().min(0).optional(),
});
export type ClientHint = z.infer<typeof ClientHint>;

export const ClientStateless = z.discriminatedUnion('t', [ClientHello, ClientMark, ClientHint]);
export type ClientStateless = z.infer<typeof ClientStateless>;

// ── Server → client ─────────────────────────────────────────────────────────

/** Everything this connection sent up to marker `n` is committed to durable storage. */
export const ServerSaved = z.object({ t: z.literal('saved'), n: z.number().int().min(0) });
export type ServerSaved = z.infer<typeof ServerSaved>;

/** The server does not yet hold everything in the client's `hello` snapshot. */
export const ServerResync = z.object({ t: z.literal('resync'), n: z.number().int().min(0) });
export type ServerResync = z.infer<typeof ServerResync>;

export const SaveErrorCode = z.enum(['storage_unavailable', 'server_busy', 'generation_changed']);
export type SaveErrorCode = z.infer<typeof SaveErrorCode>;

/**
 * Marker `n` is NOT durable. `retrying: true` means the server still holds the
 * updates and will send `saved` later; the client keeps showing them as pending.
 */
export const ServerSaveError = z.object({
  t: z.literal('save-error'),
  n: z.number().int().min(0),
  code: SaveErrorCode,
  retrying: z.boolean(),
});
export type ServerSaveError = z.infer<typeof ServerSaveError>;

/**
 * Document-wide persistence health. While `degraded` with `acceptingEdits:
 * false` the server refuses new document updates (bounded queue is full);
 * clients keep edits locally and call `forceSync` + `hello` when it returns to `ok`.
 */
export const ServerPersistence = z.object({
  t: z.literal('persistence'),
  state: z.enum(['ok', 'degraded']),
  acceptingEdits: z.boolean(),
});
export type ServerPersistence = z.infer<typeof ServerPersistence>;

export const AccessChange = z.enum([
  /** Access ended because a share link, membership or account was revoked. */
  'revoked',
  /** Access ended because the share link or session reached its expiry. */
  'expired',
  /** Still connected, but the role changed (see `role`). */
  'role_changed',
  /** The document was moved to trash or deleted. */
  'document_unavailable',
  /** The user logged out or the session was ended elsewhere. */
  'session_ended',
]);
export type AccessChange = z.infer<typeof AccessChange>;

/** Sent just before the server closes or downgrades a connection. */
export const ServerAccess = z.object({
  t: z.literal('access'),
  change: AccessChange,
  /** New role for `role_changed`; absent when access ended. */
  role: EffectiveRole.optional(),
});
export type ServerAccess = z.infer<typeof ServerAccess>;

/**
 * The document moved to a new generation (snapshot restore). The connection is
 * closed right after; the client must keep any unsaved work of the old
 * generation as a separate recovery draft and reconnect with a fresh Y.Doc.
 */
export const ServerGeneration = z.object({
  t: z.literal('generation'),
  generation: z.number().int().min(1),
  reason: z.literal('snapshot_restored'),
  snapshotName: z.string().optional(),
  byName: z.string().optional(),
});
export type ServerGeneration = z.infer<typeof ServerGeneration>;

/** The server is shutting down gracefully; reconnect with backoff. */
export const ServerShutdown = z.object({ t: z.literal('shutdown') });
export type ServerShutdown = z.infer<typeof ServerShutdown>;

export const ServerStateless = z.discriminatedUnion('t', [
  ServerSaved,
  ServerResync,
  ServerSaveError,
  ServerPersistence,
  ServerAccess,
  ServerGeneration,
  ServerShutdown,
]);
export type ServerStateless = z.infer<typeof ServerStateless>;

// ── Authentication failures ─────────────────────────────────────────────────

/**
 * `reason` of a Hocuspocus authentication failure. Terminal reasons must stop
 * automatic reconnection; the client re-requests a ticket to learn the precise
 * HTTP error code where needed.
 */
export const CollabAuthFailure = z.enum([
  'ticket_invalid',
  'ticket_expired',
  'access_denied',
  'generation_mismatch',
  'update_required',
  'document_unavailable',
  'server_busy',
]);
export type CollabAuthFailure = z.infer<typeof CollabAuthFailure>;

/** WebSocket close codes used by the collaboration endpoint (4000–4999 = application). */
export const COLLAB_CLOSE = {
  accessRevoked: { code: 4403, reason: 'access_revoked' },
  accessExpired: { code: 4410, reason: 'access_expired' },
  generationChanged: { code: 4409, reason: 'generation_changed' },
  documentUnavailable: { code: 4404, reason: 'document_unavailable' },
  sessionEnded: { code: 4401, reason: 'session_ended' },
  rateLimited: { code: 4429, reason: 'rate_limited' },
  serverShutdown: { code: 4503, reason: 'server_shutdown' },
  badOrigin: { code: 4400, reason: 'bad_origin' },
} as const;

// ── Presence (awareness) ────────────────────────────────────────────────────

/**
 * Shape of one awareness state as relayed by the server. Clients may only
 * propose `cursor`; the server overwrites `user` with the authenticated
 * identity, drops entries for any clientID other than the connection's own,
 * strips cursors from view-only connections and rate-limits updates.
 */
export const AwarenessUser = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  role: EffectiveRole,
  kind: z.enum(['user', 'guest']),
  roleLabel: z.string().optional(),
});
export type AwarenessUser = z.infer<typeof AwarenessUser>;

export const AwarenessState = z.object({
  user: AwarenessUser,
  /** Yjs relative positions as produced by the collaboration caret plugin. */
  cursor: z.object({ anchor: z.unknown(), head: z.unknown() }).nullable().optional(),
});
export type AwarenessState = z.infer<typeof AwarenessState>;

/** Server-side presence throttle: at most one relayed update per connection per interval. */
export const PRESENCE_MIN_INTERVAL_MS = 60;
/** Largest accepted serialized awareness state from one client. */
export const PRESENCE_MAX_STATE_BYTES = 2048;

// ── Client-visible status model ─────────────────────────────────────────────

/** Connection state shown in the UI. Kept separate from save state. */
export const ConnectionState = z.enum([
  'connecting',
  'live',
  'reconnecting',
  'offline',
  'access_expired',
  'access_revoked',
  'update_required',
  'document_unavailable',
]);
export type ConnectionState = z.infer<typeof ConnectionState>;

/**
 * Durability state shown in the UI.
 * - `saved`: every local change was acknowledged as committed to storage.
 * - `saving`: connected, waiting for the durable acknowledgement.
 * - `pending`: local changes exist that cannot be sent right now (offline/reconnecting).
 * - `error`: the server reported that it cannot commit; changes remain pending.
 * - `read_only`: this client cannot edit, so it has nothing to save.
 */
export const SaveState = z.enum(['saved', 'saving', 'pending', 'error', 'read_only']);
export type SaveState = z.infer<typeof SaveState>;
