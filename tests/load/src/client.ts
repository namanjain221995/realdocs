/**
 * One simulated user: a share-link guest session, a Y.Doc and a Hocuspocus provider that obeys the
 * server's acknowledgement protocol (mark / saved / hello / resync), reconnects with a NEW ticket
 * and capped exponential backoff (same shape as packages/editor/src/collab/backoff.ts).
 *
 * Latency: every edit inserts an 8-character marker into the client's own paragraph; the sampled
 * receivers of the same document live in the SAME worker process, so wallNow() is one clock.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  COLLAB_PROTOCOL_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  Y_FRAGMENT_FIELD,
  type CollabTicketResponse,
} from '@realtimedocs/contracts';
import WebSocket from 'ws';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Api } from './api';
import { bump, sleep, wallNow } from './common';

export interface ClientSpec {
  key: string;
  docKey: string;
  docId: string;
  grantId: string;
  secret: string;
  /** Position inside the document's group of clients (0 and 1 are the sampled receivers). */
  idx: number;
  group: string;
  awareness: boolean;
  /** Observe remote markers: 'all' records every other sender, 'first' only sender idx 0, 'none'. */
  observe: 'all' | 'first' | 'none';
}

export interface Pending {
  t0: number;
  sender: LoadClient;
  kind: 'type' | 'paste';
}

export interface Samples {
  [metric: string]: number[];
}

/** Everything a worker's clients share. */
export class Shared {
  readonly pending = new Map<string, Pending>();
  readonly samples: Record<string, Samples> = {};
  readonly counts: Record<string, Record<string, number>> = {};
  readonly errors: Record<string, number> = {};
  readonly closeCodes: Record<string, number> = {};
  readonly byClientId = new Map<number, LoadClient>();
  readonly clients: LoadClient[] = [];
  constructor(readonly origin: string) {
    this.origin = origin;
  }
  sample(group: string, metric: string, value: number): void {
    const g = (this.samples[group] ??= {});
    (g[metric] ??= []).push(value);
  }
  count(group: string, name: string, by = 1): void {
    const g = (this.counts[group] ??= {});
    bump(g, name, by);
  }
  prune(): void {
    const cutoff = wallNow() - 120_000;
    for (const [k, v] of this.pending) if (v.t0 < cutoff) this.pending.delete(k);
  }
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function marker(): string {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += ALPHABET[(Math.random() * 36) | 0];
  return s;
}

class Failure extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}

function classify(err: unknown): string {
  if (err instanceof Failure) return err.key;
  const e = err as { cause?: { code?: string }; code?: string; name?: string; message?: string };
  return `net_${e?.cause?.code ?? e?.code ?? e?.name ?? 'error'}`;
}

interface EditRecord {
  n: number;
  t0: number;
  marker: string;
  online: boolean;
}

interface Conn {
  socket: HocuspocusProviderWebsocket;
  provider: HocuspocusProvider;
  closed: { code: number; reason: string } | null;
  onClose: Promise<{ code: number; reason: string }>;
  synced: boolean;
  authFailed: string | null;
}

// Kept equal to RECONNECT_BACKOFF in packages/editor/src/collab/backoff.ts.
const BACKOFF = { baseMs: 400, maxMs: 30_000, factor: 1.6, jitter: 0.5 };
function backoffDelay(attempt: number): number {
  const d = Math.min(BACKOFF.maxMs, BACKOFF.baseMs * BACKOFF.factor ** Math.min(attempt - 1, 30));
  return Math.round(d * (1 - BACKOFF.jitter) + d * BACKOFF.jitter * Math.random());
}

export class LoadClient {
  readonly doc = new Y.Doc();
  readonly api: Api;
  readonly awareness: Awareness | null;
  n = 0;
  conn: Conn | null = null;
  /** True between "hello acknowledged" and the loss of the socket. */
  ready = false;
  everReady = false;
  destroyed = false;
  autoReconnect = false;
  text: Y.XmlText | null = null;
  readonly edits: EditRecord[] = [];
  readonly acked: string[] = [];
  editsMade = 0;
  firstAttemptResult: 'pending' | 'ok' | string = 'pending';
  connectMs: number | null = null;
  exchanged = false;
  accessMessageAt: number | null = null;
  lastCloseAt: number | null = null;
  lastClose: { code: number; reason: string } | null = null;
  observing = false;
  attempts = 0;
  typing = false;
  nextAt = 0;
  rate = 1;
  presenceTimer: NodeJS.Timeout | null = null;
  private waiters: { n: number; resolve: () => void }[] = [];
  private runPromise: Promise<void> | null = null;

  constructor(
    readonly spec: ClientSpec,
    readonly shared: Shared,
  ) {
    this.api = new Api(shared.origin);
    this.awareness = spec.awareness ? new Awareness(this.doc) : null;
    shared.byClientId.set(this.doc.clientID, this);
    if (spec.observe !== 'none') this.attachObserver();
    if (this.awareness && spec.observe !== 'none') this.attachAwarenessObserver();
  }

  get group(): string {
    return this.spec.group;
  }
  get fragment(): Y.XmlFragment {
    return this.doc.getXmlFragment(Y_FRAGMENT_FIELD);
  }
  get unacked(): number {
    return this.edits.length;
  }

  private attachObserver(): void {
    this.fragment.observeDeep((events) => {
      if (!this.observing) return;
      const t = wallNow();
      for (const e of events) {
        if (e.transaction.local) continue;
        if (!(e instanceof Y.YTextEvent)) continue;
        for (const op of e.delta) {
          if (typeof op.insert !== 'string') continue;
          const s = op.insert;
          const tokens = s.length > 64 ? [s.slice(0, 8)] : s.split(' ');
          for (const tok of tokens) {
            if (tok.length !== 8) continue;
            const p = this.shared.pending.get(tok);
            if (!p || p.sender === this) continue;
            if (this.spec.observe === 'first' && p.sender.spec.idx !== 0 && p.kind !== 'paste')
              continue;
            const dt = t - p.t0;
            if (dt < 0 || dt > 60_000) continue;
            this.shared.sample(p.sender.group, p.kind === 'paste' ? 'pasteRemote' : 'remote', dt);
          }
        }
      }
    });
  }

  private attachAwarenessObserver(): void {
    this.awareness?.on(
      'update',
      ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
        if (origin === 'local' || !this.observing) return;
        const t = wallNow();
        for (const id of [...added, ...updated]) {
          const sender = this.shared.byClientId.get(id);
          if (!sender || sender === this) continue;
          if (this.spec.observe === 'first' && sender.spec.idx !== 0) continue;
          const state = this.awareness?.getStates().get(id) as
            { cursor?: { anchor?: number } } | undefined;
          const stamp = state?.cursor?.anchor;
          if (typeof stamp !== 'number' || stamp <= 0) continue;
          // the server keeps only anchor/head of a cursor: the send time (ms, modulo 1e9) travels in the anchor
          const dt = ((Math.round(t) % 1e9) - stamp + 1e9) % 1e9;
          if (dt < 60_000) this.shared.sample(sender.group, 'presence', dt);
        }
      },
    );
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /** Exchange the share link once (a guest session per user), then connect; with `auto`, keep reconnecting. */
  start(auto: boolean): Promise<void> {
    this.autoReconnect = auto;
    this.runPromise = this.run();
    return this.runPromise;
  }

  /** Resolves when the FIRST attempt has finished (success or failure); the loop continues in the background. */
  startAndWaitFirst(auto: boolean): Promise<void> {
    this.autoReconnect = auto;
    return new Promise((resolve) => {
      this.onFirstAttempt = resolve;
      this.runPromise = this.run();
    });
  }
  private onFirstAttempt: (() => void) | null = null;

  private async run(): Promise<void> {
    let attempt = 0;
    let lossAt: number | null = null;
    for (;;) {
      if (this.destroyed) return;
      attempt += 1;
      this.attempts += 1;
      try {
        await this.connectOnce();
        if (this.firstAttemptResult === 'pending') this.firstAttemptResult = 'ok';
        this.onFirstAttempt?.();
        this.onFirstAttempt = null;
        if (lossAt !== null) {
          this.shared.sample(this.group, 'reconnect', wallNow() - lossAt);
          this.shared.count(this.group, 'reconnects');
          lossAt = null;
        }
        attempt = 0;
        const closed = await this.conn!.onClose;
        this.ready = false;
        this.observing = false;
        this.lastCloseAt = wallNow();
        this.lastClose = closed;
        bump(this.shared.closeCodes, `${closed.code}${closed.reason ? ' ' + closed.reason : ''}`);
        lossAt = this.lastCloseAt;
        this.teardownConn();
        if (!this.autoReconnect || this.destroyed) return;
        if (this.accessMessageAt !== null) return; // access ended: do not reconnect
        await sleep(backoffDelay(1));
      } catch (err) {
        const key = classify(err);
        bump(this.shared.errors, key);
        this.shared.count(this.group, 'connect_errors');
        if (this.firstAttemptResult === 'pending') this.firstAttemptResult = key;
        this.onFirstAttempt?.();
        this.onFirstAttempt = null;
        this.ready = false;
        this.teardownConn();
        if (lossAt === null && this.everReady) lossAt = wallNow();
        if (!this.autoReconnect || this.destroyed) return;
        await sleep(backoffDelay(attempt + 1));
      }
    }
  }

  private teardownConn(): void {
    const c = this.conn;
    this.conn = null;
    if (!c) return;
    try {
      c.provider.destroy();
    } catch {
      /* ignore */
    }
    try {
      c.socket.destroy();
    } catch {
      /* ignore */
    }
  }

  private async connectOnce(): Promise<void> {
    const t0 = wallNow();
    if (!this.exchanged) {
      const r = await this.api.request('POST', '/api/share/exchange', {
        grantId: this.spec.grantId,
        secret: this.spec.secret,
      });
      if (r.status !== 200) throw new Failure(`exchange_http_${r.status}`);
      this.exchanged = true;
    }
    const tTicket = wallNow();
    const r = await this.api.request<CollabTicketResponse & { error?: { code?: string } }>(
      'POST',
      `/api/documents/${this.spec.docId}/collab-ticket`,
      {
        clientId: this.doc.clientID,
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        protocolVersion: COLLAB_PROTOCOL_VERSION,
      },
    );
    if (r.status !== 200) {
      const code = (r.body as { error?: { code?: string } } | null)?.error?.code;
      throw new Failure(`ticket_http_${r.status}${code ? '_' + code : ''}`);
    }
    this.shared.sample(this.group, 'ticketMs', wallNow() - tTicket);
    const ticket = r.body;
    const conn = this.openSocket(ticket);
    this.conn = conn;
    // Wait for sync, or a close/auth failure first.
    const synced = await Promise.race([
      this.until(() => conn.synced, 30_000).then(() => 'synced' as const),
      conn.onClose.then((c) => c),
    ]);
    if (synced !== 'synced') {
      throw new Failure(`ws_close_${synced.code}${synced.reason ? '_' + synced.reason : ''}`);
    }
    if (this.awareness && !this.awareness.getLocalState()) {
      this.awareness.setLocalState({
        user: { name: this.spec.key, color: '#3366cc' },
        cursor: { anchor: 0, head: 0 },
      });
    }
    await this.ensureParagraph(conn);
    await this.helloProof(conn);
    this.ready = true;
    this.everReady = true;
    this.observing = true;
    const connectMs = wallNow() - t0;
    if (this.connectMs === null) {
      this.connectMs = connectMs;
      this.shared.sample(this.group, 'connect', connectMs);
    }
    void tTicket;
  }

  private until(cond: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (cond()) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Failure('sync_timeout'));
        setTimeout(tick, 15);
      };
      tick();
    });
  }

  private openSocket(ticket: CollabTicketResponse): Conn {
    const origin = this.shared.origin;
    let resolveClose!: (v: { code: number; reason: string }) => void;
    const onClose = new Promise<{ code: number; reason: string }>((r) => (resolveClose = r));
    const conn: Conn = {
      socket: undefined as unknown as HocuspocusProviderWebsocket,
      provider: undefined as unknown as HocuspocusProvider,
      closed: null,
      onClose,
      synced: false,
      authFailed: null,
    };
    class OriginSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, { origin });
        this.on('close', (code, reason) => {
          conn.closed = { code, reason: reason.toString('utf8') };
          resolveClose(conn.closed);
        });
        this.on('error', () => undefined);
      }
    }
    conn.socket = new HocuspocusProviderWebsocket({
      url: `${origin.replace(/^http/, 'ws')}/collab`,
      WebSocketPolyfill: OriginSocket,
      maxAttempts: 1,
      delay: 3_600_000,
      messageReconnectTimeout: 120_000,
    });
    conn.provider = new HocuspocusProvider({
      websocketProvider: conn.socket,
      name: ticket.documentName,
      document: this.doc,
      awareness: this.awareness,
      token: ticket.ticket,
    });
    conn.provider.on('synced', () => {
      conn.synced = true;
    });
    conn.provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
      conn.authFailed = reason;
    });
    conn.provider.on('stateless', ({ payload }: { payload: string }) => {
      if (this.conn === conn || this.conn === null) this.onStateless(payload);
    });
    conn.provider.attach();
    return conn;
  }

  private onStateless(payload: string): void {
    let m: { t: string; n?: number; code?: string; state?: string; change?: string };
    try {
      m = JSON.parse(payload);
    } catch {
      return;
    }
    switch (m.t) {
      case 'saved':
        this.onSaved(m.n ?? 0);
        break;
      case 'save-error':
        this.shared.count(this.group, `save_error_${m.code}`);
        break;
      case 'persistence':
        this.shared.count(this.group, `persistence_${m.state}`);
        break;
      case 'access':
        this.accessMessageAt = wallNow();
        this.shared.count(this.group, `access_${m.change}`);
        break;
      case 'shutdown':
        this.shared.count(this.group, 'shutdown_notice');
        break;
      case 'resync':
        this.shared.count(this.group, 'resync');
        this.resyncRequested = true;
        this.onResync?.();
        break;
      default:
        break;
    }
  }
  private resyncRequested = false;
  private onResync: (() => void) | null = null;

  private onSaved(n: number): void {
    const t = wallNow();
    while (this.edits.length > 0 && (this.edits[0] as EditRecord).n <= n) {
      const e = this.edits.shift() as EditRecord;
      this.acked.push(e.marker);
      this.shared.sample(this.group, e.online ? 'ack' : 'ackOffline', t - e.t0);
    }
    this.waiters = this.waiters.filter((w) => {
      if (n >= w.n) {
        w.resolve();
        return false;
      }
      return true;
    });
  }

  private waitSaved(n: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Failure('hello_timeout'));
      }, timeoutMs);
      const waiter = {
        n,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      this.waiters.push(waiter);
    });
  }

  private send(conn: Conn, message: Record<string, unknown>): void {
    if (conn.closed) return;
    try {
      conn.provider.sendStateless(JSON.stringify(message));
    } catch {
      /* socket went away */
    }
  }

  /** Creates this client's own paragraph once (an ordinary document edit). */
  private async ensureParagraph(conn: Conn): Promise<void> {
    if (this.text || this.spec.group === 'reader') return;
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    this.doc.transact(() => this.fragment.push([paragraph]));
    this.text = text;
    this.n += 1;
    void conn;
  }

  /** What the editor does after every (re)connect: prove the local state with `hello`. */
  private async helloProof(conn: Conn): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const n = this.n;
      this.resyncRequested = false;
      this.send(conn, {
        t: 'hello',
        n,
        snapshot: Buffer.from(Y.encodeSnapshot(Y.snapshot(this.doc))).toString('base64'),
      });
      const resync = new Promise<void>((r) => (this.onResync = r));
      const waiting = this.waitSaved(n, 30_000);
      waiting.catch(() => undefined);
      const raced = await Promise.race([
        waiting.then(() => 'saved' as const),
        resync.then(() => 'resync' as const),
        conn.onClose.then((c) => c),
      ]);
      if (raced === 'saved') return;
      if (raced === 'resync') {
        try {
          conn.provider.forceSync();
        } catch {
          /* closed */
        }
        await sleep(300);
        continue;
      }
      throw new Failure(`ws_close_${raced.code}${raced.reason ? '_' + raced.reason : ''}`);
    }
    throw new Failure('hello_resync_exhausted');
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  /** One keystroke-sized edit with a unique marker, then `mark`. */
  edit(): void {
    if (!this.text) return;
    const mk = marker();
    const t0 = wallNow();
    this.doc.transact(() => this.text!.insert(this.text!.length, `${mk} `));
    this.n += 1;
    this.editsMade += 1;
    const online = this.ready;
    this.edits.push({ n: this.n, t0, marker: mk, online });
    this.shared.pending.set(mk, { t0, sender: this, kind: 'type' });
    this.shared.count(this.group, 'edits');
    if (this.ready && this.conn) this.send(this.conn, { t: 'mark', n: this.n });
  }

  /** A paste: one transaction inserting a large block (text or a table), preceded by the `hint`. */
  paste(kind: 'text' | 'table', size: number, cols = 20): void {
    const mk = marker();
    const t0 = wallNow();
    if (this.ready && this.conn) this.send(this.conn, { t: 'hint', kind: 'paste', at: Date.now() });
    this.doc.transact(() => {
      if (kind === 'text') {
        const p = new Y.XmlElement('paragraph');
        const t = new Y.XmlText();
        let body = `${mk} `;
        const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ';
        while (body.length < size) body += words;
        t.insert(0, body.slice(0, size));
        p.insert(0, [t]);
        this.fragment.push([p]);
      } else {
        const table = new Y.XmlElement('table');
        const rows: Y.XmlElement[] = [];
        for (let r = 0; r < size; r += 1) {
          const row = new Y.XmlElement('tableRow');
          const cells: Y.XmlElement[] = [];
          for (let c = 0; c < cols; c += 1) {
            const cell = new Y.XmlElement('tableCell');
            const p = new Y.XmlElement('paragraph');
            const t = new Y.XmlText();
            t.insert(0, r === 0 && c === 0 ? mk : `r${r}c${c}`);
            p.insert(0, [t]);
            cell.insert(0, [p]);
            cells.push(cell);
          }
          row.insert(0, cells);
          rows.push(row);
        }
        table.insert(0, rows);
        this.fragment.push([table]);
      }
    });
    this.n += 1;
    this.editsMade += 1;
    this.edits.push({ n: this.n, t0, marker: mk, online: this.ready });
    this.shared.pending.set(mk, { t0, sender: this, kind: 'paste' });
    this.shared.count(this.group, 'pastes');
    if (this.ready && this.conn) this.send(this.conn, { t: 'mark', n: this.n });
  }

  /** Appends `count` paragraphs of `chars` characters (seeding large documents). */
  appendParagraphs(count: number, chars: number): void {
    this.doc.transact(() => {
      const items: Y.XmlElement[] = [];
      for (let i = 0; i < count; i += 1) {
        const p = new Y.XmlElement('paragraph');
        const t = new Y.XmlText();
        let s = '';
        while (s.length < chars) s += Math.random().toString(36).slice(2) + ' ';
        t.insert(0, s.slice(0, chars));
        p.insert(0, [t]);
        items.push(p);
      }
      this.fragment.push(items);
    });
    this.n += 1;
    if (this.ready && this.conn) this.send(this.conn, { t: 'mark', n: this.n });
  }

  /** Resolves when everything marked so far is acknowledged. */
  async saved(timeoutMs = 60_000): Promise<void> {
    if (this.n === 0 || !this.conn) return;
    const n = this.n;
    if (this.edits.length === 0 && n === 0) return;
    const p = this.waitSaved(n, timeoutMs);
    if (this.conn) this.send(this.conn, { t: 'mark', n });
    await p;
  }

  startTyping(rate: number): void {
    this.rate = rate;
    if (this.typing) return;
    this.typing = true;
    const interval = () => 1000 / this.rate;
    this.nextAt = performance.now() + Math.random() * interval();
    const tick = () => {
      if (!this.typing || this.destroyed) return;
      const now = performance.now();
      if (now >= this.nextAt) {
        this.edit();
        this.nextAt += interval();
        if (this.nextAt < now - 1000) this.nextAt = now + interval(); // do not burst-catch-up after a stall
      }
      setTimeout(tick, Math.max(1, this.nextAt - performance.now()));
    };
    setTimeout(tick, Math.max(1, this.nextAt - performance.now()));
  }
  stopTyping(): void {
    this.typing = false;
  }

  startPresence(rate: number): void {
    if (!this.awareness) return;
    this.stopPresence();
    const send = () => {
      if (!this.ready) return;
      const stamp = Math.round(wallNow()) % 1e9 || 1;
      this.awareness?.setLocalStateField('cursor', { anchor: stamp, head: stamp });
    };
    this.presenceTimer = setInterval(send, 1000 / rate);
  }
  stopPresence(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.typing = false;
    this.stopPresence();
    this.teardownConn();
    this.awareness?.destroy();
    this.doc.destroy();
  }
}
