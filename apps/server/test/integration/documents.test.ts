/** Document lifecycle (rename, archive, trash, purge) and the retention job. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  connectCollab,
  createFixture,
  makePng,
  requestTicket,
  sleep,
  until,
  type AssetBody,
  type DocumentBody,
  type Fixture,
} from './harness';

let fx: Fixture;
let editor: Awaited<ReturnType<Fixture['createUser']>>;

type Summary = DocumentBody['document'];

beforeAll(async () => {
  fx = await createFixture('documents');
  editor = await fx.createUser('Lia Lifecycle');
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

const list = async (agent: typeof fx.admin, query: string) =>
  (await agent.get<{ documents: Summary[] }>(`/api/documents?${query}`)).body.documents;

const filePath = (key: string) => path.join(fx.server.assetDir, 'objects', key);

async function assetKey(assetId: string): Promise<string> {
  const rows = await fx.server.sql<{ key: string }>(
    'SELECT storage_key AS key FROM assets WHERE id = $1',
    [assetId],
  );
  return rows[0]?.key ?? '';
}

/** The JSON report printed by the cleanup command. */
function parseReport(stdout: string): Record<string, number | boolean> {
  return JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)) as Record<
    string,
    number | boolean
  >;
}

async function runCleanup(): Promise<Record<string, number | boolean>> {
  const result = await fx.server.cli(['cleanup']);
  expect(result.code, result.stderr).toBe(0);
  return parseReport(result.stdout);
}

describe('creating and renaming', () => {
  it('creates documents with server-made initial content and validates titles', async () => {
    const created = await fx.admin.post<DocumentBody>('/api/documents', {});
    expect(created.status).toBe(201);
    expect(created.body.document).toMatchObject({
      title: 'Untitled document',
      status: 'active',
      generation: 1,
      archivedAt: null,
      trashedAt: null,
      purgeAfter: null,
      createdByName: 'Ada Admin',
      access: { role: 'admin', via: 'workspace_admin' },
    });
    // The initial Yjs state exists before any client has connected.
    const [state] = await fx.server.sql<{ state: Buffer; uptoSeq: string }>(
      'SELECT state, upto_seq AS "uptoSeq" FROM doc_states WHERE document_id = $1 AND generation = 1',
      [created.body.document.id],
    );
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state?.state ?? new Uint8Array());
    expect(doc.getXmlFragment('default').length).toBe(1);
    expect(state?.uptoSeq).toBe('0');

    expect((await fx.admin.post('/api/documents', { title: '   ' })).code).toBe(
      'validation_failed',
    );
    expect((await fx.admin.post('/api/documents', { title: 'x'.repeat(201) })).code).toBe(
      'validation_failed',
    );
    expect((await editor.post('/api/documents', { title: 'not allowed' })).status).toBe(403);

    const renamed = await fx.admin.patch<DocumentBody>(
      `/api/documents/${created.body.document.id}`,
      {
        title: '  Roadmap 2027 — “draft” <b>  ',
      },
    );
    expect(renamed.body.document.title).toBe('Roadmap 2027 — “draft” <b>');
    expect(
      (await fx.admin.patch(`/api/documents/${created.body.document.id}`, { title: '' })).code,
    ).toBe('validation_failed');
  });

  it('lists active, recent, archived and trashed documents with search', async () => {
    const alpha = await newDocument('Alpha plan');
    const beta = await newDocument('Beta plan');
    const gamma = await newDocument('Gamma notes 100%');
    await fx.admin.ok(fx.admin.post(`/api/documents/${beta}/archive`));
    await fx.admin.ok(fx.admin.post(`/api/documents/${gamma}/trash`));

    const ids = (documents: Summary[]) => documents.map((document) => document.id);
    expect(ids(await list(editor, 'view=active'))).toEqual([alpha]);
    expect(ids(await list(editor, 'view=archived'))).toEqual([beta]);
    // Members never see the trash.
    expect(await list(editor, 'view=trash')).toEqual([]);
    expect(ids(await list(fx.admin, 'view=trash'))).toEqual([gamma]);
    expect(ids(await list(fx.admin, 'view=active'))).toContain(alpha);
    expect(ids(await list(fx.admin, 'view=active'))).not.toContain(beta);
    expect(ids(await list(fx.admin, 'view=archived&q=beta'))).toEqual([beta]);
    expect(ids(await list(fx.admin, 'view=trash&q=100%25'))).toEqual([gamma]);
    expect(ids(await list(fx.admin, 'q=plan'))).toEqual([alpha]);
    expect(ids(await list(fx.admin, 'q=_'))).toEqual([]);
    expect((await fx.admin.get('/api/documents?view=everything')).code).toBe('validation_failed');

    // "Recent" follows content changes.
    const older = await newDocument('Edited earlier');
    const newer = await newDocument('Edited later');
    for (const id of [older, newer]) {
      const client = await connectCollab(editor, id);
      client.appendParagraph('touch');
      await client.save();
      client.destroy();
      await sleep(20);
    }
    const recent = ids(await list(editor, 'view=recent'));
    // Newest change first, active documents only.
    expect(recent.slice(0, 2)).toEqual([newer, older]);
    expect(recent).toContain(alpha);
    expect(recent).not.toContain(beta);
    expect(recent).not.toContain(gamma);
    const adminRecent = await list(fx.admin, 'view=recent');
    expect(adminRecent.every((document) => document.status === 'active')).toBe(true);
    expect(adminRecent.length).toBeLessThanOrEqual(12);
    // A metadata change (rename) also counts as a recent change.
    await fx.admin.ok(fx.admin.patch(`/api/documents/${alpha}`, { title: 'Alpha plan (renamed)' }));
    expect(ids(await list(editor, 'view=recent'))[0]).toBe(alpha);
    const summary = (await list(editor, 'view=recent')).find((document) => document.id === newer);
    expect(new Date(summary?.contentUpdatedAt ?? 0).getTime()).toBeGreaterThan(
      new Date(summary?.createdAt ?? 0).getTime(),
    );
  });
});

describe('archive', () => {
  it('makes a document read-only for everyone, live, and can be undone', async () => {
    const documentId = await newDocument('To archive');
    const client = await connectCollab(editor, documentId);
    client.appendParagraph('before archiving');
    await client.save();
    const adminClient = await connectCollab(fx.admin, documentId);

    const archived = await fx.admin.post<DocumentBody>(`/api/documents/${documentId}/archive`);
    expect(archived.body.document.status).toBe('archived');
    expect(archived.body.document.archivedAt).not.toBeNull();
    // Administrators keep managing it, but nobody edits: the effective role is viewer.
    expect(archived.body.document.access).toMatchObject({ role: 'viewer', via: 'workspace_admin' });
    for (const connected of [client, adminClient]) {
      expect(await connected.waitFor((m) => m.t === 'access' && m, { timeoutMs: 2_000 })).toEqual({
        t: 'access',
        change: 'role_changed',
        role: 'viewer',
      });
      expect(connected.closes).toEqual([]);
    }
    client.appendParagraph('WRITTEN-WHILE-ARCHIVED');
    adminClient.appendParagraph('ADMIN-WRITTEN-WHILE-ARCHIVED');
    client.mark();
    await sleep(400);
    const exported = await fx.admin.get(`/api/documents/${documentId}/export?format=txt`);
    expect(exported.text).toBe('before archiving\n');
    expect(client.stateless.filter((m) => m.t === 'saved' && m.n >= client.n)).toEqual([]);
    expect(
      (await editor.get<DocumentBody>(`/api/documents/${documentId}`)).body.document.access.role,
    ).toBe('viewer');
    expect((await requestTicket(editor, documentId, 1)).body.role).toBe('viewer');
    expect((await editor.upload(documentId, makePng(4, 4), 'x.png')).status).toBe(403);
    // Management still works on an archived document.
    expect((await fx.admin.get(`/api/documents/${documentId}/shares`)).status).toBe(200);
    expect((await fx.admin.post(`/api/documents/${documentId}/archive`)).status).toBe(200);

    const unarchived = await fx.admin.post<DocumentBody>(`/api/documents/${documentId}/unarchive`);
    expect(unarchived.body.document).toMatchObject({ status: 'active', archivedAt: null });
    const upgrade = await client.waitFor(
      (m) => m.t === 'access' && m.change === 'role_changed' && m.role === 'editor' && m,
      { timeoutMs: 2_000 },
    );
    expect(upgrade).toBeTruthy();
    for (const connected of [client, adminClient]) connected.destroy();
  });
});

describe('trash, restore and permanent deletion', () => {
  it('makes a trashed document unreachable except for administrator lifecycle actions', async () => {
    const documentId = await newDocument('To trash');
    const asset = (
      await fx.admin.ok<{ asset: AssetBody }>(
        fx.admin.upload(documentId, makePng(6, 6), 'kept.png'),
      )
    ).asset;
    const client = await connectCollab(editor, documentId);

    const cannotDelete = await fx.admin.delete(`/api/documents/${documentId}`);
    expect([cannotDelete.status, cannotDelete.code]).toEqual([409, 'conflict']);

    const trashed = await fx.admin.post<DocumentBody>(`/api/documents/${documentId}/trash`);
    expect(trashed.body.document.status).toBe('trashed');
    const purgeAfter = new Date(trashed.body.document.purgeAfter ?? 0).getTime();
    const trashedAt = new Date(trashed.body.document.trashedAt ?? 0).getTime();
    expect(purgeAfter - trashedAt).toBe(30 * 86_400_000);
    expect(await client.closed(2_000)).toEqual({ code: 4404, reason: 'document_unavailable' });

    for (const path of [
      `/api/documents/${documentId}`,
      `/api/documents/${documentId}/export?format=txt`,
      `/api/documents/${documentId}/assets/${asset.id}`,
    ]) {
      const response = await editor.get(path);
      expect([path, response.status, response.code]).toEqual([path, 410, 'document_trashed']);
    }
    expect((await requestTicket(editor, documentId, 1)).code).toBe('document_trashed');
    // Administrators see its metadata (for the trash view) but cannot open or change it either.
    expect(
      (await fx.admin.get<DocumentBody>(`/api/documents/${documentId}`)).body.document.status,
    ).toBe('trashed');
    for (const response of [
      await requestTicket(fx.admin, documentId, 1),
      await fx.admin.get(`/api/documents/${documentId}/export?format=txt`),
      await fx.admin.get(`/api/documents/${documentId}/snapshots`),
      await fx.admin.patch(`/api/documents/${documentId}`, { title: 'x' }),
      await fx.admin.post(`/api/documents/${documentId}/shares`, {}),
      await fx.admin.post(`/api/documents/${documentId}/archive`),
    ]) {
      expect([response.status, response.code]).toEqual([410, 'document_trashed']);
    }

    const restored = await fx.admin.post<DocumentBody>(`/api/documents/${documentId}/restore`);
    expect(restored.body.document).toMatchObject({
      status: 'active',
      trashedAt: null,
      purgeAfter: null,
    });
    expect((await editor.get(`/api/documents/${documentId}/assets/${asset.id}`)).status).toBe(200);
    const back = await connectCollab(editor, documentId);
    expect(back.authenticatedScope).toBe('read-write');
    back.destroy();
    client.destroy();

    // A document that was archived before it was trashed comes back archived.
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/archive`));
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/trash`));
    const again = await fx.admin.post<DocumentBody>(`/api/documents/${documentId}/restore`);
    expect(again.body.document.status).toBe('archived');
  });

  it('deletes a trashed document permanently, including its files', async () => {
    const documentId = await newDocument('To delete');
    const asset = (
      await fx.admin.ok<{ asset: AssetBody }>(
        fx.admin.upload(documentId, makePng(6, 6), 'gone.png'),
      )
    ).asset;
    const key = await assetKey(asset.id);
    expect(existsSync(filePath(key))).toBe(true);
    await fx.createShare(documentId);
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/snapshots`, { name: 's' }));
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/trash`));
    expect((await editor.delete(`/api/documents/${documentId}`)).status).toBe(410);

    expect((await fx.admin.delete(`/api/documents/${documentId}`)).status).toBe(204);
    expect((await fx.admin.get(`/api/documents/${documentId}`)).status).toBe(404);
    for (const table of [
      'documents',
      'doc_states',
      'doc_updates',
      'document_members',
      'share_grants',
      'snapshots',
      'assets',
    ]) {
      const column = table === 'documents' ? 'id' : 'document_id';
      expect([
        table,
        await fx.server.sql(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [documentId]),
      ]).toEqual([table, []]);
    }
    expect(existsSync(filePath(key))).toBe(false);
    expect(await fx.server.sql('SELECT 1 FROM asset_deletions')).toEqual([]);
  });
});

describe('retention job (cleanup)', () => {
  it('purges trashed documents only after the retention period', async () => {
    const recent = await newDocument('Trashed yesterday');
    const old = await newDocument('Trashed long ago');
    const asset = (
      await fx.admin.ok<{ asset: AssetBody }>(fx.admin.upload(old, makePng(6, 6), 'old.png'))
    ).asset;
    const key = await assetKey(asset.id);
    for (const id of [recent, old]) await fx.admin.ok(fx.admin.post(`/api/documents/${id}/trash`));
    await fx.server.sql(
      "UPDATE documents SET trashed_at = now() - interval '29 days' WHERE id = $1",
      [recent],
    );
    await fx.server.sql(
      "UPDATE documents SET trashed_at = now() - interval '31 days' WHERE id = $1",
      [old],
    );

    const report = await runCleanup();
    expect(report).toMatchObject({ skipped: false, documentsPurged: 1 });
    expect(Number(report.filesDeleted)).toBeGreaterThanOrEqual(1);
    expect((await fx.admin.get(`/api/documents/${old}`)).status).toBe(404);
    expect(
      (await fx.admin.get<DocumentBody>(`/api/documents/${recent}`)).body.document.status,
    ).toBe('trashed');
    expect(existsSync(filePath(key))).toBe(false);
    const audit = await fx.admin.get('/api/audit?limit=200');
    expect(audit.text).toContain('document.purged');
  });

  it('deletes an asset only after it was unreferenced for the whole grace period', async () => {
    const documentId = await newDocument('Asset retention');
    const upload = async (name: string) =>
      (await fx.admin.ok<{ asset: AssetBody }>(fx.admin.upload(documentId, makePng(5, 5), name)))
        .asset;
    const live = await upload('in-document.png');
    const inSnapshot = await upload('only-in-snapshot.png');
    const orphan = await upload('never-inserted.png');
    const fresh = await upload('just-uploaded.png');

    const client = await connectCollab(editor, documentId);
    const insert = (asset: AssetBody) =>
      client.edit(() => {
        const node = new Y.XmlElement('image');
        node.setAttribute('assetId', asset.id);
        client.fragment.push([node]);
      });
    insert(live);
    insert(inSnapshot);
    await client.save();
    await fx.admin.ok(
      fx.admin.post(`/api/documents/${documentId}/snapshots`, { name: 'with both images' }),
    );
    // Removed from the live document; the snapshot still needs it.
    client.deleteBlock(client.fragment.length - 1);
    await client.save();
    client.destroy();
    await sleep(300);

    const keys = {
      live: await assetKey(live.id),
      inSnapshot: await assetKey(inSnapshot.id),
      orphan: await assetKey(orphan.id),
      fresh: await assetKey(fresh.id),
    };
    const unreferencedSince = async (id: string) =>
      (
        await fx.server.sql<{ at: Date | null }>(
          'SELECT unreferenced_since AS at FROM assets WHERE id = $1',
          [id],
        )
      )[0]?.at;

    // First run: unreferenced assets are only marked.
    const first = await runCleanup();
    expect(first).toMatchObject({ assetsDeleted: 0 });
    expect(Number(first.assetsMarkedUnreferenced)).toBeGreaterThanOrEqual(2);
    expect(await unreferencedSince(fresh.id)).not.toBeNull();
    expect(await unreferencedSince(live.id)).toBeNull();
    expect(await unreferencedSince(inSnapshot.id)).toBeNull();
    expect(await unreferencedSince(orphan.id)).not.toBeNull();
    for (const key of Object.values(keys)) expect(existsSync(filePath(key))).toBe(true);

    // 29 days later: still inside the grace period.
    await fx.server.sql(
      "UPDATE assets SET unreferenced_since = now() - interval '29 days' WHERE id = $1",
      [orphan.id],
    );
    expect(await runCleanup()).toMatchObject({ assetsDeleted: 0 });
    expect(existsSync(filePath(keys.orphan))).toBe(true);

    // 31 days: the orphan goes; everything that is referenced or recent stays.
    await fx.server.sql(
      "UPDATE assets SET unreferenced_since = now() - interval '31 days' WHERE id = $1",
      [orphan.id],
    );
    const third = await runCleanup();
    expect(third).toMatchObject({ assetsDeleted: 1, filesDeleted: 1 });
    expect(existsSync(filePath(keys.orphan))).toBe(false);
    expect((await fx.admin.get(`/api/documents/${documentId}/assets/${orphan.id}`)).status).toBe(
      404,
    );
    for (const key of [keys.live, keys.inSnapshot, keys.fresh])
      expect(existsSync(filePath(key))).toBe(true);
    for (const asset of [live, inSnapshot, fresh]) {
      expect((await fx.admin.get(`/api/documents/${documentId}/assets/${asset.id}`)).status).toBe(
        200,
      );
    }

    // An asset that becomes referenced again (undo, restore) is taken off the list.
    await fx.server.sql(
      "UPDATE assets SET unreferenced_since = now() - interval '40 days' WHERE id = $1",
      [fresh.id],
    );
    const again = await connectCollab(editor, documentId);
    again.edit(() => {
      const node = new Y.XmlElement('image');
      node.setAttribute('assetId', fresh.id);
      again.fragment.push([node]);
    });
    await again.save();
    again.destroy();
    await sleep(300);
    expect(await runCleanup()).toMatchObject({ assetsDeleted: 0, assetsRestoredToReferenced: 1 });
    expect(await unreferencedSince(fresh.id)).toBeNull();

    // When the snapshot is deleted, its image starts its own grace period.
    const snapshots = await fx.admin.get<{ snapshots: { id: string }[] }>(
      `/api/documents/${documentId}/snapshots`,
    );
    await fx.admin.delete(
      `/api/documents/${documentId}/snapshots/${snapshots.body.snapshots[0]?.id}`,
    );
    expect(await runCleanup()).toMatchObject({ assetsDeleted: 0 });
    expect(await unreferencedSince(inSnapshot.id)).not.toBeNull();
    expect(await unreferencedSince(live.id)).toBeNull();
    expect(existsSync(filePath(keys.inSnapshot))).toBe(true);
  });

  it('removes unfinished uploads, stale staging files and old records', async () => {
    const documentId = await newDocument('Housekeeping');
    const asset = (
      await fx.admin.ok<{ asset: AssetBody }>(
        fx.admin.upload(documentId, makePng(5, 5), 'stuck.png'),
      )
    ).asset;
    const key = await assetKey(asset.id);
    // An upload that never finished 25 hours ago, and one from an hour ago.
    await fx.server.sql(
      "UPDATE assets SET status = 'pending', created_at = now() - interval '25 hours' WHERE id = $1",
      [asset.id],
    );
    const recent = (
      await fx.admin.ok<{ asset: AssetBody }>(
        fx.admin.upload(documentId, makePng(5, 5), 'recent.png'),
      )
    ).asset;
    await fx.server.sql(
      "UPDATE assets SET status = 'pending', created_at = now() - interval '1 hour' WHERE id = $1",
      [recent.id],
    );
    // Old records of every kind, next to fresh ones.
    const [workspace] = await fx.server.sql<{ id: string }>('SELECT id FROM workspaces');
    await fx.server.sql(
      `INSERT INTO audit_events (id, workspace_id, at, actor_kind, action)
       VALUES (gen_random_uuid(), $1, now() - interval '400 days', 'system', 'test.ancient')`,
      [workspace?.id],
    );
    await fx.server.sql(
      `UPDATE sessions SET expires_at = now() - interval '40 days', last_seen_at = now() - interval '45 days'
        WHERE id = (SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
      [editor.userId],
    );
    const snapshot = await fx.admin.ok(
      fx.admin.post<{ snapshot: { id: string } }>(`/api/documents/${documentId}/snapshots`, {
        name: 'keep me',
      }),
    );
    await fx.admin.ok(
      fx.admin.post(`/api/documents/${documentId}/snapshots/${snapshot.snapshot.id}/restore`),
    );
    await fx.server.sql(
      "UPDATE snapshots SET created_at = now() - interval '100 days' WHERE document_id = $1",
      [documentId],
    );

    const report = await runCleanup();
    expect(report).toMatchObject({
      pendingUploadsRemoved: 1,
      preRestoreSnapshotsRemoved: 1,
      sessionsRemoved: 1,
      auditEventsRemoved: 1,
    });
    expect(existsSync(filePath(key))).toBe(false);
    expect(await fx.server.sql('SELECT 1 FROM assets WHERE id = $1', [asset.id])).toEqual([]);
    expect(await fx.server.sql('SELECT 1 FROM assets WHERE id = $1', [recent.id])).toHaveLength(1);
    // Named snapshots are kept until an administrator deletes them.
    const kinds = await fx.server.sql<{ kind: string }>(
      'SELECT kind FROM snapshots WHERE document_id = $1',
      [documentId],
    );
    expect(kinds.map((row) => row.kind)).toEqual(['named']);
    expect(await fx.server.sql("SELECT 1 FROM audit_events WHERE action = 'test.ancient'")).toEqual(
      [],
    );

    // Running it again changes nothing; two runs at once do not overlap.
    const [a, b] = await Promise.all([fx.server.cli(['cleanup']), fx.server.cli(['cleanup'])]);
    expect(a.code + b.code).toBe(0);
    for (const each of [a, b].map((result) => parseReport(result.stdout))) {
      if (!each.skipped)
        expect(each).toMatchObject({
          documentsPurged: 0,
          assetsDeleted: 0,
          pendingUploadsRemoved: 0,
        });
    }
    await until(async () => (await fx.admin.get('/api/ready')).status === 200, {
      what: 'server still healthy',
    });
  });
});
