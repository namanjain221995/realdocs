import { PRESENCE_MAX_STATE_BYTES, type AwarenessUser } from '@realtimedocs/contracts';
import { createEncoder, toUint8Array, writeVarString, writeVarUint } from 'lib0/encoding';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRESENCE_MAX_FRAME_BYTES,
  PresenceThrottle,
  isAwarenessFrame,
  sanitizeAwareness,
  type PresenceIdentity,
} from '../../src/collab/presence';

const ME = 1111;
const OTHER = 2222;
const user: AwarenessUser = {
  id: 'conn-1',
  name: 'Asha',
  color: '#2563eb',
  role: 'editor',
  kind: 'user',
};
const editor: PresenceIdentity = { clientId: ME, user, readOnly: false };
const viewer: PresenceIdentity = {
  clientId: ME,
  user: { ...user, role: 'viewer', kind: 'guest', name: 'Guest Amber Otter' },
  readOnly: true,
};

type States = Map<number, Record<string, unknown>>;

describe('sanitizeAwareness', () => {
  it('replaces a spoofed identity with the authenticated one', () => {
    const states: States = new Map([
      [
        ME,
        {
          user: {
            id: 'someone-else',
            name: 'Administrator',
            color: '#000',
            role: 'admin',
            kind: 'user',
          },
          cursor: { anchor: { a: 1 }, head: { b: 2 } },
        },
      ],
    ]);
    sanitizeAwareness(states, new Set(), editor);
    expect(states.get(ME)).toEqual({ user, cursor: { anchor: { a: 1 }, head: { b: 2 } } });
  });

  it('drops states for every other client id', () => {
    const states: States = new Map([
      [ME, { user: {}, cursor: null }],
      [OTHER, { user: { name: 'Victim', role: 'admin' }, cursor: { anchor: 1, head: 1 } }],
      [3333, { anything: true }],
    ]);
    sanitizeAwareness(states, new Set(), editor);
    expect([...states.keys()]).toEqual([ME]);
    expect(states.get(ME)).toEqual({ user, cursor: null });
  });

  it('drops removals of other clients but keeps its own', () => {
    const removed = new Set([ME, OTHER, 3333]);
    sanitizeAwareness(new Map(), removed, editor);
    expect([...removed]).toEqual([ME]);
  });

  it('does nothing harmful when the update does not mention the own client', () => {
    const states: States = new Map([[OTHER, { user: { name: 'x' } }]]);
    const removed = new Set([OTHER]);
    sanitizeAwareness(states, removed, editor);
    expect(states.size).toBe(0);
    expect(removed.size).toBe(0);
  });

  it('strips cursors from read-only connections', () => {
    const states: States = new Map([
      [ME, { cursor: { anchor: 1, head: 2 }, user: { role: 'editor' } }],
    ]);
    sanitizeAwareness(states, new Set(), viewer);
    expect(states.get(ME)).toEqual({ user: viewer.user });
  });

  it('removes unknown fields and malformed cursors', () => {
    const states: States = new Map([
      [
        ME,
        { cursor: 'not a cursor', secret: 'x', __proto__: { polluted: true }, extra: [1, 2, 3] },
      ],
    ]);
    sanitizeAwareness(states, new Set(), editor);
    expect(states.get(ME)).toEqual({ user });
    const partial: States = new Map([[ME, { cursor: { anchor: 1 } }]]);
    sanitizeAwareness(partial, new Set(), editor);
    expect(partial.get(ME)).toEqual({ user });
  });

  it('keeps only anchor and head of a cursor', () => {
    const states: States = new Map([
      [ME, { cursor: { anchor: 1, head: 2, payload: 'x'.repeat(50) } }],
    ]);
    sanitizeAwareness(states, new Set(), editor);
    expect(states.get(ME)).toEqual({ user, cursor: { anchor: 1, head: 2 } });
  });

  it('drops an oversized cursor instead of relaying it', () => {
    const states: States = new Map([
      [ME, { cursor: { anchor: 'x'.repeat(PRESENCE_MAX_STATE_BYTES), head: 1 } }],
    ]);
    sanitizeAwareness(states, new Set(), editor);
    expect(states.get(ME)).toEqual({ user });
  });

  it('does not share the identity object between states', () => {
    const states: States = new Map([[ME, {}]]);
    sanitizeAwareness(states, new Set(), editor);
    (states.get(ME)?.user as AwarenessUser).role = 'admin';
    expect(user.role).toBe('editor');
  });
});

function frame(documentName: string, type: number, extra = 0): Uint8Array {
  const encoder = createEncoder();
  writeVarString(encoder, documentName);
  writeVarUint(encoder, type);
  for (let i = 0; i < extra; i += 1) writeVarUint(encoder, 0);
  return toUint8Array(encoder);
}

describe('isAwarenessFrame', () => {
  it('recognises awareness frames only', () => {
    const name = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d.g1';
    expect(isAwarenessFrame(frame(name, 1))).toBe(true);
    expect(isAwarenessFrame(frame(name, 0))).toBe(false);
    expect(isAwarenessFrame(frame(name, 5))).toBe(false);
    expect(isAwarenessFrame(new Uint8Array([10]))).toBe(false);
    expect(isAwarenessFrame(new Uint8Array([200, 1, 2]))).toBe(false);
    expect(isAwarenessFrame(new Uint8Array())).toBe(false);
  });
});

describe('PresenceThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards the first frame at once and at most one per interval afterwards', () => {
    const forwarded: number[] = [];
    let now = 1_000;
    const throttle = new PresenceThrottle(
      (f) => forwarded.push(f[0] ?? -1),
      60,
      () => now,
    );

    expect(throttle.offer(new Uint8Array([1]))).toBe(true);
    now += 10;
    expect(throttle.offer(new Uint8Array([2]))).toBe(false);
    now += 10;
    expect(throttle.offer(new Uint8Array([3]))).toBe(false);
    expect(forwarded).toEqual([1]);

    // The latest state always gets through when the interval has elapsed.
    now += 40;
    vi.advanceTimersByTime(50);
    expect(forwarded).toEqual([1, 3]);

    now += 100;
    expect(throttle.offer(new Uint8Array([4]))).toBe(true);
    expect(forwarded).toEqual([1, 3, 4]);
  });

  it('limits a flood to one frame per interval', () => {
    const forwarded: number[] = [];
    let now = 0;
    const throttle = new PresenceThrottle(
      (f) => forwarded.push(f[0] ?? -1),
      60,
      () => now,
    );
    for (let i = 0; i < 600; i += 1) {
      throttle.offer(new Uint8Array([i % 256]));
      now += 1;
      vi.advanceTimersByTime(1);
    }
    // 600 ms of one frame per millisecond: about ten forwarded, never hundreds.
    expect(forwarded.length).toBeGreaterThanOrEqual(9);
    expect(forwarded.length).toBeLessThanOrEqual(11);
  });

  it('refuses oversized frames and forgets held frames on dispose', () => {
    const forwarded: Uint8Array[] = [];
    let now = 0;
    const throttle = new PresenceThrottle(
      (f) => forwarded.push(f),
      60,
      () => now,
    );
    expect(throttle.offer(new Uint8Array(PRESENCE_MAX_FRAME_BYTES + 1))).toBe(false);
    expect(forwarded).toHaveLength(0);
    throttle.offer(new Uint8Array([1]));
    now += 5;
    throttle.offer(new Uint8Array([2]));
    throttle.dispose();
    vi.advanceTimersByTime(1_000);
    expect(forwarded).toHaveLength(1);
  });
});
