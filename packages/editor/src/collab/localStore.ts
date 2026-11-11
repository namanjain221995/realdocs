/**
 * Device-local recovery store.
 *
 * - One IndexedDB database per account (`realtimedocs-local-v1:<accountId>`),
 *   so code running for account B never opens account A's data and logout can
 *   remove everything belonging to one account.
 * - Inside it, document state is partitioned by `(documentId, generation)`:
 *   incremental Yjs updates (compacted periodically) plus a pointer row with
 *   the dirty flag ("local changes exist that the server has not acknowledged").
 * - Recovery drafts (ProseMirror JSON) live in the same account database.
 * - Share-link guests have no account id and never reach this module's
 *   persistent paths; their drafts are kept in memory for the page lifetime.
 * - If IndexedDB is missing or fails (private mode, quota, blocked), every
 *   operation degrades to an in-memory store instead of throwing.
 */
import type { EffectiveRole } from '@realtimedocs/contracts';
import { wrap, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocJSON } from '../schema';
import { isUuid, uuidv4 } from './ids';

export interface RecoveryDraft {
  id: string;
  accountId: string;
  documentId: string;
  documentTitle: string;
  generation: number;
  reason: 'generation_restored' | 'access_removed' | 'manual';
  createdAt: number;
}

export interface StoredDraft extends RecoveryDraft {
  content: DocJSON;
}

/** One row per document of an account: which generation is stored and whether it is dirty. */
export interface DocPointer {
  documentId: string;
  generation: number;
  /** Local changes exist that have not been durably acknowledged. */
  dirty: boolean;
  /** Last role the server reported (lets an offline reload stay editable). */
  role: EffectiveRole | null;
  title: string | null;
  updatedAt: number;
}

interface UpdateRow {
  doc: string;
  gen: number;
  data: Uint8Array;
}

interface LocalSchema extends DBSchema {
  updates: { key: number; value: UpdateRow; indexes: { part: [string, number] } };
  docs: { key: string; value: DocPointer };
  drafts: { key: string; value: StoredDraft };
}

const DB_VERSION = 1;
const DB_PREFIX = 'realtimedocs-local-v1:';
/** Pseudo account that owns in-memory drafts of share-link guests. */
export const GUEST_ACCOUNT = 'guest';

export function accountDatabaseName(accountId: string): string {
  return `${DB_PREFIX}${accountId}`;
}

export interface AccountStore {
  readonly persistent: boolean;
  getPointer(documentId: string): Promise<DocPointer | null>;
  putPointer(pointer: DocPointer): Promise<void>;
  loadUpdates(documentId: string, generation: number): Promise<Uint8Array[]>;
  appendUpdates(
    documentId: string,
    generation: number,
    updates: Uint8Array[],
    pointer?: DocPointer,
  ): Promise<void>;
  /** Replaces every stored update of the partition with one merged update. */
  compact(
    documentId: string,
    generation: number,
    merged: Uint8Array,
    pointer?: DocPointer,
  ): Promise<void>;
  /** Removes the updates of one partition and, if it points there, the pointer. */
  clearPartition(documentId: string, generation: number): Promise<void>;
  putDraft(draft: StoredDraft): Promise<void>;
  listDrafts(): Promise<RecoveryDraft[]>;
  getDraft(id: string): Promise<StoredDraft | null>;
  deleteDraft(id: string): Promise<void>;
  hasData(): Promise<boolean>;
  clearAll(): Promise<void>;
  close(): void;
}

function stripContent(draft: StoredDraft): RecoveryDraft {
  return {
    id: draft.id,
    accountId: draft.accountId,
    documentId: draft.documentId,
    documentTitle: draft.documentTitle,
    generation: draft.generation,
    reason: draft.reason,
    createdAt: draft.createdAt,
  };
}

// ── In-memory implementation ────────────────────────────────────────────────

interface MemoryData {
  pointers: Map<string, DocPointer>;
  updates: Map<string, Uint8Array[]>;
  drafts: Map<string, StoredDraft>;
}

const memoryAccounts = new Map<string, MemoryData>();

function memoryData(accountId: string): MemoryData {
  let data = memoryAccounts.get(accountId);
  if (!data) {
    data = { pointers: new Map(), updates: new Map(), drafts: new Map() };
    memoryAccounts.set(accountId, data);
  }
  return data;
}

function partitionKey(documentId: string, generation: number): string {
  return `${documentId}:${generation}`;
}

class MemoryAccountStore implements AccountStore {
  readonly persistent = false;
  private readonly accountId: string;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private get data(): MemoryData {
    return memoryData(this.accountId);
  }

  getPointer(documentId: string): Promise<DocPointer | null> {
    return Promise.resolve(this.data.pointers.get(documentId) ?? null);
  }

  putPointer(pointer: DocPointer): Promise<void> {
    this.data.pointers.set(pointer.documentId, { ...pointer });
    return Promise.resolve();
  }

  loadUpdates(documentId: string, generation: number): Promise<Uint8Array[]> {
    return Promise.resolve([
      ...(this.data.updates.get(partitionKey(documentId, generation)) ?? []),
    ]);
  }

  appendUpdates(
    documentId: string,
    generation: number,
    updates: Uint8Array[],
    pointer?: DocPointer,
  ): Promise<void> {
    const key = partitionKey(documentId, generation);
    const list = this.data.updates.get(key) ?? [];
    list.push(...updates);
    this.data.updates.set(key, list);
    if (pointer) this.data.pointers.set(pointer.documentId, { ...pointer });
    return Promise.resolve();
  }

  compact(
    documentId: string,
    generation: number,
    merged: Uint8Array,
    pointer?: DocPointer,
  ): Promise<void> {
    this.data.updates.set(partitionKey(documentId, generation), [merged]);
    if (pointer) this.data.pointers.set(pointer.documentId, { ...pointer });
    return Promise.resolve();
  }

  clearPartition(documentId: string, generation: number): Promise<void> {
    this.data.updates.delete(partitionKey(documentId, generation));
    if (this.data.pointers.get(documentId)?.generation === generation) {
      this.data.pointers.delete(documentId);
    }
    return Promise.resolve();
  }

  putDraft(draft: StoredDraft): Promise<void> {
    this.data.drafts.set(draft.id, draft);
    return Promise.resolve();
  }

  listDrafts(): Promise<RecoveryDraft[]> {
    return Promise.resolve(
      [...this.data.drafts.values()].map(stripContent).sort((a, b) => b.createdAt - a.createdAt),
    );
  }

  getDraft(id: string): Promise<StoredDraft | null> {
    return Promise.resolve(this.data.drafts.get(id) ?? null);
  }

  deleteDraft(id: string): Promise<void> {
    this.data.drafts.delete(id);
    return Promise.resolve();
  }

  hasData(): Promise<boolean> {
    const dirty = [...this.data.pointers.values()].some((pointer) => pointer.dirty);
    return Promise.resolve(dirty || this.data.drafts.size > 0);
  }

  clearAll(): Promise<void> {
    memoryAccounts.delete(this.accountId);
    return Promise.resolve();
  }

  close(): void {}
}

// ── IndexedDB implementation ────────────────────────────────────────────────

class IdbAccountStore implements AccountStore {
  readonly persistent = true;
  private readonly db: IDBPDatabase<LocalSchema>;

  constructor(db: IDBPDatabase<LocalSchema>) {
    this.db = db;
  }

  async getPointer(documentId: string): Promise<DocPointer | null> {
    return (await this.db.get('docs', documentId)) ?? null;
  }

  async putPointer(pointer: DocPointer): Promise<void> {
    await this.db.put('docs', pointer, pointer.documentId);
  }

  async loadUpdates(documentId: string, generation: number): Promise<Uint8Array[]> {
    // Index order is (part, primary key): rows come back in insertion order.
    const rows = await this.db.getAllFromIndex('updates', 'part', [documentId, generation]);
    return rows.map((row) => new Uint8Array(row.data));
  }

  async appendUpdates(
    documentId: string,
    generation: number,
    updates: Uint8Array[],
    pointer?: DocPointer,
  ): Promise<void> {
    const tx = this.db.transaction(['updates', 'docs'], 'readwrite');
    const store = tx.objectStore('updates');
    for (const data of updates) void store.add({ doc: documentId, gen: generation, data });
    if (pointer) void tx.objectStore('docs').put(pointer, pointer.documentId);
    await tx.done;
  }

  async compact(
    documentId: string,
    generation: number,
    merged: Uint8Array,
    pointer?: DocPointer,
  ): Promise<void> {
    const tx = this.db.transaction(['updates', 'docs'], 'readwrite');
    const store = tx.objectStore('updates');
    let cursor = await store.index('part').openCursor([documentId, generation]);
    while (cursor) {
      void cursor.delete();
      cursor = await cursor.continue();
    }
    void store.add({ doc: documentId, gen: generation, data: merged });
    if (pointer) void tx.objectStore('docs').put(pointer, pointer.documentId);
    await tx.done;
  }

  async clearPartition(documentId: string, generation: number): Promise<void> {
    const tx = this.db.transaction(['updates', 'docs'], 'readwrite');
    let cursor = await tx.objectStore('updates').index('part').openCursor([documentId, generation]);
    while (cursor) {
      void cursor.delete();
      cursor = await cursor.continue();
    }
    const docs = tx.objectStore('docs');
    const pointer = await docs.get(documentId);
    if (pointer?.generation === generation) void docs.delete(documentId);
    await tx.done;
  }

  async putDraft(draft: StoredDraft): Promise<void> {
    await this.db.put('drafts', draft, draft.id);
  }

  async listDrafts(): Promise<RecoveryDraft[]> {
    const drafts = await this.db.getAll('drafts');
    return drafts.map(stripContent).sort((a, b) => b.createdAt - a.createdAt);
  }

  async getDraft(id: string): Promise<StoredDraft | null> {
    return (await this.db.get('drafts', id)) ?? null;
  }

  async deleteDraft(id: string): Promise<void> {
    await this.db.delete('drafts', id);
  }

  async hasData(): Promise<boolean> {
    if ((await this.db.count('drafts')) > 0) return true;
    const pointers = await this.db.getAll('docs');
    return pointers.some((pointer) => pointer.dirty);
  }

  async clearAll(): Promise<void> {
    const tx = this.db.transaction(['updates', 'docs', 'drafts'], 'readwrite');
    void tx.objectStore('updates').clear();
    void tx.objectStore('docs').clear();
    void tx.objectStore('drafts').clear();
    await tx.done;
  }

  close(): void {
    this.db.close();
  }
}

// ── Factory selection ───────────────────────────────────────────────────────

let configuredFactory: IDBFactory | null | undefined;

/**
 * Overrides the IndexedDB factory used by the module-level helpers
 * (`listRecoveryDrafts`, `clearLocalDataForAccount`, …). `null` forces the
 * in-memory store; `undefined` restores the default (`globalThis.indexedDB`).
 * Intended for tests and for hosts that must disable device storage.
 */
export function configureLocalStore(options: { indexedDB?: IDBFactory | null }): void {
  configuredFactory = options.indexedDB;
}

function resolveFactory(explicit?: IDBFactory | null): IDBFactory | null {
  if (explicit !== undefined) return explicit;
  if (configuredFactory !== undefined) return configuredFactory;
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    // Some browsers throw on access when storage is blocked.
    return null;
  }
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBPDatabase<LocalSchema>> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, DB_VERSION);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('IndexedDB is not available.'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('updates')) {
        const updates = db.createObjectStore('updates', { autoIncrement: true });
        updates.createIndex('part', ['doc', 'gen'], { unique: false });
      }
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs');
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
    };
    request.onsuccess = () => {
      const raw = request.result;
      try {
        // Never block another tab (or `deleteDatabase` on logout).
        raw.onversionchange = () => raw.close();
        resolve(wrap(raw) as unknown as IDBPDatabase<LocalSchema>);
      } catch (error) {
        raw.close();
        reject(error instanceof Error ? error : new Error('IndexedDB is not usable.'));
      }
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another connection.'));
  });
}

/**
 * Opens the store of one account. Never rejects: any IndexedDB problem yields
 * the in-memory store (`persistent === false`).
 */
export async function openAccountStore(
  accountId: string,
  factory?: IDBFactory | null,
): Promise<AccountStore> {
  const resolved = accountId === GUEST_ACCOUNT ? null : resolveFactory(factory);
  if (!resolved) return new MemoryAccountStore(accountId);
  try {
    return new IdbAccountStore(await openDatabase(resolved, accountDatabaseName(accountId)));
  } catch {
    return new MemoryAccountStore(accountId);
  }
}

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = factory.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      // The stores were already emptied; a blocked delete only leaves an empty shell.
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ── Live persistence registry (so logout can stop writers first) ────────────

const liveWriters = new Map<string, Set<{ disable(): void }>>();

export function registerWriter(accountId: string, writer: { disable(): void }): () => void {
  let writers = liveWriters.get(accountId);
  if (!writers) {
    writers = new Set();
    liveWriters.set(accountId, writers);
  }
  writers.add(writer);
  return () => {
    writers.delete(writer);
    if (writers.size === 0) liveWriters.delete(accountId);
  };
}

// ── Public helpers ──────────────────────────────────────────────────────────

/** Draft ids embed their owner so they can be loaded without scanning accounts. */
export function createDraftId(accountId: string | null): string {
  return `${accountId ?? GUEST_ACCOUNT}:${uuidv4()}`;
}

function draftOwner(id: string): string | null {
  const separator = id.lastIndexOf(':');
  if (separator <= 0) return null;
  const owner = id.slice(0, separator);
  return owner === GUEST_ACCOUNT || isUuid(owner) ? owner : null;
}

async function withStore<T>(
  accountId: string,
  factory: IDBFactory | null | undefined,
  run: (store: AccountStore) => Promise<T>,
): Promise<T> {
  const store = await openAccountStore(accountId, factory);
  try {
    return await run(store);
  } finally {
    store.close();
  }
}

/**
 * Stores a draft for its owner. If the device store rejects the write (quota,
 * blocked storage) the draft is kept in memory so it is not lost while the
 * page stays open.
 */
export async function saveRecoveryDraft(
  draft: StoredDraft,
  factory?: IDBFactory | null,
): Promise<void> {
  const owner = draftOwner(draft.id) ?? GUEST_ACCOUNT;
  try {
    await withStore(owner, factory, (store) => store.putDraft(draft));
  } catch {
    memoryData(owner).drafts.set(draft.id, draft);
  }
}

function memoryDrafts(accountId: string): StoredDraft[] {
  return [...(memoryAccounts.get(accountId)?.drafts.values() ?? [])];
}

export async function listRecoveryDrafts(
  accountId: string,
  factory?: IDBFactory | null,
): Promise<RecoveryDraft[]> {
  const stored = await withStore(accountId, factory, (store) => store.listDrafts());
  const seen = new Set(stored.map((draft) => draft.id));
  const extra = memoryDrafts(accountId)
    .filter((draft) => !seen.has(draft.id))
    .map(stripContent);
  return [...stored, ...extra].sort((a, b) => b.createdAt - a.createdAt);
}

/** ProseMirror JSON of a draft, or null if it does not exist (any more). */
export async function loadRecoveryDraftJSON(
  id: string,
  factory?: IDBFactory | null,
): Promise<DocJSON | null> {
  const owner = draftOwner(id);
  if (!owner) return null;
  const inMemory = memoryAccounts.get(owner)?.drafts.get(id);
  if (inMemory) return inMemory.content;
  const draft = await withStore(owner, factory, (store) => store.getDraft(id));
  return draft?.content ?? null;
}

export async function deleteRecoveryDraft(id: string, factory?: IDBFactory | null): Promise<void> {
  const owner = draftOwner(id);
  if (!owner) return;
  memoryAccounts.get(owner)?.drafts.delete(id);
  await withStore(owner, factory, (store) => store.deleteDraft(id));
}

/** Removes pending-change stores and drafts of one account (call on logout). */
export async function clearLocalDataForAccount(
  accountId: string,
  factory?: IDBFactory | null,
): Promise<void> {
  for (const writer of liveWriters.get(accountId) ?? []) writer.disable();
  memoryAccounts.delete(accountId);
  const resolved = resolveFactory(factory);
  if (!resolved) return;
  try {
    const store = new IdbAccountStore(await openDatabase(resolved, accountDatabaseName(accountId)));
    try {
      await store.clearAll();
    } finally {
      store.close();
    }
  } catch {
    // Nothing readable is left to clear if the database cannot be opened.
  }
  await deleteDatabase(resolved, accountDatabaseName(accountId));
}

/** True if the account has unsaved local changes or drafts on this device. */
export async function hasLocalDataForAccount(
  accountId: string,
  factory?: IDBFactory | null,
): Promise<boolean> {
  const memory = memoryAccounts.get(accountId);
  if (memory && (memory.drafts.size > 0 || [...memory.pointers.values()].some((p) => p.dirty))) {
    return true;
  }
  const resolved = resolveFactory(factory);
  if (!resolved) return false;
  // Do not create an empty database just to answer "no".
  if (typeof resolved.databases === 'function') {
    try {
      const names = (await resolved.databases()).map((info) => info.name);
      if (!names.includes(accountDatabaseName(accountId))) return false;
    } catch {
      // Fall through to opening the database.
    }
  }
  return withStore(accountId, factory, (store) => store.hasData());
}
