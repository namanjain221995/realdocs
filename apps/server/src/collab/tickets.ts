/**
 * Collaboration tickets: single-use, 60-second credentials that are sent in
 * the WebSocket authentication message (never in a URL). They live only in
 * this process's memory; only their SHA-256 is kept.
 */
import { TTL, type Participant } from '@realtimedocs/contracts';
import { randomToken, sha256 } from '../auth/tokens';

export interface TicketData {
  documentId: string;
  generation: number;
  /** Yjs client id the connection may use for presence. */
  clientId: number;
  /** Sessions the ticket was issued for; access is re-resolved from these. */
  sessionIds: string[];
  participant: Participant;
  schemaVersion: number;
  protocolVersion: number;
}

interface Entry {
  data: TicketData;
  expiresAt: number;
}

export type ConsumeResult =
  { ok: true; data: TicketData } | { ok: false; reason: 'ticket_invalid' | 'ticket_expired' };

export class TicketStore {
  private readonly entries = new Map<string, Entry>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly ttlMs: number = TTL.collabTicketMs,
    private readonly maxEntries: number = 50_000,
    private readonly now: () => number = Date.now,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Returns null when the store is full (the caller answers `server_busy`). */
  issue(data: TicketData): { ticket: string; expiresAt: Date } | null {
    if (this.entries.size >= this.maxEntries) {
      this.sweep();
      if (this.entries.size >= this.maxEntries) return null;
    }
    const ticket = randomToken();
    const expiresAt = this.now() + this.ttlMs;
    this.entries.set(sha256(ticket).toString('base64'), { data, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt) };
  }

  /** Redeems a ticket. It is removed on the first attempt, successful or not. */
  consume(ticket: string): ConsumeResult {
    if (typeof ticket !== 'string' || ticket.length !== 43) {
      return { ok: false, reason: 'ticket_invalid' };
    }
    const key = sha256(ticket).toString('base64');
    const entry = this.entries.get(key);
    if (!entry) return { ok: false, reason: 'ticket_invalid' };
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return { ok: false, reason: 'ticket_expired' };
    return { ok: true, data: entry.data };
  }

  /** Drops every unused ticket that was issued for one of these sessions. */
  revokeForSessions(sessionIds: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) {
      if (entry.data.sessionIds.some((id) => sessionIds.has(id))) this.entries.delete(key);
    }
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  close(): void {
    clearInterval(this.sweeper);
    this.entries.clear();
  }
}
