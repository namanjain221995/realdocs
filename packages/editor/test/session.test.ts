// @vitest-environment node
/**
 * CollabSession against a real Hocuspocus server (test/fixture-server.ts).
 * Nothing in the session, the provider or the server is mocked; only the
 * "database" behind the fixture's durable log is an in-memory fake that the
 * tests can hold, delay or fail.
 */
// Installs the IndexedDB globals `idb` checks against; each test still gets its own factory.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  clearLocalDataForAccount,
  hasLocalDataForAccount,
  listRecoveryDrafts,
  loadRecoveryDraftJSON,
} from '../src/collab/localStore';
import { hasUnsavedChanges } from '../src/collab/session';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  addEditor,
  appendParagraph,
  deleteBlock,
  deleteText,
  jsonParagraphs,
  live,
  liveAndSaved,
  paragraphDoc,
  paragraphs,
  recordStatuses,
  scenario,
  sleep,
  waitFor,
  waitForAsync,
  waitForStatus,
  type Scenario,
} from './helpers';

let fixture: FixtureServer;
let scene: Scenario;
let idb: IDBFactory;

beforeEach(async () => {
  fixture = await startFixtureServer();
  idb = new IDBFactory();
  scene = scenario(fixture, paragraphDoc('Agenda', 'Owners'), idb);
});

afterEach(async () => {
  for (const session of scene.sessions) session.destroy();
  fixture.db.release();
  await fixture.stop();
});

describe('connection and convergence', () => {
  it('loads server-initialised content and reports Live · Saved for an editor', async () => {
    const session = scene.open(scene.editor);
    expect(session.getStatus().connection).toBe('connecting');
    expect(session.getStatus().ready).toBe(false);
    const status = await waitForStatus(session, liveAndSaved, 'editor live');
    expect(status.ready).toBe(true);
    expect(status.role).toBe('editor');
    expect(status.canEdit).toBe(true);
    expect(status.generation).toBe(1);
    expect(status.pendingChanges).toBe(0);
    expect(paragraphs(session.ydoc)).toEqual(['Agenda', 'Owners']);
    // The client never initialises content: nothing was written by connecting.
    expect(fixture.db.log.get(fixture.room(scene.documentId))).toHaveLength(1);
  });

  it('requests a new ticket for every connection attempt', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, live, 'first connection');
    expect(fixture.ticketRequests).toBe(1);
    fixture.dropConnections();
    await waitForStatus(session, (s) => s.connection === 'reconnecting', 'reconnecting');
    await waitForStatus(session, live, 'second connection');
    expect(fixture.ticketRequests).toBe(2);
  });

  it('two editors converge on concurrent edits without loss or duplication', async () => {
    const other = addEditor(scene, 'Miguel (editor)');
    const a = scene.open(scene.editor);
    const b = scene.open(other);
    await waitForStatus(a, liveAndSaved, 'a live');
    await waitForStatus(b, liveAndSaved, 'b live');

    // Overlapping edits in the same tick, before either has seen the other's.
    appendParagraph(a.ydoc, 'from A 1');
    appendParagraph(b.ydoc, 'from B 1');
    deleteText(a.ydoc, 0, 0, 2); // "Agenda" -> "enda"
    appendParagraph(b.ydoc, 'from B 2');
    appendParagraph(a.ydoc, 'from A 2');

    await waitForStatus(a, liveAndSaved, 'a saved');
    await waitForStatus(b, liveAndSaved, 'b saved');
    await waitFor(
      () => JSON.stringify(paragraphs(a.ydoc)) === JSON.stringify(paragraphs(b.ydoc)),
      'documents converge',
    );
    const result = paragraphs(a.ydoc);
    expect(result).toHaveLength(6);
    expect(result.slice(0, 2)).toEqual(['enda', 'Owners']);
    expect([...result].sort()).toEqual(
      ['Owners', 'enda', 'from A 1', 'from A 2', 'from B 1', 'from B 2'].sort(),
    );
    expect(paragraphs(fixture.db.durableDoc(fixture.room(scene.documentId)))).toEqual(result);
  });
});

describe('durable acknowledgement', () => {
  it('shows Saved only after the server committed the change', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    const room = fixture.room(scene.documentId);
    const record = recordStatuses(session);
    const savedBefore = session.getStatus().lastSavedAt;

    fixture.db.hold();
    appendParagraph(session.ydoc, 'held back');
    expect(session.getStatus().save).toBe('saving');
    expect(session.getStatus().pendingChanges).toBe(1);

    // The update reaches the server (and is broadcast) long before it is durable.
    await waitFor(
      () => paragraphs(fixture.liveDocument(scene.documentId) as Y.Doc).includes('held back'),
      'server applied the update',
    );
    await waitForStatus(session, (s) => !s.unsynced, 'provider reports the update as applied');
    await sleep(120);
    // Connected and synced, but not committed: never "saved".
    expect(session.getStatus().connection).toBe('live');
    expect(session.getStatus().save).toBe('saving');
    expect(paragraphs(fixture.db.durableDoc(room))).not.toContain('held back');
    expect(record.seen.slice(1).every((status) => status.save !== 'saved')).toBe(true);
    expect(hasUnsavedChanges(session)).toBe(true);

    fixture.db.release();
    const saved = await waitForStatus(session, liveAndSaved, 'saved after commit');
    expect(saved.pendingChanges).toBe(0);
    expect(saved.lastSavedAt).not.toBe(savedBefore);
    expect(paragraphs(fixture.db.durableDoc(room))).toContain('held back');
    expect(hasUnsavedChanges(session)).toBe(false);
    record.stop();
  });

  it('acknowledges a deletion-only edit, which a state vector cannot show', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    const room = fixture.room(scene.documentId);

    const vectorBefore = Y.encodeStateVector(session.ydoc);
    fixture.db.hold();
    deleteBlock(session.ydoc, 1); // removes "Owners"; inserts nothing
    const vectorAfter = Y.encodeStateVector(session.ydoc);
    expect(Buffer.from(vectorAfter).equals(Buffer.from(vectorBefore))).toBe(true);

    // State vectors of client and server are equal the whole time, yet the
    // deletion is not durable until the commit happens.
    expect(session.getStatus().pendingChanges).toBe(1);
    await sleep(100);
    expect(session.getStatus().save).toBe('saving');
    expect(paragraphs(fixture.db.durableDoc(room))).toEqual(['Agenda', 'Owners']);

    fixture.db.release();
    await waitForStatus(session, liveAndSaved, 'deletion saved');
    expect(paragraphs(fixture.db.durableDoc(room))).toEqual(['Agenda']);
  });

  it('reports a commit failure as error, never as saved, and recovers', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    const room = fixture.room(scene.documentId);
    const record = recordStatuses(session);

    fixture.db.failing = true;
    appendParagraph(session.ydoc, 'during outage');
    const failed = await waitForStatus(session, (s) => s.save === 'error', 'save error');
    expect(failed.saveError).toEqual({ code: 'storage_unavailable', retrying: true });
    expect(failed.pendingChanges).toBe(1);
    expect(failed.connection).toBe('live');
    await sleep(150);
    expect(fixture.db.failures).toBeGreaterThan(1);
    expect(record.seen.slice(1).every((status) => status.save !== 'saved')).toBe(true);
    expect(paragraphs(fixture.db.durableDoc(room))).not.toContain('during outage');

    // More work during the outage stays pending too.
    deleteText(session.ydoc, 0, 0, 1);
    expect(session.getStatus().pendingChanges).toBe(2);

    fixture.db.failing = false;
    const recovered = await waitForStatus(session, liveAndSaved, 'recovered');
    expect(recovered.saveError).toBeNull();
    expect(paragraphs(fixture.db.durableDoc(room))).toEqual(['genda', 'Owners', 'during outage']);
    record.stop();
  });

  it('whenSaved resolves after the acknowledgement and rejects in terminal states', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    await expect(session.whenSaved()).resolves.toBeUndefined();

    fixture.db.hold();
    appendParagraph(session.ydoc, 'wait for me');
    let settled = false;
    const pending = session.whenSaved().then(() => {
      settled = true;
    });
    await sleep(80);
    expect(settled).toBe(false);
    await expect(session.whenSaved(30)).rejects.toThrow(/Timed out/);
    fixture.db.release();
    await pending;
    expect(settled).toBe(true);

    fixture.db.hold();
    appendParagraph(session.ydoc, 'never confirmed');
    const doomed = session.whenSaved();
    fixture.revoke(scene.editor);
    await expect(doomed).rejects.toThrow(/access_revoked/);
  });

  it('resends the proof when the server asks for a resync', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    fixture.db.hold();
    appendParagraph(session.ydoc, 'needs proof');
    await sleep(30);
    fixture.broadcast(scene.documentId, { t: 'resync', n: 1 });
    await sleep(60);
    expect(session.getStatus().save).toBe('saving');
    fixture.db.release();
    await waitForStatus(session, liveAndSaved, 'saved after resync');
    expect(paragraphs(fixture.db.durableDoc(fixture.room(scene.documentId)))).toContain(
      'needs proof',
    );
  });
});

describe('offline work and reconnection', () => {
  it('keeps offline edits pending and saves them after the hello proof', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    const room = fixture.room(scene.documentId);

    fixture.setOffline(true);
    await waitForStatus(session, (s) => s.connection === 'reconnecting', 'reconnecting');
    appendParagraph(session.ydoc, 'written offline');
    deleteBlock(session.ydoc, 0); // deletion-only, also offline
    const offline = session.getStatus();
    expect(offline.save).toBe('pending');
    expect(offline.pendingChanges).toBe(2);
    await waitForStatus(session, (s) => s.reconnectAttempt >= 2, 'retrying with backoff');
    expect(session.getStatus().nextRetryAt).not.toBeNull();
    expect(session.getStatus().save).toBe('pending');
    expect(paragraphs(fixture.db.durableDoc(room))).toEqual(['Agenda', 'Owners']);

    fixture.setOffline(false);
    session.retryNow();
    const saved = await waitForStatus(session, liveAndSaved, 'saved after reconnect');
    expect(saved.reconnectAttempt).toBe(0);
    expect(saved.nextRetryAt).toBeNull();
    expect(paragraphs(fixture.db.durableDoc(room))).toEqual(['Owners', 'written offline']);
  });

  it('does not report offline work as saved while the reconnect commit is still open', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    fixture.setOffline(true);
    await waitForStatus(session, (s) => s.connection === 'reconnecting', 'reconnecting');
    appendParagraph(session.ydoc, 'offline work');
    const record = recordStatuses(session);

    fixture.db.hold();
    fixture.setOffline(false);
    session.retryNow();
    await waitForStatus(session, live, 'live again');
    await waitFor(
      () => paragraphs(fixture.liveDocument(scene.documentId) as Y.Doc).includes('offline work'),
      'server received the offline work',
    );
    await sleep(80);
    expect(session.getStatus().save).toBe('saving');
    expect(record.seen.every((status) => status.save !== 'saved')).toBe(true);
    fixture.db.release();
    await waitForStatus(session, liveAndSaved, 'saved');
    record.stop();
  });

  it('keeps retrying transient ticket failures and connects when the server recovers', async () => {
    fixture.busy = true;
    const session = scene.open(scene.editor);
    await waitForStatus(session, (s) => s.reconnectAttempt >= 3, 'backing off');
    expect(session.getStatus().connection).toBe('reconnecting');
    fixture.busy = false;
    await waitForStatus(session, liveAndSaved, 'connected');
  });
});

describe('roles and access', () => {
  it('a viewer is read-only and cannot change the shared document', async () => {
    const editor = scene.open(scene.editor);
    const viewer = scene.open(scene.viewer);
    await waitForStatus(editor, liveAndSaved, 'editor live');
    const status = await waitForStatus(viewer, live, 'viewer live');
    expect(status.role).toBe('viewer');
    expect(status.canEdit).toBe(false);
    expect(status.save).toBe('read_only');
    expect(paragraphs(viewer.ydoc)).toEqual(['Agenda', 'Owners']);

    // A hostile client that bypasses the editor and writes into its Y.Doc.
    appendParagraph(viewer.ydoc, 'forged by viewer');
    deleteBlock(viewer.ydoc, 0);
    await sleep(150);
    const room = fixture.room(scene.documentId);
    expect(paragraphs(fixture.liveDocument(scene.documentId) as Y.Doc)).toEqual([
      'Agenda',
      'Owners',
    ]);
    expect(paragraphs(fixture.db.durableDoc(room))).toEqual(['Agenda', 'Owners']);
    expect(paragraphs(editor.ydoc)).toEqual(['Agenda', 'Owners']);
    expect(fixture.readOnlyViolations).toBe(0);
    expect(viewer.getStatus().save).not.toBe('saved');

    // Live content still flows to the viewer.
    appendParagraph(editor.ydoc, 'real edit');
    await waitFor(() => paragraphs(viewer.ydoc).includes('real edit'), 'viewer receives edits');
  });

  it('revocation ends the session without reconnecting', async () => {
    const session = scene.open(scene.viewer);
    await waitForStatus(session, live, 'viewer live');
    const ticketsBefore = fixture.ticketRequests;

    fixture.revoke(scene.viewer);
    const status = await waitForStatus(
      session,
      (s) => s.connection === 'access_revoked',
      'access revoked',
    );
    expect(status.canEdit).toBe(false);
    expect(status.nextRetryAt).toBeNull();
    await sleep(300);
    expect(fixture.ticketRequests).toBe(ticketsBefore);
    expect(fixture.connectionCount(scene.documentId)).toBe(0);
    session.retryNow();
    await sleep(100);
    expect(fixture.ticketRequests).toBe(ticketsBefore);
    expect(session.getStatus().connection).toBe('access_revoked');
  });

  it('a revoked principal that opens the document gets access_revoked from the ticket', async () => {
    fixture.revoke(scene.viewer);
    const session = scene.open(scene.viewer);
    await waitForStatus(session, (s) => s.connection === 'access_revoked', 'access revoked');
    expect(fixture.ticketRequests).toBe(1);
  });

  it('expiry ends the session as access_expired', async () => {
    const session = scene.open(scene.viewer);
    await waitForStatus(session, live, 'viewer live');
    fixture.expire(scene.viewer);
    await waitForStatus(session, (s) => s.connection === 'access_expired', 'access expired');
    const again = scene.open(scene.viewer);
    await waitForStatus(again, (s) => s.connection === 'access_expired', 'expired on open');
  });

  it('a trashed document becomes document_unavailable', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    fixture.trash(scene.documentId);
    await waitForStatus(
      session,
      (s) => s.connection === 'document_unavailable',
      'document unavailable',
    );
    const again = scene.open(scene.editor);
    await waitForStatus(again, (s) => s.connection === 'document_unavailable', 'on open');
  });

  it('an outdated client stops in update_required', async () => {
    const record = fixture.documents.get(scene.documentId);
    if (!record) throw new Error('missing document');
    record.schemaVersion = 99;
    const session = scene.open(scene.editor);
    const status = await waitForStatus(
      session,
      (s) => s.connection === 'update_required',
      'update required',
    );
    expect(status.ready).toBe(false);
    expect(paragraphs(session.ydoc)).toEqual([]);
  });

  it('switches editability live when the role changes', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    const ticketsBefore = fixture.ticketRequests;

    fixture.setRole(scene.editor, scene.documentId, 'viewer');
    const downgraded = await waitForStatus(session, (s) => s.role === 'viewer', 'downgraded');
    expect(downgraded.canEdit).toBe(false);
    expect(downgraded.save).toBe('read_only');
    expect(downgraded.connection).toBe('live');
    expect(downgraded.notices.map((notice) => notice.kind)).toEqual(['role_changed']);
    expect(downgraded.self?.role).toBe('viewer');
    // Nothing was pending, so the connection is reused and no draft is made.
    expect(fixture.ticketRequests).toBe(ticketsBefore);
    expect(session.getStatus().notices.some((notice) => notice.kind === 'draft_saved')).toBe(false);

    fixture.setRole(scene.editor, scene.documentId, 'editor');
    const upgraded = await waitForStatus(
      session,
      (s) => s.role === 'editor' && s.connection === 'live' && s.canEdit,
      'upgraded',
    );
    expect(upgraded.save).toBe('saved');
    // The newer notice replaces "view only": two contradicting banners never stay side by side.
    const roleNotices = upgraded.notices.filter((notice) => notice.kind === 'role_changed');
    expect(roleNotices).toHaveLength(1);
    expect(roleNotices[0]?.role).toBe('editor');
    expect(roleNotices[0]?.id).not.toBe(downgraded.notices[0]?.id);
    appendParagraph(session.ydoc, 'after upgrade');
    await waitForStatus(session, liveAndSaved, 'saved after upgrade');
    expect(paragraphs(fixture.db.durableDoc(fixture.room(scene.documentId)))).toContain(
      'after upgrade',
    );
  });

  it('moves unacknowledged work to a draft when the role is downgraded live', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    const oldDoc = session.ydoc;
    fixture.db.hold();
    appendParagraph(session.ydoc, 'typed just before the downgrade');
    await sleep(30);
    expect(session.getStatus().pendingChanges).toBe(1);

    fixture.setRole(scene.editor, scene.documentId, 'viewer');
    const status = await waitForStatus(
      session,
      (s) => s.role === 'viewer' && s.connection === 'live' && s.ready,
      'viewer on a clean copy',
    );
    expect(session.ydoc).not.toBe(oldDoc);
    expect(status.canEdit).toBe(false);
    expect(status.save).toBe('read_only');
    expect(status.pendingChanges).toBe(0);
    expect(status.notices.map((notice) => notice.kind).sort()).toEqual([
      'draft_saved',
      'role_changed',
    ]);
    const draftId = status.notices.find((notice) => notice.kind === 'draft_saved')?.draftId ?? '';
    const draft = await waitForAsync(() => loadRecoveryDraftJSON(draftId, idb), 'draft stored');
    expect(jsonParagraphs(draft)).toContain('typed just before the downgrade');
    fixture.db.release();
  });

  it('keeps unsent work as a draft when edit access is removed, without publishing it', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    const replaced: Y.Doc[] = [];
    session.onDocumentReplaced((doc) => replaced.push(doc));
    const oldDoc = session.ydoc;

    fixture.setOffline(true);
    await waitForStatus(session, (s) => s.connection === 'reconnecting', 'reconnecting');
    appendParagraph(session.ydoc, 'secret offline draft');
    fixture.setRole(scene.editor, scene.documentId, 'viewer');
    fixture.setOffline(false);
    session.retryNow();

    const status = await waitForStatus(
      session,
      (s) => s.connection === 'live' && s.role === 'viewer',
      'reconnected as viewer',
    );
    expect(status.save).toBe('read_only');
    expect(status.pendingChanges).toBe(0);
    expect(replaced).toHaveLength(1);
    expect(session.ydoc).not.toBe(oldDoc);
    expect(paragraphs(session.ydoc)).toEqual(['Agenda', 'Owners']);
    const room = fixture.room(scene.documentId);
    expect(paragraphs(fixture.db.durableDoc(room))).toEqual(['Agenda', 'Owners']);
    expect(paragraphs(fixture.liveDocument(scene.documentId) as Y.Doc)).toEqual([
      'Agenda',
      'Owners',
    ]);

    const notice = status.notices.find((entry) => entry.kind === 'draft_saved');
    expect(notice?.draftId).toBeDefined();
    const draft = await waitForAsync(
      () => loadRecoveryDraftJSON(notice?.draftId ?? '', idb),
      'draft stored',
    );
    expect(jsonParagraphs(draft)).toEqual(['Agenda', 'Owners', 'secret offline draft']);
    const drafts = await listRecoveryDrafts(scene.editor.accountId ?? '', idb);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      documentId: scene.documentId,
      documentTitle: 'Launch notes',
      reason: 'access_removed',
      generation: 1,
    });
  });
});

describe('generation change (snapshot restore)', () => {
  it('starts a fresh document, keeps unsaved work as a draft and never merges it', async () => {
    const session = scene.open(scene.editor);
    const reader = scene.open(scene.viewer);
    await waitForStatus(session, liveAndSaved, 'editor live');
    await waitForStatus(reader, live, 'viewer live');
    appendParagraph(session.ydoc, 'saved in generation 1');
    await waitForStatus(session, liveAndSaved, 'saved');

    const replaced: Y.Doc[] = [];
    session.onDocumentReplaced((doc) => replaced.push(doc));
    const oldDoc = session.ydoc;
    const oldAwareness = session.awareness;

    // Unacknowledged work exists when the administrator restores a snapshot.
    fixture.db.hold();
    appendParagraph(session.ydoc, 'unsaved in generation 1');
    await sleep(30);
    expect(session.getStatus().pendingChanges).toBe(1);
    const generation = fixture.restore(scene.documentId, paragraphDoc('Restored snapshot'));
    fixture.db.release();
    expect(generation).toBe(2);

    const status = await waitForStatus(
      session,
      (s) => s.generation === 2 && s.connection === 'live' && s.ready,
      'editor moved to generation 2',
    );
    expect(replaced).toHaveLength(1);
    expect(session.ydoc).toBe(replaced[0]);
    expect(session.ydoc).not.toBe(oldDoc);
    expect(session.awareness).not.toBe(oldAwareness);
    expect(session.ydoc.clientID).not.toBe(oldDoc.clientID);
    expect(status.pendingChanges).toBe(0);
    expect(status.save).toBe('saved');
    expect(paragraphs(session.ydoc)).toEqual(['Restored snapshot']);

    const notice = status.notices.find((entry) => entry.kind === 'restored');
    expect(notice?.message).toMatch(/restored/i);
    expect(notice?.draftId).toBeDefined();
    const draft = await waitForAsync(
      () => loadRecoveryDraftJSON(notice?.draftId ?? '', idb),
      'draft stored',
    );
    expect(jsonParagraphs(draft)).toEqual([
      'Agenda',
      'Owners',
      'saved in generation 1',
      'unsaved in generation 1',
    ]);
    const drafts = await listRecoveryDrafts(scene.editor.accountId ?? '', idb);
    expect(drafts.map((entry) => entry.reason)).toEqual(['generation_restored']);
    expect(drafts[0]?.generation).toBe(1);

    // The abandoned generation is not resurrected anywhere.
    const newRoom = fixture.room(scene.documentId);
    expect(paragraphs(fixture.db.durableDoc(newRoom))).toEqual(['Restored snapshot']);
    await waitForStatus(
      reader,
      (s) => s.generation === 2 && s.connection === 'live',
      'viewer moved',
    );
    expect(paragraphs(reader.ydoc)).toEqual(['Restored snapshot']);
    // A viewer had nothing unsaved: it is told about the restore, without a draft.
    const viewerNotice = reader.getStatus().notices.find((entry) => entry.kind === 'restored');
    expect(viewerNotice).toBeDefined();
    expect(viewerNotice?.draftId).toBeUndefined();

    // Work continues normally in the new generation.
    appendParagraph(session.ydoc, 'new work');
    await waitForStatus(session, liveAndSaved, 'saved in generation 2');
    expect(paragraphs(fixture.db.durableDoc(newRoom))).toEqual(['Restored snapshot', 'new work']);
    session.dismissNotice(notice?.id ?? '');
    expect(session.getStatus().notices.some((entry) => entry.kind === 'restored')).toBe(false);
  });

  it('a client that was offline during the restore cannot push stale work into the new generation', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    fixture.setOffline(true);
    await waitForStatus(session, (s) => s.connection === 'reconnecting', 'reconnecting');
    appendParagraph(session.ydoc, 'stale offline work');
    deleteBlock(session.ydoc, 0);
    fixture.restore(scene.documentId, paragraphDoc('Restored while offline'));
    fixture.setOffline(false);
    session.retryNow();

    const status = await waitForStatus(
      session,
      (s) => s.generation === 2 && s.connection === 'live' && s.save === 'saved',
      'moved to generation 2',
    );
    expect(paragraphs(session.ydoc)).toEqual(['Restored while offline']);
    expect(paragraphs(fixture.db.durableDoc(fixture.room(scene.documentId)))).toEqual([
      'Restored while offline',
    ]);
    const notice = status.notices.find((entry) => entry.kind === 'restored');
    const draft = await waitForAsync(
      () => loadRecoveryDraftJSON(notice?.draftId ?? '', idb),
      'draft stored',
    );
    expect(jsonParagraphs(draft)).toEqual(['Owners', 'stale offline work']);
  });
});

describe('device-local persistence', () => {
  it('keeps pending work across a reload while offline and saves it after reconnecting', async () => {
    const first = scene.open(scene.editor);
    await waitForStatus(first, liveAndSaved, 'live');
    fixture.setOffline(true);
    await waitForStatus(first, (s) => s.connection === 'reconnecting', 'reconnecting');
    appendParagraph(first.ydoc, 'typed before the reload');
    deleteBlock(first.ydoc, 0);
    expect(first.getStatus().save).toBe('pending');
    await sleep(40);
    // Simulated reload: the page (and every in-memory object) goes away.
    first.destroy();
    await sleep(20);
    expect(await hasLocalDataForAccount(scene.editor.accountId ?? '', idb)).toBe(true);

    const second = scene.open(scene.editor);
    const restored = await waitForStatus(
      second,
      (s) => s.pendingChanges > 0 && s.canEdit,
      'local replica loaded',
    );
    expect(restored.ready).toBe(false);
    expect(restored.connection).not.toBe('live');
    expect(restored.save).toBe('pending');
    expect(restored.role).toBe('editor');
    expect(paragraphs(second.ydoc)).toEqual(['Owners', 'typed before the reload']);
    // Still offline: more work on top of the restored replica.
    appendParagraph(second.ydoc, 'typed after the reload');

    fixture.setOffline(false);
    second.retryNow();
    await waitForStatus(second, liveAndSaved, 'saved after reconnect');
    expect(paragraphs(fixture.db.durableDoc(fixture.room(scene.documentId)))).toEqual([
      'Owners',
      'typed before the reload',
      'typed after the reload',
    ]);
    await sleep(30);
    expect(await hasLocalDataForAccount(scene.editor.accountId ?? '', idb)).toBe(false);
  });

  it('does not expose one account’s local data to another and clears it on logout', async () => {
    const accountA = scene.editor;
    const accountB = addEditor(scene, 'Other account');
    const first = scene.open(accountA);
    await waitForStatus(first, liveAndSaved, 'live');
    fixture.setOffline(true);
    await waitForStatus(first, (s) => s.connection === 'reconnecting', 'reconnecting');
    appendParagraph(first.ydoc, 'private pending text of account A');
    await sleep(40);
    first.destroy();
    await sleep(20);

    // Account B opens the same document on the same device while offline.
    const second = scene.open(accountB);
    await sleep(120);
    expect(paragraphs(second.ydoc)).toEqual([]);
    expect(second.getStatus().pendingChanges).toBe(0);
    expect(second.getStatus().canEdit).toBe(false);
    expect(await hasLocalDataForAccount(accountB.accountId ?? '', idb)).toBe(false);
    expect(await listRecoveryDrafts(accountB.accountId ?? '', idb)).toEqual([]);
    second.destroy();

    expect(await hasLocalDataForAccount(accountA.accountId ?? '', idb)).toBe(true);
    await clearLocalDataForAccount(accountA.accountId ?? '', idb);
    expect(await hasLocalDataForAccount(accountA.accountId ?? '', idb)).toBe(false);
    const names = (await idb.databases()).map((info) => info.name ?? '');
    expect(names.some((name) => name.includes(accountA.accountId ?? 'missing'))).toBe(false);

    // After logout nothing of account A is restored.
    const third = scene.open(accountA);
    await sleep(120);
    expect(paragraphs(third.ydoc)).toEqual([]);
    expect(third.getStatus().pendingChanges).toBe(0);
  });

  it('stops writing for an account as soon as its local data is cleared', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    fixture.setOffline(true);
    await waitForStatus(session, (s) => s.connection === 'reconnecting', 'reconnecting');
    appendParagraph(session.ydoc, 'before logout');
    await sleep(30);
    await clearLocalDataForAccount(scene.editor.accountId ?? '', idb);
    appendParagraph(session.ydoc, 'after logout, session still mounted');
    await sleep(40);
    expect(await hasLocalDataForAccount(scene.editor.accountId ?? '', idb)).toBe(false);
  });

  it('a guest writes nothing to the device, even with unsaved work and a draft', async () => {
    const guest = fixture.addPrincipal({ name: 'Guest editor', accountId: null });
    fixture.grant(guest, scene.documentId, 'editor');
    const session = scene.open(guest);
    await waitForStatus(session, liveAndSaved, 'guest live');
    appendParagraph(session.ydoc, 'guest edit');
    await waitForStatus(session, liveAndSaved, 'guest saved');

    fixture.setOffline(true);
    await waitForStatus(session, (s) => s.connection === 'reconnecting', 'reconnecting');
    appendParagraph(session.ydoc, 'guest offline edit');
    fixture.restore(scene.documentId, paragraphDoc('Restored'));
    fixture.setOffline(false);
    session.retryNow();
    const status = await waitForStatus(
      session,
      (s) => s.generation === 2 && s.connection === 'live',
      'guest moved to generation 2',
    );
    await sleep(40);
    expect(await idb.databases()).toEqual([]);
    expect(await indexedDB.databases()).toEqual([]);

    // The draft is still reachable for this page lifetime (memory only).
    const notice = status.notices.find((entry) => entry.kind === 'restored');
    expect(notice?.message).toMatch(/draft/i);
    const draft = await loadRecoveryDraftJSON(notice?.draftId ?? '');
    expect(jsonParagraphs(draft ?? { type: 'doc' })).toContain('guest offline edit');
  });

  it('falls back to memory when IndexedDB cannot be opened', async () => {
    const broken = {
      open() {
        throw new Error('storage disabled');
      },
    } as unknown as IDBFactory;
    const session = scene.open(scene.editor, { indexedDB: broken });
    await waitForStatus(session, liveAndSaved, 'live without storage');
    appendParagraph(session.ydoc, 'works without storage');
    await waitForStatus(session, liveAndSaved, 'saved without storage');
  });
});

describe('presence', () => {
  it('lists server-attested participants and ignores client-supplied identities', async () => {
    const a = scene.open(scene.editor);
    const b = scene.open(scene.viewer);
    await waitForStatus(a, live, 'a live');
    await waitForStatus(b, live, 'b live');
    await waitForStatus(a, (s) => s.participants.length === 2, 'a sees both');
    await waitForStatus(b, (s) => s.participants.length === 2, 'b sees both');

    const fromA = a.getStatus();
    expect(fromA.self?.name).toBe('Asha (editor)');
    expect(fromA.participants[0]?.id).toBe(fromA.self?.id);
    expect(fromA.participants.map((p) => `${p.name}:${p.role}:${p.kind}`).sort()).toEqual([
      'Asha (editor):editor:user',
      'Guest reader:viewer:guest',
    ]);

    // A viewer that claims to be an administrator and publishes a cursor.
    b.awareness.setLocalState({
      user: { id: 'forged', name: 'Administrator', color: '#000000', role: 'admin', kind: 'user' },
      cursor: { anchor: { fake: 1 }, head: { fake: 1 } },
    });
    await sleep(120);
    const seen = a.getStatus().participants.find((p) => p.kind === 'guest');
    expect(seen).toMatchObject({ name: 'Guest reader', role: 'viewer' });
    expect(a.getStatus().participants.some((p) => p.name === 'Administrator')).toBe(false);
    const relayed = fixture.presence(scene.documentId) as {
      user?: { name?: string };
      cursor?: unknown;
    }[];
    const viewerState = relayed.find((state) => state.user?.name === 'Guest reader');
    expect(viewerState).toBeDefined();
    expect(viewerState?.cursor ?? null).toBeNull();

    // An editor's cursor is relayed.
    a.awareness.setLocalStateField('cursor', { anchor: { index: 1 }, head: { index: 1 } });
    await waitFor(() => {
      const states = [...b.awareness.getStates().values()] as { cursor?: unknown }[];
      return states.some((state) => state.cursor != null);
    }, 'editor cursor reaches the viewer');

    b.destroy();
    await waitForStatus(a, (s) => s.participants.length === 1, 'viewer left');
  });
});

describe('persistence health', () => {
  it('keeps edits pending while the server cannot accept them and saves after recovery', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    fixture.setPersistence(scene.documentId, 'degraded', false);
    const degraded = await waitForStatus(session, (s) => s.persistenceDegraded, 'degraded');
    expect(degraded.notices.map((notice) => notice.kind)).toEqual(['persistence_degraded']);
    expect(degraded.canEdit).toBe(true);

    const record = recordStatuses(session);
    appendParagraph(session.ydoc, 'kept locally');
    await sleep(60);
    // Even a (wrong) acknowledgement cannot turn refused work into "saved":
    // only a hello proof sent after the refusal counts.
    fixture.broadcast(scene.documentId, { t: 'saved', n: 99 });
    await sleep(60);
    expect(session.getStatus().save).toBe('pending');
    expect(session.getStatus().unsynced).toBe(true);
    expect(session.getStatus().connection).toBe('live');
    expect(record.seen.slice(1).every((status) => status.save !== 'saved')).toBe(true);
    record.stop();
    expect(paragraphs(fixture.liveDocument(scene.documentId) as Y.Doc)).not.toContain(
      'kept locally',
    );

    fixture.setPersistence(scene.documentId, 'ok', true);
    const recovered = await waitForStatus(
      session,
      (s) => !s.persistenceDegraded && s.save === 'saved',
      'recovered',
    );
    expect(recovered.notices.map((notice) => notice.kind)).toEqual(['persistence_restored']);
    expect(paragraphs(fixture.db.durableDoc(fixture.room(scene.documentId)))).toContain(
      'kept locally',
    );
  });
});

describe('cleanup', () => {
  it('destroy closes the connection and stops all activity', async () => {
    const session = scene.open(scene.editor);
    await waitForStatus(session, liveAndSaved, 'live');
    let notified = 0;
    session.subscribe(() => {
      notified += 1;
    });
    session.destroy();
    await waitFor(() => fixture.connectionCount(scene.documentId) === 0, 'connection closed');
    const tickets = fixture.ticketRequests;
    appendParagraph(session.ydoc, 'after destroy');
    await sleep(150);
    expect(notified).toBe(0);
    expect(fixture.ticketRequests).toBe(tickets);
    await expect(session.whenSaved()).rejects.toThrow(/closed/);
  });
});
