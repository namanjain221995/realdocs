/**
 * Version history against the real server and PostgreSQL: every committed
 * change has an authenticated actor and server timestamps, a revision can be
 * rebuilt and compared, restoring moves the head forward without removing
 * anything, and only people who manage the document can read it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  Agent,
  connectCollab,
  createFixture,
  demoPng,
  sleep,
  until,
  type Fixture,
} from './harness';

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture('history', { env: { HISTORY_CHECKPOINT_EVERY: '3' } });
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

interface Entry {
  revision: number;
  generation: number;
  kind: string;
  operation: string;
  actor: { kind: string; userId: string | null; name: string; role: string | null };
  receivedAt: string;
  committedAt: string;
  clientOccurredAt: string | null;
  contentSizeDelta: number;
  summary: Record<string, unknown>;
  attachmentIds: string[];
}

interface HistoryBody {
  entries: Entry[];
  nextBefore: number | null;
  events: { action: string }[];
}

const history = async (agent: Agent, documentId: string, query = ''): Promise<HistoryBody> =>
  agent.ok(agent.get<HistoryBody>(`/api/documents/${documentId}/history${query}`));

describe('attribution', () => {
  it('records who changed what, with server time, for an account and for a link guest', async () => {
    const documentId = await fx.createDocument('Attributed');
    const member = await fx.createUser('Mia Member');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${member.userId}`, { role: 'editor' }),
    );
    const share = await fx.createShare(documentId, { role: 'editor' });
    const guest = await fx.guest(share.id, share.secret);

    const started = Date.now();
    const a = await connectCollab(fx.admin, documentId);
    a.appendParagraph('written by the administrator');
    await a.save();
    const b = await connectCollab(member, documentId);
    b.appendParagraph('written by the member');
    await b.save();
    const c = await connectCollab(guest, documentId);
    // A paste, announced by the client and then sent.
    c.send({ t: 'hint', kind: 'paste', at: 1_700_000_000_000 });
    c.appendParagraph('pasted by the guest');
    await c.save();
    b.deleteBlock(1);
    await b.save();
    for (const client of [a, b, c]) client.destroy();

    const body = await history(fx.admin, documentId);
    const entries = [...body.entries].reverse();
    expect(entries.map((entry) => [entry.operation, entry.actor.kind])).toEqual([
      ['baseline', 'system'],
      ['text_inserted', 'user'],
      ['text_inserted', 'user'],
      ['paste', 'guest'],
      ['text_deleted', 'user'],
    ]);
    const [, byAdmin, byMember, byGuest, deletion] = entries;
    expect(byAdmin?.actor).toMatchObject({ userId: fx.admin.userId, role: 'admin' });
    expect(byMember?.actor).toMatchObject({
      userId: member.userId,
      name: 'Mia Member',
      role: 'editor',
    });
    expect(byGuest?.actor.userId).toBeNull();
    // The client's clock is kept as information; the server's clocks are its own.
    expect(byGuest?.clientOccurredAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(deletion?.contentSizeDelta).toBe(-'written by the administrator'.length);
    for (const entry of entries) {
      const received = Date.parse(entry.receivedAt);
      const committed = Date.parse(entry.committedAt);
      expect(received).toBeGreaterThanOrEqual(started - 1000);
      expect(committed).toBeGreaterThanOrEqual(received - 5);
      expect(committed).toBeLessThanOrEqual(Date.now() + 1000);
    }
    // Revisions are gap-free and monotonic, and no row holds document text.
    expect(entries.map((entry) => entry.revision)).toEqual([1, 2, 3, 4, 5]);
    expect(JSON.stringify(body)).not.toContain('written by');

    // Every durable update has its history rows: the two are written together.
    const [counts] = await fx.server.sql<{ head: string; hist: string; rows: string }>(
      `SELECT d.head_seq AS head, d.history_seq AS hist,
              (SELECT count(*) FROM doc_history h WHERE h.document_id = d.id) AS rows
         FROM documents d WHERE d.id = $1`,
      [documentId],
    );
    expect(Number(counts?.hist)).toBe(Number(counts?.rows));
    expect(Number(counts?.head)).toBe(4);

    // Filters.
    const byName = await history(fx.admin, documentId, '?actor=mia');
    expect(byName.entries.map((entry) => entry.operation)).toEqual([
      'text_deleted',
      'text_inserted',
    ]);
    const pastes = await history(fx.admin, documentId, '?operation=paste');
    expect(pastes.entries).toHaveLength(1);
    const paged = await history(fx.admin, documentId, '?limit=2');
    expect(paged.nextBefore).toBe(4);
    const next = await history(fx.admin, documentId, `?limit=2&before=${paged.nextBefore}`);
    expect(next.entries.map((entry) => entry.revision)).toEqual([3, 2]);
    // Looking at the history is itself on record.
    expect(body.events.map((event) => event.action)).toContain('document.created');
    // Events that target the document and events that only name it in their details (the share
    // link) are both listed, each once, newest first, and other documents' events are not.
    const actions = body.events.map((event) => event.action);
    expect(actions).toContain('share.created');
    const ids = (body.events as unknown as { id: string }[]).map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    const times = (body.events as unknown as { at: string }[]).map((event) => Date.parse(event.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const other = await fx.createDocument('Another document');
    await fx.createShare(other, { role: 'viewer' });
    const again = await history(fx.admin, documentId);
    const expected = await fx.server.sql<{ id: string }>(
      `SELECT id FROM audit_events
        WHERE target_id = $1 OR details ->> 'documentId' = $1
        ORDER BY at DESC, id`,
      [documentId],
    );
    // (Looking at the history writes an event itself, after the list was read: compare the
    // rows the response holds, in the order the database gives them.)
    const listed = (again.events as unknown as { id: string }[]).map((event) => event.id);
    expect(listed.length).toBeGreaterThanOrEqual(3);
    expect(expected.map((row) => row.id).filter((id) => listed.includes(id))).toEqual(listed);
    // The lookups use the indexes of migration 0005, not a scan of the audit log.
    const indexes = await fx.server.sql<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'audit_events'`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining(['audit_events_target_idx', 'audit_events_document_idx']),
    );
    const viewed = await fx.server.sql(
      `SELECT 1 FROM audit_events WHERE action = 'history.viewed' AND target_id = $1`,
      [documentId],
    );
    expect(viewed.length).toBeGreaterThan(0);

    // Only people who manage the document may read it.
    expect((await member.get(`/api/documents/${documentId}/history`)).status).toBe(403);
    expect((await guest.get(`/api/documents/${documentId}/history`)).status).toBe(403);
    expect((await member.get(`/api/documents/${documentId}/history/2`)).status).toBe(403);
    expect((await new Agent(fx.server).get(`/api/documents/${documentId}/history`)).status).toBe(
      401,
    );
  });

  it('a hint from a viewer is ignored and a hint is used once', async () => {
    const documentId = await fx.createDocument('Hints');
    const a = await connectCollab(fx.admin, documentId);
    a.send({ t: 'hint', kind: 'paste' });
    a.appendParagraph('one');
    await a.save();
    a.appendParagraph('two');
    await a.save();
    a.destroy();
    const body = await history(fx.admin, documentId);
    expect(body.entries.map((entry) => entry.operation)).toEqual([
      'text_inserted',
      'paste',
      'baseline',
    ]);
  });
});

describe('revisions', () => {
  it('shows what a revision changed and the document as it was', async () => {
    const documentId = await fx.createDocument('Revisions');
    const a = await connectCollab(fx.admin, documentId);
    a.appendParagraph('first line');
    await a.save();
    a.appendParagraph('second line');
    await a.save();
    a.deleteBlock(1);
    await a.save();
    a.destroy();

    interface Revision {
      entry: Entry;
      diff: { op: string; text: string }[];
      content: { content: { content?: { text: string }[] }[] };
    }
    const third = await fx.admin.ok(
      fx.admin.get<Revision>(`/api/documents/${documentId}/history/3`),
    );
    expect(third.diff.filter((line) => line.op !== 'equal')).toEqual([
      { op: 'insert', text: 'second line' },
    ]);
    const texts = (revision: Revision) =>
      revision.content.content.map((block) => block.content?.[0]?.text ?? '');
    expect(texts(third)).toEqual(['', 'first line', 'second line']);

    const fourth = await fx.admin.ok(
      fx.admin.get<Revision>(`/api/documents/${documentId}/history/4`),
    );
    expect(fourth.diff.filter((line) => line.op !== 'equal')).toEqual([
      { op: 'delete', text: 'first line' },
    ]);
    expect(texts(fourth)).toEqual(['', 'second line']);
    expect((await fx.admin.get(`/api/documents/${documentId}/history/999`)).status).toBe(404);
    expect((await fx.admin.get(`/api/documents/${documentId}/history/export`)).status).toBe(200);
    expect((await fx.admin.get(`/api/documents/${documentId}/history/0`)).status).toBe(404);

    // Exports: the audit trail as CSV, a revision as Markdown.
    const csv = await fx.admin.get(`/api/documents/${documentId}/history/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text.split('\r\n')[0]).toContain('revision,generation,operation');
    expect(csv.text).toContain('"text_deleted"');
    const markdown = await fx.admin.get(
      `/api/documents/${documentId}/history/3/export?format=markdown`,
    );
    expect(markdown.text).toContain('first line');
    expect(markdown.text).toContain('second line');
  });

  it('rebuilds across a checkpoint and after the working log was compacted', async () => {
    const documentId = await fx.createDocument('Checkpoints');
    for (const word of ['one', 'two', 'three', 'four']) {
      const client = await connectCollab(fx.admin, documentId);
      client.appendParagraph(word);
      await client.save();
      client.destroy();
      // The document is unloaded when its last editor leaves, which compacts the log.
      await until(
        async () => {
          const rows = await fx.server.sql('SELECT 1 FROM doc_updates WHERE document_id = $1', [
            documentId,
          ]);
          return rows.length === 0;
        },
        { timeoutMs: 15_000 },
      );
    }
    const rows = await fx.server.sql<{ kind: string; op: string }>(
      `SELECT kind, operation_type AS op FROM doc_history
        WHERE document_id = $1 ORDER BY hseq`,
      [documentId],
    );
    expect(rows.filter((row) => row.op === 'checkpoint').length).toBeGreaterThanOrEqual(1);
    // The working log is empty, the history is complete.
    const updates = rows.filter((row) => row.kind === 'update');
    expect(updates).toHaveLength(4);

    const body = await history(fx.admin, documentId);
    // Checkpoints are storage, not events: the timeline does not list them.
    expect(body.entries.map((entry) => entry.operation)).not.toContain('checkpoint');
    const last = body.entries[0];
    const revision = await fx.admin.ok(
      fx.admin.get<{ content: { content: unknown[] } }>(
        `/api/documents/${documentId}/history/${last?.revision}`,
      ),
    );
    expect(revision.content.content).toHaveLength(5);
  });

  it('restores a revision as a new head and keeps every earlier row; copies one', async () => {
    const documentId = await fx.createDocument('Restore');
    const a = await connectCollab(fx.admin, documentId);
    a.appendParagraph('keep me');
    await a.save();
    a.appendParagraph('a mistake');
    await a.save();
    const before = await history(fx.admin, documentId);
    const good = before.entries.find((entry) => entry.revision === 2);
    expect(good).toBeDefined();

    const named = await fx.admin.post<{ snapshot: { id: string; name: string } }>(
      `/api/documents/${documentId}/history/2/name`,
      { name: 'Before the mistake' },
    );
    expect(named.status).toBe(201);
    const restored = await fx.admin.post(
      `/api/documents/${documentId}/snapshots/${named.body.snapshot.id}/restore`,
    );
    expect(restored.status).toBe(200);
    await a.closed();
    a.destroy();

    const b = await connectCollab(fx.admin, documentId);
    // A restored generation starts from a fresh encoding of the content.
    expect(b.text().trim()).toBe('keep me');
    b.appendParagraph('after the restore');
    await b.save();
    b.destroy();

    const after = await history(fx.admin, documentId);
    // Nothing that existed before the restore is gone, and new rows follow it.
    for (const entry of before.entries) {
      expect(after.entries.map((row) => row.revision)).toContain(entry.revision);
    }
    const newest = after.entries[0];
    expect(newest?.generation).toBe(2);
    expect(newest?.revision).toBeGreaterThan(before.entries[0]?.revision ?? 0);
    expect(after.events.map((event) => event.action)).toEqual(
      expect.arrayContaining(['snapshot.restored', 'history.revision_named']),
    );
    // The abandoned revision is still readable.
    const mistake = await fx.admin.ok(
      fx.admin.get<{ diff: { op: string; text: string }[] }>(
        `/api/documents/${documentId}/history/3`,
      ),
    );
    expect(mistake.diff).toContainEqual({ op: 'insert', text: 'a mistake' });

    const copy = await fx.admin.post<{ documentId: string; title: string }>(
      `/api/documents/${documentId}/history/3/copy`,
      {},
    );
    expect(copy.status).toBe(201);
    expect(copy.body.title).toBe('Restore (revision 3)');
    const c = await connectCollab(fx.admin, copy.body.documentId);
    expect(c.text().trim()).toBe('keep me\n\na mistake');
    c.destroy();
    await sleep(50);
  });
});

describe('commits made without history', () => {
  it('starts again from a complete state, so later revisions are still exact', async () => {
    const documentId = await fx.createDocument('Gap');
    const first = await connectCollab(fx.admin, documentId);
    first.appendParagraph('recorded');
    await first.save();
    first.destroy();

    // As after a rollback to a version without history: edits are committed, not recorded.
    await fx.server.stop();
    fx.server.env.HISTORY_ENABLED = 'false';
    await fx.server.start();
    const during = await connectCollab(fx.admin, documentId);
    during.appendParagraph('written while history was off');
    await during.save();
    during.destroy();
    await fx.server.stop();
    fx.server.env.HISTORY_ENABLED = 'true';
    await fx.server.start();

    const after = await connectCollab(fx.admin, documentId);
    after.appendParagraph('recorded again');
    await after.save();
    after.destroy();

    const body = await history(fx.admin, documentId);
    expect(body.entries.map((entry) => entry.operation)).toEqual([
      'text_inserted',
      'baseline',
      'text_inserted',
      'baseline',
    ]);
    // The newest revision contains what was written during the gap.
    const newest = await fx.admin.ok(
      fx.admin.get<{ content: { content: { content?: { text: string }[] }[] } }>(
        `/api/documents/${documentId}/history/${body.entries[0]?.revision}`,
      ),
    );
    expect(newest.content.content.map((block) => block.content?.[0]?.text ?? '')).toEqual([
      '',
      'recorded',
      'written while history was off',
      'recorded again',
    ]);
  }, 60_000);
});

describe('attachments and retention', () => {
  it('keeps an image that only the history still refers to, and trims by age safely', async () => {
    const documentId = await fx.createDocument('Images');
    const upload = await fx.admin.upload(documentId, demoPng(), 'shot.png');
    expect(upload.status).toBe(201);
    const assetId = upload.body.asset.id;

    const a = await connectCollab(fx.admin, documentId);
    a.edit(() => {
      const image = new Y.XmlElement('image');
      image.setAttribute('assetId', assetId);
      a.fragment.push([image]);
    });
    await a.save();
    a.deleteBlock(1);
    await a.save();
    a.destroy();

    const body = await history(fx.admin, documentId);
    expect(body.entries.map((entry) => entry.operation).slice(0, 2)).toEqual([
      'image_removed',
      'image_inserted',
    ]);
    expect(body.entries[1]?.attachmentIds).toEqual([assetId]);

    // Unreferenced by the live document for longer than the grace period: still kept,
    // because a retained revision shows it.
    await fx.server.sql(
      "UPDATE assets SET unreferenced_since = now() - interval '400 days', created_at = now() - interval '400 days' WHERE id = $1",
      [assetId],
    );
    const first = await fx.server.cli(['cleanup']);
    expect(first.code).toBe(0);
    expect(await fx.server.sql('SELECT 1 FROM assets WHERE id = $1', [assetId])).toHaveLength(1);
  });
});
