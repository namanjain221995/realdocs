/**
 * Durable update log of one loaded document (docs/architecture.md §5.3).
 *
 * - `enqueue` is called synchronously from the Yjs `update` event and assigns
 *   every update a queue position.
 * - A single-flight writer takes everything queued (group commit), merges it
 *   and hands it to the store, which commits it as `seq = head_seq + 1` in
 *   one transaction. Positions therefore become durable strictly in order.
 * - A failed commit keeps the batch at the head of the queue, reports
 *   `save-error` and retries with capped exponential backoff and jitter.
 *   `committed` only advances after a commit really succeeded.
 * - The queue is bounded: past `maxQueueBytes` the document stops accepting
 *   edits until the backlog has drained.
 * - Compaction runs inside the same writer, only while the queue is empty, so
 *   the stored state corresponds exactly to `upto_seq = head_seq`.
 */
import type { SaveErrorCode } from '@realtimedocs/contracts';
import * as Y from 'yjs';

/** The document moved to another generation; nothing from this log may commit any more. */
export class GenerationMismatchError extends Error {
  constructor(message = 'document generation changed') {
    super(message);
    this.name = 'GenerationMismatchError';
  }
}

/** Another writer advanced the log; the in-memory document is stale. */
export class SequenceConflictError extends Error {
  constructor(message = 'update log advanced by another writer') {
    super(message);
    this.name = 'SequenceConflictError';
  }
}

export interface LogStore {
  /**
   * Commits `update` as sequence `expectedHeadSeq + 1` of the generation and
   * returns the new head sequence. Must throw `GenerationMismatchError` or
   * `SequenceConflictError` when the document row does not match.
   */
  append(input: {
    documentId: string;
    generation: number;
    expectedHeadSeq: number;
    update: Uint8Array;
  }): Promise<number>;
  /**
   * Stores `state` as the compacted state covering every update with
   * `seq <= uptoSeq` and deletes exactly those log rows.
   */
  compact(input: {
    documentId: string;
    generation: number;
    uptoSeq: number;
    state: Uint8Array;
  }): Promise<void>;
}

export type FatalReason = 'generation_changed' | 'sequence_conflict' | 'read_only_origin';

export interface PersistenceStatus {
  state: 'ok' | 'degraded';
  acceptingEdits: boolean;
}

export interface DurableLogListeners {
  /** Everything up to and including `position` is committed. */
  committed?: (position: number) => void;
  /** A commit attempt failed; the batch is kept and will be retried. */
  saveError?: (info: { code: SaveErrorCode; retrying: boolean }) => void;
  persistence?: (status: PersistenceStatus) => void;
  /** The log can never commit again; the in-memory document must be dropped. */
  fatal?: (reason: FatalReason) => void;
  /** Nothing is queued, being written or waiting for compaction. */
  idle?: () => void;
  /** Diagnostics for logging. Never receives update bytes. */
  error?: (error: unknown, phase: 'append' | 'compact') => void;
}

export interface DurableLogOptions {
  documentId: string;
  generation: number;
  /** `documents.head_seq` as read together with the loaded state. */
  headSeq: number;
  /** Log rows not yet folded into the compacted state (`head_seq - upto_seq`). */
  rowsSinceCompaction?: number;
  store: LogStore;
  maxQueueBytes: number;
  retry?: { baseMs: number; maxMs: number };
  listeners?: DurableLogListeners;
  /** Injectable for tests. */
  random?: () => number;
}

interface QueueEntry {
  position: number;
  update: Uint8Array;
}

const DEFAULT_RETRY = { baseMs: 250, maxMs: 5_000 };

export class DurableLog {
  readonly documentId: string;
  readonly generation: number;

  private readonly store: LogStore;
  private readonly maxQueueBytes: number;
  private readonly retry: { baseMs: number; maxMs: number };
  private readonly listeners: DurableLogListeners;
  private readonly random: () => number;

  private queue: QueueEntry[] = [];
  private queuedBytes = 0;
  private tailPosition = 0;
  private committedPosition = 0;
  private headSeqValue: number;
  private rowsSinceCompactionValue: number;

  private writing = false;
  private scheduled = false;
  private failures = 0;
  private accepting = true;
  private lastStatus: PersistenceStatus = { state: 'ok', acceptingEdits: true };
  private fatalReasonValue: FatalReason | null = null;
  private closed = false;

  private compactionState: (() => Uint8Array) | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryWake: (() => void) | null = null;
  private idleWaiters: (() => void)[] = [];

  constructor(options: DurableLogOptions) {
    this.documentId = options.documentId;
    this.generation = options.generation;
    this.headSeqValue = options.headSeq;
    this.rowsSinceCompactionValue = options.rowsSinceCompaction ?? 0;
    this.store = options.store;
    this.maxQueueBytes = options.maxQueueBytes;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.listeners = options.listeners ?? {};
    this.random = options.random ?? Math.random;
  }

  /** Position of the most recently enqueued update (0 when nothing was enqueued). */
  get tail(): number {
    return this.tailPosition;
  }

  /** Highest position known to be committed to durable storage. */
  get committed(): number {
    return this.committedPosition;
  }

  get headSeq(): number {
    return this.headSeqValue;
  }

  get rowsSinceCompaction(): number {
    return this.rowsSinceCompactionValue;
  }

  get pendingBytes(): number {
    return this.queuedBytes;
  }

  get acceptingEdits(): boolean {
    return this.accepting && this.fatalReasonValue === null;
  }

  /** True while the most recent commit attempt failed and a retry is pending. */
  get failing(): boolean {
    return this.failures > 0;
  }

  get fatalReason(): FatalReason | null {
    return this.fatalReasonValue;
  }

  get status(): PersistenceStatus {
    return this.lastStatus;
  }

  /** True while uncommitted updates exist or a compaction is outstanding. */
  get busy(): boolean {
    if (this.fatalReasonValue !== null || this.closed) return false;
    return this.queue.length > 0 || this.writing || this.compactionState !== null;
  }

  hasUncommitted(): boolean {
    return this.fatalReasonValue === null && this.committedPosition < this.tailPosition;
  }

  /**
   * Appends an update to the ordered queue. Synchronous on purpose: it runs
   * inside the Yjs `update` event, so queue order equals apply order.
   */
  enqueue(update: Uint8Array): number {
    if (this.fatalReasonValue !== null || this.closed) return this.tailPosition;
    this.tailPosition += 1;
    this.queue.push({ position: this.tailPosition, update });
    this.queuedBytes += update.byteLength;
    if (this.accepting && this.queuedBytes > this.maxQueueBytes) {
      this.accepting = false;
      this.publishStatus();
    }
    this.schedule();
    return this.tailPosition;
  }

  /**
   * Asks the writer to compact once the queue is empty. `getState` is called
   * at that moment and must return the full encoded in-memory state.
   */
  requestCompaction(getState: () => Uint8Array): void {
    if (this.fatalReasonValue !== null || this.closed) return;
    this.compactionState = getState;
    this.schedule();
  }

  /** Stops the log permanently: nothing queued here may commit any more. */
  fail(reason: FatalReason): void {
    if (this.fatalReasonValue !== null) return;
    this.fatalReasonValue = reason;
    this.queue = [];
    this.queuedBytes = 0;
    this.compactionState = null;
    this.wakeRetry();
    this.listeners.fatal?.(reason);
    this.publishStatus();
    this.resolveIdle();
  }

  /** Skips the current backoff delay (used when storage is known to be back). */
  retryNow(): void {
    this.wakeRetry();
  }

  /**
   * Resolves `true` once nothing is queued or being written, `false` when
   * that did not happen within `timeoutMs` or the log failed permanently.
   */
  async flush(timeoutMs: number): Promise<boolean> {
    if (this.fatalReasonValue !== null) return false;
    if (!this.busy) return true;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const idle = new Promise<boolean>((resolve) => {
      this.idleWaiters.push(() => resolve(this.fatalReasonValue === null));
    });
    try {
      return await Promise.race([idle, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.closed = true;
    this.wakeRetry();
    this.resolveIdle();
  }

  private schedule(): void {
    if (this.writing || this.scheduled) return;
    this.scheduled = true;
    // Group commit without artificial delay: everything applied in the current
    // event-loop turn ends up in the same batch.
    setImmediate(() => {
      this.scheduled = false;
      if (this.writing) return;
      this.writing = true;
      void this.run();
    });
  }

  private async run(): Promise<void> {
    try {
      while (!this.closed && this.fatalReasonValue === null) {
        if (this.queue.length > 0) {
          await this.writeBatch();
        } else if (this.compactionState !== null) {
          await this.compactNow();
        } else {
          break;
        }
      }
    } finally {
      this.writing = false;
      if (!this.busy) {
        this.resolveIdle();
        if (this.fatalReasonValue === null && !this.closed) this.listeners.idle?.();
      }
    }
  }

  private async writeBatch(): Promise<void> {
    let batch = this.queue.slice();
    let update: Uint8Array | undefined;
    if (batch.length > 1) {
      try {
        update = Y.mergeUpdates(batch.map((entry) => entry.update));
      } catch (error) {
        // Never let one unmergeable update block the log: commit them one by one.
        this.listeners.error?.(error, 'append');
        batch = batch.slice(0, 1);
      }
    }
    const last = batch[batch.length - 1];
    if (!last) return;
    update ??= last.update;
    try {
      const seq = await this.store.append({
        documentId: this.documentId,
        generation: this.generation,
        expectedHeadSeq: this.headSeqValue,
        update,
      });
      if (this.fatalReasonValue !== null) return;
      this.headSeqValue = seq;
      this.rowsSinceCompactionValue += 1;
      this.queue.splice(0, batch.length);
      for (const entry of batch) this.queuedBytes -= entry.update.byteLength;
      this.committedPosition = last.position;
      this.failures = 0;
      if (!this.accepting && this.queuedBytes <= this.maxQueueBytes / 2) this.accepting = true;
      this.listeners.committed?.(this.committedPosition);
      this.publishStatus();
    } catch (error) {
      if (this.fatalReasonValue !== null || this.closed) return;
      if (error instanceof GenerationMismatchError) {
        this.fail('generation_changed');
        return;
      }
      if (error instanceof SequenceConflictError) {
        this.fail('sequence_conflict');
        return;
      }
      this.failures += 1;
      this.listeners.error?.(error, 'append');
      this.listeners.saveError?.({ code: 'storage_unavailable', retrying: true });
      this.publishStatus();
      await this.backoff();
    }
  }

  private async compactNow(): Promise<void> {
    const getState = this.compactionState;
    if (!getState) return;
    this.compactionState = null;
    // No awaits between reading the state and the head sequence: the queue is
    // empty, so the encoded state contains exactly the updates <= headSeq.
    const uptoSeq = this.headSeqValue;
    try {
      const state = getState();
      await this.store.compact({
        documentId: this.documentId,
        generation: this.generation,
        uptoSeq,
        state,
      });
      this.rowsSinceCompactionValue = 0;
    } catch (error) {
      if (this.fatalReasonValue !== null || this.closed) return;
      if (error instanceof GenerationMismatchError) {
        this.fail('generation_changed');
        return;
      }
      if (error instanceof SequenceConflictError) {
        this.fail('sequence_conflict');
        return;
      }
      // Compaction is an optimisation: the log itself stays intact. A later
      // store hook asks again.
      this.listeners.error?.(error, 'compact');
    }
  }

  private backoff(): Promise<void> {
    const exponent = Math.min(this.failures - 1, 20);
    const capped = Math.min(this.retry.maxMs, this.retry.baseMs * 2 ** exponent);
    const delay = Math.round(capped * (0.5 + this.random() * 0.5));
    return new Promise<void>((resolve) => {
      const done = () => {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.retryWake = null;
        resolve();
      };
      this.retryWake = done;
      this.retryTimer = setTimeout(done, delay);
    });
  }

  private wakeRetry(): void {
    this.retryWake?.();
  }

  private publishStatus(): void {
    const next: PersistenceStatus =
      this.fatalReasonValue !== null
        ? { state: 'degraded', acceptingEdits: false }
        : {
            state: this.failures > 0 || !this.accepting ? 'degraded' : 'ok',
            acceptingEdits: this.accepting,
          };
    if (
      next.state === this.lastStatus.state &&
      next.acceptingEdits === this.lastStatus.acceptingEdits
    ) {
      return;
    }
    this.lastStatus = next;
    this.listeners.persistence?.(next);
  }

  private resolveIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }
}
