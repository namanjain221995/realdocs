/**
 * Snapshots and restore (acceptance test 13): restoring starts a new
 * generation; offline work of the abandoned generation can never be written
 * into it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { GenerationMismatchError, SequenceConflictError } from '../../src/collab/durable-log';
import { PgLogStore } from '../../src/collab/pg-log-store';
import {
  RawCollab,
  connectCollab,
  createFixture,
  openCollab,
  requestTicket,
  sleep,
  storedContent,
  until,
  type DocumentBody,
  type Fixture,
  type RawMessage,
} from './harness';

let fx: Fixture;
let editor: Awaited<ReturnType<Fixture['createUser']>>;

interface SnapshotBody {
  id: string;
  name: string;
  kind: string;
  generation: number;
  sizeBytes: number;
  createdByName: string | null;
}

beforeAll(async () => {
  fx = await createFixture('snapshots');
  editor = await fx.createUser('Sam Editor');
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

async function newDocument(title: string): Promise<string> {
  const documentId = await fx.createDocument(title);
  await fx.admin.ok(
    fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
  );
  return documentId;
}

describe('snapshots', () => {
  it('can be created, listed and deleted by administrators only', async () => {
    const documentId = await newDocument('Snapshot basics');
    const client = await connectCollab(editor, documentId);
    client.appendParagraph('state one');
    await client.save();

    const created = await fx.admin.post<{ snapshot: SnapshotBody }>(
      `/api/documents/${documentId}/snapshots`,
      { name: '  First milestone  ' },
    );
    expect(created.status).toBe(201);
    expect(created.body.snapshot).toMatchObject({
      name: 'First milestone',
      kind: 'named',
      generation: 1,
      createdByName: 'Ada Admin',
    });
    expect(created.body.snapshot.sizeBytes).toBeGreaterThan(20);
    expect((await fx.admin.post(`/api/documents/${documentId}/snapshots`, { name: '' })).code).toBe(
      'validation_failed',
    );
    expect(
      (await editor.post(`/api/documents/${documentId}/snapshots`, { name: 'x' })).status,
    ).toBe(403);
    expect((await editor.get(`/api/documents/${documentId}/snapshots`)).status).toBe(403);

    // The snapshot is a copy: later edits do not change it.
    client.appendParagraph('state two');
    await client.save();
    const [stored] = await fx.server.sql<{ state: Buffer }>(
      'SELECT state FROM snapshots WHERE id = $1',
      [created.body.snapshot.id],
    );
    const copy = new Y.Doc();
    Y.applyUpdate(copy, stored?.state ?? new Uint8Array());
    const text = JSON.stringify(copy.getXmlFragment('default').toJSON());
    expect(text).toContain('state one');
    expect(text).not.toContain('state two');

    const list = await fx.admin.get<{ snapshots: SnapshotBody[] }>(
      `/api/documents/${documentId}/snapshots`,
    );
    expect(list.body.snapshots.map((snapshot) => snapshot.name)).toEqual(['First milestone']);
    expect(JSON.stringify(list.body)).not.toContain('state one');

    const removed = await fx.admin.delete(
      `/api/documents/${documentId}/snapshots/${created.body.snapshot.id}`,
    );
    expect(removed.status).toBe(204);
    expect(
      (await fx.admin.delete(`/api/documents/${documentId}/snapshots/${created.body.snapshot.id}`))
        .status,
    ).toBe(404);
    client.destroy();
  });
});

describe('restore (acceptance test 13)', () => {
  it('starts a new generation and keeps stale offline edits out of it', async () => {
    const documentId = await newDocument('Restore');
    const writer = await connectCollab(editor, documentId);
    writer.appendParagraph('content of version one');
    await writer.save();
    const snapshot = (
      await fx.admin.ok(
        fx.admin.post<{ snapshot: SnapshotBody }>(`/api/documents/${documentId}/snapshots`, {
          name: 'Version one',
        }),
      )
    ).snapshot;

    writer.appendParagraph('written after the snapshot');
    await writer.save();
    const watcher = await connectCollab(fx.admin, documentId);
    expect(watcher.text()).toContain('written after the snapshot');

    // The editor goes offline and keeps working on generation 1.
    writer.disconnect();
    writer.appendParagraph('OFFLINE-STALE-EDIT');
    writer.edit(() => writer.fragment.delete(1, 1));
    const staleDoc = writer.doc;
    const oldRoom = writer.ticket.documentName;
    expect(oldRoom.endsWith('.g1')).toBe(true);

    // A third client stays connected on generation 1 and writes right through the restore.
    const racing = await connectCollab(editor, documentId);
    let racingCount = 0;
    const typing = setInterval(() => {
      racingCount += 1;
      racing.appendParagraph(`RACING-OLD-GENERATION-${racingCount}`);
      racing.mark();
    }, 2);

    const restored = await fx.admin.post<{
      document: DocumentBody['document'];
      preRestoreSnapshot: SnapshotBody;
    }>(`/api/documents/${documentId}/snapshots/${snapshot.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.document.generation).toBe(2);
    expect(restored.body.preRestoreSnapshot).toMatchObject({ kind: 'pre_restore', generation: 1 });
    expect(restored.body.preRestoreSnapshot.name).toContain('Version one');

    // Connected clients are told what happened, then the old room is closed.
    const notice = await watcher.waitFor((message) => message.t === 'generation' && message);
    expect(notice).toEqual({
      t: 'generation',
      generation: 2,
      reason: 'snapshot_restored',
      snapshotName: 'Version one',
      byName: 'Ada Admin',
    });
    expect(await watcher.closed()).toEqual({ code: 4409, reason: 'generation_changed' });
    expect(await racing.closed()).toEqual({ code: 4409, reason: 'generation_changed' });
    await sleep(50);
    clearInterval(typing);
    expect(racingCount).toBeGreaterThan(3);
    // The racing client was told why its last edits can never be saved (if any were pending).
    const racingErrors = racing.stateless.filter((m) => m.t === 'save-error');
    for (const error of racingErrors) {
      expect(error).toMatchObject({ code: 'generation_changed', retrying: false });
    }

    // 1. The stale client asks for a ticket: it learns the new generation …
    const ticket = await requestTicket(editor, documentId, staleDoc.clientID, { generation: 1 });
    expect(ticket.status).toBe(200);
    expect(ticket.body.generation).toBe(2);
    expect(ticket.body.documentName).toBe(`${documentId}.g2`);
    // … and cannot use it (or any other ticket) to get back into the old room.
    const stale = await openCollab(editor, documentId, {
      doc: staleDoc,
      ticket: ticket.body,
      documentName: oldRoom,
    });
    await until(() => stale.authFailures.length > 0, { what: 'old room refused' });
    expect(stale.authFailures).toEqual(['generation_mismatch']);
    expect(stale.isSynced).toBe(false);
    stale.destroy();

    // 2. A raw client replaying the offline update against the old room gets nowhere either.
    const second = await requestTicket(editor, documentId, staleDoc.clientID);
    const raw = await RawCollab.open(fx.server);
    raw.auth(oldRoom, second.body.ticket);
    raw.update(oldRoom, Y.encodeStateAsUpdate(staleDoc));
    raw.syncStep2(oldRoom, Y.encodeStateAsUpdate(staleDoc));
    const denied = await raw.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (m) => m.kind === 'auth',
    );
    expect(denied).toMatchObject({ status: 'denied', detail: 'generation_mismatch' });
    await sleep(300);
    expect(raw.messages.filter((m) => m.kind === 'sync' || m.kind === 'syncStatus')).toEqual([]);
    raw.destroy();

    // 3. Writing to the log of the abandoned generation is impossible at the storage level.
    const store = new PgLogStore(
      {
        query: (text, params) =>
          fx.server.sql(text, [...(params ?? [])]).then((rows) => ({ rows }) as never),
      },
      (
        await fx.server.sql<{ id: string }>(
          'SELECT workspace_id AS id FROM documents WHERE id = $1',
          [documentId],
        )
      )[0]?.id ?? '',
    );
    const [abandoned] = await fx.server.sql<{ headSeq: string }>(
      'SELECT head_seq AS "headSeq" FROM documents WHERE id = $1',
      [documentId],
    );
    expect(Number(abandoned?.headSeq)).toBe(0);
    for (const expectedHeadSeq of [0, 1, 2, 3, 50]) {
      await expect(
        store.append({
          documentId,
          generation: 1,
          expectedHeadSeq,
          update: Y.encodeStateAsUpdate(staleDoc),
        }),
      ).rejects.toBeInstanceOf(GenerationMismatchError);
    }
    await expect(
      store.compact({
        documentId,
        generation: 1,
        uptoSeq: 0,
        state: Y.encodeStateAsUpdate(staleDoc),
      }),
    ).rejects.toBeInstanceOf(GenerationMismatchError);

    // The database contains none of it: not in generation 2, not as a leftover of generation 1.
    const stored = await storedContent(fx.server, documentId);
    expect(stored).not.toContain('OFFLINE-STALE-EDIT');
    expect(stored).not.toContain('written after the snapshot');
    expect(stored).toContain('content of version one');
    // Nothing the racing client wrote on generation 1 exists in generation 2.
    expect(stored).not.toMatch(/RACING-OLD-GENERATION/);
    const generations = await fx.server.sql<{ generation: number }>(
      `SELECT generation FROM doc_states WHERE document_id = $1
       UNION SELECT generation FROM doc_updates WHERE document_id = $1`,
      [documentId],
    );
    expect(generations.map((row) => row.generation)).toEqual([2]);

    // The automatic pre-restore snapshot holds the abandoned state (as it was acknowledged).
    const [pre] = await fx.server.sql<{ state: Buffer; kind: string }>(
      'SELECT state, kind FROM snapshots WHERE id = $1',
      [restored.body.preRestoreSnapshot.id],
    );
    const abandonedDoc = new Y.Doc();
    Y.applyUpdate(abandonedDoc, pre?.state ?? new Uint8Array());
    const abandonedText = JSON.stringify(abandonedDoc.getXmlFragment('default').toJSON());
    expect(abandonedText).toContain('written after the snapshot');
    expect(abandonedText).not.toContain('OFFLINE-STALE-EDIT');

    // A client starting fresh on generation 2 sees exactly the restored content.
    const fresh = await connectCollab(editor, documentId);
    expect(fresh.ticket.generation).toBe(2);
    expect(fresh.text()).toBe('content of version one\n');
    fresh.appendParagraph('first edit of generation two');
    await fresh.save();
    // The restored state is a new Yjs history: it shares no client ids with the old one.
    const oldClients = new Set(Y.decodeStateVector(Y.encodeStateVector(staleDoc)).keys());
    const newClients = [...Y.decodeStateVector(Y.encodeStateVector(fresh.doc)).keys()];
    expect(newClients.filter((client) => oldClients.has(client))).toEqual([]);

    // Undoing the restore is itself a restore: generation 3 from the pre-restore snapshot.
    const undone = await fx.admin.post<{ document: DocumentBody['document'] }>(
      `/api/documents/${documentId}/snapshots/${restored.body.preRestoreSnapshot.id}/restore`,
    );
    expect(undone.body.document.generation).toBe(3);
    expect(await fresh.closed()).toEqual({ code: 4409, reason: 'generation_changed' });
    const third = await connectCollab(editor, documentId);
    expect(third.text()).toContain('written after the snapshot');
    expect(third.text()).not.toContain('first edit of generation two');
    third.destroy();

    const kinds = await fx.admin.get<{ snapshots: SnapshotBody[] }>(
      `/api/documents/${documentId}/snapshots`,
    );
    expect(kinds.body.snapshots.map((s) => [s.kind, s.generation]).sort()).toEqual([
      ['named', 1],
      ['pre_restore', 1],
      ['pre_restore', 2],
    ]);
    const audit = await fx.admin.get<{
      events: { action: string; details: Record<string, unknown> }[];
    }>('/api/audit?limit=200');
    expect(
      audit.body.events.find((event) => event.action === 'snapshot.restored')?.details,
    ).toMatchObject({
      documentId,
    });
  }, 60_000);

  it('is refused for archived documents, foreign snapshots and non-administrators', async () => {
    const documentId = await newDocument('Restore guards');
    const snapshot = (
      await fx.admin.ok(
        fx.admin.post<{ snapshot: SnapshotBody }>(`/api/documents/${documentId}/snapshots`, {
          name: 'S',
        }),
      )
    ).snapshot;
    const restorePath = `/api/documents/${documentId}/snapshots/${snapshot.id}/restore`;
    expect((await editor.post(restorePath)).status).toBe(403);
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/archive`));
    const archived = await fx.admin.post(restorePath);
    expect([archived.status, archived.code]).toEqual([409, 'conflict']);
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/unarchive`));
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/trash`));
    expect((await fx.admin.post(restorePath)).code).toBe('document_trashed');
    const [row] = await fx.server.sql<{ generation: number }>(
      'SELECT generation FROM documents WHERE id = $1',
      [documentId],
    );
    expect(row?.generation).toBe(1);
  });
});

describe('PgLogStore against PostgreSQL', () => {
  it('assigns gap-free sequence numbers and refuses stale writers', async () => {
    const documentId = await fx.createDocument('Log store');
    const [{ workspaceId } = { workspaceId: '' }] = await fx.server.sql<{ workspaceId: string }>(
      'SELECT workspace_id AS "workspaceId" FROM documents WHERE id = $1',
      [documentId],
    );
    const store = new PgLogStore(
      {
        query: (text, params) =>
          fx.server.sql(text, [...(params ?? [])]).then((rows) => ({ rows }) as never),
      },
      workspaceId,
    );
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    for (const word of ['one', 'two', 'three']) doc.getText('t').insert(0, `${word} `);

    expect(
      await store.append({ documentId, generation: 1, expectedHeadSeq: 0, update: updates[0]! }),
    ).toBe(1);
    expect(
      await store.append({ documentId, generation: 1, expectedHeadSeq: 1, update: updates[1]! }),
    ).toBe(2);
    // A writer that missed an update cannot append behind the head …
    await expect(
      store.append({ documentId, generation: 1, expectedHeadSeq: 1, update: updates[2]! }),
    ).rejects.toBeInstanceOf(SequenceConflictError);
    // … nor ahead of it, nor into a document of another workspace or one that does not exist.
    await expect(
      store.append({ documentId, generation: 1, expectedHeadSeq: 7, update: updates[2]! }),
    ).rejects.toBeInstanceOf(SequenceConflictError);
    const foreign = new PgLogStore(
      {
        query: (text, params) =>
          fx.server.sql(text, [...(params ?? [])]).then((rows) => ({ rows }) as never),
      },
      '00000000-0000-4000-8000-000000000000',
    );
    await expect(
      foreign.append({ documentId, generation: 1, expectedHeadSeq: 2, update: updates[2]! }),
    ).rejects.toBeInstanceOf(GenerationMismatchError);
    expect(
      await store.append({ documentId, generation: 1, expectedHeadSeq: 2, update: updates[2]! }),
    ).toBe(3);

    const rows = await fx.server.sql<{ seq: string }>(
      'SELECT seq FROM doc_updates WHERE document_id = $1 ORDER BY seq',
      [documentId],
    );
    expect(rows.map((row) => Number(row.seq))).toEqual([1, 2, 3]);

    // Compaction must name the current head: a stale boundary deletes nothing.
    await expect(
      store.compact({ documentId, generation: 1, uptoSeq: 2, state: Y.encodeStateAsUpdate(doc) }),
    ).rejects.toBeInstanceOf(SequenceConflictError);
    expect(
      await fx.server.sql('SELECT 1 FROM doc_updates WHERE document_id = $1', [documentId]),
    ).toHaveLength(3);

    await store.compact({
      documentId,
      generation: 1,
      uptoSeq: 3,
      state: Y.encodeStateAsUpdate(doc),
    });
    expect(
      await fx.server.sql('SELECT 1 FROM doc_updates WHERE document_id = $1', [documentId]),
    ).toHaveLength(0);
    const [state] = await fx.server.sql<{ uptoSeq: string; state: Buffer }>(
      'SELECT upto_seq AS "uptoSeq", state FROM doc_states WHERE document_id = $1',
      [documentId],
    );
    expect(Number(state?.uptoSeq)).toBe(3);
    // Later appends continue after the boundary and are not touched by it.
    doc.getText('t').insert(0, 'four ');
    expect(
      await store.append({ documentId, generation: 1, expectedHeadSeq: 3, update: updates[3]! }),
    ).toBe(4);
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, state?.state ?? new Uint8Array());
    const [tail] = await fx.server.sql<{ update: Buffer }>(
      'SELECT "update" FROM doc_updates WHERE document_id = $1 AND seq = 4',
      [documentId],
    );
    Y.applyUpdate(rebuilt, tail?.update ?? new Uint8Array());
    expect(rebuilt.getText('t').toString()).toBe('four three two one ');
  });

  it('serialises concurrent writers: exactly one of two competing appends wins', async () => {
    const documentId = await fx.createDocument('Concurrent writers');
    const [{ workspaceId } = { workspaceId: '' }] = await fx.server.sql<{ workspaceId: string }>(
      'SELECT workspace_id AS "workspaceId" FROM documents WHERE id = $1',
      [documentId],
    );
    const store = new PgLogStore(
      {
        query: (text, params) =>
          fx.server.sql(text, [...(params ?? [])]).then((rows) => ({ rows }) as never),
      },
      workspaceId,
    );
    const update = Y.encodeStateAsUpdate(new Y.Doc());
    for (let round = 0; round < 10; round += 1) {
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          store.append({ documentId, generation: 1, expectedHeadSeq: round, update }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'rejected')
          expect(result.reason).toBeInstanceOf(SequenceConflictError);
      }
    }
    const rows = await fx.server.sql<{ seq: string }>(
      'SELECT seq FROM doc_updates WHERE document_id = $1 ORDER BY seq',
      [documentId],
    );
    expect(rows.map((row) => Number(row.seq))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
