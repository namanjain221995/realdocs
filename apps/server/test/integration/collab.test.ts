/**
 * Collaboration endpoint: convergence, live viewers, server-side view-only
 * enforcement against hand-crafted frames (acceptance test 7), presence
 * integrity, tickets, origin checks, transport limits and the `hello` proof.
 */
import { Awareness } from 'y-protocols/awareness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { DOCUMENT_SCHEMA_VERSION } from '@realtimedocs/contracts';
import {
  Agent,
  RawCollab,
  TestServer,
  connectCollab,
  createFixture,
  openCollab,
  requestTicket,
  sleep,
  until,
  type Fixture,
  type RawMessage,
} from './harness';

let fx: Fixture;
let editorA: Awaited<ReturnType<Fixture['createUser']>>;
let editorB: Awaited<ReturnType<Fixture['createUser']>>;

beforeAll(async () => {
  fx = await createFixture('collab');
  editorA = await fx.createUser('Asha Editor');
  editorB = await fx.createUser('Miguel Editor');
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

async function documentWithEditors(title: string): Promise<string> {
  const documentId = await fx.createDocument(title);
  for (const editor of [editorA, editorB]) {
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
    );
  }
  return documentId;
}

async function headSeq(documentId: string): Promise<number> {
  const rows = await fx.server.sql<{ headSeq: string }>(
    'SELECT head_seq AS "headSeq" FROM documents WHERE id = $1',
    [documentId],
  );
  return Number(rows[0]?.headSeq);
}

async function databaseState(documentId: string): Promise<string> {
  const [row] = await fx.server.sql<{ state: string }>(
    `SELECT md5(
       (SELECT head_seq::text || content_updated_at::text FROM documents WHERE id = $1) ||
       (SELECT COALESCE(string_agg(seq::text || md5("update"), ',' ORDER BY seq), '') FROM doc_updates WHERE document_id = $1) ||
       (SELECT COALESCE(string_agg(generation::text || upto_seq::text || md5(state), ','), '') FROM doc_states WHERE document_id = $1)
     ) AS state`,
    [documentId],
  );
  return row?.state ?? '';
}

describe('editing together', () => {
  it('two editors making overlapping changes converge without loss or duplication', async () => {
    const documentId = await documentWithEditors('Convergence');
    const a = await connectCollab(editorA, documentId);
    const b = await connectCollab(editorB, documentId);
    expect(a.authenticatedScope).toBe('read-write');

    // Interleaved edits from both sides, including edits to the same paragraph.
    a.appendParagraph('shared paragraph');
    await a.save();
    await until(() => b.text().includes('shared paragraph'), { what: 'b sees shared paragraph' });
    // Index 1 is the shared paragraph for both; appended blocks go after it.
    const paragraphOf = (client: typeof a) => client.fragment.get(1) as Y.XmlElement;
    for (let round = 0; round < 15; round += 1) {
      a.edit(() => (paragraphOf(a).get(0) as Y.XmlText).insert(0, `A${round} `));
      b.edit(() => {
        const text = paragraphOf(b).get(0) as Y.XmlText;
        text.insert(text.length, ` B${round}`);
      });
      a.appendParagraph(`from A ${round}`);
      b.appendParagraph(`from B ${round}`);
      if (round % 5 === 0) await sleep(5);
    }
    await Promise.all([a.save(), b.save()]);
    await until(() => a.text() === b.text() && a.text().includes('from B 14'), {
      what: 'both editors converge',
    });

    const text = a.text();
    for (let round = 0; round < 15; round += 1) {
      for (const marker of [`A${round} `, ` B${round}`, `from A ${round}`, `from B ${round}`]) {
        expect(text.split(marker).length - 1, marker).toBeGreaterThanOrEqual(1);
      }
      // Nothing was applied twice.
      expect(text.split(`from A ${round}\n`).length - 1).toBe(1);
      expect(text.split(`from B ${round}\n`).length - 1).toBe(1);
    }
    expect(JSON.stringify(a.json())).toBe(JSON.stringify(b.json()));

    // What a brand-new client receives equals what both editors hold.
    const fresh = await connectCollab(fx.admin, documentId);
    expect(fresh.text()).toBe(text);
    for (const client of [a, b, fresh]) client.destroy();
  });

  it('a viewer receives live updates and has a read-only connection', async () => {
    const documentId = await documentWithEditors('Live viewer');
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const viewer = await connectCollab(guest, documentId);
    expect(viewer.authenticatedScope).toBe('readonly');
    expect(viewer.ticket.role).toBe('viewer');
    expect(viewer.ticket.participant).toMatchObject({ kind: 'guest', role: 'viewer' });

    const editor = await connectCollab(editorA, documentId);
    const started = performance.now();
    editor.appendParagraph('typed while the viewer watches');
    await until(() => viewer.text().includes('typed while the viewer watches'), {
      what: 'viewer sees the edit',
      intervalMs: 2,
    });
    // Delivered as an incremental update on the open connection, not by polling.
    expect(performance.now() - started).toBeLessThan(1_000);
    editor.deleteBlock(0);
    await until(() => viewer.json().content?.length === 1, { what: 'viewer sees the deletion' });
    viewer.destroy();
    editor.destroy();
  });
});

describe('view-only enforcement on the server (acceptance test 7)', () => {
  it('a crafted viewer client cannot change the document in memory or in the database', async () => {
    const documentId = await documentWithEditors('Read-only enforcement');
    const witness = await connectCollab(editorA, documentId);
    witness.appendParagraph('original content');
    witness.appendParagraph('second original paragraph');
    await witness.save();

    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const { raw, ticket } = await RawCollab.connect(guest, documentId);
    const name = ticket.documentName;
    expect(raw.messages.find((message) => message.kind === 'auth')).toMatchObject({
      status: 'authenticated',
      detail: 'readonly',
    });

    // The attacker holds the real state, so its updates are perfectly well-formed.
    const forged = await raw.syncInto(name);
    expect(JSON.stringify(forged.getXmlFragment('default').toJSON())).toContain('original content');
    const before = { seq: await headSeq(documentId), db: await databaseState(documentId) };
    const updates: Uint8Array[] = [];
    forged.on('update', (update: Uint8Array) => updates.push(update));
    const fragment = forged.getXmlFragment('default');
    forged.transact(() => {
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, 'INJECTED-BY-VIEWER');
      paragraph.insert(0, [text]);
      fragment.push([paragraph]);
    });
    forged.transact(() => fragment.delete(0, fragment.length - 1));
    expect(updates).toHaveLength(2);
    const [insertion, deletion] = updates as [Uint8Array, Uint8Array];

    const statusFrom = raw.messages.length;
    // 1. Plain update frames (an insertion and a deletion-only update).
    raw.update(name, insertion);
    raw.update(name, deletion);
    // 2. The same content disguised as the reply of a sync handshake.
    raw.syncStep2(name, Y.encodeStateAsUpdate(forged));
    raw.syncStep2(name, Y.mergeUpdates([insertion, deletion]));
    // 3. Asking for a durability acknowledgement for it.
    raw.stateless(name, { t: 'mark', n: 1 });
    raw.stateless(name, {
      t: 'hello',
      n: 2,
      snapshot: Buffer.from(Y.encodeSnapshot(Y.snapshot(forged))).toString('base64'),
    });
    await until(
      () => raw.messages.slice(statusFrom).filter((m) => m.kind === 'syncStatus').length >= 4,
      { what: 'four refusals' },
    );
    const statuses = raw.messages
      .slice(statusFrom)
      .filter((m): m is Extract<RawMessage, { kind: 'syncStatus' }> => m.kind === 'syncStatus');
    expect(statuses.map((status) => status.applied)).toEqual([false, false, false, false]);
    await sleep(400);
    // Never told that anything was saved; told (again) that it is a viewer.
    expect(raw.serverMessages.filter((message) => message.t === 'saved')).toEqual([]);
    expect(raw.serverMessages).toContainEqual({
      t: 'access',
      change: 'role_changed',
      role: 'viewer',
    });

    // In memory: the editor that is connected the whole time saw nothing …
    expect(witness.text()).not.toContain('INJECTED');
    expect(witness.text()).toContain('original content');
    expect(witness.json().content).toHaveLength(3);
    // … neither does a client that connects now, nor the export of the live document.
    const fresh = await connectCollab(editorB, documentId);
    expect(fresh.text()).toBe(witness.text());
    const exported = await fx.admin.get(`/api/documents/${documentId}/export?format=json`);
    expect(exported.text).not.toContain('INJECTED');
    expect(exported.text).toContain('second original paragraph');

    // In the database: not a single row changed.
    expect(await headSeq(documentId)).toBe(before.seq);
    expect(await databaseState(documentId)).toBe(before.db);

    // The connection is still a working read-only connection afterwards.
    witness.appendParagraph('edit after the attack');
    await witness.save();
    const later = await raw.syncInto(name, new Y.Doc());
    expect(JSON.stringify(later.getXmlFragment('default').toJSON())).toContain(
      'edit after the attack',
    );
    expect(JSON.stringify(later.getXmlFragment('default').toJSON())).not.toContain('INJECTED');

    // And after everything was unloaded and loaded again from storage.
    for (const client of [witness, fresh]) client.destroy();
    raw.destroy();
    await sleep(300);
    const reloaded = await connectCollab(fx.admin, documentId);
    expect(reloaded.text()).not.toContain('INJECTED');
    expect(reloaded.text()).toContain('edit after the attack');
    reloaded.destroy();
    const audit = await fx.admin.get<{ events: { action: string }[] }>('/api/audit?limit=500');
    expect(audit.body.events.map((event) => event.action)).not.toContain(
      'security.read_only_update_blocked',
    );
  });

  it('refuses frames before authentication and for other rooms', async () => {
    const documentId = await documentWithEditors('Unauthenticated frames');
    const witness = await connectCollab(editorA, documentId);
    const name = witness.ticket.documentName;
    const before = await databaseState(documentId);

    const forged = new Y.Doc();
    Y.applyUpdate(forged, Y.encodeStateAsUpdate(witness.doc));
    forged.getXmlFragment('default').delete(0, 1);

    // No ticket at all: frames are queued for a while and then the socket is dropped.
    const anonymous = await RawCollab.open(fx.server);
    anonymous.syncStep1(name);
    anonymous.update(name, Y.encodeStateAsUpdate(forged));
    anonymous.stateless(name, { t: 'mark', n: 1 });
    // A made-up ticket.
    const guessing = await RawCollab.open(fx.server);
    guessing.auth(name, 'A'.repeat(43));
    guessing.update(name, Y.encodeStateAsUpdate(forged));
    const denied = await guessing.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(denied).toMatchObject({ status: 'denied', detail: 'ticket_invalid' });
    await sleep(300);
    for (const socket of [anonymous, guessing]) {
      expect(socket.messages.filter((message) => message.kind === 'sync')).toEqual([]);
      expect(socket.messages.filter((message) => message.kind === 'stateless')).toEqual([]);
    }
    expect((await guessing.closed(5_000)).code).toBe(1008);
    expect(witness.json().content).toHaveLength(1);
    expect(await databaseState(documentId)).toBe(before);
    witness.destroy();
    anonymous.destroy();
  });
});

describe('presence integrity', () => {
  it('neutralises spoofed identities, roles and other clients’ presence', async () => {
    const documentId = await documentWithEditors('Presence');
    const victim = await connectCollab(editorA, documentId, { awareness: true });
    const observer = await connectCollab(fx.admin, documentId, { awareness: true });
    victim.awareness?.setLocalStateField('cursor', { anchor: { index: 1 }, head: { index: 4 } });
    const victimId = victim.doc.clientID;
    await until(() => observer.awareness?.getStates().get(victimId)?.cursor, {
      what: 'observer sees the victim',
    });
    const victimState = structuredClone(observer.awareness?.getStates().get(victimId));
    expect(victimState?.user).toMatchObject({ name: 'Asha Editor', role: 'editor', kind: 'user' });
    expect(victimState?.user.id).toBe(victim.ticket.participant.id);

    // The attacker is a view-only guest.
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const { raw, ticket, clientId } = await RawCollab.connect(guest, documentId);
    const forged = new Awareness(new Y.Doc());
    forged.setLocalState(null);
    const spoof = (client: number, clock: number, state: Record<string, unknown> | null) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint(encoder, client);
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarString(encoder, JSON.stringify(state));
      return encoding.toUint8Array(encoder);
    };
    // 1. Its own slot, claiming to be an administrator with a cursor.
    raw.awareness(
      ticket.documentName,
      spoof(clientId, 5, {
        user: { id: 'forged', name: 'Ada Admin', color: '#ff0000', role: 'admin', kind: 'user' },
        cursor: { anchor: { index: 0 }, head: { index: 9 } },
        extra: 'x'.repeat(100),
      }),
    );
    await until(() => observer.awareness?.getStates().get(clientId), { what: 'guest presence' });
    await sleep(100);
    // 2. Overwriting the victim's slot with a higher clock.
    raw.awareness(
      ticket.documentName,
      spoof(victimId, 1_000_000, {
        user: { id: 'forged', name: 'Hacked', color: '#000', role: 'admin', kind: 'user' },
        cursor: null,
      }),
    );
    await sleep(100);
    // 3. Removing the victim's presence.
    raw.awareness(ticket.documentName, spoof(victimId, 2_000_000, null));
    await sleep(100);
    // 4. All three in one update, plus a slot of a client that does not exist.
    const combined = encoding.createEncoder();
    encoding.writeVarUint(combined, 3);
    for (const [client, clock, state] of [
      [clientId, 6, { user: { name: 'Root', role: 'admin' } }],
      [victimId, 3_000_000, { user: { name: 'Hacked again', role: 'admin' } }],
      [424242, 1, { user: { name: 'Ghost', role: 'admin', kind: 'user', id: 'g', color: '#fff' } }],
    ] as const) {
      encoding.writeVarUint(combined, client);
      encoding.writeVarUint(combined, clock);
      encoding.writeVarString(combined, JSON.stringify(state));
    }
    raw.awareness(ticket.documentName, encoding.toUint8Array(combined));
    await sleep(400);

    const states = observer.awareness?.getStates() ?? new Map();
    // The attacker appears under the identity the server attests: a guest viewer, no cursor.
    const attacker = states.get(clientId);
    expect(attacker).toEqual({
      user: { ...ticket.participant, role: 'viewer', kind: 'guest' },
    });
    expect(attacker.user.name).toMatch(/^Guest /);
    expect(JSON.stringify([...states.values()])).not.toMatch(/Hacked|Root|Ghost|forged/);
    // The victim's presence is exactly what it was.
    expect(states.get(victimId)).toEqual(victimState);
    expect(states.has(424242)).toBe(false);
    // The victim itself was not told that it left or changed.
    expect(victim.awareness?.getLocalState()?.cursor).toEqual({
      anchor: { index: 1 },
      head: { index: 4 },
    });

    // Presence never touches durable state.
    expect(await headSeq(documentId)).toBe(0);

    // Disconnecting removes the participant for everyone.
    raw.destroy();
    await until(() => !observer.awareness?.getStates().has(clientId), {
      what: 'guest presence removed',
    });
    const access = await fx.admin.get<{ live: { name: string; kind: string }[] }>(
      `/api/documents/${documentId}/access`,
    );
    expect(access.body.live.map((participant) => participant.name).sort()).toEqual([
      'Ada Admin',
      'Asha Editor',
    ]);
    forged.destroy();
    victim.destroy();
    observer.destroy();
  });

  it('accepts the presence of a reconnecting client even when its clock did not advance', async () => {
    const documentId = await documentWithEditors('Presence reconnect');
    const anchor = await connectCollab(fx.admin, documentId, { awareness: true });
    const clientId = 987_654_321;
    const entry = (clock: number) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint(encoder, clientId);
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarString(encoder, JSON.stringify({ cursor: null }));
      return encoding.toUint8Array(encoder);
    };
    const first = await RawCollab.connect(editorA, documentId, clientId);
    first.raw.awareness(first.ticket.documentName, entry(7));
    await until(() => anchor.awareness?.getStates().has(clientId), { what: 'presence appears' });
    first.raw.destroy();
    await until(() => !anchor.awareness?.getStates().has(clientId), { what: 'presence removed' });

    // Same client, same presence clock (nothing changed locally while it was away).
    const second = await RawCollab.connect(editorA, documentId, clientId);
    second.raw.awareness(second.ticket.documentName, entry(7));
    await sleep(200);
    // Someone who joins now is told about it right away.
    const joiner = await connectCollab(editorB, documentId, { awareness: true });
    await until(() => joiner.awareness?.getStates().has(clientId), {
      what: 'reconnected client visible to a new participant',
      timeoutMs: 3_000,
    });
    expect(joiner.awareness?.getStates().get(clientId)?.user).toMatchObject({
      id: second.ticket.participant.id,
      name: 'Asha Editor',
    });
    // The server survived the reconnect dance (this used to be a crash scenario).
    expect((await fx.admin.get('/api/health')).status).toBe(200);
    second.raw.destroy();
    anchor.destroy();
    joiner.destroy();
  });

  it('gives an editor a cursor and throttles presence floods per connection', async () => {
    const documentId = await documentWithEditors('Presence throttle');
    const observer = await connectCollab(fx.admin, documentId, { awareness: true });
    let updates = 0;
    observer.awareness?.on('update', () => {
      updates += 1;
    });
    const { raw, ticket, clientId } = await RawCollab.connect(editorB, documentId);
    const source = new Awareness(new Y.Doc());
    // 300 presence updates in about 300 ms.
    for (let i = 0; i < 300; i += 1) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint(encoder, clientId);
      encoding.writeVarUint(encoder, i + 1);
      encoding.writeVarString(
        encoder,
        JSON.stringify({ cursor: { anchor: { index: i }, head: { index: i } } }),
      );
      raw.awareness(ticket.documentName, encoding.toUint8Array(encoder));
      await sleep(1);
    }
    await until(
      () => observer.awareness?.getStates().get(clientId)?.cursor?.anchor?.index === 299,
      { what: 'the final cursor position arrives' },
    );
    // Relayed at most once per 60 ms: a handful of updates, not hundreds.
    expect(updates).toBeGreaterThanOrEqual(2);
    expect(updates).toBeLessThanOrEqual(20);
    expect(observer.awareness?.getStates().get(clientId)).toEqual({
      user: { ...ticket.participant, role: 'editor', kind: 'user', name: 'Miguel Editor' },
      cursor: { anchor: { index: 299 }, head: { index: 299 } },
    });
    // An awareness frame far beyond the size limit is ignored, not relayed.
    const huge = encoding.createEncoder();
    encoding.writeVarUint(huge, 1);
    encoding.writeVarUint(huge, clientId);
    encoding.writeVarUint(huge, 100_000);
    encoding.writeVarString(
      huge,
      JSON.stringify({ cursor: { anchor: 'x'.repeat(50_000), head: 1 } }),
    );
    raw.awareness(ticket.documentName, encoding.toUint8Array(huge));
    await sleep(200);
    expect(observer.awareness?.getStates().get(clientId)?.cursor.anchor).toEqual({ index: 299 });
    source.destroy();
    raw.destroy();
    observer.destroy();
  });
});

describe('tickets, origins and versions', () => {
  it('accepts a ticket exactly once', async () => {
    const documentId = await documentWithEditors('Single use');
    const first = await connectCollab(editorA, documentId);
    const replay = await openCollab(editorA, documentId, {
      ticket: first.ticket,
      doc: new Y.Doc(),
    });
    await until(() => replay.authFailures.length > 0, { what: 'replayed ticket refused' });
    expect(replay.authFailures).toEqual(['ticket_invalid']);
    expect(replay.isSynced).toBe(false);
    expect(replay.json().content ?? []).toEqual([]);
    first.destroy();
    replay.destroy();
  });

  it('refuses an expired ticket', async () => {
    const documentId = await documentWithEditors('Ticket expiry');
    // Same database, second server process with a one-second ticket lifetime.
    const shortLived = await TestServer.create('collab-short-ticket', {
      port: 4411,
      database: fx.server.database,
      assetDir: fx.server.assetDir,
      env: { COLLAB_TICKET_TTL_SECONDS: '1', PUBLIC_ORIGIN: fx.server.origin },
    });
    await shortLived.start();
    try {
      const agent = new Agent(shortLived, fx.server.origin);
      agent.cookies.set('rd_session', editorA.cookies.get('rd_session')!);
      agent.csrfToken = editorA.csrfToken;
      const ticket = await requestTicket(agent, documentId, 5);
      expect(ticket.status).toBe(200);
      const lifetime = new Date(ticket.body.expiresAt).getTime() - Date.now();
      expect(lifetime).toBeLessThanOrEqual(1_000);
      await sleep(1_200);
      const raw = await RawCollab.open(shortLived, { origin: fx.server.origin });
      raw.auth(ticket.body.documentName, ticket.body.ticket);
      const denied = await raw.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
        (message) => message.kind === 'auth',
      );
      expect(denied).toMatchObject({ status: 'denied', detail: 'ticket_expired' });
      raw.destroy();
    } finally {
      await shortLived.dispose();
    }
  });

  it('rejects WebSocket handshakes from origins that are not on the allow-list', async () => {
    const documentId = await documentWithEditors('Origins');
    const ticket = await requestTicket(editorA, documentId, 9);
    for (const origin of [
      'https://evil.example',
      `${fx.server.origin}.evil.example`,
      'null',
      null,
    ]) {
      const raw = await RawCollab.open(fx.server, { origin });
      expect(await raw.closed(5_000)).toEqual({ code: 4400, reason: 'bad_origin' });
      // Not even a valid ticket is looked at.
      expect(raw.messages).toEqual([]);
    }
    // The ticket was not consumed by those attempts; the desktop origin is allowed.
    const desktop = await RawCollab.open(fx.server, { origin: 'app://realtimedocs' });
    desktop.auth(ticket.body.documentName, ticket.body.ticket);
    const accepted = await desktop.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(accepted.status).toBe('authenticated');
    desktop.destroy();

    // Only /collab upgrades.
    const elsewhere = await RawCollab.open(fx.server, { path: '/api/collab' });
    expect((await elsewhere.closed(5_000)).code).toBe(1006);
  });

  it('refuses a room of another generation and clients that are too old', async () => {
    const documentId = await documentWithEditors('Versions');
    const ticket = await requestTicket(editorA, documentId, 11);
    const wrongRoom = await RawCollab.open(fx.server);
    wrongRoom.auth(`${documentId}.g2`, ticket.body.ticket);
    const mismatch = await wrongRoom.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(mismatch).toMatchObject({ status: 'denied', detail: 'generation_mismatch' });
    wrongRoom.destroy();

    const wrongProtocol = await requestTicket(editorA, documentId, 11, { protocolVersion: 2 });
    expect([wrongProtocol.status, wrongProtocol.code]).toEqual([426, 'update_required']);

    // The document was written by a newer editor: an old client must not open it.
    const ready = await requestTicket(editorA, documentId, 12);
    await fx.server.sql('UPDATE documents SET schema_version = $2 WHERE id = $1', [
      documentId,
      DOCUMENT_SCHEMA_VERSION + 1,
    ]);
    const tooOld = await requestTicket(editorA, documentId, 12);
    expect([tooOld.status, tooOld.code]).toEqual([426, 'update_required']);
    // A ticket issued just before the change is re-checked when it is used.
    const late = await RawCollab.open(fx.server);
    late.auth(ready.body.documentName, ready.body.ticket);
    const denied = await late.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(denied).toMatchObject({ status: 'denied', detail: 'update_required' });
    late.destroy();
    expect(
      (await requestTicket(editorA, documentId, 12, { schemaVersion: DOCUMENT_SCHEMA_VERSION + 1 }))
        .status,
    ).toBe(200);
    expect((await requestTicket(editorA, documentId, -1)).code).toBe('validation_failed');
  });

  it.runIf(DOCUMENT_SCHEMA_VERSION > 1)(
    'a newer editor raises the document schema, after which older clients are refused',
    async () => {
      const documentId = await documentWithEditors('Schema upgrade');
      const schemaOf = async () =>
        (
          await fx.server.sql<{ v: number }>(
            'SELECT schema_version AS v FROM documents WHERE id = $1',
            [documentId],
          )
        )[0]?.v;
      // A document last written by a version-1 editor (new documents start at the current one).
      await fx.server.sql('UPDATE documents SET schema_version = 1 WHERE id = $1', [documentId]);
      expect(await schemaOf()).toBe(1);
      const old = await requestTicket(editorA, documentId, 31, { schemaVersion: 1 });
      expect(old.status).toBe(200);
      // A current editor raises the document to the current version.
      const newest = await requestTicket(editorA, documentId, 32, {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
      });
      expect(newest.status).toBe(200);
      expect(await schemaOf()).toBe(DOCUMENT_SCHEMA_VERSION);
      const refused = await requestTicket(editorA, documentId, 33, { schemaVersion: 1 });
      expect([refused.status, refused.code]).toEqual([426, 'update_required']);
      // A ticket for the old version issued before the raise is refused when used.
      const late = await RawCollab.open(fx.server);
      late.auth(old.body.documentName, old.body.ticket);
      expect(
        await late.waitFor<Extract<RawMessage, { kind: 'auth' }>>((m) => m.kind === 'auth'),
      ).toMatchObject({ status: 'denied', detail: 'update_required' });
      late.destroy();
    },
  );

  it('re-resolves access when the ticket is used, not when it was issued', async () => {
    const documentId = await documentWithEditors('Late revocation');
    const ticket = await requestTicket(editorB, documentId, 21);
    await fx.admin.ok(fx.admin.delete(`/api/documents/${documentId}/members/${editorB.userId}`));
    const raw = await RawCollab.open(fx.server);
    raw.auth(ticket.body.documentName, ticket.body.ticket);
    const denied = await raw.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(denied).toMatchObject({ status: 'denied', detail: 'access_denied' });
    expect(raw.messages.filter((message) => message.kind === 'sync')).toEqual([]);
    raw.destroy();

    // Downgraded between ticket and connection: the connection is read-only.
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editorB.userId}`, { role: 'editor' }),
    );
    const asEditor = await requestTicket(editorB, documentId, 22);
    expect(asEditor.body.role).toBe('editor');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editorB.userId}`, { role: 'viewer' }),
    );
    const downgraded = await RawCollab.open(fx.server);
    downgraded.auth(asEditor.body.documentName, asEditor.body.ticket);
    const scope = await downgraded.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(scope).toMatchObject({ status: 'authenticated', detail: 'readonly' });
    downgraded.destroy();
  });
});

describe('transport limits', () => {
  it('keeps a fast but honest client connected and cuts off a flood', async () => {
    const documentId = await documentWithEditors('Frame budget');
    const { raw, ticket } = await RawCollab.connect(editorA, documentId);
    await raw.syncInto(ticket.documentName);

    // 150 small frames per second for 10 seconds: typing with markers and presence.
    const started = performance.now();
    let sent = 0;
    while (performance.now() - started < 10_000) {
      const due = Math.floor(((performance.now() - started) / 1000) * 150);
      while (sent < due) {
        raw.stateless(ticket.documentName, { t: 'mark', n: sent });
        sent += 1;
      }
      await sleep(5);
    }
    expect(sent).toBeGreaterThanOrEqual(1_450);
    await until(
      () => raw.serverMessages.filter((message) => message.t === 'saved').length >= sent,
      { what: 'every marker answered', timeoutMs: 5_000 },
    );
    expect(raw.closeInfo).toBeNull();

    // A flood far above the budget (burst 1500, 300 frames/s) is disconnected.
    const flood = await RawCollab.connect(editorB, documentId);
    for (let i = 0; i < 12_000 && flood.raw.closeInfo === null; i += 1) {
      flood.raw.stateless(flood.ticket.documentName, { t: 'mark', n: i });
      if (i % 2_000 === 1_999) await sleep(1);
    }
    expect(await flood.raw.closed(10_000)).toEqual({ code: 4429, reason: 'rate_limited' });
    // The honest client on the same document is unaffected.
    raw.stateless(ticket.documentName, { t: 'mark', n: 999_999 });
    await raw.waitFor(
      (message) =>
        message.kind === 'stateless' &&
        message.message.t === 'saved' &&
        message.message.n === 999_999,
    );
    raw.destroy();
  }, 60_000);

  it('rejects oversized frames and text frames', async () => {
    const documentId = await documentWithEditors('Frame limits');
    const big = await RawCollab.connect(editorA, documentId);
    big.raw.raw(new Uint8Array(4 * 1024 * 1024 + 1024));
    expect((await big.raw.closed(10_000)).code).toBe(1009);

    const texty = await RawCollab.connect(editorA, documentId);
    texty.raw.raw('{"t":"mark","n":1}');
    expect(await texty.raw.closed(5_000)).toMatchObject({ code: 1003 });
    expect(await headSeq(documentId)).toBe(0);
  });

  it('answers the provider ping so idle viewers stay connected', async () => {
    const documentId = await documentWithEditors('Keep-alive');
    const { raw } = await RawCollab.connect(editorA, documentId);
    // The server pings every 2 s in this suite (application-level byte 9).
    await raw.waitFor((message) => message.kind === 'ping', { timeoutMs: 5_000 });
    // The provider's reply is a single byte 10; it must not break the connection.
    raw.raw(new Uint8Array([10]));
    raw.raw(new Uint8Array([10]));
    await sleep(300);
    expect(raw.closeInfo).toBeNull();
    raw.stateless(`${documentId}.g1`, { t: 'mark', n: 0 });
    await raw.waitFor((message) => message.kind === 'stateless');
    raw.destroy();
  });
});

describe('the hello proof', () => {
  it('answers `resync` while the client holds content or deletions the server lacks', async () => {
    const documentId = await documentWithEditors('Hello proof');
    const client = await connectCollab(editorA, documentId);
    client.appendParagraph('known to the server');
    await client.save();
    expect(client.stateless.filter((message) => message.t === 'resync')).toEqual([]);

    // Content the server has never seen.
    const ahead = new Y.Doc();
    Y.applyUpdate(ahead, Y.encodeStateAsUpdate(client.doc));
    ahead.getXmlFragment('default').delete(0, 1);
    // Same state vector as the server: only the delete set differs.
    expect(Y.encodeStateVector(ahead)).toEqual(Y.encodeStateVector(client.doc));
    let from = client.stateless.length;
    client.hello(7, ahead);
    const deletionOnly = await client.waitFor((m) => (m.t === 'resync' || m.t === 'saved') && m, {
      from,
    });
    expect(deletionOnly).toEqual({ t: 'resync', n: 7 });

    await sleep(250);
    const inserted = new Y.Doc();
    Y.applyUpdate(inserted, Y.encodeStateAsUpdate(client.doc));
    inserted.getText('elsewhere').insert(0, 'not on the server');
    from = client.stateless.length;
    client.hello(8, inserted);
    const insertion = await client.waitFor((m) => (m.t === 'resync' || m.t === 'saved') && m, {
      from,
    });
    expect(insertion).toEqual({ t: 'resync', n: 8 });

    // The honest snapshot is acknowledged.
    await sleep(250);
    from = client.stateless.length;
    client.hello(9);
    const honest = await client.waitFor((m) => (m.t === 'resync' || m.t === 'saved') && m, {
      from,
    });
    expect(honest).toEqual({ t: 'saved', n: 9 });
    client.destroy();
  });

  it('answers two proofs sent 5 ms apart: the second is deferred, never dropped', async () => {
    const documentId = await documentWithEditors('Hello throttle');
    const client = await connectCollab(editorA, documentId);
    client.appendParagraph('content');
    await client.save();
    await sleep(300);

    // Both snapshots are contained in the server document.
    let from = client.stateless.length;
    const started = performance.now();
    client.hello(101);
    await sleep(5);
    client.hello(102);
    await client.waitFor((m) => m.t === 'saved' && m.n === 102, { from, timeoutMs: 2_000 });
    const elapsed = performance.now() - started;
    // About one throttle interval (200 ms), not the client's multi-second watchdog.
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(700);
    await sleep(500);
    const answers = client.stateless.slice(from);
    expect(answers).toEqual([
      { t: 'saved', n: 101 },
      { t: 'saved', n: 102 },
    ]);

    // Second round: the later proof is NOT contained and must end in exactly one `resync`.
    const ahead = new Y.Doc();
    Y.applyUpdate(ahead, Y.encodeStateAsUpdate(client.doc));
    ahead.getXmlFragment('default').delete(0, 1);
    from = client.stateless.length;
    client.hello(201);
    await sleep(5);
    client.hello(202, ahead);
    await client.waitFor((m) => m.t === 'resync' && m.n === 202, { from, timeoutMs: 2_000 });
    await sleep(500);
    expect(client.stateless.slice(from)).toEqual([
      { t: 'saved', n: 201 },
      { t: 'resync', n: 202 },
    ]);

    // A burst keeps only the newest waiting proof: one immediate answer, one deferred.
    from = client.stateless.length;
    for (let n = 301; n <= 310; n += 1) client.hello(n);
    await client.waitFor((m) => m.t === 'saved' && m.n === 310, { from, timeoutMs: 2_000 });
    await sleep(500);
    expect(client.stateless.slice(from)).toEqual([
      { t: 'saved', n: 301 },
      { t: 'saved', n: 310 },
    ]);
    client.destroy();
  });

  it('ignores malformed side-channel messages without closing the connection', async () => {
    const documentId = await documentWithEditors('Malformed');
    const { raw, ticket } = await RawCollab.connect(editorA, documentId);
    const name = ticket.documentName;
    raw.stateless(name, { t: 'unknown' });
    raw.stateless(name, { t: 'mark' });
    raw.stateless(name, { t: 'mark', n: -1 });
    raw.stateless(name, { t: 'mark', n: 'NaN' });
    raw.stateless(name, { t: 'saved', n: 1 });
    // Not a snapshot: the server cannot confirm anything, so it asks for a new sync.
    raw.stateless(name, { t: 'hello', n: 3, snapshot: '!!!not-base64!!!' });
    raw.stateless(name, { t: 'mark', n: 4 });
    await raw.waitFor(
      (message) =>
        message.kind === 'stateless' && message.message.t === 'saved' && message.message.n === 4,
    );
    expect(raw.serverMessages).toEqual([
      { t: 'resync', n: 3 },
      { t: 'saved', n: 4 },
    ]);
    expect(raw.closeInfo).toBeNull();
    raw.destroy();
  });
});

describe('unloading', () => {
  it('compacts the log when the last client leaves and reloads the same content', async () => {
    const documentId = await documentWithEditors('Compaction');
    const client = await connectCollab(editorA, documentId);
    for (let i = 0; i < 12; i += 1) {
      client.appendParagraph(`paragraph ${i}`);
      await sleep(3);
    }
    client.deleteBlock(3);
    await client.save();
    const text = client.text();
    const seq = await headSeq(documentId);
    expect(seq).toBeGreaterThanOrEqual(2);
    expect(
      await fx.server.sql('SELECT 1 FROM doc_updates WHERE document_id = $1', [documentId]),
    ).toHaveLength(seq);
    client.destroy();

    // Compaction: the state covers everything up to head_seq and those rows are gone.
    await until(
      async () =>
        (await fx.server.sql('SELECT 1 FROM doc_updates WHERE document_id = $1', [documentId]))
          .length === 0,
      { what: 'log compacted after the last client left' },
    );
    const [state] = await fx.server.sql<{ uptoSeq: string }>(
      'SELECT upto_seq AS "uptoSeq" FROM doc_states WHERE document_id = $1 AND generation = 1',
      [documentId],
    );
    expect(Number(state?.uptoSeq)).toBe(seq);
    expect(await headSeq(documentId)).toBe(seq);

    const again = await connectCollab(editorB, documentId);
    expect(again.text()).toBe(text);
    again.appendParagraph('after compaction');
    await again.save();
    expect(await headSeq(documentId)).toBe(seq + 1);
    again.destroy();
  });
});
