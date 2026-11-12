/**
 * Coordination between server instances (docs/scaling.md).
 *
 * Without `REDIS_URL` none of this exists and the server runs as one instance.
 * With it, several instances behind one load balancer share:
 *
 *  - **Document ownership.** Exactly one instance holds a document in memory
 *    and writes its durable log. Ownership is a Redis lease
 *    (`rd:owner:<documentId>`), renewed while the document is in use. An
 *    instance that receives a collaboration socket for a document it does not
 *    own forwards the socket to the owner over the private network, so every
 *    participant of a document is in the same room on the same instance.
 *    Should two instances ever believe they own a document, the database
 *    refuses the second writer (`head_seq` check) and its clients reconnect:
 *    the lease is an optimisation of routing, not what keeps data correct.
 *  - **Collaboration tickets**, single-use across instances (`GETDEL`).
 *  - **Control messages** (revocation, generation changes, flush requests),
 *    published to every instance.
 *
 * Rate-limit counters use the same Redis through `@fastify/rate-limit`.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Redis } from 'ioredis';
import { randomToken, sha256 } from '../auth/tokens';
import type { ConsumeResult, TicketData, Tickets } from '../collab/tickets';
import type { Logger } from '../logger';

export type ControlMessage =
  | { type: 'reevaluate_document'; documentId: string }
  | { type: 'reevaluate_sessions'; sessionIds: string[] }
  | { type: 'reevaluate_user'; userId: string }
  | {
      type: 'generation';
      documentId: string;
      oldGeneration: number;
      newGeneration: number;
      notice: { snapshotName?: string; byName?: string };
    }
  | { type: 'flush'; documentId: string; generation: number; replyTo: string; timeoutMs: number };

interface Envelope {
  from: string;
  message: ControlMessage;
}

export type Owner = { local: true } | { local: false; url: string; instanceId: string };

export interface ClusterOptions {
  redisUrl: string;
  /** Address other instances reach this one at, for forwarded sockets. */
  internalUrl: string;
  leaseTtlMs: number;
  ticketTtlMs: number;
  /** Shared by all instances (derived from SESSION_SECRET). */
  secret: Buffer;
  logger: Logger;
}

const CONTROL_CHANNEL = 'rd:control';
const OWNER_PREFIX = 'rd:owner:';
const TICKET_PREFIX = 'rd:ticket:';
const REPLY_PREFIX = 'rd:reply:';
const INTERNAL_HEADER = 'x-rd-cluster';
const INTERNAL_IP_HEADER = 'x-rd-client-ip';
const INTERNAL_MAX_SKEW_MS = 30_000;

/** Extends the lease if it is still ours, takes it if it is free, reports 0 if someone else has it. */
const RENEW_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

export class Cluster {
  readonly instanceId = randomUUID();
  readonly internalUrl: string;

  private readonly cmd: Redis;
  private readonly sub: Redis;
  private readonly logger: Logger;
  private readonly leaseTtlMs: number;
  private readonly ticketTtlMs: number;
  private readonly secret: Buffer;
  private readonly leaseValue: string;

  /** Documents this instance serves, with the number of sockets routed to it locally. */
  private readonly held = new Map<string, number>();
  private readonly controlListeners = new Set<(message: ControlMessage) => void>();
  private readonly replies = new Map<string, (ok: boolean) => void>();
  private leaseLost: (documentId: string) => void = () => {};
  private stillLoaded: (documentId: string) => boolean = () => false;
  private renewTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(options: ClusterOptions) {
    this.internalUrl = options.internalUrl.replace(/\/+$/, '');
    this.logger = options.logger;
    this.leaseTtlMs = options.leaseTtlMs;
    this.ticketTtlMs = options.ticketTtlMs;
    this.secret = options.secret;
    this.leaseValue = `${this.instanceId} ${this.internalUrl}`;
    const settings = {
      // Fail a command instead of queueing it without bound while Redis is away.
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      lazyConnect: true,
    };
    this.cmd = new Redis(options.redisUrl, settings);
    this.sub = new Redis(options.redisUrl, { ...settings, maxRetriesPerRequest: null });
    for (const client of [this.cmd, this.sub]) {
      client.on('error', (err: Error) => {
        this.logger.warn({ err: { message: err.message } }, 'redis connection error');
      });
    }
  }

  async start(): Promise<void> {
    await this.cmd.connect();
    await this.sub.connect();
    await this.sub.subscribe(CONTROL_CHANNEL, `${REPLY_PREFIX}${this.instanceId}`);
    this.sub.on('message', (channel: string, payload: string) => this.onMessage(channel, payload));
    this.renewTimer = setInterval(
      () => void this.renewAll(),
      Math.max(500, Math.floor(this.leaseTtlMs / 3)),
    );
    this.renewTimer.unref();
    this.logger.info(
      { instanceId: this.instanceId, internalUrl: this.internalUrl },
      'cluster coordination started',
    );
  }

  /** Gives up every lease so that other instances can take the documents at once. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.renewTimer) clearInterval(this.renewTimer);
    await Promise.allSettled(
      [...this.held.keys()].map((documentId) =>
        this.cmd.eval(RELEASE_SCRIPT, 1, `${OWNER_PREFIX}${documentId}`, this.leaseValue),
      ),
    );
    this.held.clear();
    this.sub.disconnect();
    this.cmd.disconnect();
  }

  async ping(timeoutMs = 2_000): Promise<{ ok: boolean; latencyMs: number }> {
    const started = performance.now();
    try {
      await Promise.race([
        this.cmd.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      return { ok: true, latencyMs: performance.now() - started };
    } catch {
      return { ok: false, latencyMs: performance.now() - started };
    }
  }

  /** The command connection, for the shared rate-limit store. */
  get redis(): Redis {
    return this.cmd;
  }

  // ── Tickets ───────────────────────────────────────────────────────────────

  readonly tickets: Tickets = {
    issue: async (data: TicketData) => {
      const ticket = randomToken();
      const expiresAt = Date.now() + this.ticketTtlMs;
      await this.cmd.set(
        `${TICKET_PREFIX}${sha256(ticket).toString('base64url')}`,
        JSON.stringify(data),
        'PX',
        this.ticketTtlMs,
      );
      return { ticket, expiresAt: new Date(expiresAt) };
    },
    consume: async (ticket: string): Promise<ConsumeResult> => {
      if (typeof ticket !== 'string' || ticket.length !== 43) {
        return { ok: false, reason: 'ticket_invalid' };
      }
      // Atomic read-and-delete: a ticket works once, on whichever instance sees it first.
      const stored = await this.cmd.getdel(
        `${TICKET_PREFIX}${sha256(ticket).toString('base64url')}`,
      );
      if (!stored) return { ok: false, reason: 'ticket_invalid' };
      try {
        return { ok: true, data: JSON.parse(stored) as TicketData };
      } catch {
        return { ok: false, reason: 'ticket_invalid' };
      }
    },
    // Access is resolved again from the database when a ticket is redeemed, so a
    // ticket of a revoked session is refused there; nothing to remove here.
    revokeForSessions: () => {},
    close: () => {},
  };

  // ── Document ownership ────────────────────────────────────────────────────

  /** Called when a lease this instance held now belongs to another instance. */
  onLeaseLost(listener: (documentId: string) => void): void {
    this.leaseLost = listener;
  }

  /** Lets the lease logic ask whether a document is still loaded here. */
  setLoadedCheck(check: (documentId: string) => boolean): void {
    this.stillLoaded = check;
  }

  /**
   * Who serves `documentId`. Takes the lease when nobody has it. A local
   * answer counts one more socket for the document (`release` undoes that).
   */
  async route(documentId: string): Promise<Owner> {
    const key = `${OWNER_PREFIX}${documentId}`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const taken = await this.cmd.set(key, this.leaseValue, 'PX', this.leaseTtlMs, 'NX');
      const current = taken === 'OK' ? this.leaseValue : await this.cmd.get(key);
      if (current === this.leaseValue) {
        this.held.set(documentId, (this.held.get(documentId) ?? 0) + 1);
        return { local: true };
      }
      if (current) {
        const [instanceId, url] = current.split(' ');
        if (instanceId && url) return { local: false, url, instanceId };
      }
      // The lease expired between the two commands: try again.
    }
    throw new Error('document ownership could not be determined');
  }

  /** One locally served socket of `documentId` is gone. */
  release(documentId: string): void {
    const count = (this.held.get(documentId) ?? 0) - 1;
    if (count > 0) {
      this.held.set(documentId, count);
      return;
    }
    this.held.set(documentId, 0);
    this.releaseIfUnused(documentId);
  }

  /** Gives the lease back once no socket uses the document and it is not loaded. */
  releaseIfUnused(documentId: string): void {
    if ((this.held.get(documentId) ?? 0) > 0 || this.stillLoaded(documentId)) return;
    if (!this.held.delete(documentId) || this.stopped) return;
    this.cmd.eval(RELEASE_SCRIPT, 1, `${OWNER_PREFIX}${documentId}`, this.leaseValue).catch(() => {
      // The lease expires by itself.
    });
  }

  private async renewAll(): Promise<void> {
    for (const documentId of [...this.held.keys()]) {
      // A renewal that is still running while the instance stops must not take
      // back a lease that `stop` has just released.
      if (this.stopped || !this.held.has(documentId)) return;
      try {
        const kept = await this.cmd.eval(
          RENEW_SCRIPT,
          1,
          `${OWNER_PREFIX}${documentId}`,
          this.leaseValue,
          String(this.leaseTtlMs),
        );
        if (kept === 0) {
          this.held.delete(documentId);
          this.logger.warn({ documentId }, 'document ownership moved to another instance');
          this.leaseLost(documentId);
        }
      } catch {
        // Redis is unreachable: keep serving. The database rejects a second
        // writer, so a wrong belief about ownership cannot damage a document.
      }
    }
  }

  // ── Control messages ──────────────────────────────────────────────────────

  onControl(listener: (message: ControlMessage) => void): void {
    this.controlListeners.add(listener);
  }

  /** Sends to every other instance. Best effort; local handling is the caller's job. */
  publish(message: ControlMessage): void {
    const envelope: Envelope = { from: this.instanceId, message };
    this.cmd.publish(CONTROL_CHANNEL, JSON.stringify(envelope)).catch((err: unknown) => {
      this.logger.warn({ err, type: message.type }, 'control message could not be published');
    });
  }

  /** Asks the owner of a document to flush it; resolves false on timeout. */
  async requestFlush(documentId: string, generation: number, timeoutMs: number): Promise<boolean> {
    const id = randomUUID();
    const replyTo = `${REPLY_PREFIX}${this.instanceId}`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.replies.delete(id);
        resolve(false);
      }, timeoutMs + 500);
      this.replies.set(id, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      this.publish({
        type: 'flush',
        documentId,
        generation,
        replyTo: `${replyTo}#${id}`,
        timeoutMs,
      });
    });
  }

  /** Answers a flush request (called by the instance that owns the document). */
  reply(replyTo: string, ok: boolean): void {
    const [channel, id] = replyTo.split('#');
    if (!channel?.startsWith(REPLY_PREFIX) || !id) return;
    this.cmd.publish(channel, JSON.stringify({ id, ok })).catch(() => {});
  }

  private onMessage(channel: string, payload: string): void {
    try {
      if (channel === CONTROL_CHANNEL) {
        const envelope = JSON.parse(payload) as Envelope;
        if (envelope.from === this.instanceId) return;
        for (const listener of this.controlListeners) listener(envelope.message);
        return;
      }
      const reply = JSON.parse(payload) as { id: string; ok: boolean };
      const waiting = this.replies.get(reply.id);
      if (waiting) {
        this.replies.delete(reply.id);
        waiting(reply.ok === true);
      }
    } catch (err) {
      this.logger.warn({ err }, 'malformed cluster message ignored');
    }
  }

  // ── Forwarded sockets ─────────────────────────────────────────────────────

  /** Headers that prove to the owner that a socket was forwarded by a peer instance. */
  internalHeaders(ip: string, origin: string): Record<string, string> {
    const at = Date.now();
    return {
      origin,
      [INTERNAL_IP_HEADER]: ip,
      [INTERNAL_HEADER]: `${at}.${this.sign(at, ip, origin)}`,
    };
  }

  /** The client address vouched for by a peer instance, or null for an ordinary request. */
  verifyInternal(headers: Record<string, string | string[] | undefined>): string | null {
    const token = headers[INTERNAL_HEADER];
    const ip = headers[INTERNAL_IP_HEADER];
    const origin = headers.origin;
    if (typeof token !== 'string' || typeof ip !== 'string' || typeof origin !== 'string') {
      return null;
    }
    const [atText, signature] = token.split('.');
    const at = Number(atText);
    if (!Number.isFinite(at) || !signature) return null;
    if (Math.abs(Date.now() - at) > INTERNAL_MAX_SKEW_MS) return null;
    const expected = Buffer.from(this.sign(at, ip, origin));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return ip;
  }

  private sign(at: number, ip: string, origin: string): string {
    return createHmac('sha256', this.secret)
      .update(`collab-forward:v1|${at}|${ip}|${origin}`)
      .digest('base64url');
  }
}

/** Key shared by the instances of one deployment, derived from the session secret. */
export function clusterSecret(sessionSecret: string): Buffer {
  return createHmac('sha256', sessionSecret).update('realtimedocs:cluster:v1').digest();
}
