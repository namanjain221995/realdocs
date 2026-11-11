import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DurableLog,
  GenerationMismatchError,
  SequenceConflictError,
  type DurableLogListeners,
  type FatalReason,
  type LogStore,
  type PersistenceStatus,
} from '../../src/collab/durable-log';

/** In-memory stand-in for PostgreSQL with the same contract as PgLogStore. */
class FakeStore implements LogStore {
  rows: { seq: number; update: Uint8Array }[] = [];
  headSeq = 0;
  generation = 1;
  compacted: { uptoSeq: number; state: Uint8Array } | null = null;
  appendCalls = 0;
  compactCalls = 0;
  failNextAppends = 0;
  failNextCompactions = 0;
  appendGate: Promise<void> | null = null;
  compactGate: Promise<void> | null = null;

  async append(input: {
    documentId: string;
    generation: number;
    expectedHeadSeq: number;
    update: Uint8Array;
  }): Promise<number> {
    this.appendCalls += 1;
    if (this.appendGate) await this.appendGate;
    if (this.failNextAppends > 0) {
      this.failNextAppends -= 1;
      throw new Error('simulated database outage');
    }
    if (input.generation !== this.generation) throw new GenerationMismatchError();
    if (input.expectedHeadSeq !== this.headSeq) throw new SequenceConflictError();
    this.headSeq += 1;
    this.rows.push({ seq: this.headSeq, update: input.update });
    return this.headSeq;
  }

  async compact(input: {
    documentId: string;
    generation: number;
    uptoSeq: number;
    state: Uint8Array;
  }): Promise<void> {
    this.compactCalls += 1;
    if (this.compactGate) await this.compactGate;
    if (this.failNextCompactions > 0) {
      this.failNextCompactions -= 1;
      throw new Error('simulated database outage');
    }
    if (input.generation !== this.generation) throw new GenerationMismatchError();
    if (input.uptoSeq !== this.headSeq) throw new SequenceConflictError();
    this.compacted = { uptoSeq: input.uptoSeq, state: input.state };
    // Exactly like the SQL: only rows at or below the boundary are deleted.
    this.rows = this.rows.filter((row) => row.seq > input.uptoSeq);
  }

  /** What a restart would load: compacted state plus the remaining rows in order. */
  rebuild(): Y.Doc {
    const doc = new Y.Doc();
    if (this.compacted) Y.applyUpdate(doc, this.compacted.state);
    for (const row of [...this.rows].sort((a, b) => a.seq - b.seq)) Y.applyUpdate(doc, row.update);
    return doc;
  }
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

interface Harness {
  store: FakeStore;
  log: DurableLog;
  doc: Y.Doc;
  text: Y.Text;
  committed: number[];
  saveErrors: { code: string; retrying: boolean }[];
  statuses: PersistenceStatus[];
  fatals: FatalReason[];
  idles: number[];
  positions: number[];
}

function harness(
  options: { maxQueueBytes?: number; store?: FakeStore; listeners?: DurableLogListeners } = {},
): Harness {
  const store = options.store ?? new FakeStore();
  const result = {
    store,
    committed: [] as number[],
    saveErrors: [] as { code: string; retrying: boolean }[],
    statuses: [] as PersistenceStatus[],
    fatals: [] as FatalReason[],
    idles: [] as number[],
    positions: [] as number[],
  };
  const log = new DurableLog({
    documentId: 'doc',
    generation: 1,
    headSeq: store.headSeq,
    store,
    maxQueueBytes: options.maxQueueBytes ?? 1024 * 1024,
    retry: { baseMs: 5, maxMs: 20 },
    random: () => 1,
    listeners: {
      committed: (position) => result.committed.push(position),
      saveError: (info) => result.saveErrors.push(info),
      persistence: (status) => result.statuses.push(status),
      fatal: (reason) => result.fatals.push(reason),
      idle: () => {
        result.idles.push(Date.now());
      },
      ...options.listeners,
    },
  });
  const doc = new Y.Doc();
  // Same wiring as the collaboration server: enqueue synchronously in the update event.
  doc.on('update', (update: Uint8Array) => {
    result.positions.push(log.enqueue(update));
  });
  return { ...result, log, doc, text: doc.getText('t') };
}

const content = (doc: Y.Doc) => doc.getText('t').toString();

describe('DurableLog: ordering and group commit', () => {
  it('commits updates in apply order with gap-free sequence numbers', async () => {
    const h = harness();
    for (let i = 0; i < 20; i += 1) {
      h.text.insert(h.text.length, `line ${i}\n`);
      // Spread over several event-loop turns so more than one batch is written.
      if (i % 5 === 4) await new Promise((resolve) => setImmediate(resolve));
    }
    expect(await h.log.flush(2_000)).toBe(true);

    expect(h.positions).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(h.store.rows.map((row) => row.seq)).toEqual(
      Array.from({ length: h.store.rows.length }, (_, index) => index + 1),
    );
    expect(h.log.headSeq).toBe(h.store.headSeq);
    expect(h.log.committed).toBe(20);
    expect(h.log.tail).toBe(20);
    expect(h.log.hasUncommitted()).toBe(false);
    // Acknowledged positions only ever move forward.
    expect(h.committed).toEqual([...h.committed].sort((a, b) => a - b));
    expect(h.committed.at(-1)).toBe(20);
    expect(content(h.store.rebuild())).toBe(content(h.doc));
  });

  it('writes everything queued in one event-loop turn as a single batch', async () => {
    const h = harness();
    h.text.insert(0, 'a');
    h.text.insert(1, 'b');
    h.text.insert(2, 'c');
    expect(h.log.committed).toBe(0);
    expect(await h.log.flush(2_000)).toBe(true);
    expect(h.store.appendCalls).toBe(1);
    expect(h.store.rows).toHaveLength(1);
    expect(h.committed).toEqual([3]);
    expect(content(h.store.rebuild())).toBe('abc');
  });

  it('batches updates that arrive while a commit is in flight', async () => {
    const h = harness();
    const first = gate();
    h.store.appendGate = first.promise;
    h.text.insert(0, 'first ');
    await until(() => h.store.appendCalls === 1);
    // Five more edits while the first transaction has not returned yet.
    for (const word of ['a', 'b', 'c', 'd', 'e']) h.text.insert(h.text.length, word);
    expect(h.log.committed).toBe(0);
    h.store.appendGate = null;
    first.open();
    expect(await h.log.flush(2_000)).toBe(true);

    expect(h.store.appendCalls).toBe(2);
    expect(h.store.rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(h.committed).toEqual([1, 6]);
    expect(content(h.store.rebuild())).toBe('first abcde');
  });

  it('persists a deletion-only update', async () => {
    const h = harness();
    h.text.insert(0, 'keep remove keep');
    expect(await h.log.flush(2_000)).toBe(true);
    const vectorBefore = Y.encodeStateVector(h.doc);
    h.text.delete(5, 7);
    // A deletion does not advance the state vector, yet it is a queued update.
    expect(Y.encodeStateVector(h.doc)).toEqual(vectorBefore);
    expect(h.log.tail).toBe(2);
    expect(await h.log.flush(2_000)).toBe(true);
    expect(h.committed.at(-1)).toBe(2);
    expect(content(h.store.rebuild())).toBe('keep keep');
  });
});

describe('DurableLog: failures', () => {
  it('never acknowledges a failed commit, retries, then acknowledges', async () => {
    const h = harness();
    h.store.failNextAppends = 3;
    h.text.insert(0, 'important');

    await until(() => h.saveErrors.length >= 1);
    expect(h.committed).toEqual([]);
    expect(h.log.committed).toBe(0);
    expect(h.log.failing).toBe(true);
    expect(h.log.busy).toBe(true);
    expect(h.statuses.at(-1)).toEqual({ state: 'degraded', acceptingEdits: true });
    expect(h.saveErrors[0]).toEqual({ code: 'storage_unavailable', retrying: true });

    expect(await h.log.flush(2_000)).toBe(true);
    expect(h.store.appendCalls).toBe(4);
    expect(h.saveErrors).toHaveLength(3);
    // Acknowledged exactly once, after the attempt that really committed.
    expect(h.committed).toEqual([1]);
    expect(h.log.failing).toBe(false);
    expect(h.statuses.at(-1)).toEqual({ state: 'ok', acceptingEdits: true });
    // The batch was kept, not duplicated.
    expect(h.store.rows).toHaveLength(1);
    expect(content(h.store.rebuild())).toBe('important');
  });

  it('keeps edits made during an outage in order behind the failed batch', async () => {
    const h = harness();
    h.store.failNextAppends = 2;
    h.text.insert(0, 'one ');
    await until(() => h.saveErrors.length >= 1);
    h.text.insert(h.text.length, 'two ');
    h.text.insert(h.text.length, 'three');
    expect(h.log.committed).toBe(0);
    expect(await h.log.flush(2_000)).toBe(true);
    expect(h.committed.at(-1)).toBe(3);
    expect(h.store.rows.map((row) => row.seq)).toEqual(h.store.rows.map((_, index) => index + 1));
    expect(content(h.store.rebuild())).toBe('one two three');
  });

  it('backs off between attempts and caps the delay', async () => {
    const h = harness();
    h.store.failNextAppends = 4;
    const started = performance.now();
    h.text.insert(0, 'x');
    expect(await h.log.flush(5_000)).toBe(true);
    const elapsed = performance.now() - started;
    // random() is pinned to 1: delays are 5, 10, 20, 20 ms (capped at maxMs).
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(1_500);
    expect(h.store.appendCalls).toBe(5);
  });

  it('skips the backoff when asked to retry now', async () => {
    const store = new FakeStore();
    const committed: number[] = [];
    const log = new DurableLog({
      documentId: 'doc',
      generation: 1,
      headSeq: 0,
      store,
      maxQueueBytes: 1024,
      retry: { baseMs: 60_000, maxMs: 60_000 },
      listeners: { committed: (position) => committed.push(position) },
    });
    store.failNextAppends = 1;
    log.enqueue(new Uint8Array([0, 0]));
    await until(() => log.failing);
    log.retryNow();
    await until(() => committed.length === 1);
    expect(committed).toEqual([1]);
    log.close();
  });
});

describe('DurableLog: bounded queue', () => {
  it('stops accepting edits when the queue is full and recovers after draining', async () => {
    const h = harness({ maxQueueBytes: 400 });
    const hold = gate();
    h.store.appendGate = hold.promise;
    h.text.insert(0, 'x');
    await until(() => h.store.appendCalls === 1);

    let inserted = 1;
    while (h.log.acceptingEdits) {
      h.text.insert(h.text.length, 'payload '.repeat(4));
      inserted += 1;
      if (inserted > 200) throw new Error('queue never reported full');
    }
    expect(h.log.pendingBytes).toBeGreaterThan(400);
    expect(h.statuses.at(-1)).toEqual({ state: 'degraded', acceptingEdits: false });
    // Nothing that was applied is ever dropped, even past the limit.
    h.text.insert(h.text.length, ' tail');
    expect(h.log.tail).toBe(inserted + 1);
    expect(h.committed).toEqual([]);

    h.store.appendGate = null;
    hold.open();
    expect(await h.log.flush(2_000)).toBe(true);
    expect(h.log.acceptingEdits).toBe(true);
    expect(h.statuses.at(-1)).toEqual({ state: 'ok', acceptingEdits: true });
    expect(h.log.committed).toBe(inserted + 1);
    expect(content(h.store.rebuild())).toBe(content(h.doc));
  });
});

describe('DurableLog: compaction', () => {
  it('stores the state at the head sequence and deletes only rows up to it', async () => {
    const h = harness();
    h.text.insert(0, 'alpha ');
    await new Promise((resolve) => setImmediate(resolve));
    h.text.insert(h.text.length, 'beta ');
    expect(await h.log.flush(2_000)).toBe(true);
    expect(h.store.rows).toHaveLength(2);
    expect(h.log.rowsSinceCompaction).toBe(2);

    const hold = gate();
    h.store.compactGate = hold.promise;
    h.log.requestCompaction(() => Y.encodeStateAsUpdate(h.doc));
    await until(() => h.store.compactCalls === 1);
    // An edit that arrives while the compaction transaction is in flight …
    h.text.insert(h.text.length, 'gamma');
    expect(h.log.busy).toBe(true);
    h.store.compactGate = null;
    hold.open();
    expect(await h.log.flush(2_000)).toBe(true);

    // … is committed after the boundary and is still in the log.
    expect(h.store.compacted?.uptoSeq).toBe(2);
    expect(h.store.rows.map((row) => row.seq)).toEqual([3]);
    expect(h.log.rowsSinceCompaction).toBe(1);
    const compactedOnly = new Y.Doc();
    Y.applyUpdate(compactedOnly, h.store.compacted?.state ?? new Uint8Array());
    expect(content(compactedOnly)).toBe('alpha beta ');
    expect(content(h.store.rebuild())).toBe('alpha beta gamma');
  });

  it('waits for the queue to drain so the state matches the boundary exactly', async () => {
    const h = harness();
    const hold = gate();
    h.store.appendGate = hold.promise;
    h.text.insert(0, 'queued');
    await until(() => h.store.appendCalls === 1);
    h.log.requestCompaction(() => Y.encodeStateAsUpdate(h.doc));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.store.compactCalls).toBe(0);
    h.store.appendGate = null;
    hold.open();
    expect(await h.log.flush(2_000)).toBe(true);
    expect(h.store.compacted?.uptoSeq).toBe(1);
    expect(h.store.rows).toEqual([]);
    expect(content(h.store.rebuild())).toBe('queued');
  });

  it('survives a failed compaction without losing the log', async () => {
    const h = harness();
    h.text.insert(0, 'safe');
    expect(await h.log.flush(2_000)).toBe(true);
    h.store.failNextCompactions = 1;
    h.log.requestCompaction(() => Y.encodeStateAsUpdate(h.doc));
    expect(await h.log.flush(2_000)).toBe(true);
    expect(h.store.compacted).toBeNull();
    expect(h.store.rows).toHaveLength(1);
    expect(h.fatals).toEqual([]);
    expect(content(h.store.rebuild())).toBe('safe');
  });
});

describe('DurableLog: generation and sequence guards', () => {
  it('never commits after the document moved to another generation', async () => {
    const h = harness();
    h.text.insert(0, 'old generation');
    expect(await h.log.flush(2_000)).toBe(true);
    // A snapshot restore happened: the store is now at generation 2.
    h.store.generation = 2;
    h.store.headSeq = 0;
    h.store.rows = [];
    h.text.insert(0, 'stale edit ');
    await until(() => h.fatals.length === 1);

    expect(h.fatals).toEqual(['generation_changed']);
    expect(h.store.rows).toEqual([]);
    expect(h.committed).toEqual([1]);
    expect(h.log.fatalReason).toBe('generation_changed');
    expect(h.log.acceptingEdits).toBe(false);
    expect(h.log.busy).toBe(false);
    expect(await h.log.flush(100)).toBe(false);
    // Later updates are ignored, not queued.
    h.text.insert(0, 'more ');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.store.rows).toEqual([]);
    expect(h.store.appendCalls).toBe(2);
  });

  it('stops when another writer advanced the log', async () => {
    const h = harness();
    h.text.insert(0, 'mine');
    expect(await h.log.flush(2_000)).toBe(true);
    h.store.headSeq += 1; // somebody else appended
    h.text.insert(0, 'conflicting ');
    await until(() => h.fatals.length === 1);
    expect(h.fatals).toEqual(['sequence_conflict']);
    expect(h.store.rows).toHaveLength(1);
  });

  it('refuses to compact across a generation change', async () => {
    const h = harness();
    h.text.insert(0, 'content');
    expect(await h.log.flush(2_000)).toBe(true);
    h.store.generation = 2;
    h.log.requestCompaction(() => Y.encodeStateAsUpdate(h.doc));
    await until(() => h.fatals.length === 1);
    expect(h.fatals).toEqual(['generation_changed']);
    expect(h.store.compacted).toBeNull();
    expect(h.store.rows).toHaveLength(1);
  });

  it('can be failed from outside and then drops what was queued', async () => {
    const h = harness();
    const hold = gate();
    h.store.appendGate = hold.promise;
    h.text.insert(0, 'in flight');
    await until(() => h.store.appendCalls === 1);
    h.text.insert(0, 'queued ');
    h.log.fail('read_only_origin');
    expect(h.fatals).toEqual(['read_only_origin']);
    expect(h.log.hasUncommitted()).toBe(false);
    h.store.appendGate = null;
    hold.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The in-flight commit may land, but nothing is acknowledged or written afterwards.
    expect(h.committed).toEqual([]);
    expect(h.store.appendCalls).toBe(1);
  });
});

describe('DurableLog: idle signalling', () => {
  it('reports idle after the last commit and flush resolves immediately when idle', async () => {
    const h = harness();
    expect(await h.log.flush(10)).toBe(true);
    h.text.insert(0, 'x');
    expect(h.log.busy).toBe(true);
    await until(() => h.idles.length === 1);
    expect(h.log.busy).toBe(false);
    expect(await h.log.flush(10)).toBe(true);
  });

  it('flush gives up after its timeout while storage is down', async () => {
    const h = harness();
    h.store.failNextAppends = Number.MAX_SAFE_INTEGER;
    h.text.insert(0, 'x');
    expect(await h.log.flush(60)).toBe(false);
    expect(h.log.hasUncommitted()).toBe(true);
    h.log.close();
  });
});
