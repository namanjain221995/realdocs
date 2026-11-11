/**
 * Server-authoritative presence (docs/architecture.md §5.4).
 *
 * A connection may only write the awareness slot of its own Yjs client id.
 * Whatever identity it claims is replaced by the authenticated one, cursors
 * of read-only connections are stripped, removals of other clients are
 * dropped and updates are throttled per connection.
 */
import {
  PRESENCE_MAX_STATE_BYTES,
  PRESENCE_MIN_INTERVAL_MS,
  type AwarenessUser,
} from '@realtimedocs/contracts';
import { createDecoder, readVarString, readVarUint } from 'lib0/decoding';

export interface PresenceIdentity {
  /** The only Yjs client id this connection may describe. */
  clientId: number;
  user: AwarenessUser;
  readOnly: boolean;
}

function sanitizeCursor(value: unknown): { anchor: unknown; head: unknown } | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || value === undefined) return undefined;
  const cursor = value as Record<string, unknown>;
  if (!('anchor' in cursor) || !('head' in cursor)) return undefined;
  return { anchor: cursor.anchor, head: cursor.head };
}

/**
 * Rewrites a decoded awareness update in place so that it only describes the
 * connection's own client, with the identity attested by the server.
 */
export function sanitizeAwareness(
  states: Map<number, Record<string, unknown>>,
  removedClients: Set<number>,
  identity: PresenceIdentity,
): void {
  for (const clientId of [...states.keys()]) {
    if (clientId !== identity.clientId) states.delete(clientId);
  }
  for (const clientId of [...removedClients]) {
    if (clientId !== identity.clientId) removedClients.delete(clientId);
  }

  const proposed = states.get(identity.clientId);
  if (!proposed) return;

  const next: Record<string, unknown> = { user: { ...identity.user } };
  if (!identity.readOnly) {
    const cursor = sanitizeCursor(proposed.cursor);
    if (cursor !== undefined) {
      next.cursor = cursor;
      let size = Number.POSITIVE_INFINITY;
      try {
        size = Buffer.byteLength(JSON.stringify(next), 'utf8');
      } catch {
        // Not serialisable: drop the cursor below.
      }
      if (size > PRESENCE_MAX_STATE_BYTES) delete next.cursor;
    }
  }
  states.set(identity.clientId, next);
}

const MESSAGE_TYPE_AWARENESS = 1;

/** True when a raw Hocuspocus frame is an awareness update. */
export function isAwarenessFrame(frame: Uint8Array): boolean {
  try {
    const decoder = createDecoder(frame);
    readVarString(decoder);
    return readVarUint(decoder) === MESSAGE_TYPE_AWARENESS;
  } catch {
    return false;
  }
}

/** Largest awareness frame accepted from a client (state plus protocol overhead). */
export const PRESENCE_MAX_FRAME_BYTES = PRESENCE_MAX_STATE_BYTES * 2 + 512;

/**
 * Per-connection presence throttle: at most one awareness frame is forwarded
 * per interval. A frame that arrives too early replaces the previously held
 * one and is forwarded when the interval has elapsed, so the latest state
 * always gets through (trailing edge) and at most one frame is ever buffered.
 */
export class PresenceThrottle {
  private lastForwardedAt = Number.NEGATIVE_INFINITY;
  private held: Uint8Array | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly forward: (frame: Uint8Array) => void,
    private readonly intervalMs: number = PRESENCE_MIN_INTERVAL_MS,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Returns true when the frame was forwarded immediately. */
  offer(frame: Uint8Array): boolean {
    if (frame.byteLength > PRESENCE_MAX_FRAME_BYTES) return false;
    const elapsed = this.now() - this.lastForwardedAt;
    if (elapsed >= this.intervalMs && this.held === null) {
      this.lastForwardedAt = this.now();
      this.forward(frame);
      return true;
    }
    this.held = frame;
    this.timer ??= setTimeout(() => this.flush(), Math.max(0, this.intervalMs - elapsed));
    return false;
  }

  private flush(): void {
    this.timer = null;
    const frame = this.held;
    this.held = null;
    if (!frame) return;
    this.lastForwardedAt = this.now();
    this.forward(frame);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.held = null;
  }
}
