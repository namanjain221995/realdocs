/**
 * Durability (acceptance tests 6, 10, 11, 12): "saved" means committed to
 * PostgreSQL. Verified by killing the server, stopping the database and
 * reconnecting with offline work.
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DOCUMENT_SCHEMA_VERSION } from '@realtimedocs/contracts';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  Agent,
  TestServer,
  connectCollab,
  createFixture,
  sleep,
  storedContent,
  until,
  type Fixture,
} from './harness';
import { PG, dockerRetry } from './pg';

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture('durability');
}, 120_000);

afterAll(async () => {
  // Whatever happened in the outage test, leave PostgreSQL running for the next file.
  await dockerRetry(() => docker('start', PG.container));
  await fx.server.dispose();
});

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('crash safety (acceptance test 10)', () => {
  it('an acknowledged save survives SIGKILL, including a deletion-only edit', async () => {
    const documentId = await fx.createDocument('Crash safety');
    const client = await connectCollab(fx.admin, documentId);
    client.appendParagraph('paragraph that will be deleted');
    client.appendParagraph('paragraph that stays');
    await client.save();
    expect(client.json().content).toHaveLength(3);

    // A deletion-only transaction: no struct is added, the state vector does not move.
    const vector = Y.encodeStateVector(client.doc);
    client.deleteBlock(1);
    expect(Y.encodeStateVector(client.doc)).toEqual(vector);
    client.appendParagraph('typed right before the crash');
    client.deleteBlock(0);
    await client.save();
    const acknowledged = client.text();
    expect(acknowledged).toBe('paragraph that stays\n\ntyped right before the crash\n');

    // The process dies immediately after the acknowledgement: no flush, no shutdown hook.
    await fx.server.kill();
    expect(fx.server.running).toBe(false);
    client.destroy();

    // The acknowledged state is in PostgreSQL as an ordered, gap-free log.
    const rows = await fx.server.sql<{ seq: string }>(
      'SELECT seq FROM doc_updates WHERE document_id = $1 ORDER BY seq',
      [documentId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((row) => Number(row.seq))).toEqual(rows.map((_, index) => index + 1));
    const [document] = await fx.server.sql<{ headSeq: string }>(
      'SELECT head_seq AS "headSeq" FROM documents WHERE id = $1',
      [documentId],
    );
    expect(Number(document?.headSeq)).toBe(rows.length);

    await fx.server.start();
    const admin = new Agent(fx.server);
    await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const after = await connectCollab(admin, documentId);
    expect(after.text()).toBe(acknowledged);
    expect(after.text()).not.toContain('will be deleted');
    // The export (read from storage, then from the reloaded document) agrees.
    const exported = await admin.get(`/api/documents/${documentId}/export?format=txt`);
    expect(exported.text).toBe(acknowledged);
    after.destroy();
    fx.admin.cookies.clear();
    await fx.admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  it('every acknowledged step of a rapid editing session is on disk when the server is killed', async () => {
    const documentId = await fx.createDocument('Rapid crash');
    const client = await connectCollab(fx.admin, documentId);
    for (let i = 0; i < 40; i += 1) {
      client.appendParagraph(`line ${i}`);
      if (i % 7 === 3) client.deleteBlock(0);
      // Acknowledgements are requested while typing continues, like the editor does.
      if (i % 4 === 3) await client.save();
    }
    await client.save();
    const acknowledged = client.text();
    // Unacknowledged typing at the moment of the crash.
    client.appendParagraph('never acknowledged');
    await fx.server.kill();
    client.destroy();

    await fx.server.start();
    await fx.admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const after = await connectCollab(fx.admin, documentId);
    // Everything acknowledged is there. (The last, unacknowledged line may or may not be.)
    expect(after.text().startsWith(acknowledged.trimEnd())).toBe(true);
    for (let i = 36; i < 40; i += 1) expect(after.text()).toContain(`line ${i}\n`);
    after.destroy();
  });
});

describe('initial content (acceptance test 12)', () => {
  it('is created once: reconnects and restarts never duplicate it', async () => {
    const seeded = await fx.server.cli(['seed-sample', '--force']);
    expect(seeded.code, seeded.stderr).toBe(0);
    const documentId = /\/d\/([0-9a-f-]{36})/.exec(seeded.stdout)?.[1] ?? '';
    const before = await fx.server.sql<{ fingerprint: string }>(
      `SELECT md5(string_agg(md5(state) || upto_seq::text, ',')) AS fingerprint
         FROM doc_states WHERE document_id = $1`,
      [documentId],
    );

    const first = await connectCollab(fx.admin, documentId);
    const original = first.json();
    const count = (text: string, needle: string) => text.split(needle).length - 1;
    expect(count(first.text(), 'Launch notes: RealtimeDocs demo')).toBe(1);
    expect(original.content?.length).toBeGreaterThan(10);
    first.destroy();

    // Many connections, some reusing a document that already holds the content.
    for (let round = 0; round < 5; round += 1) {
      const reconnect = await connectCollab(fx.admin, documentId, { doc: first.doc });
      reconnect.hello(0);
      await reconnect.waitFor((message) => message.t === 'saved' && message);
      expect(JSON.stringify(reconnect.json())).toBe(JSON.stringify(original));
      reconnect.disconnect();
      const fresh = await connectCollab(fx.admin, documentId);
      expect(JSON.stringify(fresh.json())).toBe(JSON.stringify(original));
      fresh.destroy();
    }

    await fx.server.stop();
    await fx.server.start();
    await fx.admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await fx.server.kill();
    await fx.server.start();
    await fx.admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    const after = await connectCollab(fx.admin, documentId);
    expect(JSON.stringify(after.json())).toBe(JSON.stringify(original));
    expect(count(after.text(), 'Launch notes: RealtimeDocs demo')).toBe(1);
    expect(count(after.text(), 'End of sample.')).toBe(1);
    after.destroy();

    // Connecting wrote nothing: no log rows, the stored state is byte-identical.
    expect(
      await fx.server.sql('SELECT 1 FROM doc_updates WHERE document_id = $1', [documentId]),
    ).toEqual([]);
    const afterState = await fx.server.sql<{ fingerprint: string }>(
      `SELECT md5(string_agg(md5(state) || upto_seq::text, ',')) AS fingerprint
         FROM doc_states WHERE document_id = $1`,
      [documentId],
    );
    expect(afterState[0]?.fingerprint).toBe(before[0]?.fingerprint);
    const [document] = await fx.server.sql<{ headSeq: string; generation: number }>(
      'SELECT head_seq AS "headSeq", generation FROM documents WHERE id = $1',
      [documentId],
    );
    expect(document).toMatchObject({ headSeq: '0', generation: 1 });
  });
});

describe('offline work (acceptance test 6, server side)', () => {
  it('reconnects with offline edits, proves them with hello and makes them durable', async () => {
    const editor = await fx.createUser('Offline Olga');
    const documentId = await fx.createDocument('Offline');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
    );
    const online = await connectCollab(editor, documentId);
    online.appendParagraph('written online');
    online.appendParagraph('to be removed offline');
    await online.save();
    const other = await connectCollab(fx.admin, documentId);

    // Going offline: the connection is gone, the document and its changes stay local.
    online.disconnect();
    const doc = online.doc;
    const fragment = doc.getXmlFragment('default');
    doc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, 'written offline');
      paragraph.insert(0, [text]);
      fragment.push([paragraph]);
    });
    doc.transact(() => fragment.delete(2, 1));
    // Meanwhile somebody else keeps editing.
    other.appendParagraph('written by someone else meanwhile');
    await other.save();
    expect(await storedContent(fx.server, documentId)).not.toContain('written offline');

    // Reconnect: new ticket (access is re-resolved), sync handshake, then the proof.
    const back = await connectCollab(editor, documentId, { doc });
    back.n = 2;
    back.hello();
    const answer = await back.waitFor((m) => (m.t === 'saved' || m.t === 'resync') && m);
    expect(answer).toEqual({ t: 'saved', n: 2 });
    await until(() => other.text().includes('written offline'), {
      what: 'offline edit reaches others',
    });
    expect(other.text()).not.toContain('to be removed offline');
    expect(back.text()).toContain('written by someone else meanwhile');
    expect(back.text()).toBe(other.text());

    // Durable: present after a crash, including the offline deletion.
    const expected = back.text();
    await fx.server.kill();
    for (const client of [back, other]) client.destroy();
    const stored = await storedContent(fx.server, documentId);
    expect(stored).toContain('written offline');
    await fx.server.start();
    await fx.admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const after = await connectCollab(fx.admin, documentId);
    expect(after.text()).toBe(expected);
    expect(after.text()).not.toContain('to be removed offline');
    after.destroy();
  });

  it('does not accept offline edits when edit access was removed meanwhile', async () => {
    const editor = await fx.createUser('Revoked Rita');
    const documentId = await fx.createDocument('Offline revoked');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
    );
    const online = await connectCollab(editor, documentId);
    online.appendParagraph('before');
    await online.save();
    online.disconnect();
    online.appendParagraph('UNPUBLISHED-OFFLINE-WORK');

    // Downgraded to viewer while offline.
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'viewer' }),
    );
    const back = await connectCollab(editor, documentId, { doc: online.doc });
    expect(back.authenticatedScope).toBe('readonly');
    expect(back.ticket.role).toBe('viewer');
    back.hello(online.n);
    back.mark(online.n);
    await sleep(600);
    expect(back.stateless.filter((message) => message.t === 'saved')).toEqual([]);
    expect(back.stateless).toContainEqual({ t: 'access', change: 'role_changed', role: 'viewer' });
    const witness = await connectCollab(fx.admin, documentId);
    expect(witness.text()).not.toContain('UNPUBLISHED');
    expect(await storedContent(fx.server, documentId)).not.toContain('UNPUBLISHED');

    // Removed entirely: no ticket, so nothing can be sent at all.
    back.disconnect();
    await fx.admin.ok(fx.admin.delete(`/api/documents/${documentId}/members/${editor.userId}`));
    const refused = await editor.post(`/api/documents/${documentId}/collab-ticket`, {
      clientId: online.doc.clientID,
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      protocolVersion: 1,
    });
    expect([refused.status, refused.code]).toEqual([404, 'not_found']);
    expect(await storedContent(fx.server, documentId)).not.toContain('UNPUBLISHED');
    witness.destroy();
  });
});

describe('database outage (acceptance test 11)', () => {
  it('never reports saved while PostgreSQL is down, reports the error, and saves when it returns', async () => {
    const documentId = await fx.createDocument('Outage');
    const client = await connectCollab(fx.admin, documentId);
    const watcher = await connectCollab(fx.admin, documentId);
    client.appendParagraph('before the outage');
    await client.save();
    const savedBefore = client.n;
    await fx.server.resetPool();

    docker('stop', PG.container);
    try {
      const outageFrom = client.stateless.length;
      client.appendParagraph('typed during the outage');
      client.deleteBlock(0);
      client.mark();
      const pending = client.n;

      // The server says so explicitly …
      const error = await client.waitFor((m) => m.t === 'save-error' && m, {
        from: outageFrom,
        timeoutMs: 20_000,
        what: 'save-error during the outage',
      });
      expect(error).toEqual({
        t: 'save-error',
        n: pending,
        code: 'storage_unavailable',
        retrying: true,
      });
      const degraded = await client.waitFor((m) => m.t === 'persistence' && m, {
        from: outageFrom,
      });
      expect(degraded).toEqual({ t: 'persistence', state: 'degraded', acceptingEdits: true });
      // … other clients still receive the edit live (connected is not the same as saved) …
      await until(() => watcher.text().includes('typed during the outage'), { what: 'live relay' });
      expect(watcher.stateless).toContainEqual({
        t: 'persistence',
        state: 'degraded',
        acceptingEdits: true,
      });

      // … and keeps saying nothing else: more edits, more markers, a hello — never `saved`.
      client.appendParagraph('more typing during the outage');
      client.mark();
      client.hello();
      watcher.mark(0);
      await sleep(6_000);
      const during = client.stateless.slice(outageFrom);
      expect(during.filter((m) => m.t === 'saved')).toEqual([]);
      expect(during.filter((m) => m.t === 'save-error').length).toBeGreaterThanOrEqual(1);
      expect(watcher.stateless.filter((m) => m.t === 'saved')).toEqual([]);
      expect(client.n).toBeGreaterThan(savedBefore);

      // The API is honest about it too.
      const ready = await fx.admin.get('/api/ready');
      expect(ready.status).toBe(503);
      expect(ready.body).toMatchObject({ status: 'degraded' });
      expect((await fx.admin.get('/api/health')).status).toBe(200);
      const api = await fx.admin.get(`/api/documents/${documentId}`);
      expect([api.status, api.code]).toEqual([503, 'storage_unavailable']);
      // A new connection cannot be authorized without the database.
      expect((await fx.admin.post(`/api/documents/${documentId}/collab-ticket`, {})).status).toBe(
        503,
      );
    } finally {
      await dockerRetry(() => docker('start', PG.container));
    }

    // The database is back: the pending batch is committed and only now acknowledged.
    await client.saved(client.n, 40_000);
    const recovered = await client.waitFor((m) => m.t === 'persistence' && m.state === 'ok' && m, {
      timeoutMs: 10_000,
    });
    expect(recovered).toEqual({ t: 'persistence', state: 'ok', acceptingEdits: true });
    const expected = client.text();
    expect(expected).toBe(
      'before the outage\n\ntyped during the outage\n\nmore typing during the outage\n',
    );

    await until(async () => (await fx.admin.get('/api/ready')).status === 200, {
      what: 'ready again',
      timeoutMs: 20_000,
    });
    const stored = await storedContent(fx.server, documentId);
    expect(stored).toContain('more typing during the outage');
    // Exactly once: the retried batch was not written twice.
    const rows = await fx.server.sql<{ seq: string }>(
      'SELECT seq FROM doc_updates WHERE document_id = $1 ORDER BY seq',
      [documentId],
    );
    expect(rows.map((row) => Number(row.seq))).toEqual(rows.map((_, index) => index + 1));

    for (const connected of [client, watcher]) connected.destroy();
    await sleep(300);
    const after = await connectCollab(fx.admin, documentId);
    expect(after.text()).toBe(expected);
    after.destroy();
  }, 120_000);

  it('stops accepting edits when the uncommitted queue is full and recovers afterwards', async () => {
    // A second server on the same database with a tiny queue bound.
    const small = await TestServer.create('durability-small-queue', {
      port: 4411,
      database: fx.server.database,
      assetDir: fx.server.assetDir,
      env: { COLLAB_MAX_QUEUE_BYTES: '4096', PUBLIC_ORIGIN: fx.server.origin },
    });
    await small.start();
    const agent = new Agent(small, fx.server.origin);
    agent.cookies.set('rd_session', fx.admin.cookies.get('rd_session')!);
    agent.csrfToken = fx.admin.csrfToken;
    const documentId = await fx.createDocument('Bounded queue');
    const client = await connectCollab(agent, documentId, { wsUrl: small.wsUrl });
    client.appendParagraph('before');
    await client.save();
    await fx.server.resetPool();

    docker('stop', PG.container);
    const refusedText = 'REFUSED-WHILE-FULL';
    try {
      const from = client.stateless.length;
      // Keep typing until the server reports that it no longer accepts edits.
      for (let i = 0; i < 400; i += 1) {
        client.appendParagraph(`queued ${i} ${'x'.repeat(64)}`);
        if (client.stateless.slice(from).some((m) => m.t === 'persistence' && !m.acceptingEdits))
          break;
        await sleep(5);
      }
      const full = await client.waitFor((m) => m.t === 'persistence' && !m.acceptingEdits && m, {
        from,
        timeoutMs: 20_000,
        what: 'queue full',
      });
      expect(full).toEqual({ t: 'persistence', state: 'degraded', acceptingEdits: false });
      await sleep(200);

      // From now on the server refuses updates: this one stays on the client only.
      client.appendParagraph(refusedText);
      client.mark();
      const answer = await client.waitFor((m) => m.t === 'save-error' && m.n === client.n && m, {
        from,
        timeoutMs: 10_000,
      });
      expect(answer).toEqual({
        t: 'save-error',
        n: client.n,
        code: 'server_busy',
        retrying: false,
      });
      expect(client.stateless.slice(from).filter((m) => m.t === 'saved')).toEqual([]);
    } finally {
      await dockerRetry(() => docker('start', PG.container));
    }

    // Recovery: the backlog is committed, edits are accepted again.
    const ok = await client.waitFor(
      (m) => m.t === 'persistence' && m.state === 'ok' && m.acceptingEdits && m,
      { timeoutMs: 40_000, what: 'persistence ok' },
    );
    expect(ok).toEqual({ t: 'persistence', state: 'ok', acceptingEdits: true });
    // The refused paragraph was never applied on the server …
    const stored = await until(
      async () => {
        const content = await storedContent(small, documentId).catch(() => '');
        return content.includes('queued 0 ') ? content : '';
      },
      { timeoutMs: 20_000, what: 'backlog stored' },
    );
    expect(stored).not.toContain(refusedText);
    // … until the client syncs again and proves it with hello, as the protocol says.
    client.provider.forceSync();
    await sleep(300);
    client.hello();
    await client.saved(client.n, 20_000);
    expect(await storedContent(small, documentId)).toContain(refusedText);
    client.destroy();
    await small.dispose();
  }, 180_000);
});
