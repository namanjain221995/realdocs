/**
 * Worker of the performance framework. It is the load harness's worker (tests/load/src/worker.ts:
 * real share-link exchange, collaboration ticket, Hocuspocus provider, `mark`/`saved`/`hello`)
 * with additional commands: seeded activity profiles, same-document convergence checks,
 * connection drops and the scripted two-person session of scenario A.
 */
import { createHash } from 'node:crypto';
import { handlers, getShared } from '../../load/src/worker';
import type { LoadClient } from '../../load/src/client';
import { sleep, wallNow } from '../../load/src/common';
// The same module instance the load client uses (one Yjs in the process).
// @ts-expect-error -- resolved by path so that this file and the load client share one Yjs instance
import * as Y from '../../load/node_modules/yjs/dist/yjs.mjs';

/** Small seeded generator (mulberry32): the same seed gives the same sequence of actions. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashSeed = (seed: number, key: string): number =>
  createHash('sha256').update(`${seed}:${key}`).digest().readUInt32LE(0);

export interface Profile {
  /** Mean actions per second while not pausing. */
  rate: number;
  /** Relative weights of the actions. */
  type: number;
  delete: number;
  format: number;
  cursor: number;
  /** Probability per action of a pause, and its length range in seconds. */
  pauseChance: number;
  pauseS: [number, number];
  /** Probability per action of dropping the connection (the client reconnects by itself). */
  reconnectChance: number;
}

interface Behaving {
  stop: boolean;
}
const behaving = new Map<LoadClient, Behaving>();
const scratch = new Map<LoadClient, any>();
const any = (c: LoadClient) => c as any;

/** A second paragraph of the client's own, where it deletes and formats without touching markers. */
function scratchText(c: LoadClient): any {
  let t = scratch.get(c);
  if (t) return t;
  const paragraph = new Y.XmlElement('paragraph');
  t = new Y.XmlText();
  paragraph.insert(0, [t]);
  c.doc.transact(() => c.fragment.push([paragraph]));
  any(c).n += 1;
  scratch.set(c, t);
  return t;
}
function count(c: LoadClient, name: string): void {
  getShared().count(c.group, name);
}
function mark(c: LoadClient): void {
  if (c.ready && c.conn) any(c).send(c.conn, { t: 'mark', n: c.n });
}
const FILL = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ';

function act(c: LoadClient, p: Profile, r: () => number): void {
  const total = p.type + p.delete + p.format + p.cursor;
  let x = r() * total;
  if ((x -= p.type) < 0) {
    c.edit();
    return;
  }
  if (!c.ready || !c.text) return;
  if ((x -= p.delete) < 0) {
    const t = scratchText(c);
    c.doc.transact(() => {
      if (t.length < 40) t.insert(t.length, FILL.slice(0, 20 + Math.floor(r() * 40)));
      else t.delete(Math.floor(r() * (t.length - 8)), 1 + Math.floor(r() * 7));
    });
    any(c).n += 1;
    mark(c);
    count(c, 'deletes');
    return;
  }
  if (x < p.format) {
    const t = scratchText(c);
    c.doc.transact(() => {
      if (t.length < 20) t.insert(t.length, FILL.slice(0, 30));
      const at = Math.floor(r() * (t.length - 6));
      const which = r() < 0.5 ? 'bold' : 'italic';
      t.format(at, 1 + Math.floor(r() * 5), { [which]: r() < 0.7 ? {} : null });
    });
    any(c).n += 1;
    mark(c);
    count(c, 'formats');
    return;
  }
  if (c.awareness) {
    const stamp = Math.round(wallNow()) % 1e9 || 1;
    c.awareness.setLocalStateField('cursor', { anchor: stamp, head: stamp + Math.floor(r() * 12) });
    count(c, 'cursor_updates');
  }
}

function dropConnection(c: LoadClient): boolean {
  const socket = (c.conn?.socket as any)?.webSocket;
  if (!socket) return false;
  try {
    socket.close();
    count(c, 'drops');
    return true;
  } catch {
    return false;
  }
}

/** Starts the seeded behaviour loop of every selected client. `assign` maps a client to a profile name. */
handlers.behave = ({
  seed,
  profiles,
  assign,
  groups,
}: {
  seed: number;
  profiles: Record<string, Profile>;
  /** Profile names in the order they are dealt to clients (by client index). */
  assign: string[];
  groups?: string[];
}) => {
  const clients = getShared().clients.filter((c) => !groups || groups.includes(c.group));
  let started = 0;
  clients.forEach((c) => {
    if (behaving.has(c) || c.spec.group === 'reader') return;
    const r = rng(hashSeed(seed, c.spec.key));
    const name = assign[Number(c.spec.key.replace(/\D/g, '')) % assign.length] ?? assign[0]!;
    const p = profiles[name]!;
    const state: Behaving = { stop: false };
    behaving.set(c, state);
    started += 1;
    void (async () => {
      await sleep(r() * (1000 / p.rate));
      while (!state.stop && !c.destroyed) {
        if (r() < p.pauseChance) {
          await sleep((p.pauseS[0] + r() * (p.pauseS[1] - p.pauseS[0])) * 1000);
          continue;
        }
        if (r() < p.reconnectChance) dropConnection(c);
        else act(c, p, r);
        // Exponential gaps: a Poisson stream of actions, not a metronome.
        await sleep(Math.min(30_000, (-Math.log(1 - r()) / p.rate) * 1000));
      }
    })();
  });
  return started;
};
handlers.stopBehave = () => {
  for (const s of behaving.values()) s.stop = true;
  const n = behaving.size;
  behaving.clear();
  return n;
};

/** Drops the connection of a fraction of the ready clients (they reconnect with a new ticket). */
handlers.drop = ({ fraction, groups }: { fraction: number; groups?: string[] }) => {
  let dropped = 0;
  for (const c of getShared().clients) {
    if (groups && !groups.includes(c.group)) continue;
    if (c.ready && Math.random() < fraction && dropConnection(c)) dropped += 1;
  }
  return dropped;
};

const digest = (c: LoadClient): string =>
  createHash('sha256').update(JSON.stringify(c.fragment.toJSON())).digest('hex');

/** Per document: do all of this worker's connected clients hold the same content? */
handlers.converge = () => {
  const byDoc = new Map<string, LoadClient[]>();
  for (const c of getShared().clients) {
    if (c.destroyed || !c.ready) continue;
    const list = byDoc.get(c.spec.docKey) ?? [];
    list.push(c);
    byDoc.set(c.spec.docKey, list);
  }
  let docs = 0;
  let diverged = 0;
  let compared = 0;
  const samples: string[] = [];
  const digests: Record<string, string> = {};
  for (const [key, list] of byDoc) {
    docs += 1;
    const first = digest(list[0]!);
    digests[key] = first;
    compared += list.length;
    if (list.some((c) => digest(c) !== first)) {
      diverged += 1;
      if (samples.length < 5) samples.push(key);
    }
  }
  return { docs, diverged, compared, samples, digests };
};

/**
 * Scenario A: two people in one document do what an editor does, one kind of operation at a time,
 * and every operation is timed from the local transaction to its arrival in the other person's
 * Y.Doc (same process, one clock) and to the server's `saved` acknowledgement.
 */
handlers.pairSession = async ({ rounds }: { rounds: number }) => {
  const [a, b] = getShared().clients as [LoadClient, LoadClient];
  if (!a || !b) throw new Error('pairSession needs two clients');
  const out: Record<string, number[]> = {};
  const push = (k: string, v: number) => (out[k] ??= []).push(v);
  const waitFor = async (cond: () => boolean, timeoutMs = 10_000): Promise<number> => {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > timeoutMs) return NaN;
      await new Promise((r) => setImmediate(r));
    }
    return performance.now() - t0;
  };
  const timed = async (
    kind: string,
    actor: LoadClient,
    other: LoadClient,
    change: () => void,
    seen: () => boolean,
  ) => {
    const t0 = performance.now();
    actor.doc.transact(change);
    any(actor).n += 1;
    const n = actor.n;
    const acked = (any(actor).waitSaved(n, 15_000) as Promise<void>).then(
      () => performance.now() - t0,
      () => NaN,
    );
    mark(actor);
    push(`${kind}:remote`, await waitFor(seen));
    push(`${kind}:ack`, await acked);
  };
  const otherText = (owner: LoadClient, viewer: LoadClient): string => {
    // The owner's first paragraph, as the viewer holds it.
    const index = owner.fragment.toArray().indexOf(any(owner).text.parent);
    const node = viewer.fragment.get(index) as any;
    return node?.toString?.() ?? '';
  };
  for (let i = 0; i < rounds; i += 1) {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as [LoadClient, LoadClient][]) {
      const text = any(x).text;
      const token = `t${i}${x === a ? 'a' : 'b'}${Math.random().toString(36).slice(2, 8)}`;
      await timed(
        'typing',
        x,
        y,
        () => text.insert(text.length, `${token} `),
        () => otherText(x, y).includes(token),
      );
      await timed(
        'deletion',
        x,
        y,
        () => text.delete(text.length - token.length - 1, token.length + 1),
        () => !otherText(x, y).includes(token),
      );
      const fmt = `f${i}${Math.random().toString(36).slice(2, 8)}`;
      await timed(
        'typing',
        x,
        y,
        () => text.insert(text.length, `${fmt} `),
        () => otherText(x, y).includes(fmt),
      );
      await timed(
        'formatting',
        x,
        y,
        () => text.format(text.length - fmt.length - 1, fmt.length, { bold: {} }),
        () => otherText(x, y).includes(`<bold>${fmt}</bold>`),
      );
      const before = y.fragment.length;
      await timed(
        'paragraph',
        x,
        y,
        () => {
          const p = new Y.XmlElement('paragraph');
          const t = new Y.XmlText();
          t.insert(0, `para ${i}`);
          p.insert(0, [t]);
          x.fragment.push([p]);
        },
        () => y.fragment.length > before,
      );
      const pasted = `p${i}${Math.random().toString(36).slice(2, 8)}`;
      await timed(
        'paste2kB',
        x,
        y,
        () => text.insert(text.length, `${pasted} ${FILL.repeat(26).slice(0, 2000)} `),
        () => otherText(x, y).includes(pasted),
      );
      // Cursor and selection: awareness only, nothing is saved.
      if (x.awareness && y.awareness) {
        const stamp = 1_000_000 + i * 10 + (x === a ? 1 : 2);
        const t0 = performance.now();
        x.awareness.setLocalStateField('cursor', { anchor: stamp, head: stamp + 5 });
        const dt = await waitFor(
          () => (y.awareness!.getStates().get(x.doc.clientID) as any)?.cursor?.anchor === stamp,
        );
        push('cursor:remote', dt);
        void t0;
      }
    }
  }
  // Simultaneous typing at the same place: both append to the SAME paragraph at once.
  const shared = any(a).text;
  const sharedIndex = a.fragment.toArray().indexOf(shared.parent);
  const sharedAtB = (b.fragment.get(sharedIndex) as any).get(0);
  const tokens: string[] = [];
  for (let i = 0; i < rounds * 5; i += 1) {
    const ta = `sa${i}x${Math.random().toString(36).slice(2, 7)}`;
    const tb = `sb${i}x${Math.random().toString(36).slice(2, 7)}`;
    tokens.push(ta, tb);
    a.doc.transact(() => shared.insert(shared.length, `${ta} `));
    b.doc.transact(() => sharedAtB.insert(sharedAtB.length, `${tb} `));
    any(a).n += 1;
    any(b).n += 1;
    mark(a);
    mark(b);
    await sleep(20);
  }
  await Promise.all([a.saved(30_000), b.saved(30_000)]);
  await sleep(500);
  // Reconnect: drop one person, let the other type meanwhile, then compare.
  const tDrop = performance.now();
  dropConnection(b);
  const offline = `off${Math.random().toString(36).slice(2, 8)}`;
  a.doc.transact(() => shared.insert(shared.length, `${offline} `));
  any(a).n += 1;
  mark(a);
  const back = await waitFor(() => b.ready && otherText(a, b).includes(offline), 60_000);
  push('reconnect:caughtUp', back);
  void tDrop;
  await Promise.all([a.saved(30_000), b.saved(30_000)]);
  await sleep(500);
  const text = a.fragment.toJSON() as unknown as string;
  return {
    samples: out,
    simultaneousTokens: tokens.length,
    simultaneousMissingAtA: tokens.filter((t) => !JSON.stringify(text).includes(t)).length,
    converged: digest(a) === digest(b),
    digest: digest(a),
    stateBytes: Y.encodeStateAsUpdate(a.doc).length,
  };
};
