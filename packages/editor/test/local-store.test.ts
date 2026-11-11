// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isUuid, uuidv4 } from '../src/collab/ids';
import {
  accountDatabaseName,
  clearLocalDataForAccount,
  createDraftId,
  deleteRecoveryDraft,
  hasLocalDataForAccount,
  listRecoveryDrafts,
  loadRecoveryDraftJSON,
  openAccountStore,
  saveRecoveryDraft,
  type StoredDraft,
} from '../src/collab/localStore';
import { COMPACT_AFTER_ROWS, DocPersistence } from '../src/collab/persistence';
import { paragraphDoc } from './helpers';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const DOC_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOC_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let idb: IDBFactory;

beforeEach(() => {
  idb = new IDBFactory();
});

function draft(accountId: string, patch: Partial<StoredDraft> = {}): StoredDraft {
  return {
    id: createDraftId(accountId),
    accountId,
    documentId: DOC_1,
    documentTitle: 'Notes',
    generation: 1,
    reason: 'generation_restored',
    createdAt: Date.now(),
    content: paragraphDoc('draft text'),
    ...patch,
  };
}

describe('ids', () => {
  it('creates RFC 4122 v4 identifiers', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidv4()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe('4');
      expect('89ab').toContain(id[19]);
    }
  });
});

describe('account store partitioning', () => {
  it('partitions updates by account, document and generation', async () => {
    const a = await openAccountStore(ACCOUNT_A, idb);
    const b = await openAccountStore(ACCOUNT_B, idb);
    expect(a.persistent).toBe(true);
    await a.appendUpdates(DOC_1, 1, [new Uint8Array([1]), new Uint8Array([2])]);
    await a.appendUpdates(DOC_1, 2, [new Uint8Array([3])]);
    await a.appendUpdates(DOC_2, 1, [new Uint8Array([4])]);
    await b.appendUpdates(DOC_1, 1, [new Uint8Array([9])]);

    expect((await a.loadUpdates(DOC_1, 1)).map((u) => [...u])).toEqual([[1], [2]]);
    expect((await a.loadUpdates(DOC_1, 2)).map((u) => [...u])).toEqual([[3]]);
    expect((await a.loadUpdates(DOC_2, 1)).map((u) => [...u])).toEqual([[4]]);
    expect((await b.loadUpdates(DOC_1, 1)).map((u) => [...u])).toEqual([[9]]);
    expect(await b.loadUpdates(DOC_2, 1)).toEqual([]);

    await a.clearPartition(DOC_1, 1);
    expect(await a.loadUpdates(DOC_1, 1)).toEqual([]);
    expect((await a.loadUpdates(DOC_1, 2)).map((u) => [...u])).toEqual([[3]]);
    expect((await b.loadUpdates(DOC_1, 1)).map((u) => [...u])).toEqual([[9]]);
    a.close();
    b.close();
    const names = (await idb.databases()).map((info) => info.name).sort();
    expect(names).toEqual([accountDatabaseName(ACCOUNT_A), accountDatabaseName(ACCOUNT_B)].sort());
  });

  it('keeps the pointer with the dirty flag and removes it with its partition', async () => {
    const store = await openAccountStore(ACCOUNT_A, idb);
    expect(await store.getPointer(DOC_1)).toBeNull();
    const pointer = {
      documentId: DOC_1,
      generation: 3,
      dirty: true,
      role: 'editor' as const,
      title: 'Notes',
      updatedAt: 1,
    };
    await store.appendUpdates(DOC_1, 3, [new Uint8Array([1])], pointer);
    expect(await store.getPointer(DOC_1)).toEqual(pointer);
    expect(await store.hasData()).toBe(true);
    await store.putPointer({ ...pointer, dirty: false });
    expect(await store.hasData()).toBe(false);
    // Clearing another generation leaves the pointer alone.
    await store.clearPartition(DOC_1, 2);
    expect(await store.getPointer(DOC_1)).not.toBeNull();
    await store.clearPartition(DOC_1, 3);
    expect(await store.getPointer(DOC_1)).toBeNull();
    store.close();
  });

  it('compaction replaces the log with one merged update without losing state', async () => {
    const store = await openAccountStore(ACCOUNT_A, idb);
    const doc = new Y.Doc();
    const persistence = new DocPersistence(store, {
      accountId: ACCOUNT_A,
      documentId: DOC_1,
      generation: 1,
      dirty: false,
      role: 'editor',
      title: null,
      storedRows: 0,
      encodeState: () => Y.encodeStateAsUpdate(doc),
    });
    doc.on('update', (update: Uint8Array) => persistence.append(update));
    const text = doc.getText('t');
    for (let index = 0; index < COMPACT_AFTER_ROWS + 25; index += 1) {
      text.insert(text.length, `${index % 10}`);
      // One microtask batch per insert, like separate keystrokes.
      await Promise.resolve();
    }
    text.delete(0, 5);
    await persistence.whenIdle();

    const rows = await store.loadUpdates(DOC_1, 1);
    expect(rows.length).toBeLessThan(COMPACT_AFTER_ROWS);
    const restored = new Y.Doc();
    for (const row of rows) Y.applyUpdate(restored, row);
    expect(restored.getText('t').toString()).toBe(text.toString());
    expect(text.length).toBe(COMPACT_AFTER_ROWS + 20);

    persistence.setPointer({ dirty: true, title: 'Renamed' });
    await persistence.whenIdle();
    expect(await store.getPointer(DOC_1)).toMatchObject({ dirty: true, title: 'Renamed' });

    await persistence.purge();
    expect(await store.loadUpdates(DOC_1, 1)).toEqual([]);
    expect(await store.getPointer(DOC_1)).toBeNull();
    persistence.append(new Uint8Array([1]));
    await persistence.whenIdle();
    expect(await store.loadUpdates(DOC_1, 1)).toEqual([]);
    store.close();
  });
});

describe('recovery drafts', () => {
  it('stores, lists, loads and deletes drafts per account', async () => {
    const first = draft(ACCOUNT_A, { createdAt: 10 });
    const second = draft(ACCOUNT_A, { createdAt: 20, reason: 'access_removed' });
    const other = draft(ACCOUNT_B);
    await saveRecoveryDraft(first, idb);
    await saveRecoveryDraft(second, idb);
    await saveRecoveryDraft(other, idb);

    const listed = await listRecoveryDrafts(ACCOUNT_A, idb);
    expect(listed.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(listed[0]).not.toHaveProperty('content');
    expect(await loadRecoveryDraftJSON(first.id, idb)).toEqual(paragraphDoc('draft text'));
    expect((await listRecoveryDrafts(ACCOUNT_B, idb)).map((entry) => entry.id)).toEqual([other.id]);
    expect(await hasLocalDataForAccount(ACCOUNT_A, idb)).toBe(true);

    await deleteRecoveryDraft(first.id, idb);
    expect(await loadRecoveryDraftJSON(first.id, idb)).toBeNull();
    expect(await listRecoveryDrafts(ACCOUNT_A, idb)).toHaveLength(1);
    expect(await loadRecoveryDraftJSON('not-an-id', idb)).toBeNull();
    expect(await loadRecoveryDraftJSON(`${ACCOUNT_A}:${uuidv4()}`, idb)).toBeNull();
  });

  it('clearLocalDataForAccount removes updates, pointers and drafts of that account only', async () => {
    const a = await openAccountStore(ACCOUNT_A, idb);
    await a.appendUpdates(DOC_1, 1, [new Uint8Array([1])], {
      documentId: DOC_1,
      generation: 1,
      dirty: true,
      role: 'editor',
      title: null,
      updatedAt: 1,
    });
    a.close();
    await saveRecoveryDraft(draft(ACCOUNT_A), idb);
    const kept = draft(ACCOUNT_B);
    await saveRecoveryDraft(kept, idb);

    expect(await hasLocalDataForAccount(ACCOUNT_A, idb)).toBe(true);
    await clearLocalDataForAccount(ACCOUNT_A, idb);
    expect(await hasLocalDataForAccount(ACCOUNT_A, idb)).toBe(false);
    expect(await listRecoveryDrafts(ACCOUNT_A, idb)).toEqual([]);
    const reopened = await openAccountStore(ACCOUNT_A, idb);
    expect(await reopened.loadUpdates(DOC_1, 1)).toEqual([]);
    expect(await reopened.getPointer(DOC_1)).toBeNull();
    reopened.close();
    expect(await loadRecoveryDraftJSON(kept.id, idb)).not.toBeNull();
    expect(await hasLocalDataForAccount(ACCOUNT_B, idb)).toBe(true);
  });

  it('hasLocalDataForAccount does not create a database for an unknown account', async () => {
    expect(await hasLocalDataForAccount(ACCOUNT_A, idb)).toBe(false);
    expect(await idb.databases()).toEqual([]);
  });

  it('keeps guest drafts in memory only', async () => {
    const guestDraft = draft('guest', { id: createDraftId(null), accountId: 'guest' });
    await saveRecoveryDraft(guestDraft, idb);
    expect(await idb.databases()).toEqual([]);
    expect(await loadRecoveryDraftJSON(guestDraft.id, idb)).toEqual(paragraphDoc('draft text'));
    await deleteRecoveryDraft(guestDraft.id, idb);
    expect(await loadRecoveryDraftJSON(guestDraft.id, idb)).toBeNull();
  });

  it('degrades to memory when IndexedDB is unavailable', async () => {
    const store = await openAccountStore(ACCOUNT_A, null);
    expect(store.persistent).toBe(false);
    await store.appendUpdates(DOC_1, 1, [new Uint8Array([5])]);
    expect((await store.loadUpdates(DOC_1, 1)).map((u) => [...u])).toEqual([[5]]);
    const memoryDraft = draft(ACCOUNT_A);
    await saveRecoveryDraft(memoryDraft, null);
    expect(await loadRecoveryDraftJSON(memoryDraft.id, null)).not.toBeNull();
    expect(await hasLocalDataForAccount(ACCOUNT_A, null)).toBe(true);
    await clearLocalDataForAccount(ACCOUNT_A, null);
    expect(await hasLocalDataForAccount(ACCOUNT_A, null)).toBe(false);
    expect(await loadRecoveryDraftJSON(memoryDraft.id, null)).toBeNull();
  });
});
