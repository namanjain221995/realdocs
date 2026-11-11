/**
 * Integration test harness: the real server bundle as a child process, a real
 * PostgreSQL database per test file, a cookie-jar HTTP client, the real
 * `@hocuspocus/provider` and a raw WebSocket client for hand-crafted frames.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  COLLAB_PROTOCOL_VERSION,
  CSRF_HEADER,
  DOCUMENT_SCHEMA_VERSION,
  Y_FRAGMENT_FIELD,
  type CollabTicketResponse,
  type ServerStateless,
} from '@realtimedocs/contracts';
import { toPlainText } from '@realtimedocs/editor/export';
import type { DocJSON } from '@realtimedocs/editor/schema';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import pg from 'pg';
import WebSocket from 'ws';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { PG } from './pg';

export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stageRoot = path.join(serverRoot, '.stage', 'it');

export const ADMIN_EMAIL = 'admin@example.test';
export const ADMIN_PASSWORD = 'Admin-password-for-tests-1';
const SESSION_SECRET = 'integration-test-session-secret-0123456789';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function until<T>(
  probe: () => T | Promise<T>,
  options: { timeoutMs?: number; intervalMs?: number; what?: string } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  for (;;) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${options.what ?? 'condition'}`);
    await sleep(options.intervalMs ?? 25);
  }
}

// ── Server process ──────────────────────────────────────────────────────────

export interface ServerOptions {
  port?: number;
  env?: Record<string, string>;
  /** Use an existing database instead of creating a fresh one. */
  database?: string;
  /** Share the asset directory of another server (same database). */
  assetDir?: string;
}

export class TestServer {
  readonly port: number;
  readonly origin: string;
  readonly wsUrl: string;
  readonly database: string;
  readonly assetDir: string;
  readonly webDir: string;
  readonly logFile: string;
  readonly env: Record<string, string>;
  private child: ChildProcess | null = null;
  private exited: Promise<number | null> = Promise.resolve(null);
  private pool: pg.Pool | null = null;

  private constructor(
    readonly name: string,
    options: ServerOptions,
  ) {
    this.port = options.port ?? 4410;
    this.origin = `http://127.0.0.1:${this.port}`;
    this.wsUrl = `ws://127.0.0.1:${this.port}/collab`;
    this.database = options.database ?? `rd_${name.replace(/[^a-z0-9]/g, '_')}`;
    const dir = path.join(stageRoot, name);
    this.assetDir = options.assetDir ?? path.join(dir, 'assets');
    this.webDir = path.join(dir, 'web');
    this.logFile = path.join(dir, `server-${this.port}.log`);
    this.env = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'test',
      RD_ENV_FILE: '',
      DATABASE_URL: PG.url(this.database),
      SESSION_SECRET,
      RD_HOST: '127.0.0.1',
      RD_PORT: String(this.port),
      PUBLIC_ORIGIN: this.origin,
      ASSET_DIR: this.assetDir,
      WEB_DIST_DIR: this.webDir,
      LOG_LEVEL: 'info',
      CLEANUP_INTERVAL_MINUTES: '0',
      COLLAB_SWEEP_INTERVAL_SECONDS: '2',
      COLLAB_PING_INTERVAL_SECONDS: '2',
      // Everything comes from 127.0.0.1: keep per-address limits out of the way.
      // Per-email, per-grant and per-socket limits stay at their defaults.
      RATE_API_PER_MINUTE: '1000000',
      RATE_LOGIN_PER_IP: '100000',
      RATE_SHARE_EXCHANGE_PER_IP: '100000',
      RATE_INVITE_PER_IP: '100000',
      RATE_SIGNUP_PER_IP: '100000',
      RATE_DESKTOP_REDEEM_PER_IP: '100000',
      RATE_COLLAB_TICKET_PER_MINUTE: '100000',
      RATE_UPLOAD_PER_MINUTE: '100000',
      RATE_WS_UPGRADE_PER_MINUTE: '100000',
      ...options.env,
    };
  }

  /** Creates a fresh database and asset directory and prepares (not starts) a server. */
  static async create(name: string, options: ServerOptions = {}): Promise<TestServer> {
    const server = new TestServer(name, options);
    if (!options.database) {
      rmSync(path.join(stageRoot, name), { recursive: true, force: true });
      const admin = new pg.Client(PG.admin);
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${server.database}" WITH (FORCE)`);
        await admin.query(`CREATE DATABASE "${server.database}"`);
      } finally {
        await admin.end();
      }
    }
    mkdirSync(path.join(server.webDir, 'assets'), { recursive: true });
    writeFileSync(
      path.join(server.webDir, 'index.html'),
      '<!doctype html><title>RealtimeDocs test shell</title><div id="root"></div>',
    );
    writeFileSync(path.join(server.webDir, 'assets', 'app-abc123.js'), 'console.log("app");');
    // Same shape as the real web build: an external boot script and a favicon next to index.html.
    writeFileSync(path.join(server.webDir, 'boot.js'), 'window.__rdBoot = true;');
    writeFileSync(
      path.join(server.webDir, 'favicon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
    );
    return server;
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  async start(): Promise<void> {
    if (this.running) throw new Error('server already running');
    mkdirSync(path.dirname(this.logFile), { recursive: true });
    appendFileSync(this.logFile, `\n--- start ${new Date().toISOString()} ---\n`);
    const child = spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
      cwd: serverRoot,
      env: this.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => appendFileSync(this.logFile, chunk));
    child.stderr?.on('data', (chunk: Buffer) => appendFileSync(this.logFile, chunk));
    this.exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (!this.running) {
        throw new Error(`server exited during start-up:\n${this.logTail()}`);
      }
      try {
        const response = await fetch(`${this.origin}/api/health`);
        if (response.ok) return;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`server did not start:\n${this.logTail()}`);
      await sleep(50);
    }
  }

  /** Graceful stop (SIGTERM). */
  async stop(): Promise<number | null> {
    if (!this.child || !this.running) return this.exited;
    this.child.kill('SIGTERM');
    return this.exited;
  }

  /** Simulates a crash: the process gets no chance to flush anything. */
  async kill(): Promise<void> {
    if (!this.child || !this.running) return;
    this.child.kill('SIGKILL');
    await this.exited;
  }

  /** Runs a CLI command of the bundle against this server's database. */
  cli(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--enable-source-maps', 'dist/cli.js', ...args], {
        cwd: serverRoot,
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.once('error', reject);
      child.once('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }));
      child.stdin.end(input ?? '');
    });
  }

  /** Direct database access for assertions and test setup. */
  async sql<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<R[]> {
    if (!this.pool) {
      this.pool = new pg.Pool({ connectionString: PG.url(this.database), max: 3 });
      this.pool.on('error', () => undefined);
    }
    const result = await this.pool.query<R>(text, params);
    return result.rows;
  }

  /** Drops the assertion pool (needed before PostgreSQL is stopped). */
  async resetPool(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end().catch(() => undefined);
  }

  log(): string {
    try {
      return readFileSync(this.logFile, 'utf8');
    } catch {
      return '';
    }
  }

  logTail(lines = 40): string {
    return this.log().split('\n').slice(-lines).join('\n');
  }

  async dispose(): Promise<void> {
    await this.stop();
    await this.resetPool();
  }
}

// ── HTTP client with a cookie jar ───────────────────────────────────────────

export interface ApiResult<T = unknown> {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or null when the body is not JSON. */
  body: T;
  text: string;
  bytes: Buffer;
  /** `error.code` of an ApiErrorBody, if this is an error response. */
  code: string | null;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw body (multipart, malformed JSON …); `body` is ignored when set. */
  raw?: { content: Uint8Array | string; contentType: string };
  /** Overrides the Origin header; null sends none. */
  origin?: string | null;
  /** Overrides the CSRF header; null sends none. */
  csrf?: string | null;
  /** Do not send cookies with this request. */
  noCookies?: boolean;
}

interface StoredCookie {
  value: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
}

/** One browser profile (cookie jar + CSRF token) or one desktop client (bearer token). */
export class Agent {
  readonly cookies = new Map<string, StoredCookie>();
  csrfToken: string | null = null;
  bearer: string | null = null;
  userId: string | null = null;

  constructor(
    readonly server: TestServer,
    /** Origin the "browser" is on. Null for non-browser clients. */
    readonly browserOrigin: string | null = server.origin,
  ) {}

  private cookieHeader(pathname: string): string {
    const pairs: string[] = [];
    for (const [name, cookie] of this.cookies) {
      const scope = cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`;
      if (pathname === cookie.path || pathname.startsWith(scope) || cookie.path === '/') {
        pairs.push(`${name}=${cookie.value}`);
      }
    }
    return pairs.join('; ');
  }

  private storeCookies(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const attribute = (key: string) =>
        attributes.find((entry) => entry.toLowerCase().startsWith(`${key}=`))?.split('=')[1];
      const maxAge = attribute('max-age');
      const expires = attribute('expires');
      const expired =
        (maxAge !== undefined && Number(maxAge) <= 0) ||
        (expires !== undefined && new Date(expires).getTime() <= Date.now());
      if (value === '' || expired) {
        this.cookies.delete(name);
        continue;
      }
      this.cookies.set(name, {
        value,
        path: attribute('path') ?? '/',
        httpOnly: attributes.some((entry) => entry.toLowerCase() === 'httponly'),
        secure: attributes.some((entry) => entry.toLowerCase() === 'secure'),
        sameSite: attribute('samesite') ?? null,
      });
    }
  }

  async request<T = unknown>(
    method: string,
    pathname: string,
    options: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const cookie = options.noCookies ? '' : this.cookieHeader(pathname.split('?')[0] ?? pathname);
    if (cookie) headers.cookie = cookie;
    const origin = options.origin === undefined ? this.browserOrigin : options.origin;
    if (unsafe && origin !== null) headers.origin = origin;
    if (unsafe) {
      const csrf = options.csrf === undefined ? (this.csrfToken ?? '1') : options.csrf;
      if (csrf !== null) headers[CSRF_HEADER] = csrf;
    }
    let body: BodyInit | undefined;
    if (options.raw) {
      headers['content-type'] = options.raw.contentType;
      body = options.raw.content as BodyInit;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    Object.assign(headers, options.headers);

    const response = await fetch(`${this.server.origin}${pathname}`, {
      method,
      headers,
      body,
      redirect: 'manual',
    });
    this.storeCookies(response.headers);
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString('utf8');
    let parsed: unknown = null;
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    const code = (parsed as { error?: { code?: string } } | null)?.error?.code ?? null;
    return {
      status: response.status,
      headers: response.headers,
      body: parsed as T,
      text,
      bytes,
      code,
    };
  }

  get<T = unknown>(pathname: string, options?: RequestOptions) {
    return this.request<T>('GET', pathname, options);
  }
  post<T = unknown>(pathname: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', pathname, { ...options, body });
  }
  put<T = unknown>(pathname: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PUT', pathname, { ...options, body });
  }
  patch<T = unknown>(pathname: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PATCH', pathname, { ...options, body });
  }
  delete<T = unknown>(pathname: string, options?: RequestOptions) {
    return this.request<T>('DELETE', pathname, options);
  }

  /** Expects a 2xx response and returns its body. */
  async ok<T = unknown>(pending: Promise<ApiResult<T>>): Promise<T> {
    const result = await pending;
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`expected success, got ${result.status} ${result.text.slice(0, 300)}`);
    }
    return result.body;
  }

  async login(email: string, password: string): Promise<ApiResult<SessionBody>> {
    const result = await this.post<SessionBody>('/api/auth/login', { email, password });
    if (result.status === 200) {
      this.csrfToken = result.body.csrfToken;
      this.userId = result.body.user?.id ?? null;
    }
    return result;
  }

  /** Uploads bytes as multipart/form-data with exactly the given file name. */
  upload(
    documentId: string,
    content: Uint8Array,
    filename: string,
    options: { field?: string; contentType?: string } = {},
  ): Promise<ApiResult<{ asset: AssetBody }>> {
    const boundary = `----rdtest${randomUUID().replace(/-/g, '')}`;
    const escaped = filename
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '%22')
      .replace(/[\r\n]/g, ' ');
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${options.field ?? 'file'}"; filename="${escaped}"\r\nContent-Type: ${options.contentType ?? 'application/octet-stream'}\r\n\r\n`,
      'utf8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    return this.request('POST', `/api/documents/${documentId}/assets`, {
      raw: {
        content: Buffer.concat([head, content, tail]),
        contentType: `multipart/form-data; boundary=${boundary}`,
      },
    });
  }
}

export interface SessionBody {
  user: { id: string; email: string; displayName: string; role: string; status: string } | null;
  csrfToken: string | null;
  expiresAt: string | null;
}

export interface AssetBody {
  id: string;
  documentId: string;
  kind: 'image' | 'attachment';
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface DocumentBody {
  document: {
    id: string;
    title: string;
    status: string;
    generation: number;
    access: { role: string; via: string; expiresAt: string | null; accountId: string | null };
    purgeAfter: string | null;
    trashedAt: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
    contentUpdatedAt: string;
    createdByName: string | null;
  };
}

// ── Fixture ─────────────────────────────────────────────────────────────────

export interface Fixture {
  server: TestServer;
  admin: Agent;
  /** Creates an account through the real invitation flow and returns it signed in. */
  createUser(
    name: string,
    role?: 'admin' | 'member',
  ): Promise<Agent & { email: string; password: string }>;
  createDocument(title?: string): Promise<string>;
  /** Creates a share link and returns its id and the secret from the URL fragment. */
  createShare(
    documentId: string,
    body?: { role?: 'viewer' | 'editor'; label?: string; expiresAt?: string | null },
  ): Promise<{ id: string; secret: string; url: string }>;
  /** A new anonymous browser that exchanged the link (cookie mode). */
  guest(grantId: string, secret: string): Promise<Agent>;
}

export async function createFixture(name: string, options: ServerOptions = {}): Promise<Fixture> {
  const server = await TestServer.create(name, options);
  const bootstrap = await server.cli(
    ['bootstrap-admin', '--email', ADMIN_EMAIL, '--name', 'Ada Admin', '--password-stdin'],
    ADMIN_PASSWORD,
  );
  if (bootstrap.code !== 0) {
    throw new Error(`bootstrap-admin failed: ${bootstrap.stdout}${bootstrap.stderr}`);
  }
  await server.start();
  const admin = new Agent(server);
  const login = await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (login.status !== 200) throw new Error(`admin login failed: ${login.text}`);

  let counter = 0;
  return {
    server,
    admin,
    async createUser(displayName, role = 'member') {
      counter += 1;
      const email = `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${counter}@example.test`;
      const password = `Password-for-${displayName}-${counter}!`;
      const invitation = await admin.ok(
        admin.post<{ invitation: { id: string }; url: string }>('/api/invitations', {
          email,
          role,
        }),
      );
      const secret = new URL(invitation.url).hash.slice(1);
      const agent = new Agent(server);
      const accepted = await agent.post<SessionBody>('/api/invitations/accept', {
        invitationId: invitation.invitation.id,
        secret,
        displayName,
        password,
      });
      if (accepted.status !== 201) throw new Error(`invitation accept failed: ${accepted.text}`);
      agent.csrfToken = accepted.body.csrfToken;
      agent.userId = accepted.body.user?.id ?? null;
      return Object.assign(agent, { email, password });
    },
    async createDocument(title = 'Test document') {
      const created = await admin.ok(admin.post<DocumentBody>('/api/documents', { title }));
      return created.document.id;
    },
    async createShare(documentId, body = {}) {
      const created = await admin.ok(
        admin.post<{ share: { id: string }; url: string }>(
          `/api/documents/${documentId}/shares`,
          body,
        ),
      );
      return { id: created.share.id, secret: new URL(created.url).hash.slice(1), url: created.url };
    },
    async guest(grantId, secret) {
      const agent = new Agent(server);
      const exchanged = await agent.post('/api/share/exchange', { grantId, secret });
      if (exchanged.status !== 200) throw new Error(`share exchange failed: ${exchanged.text}`);
      return agent;
    },
  };
}

// ── Collaboration: real provider ────────────────────────────────────────────

export interface CloseInfo {
  code: number;
  reason: string;
}

export interface CollabOptions {
  /** Reuse an existing document (reconnect with offline changes). */
  doc?: Y.Doc;
  awareness?: boolean;
  /** Connect to this room instead of the one named by the ticket. */
  documentName?: string;
  /** Use this ticket instead of requesting one. */
  ticket?: CollabTicketResponse;
  /** Origin header of the WebSocket handshake. */
  origin?: string;
  ticketBody?: Record<string, unknown>;
  wsUrl?: string;
}

export class CollabClient {
  readonly stateless: ServerStateless[] = [];
  readonly authFailures: string[] = [];
  readonly closes: CloseInfo[] = [];
  /** Local transactions so far (the `n` of the acknowledgement protocol). */
  n = 0;
  authenticatedScope: string | null = null;
  isSynced = false;
  private readonly socket: HocuspocusProviderWebsocket;
  readonly provider: HocuspocusProvider;
  readonly awareness: Awareness | null;

  constructor(
    readonly doc: Y.Doc,
    readonly ticket: CollabTicketResponse,
    wsUrl: string,
    options: CollabOptions,
    origin: string,
  ) {
    const closes = this.closes;
    class OriginSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, { origin });
        this.on('close', (code, reason) => closes.push({ code, reason: reason.toString('utf8') }));
      }
    }
    this.socket = new HocuspocusProviderWebsocket({
      url: wsUrl,
      WebSocketPolyfill: OriginSocket,
      // The tests decide when to reconnect; never retry behind their back.
      maxAttempts: 1,
      delay: 3_600_000,
      messageReconnectTimeout: 30_000,
    });
    this.awareness = options.awareness ? new Awareness(doc) : null;
    this.provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: options.documentName ?? ticket.documentName,
      document: doc,
      awareness: this.awareness,
      token: ticket.ticket,
    });
    this.provider.on('authenticated', ({ scope }: { scope: string }) => {
      this.authenticatedScope = scope;
    });
    this.provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
      this.authFailures.push(reason);
    });
    this.provider.on('synced', () => {
      this.isSynced = true;
    });
    this.provider.on('stateless', ({ payload }: { payload: string }) => {
      this.stateless.push(JSON.parse(payload) as ServerStateless);
    });
    this.provider.attach();
  }

  get fragment(): Y.XmlFragment {
    return this.doc.getXmlFragment(Y_FRAGMENT_FIELD);
  }

  json(): DocJSON {
    return yDocToProsemirrorJSON(this.doc, Y_FRAGMENT_FIELD) as DocJSON;
  }

  text(): string {
    return toPlainText(this.json());
  }

  /** One local transaction, exactly like an editor keystroke or command. */
  edit(change: () => void): void {
    this.doc.transact(change);
    this.n += 1;
  }

  appendParagraph(text: string): void {
    this.edit(() => {
      const paragraph = new Y.XmlElement('paragraph');
      const content = new Y.XmlText();
      content.insert(0, text);
      paragraph.insert(0, [content]);
      this.fragment.push([paragraph]);
    });
  }

  /** Deletion-only edit: removes the top-level block at `index`. */
  deleteBlock(index: number): void {
    this.edit(() => this.fragment.delete(index, 1));
  }

  synced(timeoutMs = 10_000): Promise<void> {
    return until(() => this.isSynced, { timeoutMs, what: 'collaboration sync' }).then(
      () => undefined,
    );
  }

  /** First server message matching `pick`, among those received from index `from` on. */
  waitFor<T>(
    pick: (message: ServerStateless) => T | undefined | false | null,
    options: { timeoutMs?: number; from?: number; what?: string } = {},
  ): Promise<T> {
    const from = options.from ?? 0;
    return until(
      () => {
        for (const message of this.stateless.slice(from)) {
          const picked = pick(message);
          if (picked) return picked;
        }
        return null;
      },
      { timeoutMs: options.timeoutMs ?? 10_000, what: options.what ?? 'server message' },
    ) as Promise<T>;
  }

  send(message: Record<string, unknown>): void {
    this.provider.sendStateless(JSON.stringify(message));
  }

  mark(n: number = this.n): void {
    this.send({ t: 'mark', n });
  }

  hello(n: number = this.n, source: Y.Doc = this.doc): void {
    this.send({
      t: 'hello',
      n,
      snapshot: Buffer.from(Y.encodeSnapshot(Y.snapshot(source))).toString('base64'),
    });
  }

  /** Resolves when the server acknowledged everything up to `n` as durable. */
  async saved(n: number = this.n, timeoutMs = 10_000): Promise<void> {
    await this.waitFor((message) => message.t === 'saved' && message.n >= n, {
      timeoutMs,
      what: `saved ${n}`,
    });
  }

  /** `mark` + wait for `saved`: what the editor does after local changes. */
  async save(timeoutMs = 10_000): Promise<void> {
    this.mark();
    await this.saved(this.n, timeoutMs);
  }

  closed(timeoutMs = 10_000): Promise<CloseInfo> {
    return until(() => this.closes[0], { timeoutMs, what: 'socket close' });
  }

  get socketOpen(): boolean {
    return this.socket.webSocket?.readyState === WebSocket.OPEN;
  }

  /** Drops the connection but keeps the document (going offline). */
  disconnect(): void {
    this.provider.destroy();
    this.socket.destroy();
  }

  destroy(): void {
    this.disconnect();
  }
}

export async function requestTicket(
  agent: Agent,
  documentId: string,
  clientId: number,
  extra: Record<string, unknown> = {},
) {
  return agent.post<CollabTicketResponse>(`/api/documents/${documentId}/collab-ticket`, {
    clientId,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    protocolVersion: COLLAB_PROTOCOL_VERSION,
    ...extra,
  });
}

/** Requests a ticket and opens a provider connection. Does not wait for sync. */
export async function openCollab(
  agent: Agent,
  documentId: string,
  options: CollabOptions = {},
): Promise<CollabClient> {
  const doc = options.doc ?? new Y.Doc();
  let ticket = options.ticket;
  if (!ticket) {
    const response = await requestTicket(agent, documentId, doc.clientID, options.ticketBody);
    if (response.status !== 200) {
      throw new Error(`ticket request failed: ${response.status} ${response.text}`);
    }
    ticket = response.body;
  }
  return new CollabClient(
    doc,
    ticket,
    options.wsUrl ?? agent.server.wsUrl,
    options,
    options.origin ?? agent.browserOrigin ?? agent.server.origin,
  );
}

/** Opens a connection and waits until the first sync completed. */
export async function connectCollab(
  agent: Agent,
  documentId: string,
  options: CollabOptions = {},
): Promise<CollabClient> {
  const client = await openCollab(agent, documentId, options);
  await client.synced();
  return client;
}

// ── Collaboration: raw frames ───────────────────────────────────────────────

export type RawMessage =
  | { kind: 'ping' }
  | { kind: 'auth'; status: 'authenticated' | 'denied'; detail: string }
  | { kind: 'sync'; step: number; payload: Uint8Array }
  | { kind: 'awareness'; update: Uint8Array }
  | { kind: 'stateless'; message: ServerStateless }
  | { kind: 'close'; reason: string }
  | { kind: 'syncStatus'; applied: boolean }
  | { kind: 'unknown'; type: number };

const MSG = { sync: 0, awareness: 1, auth: 2, syncReply: 4, stateless: 5, close: 7, syncStatus: 8 };

/** A hand-rolled Hocuspocus client: sends exactly the frames a test asks for. */
export class RawCollab {
  readonly messages: RawMessage[] = [];
  closeInfo: CloseInfo | null = null;
  private opened = false;

  private constructor(readonly ws: WebSocket) {
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => {
      this.opened = true;
    });
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) this.messages.push(RawCollab.decode(new Uint8Array(data)));
    });
    ws.on('close', (code, reason) => {
      this.closeInfo = { code, reason: reason.toString('utf8') };
    });
    ws.on('error', () => undefined);
  }

  /** Opens a socket. `origin: null` sends no Origin header at all. */
  static async open(
    server: TestServer,
    options: { origin?: string | null; path?: string } = {},
  ): Promise<RawCollab> {
    const origin = options.origin === undefined ? server.origin : options.origin;
    const url = `ws://127.0.0.1:${server.port}${options.path ?? '/collab'}`;
    const raw = new RawCollab(new WebSocket(url, origin === null ? {} : { origin }));
    await until(() => raw.opened || raw.closeInfo !== null, { what: 'raw socket open' });
    return raw;
  }

  /** Opens a socket and authenticates with a fresh ticket for `agent`. */
  static async connect(
    agent: Agent,
    documentId: string,
    clientId = Math.floor(Math.random() * 0xffffffff),
  ): Promise<{ raw: RawCollab; ticket: CollabTicketResponse; clientId: number }> {
    const response = await requestTicket(agent, documentId, clientId);
    if (response.status !== 200) throw new Error(`ticket request failed: ${response.text}`);
    const raw = await RawCollab.open(agent.server);
    raw.auth(response.body.documentName, response.body.ticket);
    await raw.waitFor((message) => message.kind === 'auth');
    return { raw, ticket: response.body, clientId };
  }

  static decode(frame: Uint8Array): RawMessage {
    if (frame.length === 1 && frame[0] === 9) return { kind: 'ping' };
    const decoder = decoding.createDecoder(frame);
    decoding.readVarString(decoder);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MSG.sync:
      case MSG.syncReply: {
        const step = decoding.readVarUint(decoder);
        return { kind: 'sync', step, payload: decoding.readVarUint8Array(decoder) };
      }
      case MSG.awareness:
        return { kind: 'awareness', update: decoding.readVarUint8Array(decoder) };
      case MSG.auth: {
        const status = decoding.readVarUint(decoder);
        return {
          kind: 'auth',
          status: status === 2 ? 'authenticated' : 'denied',
          detail: decoding.readVarString(decoder),
        };
      }
      case MSG.stateless:
        return {
          kind: 'stateless',
          message: JSON.parse(decoding.readVarString(decoder)) as ServerStateless,
        };
      case MSG.close:
        return { kind: 'close', reason: decoding.readVarString(decoder) };
      case MSG.syncStatus:
        return { kind: 'syncStatus', applied: decoding.readVarUint(decoder) === 1 };
      default:
        return { kind: 'unknown', type };
    }
  }

  private frame(documentName: string, type: number, write: (encoder: encoding.Encoder) => void) {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, documentName);
    encoding.writeVarUint(encoder, type);
    write(encoder);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  auth(documentName: string, ticket: string): void {
    this.frame(documentName, MSG.auth, (encoder) => {
      encoding.writeVarUint(encoder, 0);
      encoding.writeVarString(encoder, ticket);
      encoding.writeVarString(encoder, 'raw-test-client');
    });
  }

  syncStep1(documentName: string, stateVector: Uint8Array = Y.encodeStateVector(new Y.Doc())) {
    this.frame(documentName, MSG.sync, (encoder) => {
      encoding.writeVarUint(encoder, 0);
      encoding.writeVarUint8Array(encoder, stateVector);
    });
  }

  syncStep2(documentName: string, update: Uint8Array): void {
    this.frame(documentName, MSG.sync, (encoder) => {
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint8Array(encoder, update);
    });
  }

  update(documentName: string, update: Uint8Array): void {
    this.frame(documentName, MSG.sync, (encoder) => {
      encoding.writeVarUint(encoder, 2);
      encoding.writeVarUint8Array(encoder, update);
    });
  }

  awareness(documentName: string, update: Uint8Array): void {
    this.frame(documentName, MSG.awareness, (encoder) => {
      encoding.writeVarUint8Array(encoder, update);
    });
  }

  stateless(documentName: string, message: Record<string, unknown>): void {
    this.frame(documentName, MSG.stateless, (encoder) => {
      encoding.writeVarString(encoder, JSON.stringify(message));
    });
  }

  raw(data: Uint8Array | string): void {
    this.ws.send(data);
  }

  waitFor<T extends RawMessage>(
    match: (message: RawMessage) => boolean,
    options: { timeoutMs?: number; from?: number; what?: string } = {},
  ): Promise<T> {
    return until(() => this.messages.slice(options.from ?? 0).find(match), {
      timeoutMs: options.timeoutMs ?? 10_000,
      what: options.what ?? 'raw collaboration message',
    }) as Promise<T>;
  }

  /** Server side-channel messages received so far. */
  get serverMessages(): ServerStateless[] {
    return this.messages.flatMap((message) =>
      message.kind === 'stateless' ? [message.message] : [],
    );
  }

  closed(timeoutMs = 10_000): Promise<CloseInfo> {
    return until(() => this.closeInfo, { timeoutMs, what: 'raw socket close' });
  }

  /**
   * Performs the sync handshake into a local Y.Doc and returns it, so a test
   * can build updates on top of the real server state.
   */
  async syncInto(documentName: string, doc: Y.Doc = new Y.Doc()): Promise<Y.Doc> {
    const from = this.messages.length;
    this.syncStep1(documentName, Y.encodeStateVector(doc));
    const reply = await this.waitFor<Extract<RawMessage, { kind: 'sync' }>>(
      (message) => message.kind === 'sync' && message.step === 1,
      { from, what: 'sync step 2 from the server' },
    );
    Y.applyUpdate(doc, reply.payload, 'server');
    return doc;
  }

  destroy(): void {
    this.ws.terminate();
  }
}

// ── Test data ───────────────────────────────────────────────────────────────

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

/** A real, decodable PNG. `noise` makes it incompressible (for size tests). */
export function makePng(width: number, height: number, options: { noise?: boolean } = {}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  if (options.noise) {
    let seed = 0x9e3779b9;
    for (let i = 0; i < raw.length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      raw[i] = i % (width * 3 + 1) === 0 ? 0 : seed >>> 24;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG whose header claims huge dimensions while the file itself is tiny. */
export function makePngHeaderOnly(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.alloc(16))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export const demoPng = (): Buffer =>
  readFileSync(path.join(serverRoot, 'assets', 'realtimedocs-demo.png'));

/** JSON of everything stored for a document (all generations), for "is X in the database?" checks. */
export async function storedContent(server: TestServer, documentId: string): Promise<string> {
  const parts: string[] = [];
  const decode = (state: Buffer | null, updates: Buffer[]) => {
    const doc = new Y.Doc();
    if (state) Y.applyUpdate(doc, state);
    for (const update of updates) Y.applyUpdate(doc, update);
    parts.push(JSON.stringify(yDocToProsemirrorJSON(doc, Y_FRAGMENT_FIELD)));
  };
  const states = await server.sql<{ generation: number; state: Buffer }>(
    'SELECT generation, state FROM doc_states WHERE document_id = $1',
    [documentId],
  );
  const generations = new Set(states.map((row) => row.generation));
  const updates = await server.sql<{ generation: number; update: Buffer }>(
    'SELECT generation, "update" FROM doc_updates WHERE document_id = $1 ORDER BY generation, seq',
    [documentId],
  );
  for (const row of updates) generations.add(row.generation);
  for (const generation of generations) {
    decode(
      states.find((row) => row.generation === generation)?.state ?? null,
      updates.filter((row) => row.generation === generation).map((row) => row.update),
    );
  }
  // Raw update bytes too: text in a Yjs update is stored as plain UTF-8.
  for (const row of updates) parts.push(row.update.toString('utf8'));
  return parts.join('\n');
}
