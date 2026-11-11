/**
 * Presence transport helpers.
 *
 * The session owns one `Awareness` per Y.Doc generation and carries it over
 * the Hocuspocus socket itself (the provider is created with
 * `awareness: null`), because a provider destroys the awareness instance it
 * was given and the session creates one provider per connection attempt.
 * The wire format is the Hocuspocus awareness message:
 * `varString(documentName) varUint(1) varUint8Array(awarenessUpdate)`.
 */
import { Participant } from '@realtimedocs/contracts';
import * as encoding from 'lib0/encoding';
import { encodeAwarenessUpdate, type Awareness } from 'y-protocols/awareness';

/** Hocuspocus `MessageType.Awareness`. */
export const MESSAGE_AWARENESS = 1;

export function encodeAwarenessMessage(
  documentName: string,
  awareness: Awareness,
  clients: number[],
  states?: Map<number, Record<string, unknown>>,
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, clients, states));
  return encoding.toUint8Array(encoder);
}

/**
 * Participants as attested by the server: every awareness state whose `user`
 * object passes the contract, de-duplicated by connection id. The local
 * participant comes first; the rest are ordered by name for a stable UI.
 */
export function participantsFromAwareness(awareness: Awareness): Participant[] {
  const localId = awareness.clientID;
  const byId = new Map<string, { participant: Participant; local: boolean }>();
  for (const [clientId, state] of awareness.getStates()) {
    const parsed = Participant.safeParse((state as { user?: unknown } | null)?.user);
    if (!parsed.success) continue;
    const local = clientId === localId;
    const existing = byId.get(parsed.data.id);
    if (!existing || (local && !existing.local)) {
      byId.set(parsed.data.id, { participant: parsed.data, local });
    }
  }
  return [...byId.values()]
    .sort((a, b) => {
      if (a.local !== b.local) return a.local ? -1 : 1;
      return (
        a.participant.name.localeCompare(b.participant.name) ||
        a.participant.id.localeCompare(b.participant.id)
      );
    })
    .map((entry) => entry.participant);
}

/**
 * Trailing-edge throttle for outgoing presence. The server relays at most one
 * update per connection per `PRESENCE_MIN_INTERVAL_MS`; sending the latest
 * state after the interval guarantees the final cursor position arrives.
 */
export class PresenceThrottle {
  private readonly send: () => void;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSentAt = 0;

  constructor(send: () => void, intervalMs: number) {
    this.send = send;
    this.intervalMs = intervalMs;
  }

  schedule(): void {
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastSentAt + this.intervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastSentAt = Date.now();
      this.send();
    }, wait);
  }

  /** Sends immediately (used right after authentication). */
  flush(): void {
    this.cancel();
    this.lastSentAt = Date.now();
    this.send();
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
