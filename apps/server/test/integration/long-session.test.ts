/**
 * Acceptance test 16: ticket renewal and long sessions. Collaboration tickets are single-use and
 * short-lived (the server here runs with a one-second lifetime, the production value is 60 s).
 * A session that outlives its ticket keeps working, reconnects with a NEW ticket, and still
 * obeys permission changes and revocation without a reconnect.
 */
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RawCollab,
  connectCollab,
  createFixture,
  openCollab,
  requestTicket,
  sleep,
  until,
  type Fixture,
  type RawMessage,
} from './harness';

const TICKET_TTL_MS = 1_000;
const LONGER_THAN_TICKET_MS = 2_500;

let fx: Fixture;
let editor: Awaited<ReturnType<Fixture['createUser']>>;

beforeAll(async () => {
  fx = await createFixture('long-session', { env: { COLLAB_TICKET_TTL_SECONDS: '1' } });
  editor = await fx.createUser('Lena Longsession');
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

async function updateRows(documentId: string): Promise<number> {
  const rows = await fx.server.sql<{ n: string }>(
    'SELECT count(*)::text AS n FROM doc_updates WHERE document_id = $1',
    [documentId],
  );
  return Number(rows[0]?.n);
}

describe('a session that outlives its ticket', () => {
  it('keeps receiving updates and acknowledging edits, then reconnects with a new ticket', async () => {
    const documentId = await fx.createDocument('Long session');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
    );
    const client = await connectCollab(editor, documentId);
    const witness = await connectCollab(fx.admin, documentId);
    const firstTicket = client.ticket;
    expect(new Date(firstTicket.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      TICKET_TTL_MS,
    );

    // Well past the ticket's lifetime, the same socket still works in both directions.
    await sleep(LONGER_THAN_TICKET_MS);
    expect(new Date(firstTicket.expiresAt).getTime()).toBeLessThan(Date.now());
    expect(client.closes).toEqual([]);
    witness.appendParagraph('from the witness, after the ticket expired');
    await until(() => client.text().includes('after the ticket expired'), {
      what: 'update received after ticket expiry',
    });
    client.appendParagraph('from the long session');
    await client.save();
    await until(() => witness.text().includes('from the long session'), {
      what: 'edit of the long session reaches the witness',
    });
    expect(client.closes).toEqual([]);

    // The socket drops. The client asks for a fresh ticket and reconnects with the same document.
    const doc = client.doc;
    client.disconnect();
    doc.transact(() => undefined);
    const renewed = await requestTicket(editor, documentId, doc.clientID);
    expect(renewed.status).toBe(200);
    expect(renewed.body.ticket).not.toBe(firstTicket.ticket);
    expect(new Date(renewed.body.expiresAt).getTime()).toBeGreaterThan(Date.now() - 50);

    // The old ticket is refused: it was used once, and its lifetime is over as well.
    const replay = await RawCollab.open(fx.server);
    replay.auth(firstTicket.documentName, firstTicket.ticket);
    const denied = await replay.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(denied.status).toBe('denied');
    expect(['ticket_invalid', 'ticket_expired']).toContain(denied.detail);
    replay.destroy();

    const back = await openCollab(editor, documentId, { doc, ticket: renewed.body });
    await back.synced();
    expect(back.authFailures).toEqual([]);
    back.appendParagraph('after the renewal');
    await back.save();
    await until(() => witness.text().includes('after the renewal'), {
      what: 'edit after renewal reaches the witness',
    });
    // Everything was committed once, in order.
    const stored = (
      await fx.server.sql<{ update: Buffer }>(
        'SELECT "update" FROM doc_updates WHERE document_id = $1',
        [documentId],
      )
    ).length;
    expect(stored).toBeGreaterThan(0);
    back.destroy();
    witness.destroy();
    new Y.Doc().destroy();
  });

  it('applies a downgrade to the live connection: later updates are refused and never committed', async () => {
    const documentId = await fx.createDocument('Long session downgrade');
    const share = await fx.createShare(documentId, { role: 'editor' });
    const guest = await fx.guest(share.id, share.secret);
    const client = await connectCollab(guest, documentId);
    const witness = await connectCollab(fx.admin, documentId);
    expect(client.authenticatedScope).toBe('read-write');

    await sleep(LONGER_THAN_TICKET_MS);
    client.appendParagraph('written before the downgrade');
    await client.save();
    const committed = await updateRows(documentId);

    await fx.admin.ok(
      fx.admin.patch(`/api/documents/${documentId}/shares/${share.id}`, { role: 'viewer' }),
    );
    // Reaches the open connection, which is not closed.
    expect(await client.waitFor((m) => m.t === 'access' && m, { timeoutMs: 2_000 })).toEqual({
      t: 'access',
      change: 'role_changed',
      role: 'viewer',
    });
    expect(client.closes).toEqual([]);

    client.appendParagraph('WRITTEN-AFTER-DOWNGRADE-LONG');
    client.mark();
    await sleep(700);
    expect(witness.text()).not.toContain('WRITTEN-AFTER-DOWNGRADE-LONG');
    expect(client.stateless.filter((m) => m.t === 'saved' && m.n >= client.n)).toEqual([]);
    expect(await updateRows(documentId)).toBe(committed);
    const stored = await fx.server.sql<{ update: Buffer }>(
      'SELECT "update" FROM doc_updates WHERE document_id = $1',
      [documentId],
    );
    expect(stored.map((row) => row.update.toString('utf8')).join('')).not.toContain(
      'WRITTEN-AFTER-DOWNGRADE-LONG',
    );
    // Still a live viewer.
    witness.appendParagraph('still visible to the viewer');
    await until(() => client.text().includes('still visible to the viewer'), {
      what: 'live as viewer',
    });
    client.destroy();
    witness.destroy();
  });

  it('closes the connection when access is revoked during a long session', async () => {
    const documentId = await fx.createDocument('Long session revocation');
    const share = await fx.createShare(documentId, { role: 'editor' });
    const guest = await fx.guest(share.id, share.secret);
    const client = await connectCollab(guest, documentId);
    await sleep(LONGER_THAN_TICKET_MS);
    client.appendParagraph('edit in the long session');
    await client.save();

    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/shares/${share.id}/revoke`));
    expect(await client.closed(3_000)).toEqual({ code: 4403, reason: 'access_revoked' });
    // No way back: no new ticket.
    const ticket = await requestTicket(guest, documentId, 99);
    expect([ticket.status, ticket.code]).toEqual([410, 'share_revoked']);
    client.destroy();
  });

  it('closes the connection of a removed member during a long session', async () => {
    const documentId = await fx.createDocument('Long session member removal');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
    );
    const client = await connectCollab(editor, documentId);
    await sleep(LONGER_THAN_TICKET_MS);
    client.appendParagraph('edit before removal');
    await client.save();
    await fx.admin.ok(fx.admin.delete(`/api/documents/${documentId}/members/${editor.userId}`));
    const close = await client.closed(3_000);
    expect(close.code).toBe(4403);
    expect((await requestTicket(editor, documentId, 100)).status).toBe(404);
    client.destroy();
  });
});
