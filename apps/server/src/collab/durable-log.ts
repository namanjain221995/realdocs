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
 * - History: every update is enqueued with the actor the server authenticated
 *   for it. A batch is committed as one merged update (as before) and, in the
 *   same store call, as one history segment per actor, so a durable update
 *   always has an attributed history row and the two can never disagree.
 */
import type { SaveErrorCode } from '@realtimedocs/contracts';
import * as Y from 'yjs';
import {
  classify,
  emptySummary,
  mergeSummaries,
  sizeDelta,
  type ChangeSummary,
  type HistoryActor,
  type OperationType,
} from './history';

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

/** What the server knows about one enqueued update. */
export interface UpdateMeta {
  actor: HistoryActor;
  summary: ChangeSummary;
  /** Informational, untrusted. */
  clientOccurredAt?: Date | null;
}

/** The part of a committed batch that one actor produced. */
export interface HistorySegment {
  actor: HistoryActor;
  operationType: OperationType;
  summary: ChangeSummary;
  contentSizeDelta: number;
  attachmentIds: string[];
  /** Server clock when the first update of the segment was applied. */
  receivedAt: Date;
  clientOccurredAt: Date | null;
  update: Uint8Array;
}

/** A complete state stored in the history (start of a generation, then periodically). */
export interface HistoryCheckpoint {
  operationType: 'baseline' | 'checkpoint';
  attachmentIds: string[];
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
    /** Attributed parts of `update`; absent when history is not recorded. */
    history?: HistorySegment[];
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
    /** Also store `state` as a history checkpoint at `uptoSeq`. */
    checkpoint?: HistoryCheckpoint;
  }): Promise<void>;
  /**
   * Stores `state` (the state at `headSeq`) as the first history checkpoint of
   * the generation unless one exists. Optional: stores without history omit it.
   */
  baseline?(input: {
    documentId: string;
    generation: number;
    headSeq: number;
    state: Uint8Array;
    attachmentIds: string[];
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
  /** Duration of a successful store call, for metrics. */
  timing?: (phase: 'append' | 'compact', milliseconds: number) => void;
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
  /**
   * History recording. `baseline` is the complete state at `headSeq` when the
   * generation has no checkpoint yet (written before the first batch);
   * `checkpointEvery` is the number of history rows after which a compaction
   * also stores a checkpoint; `assetIds` lists the assets of the current state.
   */
  history?: {
    baseline: { state: Uint8Array; attachmentIds: string[] } | null;
    rowsSinceCheckpoint: number;
    checkpointEvery: number;
    assetIds: () => string[];
  };
}

interface QueueEntry {
  position: number;
  update: Uint8Array;
  meta: UpdateMeta | null;
  receivedAt: Date;
}

/** Actors are compared by connection: one person in two windows is two segments. */
function actorKey(actor: HistoryActor): string {
  return `${actor.kind}:${actor.connectionId ?? ''}:${actor.sessionId ?? ''}:${actor.userId ?? ''}:${actor.grantId ?? ''}`;
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

  private readonly history: DurableLogOptions['history'] | null;
  private baseline: { state: Uint8Array; attachmentIds: string[] } | null;
  private rowsSinceCheckpoint: number;

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
    this.history = options.history ?? null;
    this.baseline = options.history?.baseline ?? null;
    this.rowsSinceCheckpoint = options.history?.rowsSinceCheckpoint ?? 0;
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
  enqueue(update: Uint8Array, meta: UpdateMeta | null = null): number {
    if (this.fatalReasonValue !== null || this.closed) return this.tailPosition;
    this.tailPosition += 1;
    this.queue.push({ position: this.tailPosition, update, meta, receivedAt: new Date() });
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
        if (this.baseline !== null && this.queue.length > 0) {
          // First change of a generation without history: record where it started.
          if (!(await this.writeBaseline())) continue;
        }
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
    const history = this.history ? this.segments(batch) : undefined;
    const started = performance.now();
    try {
      const seq = await this.store.append({
        documentId: this.documentId,
        generation: this.generation,
        expectedHeadSeq: this.headSeqValue,
        update,
        history,
      });
      this.listeners.timing?.('append', performance.now() - started);
      if (this.fatalReasonValue !== null) return;
      this.headSeqValue = seq;
      this.rowsSinceCompactionValue += 1;
      this.rowsSinceCheckpoint += history?.length ?? 0;
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

  /** One history segment per actor, in the order the actors first appear in the batch. */
  private segments(batch: QueueEntry[]): HistorySegment[] {
    const groups = new Map<string, QueueEntry[]>();
    for (const entry of batch) {
      const key = entry.meta ? actorKey(entry.meta.actor) : 'system';
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    }
    const segments: HistorySegment[] = [];
    for (const group of groups.values()) {
      const first = group[0];
      if (!first) continue;
      let update: Uint8Array;
      try {
        update =
          group.length > 1 ? Y.mergeUpdates(group.map((entry) => entry.update)) : first.update;
      } catch {
        // `writeBatch` only reaches here with updates it could merge as a whole.
        update = first.update;
      }
      const summary = emptySummary();
      for (const entry of group) if (entry.meta) mergeSummaries(summary, entry.meta.summary);
      if (summary.transactions === 0) summary.transactions = group.length;
      segments.push({
        actor: first.meta?.actor ?? {
          kind: 'system',
          userId: null,
          grantId: null,
          name: 'System',
          participantRole: null,
          sessionId: null,
          connectionId: null,
          clientId: null,
        },
        operationType: classify(summary),
        summary,
        contentSizeDelta: sizeDelta(summary),
        attachmentIds: summary.attachmentsAdded,
        receivedAt: first.receivedAt,
        clientOccurredAt: first.meta?.clientOccurredAt ?? null,
        update,
      });
    }
    return segments;
  }

  /** Returns false when the write failed and was backed off (the caller loops). */
  private async writeBaseline(): Promise<boolean> {
    const baseline = this.baseline;
    if (!baseline || !this.store.baseline) {
      this.baseline = null;
      return true;
    }
    try {
      await this.store.baseline({
        documentId: this.documentId,
        generation: this.generation,
        headSeq: this.headSeqValue,
        state: baseline.state,
        attachmentIds: baseline.attachmentIds,
      });
      this.baseline = null;
      return true;
    } catch (error) {
      if (this.fatalReasonValue !== null || this.closed) return false;
      if (error instanceof GenerationMismatchError) {
        this.fail('generation_changed');
        return false;
      }
      if (error instanceof SequenceConflictError) {
        this.fail('sequence_conflict');
        return false;
      }
      this.failures += 1;
      this.listeners.error?.(error, 'append');
      this.listeners.saveError?.({ code: 'storage_unavailable', retrying: true });
      this.publishStatus();
      await this.backoff();
      return false;
    }
  }

  private async compactNow(): Promise<void> {
    const getState = this.compactionState;
    if (!getState) return;
    this.compactionState = null;
    // No awaits between reading the state and the head sequence: the queue is
    // empty, so the encoded state contains exactly the updates <= headSeq.
    const uptoSeq = this.headSeqValue;
    const started = performance.now();
    try {
      const state = getState();
      const checkpoint: HistoryCheckpoint | undefined =
        this.history &&
        this.baseline === null &&
        this.rowsSinceCheckpoint >= this.history.checkpointEvery
          ? { operationType: 'checkpoint', attachmentIds: this.history.assetIds() }
          : undefined;
      await this.store.compact({
        documentId: this.documentId,
        generation: this.generation,
        uptoSeq,
        state,
        checkpoint,
      });
      this.listeners.timing?.('compact', performance.now() - started);
      this.rowsSinceCompactionValue = 0;
      if (checkpoint) this.rowsSinceCheckpoint = 0;
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
