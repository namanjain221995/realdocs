/**
 * Writes the Yjs updates of one `(account, document, generation)` partition
 * to the device store.
 *
 * Updates are appended in the order they were applied (one IndexedDB
 * transaction per microtask batch, so typing never waits for storage) and are
 * periodically replaced by a single merged update. Storage failures are
 * swallowed: local persistence is a recovery aid and must never break editing.
 */
import type { EffectiveRole } from '@realtimedocs/contracts';
import { registerWriter, type AccountStore, type DocPointer } from './localStore';

/** Compact after this many appended rows … */
export const COMPACT_AFTER_ROWS = 200;
/** … or this many appended bytes, whichever comes first. */
export const COMPACT_AFTER_BYTES = 512 * 1024;

export interface PersistenceInit {
  accountId: string;
  documentId: string;
  generation: number;
  dirty: boolean;
  role: EffectiveRole | null;
  title: string | null;
  /** Number of rows already stored for the partition (0 for a new one). */
  storedRows: number;
  /** Full state of the live document, used for compaction. */
  encodeState: () => Uint8Array;
}

export class DocPersistence {
  readonly generation: number;
  private readonly store: AccountStore;
  private readonly documentId: string;
  private readonly encodeState: () => Uint8Array;
  private readonly unregister: () => void;
  private pointer: DocPointer;
  private queue: Uint8Array[] = [];
  private pointerChanged = false;
  private compactRequested = false;
  private scheduled = false;
  private rows: number;
  private bytes = 0;
  private disabled = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(store: AccountStore, init: PersistenceInit) {
    this.store = store;
    this.documentId = init.documentId;
    this.generation = init.generation;
    this.encodeState = init.encodeState;
    this.rows = init.storedRows;
    this.pointer = {
      documentId: init.documentId,
      generation: init.generation,
      dirty: init.dirty,
      role: init.role,
      title: init.title,
      updatedAt: Date.now(),
    };
    this.pointerChanged = true;
    this.unregister = registerWriter(init.accountId, this);
    this.schedule();
  }

  get title(): string | null {
    return this.pointer.title;
  }

  /** Queues one applied Yjs update (local or remote). */
  append(update: Uint8Array): void {
    if (this.disabled) return;
    this.queue.push(update);
    this.schedule();
  }

  /** Updates the pointer row (dirty flag, last known role, title). */
  setPointer(patch: Partial<Pick<DocPointer, 'dirty' | 'role' | 'title'>>): void {
    if (this.disabled) return;
    const next = { ...this.pointer, ...patch };
    if (
      next.dirty === this.pointer.dirty &&
      next.role === this.pointer.role &&
      next.title === this.pointer.title
    ) {
      return;
    }
    this.pointer = { ...next, updatedAt: Date.now() };
    this.pointerChanged = true;
    this.schedule();
  }

  /** Replaces the stored rows with the current full state at the next flush. */
  requestCompaction(): void {
    if (this.disabled) return;
    this.compactRequested = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || this.disabled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.scheduled = false;
    if (this.disabled) return;
    const updates = this.queue;
    this.queue = [];
    const pointer = this.pointerChanged ? { ...this.pointer } : undefined;
    this.pointerChanged = false;
    for (const update of updates) this.bytes += update.byteLength;
    this.rows += updates.length;
    const compact =
      this.compactRequested || this.rows >= COMPACT_AFTER_ROWS || this.bytes >= COMPACT_AFTER_BYTES;
    this.compactRequested = false;
    if (updates.length === 0 && !pointer && !compact) return;
    if (compact) {
      this.rows = 1;
      this.bytes = 0;
    }
    const { store, documentId, generation } = this;
    this.chain = this.chain
      .then(async () => {
        if (this.disabled) return;
        if (compact) {
          // The live document already contains every queued update, so the
          // merged state supersedes all rows written so far.
          await store.compact(documentId, generation, this.encodeState(), pointer);
        } else if (updates.length > 0) {
          await store.appendUpdates(documentId, generation, updates, pointer);
        } else if (pointer) {
          await store.putPointer(pointer);
        }
      })
      .catch(() => {
        // Quota or transaction failure: keep editing; the server copy and the
        // in-memory document are unaffected.
      });
  }

  /** Resolves when everything queued so far has been written (or failed). */
  whenIdle(): Promise<void> {
    if (this.scheduled) this.flush();
    return this.chain;
  }

  /** Stops writing immediately (logout, access removed). Queued data is dropped. */
  disable(): void {
    this.disabled = true;
    this.queue = [];
  }

  /** Flushes what is queued and detaches from the registry. */
  async close(): Promise<void> {
    await this.whenIdle();
    this.disabled = true;
    this.unregister();
  }

  /** Stops writing and removes the stored partition. */
  async purge(): Promise<void> {
    this.disable();
    this.unregister();
    await this.chain;
    try {
      await this.store.clearPartition(this.documentId, this.generation);
    } catch {
      // Best effort; the partition is unreachable without its pointer anyway.
    }
  }
}
