/**
 * Fixture collaboration server for editor tests and the demo harness.
 *
 * A real `@hocuspocus/server` 4.8.0 instance behind `ws`, plus the small part
 * of the HTTP API the editor package talks to (meta, collaboration tickets,
 * document lookup, assets). It follows the contract in
 * `@realtimedocs/contracts` (collab.ts) — tickets, `hello` / `mark` /
 * `saved` / `resync` / `save-error`, `access`, `generation`, `persistence`,
 * server-attested presence — with a controllable in-memory "database" so
 * tests can delay or fail commits. It is NOT the production server.
 *
 * Principals are addressed by path prefix: an API client created with
 * `baseUrl = <origin>/p/<token>` sends every request (fetch, XHR uploads,
 * image URLs, the WebSocket) under that prefix, so no cookies or headers are
 * needed across the demo's origins.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { Hocuspocus, type Connection, type Document } from '@hocuspocus/server';
import {
  ATTACHMENT_EXTENSIONS,
  COLLAB_CLOSE,
  COLLAB_PROTOCOL_VERSION,
  ClientStateless,
  DEFAULT_LIMITS,
  DOCUMENT_SCHEMA_VERSION,
  HTTP_STATUS_BY_CODE,
  IMAGE_MIME_TYPES,
  Y_FRAGMENT_FIELD,
  canEdit,
  collabDocumentName,
  createApiClient,
  parseCollabDocumentName,
  type ApiClient,
  type Asset,
  type CollabTicketResponse,
  type EffectiveRole,
  type ErrorCode,
  type Participant,
  type ServerStateless,
  type UploadRejectReason,
} from '@realtimedocs/contracts';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import { fromBase64 } from 'lib0/buffer';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import { EMPTY_DOCUMENT, getDocumentSchema, type DocJSON } from '../src/schema/index';

// ── Fake database ───────────────────────────────────────────────────────────

/** In-memory stand-in for PostgreSQL with switches for the failure paths. */
export class FakeDatabase {
  /** Committed update log per room (`<documentId>.g<generation>`). */
  readonly log = new Map<string, Uint8Array[]>();
  /** Artificial latency of each commit. */
  delayMs = 0;
  /** While true every commit rejects (database unavailable). */
  failing = false;
  commits = 0;
  failures = 0;
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;

  /** Holds every commit until `release()` is called. */
  hold(): void {
    if (this.gate) return;
    this.gate = new Promise<void>((resolve) => {
      this.openGate = resolve;
    });
  }

  release(): void {
    this.openGate?.();
    this.gate = null;
    this.openGate = null;
  }

  async commit(room: string, update: Uint8Array): Promise<void> {
    if (this.gate) await this.gate;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failing) {
      this.failures += 1;
      throw new Error('fixture database unavailable');
    }
    const rows = this.log.get(room) ?? [];
    rows.push(update);
    this.log.set(room, rows);
    this.commits += 1;
  }

  /** The durable state of a room, rebuilt from the committed log only. */
  durableDoc(room: string): Y.Doc {
    const doc = new Y.Doc();
    for (const update of this.log.get(room) ?? []) Y.applyUpdate(doc, update);
    return doc;
  }
}

// ── Durable log (ordered, single-flight writer) ─────────────────────────────

interface Marker {
  position: number;
  n: number;
  connection: Connection;
  errorSent: boolean;
}

class DurableLog {
  /** Number of updates enqueued so far (queue position of the newest one). */
  enqueued = 0;
  /** Number of updates committed so far. */
  committed = 0;
  private queue: Uint8Array[] = [];
  private markers: Marker[] = [];
  private writing = false;
  private retryDelay = 20;

  constructor(
    private readonly room: string,
    private readonly db: FakeDatabase,
  ) {}

  get idle(): boolean {
    return this.committed === this.enqueued && !this.writing;
  }

  enqueue(update: Uint8Array): void {
    this.queue.push(update);
    this.enqueued += 1;
    void this.run();
  }

  /** Answers `saved n` once everything enqueued up to now is committed. */
  acknowledge(connection: Connection, n: number): void {
    const marker: Marker = { position: this.enqueued, n, connection, errorSent: false };
    if (this.committed >= marker.position) {
      send(connection, { t: 'saved', n });
      return;
    }
    this.markers.push(marker);
  }

  dropConnection(connection: Connection): void {
    this.markers = this.markers.filter((marker) => marker.connection !== connection);
  }

  private flushMarkers(): void {
    const ready = this.markers.filter((marker) => marker.position <= this.committed);
    this.markers = this.markers.filter((marker) => marker.position > this.committed);
    for (const marker of ready) send(marker.connection, { t: 'saved', n: marker.n });
  }

  private async run(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue;
        this.queue = [];
        const merged = batch.length === 1 ? (batch[0] as Uint8Array) : Y.mergeUpdates(batch);
        try {
          await this.db.commit(this.room, merged);
          this.committed += batch.length;
          this.retryDelay = 20;
          this.flushMarkers();
        } catch {
          // Keep the batch at the head of the queue, report, retry with backoff.
          this.queue = [...batch, ...this.queue];
          for (const marker of this.markers) {
            if (marker.errorSent) continue;
            marker.errorSent = true;
            send(marker.connection, {
              t: 'save-error',
              n: marker.n,
              code: 'storage_unavailable',
              retrying: true,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
          this.retryDelay = Math.min(400, this.retryDelay * 2);
          for (const marker of this.markers) marker.errorSent = false;
        }
      }
    } finally {
      this.writing = false;
    }
  }
}

/**
 * Rejection of `onAuthenticate`. Hocuspocus forwards `reason` to the client
 * and only logs errors that carry a message, so the message stays empty.
 */
class AuthFailure extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super('');
    this.reason = reason;
  }
}

function send(connection: Connection, message: ServerStateless): void {
  connection.sendStateless(JSON.stringify(message));
}

/** True if `doc` holds every struct and every deletion recorded in `snapshot`. */
export function documentContainsSnapshot(doc: Y.Doc, snapshot: Y.Snapshot): boolean {
  const own = Y.snapshot(doc);
  for (const [client, clock] of snapshot.sv) {
    if ((own.sv.get(client) ?? 0) < clock) return false;
  }
  for (const [client, ranges] of snapshot.ds.clients) {
    const have = own.ds.clients.get(client) ?? [];
    for (const range of ranges) {
      let cursor = range.clock;
      const end = range.clock + range.len;
      for (const item of have) {
        if (item.clock + item.len <= cursor) continue;
        if (item.clock > cursor) break;
        cursor = item.clock + item.len;
        if (cursor >= end) break;
      }
      if (cursor < end) return false;
    }
  }
  return true;
}

// ── Fixture model ───────────────────────────────────────────────────────────

export interface Principal {
  token: string;
  /** Null for share-link guests. */
  accountId: string | null;
  name: string;
  kind: 'user' | 'guest';
  color: string;
  /** Role per document id. */
  roles: Map<string, EffectiveRole>;
  revoked: boolean;
  expired: boolean;
}

interface DocumentRecord {
  id: string;
  title: string;
  generation: number;
  schemaVersion: number;
  trashed: boolean;
}

interface Ticket {
  principal: Principal;
  documentId: string;
  generation: number;
  clientId: number;
  participant: Participant;
  expiresAt: number;
  used: boolean;
}

interface ConnectionContext {
  principal: Principal;
  documentId: string;
  generation: number;
  clientId: number;
  participant: Participant;
}

interface LiveConnection {
  connection: Connection;
  context: ConnectionContext;
  /** `readOnly` before a temporary persistence lock. */
  lockedFrom: boolean | null;
}

interface StoredAsset {
  asset: Asset;
  bytes: Buffer;
}

export interface FixtureOptions {
  port?: number;
  /** Extra origins allowed by CORS (the demo page). */
  corsOrigins?: string[];
  /**
   * Extra routes handled before the API (the demo harness uses this for its
   * control endpoint). Return true when the request was answered.
   */
  extraRoute?: (
    request: IncomingMessage,
    response: ServerResponse,
    readJson: () => Promise<unknown>,
  ) => boolean | Promise<boolean>;
}

const COLORS = ['#2f80ed', '#eb5757', '#27ae60', '#9b51e0', '#f2994a', '#00a3a3'];

export class FixtureServer {
  readonly db = new FakeDatabase();
  readonly principals = new Map<string, Principal>();
  readonly documents = new Map<string, DocumentRecord>();
  readonly assets = new Map<string, StoredAsset>();
  /** Updates that reached the write path from a read-only connection (must stay 0). */
  readOnlyViolations = 0;
  /** Ticket requests received (granted or not), for "no reconnect" assertions. */
  ticketRequests = 0;
  /** Per-filename upload latency in ms (default `uploadDelayMs`). */
  readonly uploadDelays = new Map<string, number>();
  uploadDelayMs = 0;
  /** When set, the next upload is rejected with this reason. */
  rejectNextUpload: UploadRejectReason | null = null;
  /** Fail the next N uploads with HTTP 503. */
  failUploads = 0;
  /** While true ticket requests answer 503 `server_busy`. */
  busy = false;

  private readonly http: Server;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  private readonly hocuspocus: Hocuspocus;
  private readonly tickets = new Map<string, Ticket>();
  private readonly logs = new Map<string, DurableLog>();
  private readonly live = new Set<LiveConnection>();
  private readonly sockets = new Set<WebSocket>();
  private readonly rawSockets = new Set<Duplex>();
  private readonly corsOrigins: Set<string>;
  private readonly extraRoute: FixtureOptions['extraRoute'];
  /** Connections that had an update refused; their markers prove nothing. */
  private readonly tainted = new WeakSet<Connection>();
  /** Documents whose write queue is "full": new connections are locked too. */
  private readonly locked = new Set<string>();
  private offline = false;
  private colorIndex = 0;

  constructor(options: FixtureOptions = {}) {
    this.corsOrigins = new Set(options.corsOrigins ?? []);
    this.extraRoute = options.extraRoute;
    this.hocuspocus = new Hocuspocus({
      quiet: true,
      // Persistence is the durable log below, not Hocuspocus' debounced store.
      debounce: 0,
      onAuthenticate: async (data) => this.authenticate(data.token, data.documentName, data),
      connected: async ({ connection }) => {
        const entry: LiveConnection = {
          connection,
          context: connection.context as ConnectionContext,
          lockedFrom: null,
        };
        this.live.add(entry);
        if (this.locked.has(entry.context.documentId)) {
          entry.lockedFrom = connection.readOnly;
          connection.readOnly = true;
          send(connection, { t: 'persistence', state: 'degraded', acceptingEdits: false });
        }
      },
      beforeSync: async ({ connection, document, type, payload }) => {
        // Hocuspocus refuses document data from read-only connections (it
        // answers SyncStatus "not applied"). Remember it: a later marker of
        // this connection must not be acknowledged as saved.
        if (!connection.readOnly) return;
        const refused =
          type === 2 || (type === 1 && !Y.snapshotContainsUpdate(Y.snapshot(document), payload));
        if (refused) this.tainted.add(connection);
      },
      onDisconnect: async ({ document, context }) => {
        for (const entry of [...this.live]) {
          if (entry.context !== context) continue;
          this.logs.get(document.name)?.dropConnection(entry.connection);
          this.live.delete(entry);
        }
      },
      onLoadDocument: async ({ document, documentName }) => {
        for (const update of this.db.log.get(documentName) ?? []) Y.applyUpdate(document, update);
        return document;
      },
      afterLoadDocument: async ({ document, documentName }) => {
        const log = new DurableLog(documentName, this.db);
        this.logs.set(documentName, log);
        // Enqueue synchronously in the Yjs update event: by the time a later
        // frame of the same connection is handled, its updates are queued.
        document.on('update', (update: Uint8Array, origin: unknown) => {
          const source = origin as { source?: string; connection?: Connection } | null;
          if (source?.source === 'connection' && source.connection?.readOnly) {
            this.readOnlyViolations += 1;
            return;
          }
          log.enqueue(update);
        });
      },
      beforeUnloadDocument: async ({ documentName }) => {
        // Documents with uncommitted updates are never unloaded.
        const log = this.logs.get(documentName);
        if (log && !log.idle) throw new Error('uncommitted updates');
      },
      afterUnloadDocument: async ({ documentName }) => {
        this.logs.delete(documentName);
      },
      onStateless: async ({ connection, document, payload }) => {
        this.handleStateless(connection, document, payload);
      },
      beforeHandleAwareness: async ({ states, removedClients, connection, context }) => {
        const ctx = context as ConnectionContext | undefined;
        if (!connection || !ctx) return;
        for (const clientId of [...states.keys()]) {
          if (clientId !== ctx.clientId) states.delete(clientId);
        }
        for (const clientId of [...removedClients]) {
          if (clientId !== ctx.clientId) removedClients.delete(clientId);
        }
        const state = states.get(ctx.clientId);
        if (state) {
          // Identity and role are attested by the server, never by the client.
          state.user = { ...ctx.participant };
          if (connection.readOnly) delete state.cursor;
        }
      },
    });

    this.http = createServer((request, response) => {
      void this.handleHttp(request, response).catch(() => {
        if (!response.headersSent) this.error(response, 'internal', 'Fixture failure.');
      });
    });
    this.http.on('connection', (socket) => {
      this.rawSockets.add(socket);
      socket.on('close', () => this.rawSockets.delete(socket));
    });
    this.http.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async listen(port = 0): Promise<this> {
    await new Promise<void>((resolve) => this.http.listen(port, '127.0.0.1', resolve));
    return this;
  }

  get port(): number {
    return (this.http.address() as AddressInfo).port;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Base URL that addresses the API as one principal. */
  baseUrl(token: string): string {
    return `${this.origin}/p/${token}`;
  }

  /** Typed API client acting as `principal` (Node tests). */
  client(principal: Principal): ApiClient {
    return createApiClient({ baseUrl: this.baseUrl(principal.token), credentials: 'omit' });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    for (const socket of this.rawSockets) socket.destroy();
    this.wss.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  // ── Test controls ─────────────────────────────────────────────────────────

  addPrincipal(options: {
    name: string;
    accountId?: string | null;
    kind?: 'user' | 'guest';
  }): Principal {
    const principal: Principal = {
      token: randomUUID(),
      accountId: options.accountId === undefined ? randomUUID() : options.accountId,
      name: options.name,
      kind: options.kind ?? (options.accountId === null ? 'guest' : 'user'),
      color: COLORS[this.colorIndex++ % COLORS.length] ?? '#2f80ed',
      roles: new Map(),
      revoked: false,
      expired: false,
    };
    this.principals.set(principal.token, principal);
    return principal;
  }

  /** Creates a document; its Yjs state is initialised exactly once, here. */
  createDocument(options: { title?: string; content?: DocJSON; id?: string } = {}): string {
    const id = options.id ?? randomUUID();
    this.documents.set(id, {
      id,
      title: options.title ?? 'Fixture document',
      generation: 1,
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      trashed: false,
    });
    this.seed(id, 1, options.content ?? EMPTY_DOCUMENT);
    return id;
  }

  private seed(documentId: string, generation: number, content: DocJSON): void {
    const ydoc = prosemirrorJSONToYDoc(getDocumentSchema(), content, Y_FRAGMENT_FIELD);
    this.db.log.set(collabDocumentName(documentId, generation), [Y.encodeStateAsUpdate(ydoc)]);
  }

  grant(principal: Principal, documentId: string, role: EffectiveRole): void {
    principal.roles.set(documentId, role);
  }

  /** Changes a role and applies it to live connections in place. */
  setRole(principal: Principal, documentId: string, role: EffectiveRole): void {
    principal.roles.set(documentId, role);
    for (const entry of this.connectionsOf(principal, documentId)) {
      entry.connection.readOnly = !canEdit(role);
      entry.context.participant = { ...entry.context.participant, role };
      send(entry.connection, { t: 'access', change: 'role_changed', role });
    }
  }

  /** Revokes all access of a principal and disconnects its live connections. */
  revoke(principal: Principal): void {
    principal.revoked = true;
    this.endAccess(principal, 'revoked', COLLAB_CLOSE.accessRevoked);
  }

  expire(principal: Principal): void {
    principal.expired = true;
    this.endAccess(principal, 'expired', COLLAB_CLOSE.accessExpired);
  }

  trash(documentId: string): void {
    const record = this.documents.get(documentId);
    if (!record) return;
    record.trashed = true;
    for (const entry of [...this.live]) {
      if (entry.context.documentId !== documentId) continue;
      send(entry.connection, { t: 'access', change: 'document_unavailable' });
      this.closeConnection(entry, COLLAB_CLOSE.documentUnavailable);
    }
  }

  /**
   * Snapshot restore: a new generation starts from `content`; connections of
   * the old room are told and closed. Nothing of the old room is carried over.
   */
  restore(documentId: string, content: DocJSON): number {
    const record = this.documents.get(documentId);
    if (!record) throw new Error('unknown document');
    record.generation += 1;
    this.seed(documentId, record.generation, content);
    for (const entry of [...this.live]) {
      if (entry.context.documentId !== documentId) continue;
      send(entry.connection, {
        t: 'generation',
        generation: record.generation,
        reason: 'snapshot_restored',
      });
      this.closeConnection(entry, COLLAB_CLOSE.generationChanged);
    }
    return record.generation;
  }

  /** Document-wide persistence health (bounded queue full / recovered). */
  setPersistence(documentId: string, state: 'ok' | 'degraded', acceptingEdits: boolean): void {
    if (acceptingEdits) this.locked.delete(documentId);
    else this.locked.add(documentId);
    for (const entry of this.live) {
      if (entry.context.documentId !== documentId) continue;
      if (!acceptingEdits && entry.lockedFrom === null) {
        entry.lockedFrom = entry.connection.readOnly;
        entry.connection.readOnly = true;
      } else if (acceptingEdits && entry.lockedFrom !== null) {
        entry.connection.readOnly = entry.lockedFrom;
        entry.lockedFrom = null;
      }
      send(entry.connection, { t: 'persistence', state, acceptingEdits });
    }
  }

  /** Simulates losing the network: sockets die, HTTP is reset. */
  setOffline(offline: boolean): void {
    this.offline = offline;
    if (!offline) return;
    for (const socket of this.sockets) socket.terminate();
    for (const socket of this.rawSockets) socket.destroy();
  }

  /** Closes live WebSockets abruptly without changing anything else. */
  dropConnections(): void {
    for (const socket of this.sockets) socket.terminate();
  }

  /** Sends a raw side-channel message to every connection of a document. */
  broadcast(documentId: string, message: ServerStateless): void {
    for (const entry of this.live) {
      if (entry.context.documentId === documentId) send(entry.connection, message);
    }
  }

  connectionCount(documentId: string): number {
    return [...this.live].filter((entry) => entry.context.documentId === documentId).length;
  }

  room(documentId: string): string {
    const record = this.documents.get(documentId);
    if (!record) throw new Error('unknown document');
    return collabDocumentName(documentId, record.generation);
  }

  /** In-memory document of the current room, if it is loaded. */
  liveDocument(documentId: string): Document | undefined {
    return this.hocuspocus.documents.get(this.room(documentId));
  }

  /** Awareness states currently relayed for a document. */
  presence(documentId: string): Record<string, unknown>[] {
    const document = this.liveDocument(documentId);
    return document ? [...document.awareness.getStates().values()] : [];
  }

  private connectionsOf(principal: Principal, documentId?: string): LiveConnection[] {
    return [...this.live].filter(
      (entry) =>
        entry.context.principal === principal &&
        (documentId === undefined || entry.context.documentId === documentId),
    );
  }

  private endAccess(
    principal: Principal,
    change: 'revoked' | 'expired',
    close: { code: number; reason: string },
  ): void {
    for (const entry of this.connectionsOf(principal)) {
      send(entry.connection, { t: 'access', change });
      this.closeConnection(entry, close);
    }
  }

  private closeConnection(entry: LiveConnection, close: { code: number; reason: string }): void {
    this.live.delete(entry);
    const socket = entry.connection.webSocket;
    entry.connection.close(close);
    socket.close(close.code, close.reason);
  }

  // ── Collaboration ─────────────────────────────────────────────────────────

  private authenticate(
    token: string,
    documentName: string,
    data: { connectionConfig: { readOnly: boolean } },
  ): ConnectionContext {
    const fail = (reason: string): never => {
      throw new AuthFailure(reason);
    };
    const ticket = this.tickets.get(token);
    if (!ticket || ticket.used) return fail('ticket_invalid');
    ticket.used = true;
    if (ticket.expiresAt < Date.now()) return fail('ticket_expired');
    const record = this.documents.get(ticket.documentId);
    const role = ticket.principal.roles.get(ticket.documentId);
    if (!record || record.trashed) return fail('document_unavailable');
    if (ticket.principal.revoked || ticket.principal.expired || !role) return fail('access_denied');
    const parsed = parseCollabDocumentName(documentName);
    if (
      !parsed ||
      parsed.documentId !== record.id ||
      parsed.generation !== record.generation ||
      ticket.generation !== record.generation
    ) {
      return fail('generation_mismatch');
    }
    data.connectionConfig.readOnly = !canEdit(role);
    return {
      principal: ticket.principal,
      documentId: record.id,
      generation: record.generation,
      clientId: ticket.clientId,
      participant: { ...ticket.participant, role },
    };
  }

  private handleStateless(connection: Connection, document: Document, payload: string): void {
    let message: ClientStateless;
    try {
      const parsed = ClientStateless.safeParse(JSON.parse(payload));
      if (!parsed.success) return;
      message = parsed.data;
    } catch {
      return;
    }
    const log = this.logs.get(document.name);
    if (!log) return;
    if (message.t === 'mark') {
      if (this.tainted.has(connection)) {
        // The server does not hold everything this connection sent.
        send(connection, { t: 'save-error', n: message.n, code: 'server_busy', retrying: false });
        return;
      }
      log.acknowledge(connection, message.n);
      return;
    }
    // A label for the version history; the fixture keeps no history.
    if (message.t === 'hint') return;
    let snapshot: Y.Snapshot;
    try {
      snapshot = Y.decodeSnapshot(fromBase64(message.snapshot));
    } catch {
      return;
    }
    if (documentContainsSnapshot(document, snapshot)) {
      this.tainted.delete(connection);
      log.acknowledge(connection, message.n);
    } else {
      send(connection, { t: 'resync', n: message.n });
    }
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const route = this.route(request.url ?? '');
    if (this.offline || !route || route.path !== '/collab') {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.sockets.add(ws);
      const client = this.hocuspocus.handleConnection(
        ws,
        new Request(`http://127.0.0.1${route.path}`),
      );
      ws.on('message', (data: Buffer) => {
        client.handleMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      });
      ws.on('close', (code, reason) => {
        this.sockets.delete(ws);
        client.handleClose({ code, reason: reason.toString() });
      });
      ws.on('error', () => ws.terminate());
    });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private route(url: string): { principal: Principal | null; path: string; query: string } | null {
    const [pathname = '', query = ''] = url.split('?');
    const match = /^\/p\/([^/]+)(\/.*)$/.exec(pathname);
    if (!match || !match[1] || !match[2]) return null;
    return { principal: this.principals.get(match[1]) ?? null, path: match[2], query };
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(text);
  }

  private error(
    response: ServerResponse,
    code: ErrorCode,
    message: string,
    extra: { reason?: UploadRejectReason } = {},
  ): void {
    this.json(response, HTTP_STATUS_BY_CODE[code], { error: { code, message, ...extra } });
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    if (origin && this.corsOrigins.has(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-headers', 'content-type, accept, x-rd-csrf');
      response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      response.setHeader('vary', 'origin');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (this.extraRoute) {
      const readJson = async (): Promise<unknown> =>
        JSON.parse((await readBody(request)).toString('utf8') || 'null') as unknown;
      if (await this.extraRoute(request, response, readJson)) return;
    }
    if (this.offline) {
      request.socket.destroy();
      return;
    }
    const route = this.route(request.url ?? '');
    if (!route) {
      this.error(response, 'not_found', 'Unknown route.');
      return;
    }
    const { principal, path } = route;

    if (request.method === 'GET' && path === '/api/meta') {
      this.json(response, 200, {
        name: 'RealtimeDocs',
        version: '0.0.0-fixture',
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        minClientSchemaVersion: 1,
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        publicOrigin: this.origin,
        limits: { ...DEFAULT_LIMITS },
        imageMimeTypes: [...IMAGE_MIME_TYPES],
        attachmentExtensions: [...ATTACHMENT_EXTENSIONS],
      });
      return;
    }

    const documentMatch = /^\/api\/documents\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
    if (!documentMatch || !documentMatch[1]) {
      this.error(response, 'not_found', 'Unknown route.');
      return;
    }
    const documentId = documentMatch[1];
    const rest = documentMatch[2] ?? '';
    if (request.method === 'POST' && rest === '/collab-ticket') this.ticketRequests += 1;

    if (!principal) {
      this.error(response, 'unauthenticated', 'Sign in to continue.');
      return;
    }
    if (principal.expired) {
      this.error(
        response,
        principal.kind === 'guest' ? 'share_expired' : 'session_expired',
        'Access has expired.',
      );
      return;
    }
    if (principal.revoked) {
      this.error(
        response,
        principal.kind === 'guest' ? 'share_revoked' : 'forbidden',
        'Access was revoked.',
      );
      return;
    }
    const record = this.documents.get(documentId);
    const role = principal.roles.get(documentId);
    if (!record || !role) {
      this.error(response, 'not_found', 'Document not found.');
      return;
    }
    if (record.trashed) {
      this.error(response, 'document_trashed', 'The document is in the trash.');
      return;
    }

    if (request.method === 'GET' && rest === '') {
      const now = new Date().toISOString();
      this.json(response, 200, {
        document: {
          id: record.id,
          title: record.title,
          status: 'active',
          generation: record.generation,
          schemaVersion: record.schemaVersion,
          createdAt: now,
          updatedAt: now,
          contentUpdatedAt: now,
          archivedAt: null,
          trashedAt: null,
          purgeAfter: null,
          createdByName: null,
          access: {
            role,
            via: principal.kind === 'guest' ? 'share_link' : 'membership',
            expiresAt: null,
            accountId: principal.accountId,
          },
        },
      });
      return;
    }

    if (request.method === 'POST' && rest === '/collab-ticket') {
      if (this.busy) {
        this.error(response, 'server_busy', 'Try again shortly.');
        return;
      }
      const body = JSON.parse((await readBody(request)).toString('utf8') || '{}') as {
        clientId?: number;
        schemaVersion?: number;
      };
      if ((body.schemaVersion ?? 0) < record.schemaVersion) {
        this.error(response, 'update_required', 'This client is too old for the document.');
        return;
      }
      const ticket = randomUUID();
      const participant: Participant = {
        id: randomUUID(),
        name: principal.name,
        color: principal.color,
        role,
        kind: principal.kind,
      };
      this.tickets.set(ticket, {
        principal,
        documentId,
        generation: record.generation,
        clientId: body.clientId ?? 0,
        participant,
        expiresAt: Date.now() + 60_000,
        used: false,
      });
      const payload: CollabTicketResponse = {
        ticket,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        documentName: collabDocumentName(documentId, record.generation),
        generation: record.generation,
        role,
        participant,
        accessExpiresAt: null,
      };
      this.json(response, 200, payload);
      return;
    }

    if (request.method === 'POST' && rest === '/assets') {
      if (!canEdit(role)) {
        this.error(response, 'forbidden', 'Editing access is required to upload.');
        return;
      }
      await this.handleUpload(request, response, documentId);
      return;
    }

    const assetMatch = /^\/assets\/([0-9a-f-]{36})$/.exec(rest);
    if (request.method === 'GET' && assetMatch && assetMatch[1]) {
      const stored = this.assets.get(assetMatch[1]);
      if (!stored || stored.asset.documentId !== documentId) {
        this.error(response, 'not_found', 'Asset not found.');
        return;
      }
      const inline = stored.asset.kind === 'image' && !route.query.includes('download=1');
      response.writeHead(200, {
        'content-type': inline ? stored.asset.mime : 'application/octet-stream',
        'content-length': String(stored.bytes.byteLength),
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-cache',
        ...(inline
          ? {}
          : {
              'content-disposition': `attachment; filename="${stored.asset.name.replace(/"/g, '')}"`,
            }),
      });
      response.end(stored.bytes);
      return;
    }

    this.error(response, 'not_found', 'Unknown route.');
  }

  private async handleUpload(
    request: IncomingMessage,
    response: ServerResponse,
    documentId: string,
  ): Promise<void> {
    const body = await readBody(request);
    const file = parseMultipartFile(request.headers['content-type'] ?? '', body);
    if (!file) {
      this.error(response, 'validation_failed', 'Expected one multipart file part.');
      return;
    }
    const delay = this.uploadDelays.get(file.filename) ?? this.uploadDelayMs;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.failUploads > 0) {
      this.failUploads -= 1;
      this.error(response, 'storage_unavailable', 'Storage is temporarily unavailable.');
      return;
    }
    if (this.rejectNextUpload) {
      const reason = this.rejectNextUpload;
      this.rejectNextUpload = null;
      this.error(response, 'upload_rejected', 'The file was rejected.', { reason });
      return;
    }
    const mime = sniffImage(file.data);
    const dimensions = mime === 'image/png' ? pngSize(file.data) : null;
    const asset: Asset = {
      id: randomUUID(),
      documentId,
      kind: mime ? 'image' : 'attachment',
      name: file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file',
      mime: mime ?? 'application/octet-stream',
      sizeBytes: file.data.byteLength,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      createdAt: new Date().toISOString(),
    };
    this.assets.set(asset.id, { asset, bytes: file.data });
    this.json(response, 201, { asset });
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseMultipartFile(
  contentType: string,
  body: Buffer,
): { filename: string; data: Buffer } | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length + 2;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) return null;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    if (next === -1) return null;
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (/name="file"/i.test(headers) && filename !== undefined) {
      return { filename, data: Buffer.from(body.subarray(headerEnd + 4, next - 2)) };
    }
    start = next;
  }
  return null;
}

function sniffImage(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function pngSize(data: Buffer): { width: number; height: number } | null {
  if (data.byteLength < 24) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

export async function startFixtureServer(options: FixtureOptions = {}): Promise<FixtureServer> {
  return new FixtureServer(options).listen(options.port ?? 0);
}
