/**
 * Page settings: the top-level Y.Map `page` of the shared document. Editors
 * write it over the collaboration connection, every client receives it, a
 * read-only connection cannot change it, it survives a restart, it travels
 * into duplicates and restored generations, and the JSON export carries the
 * normalised values for the print view.
 */
import { DEFAULT_PAGE_SETTINGS, Y_PAGE_FIELD } from '@realtimedocs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  connectCollab,
  createFixture,
  sleep,
  until,
  type CollabClient,
  type DocumentBody,
  type Fixture,
} from './harness';

let fx: Fixture;
let editorA: Awaited<ReturnType<Fixture['createUser']>>;
let editorB: Awaited<ReturnType<Fixture['createUser']>>;

beforeAll(async () => {
  fx = await createFixture('page-settings');
  editorA = await fx.createUser('Asha Editor');
  editorB = await fx.createUser('Miguel Editor');
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

async function newDocument(title: string): Promise<string> {
  const documentId = await fx.createDocument(title);
  for (const editor of [editorA, editorB]) {
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
    );
  }
  return documentId;
}

const pageOf = (client: CollabClient): Record<string, unknown> =>
  client.doc.getMap(Y_PAGE_FIELD).toJSON();

function setPage(client: CollabClient, values: Record<string, unknown>): void {
  client.edit(() => {
    const map = client.doc.getMap(Y_PAGE_FIELD);
    for (const [key, value] of Object.entries(values)) map.set(key, value);
  });
}

async function exported(documentId: string): Promise<Record<string, unknown>> {
  const response = await fx.admin.get<Record<string, unknown>>(
    `/api/documents/${documentId}/export?format=json`,
  );
  expect(response.status).toBe(200);
  return response.body;
}

describe('page settings', () => {
  it('syncs between editors, refuses a read-only connection, and shows in the JSON export', async () => {
    const documentId = await newDocument('Page settings');
    const a = await connectCollab(editorA, documentId);
    const b = await connectCollab(editorB, documentId);
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const viewer = await connectCollab(guest, documentId);
    expect(viewer.authenticatedScope).toBe('readonly');

    // A fresh document has no settings at all: defaults.
    expect(pageOf(a)).toEqual({});
    expect((await exported(documentId)).pageSettings).toEqual(DEFAULT_PAGE_SETTINGS);

    setPage(a, { marginLeft: 30, marginRight: 20, size: 'letter', orientation: 'landscape' });
    await a.save();
    await until(() => pageOf(b).marginLeft === 30, { what: 'editor B receives the margins' });
    await until(() => pageOf(viewer).marginLeft === 30, { what: 'the viewer receives them' });
    expect(pageOf(b)).toEqual({
      marginLeft: 30,
      marginRight: 20,
      size: 'letter',
      orientation: 'landscape',
    });

    // Concurrent changes of different keys converge on both sides.
    setPage(a, { marginTop: 11 });
    setPage(b, { background: 'cream' });
    await Promise.all([a.save(), b.save()]);
    await until(() => pageOf(a).background === 'cream' && pageOf(b).marginTop === 11, {
      what: 'both changes arrive',
    });
    expect(pageOf(a)).toEqual(pageOf(b));

    // A viewer's attempt: refused, the connection is told it is read-only, nothing changes.
    viewer.doc.transact(() => viewer.doc.getMap(Y_PAGE_FIELD).set('marginLeft', 90));
    viewer.mark();
    await sleep(1_000);
    expect(pageOf(a).marginLeft).toBe(30);
    const fresh = await connectCollab(fx.admin, documentId);
    expect(pageOf(fresh).marginLeft).toBe(30);
    fresh.destroy();

    // The export carries normalised values, whatever a client wrote.
    setPage(a, { headerSpacing: 'DROP', marginBottom: 1e9 });
    await a.save();
    const body = await exported(documentId);
    expect(body.type).toBe('doc');
    expect(body.pageSettings).toMatchObject({
      marginLeft: 30,
      marginRight: 20,
      marginTop: 11,
      marginBottom: 100,
      size: 'letter',
      orientation: 'landscape',
      background: 'cream',
      headerSpacing: DEFAULT_PAGE_SETTINGS.headerSpacing,
    });
    for (const client of [a, b, viewer]) client.destroy();
  });

  it('survives a server restart and is loaded from the database', async () => {
    const documentId = await newDocument('Page settings restart');
    const a = await connectCollab(editorA, documentId);
    setPage(a, { marginLeft: 33, unit: 'in' });
    await a.save();
    a.destroy();

    await fx.server.stop();
    await fx.server.start();
    await fx.admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await editorA.login(editorA.email, editorA.password);

    const again = await connectCollab(editorA, documentId);
    expect(pageOf(again)).toEqual({ marginLeft: 33, unit: 'in' });
    again.destroy();
    expect((await exported(documentId)).pageSettings).toMatchObject({
      marginLeft: 33,
      unit: 'in',
    });
  });

  it('is carried into a duplicate and into a restored generation', async () => {
    const documentId = await newDocument('Page settings copy');
    const a = await connectCollab(editorA, documentId);
    a.appendParagraph('some text');
    setPage(a, { marginLeft: 40, size: 'letter' });
    await a.save();

    const duplicated = await fx.admin.post<DocumentBody>(`/api/documents/${documentId}/duplicate`);
    expect(duplicated.status).toBe(201);
    const copy = await exported(duplicated.body.document.id);
    expect(copy.pageSettings).toMatchObject({ marginLeft: 40, size: 'letter' });
    const copyClient = await connectCollab(fx.admin, duplicated.body.document.id);
    expect(pageOf(copyClient)).toEqual({ marginLeft: 40, size: 'letter' });
    copyClient.destroy();

    const snapshot = await fx.admin.post<{ snapshot: { id: string } }>(
      `/api/documents/${documentId}/snapshots`,
      { name: 'With margins' },
    );
    expect(snapshot.status).toBe(201);
    setPage(a, { marginLeft: 70, size: 'a4' });
    await a.save();
    a.destroy();

    const restored = await fx.admin.post<DocumentBody>(
      `/api/documents/${documentId}/snapshots/${snapshot.body.snapshot.id}/restore`,
    );
    expect(restored.status).toBe(200);
    expect(restored.body.document.generation).toBe(2);
    const after = await connectCollab(fx.admin, documentId);
    expect(pageOf(after)).toEqual({ marginLeft: 40, size: 'letter' });
    after.destroy();
    expect((await exported(documentId)).pageSettings).toMatchObject({
      marginLeft: 40,
      size: 'letter',
    });
  });
});
