/**
 * Collaboration endpoint: `WS /collab`, Hocuspocus on top of `ws`.
 *
 * Responsibilities (docs/architecture.md §5):
 * - transport guards: origin allow-list, connection cap, upgrade rate limit,
 *   frame size, per-socket message budget, application-level ping;
 * - authentication with single-use tickets and access re-resolved from the database;
 * - the durable update log and the `mark` / `hello` acknowledgement protocol;
 * - server-authoritative presence;
 * - live access enforcement (revocation, expiry, role changes, generations).
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  COLLAB_CLOSE,
  COLLAB_PROTOCOL_VERSION,
  COLLAB_WS_PATH,
  ClientStateless,
  type ClientHello,
  canEdit,
  collabDocumentName,
  parseCollabDocumentName,
  type AccessChange,
  type CollabAuthFailure,
  type EffectiveRole,
  type Participant,
  type ServerStateless,
} from '@realtimedocs/contracts';
import {
  Hocuspocus,
  isTransactionOrigin,
  type Connection,
  type Document,
  type WebSocketLike,
} from '@hocuspocus/server';
import * as decoding from 'lib0/decoding';
import { WebSocket as WsClient, WebSocketServer, type RawData, type WebSocket } from 'ws';
import * as Y from 'yjs';
import { resolveAccess, type AccessDeps } from '../access/resolve';
import { recordParticipantJoin } from '../service/sessions';
import { SYSTEM_ACTOR, tryAudit } from '../audit';
import { findSessionsByIds, touchSessions } from '../auth/sessions';
import type { Cluster, ControlMessage } from '../cluster/cluster';
import { newId } from '../auth/tokens';
import { allowedOrigins, type Config } from '../config';
import type { Db } from '../db/pool';
import { loadDurableState } from '../documents/store';
import type { Logger } from '../logger';
import type { Metrics } from '../metrics';
import { TokenBucket, TrailingThrottle, WindowLimiter, mapLimit } from '../util/limits';
import { clientIp } from '../util/net';
import { decodeClientSnapshot, snapshotContainedIn } from './containment';
import { DurableLog, type FatalReason } from './durable-log';
import {
  HistoryRecorder,
  SYSTEM_ACTOR as SYSTEM_HISTORY_ACTOR,
  collectAssetIdsFromDoc,
  type HistoryActor,
} from './history';
import { PgLogStore } from './pg-log-store';
import { PresenceThrottle, isAwarenessFrame, sanitizeAwareness } from './presence';
import type { Tickets } from './tickets';

interface CloseSpec {
  code: number;
  reason: string;
}

const CLOSE_AUTH_FAILED: CloseSpec = { code: 1008, reason: 'authentication_failed' };
const CLOSE_BUSY: CloseSpec = { code: 1013, reason: 'server_busy' };
const CLOSE_DOCUMENT_RESET: CloseSpec = { code: 1012, reason: 'document_reset' };
const CLOSE_UNSUPPORTED: CloseSpec = { code: 1003, reason: 'binary_frames_only' };

const PING_FRAME = new Uint8Array([9]);
const PONG_BYTE = 10;

/** y-protocols sync message types. */
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

/** Outgoing bytes a slow client may leave unread before it is disconnected. */
const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;
/** Unauthenticated sockets are closed after this long. */
const AUTH_DEADLINE_MS = 15_000;
const MAX_PENDING_MARKS = 256;
const MIN_HELLO_INTERVAL_MS = 200;
const LOAD_ORIGIN = Symbol('realtimedocs.load');

/**
 * Authentication / load failure. The message is deliberately empty: Hocuspocus
 * logs errors that carry one, and these are expected outcomes, not faults.
 */
class CollabDenied extends Error {
  constructor(readonly reason: CollabAuthFailure) {
    super('');
    this.name = 'CollabDenied';
  }
}

/** Hocuspocus' per-socket handler (the class itself is not exported by the package). */
type ClientConnection = ReturnType<Hocuspocus<CollabContext>['handleConnection']>;

class SocketState {
  readonly id = newId();
  readonly conns = new Set<ConnState>();
  readonly timers: NodeJS.Timeout[] = [];
  closing = false;
  // Assigned right after construction (they need a reference to this object).
  client!: ClientConnection;
  presence!: PresenceThrottle;
  /** With several instances a socket belongs to the one document it was routed for. */
  boundDocumentId: string | null = null;

  constructor(
    readonly ws: WebSocket,
    readonly ip: string,
    /** Inbound frame budget: burst and sustained rate. */
    readonly messages: TokenBucket,
    /** Inbound byte budget: burst and sustained rate. */
    readonly bytes: TokenBucket,
  ) {}
}

interface PendingMark {
  n: number;
  position: number;
}

interface ConnState {
  /** Opaque per-connection id; also the participant id in presence. */
  id: string;
  socket: SocketState;
  documentId: string;
  generation: number;
  documentName: string;
  /** Principals the ticket was issued for. Access is always re-resolved from these. */
  sessionIds: string[];
  grantingSessionIds: Set<string>;
  userId: string | null;
  grantId: string | null;
  role: EffectiveRole;
  roleReadOnly: boolean;
  participant: Participant;
  clientId: number;
  expiresAt: number | null;
  expiryTimer: NodeJS.Timeout | null;
  connection: Connection<CollabContext> | null;
  createdAt: number;
  marks: PendingMark[];
  /** An update from this connection was refused and not yet covered by a `hello` proof. */
  refused: boolean;
  saveErrorSent: boolean;
  /**
   * `hello` proofs of this connection. The containment check walks the whole
   * struct store, so it runs at most once per interval; a proof that arrives
   * earlier is not dropped but waits for its turn (only the latest one is kept).
   */
  hello: TrailingThrottle<DeferredHello>;
  closing: boolean;
  /** What the client announced for its next update (history label only). */
  pendingHint: { kind: 'paste'; at: number; clientAt: Date | null } | null;
}

/** A client hint describes the update that follows it within this time. */
const HINT_TTL_MS = 5_000;

function actorOf(state: ConnState): HistoryActor {
  const [sessionId] = state.grantingSessionIds;
  return {
    kind: state.participant.kind,
    userId: state.userId,
    grantId: state.grantId,
    name: state.participant.name,
    participantRole: state.participant.roleLabel?.toLowerCase() ?? state.role,
    sessionId: sessionId ?? state.sessionIds[0] ?? null,
    connectionId: state.id,
    clientId: state.clientId,
  };
}

interface DeferredHello {
  message: ClientHello;
  /** Runtime the proof was sent against; it is skipped if that runtime is gone. */
  runtime: DocRuntime;
}

interface CollabContext {
  socket: SocketState;
  auth?: ConnState;
}

interface DocRuntime {
  documentName: string;
  documentId: string;
  generation: number;
  document: Document;
  log: DurableLog;
  dead: boolean;
  appendFailuresLogged: number;
  /** The log was offered for compaction since the last update; avoids retrying in a loop. */
  compactionTriedForUnload: boolean;
  /** An edit was applied since this document was loaded (first-edit notification). */
  firstEditSeen: boolean;
  /** Summarises each applied transaction for the history; null when history is off. */
  recorder: HistoryRecorder | null;
}

export interface CollabDeps {
  config: Config;
  db: Db;
  logger: Logger;
  workspaceId: string;
  tickets: Tickets;
  /** Coordination with other instances; absent when the server runs alone. */
  cluster?: Cluster | null;
  metrics?: Metrics;
  /**
   * Called once per loaded document with its first applied edit. The receiver
   * decides whether that is the first edit ever (interview-session webhook).
   */
  onFirstEdit?: (documentId: string) => void;
}

export interface GenerationNotice {
  snapshotName?: string;
  byName?: string;
}

function closeForChange(change: Exclude<AccessChange, 'role_changed'>): CloseSpec {
  switch (change) {
    case 'expired':
      return COLLAB_CLOSE.accessExpired;
    case 'document_unavailable':
      return COLLAB_CLOSE.documentUnavailable;
    case 'session_ended':
      return COLLAB_CLOSE.sessionEnded;
    case 'revoked':
      return COLLAB_CLOSE.accessRevoked;
  }
}

interface BufferedFrame {
  data: RawData;
  isBinary: boolean;
}

function rawLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.byteLength, 0);
  return data.byteLength;
}

/** Every Hocuspocus frame starts with the name of the document it is for. */
function documentNameOfFrame(data: RawData): string | null {
  try {
    const buffer = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : data;
    if (buffer.byteLength < 2) return null;
    return decoding.readVarString(
      decoding.createDecoder(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)),
    );
  } catch {
    return null;
  }
}

/** Closes with `code` when the protocol allows sending it, else with "service restart". */
function safeClose(ws: WebSocket | WsClient, code: number, reason: string): void {
  const sendable =
    (code >= 1000 && code <= 1003) ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999);
  try {
    if (ws.readyState === ws.OPEN) {
      ws.close(sendable ? code : 1012, sendable ? reason.slice(0, 120) : 'connection_lost');
    } else if (ws.readyState === ws.CONNECTING) {
      ws.terminate();
    }
  } catch {
    ws.terminate();
  }
}

export class CollabServer {
  readonly hocuspocus: Hocuspocus<CollabContext>;

  private readonly config: Config;
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly workspaceId: string;
  private readonly tickets: Tickets;
  private readonly cluster: Cluster | null;
  private readonly metrics: Metrics | null;
  private readonly onFirstEdit: ((documentId: string) => void) | null;
  private drainingFlag = false;
  /** Sockets whose first frame has not been routed yet (several instances only). */
  private routing = 0;
  /** Sockets forwarded to the instance that owns their document. */
  private readonly forwards = new Set<{ client: WebSocket; upstream: WsClient }>();
  private readonly accessDeps: AccessDeps;
  private readonly store: PgLogStore;
  private readonly origins: Set<string>;
  private readonly wss: WebSocketServer;
  private readonly upgradeLimiter: WindowLimiter;

  private readonly sockets = new Set<SocketState>();
  private readonly runtimes = new Map<string, DocRuntime>();
  private readonly loadInfo = new WeakMap<
    Document,
    { headSeq: number; rows: number; hasCheckpoint: boolean; rowsSinceCheckpoint: number }
  >();
  /** Live and pending connections by document id. */
  private readonly registry = new Map<string, Set<ConnState>>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private shuttingDown = false;

  constructor(deps: CollabDeps) {
    this.config = deps.config;
    this.db = deps.db;
    this.logger = deps.logger.child({ component: 'collab' });
    this.workspaceId = deps.workspaceId;
    this.tickets = deps.tickets;
    this.cluster = deps.cluster ?? null;
    this.metrics = deps.metrics ?? null;
    this.onFirstEdit = deps.onFirstEdit ?? null;
    if (this.metrics) {
      this.metrics.gauge(
        'rd_ws_connections',
        'Collaboration sockets served by this instance.',
        () => this.sockets.size,
      );
      this.metrics.gauge(
        'rd_ws_forwarded_connections',
        'Collaboration sockets forwarded to the instance that owns their document.',
        () => this.forwards.size,
      );
      this.metrics.gauge(
        'rd_documents_loaded',
        'Documents held in memory.',
        () => this.runtimes.size,
      );
      this.metrics.gauge(
        'rd_persist_queue_bytes',
        'Update bytes accepted and not yet committed (background queue depth).',
        () => {
          let total = 0;
          for (const runtime of this.runtimes.values()) total += runtime.log.pendingBytes;
          return total;
        },
      );
    }
    if (this.cluster) {
      this.cluster.setLoadedCheck((documentId) => this.hasRuntime(documentId));
      this.cluster.onLeaseLost((documentId) => this.dropDocument(documentId));
      this.cluster.onControl((message) => this.onControl(message));
    }
    this.accessDeps = {
      db: deps.db,
      sessionTtl: deps.config.sessions,
      workspaceId: deps.workspaceId,
    };
    this.store = new PgLogStore(deps.db, deps.workspaceId);
    this.origins = allowedOrigins(deps.config);
    this.upgradeLimiter = new WindowLimiter(deps.config.rateLimits.wsUpgradePerMinute, 60_000);
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: deps.config.limits.maxCollabMessageBytes,
      perMessageDeflate: false,
      clientTracking: false,
    });

    this.hocuspocus = new Hocuspocus<CollabContext>({
      name: 'realtimedocs',
      quiet: true,
      timeout: deps.config.collab.idleTimeoutMs,
      debounce: 2_000,
      maxDebounce: 10_000,
      unloadImmediately: true,
      // Coalesce broadcasts within one event-loop turn; no artificial delay.
      flushDelay: 0,
      maxUnauthenticatedQueueSize: 1024 * 1024,
      maxUnauthenticatedQueueMessages: 256,
      maxPendingDocuments: 2,
      onAuthenticate: (data) => this.onAuthenticate(data),
      onLoadDocument: (data) => this.onLoadDocument(data),
      afterLoadDocument: async (data) => this.afterLoadDocument(data.document, data.documentName),
      connected: async (data) => this.onConnected(data.context, data.connection),
      beforeSync: async (data) => this.beforeSync(data.connection, data.type),
      beforeHandleAwareness: async (data) => {
        const state = data.connection?.context.auth;
        if (!state) {
          // Presence is only ever written by authenticated client connections.
          data.states.clear();
          data.removedClients.clear();
          return;
        }
        sanitizeAwareness(data.states, data.removedClients, {
          clientId: state.clientId,
          user: state.participant,
          readOnly: state.roleReadOnly,
        });
      },
      onStateless: async (data) => this.onStateless(data.connection, data.document, data.payload),
      onStoreDocument: async (data) => this.onStoreDocument(data.document, data.documentName),
      beforeUnloadDocument: async (data) => {
        const runtime = this.runtimes.get(data.documentName);
        if (!runtime || runtime.dead) return;
        // Documents with uncommitted updates are never unloaded.
        if (runtime.log.busy) throw new CollabDenied('server_busy');
        // Fold the log into the compacted state before letting go of the
        // document (once; if storage is down the log simply stays as it is).
        // The log's `idle` event retries the unload afterwards.
        if (runtime.log.rowsSinceCompaction > 0 && !runtime.compactionTriedForUnload) {
          runtime.compactionTriedForUnload = true;
          this.requestCompaction(runtime);
          throw new CollabDenied('server_busy');
        }
      },
      afterUnloadDocument: async (data) => {
        const runtime = this.runtimes.get(data.documentName);
        if (!runtime) return;
        runtime.log.close();
        runtime.recorder?.destroy();
        this.runtimes.delete(data.documentName);
        this.cluster?.releaseIfUnused(runtime.documentId);
      },
      onDisconnect: async (data) => {
        const state = (data.context as CollabContext | undefined)?.auth;
        if (!state) return;
        this.forget(state);
        // Hocuspocus removed this connection's presence but keeps the awareness
        // clock. Drop it too, otherwise the same client reconnecting with an
        // unchanged clock would stay invisible until its next presence change.
        const { document } = data;
        const reused = [...(this.registry.get(state.documentId) ?? [])].some(
          (other) => other.clientId === state.clientId && !other.closing,
        );
        if (reused || document.isDestroyed) return;
        // The removal is still waiting to be broadcast and that broadcast reads
        // the clock: send it first, then forget the clock.
        document.flush();
        if (!document.awareness.getStates().has(state.clientId)) {
          document.awareness.meta.delete(state.clientId);
        }
      },
    });
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  /** Handles `upgrade` requests for the collaboration path on the given HTTP server. */
  attach(server: HttpServer): void {
    server.on('upgrade', (request, socket, head) => this.onUpgrade(request, socket, head));
    this.sweepTimer = setInterval(() => void this.sweep(), this.config.collab.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  private onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    let pathname: string | null;
    try {
      pathname = new URL(request.url ?? '/', 'http://collab.invalid').pathname;
    } catch {
      pathname = null;
    }
    if (pathname !== COLLAB_WS_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (this.shuttingDown) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    socket.on('error', () => socket.destroy());
    this.wss.handleUpgrade(request, socket, head, (ws) => this.onSocket(ws, request));
  }

  private onSocket(ws: WebSocket, request: IncomingMessage): void {
    // A socket forwarded by a peer instance carries the client address it vouches for.
    const forwardedIp = this.cluster?.verifyInternal(request.headers) ?? null;
    const ip = forwardedIp ?? clientIp(request, this.config.trustProxy);
    // Registered before anything else: an unhandled 'error' event would crash the process.
    ws.on('error', (err) => {
      this.logger.debug({ err, ip }, 'collaboration socket error');
      // `ws` has already started closing with the matching code (for example
      // 1009 for an oversized frame); give that a moment, then cut the socket.
      setTimeout(() => ws.terminate(), 1_000).unref();
    });
    // The handshake is completed first so the client can read a precise close code.
    // (A forwarded socket was already counted by the instance that accepted it.)
    if (forwardedIp === null && !this.upgradeLimiter.take(ip)) {
      this.metrics?.wsConnections.inc({ outcome: 'rejected_rate_limit' });
      ws.close(COLLAB_CLOSE.rateLimited.code, COLLAB_CLOSE.rateLimited.reason);
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.origins.has(origin)) {
      this.logger.warn({ ip }, 'collaboration connection from a disallowed origin rejected');
      this.metrics?.wsConnections.inc({ outcome: 'rejected_origin' });
      ws.close(COLLAB_CLOSE.badOrigin.code, COLLAB_CLOSE.badOrigin.reason);
      return;
    }
    if (
      this.sockets.size + this.forwards.size + this.routing >=
      this.config.collab.maxConnections
    ) {
      this.logger.warn({ ip }, 'collaboration connection cap reached');
      this.metrics?.wsConnections.inc({ outcome: 'rejected_capacity' });
      ws.close(CLOSE_BUSY.code, CLOSE_BUSY.reason);
      return;
    }
    if (!this.cluster) {
      this.serveLocal(ws, ip, origin, null, []);
      return;
    }
    this.routeSocket(this.cluster, ws, ip, origin, forwardedIp !== null);
  }

  /**
   * Several instances: the first frame names the document, the lease says which
   * instance owns it. The socket is then served here or forwarded to the owner.
   */
  private routeSocket(
    cluster: Cluster,
    ws: WebSocket,
    ip: string,
    origin: string,
    forwarded: boolean,
  ): void {
    const buffered: BufferedFrame[] = [];
    let bufferedBytes = 0;
    let routing = false;
    // Counted against the connection cap until it is served, forwarded or gone.
    this.routing += 1;
    let counted = true;
    const uncount = (): void => {
      if (counted) this.routing -= 1;
      counted = false;
    };
    const deadline = setTimeout(() => {
      ws.close(CLOSE_AUTH_FAILED.code, CLOSE_AUTH_FAILED.reason);
    }, AUTH_DEADLINE_MS);
    const onEarlyClose = (): void => {
      clearTimeout(deadline);
      uncount();
    };
    const onMessage = (data: RawData, isBinary: boolean): void => {
      buffered.push({ data, isBinary });
      bufferedBytes += rawLength(data);
      if (buffered.length > 64 || bufferedBytes > this.config.limits.maxCollabMessageBytes * 2) {
        ws.close(CLOSE_BUSY.code, CLOSE_BUSY.reason);
        return;
      }
      if (routing) return;
      const name = isBinary ? parseCollabDocumentName(documentNameOfFrame(data) ?? '') : null;
      if (!name) {
        ws.close(CLOSE_AUTH_FAILED.code, CLOSE_AUTH_FAILED.reason);
        return;
      }
      routing = true;
      const { documentId } = name;
      cluster
        .route(documentId)
        .then((owner) => {
          clearTimeout(deadline);
          uncount();
          ws.off('message', onMessage);
          ws.off('close', onEarlyClose);
          if (ws.readyState !== ws.OPEN || this.shuttingDown) {
            if (owner.local) cluster.release(documentId);
            if (ws.readyState === ws.OPEN) ws.close(CLOSE_BUSY.code, CLOSE_BUSY.reason);
            return;
          }
          if (owner.local) {
            this.serveLocal(ws, ip, origin, documentId, buffered);
          } else if (forwarded) {
            // A peer forwarded this socket here, but ownership has moved on. The
            // client reconnects and is routed again.
            ws.close(CLOSE_DOCUMENT_RESET.code, CLOSE_DOCUMENT_RESET.reason);
          } else {
            this.forward(cluster, ws, ip, origin, owner.url, buffered);
          }
        })
        .catch((err: unknown) => {
          clearTimeout(deadline);
          this.logger.warn({ err, documentId }, 'document owner could not be determined');
          ws.close(CLOSE_BUSY.code, CLOSE_BUSY.reason);
        });
    };
    ws.on('message', onMessage);
    ws.on('close', onEarlyClose);
  }

  /** Pipes a client socket to the instance that owns its document, frame for frame. */
  private forward(
    cluster: Cluster,
    client: WebSocket,
    ip: string,
    origin: string,
    ownerUrl: string,
    buffered: BufferedFrame[],
  ): void {
    const upstream = new WsClient(`${ownerUrl.replace(/^http/, 'ws')}${COLLAB_WS_PATH}`, {
      headers: cluster.internalHeaders(ip, origin),
      perMessageDeflate: false,
      handshakeTimeout: 5_000,
      maxPayload: this.config.limits.maxCollabMessageBytes,
    });
    const pair = { client, upstream };
    this.forwards.add(pair);
    this.metrics?.wsConnections.inc({ outcome: 'forwarded' });
    const pending = buffered.slice();
    let pendingBytes = pending.reduce((total, frame) => total + rawLength(frame.data), 0);
    let open = false;
    const closeBoth = (code: number, reason: string): void => {
      this.forwards.delete(pair);
      safeClose(client, code, reason);
      safeClose(upstream, code, reason);
    };
    upstream.on('open', () => {
      open = true;
      for (const frame of pending) upstream.send(frame.data, { binary: frame.isBinary });
      pending.length = 0;
    });
    upstream.on('error', (err) => {
      this.logger.debug({ err }, 'forwarded collaboration socket failed');
      closeBoth(CLOSE_BUSY.code, CLOSE_BUSY.reason);
    });
    client.on('message', (data: RawData, isBinary: boolean) => {
      if (!open) {
        pending.push({ data, isBinary });
        pendingBytes += rawLength(data);
        // Same bounds as while routing: the owner is not connected yet.
        if (pending.length > 64 || pendingBytes > this.config.limits.maxCollabMessageBytes * 2) {
          closeBoth(CLOSE_BUSY.code, CLOSE_BUSY.reason);
        }
        return;
      }
      if (upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
        closeBoth(CLOSE_BUSY.code, CLOSE_BUSY.reason);
        return;
      }
      upstream.send(data, { binary: isBinary });
    });
    upstream.on('message', (data: RawData, isBinary: boolean) => {
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        // The client is not reading; do not buffer without bound for it.
        closeBoth(CLOSE_BUSY.code, CLOSE_BUSY.reason);
        return;
      }
      client.send(data, { binary: isBinary });
    });
    // Close codes travel through unchanged, so the client sees what the owner decided.
    upstream.on('close', (code, reason) => closeBoth(code, reason.toString('utf8')));
    client.on('close', (code, reason) => closeBoth(code, reason.toString('utf8')));
  }

  /** Serves a socket in this process. `buffered` are frames read while it was being routed. */
  private serveLocal(
    ws: WebSocket,
    ip: string,
    origin: string,
    documentId: string | null,
    buffered: BufferedFrame[],
  ): void {
    const state = new SocketState(
      ws,
      ip,
      // Frame budget: sized so that fast typing (one update, one marker and
      // presence per keystroke) and programmatic edits never look like abuse.
      new TokenBucket(this.config.collab.frameBurst, this.config.collab.framesPerSecond),
      // Burst of 16 MiB (at least two maximum-size frames), 2 MiB/s sustained.
      new TokenBucket(
        Math.max(16 * 1024 * 1024, this.config.limits.maxCollabMessageBytes * 2),
        2 * 1024 * 1024,
      ),
    );

    const transport: WebSocketLike = {
      send: (data) => {
        if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
          // The client is not reading; do not buffer without bound for it.
          this.closeSocket(state, CLOSE_BUSY);
          return;
        }
        ws.send(data as Uint8Array, { binary: true });
      },
      close: (code, reason) => ws.close(code, reason),
      get readyState() {
        return ws.readyState;
      },
    };

    state.client = this.hocuspocus.handleConnection(
      transport,
      new Request(`${this.config.publicOrigin}${COLLAB_WS_PATH}`, { headers: { origin } }),
      { socket: state },
    );
    state.presence = new PresenceThrottle((frame) => {
      if (!state.closing) state.client.handleMessage(frame);
    });
    state.boundDocumentId = documentId;
    this.sockets.add(state);
    this.metrics?.wsConnections.inc({ outcome: 'accepted' });

    state.timers.push(
      setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        // Application-level ping understood by @hocuspocus/provider (answers with
        // a single 0x0a byte) plus a protocol-level ping for other clients.
        ws.send(PING_FRAME, { binary: true });
        ws.ping();
      }, this.config.collab.pingIntervalMs),
      setTimeout(() => {
        if (![...state.conns].some((conn) => conn.connection !== null)) {
          this.closeSocket(state, CLOSE_AUTH_FAILED);
        }
      }, AUTH_DEADLINE_MS),
    );

    ws.on('pong', () => state.client.touch());
    ws.on('message', (data: RawData, isBinary: boolean) => this.onFrame(state, data, isBinary));
    ws.on('close', (code, reason) => {
      state.closing = true;
      for (const timer of state.timers) clearTimeout(timer);
      state.presence.dispose();
      this.sockets.delete(state);
      try {
        state.client.handleClose({ code, reason: reason.toString('utf8') });
      } catch (err) {
        this.logger.warn({ err }, 'error while closing a collaboration connection');
      }
      for (const conn of [...state.conns]) this.forget(conn);
      if (documentId) this.cluster?.release(documentId);
    });
    for (const frame of buffered) this.onFrame(state, frame.data, frame.isBinary);
  }

  private onFrame(state: SocketState, data: RawData, isBinary: boolean): void {
    if (state.closing) return;
    if (!isBinary) {
      this.closeSocket(state, CLOSE_UNSUPPORTED);
      return;
    }
    const frame = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data;
    if (!state.messages.take(1) || !state.bytes.take(frame.byteLength)) {
      this.logger.warn({ socket: state.id, ip: state.ip }, 'collaboration message budget exceeded');
      this.closeSocket(state, COLLAB_CLOSE.rateLimited);
      return;
    }
    if (frame.byteLength === 1) {
      // The provider's reply to our ping. Never forwarded: Hocuspocus would
      // read the byte as a document-name length and drop the connection.
      if (frame[0] === PONG_BYTE) state.client.touch();
      return;
    }
    if (frame.byteLength === 0) return;
    if (isAwarenessFrame(frame)) state.presence.offer(frame);
    else state.client.handleMessage(frame);
  }

  // ── Hocuspocus hooks ──────────────────────────────────────────────────────

  private async onAuthenticate(data: {
    token: string;
    documentName: string;
    context: CollabContext;
    connectionConfig: { readOnly: boolean };
  }): Promise<Partial<CollabContext>> {
    const socket = data.context.socket;
    try {
      return await this.authenticate(socket, data.token, data.documentName, data.connectionConfig);
    } catch (error) {
      // Give the client a moment to read the failure, then free the socket.
      const timer = setTimeout(() => {
        if (![...socket.conns].some((conn) => conn.connection !== null)) {
          this.closeSocket(socket, CLOSE_AUTH_FAILED);
        }
      }, 1_000);
      socket.timers.push(timer);
      if (error instanceof CollabDenied) throw error;
      this.logger.error({ err: error }, 'collaboration authentication failed unexpectedly');
      throw new CollabDenied('server_busy');
    }
  }

  private async authenticate(
    socket: SocketState,
    token: string,
    documentName: string,
    connectionConfig: { readOnly: boolean },
  ): Promise<Partial<CollabContext>> {
    if (this.shuttingDown) throw new CollabDenied('server_busy');
    // One document per socket: nothing in this product multiplexes.
    if (socket.conns.size > 0) throw new CollabDenied('ticket_invalid');
    const name = parseCollabDocumentName(documentName);
    if (!name) throw new CollabDenied('ticket_invalid');

    // The socket was routed for one document; it cannot open another one here.
    if (socket.boundDocumentId !== null && socket.boundDocumentId !== name.documentId) {
      throw new CollabDenied('ticket_invalid');
    }
    const consumed = await this.tickets.consume(token);
    if (!consumed.ok) throw new CollabDenied(consumed.reason);
    const ticket = consumed.data;
    if (ticket.documentId !== name.documentId) throw new CollabDenied('ticket_invalid');
    if (this.runtimes.get(documentName)?.dead) throw new CollabDenied('server_busy');

    // The role is never taken from the ticket: access is resolved again, now.
    const sessions = await findSessionsByIds(this.db, this.workspaceId, ticket.sessionIds);
    const access = await resolveAccess(this.accessDeps, sessions, ticket.documentId);
    if (!access.ok) {
      throw new CollabDenied(
        access.change === 'document_unavailable' ? 'document_unavailable' : 'access_denied',
      );
    }
    if (access.document.generation !== name.generation || ticket.generation !== name.generation) {
      throw new CollabDenied('generation_mismatch');
    }
    const requiredSchema = Math.max(
      access.document.schemaVersion,
      this.config.minClientSchemaVersion,
    );
    if (
      ticket.protocolVersion !== COLLAB_PROTOCOL_VERSION ||
      ticket.schemaVersion < requiredSchema
    ) {
      throw new CollabDenied('update_required');
    }
    // A presence slot belongs to one principal at a time.
    for (const other of this.registry.get(ticket.documentId) ?? []) {
      if (
        other.clientId === ticket.clientId &&
        !other.closing &&
        !other.sessionIds.some((id) => ticket.sessionIds.includes(id))
      ) {
        throw new CollabDenied('access_denied');
      }
    }

    const state: ConnState = {
      id: ticket.participant.id,
      socket,
      documentId: ticket.documentId,
      generation: name.generation,
      documentName,
      sessionIds: ticket.sessionIds,
      grantingSessionIds: new Set(access.grantingSessionIds),
      userId: access.accountId,
      grantId: access.grantId,
      role: access.role,
      roleReadOnly: !canEdit(access.role),
      participant: { ...ticket.participant, role: access.role },
      clientId: ticket.clientId,
      expiresAt: access.expiresAt ? access.expiresAt.getTime() : null,
      expiryTimer: null,
      connection: null,
      createdAt: Date.now(),
      marks: [],
      refused: false,
      saveErrorSent: false,
      hello: new TrailingThrottle<DeferredHello>(
        (deferred) => this.processHello(state, deferred),
        MIN_HELLO_INTERVAL_MS,
      ),
      closing: false,
      pendingHint: null,
    };
    connectionConfig.readOnly = state.roleReadOnly;
    if (access.participant) {
      // Joined times and the `participant.joined` webhook; never delays or fails the connection.
      recordParticipantJoin(
        { db: this.db, workspace: { id: this.workspaceId } },
        access.participant.participantId,
      ).catch((err: unknown) => this.logger.warn({ err }, 'could not record a participant join'));
    }
    socket.conns.add(state);
    let set = this.registry.get(state.documentId);
    if (!set) {
      set = new Set();
      this.registry.set(state.documentId, set);
    }
    set.add(state);
    return { auth: state };
  }

  private async onLoadDocument(data: { document: Document; documentName: string }): Promise<void> {
    const name = parseCollabDocumentName(data.documentName);
    if (!name) throw new CollabDenied('ticket_invalid');
    let durable;
    try {
      durable = await loadDurableState(this.db, this.workspaceId, name.documentId);
    } catch (err) {
      this.logger.error({ err, documentId: name.documentId }, 'document could not be loaded');
      throw new CollabDenied('server_busy');
    }
    if (!durable || durable.status === 'trashed') throw new CollabDenied('document_unavailable');
    if (durable.generation !== name.generation) throw new CollabDenied('generation_mismatch');
    if (durable.state) Y.applyUpdate(data.document, durable.state, LOAD_ORIGIN);
    for (const update of durable.updates) Y.applyUpdate(data.document, update, LOAD_ORIGIN);
    let hasCheckpoint = true;
    let rowsSinceCheckpoint = 0;
    if (this.config.history.enabled) {
      try {
        const history = await this.db.query<{
          checkpoint: string | null;
          rows: string;
          lastSeq: string | null;
        }>(
          `SELECT c.hseq AS checkpoint,
                  (SELECT count(*) FROM doc_history h
                    WHERE h.document_id = $1 AND h.generation = $2
                      AND h.hseq > COALESCE(c.hseq, 0)) AS rows,
                  (SELECT max(seq) FROM doc_history h
                    WHERE h.document_id = $1 AND h.generation = $2) AS "lastSeq"
             FROM (SELECT max(hseq) AS hseq FROM doc_history
                    WHERE document_id = $1 AND generation = $2 AND kind = 'checkpoint') c`,
          [name.documentId, name.generation],
        );
        // History is complete when it reaches the head of the log. It does not
        // after commits made without it (recording switched off, or an older
        // server version during a rollback): then a new starting state is
        // recorded, so that later revisions are rebuilt from the right base.
        const lastSeq = history.rows[0]?.lastSeq;
        hasCheckpoint =
          history.rows[0]?.checkpoint != null &&
          lastSeq != null &&
          Number(lastSeq) >= durable.headSeq;
        rowsSinceCheckpoint = Number(history.rows[0]?.rows ?? 0);
      } catch (err) {
        this.logger.error({ err, documentId: name.documentId }, 'history state could not be read');
        throw new CollabDenied('server_busy');
      }
    }
    this.loadInfo.set(data.document, {
      headSeq: durable.headSeq,
      rows: durable.headSeq - durable.uptoSeq,
      hasCheckpoint,
      rowsSinceCheckpoint,
    });
  }

  private afterLoadDocument(document: Document, documentName: string): void {
    const name = parseCollabDocumentName(documentName);
    const info = this.loadInfo.get(document);
    if (!name || !info) throw new CollabDenied('server_busy');

    const historyOn = this.config.history.enabled;
    const runtime: DocRuntime = {
      documentName,
      documentId: name.documentId,
      generation: name.generation,
      document,
      dead: false,
      appendFailuresLogged: 0,
      compactionTriedForUnload: false,
      firstEditSeen: false,
      recorder: historyOn ? new HistoryRecorder(document) : null,
      log: new DurableLog({
        history: historyOn
          ? {
              // The state exactly as loaded (= head_seq): where this generation's history starts.
              baseline: info.hasCheckpoint
                ? null
                : {
                    state: Y.encodeStateAsUpdate(document),
                    attachmentIds: collectAssetIdsFromDoc(document),
                  },
              rowsSinceCheckpoint: info.rowsSinceCheckpoint,
              checkpointEvery: this.config.history.checkpointEvery,
              assetIds: () => collectAssetIdsFromDoc(document),
            }
          : undefined,
        documentId: name.documentId,
        generation: name.generation,
        headSeq: info.headSeq,
        rowsSinceCompaction: info.rows,
        store: this.store,
        maxQueueBytes: this.config.collab.maxQueueBytes,
        listeners: {
          committed: (position) => this.onCommitted(runtime, position),
          saveError: () => this.onSaveError(runtime),
          persistence: (status) => {
            if (runtime.dead) return;
            this.logger[status.state === 'ok' ? 'info' : 'warn'](
              { documentId: runtime.documentId, ...status },
              'document persistence state changed',
            );
            if (status.state === 'ok') runtime.appendFailuresLogged = 0;
            this.broadcast(runtime, { t: 'persistence', ...status });
          },
          fatal: (reason) => this.onFatal(runtime, reason),
          timing: (phase, milliseconds) =>
            this.metrics?.persistDuration.observe(milliseconds / 1000, { phase }),
          idle: () => this.unloadIfUnused(runtime),
          error: (err, phase) => {
            this.metrics?.persistFailures.inc({ phase });
            // One line when trouble starts, then every 20th attempt.
            runtime.appendFailuresLogged += 1;
            if (runtime.appendFailuresLogged === 1 || runtime.appendFailuresLogged % 20 === 0) {
              this.logger.error(
                {
                  err,
                  phase,
                  documentId: runtime.documentId,
                  attempts: runtime.appendFailuresLogged,
                },
                'durable log write failed; the batch is kept and will be retried',
              );
            }
          },
        },
      }),
    };
    this.runtimes.set(documentName, runtime);

    // Synchronous on purpose: queue order equals the order Yjs applied the updates in.
    document.on('update', (update: Uint8Array, origin: unknown) => {
      if (runtime.dead) return;
      if (
        isTransactionOrigin(origin) &&
        origin.source === 'connection' &&
        origin.connection.readOnly
      ) {
        this.onReadOnlyViolation(runtime, origin.connection as Connection<CollabContext>);
        return;
      }
      runtime.compactionTriedForUnload = false;
      this.metrics?.yjsUpdates.inc();
      if (!runtime.firstEditSeen) {
        runtime.firstEditSeen = true;
        this.onFirstEdit?.(runtime.documentId);
      }
      if (!runtime.recorder) {
        runtime.log.enqueue(update);
        return;
      }
      // Who: the connection the server authenticated, never anything the client says.
      const summary = runtime.recorder.take();
      const state =
        isTransactionOrigin(origin) && origin.source === 'connection'
          ? (origin.connection as Connection<CollabContext>).context.auth
          : undefined;
      let clientOccurredAt: Date | null = null;
      if (state?.pendingHint) {
        if (Date.now() - state.pendingHint.at <= HINT_TTL_MS) {
          summary.clientHint = state.pendingHint.kind;
          clientOccurredAt = state.pendingHint.clientAt;
        }
        state.pendingHint = null;
      }
      runtime.log.enqueue(update, {
        actor: state ? actorOf(state) : SYSTEM_HISTORY_ACTOR,
        summary,
        clientOccurredAt,
      });
    });
  }

  private onConnected(context: CollabContext, connection: Connection<CollabContext>): void {
    const state = context.auth;
    if (!state) return;
    state.connection = connection;
    if (state.closing) {
      // Access was withdrawn while the handshake was still in flight.
      this.closeSocket(state.socket, COLLAB_CLOSE.accessRevoked);
      return;
    }
    const runtime = this.runtimes.get(state.documentName);
    if (runtime) {
      connection.readOnly = this.effectiveReadOnly(state, runtime);
      if (runtime.log.status.state !== 'ok')
        this.send(state, { t: 'persistence', ...runtime.log.status });
    }
    this.scheduleExpiry(state);
  }

  private effectiveReadOnly(state: ConnState, runtime: DocRuntime | undefined): boolean {
    return state.roleReadOnly || !runtime || runtime.dead || !runtime.log.acceptingEdits;
  }

  /**
   * Runs before every sync frame is applied. This is where the effective
   * read-only flag is decided, immediately before Hocuspocus consults it.
   */
  private beforeSync(connection: Connection<CollabContext>, type: number): void {
    const state = connection.context.auth;
    if (!state) {
      connection.readOnly = true;
      return;
    }
    connection.readOnly =
      state.closing || this.effectiveReadOnly(state, this.runtimes.get(state.documentName));
    if (connection.readOnly && (type === SYNC_STEP_2 || type === SYNC_UPDATE)) {
      // Hocuspocus will refuse this frame; a later `mark` must not be answered with `saved`.
      state.refused = true;
    }
  }

  private onStateless(
    connection: Connection<CollabContext>,
    document: Document,
    payload: string,
  ): void {
    const state = connection.context.auth;
    const runtime = state ? this.runtimes.get(state.documentName) : undefined;
    if (!state || state.closing || !runtime || runtime.document !== document) return;
    let message: ClientStateless;
    try {
      message = ClientStateless.parse(JSON.parse(payload));
    } catch {
      return;
    }

    if (message.t === 'hint') {
      // Label for the next update of this connection. It changes nothing but the
      // history's wording, and only for an editor's own changes.
      if (!state.roleReadOnly) {
        const clientAt = message.at === undefined ? null : new Date(message.at);
        state.pendingHint = {
          kind: message.kind,
          at: Date.now(),
          clientAt: clientAt && !Number.isNaN(clientAt.getTime()) ? clientAt : null,
        };
      }
      return;
    }

    if (message.t === 'hello') {
      // Runs now, or — when the previous proof was less than one interval ago —
      // as soon as the interval has elapsed. Either way it gets an answer.
      state.hello.offer({ message, runtime });
      return;
    }
    if (this.answerIfDead(state, runtime, message.n)) return;
    if (state.refused) {
      this.answerNotHeld(state, runtime, message.n);
      return;
    }
    this.registerMarker(state, runtime, message.n);
  }

  /**
   * Answers a `hello` proof: `saved` (possibly later, once committed) only if
   * the server document contains every struct and deletion of the client's
   * snapshot; otherwise the client is told to sync again.
   */
  private processHello(state: ConnState, deferred: DeferredHello): void {
    const { message } = deferred;
    // The proof may have waited for its turn: look at the present, not at the
    // moment it arrived.
    const runtime = this.runtimes.get(state.documentName);
    if (state.closing || !runtime || runtime !== deferred.runtime) return;
    if (this.answerIfDead(state, runtime, message.n)) return;
    const snapshot = decodeClientSnapshot(message.snapshot);
    if (!snapshot || !snapshotContainedIn(runtime.document, snapshot)) {
      this.answerNotHeld(state, runtime, message.n);
      return;
    }
    // Everything the client holds is in the server document; what remains is durability.
    state.refused = false;
    this.registerMarker(state, runtime, message.n);
  }

  /** A dropped in-memory document can never acknowledge anything. */
  private answerIfDead(state: ConnState, runtime: DocRuntime, n: number): boolean {
    if (!runtime.dead) return false;
    this.send(state, {
      t: 'save-error',
      n,
      code: runtime.log.fatalReason === 'generation_changed' ? 'generation_changed' : 'server_busy',
      retrying: false,
    });
    return true;
  }

  /** Answers `saved n` once everything queued up to now is committed. */
  private registerMarker(state: ConnState, runtime: DocRuntime, n: number): void {
    const { log } = runtime;
    // No await between reading the tail and registering the marker: every
    // update this connection sent before the marker is already queued.
    const position = log.tail;
    if (position <= log.committed) {
      this.send(state, { t: 'saved', n });
      return;
    }
    state.marks.push({ n, position });
    if (state.marks.length > MAX_PENDING_MARKS) state.marks.shift();
    if (log.failing) {
      state.saveErrorSent = true;
      this.send(state, { t: 'save-error', n, code: 'storage_unavailable', retrying: true });
    }
  }

  /** The server does not hold what the client believes it sent. Never answers `saved`. */
  private answerNotHeld(state: ConnState, runtime: DocRuntime, n: number): void {
    if (!runtime.log.acceptingEdits) {
      this.send(state, { t: 'save-error', n, code: 'server_busy', retrying: false });
    } else if (state.roleReadOnly) {
      this.send(state, { t: 'access', change: 'role_changed', role: state.role });
    } else {
      this.send(state, { t: 'resync', n });
    }
  }

  private onStoreDocument(document: Document, documentName: string): void {
    const runtime = this.runtimes.get(documentName);
    if (!runtime || runtime.dead || runtime.document !== document) return;
    const { log } = runtime;
    const unused = document.getConnectionsCount() === 0;
    const worthwhile = unused
      ? log.rowsSinceCompaction > 0 || log.hasUncommitted()
      : log.rowsSinceCompaction >= this.config.collab.compactAfterUpdates;
    if (!worthwhile) return;
    this.requestCompaction(runtime);
  }

  /**
   * Non-blocking: the writer compacts once its queue is empty. Unloading is
   * held back by `beforeUnloadDocument` until that has happened.
   */
  private requestCompaction(runtime: DocRuntime): void {
    const { document } = runtime;
    runtime.log.requestCompaction(() => {
      const state = Y.encodeStateAsUpdate(document);
      if (state.byteLength > this.config.limits.maxDocumentStateBytes) {
        this.logger.warn(
          { documentId: runtime.documentId, bytes: state.byteLength },
          'document state exceeds the configured soft limit',
        );
      }
      return state;
    });
  }

  // ── Durable log events ────────────────────────────────────────────────────

  private connsOf(runtime: DocRuntime): ConnState[] {
    return [...(this.registry.get(runtime.documentId) ?? [])].filter(
      (state) => state.documentName === runtime.documentName,
    );
  }

  private onCommitted(runtime: DocRuntime, position: number): void {
    for (const state of this.connsOf(runtime)) {
      state.saveErrorSent = false;
      let acknowledged: PendingMark | undefined;
      while (state.marks.length > 0 && (state.marks[0] as PendingMark).position <= position) {
        acknowledged = state.marks.shift();
      }
      if (acknowledged) this.send(state, { t: 'saved', n: acknowledged.n });
    }
  }

  private onSaveError(runtime: DocRuntime): void {
    for (const state of this.connsOf(runtime)) {
      const latest = state.marks[state.marks.length - 1];
      if (!latest || state.saveErrorSent) continue;
      state.saveErrorSent = true;
      this.send(state, {
        t: 'save-error',
        n: latest.n,
        code: 'storage_unavailable',
        retrying: true,
      });
    }
  }

  private onFatal(runtime: DocRuntime, reason: FatalReason): void {
    runtime.dead = true;
    this.logger.warn({ documentId: runtime.documentId, reason }, 'in-memory document dropped');
    const close =
      reason === 'generation_changed' ? COLLAB_CLOSE.generationChanged : CLOSE_DOCUMENT_RESET;
    for (const state of this.connsOf(runtime)) {
      const latest = state.marks[state.marks.length - 1];
      if (latest) {
        this.send(state, {
          t: 'save-error',
          n: latest.n,
          code: reason === 'generation_changed' ? 'generation_changed' : 'server_busy',
          retrying: false,
        });
      }
      state.marks = [];
      this.closeConn(state, close);
    }
    this.unloadIfUnused(runtime);
  }

  /**
   * Hocuspocus refuses update frames from read-only connections. If one is
   * applied anyway, it is never persisted: the document is dropped and
   * reloaded from storage, and the event is recorded.
   */
  private onReadOnlyViolation(runtime: DocRuntime, connection: Connection<CollabContext>): void {
    const state = connection.context.auth;
    this.logger.error(
      { documentId: runtime.documentId, connection: state?.id },
      'update from a read-only connection reached the document; dropping it',
    );
    void tryAudit(this.db, this.logger, {
      workspaceId: this.workspaceId,
      actor: state
        ? { kind: state.participant.kind, userId: state.userId, name: state.participant.name }
        : SYSTEM_ACTOR,
      action: 'security.read_only_update_blocked',
      targetType: 'document',
      targetId: runtime.documentId,
      details: { generation: runtime.generation },
    });
    runtime.log.fail('read_only_origin');
  }

  private unloadIfUnused(runtime: DocRuntime): void {
    if (this.runtimes.get(runtime.documentName) !== runtime) return;
    if (runtime.document.getConnectionsCount() > 0) return;
    // Deferred: connection close callbacks may still be running in this turn.
    setImmediate(() => {
      if (this.runtimes.get(runtime.documentName) !== runtime) return;
      if (runtime.document.getConnectionsCount() > 0) return;
      void this.hocuspocus.unloadDocument(runtime.document);
    });
  }

  // ── Sending and closing ───────────────────────────────────────────────────

  private send(state: ConnState, message: ServerStateless): void {
    if (state.socket.closing || !state.connection) return;
    try {
      state.connection.sendStateless(JSON.stringify(message));
    } catch (err) {
      this.logger.debug({ err }, 'could not send a collaboration side-channel message');
    }
  }

  private broadcast(runtime: DocRuntime, message: ServerStateless): void {
    for (const state of this.connsOf(runtime)) this.send(state, message);
  }

  private forget(state: ConnState): void {
    state.closing = true;
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    state.expiryTimer = null;
    state.marks = [];
    state.hello.dispose();
    state.socket.conns.delete(state);
    const set = this.registry.get(state.documentId);
    if (set) {
      set.delete(state);
      if (set.size === 0) this.registry.delete(state.documentId);
    }
  }

  private closeConn(state: ConnState, close: CloseSpec): void {
    this.forget(state);
    this.closeSocket(state.socket, close);
  }

  private closeSocket(socket: SocketState, close: CloseSpec): void {
    if (socket.closing) return;
    socket.closing = true;
    for (const conn of [...socket.conns]) this.forget(conn);
    try {
      // Detach from the document right away so nothing further is applied or relayed.
      socket.client.handleClose(close);
    } catch (err) {
      this.logger.warn({ err }, 'error while detaching a collaboration connection');
    }
    try {
      socket.ws.close(close.code, close.reason);
    } catch {
      socket.ws.terminate();
    }
    const timer = setTimeout(() => socket.ws.terminate(), 3_000);
    timer.unref();
  }

  // ── Live access enforcement ───────────────────────────────────────────────

  private scheduleExpiry(state: ConnState): void {
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    state.expiryTimer = null;
    if (state.expiresAt === null || state.closing) return;
    // setTimeout cannot wait longer than ~24.8 days; the periodic sweep covers the rest.
    const delay = Math.min(Math.max(0, state.expiresAt - Date.now()) + 50, 2 ** 31 - 1);
    state.expiryTimer = setTimeout(() => void this.reevaluate([state]), delay);
    state.expiryTimer.unref();
  }

  private async reevaluateOne(state: ConnState): Promise<void> {
    if (state.closing) return;
    let access;
    try {
      const sessions = await findSessionsByIds(this.db, this.workspaceId, state.sessionIds);
      access = await resolveAccess(this.accessDeps, sessions, state.documentId, {
        previouslyGranting: state.grantingSessionIds,
      });
    } catch (err) {
      // Storage cannot be asked. A permission that ended by time is known locally; fail closed.
      if (state.expiresAt !== null && state.expiresAt <= Date.now()) {
        this.send(state, { t: 'access', change: 'expired' });
        this.closeConn(state, COLLAB_CLOSE.accessExpired);
      } else {
        this.logger.warn({ err, documentId: state.documentId }, 'access re-evaluation failed');
      }
      return;
    }
    if (state.closing) return;

    if (!access.ok) {
      this.send(state, { t: 'access', change: access.change });
      this.closeConn(state, closeForChange(access.change));
      return;
    }
    if (access.document.generation !== state.generation) {
      this.send(state, {
        t: 'generation',
        generation: access.document.generation,
        reason: 'snapshot_restored',
      });
      this.closeConn(state, COLLAB_CLOSE.generationChanged);
      return;
    }

    state.grantingSessionIds = new Set(access.grantingSessionIds);
    state.grantId = access.grantId;
    state.userId = access.accountId;
    const expiresAt = access.expiresAt ? access.expiresAt.getTime() : null;
    if (expiresAt !== state.expiresAt) {
      state.expiresAt = expiresAt;
      this.scheduleExpiry(state);
    }
    if (access.role !== state.role) {
      state.role = access.role;
      state.roleReadOnly = !canEdit(access.role);
      state.participant = { ...state.participant, role: access.role };
      if (state.connection) {
        state.connection.readOnly = this.effectiveReadOnly(
          state,
          this.runtimes.get(state.documentName),
        );
      }
      this.send(state, { t: 'access', change: 'role_changed', role: access.role });
    }
  }

  private async reevaluate(states: readonly ConnState[]): Promise<void> {
    await mapLimit(states, 8, (state) => this.reevaluateOne(state));
  }

  private select(predicate: (state: ConnState) => boolean): ConnState[] {
    const selected: ConnState[] = [];
    for (const set of this.registry.values()) {
      for (const state of set) if (predicate(state)) selected.push(state);
    }
    return selected;
  }

  /** Re-checks every connection of a document after its permissions or status changed. */
  async reevaluateDocument(documentId: string): Promise<void> {
    this.cluster?.publish({ type: 'reevaluate_document', documentId });
    await this.reevaluateDocumentHere(documentId);
  }

  private async reevaluateDocumentHere(documentId: string): Promise<void> {
    await this.reevaluate([...(this.registry.get(documentId) ?? [])]);
  }

  /** Re-checks connections that were authorized by any of the given sessions. */
  async reevaluateSessions(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    this.cluster?.publish({ type: 'reevaluate_sessions', sessionIds: [...sessionIds] });
    await this.reevaluateSessionsHere(sessionIds);
  }

  private async reevaluateSessionsHere(sessionIds: readonly string[]): Promise<void> {
    const ids = new Set(sessionIds);
    this.tickets.revokeForSessions(ids);
    await this.reevaluate(this.select((state) => state.sessionIds.some((id) => ids.has(id))));
  }

  /** Re-checks every connection of an account (role change, disable). */
  async reevaluateUser(userId: string): Promise<void> {
    this.cluster?.publish({ type: 'reevaluate_user', userId });
    await this.reevaluateUserHere(userId);
  }

  private async reevaluateUserHere(userId: string): Promise<void> {
    await this.reevaluate(this.select((state) => state.userId === userId));
  }

  /** A message from another instance: the same action, applied to this instance's sockets. */
  private onControl(message: ControlMessage): void {
    const failed = (err: unknown): void => {
      this.logger.error({ err, type: message.type }, 'control message could not be applied');
    };
    switch (message.type) {
      case 'reevaluate_document':
        this.reevaluateDocumentHere(message.documentId).catch(failed);
        break;
      case 'reevaluate_sessions':
        this.reevaluateSessionsHere(message.sessionIds).catch(failed);
        break;
      case 'reevaluate_user':
        this.reevaluateUserHere(message.userId).catch(failed);
        break;
      case 'generation':
        this.announceGenerationHere(
          message.documentId,
          message.oldGeneration,
          message.newGeneration,
          message.notice,
        );
        break;
      case 'flush': {
        const runtime = this.runtimes.get(
          collabDocumentName(message.documentId, message.generation),
        );
        // Only the instance that has the document loaded answers.
        if (!runtime || runtime.dead) break;
        runtime.log
          .flush(message.timeoutMs)
          .then((ok) => this.cluster?.reply(message.replyTo, ok))
          .catch(failed);
        break;
      }
    }
  }

  private hasRuntime(documentId: string): boolean {
    for (const runtime of this.runtimes.values()) {
      if (runtime.documentId === documentId && !runtime.dead) return true;
    }
    return false;
  }

  /** Another instance owns the document now: stop serving it here; clients reconnect. */
  private dropDocument(documentId: string): void {
    for (const runtime of [...this.runtimes.values()]) {
      if (runtime.documentId === documentId) runtime.log.fail('sequence_conflict');
    }
  }

  /** Re-checks everything: used by the periodic sweep. */
  private async sweep(): Promise<void> {
    if (this.sweeping || this.shuttingDown) return;
    this.sweeping = true;
    try {
      const now = Date.now();
      const all = this.select(() => true);
      // Handshakes that never completed (load failure, vanished client).
      for (const state of all) {
        if (state.connection === null && now - state.createdAt > 30_000) {
          this.closeConn(state, CLOSE_AUTH_FAILED);
        }
      }
      const live = all.filter((state) => !state.closing && state.connection !== null);
      // A connected client counts as activity for idle session expiry.
      const sessionIds = [...new Set(live.flatMap((state) => [...state.grantingSessionIds]))];
      try {
        await touchSessions(this.db, sessionIds);
      } catch (err) {
        this.logger.debug({ err }, 'could not record session activity');
      }
      await this.reevaluate(live);
      for (const runtime of this.runtimes.values()) {
        if (!runtime.log.busy) this.unloadIfUnused(runtime);
      }
    } finally {
      this.sweeping = false;
    }
  }

  // ── Queries used by the HTTP API ──────────────────────────────────────────

  liveParticipants(documentId: string): Participant[] {
    return [...(this.registry.get(documentId) ?? [])]
      .filter((state) => !state.closing && state.connection !== null)
      .map((state) => state.participant);
  }

  /** Live connections per share grant of one document. */
  liveConnectionsByGrant(documentId: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const state of this.registry.get(documentId) ?? []) {
      if (state.closing || state.connection === null || !state.grantId) continue;
      counts.set(state.grantId, (counts.get(state.grantId) ?? 0) + 1);
    }
    return counts;
  }

  /** The in-memory document of a generation, when it is loaded and healthy. */
  liveDocument(documentId: string, generation: number): Y.Doc | null {
    const runtime = this.runtimes.get(collabDocumentName(documentId, generation));
    return runtime && !runtime.dead ? runtime.document : null;
  }

  /** Waits until the loaded document (if any) has nothing left to commit. */
  async flushDocument(documentId: string, generation: number, timeoutMs = 5_000): Promise<boolean> {
    const runtime = this.runtimes.get(collabDocumentName(documentId, generation));
    if (runtime && !runtime.dead) return runtime.log.flush(timeoutMs);
    // Loaded on another instance, perhaps: ask. Nobody answering means nobody has it.
    if (this.cluster) await this.cluster.requestFlush(documentId, generation, timeoutMs);
    return true;
  }

  /**
   * A new generation was committed (snapshot restore). Tells the old room,
   * closes it and makes sure nothing queued for the old generation is written.
   */
  announceGeneration(
    documentId: string,
    oldGeneration: number,
    newGeneration: number,
    notice: GenerationNotice = {},
  ): void {
    this.cluster?.publish({ type: 'generation', documentId, oldGeneration, newGeneration, notice });
    this.announceGenerationHere(documentId, oldGeneration, newGeneration, notice);
  }

  private announceGenerationHere(
    documentId: string,
    oldGeneration: number,
    newGeneration: number,
    notice: GenerationNotice = {},
  ): void {
    const documentName = collabDocumentName(documentId, oldGeneration);
    const runtime = this.runtimes.get(documentName);
    for (const state of [...(this.registry.get(documentId) ?? [])]) {
      if (state.generation !== oldGeneration) continue;
      this.send(state, {
        t: 'generation',
        generation: newGeneration,
        reason: 'snapshot_restored',
        ...(notice.snapshotName ? { snapshotName: notice.snapshotName } : {}),
        ...(notice.byName ? { byName: notice.byName } : {}),
      });
    }
    if (runtime) {
      // Closes the remaining connections with `generation_changed` and unloads.
      runtime.log.fail('generation_changed');
    } else {
      for (const state of [...(this.registry.get(documentId) ?? [])]) {
        if (state.generation === oldGeneration)
          this.closeConn(state, COLLAB_CLOSE.generationChanged);
      }
    }
  }

  get connectionCount(): number {
    return this.sockets.size;
  }

  /** Sockets this instance only passes on to the owner of their document. */
  get forwardedCount(): number {
    return this.forwards.size;
  }

  /** New sockets are refused from now on (the load balancer should already send none). */
  get draining(): boolean {
    return this.drainingFlag || this.shuttingDown;
  }

  /** Readiness turns to "not ready"; open connections keep working until `shutdown`. */
  beginDrain(): void {
    this.drainingFlag = true;
  }

  get loadedDocumentCount(): number {
    return this.runtimes.size;
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────

  /** Graceful stop: tell clients, flush the logs, close everything. */
  async shutdown(flushTimeoutMs = 5_000): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const state of this.select((s) => !s.closing)) this.send(state, { t: 'shutdown' });
    await Promise.all(
      [...this.runtimes.values()].map((runtime) => runtime.log.flush(flushTimeoutMs)),
    );
    for (const socket of [...this.sockets]) this.closeSocket(socket, COLLAB_CLOSE.serverShutdown);
    for (const pair of [...this.forwards]) {
      safeClose(pair.client, COLLAB_CLOSE.serverShutdown.code, COLLAB_CLOSE.serverShutdown.reason);
      safeClose(pair.upstream, 1000, 'server_shutdown');
    }
    this.forwards.clear();
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(resolve, 1_500);
      const check = setInterval(() => {
        if (this.sockets.size === 0) {
          clearInterval(check);
          clearTimeout(deadline);
          resolve();
        }
      }, 25);
      deadline.unref();
      setTimeout(() => clearInterval(check), 1_600).unref();
    });
    for (const socket of [...this.sockets]) socket.ws.terminate();
    for (const runtime of this.runtimes.values()) runtime.log.close();
    this.wss.close();
  }
}
