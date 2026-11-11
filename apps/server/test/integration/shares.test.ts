/**
 * Share links (acceptance test 9): view-only by default, exchanged for a
 * document-scoped session, and enforced live — revocation, rotation, expiry
 * and downgrades reach connections that are already open.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Agent,
  RawCollab,
  connectCollab,
  createFixture,
  demoPng,
  requestTicket,
  sleep,
  until,
  type AssetBody,
  type DocumentBody,
  type Fixture,
  type RawMessage,
} from './harness';

let fx: Fixture;

interface ShareBody {
  id: string;
  role: string;
  state: string;
  label: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  activeSessions: number;
  liveConnections: number;
}

beforeAll(async () => {
  fx = await createFixture('shares');
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

/** A document with a paragraph of text and one image asset. */
async function shared(title: string): Promise<{ documentId: string; assetId: string }> {
  const documentId = await fx.createDocument(title);
  const client = await connectCollab(fx.admin, documentId);
  client.appendParagraph(`confidential text of ${title}`);
  await client.save();
  client.destroy();
  const asset = await fx.admin.ok<{ asset: AssetBody }>(
    fx.admin.upload(documentId, demoPng(), 'chart.png'),
  );
  return { documentId, assetId: asset.asset.id };
}

describe('creating and exchanging links', () => {
  it('creates view-only links by default and shows the secret exactly once', async () => {
    const { documentId } = await shared('Defaults');
    const created = await fx.admin.post<{ share: ShareBody; url: string }>(
      `/api/documents/${documentId}/shares`,
      {},
    );
    expect(created.status).toBe(201);
    expect(created.body.share).toMatchObject({
      role: 'viewer',
      state: 'active',
      label: '',
      expiresAt: null,
    });

    // The secret is only in the fragment, which browsers never send to a server.
    const url = new URL(created.body.url);
    expect(url.origin).toBe(fx.server.origin);
    expect(url.pathname).toBe(`/s/${created.body.share.id}`);
    expect(url.search).toBe('');
    const secret = url.hash.slice(1);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(created.body.share)).not.toContain(secret);

    // Only a hash is stored, and no later response contains the secret.
    const [row] = await fx.server.sql<{ matches: boolean; length: number }>(
      `SELECT secret_hash = sha256(convert_to($1, 'UTF8')) AS matches, octet_length(secret_hash) AS length
         FROM share_grants WHERE id = $2`,
      [secret, created.body.share.id],
    );
    expect(row).toEqual({ matches: true, length: 32 });
    const list = await fx.admin.get(`/api/documents/${documentId}/shares`);
    const access = await fx.admin.get(`/api/documents/${documentId}/access`);
    expect(list.text + access.text).not.toContain(secret);

    const explicit = await fx.admin.post<{ share: ShareBody }>(
      `/api/documents/${documentId}/shares`,
      {
        role: 'editor',
        label: '  Design review  ',
      },
    );
    expect(explicit.body.share).toMatchObject({ role: 'editor', label: 'Design review' });
    const past = await fx.admin.post(`/api/documents/${documentId}/shares`, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(past.code).toBe('validation_failed');
  });

  it('exchanges a link for a session that is scoped to that one document', async () => {
    const { documentId, assetId } = await shared('Exchange A');
    const elsewhere = await shared('Exchange B');
    const share = await fx.createShare(documentId);
    const guest = new Agent(fx.server);
    const exchanged = await guest.post<{
      documentId: string;
      title: string;
      role: string;
      expiresAt: string | null;
      token?: string;
    }>('/api/share/exchange', { grantId: share.id, secret: share.secret });
    expect(exchanged.status).toBe(200);
    expect(exchanged.body).toMatchObject({ documentId, title: 'Exchange A', role: 'viewer' });
    expect(exchanged.body.token).toBeUndefined();

    // A dedicated HttpOnly cookie that is only ever sent to this document's endpoints.
    const cookie = guest.cookies.get(`rd_share_${documentId}`);
    expect(cookie).toMatchObject({
      path: `/api/documents/${documentId}`,
      httpOnly: true,
      sameSite: 'Lax',
    });
    expect(guest.cookies.size).toBe(1);

    const document = await guest.get<DocumentBody>(`/api/documents/${documentId}`);
    expect(document.body.document.access).toMatchObject({
      role: 'viewer',
      via: 'share_link',
      accountId: null,
    });
    expect((await guest.get(`/api/documents/${documentId}/export?format=txt`)).text).toContain(
      'confidential text of Exchange A',
    );
    expect((await guest.get(`/api/documents/${documentId}/assets/${assetId}`)).status).toBe(200);

    // Nothing else: no other document, no account routes, no management, no editing.
    for (const path of [
      `/api/documents/${elsewhere.documentId}`,
      `/api/documents/${elsewhere.documentId}/export?format=txt`,
      `/api/documents/${elsewhere.documentId}/assets/${elsewhere.assetId}`,
      `/api/documents/${elsewhere.documentId}/assets/${assetId}`,
      '/api/documents',
      '/api/users',
    ]) {
      expect([path, (await guest.get(path)).status]).toEqual([path, 401]);
    }
    // Even when the cookie is forced onto another document's path.
    const forced = await guest.get(`/api/documents/${elsewhere.documentId}`, {
      headers: { cookie: `rd_share_${elsewhere.documentId}=${cookie?.value}` },
    });
    expect([forced.status, forced.code]).toEqual([404, 'not_found']);
    const asAccount = await guest.get('/api/documents', {
      headers: { cookie: `rd_session=${cookie?.value}` },
    });
    expect(asAccount.status).toBe(401);
    expect((await guest.get(`/api/documents/${documentId}/shares`)).status).toBe(403);
    expect((await guest.upload(documentId, demoPng(), 'x.png')).status).toBe(403);
    expect(
      (await guest.post(`/api/documents/${documentId}/shares`, { role: 'editor' })).status,
    ).toBe(403);

    // Several shared documents can be open at once, each with its own cookie.
    const second = await fx.createShare(elsewhere.documentId);
    await guest.ok(
      guest.post('/api/share/exchange', { grantId: second.id, secret: second.secret }),
    );
    expect(guest.cookies.size).toBe(2);
    expect((await guest.get(`/api/documents/${elsewhere.documentId}`)).status).toBe(200);
    expect((await guest.get(`/api/documents/${documentId}`)).status).toBe(200);

    // Opening the link again is a new session; the browser keeps only the newest cookie.
    const firstCookie = guest.cookies.get(`rd_share_${documentId}`)?.value;
    await guest.ok(guest.post('/api/share/exchange', { grantId: share.id, secret: share.secret }));
    expect(guest.cookies.get(`rd_share_${documentId}`)?.value).not.toBe(firstCookie);
    expect(guest.cookies.size).toBe(2);
    const shares = await fx.admin.get<{ shares: ShareBody[] }>(
      `/api/documents/${documentId}/shares`,
    );
    expect(shares.body.shares[0]).toMatchObject({ activeSessions: 2, liveConnections: 0 });
    expect(shares.body.shares[0]?.lastUsedAt).not.toBeNull();
  });

  it('rejects wrong secrets and unknown links identically, and rate-limits guessing per link', async () => {
    const { documentId } = await shared('Guessing');
    const share = await fx.createShare(documentId);
    const guest = new Agent(fx.server);
    const flip = (secret: string) => `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
    const wrong = await guest.post('/api/share/exchange', {
      grantId: share.id,
      secret: flip(share.secret),
    });
    const unknown = await guest.post('/api/share/exchange', {
      grantId: randomUUID(),
      secret: share.secret,
    });
    expect([wrong.status, wrong.code]).toEqual([404, 'share_invalid']);
    expect([unknown.status, unknown.code]).toEqual([404, 'share_invalid']);
    expect(wrong.text.replace(/"requestId":"[^"]+"/, '')).toBe(
      unknown.text.replace(/"requestId":"[^"]+"/, ''),
    );
    expect(guest.cookies.size).toBe(0);
    const malformed = await guest.post('/api/share/exchange', {
      grantId: share.id,
      secret: 'short',
    });
    expect(malformed.code).toBe('validation_failed');
    expect(malformed.text).not.toContain('short');

    for (let attempt = 0; attempt < 19; attempt += 1) {
      await guest.post('/api/share/exchange', { grantId: share.id, secret: flip(share.secret) });
    }
    const limited = await guest.post('/api/share/exchange', {
      grantId: share.id,
      secret: share.secret,
    });
    expect([limited.status, limited.code]).toEqual([429, 'rate_limited']);
    // Other links are not affected by guesses against this one.
    const other = await fx.createShare(documentId);
    expect((await fx.guest(other.id, other.secret)).cookies.size).toBe(1);
  });

  it('requires an allowed origin in browsers but lets the desktop main process exchange without one', async () => {
    const { documentId } = await shared('Exchange origins');
    const share = await fx.createShare(documentId);
    const body = { grantId: share.id, secret: share.secret };
    const evil = await new Agent(fx.server).post('/api/share/exchange', body, {
      origin: 'https://evil.example',
    });
    expect(evil.code).toBe('bad_origin');
    // No Origin header and no cookies: a non-browser client (desktop main process).
    const desktop = new Agent(fx.server, null);
    const bearer = await desktop.post<{ token?: string; role: string }>('/api/share/exchange', {
      ...body,
      mode: 'bearer',
    });
    expect(bearer.status).toBe(200);
    expect(bearer.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(desktop.cookies.size).toBe(0);
    // No Origin but cookies present: that is a browser-shaped request and is refused.
    const mixed = await new Agent(fx.server, null).post('/api/share/exchange', body, {
      headers: { cookie: 'rd_session=whatever' },
    });
    expect(mixed.code).toBe('bad_origin');
  });
});

describe('live enforcement (acceptance test 9)', () => {
  it('revocation disconnects an open viewer and ends every kind of access', async () => {
    const { documentId, assetId } = await shared('Revocation');
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const viewer = await connectCollab(guest, documentId);
    expect(viewer.text()).toContain('confidential text of Revocation');
    const unusedTicket = await requestTicket(guest, documentId, 4242);
    expect(unusedTicket.status).toBe(200);
    const listed = await fx.admin.get<{ shares: ShareBody[] }>(
      `/api/documents/${documentId}/shares`,
    );
    expect(listed.body.shares[0]).toMatchObject({ activeSessions: 1, liveConnections: 1 });

    const revoked = await fx.admin.post<{ share: ShareBody }>(
      `/api/documents/${documentId}/shares/${share.id}/revoke`,
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.share).toMatchObject({
      state: 'revoked',
      activeSessions: 0,
      liveConnections: 0,
    });
    expect(revoked.body.share.revokedAt).not.toBeNull();

    // The viewer is told why and cut off right away (the server did both before answering).
    expect(await viewer.waitFor((m) => m.t === 'access' && m, { timeoutMs: 2_000 })).toEqual({
      t: 'access',
      change: 'revoked',
    });
    expect(await viewer.closed(2_000)).toEqual({ code: 4403, reason: 'access_revoked' });

    // Later edits do not reach the former viewer.
    const editor = await connectCollab(fx.admin, documentId);
    editor.appendParagraph('written after the revocation');
    await editor.save();
    await sleep(200);
    expect(viewer.text()).not.toContain('written after the revocation');

    // It cannot reconnect: no new ticket, and a ticket issued before the revocation is dead too.
    const ticket = await requestTicket(guest, documentId, 4243);
    expect([ticket.status, ticket.code]).toEqual([410, 'share_revoked']);
    const raw = await RawCollab.open(fx.server);
    raw.auth(unusedTicket.body.documentName, unusedTicket.body.ticket);
    const denied = await raw.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (m) => m.kind === 'auth',
    );
    expect(denied.status).toBe('denied');
    expect(raw.messages.filter((m) => m.kind === 'sync')).toEqual([]);
    raw.destroy();

    // Assets, exports and metadata are gone as well.
    for (const path of [
      `/api/documents/${documentId}`,
      `/api/documents/${documentId}/assets/${assetId}`,
      `/api/documents/${documentId}/export?format=txt`,
      `/api/documents/${documentId}/export?format=md-zip`,
      `/api/documents/${documentId}/export?format=json`,
    ]) {
      const response = await guest.get(path);
      expect([path, response.status, response.code]).toEqual([path, 410, 'share_revoked']);
      expect(response.text).not.toContain('confidential');
    }
    // A cached copy of the image is not revalidated successfully either.
    const conditional = await guest.get(`/api/documents/${documentId}/assets/${assetId}`, {
      headers: { 'if-none-match': '*' },
    });
    expect(conditional.status).toBe(410);
    // The link itself no longer works, for anyone.
    const again = await new Agent(fx.server).post('/api/share/exchange', {
      grantId: share.id,
      secret: share.secret,
    });
    expect([again.status, again.code]).toEqual([410, 'share_revoked']);
    expect(
      (await fx.admin.patch(`/api/documents/${documentId}/shares/${share.id}`, { role: 'editor' }))
        .status,
    ).toBe(409);

    // Administrators and other links are unaffected.
    expect((await fx.admin.get(`/api/documents/${documentId}`)).status).toBe(200);
    viewer.destroy();
    editor.destroy();
  });

  it('expiry disconnects an open viewer on time and prevents future access', async () => {
    const { documentId, assetId } = await shared('Expiry');
    const expiresAt = new Date(Date.now() + 2_500);
    const share = await fx.createShare(documentId, { expiresAt: expiresAt.toISOString() });
    const guest = new Agent(fx.server);
    const exchanged = await guest.post<{ expiresAt: string }>('/api/share/exchange', {
      grantId: share.id,
      secret: share.secret,
    });
    expect(new Date(exchanged.body.expiresAt).getTime()).toBe(expiresAt.getTime());
    const viewer = await connectCollab(guest, documentId);
    expect(viewer.ticket.accessExpiresAt).toBe(expiresAt.toISOString());

    const closed = await viewer.closed(8_000);
    const closedAt = Date.now();
    expect(closed).toEqual({ code: 4410, reason: 'access_expired' });
    expect(viewer.stateless).toContainEqual({ t: 'access', change: 'expired' });
    // On time: not before the expiry, and promptly after it (timer, not just the sweep).
    expect(closedAt).toBeGreaterThanOrEqual(expiresAt.getTime());
    expect(closedAt - expiresAt.getTime()).toBeLessThan(1_500);

    for (const path of [
      `/api/documents/${documentId}`,
      `/api/documents/${documentId}/assets/${assetId}`,
      `/api/documents/${documentId}/export?format=md`,
    ]) {
      const response = await guest.get(path);
      expect([path, response.status, response.code]).toEqual([path, 410, 'share_expired']);
    }
    expect((await requestTicket(guest, documentId, 1)).code).toBe('share_expired');
    const again = await new Agent(fx.server).post('/api/share/exchange', {
      grantId: share.id,
      secret: share.secret,
    });
    expect([again.status, again.code]).toEqual([410, 'share_expired']);
    const listed = await fx.admin.get<{ shares: ShareBody[] }>(
      `/api/documents/${documentId}/shares`,
    );
    expect(listed.body.shares[0]).toMatchObject({ state: 'expired', liveConnections: 0 });
    // Only an active link can be rotated: an expired one would yield another expired link.
    const rotate = await fx.admin.post(`/api/documents/${documentId}/shares/${share.id}/rotate`);
    expect([rotate.status, rotate.code]).toEqual([409, 'conflict']);
    viewer.destroy();
  });

  it('an earlier expiry set later is applied to open connections', async () => {
    const { documentId } = await shared('Shortened');
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const viewer = await connectCollab(guest, documentId);
    expect(viewer.ticket.accessExpiresAt).not.toBeNull();
    const soon = new Date(Date.now() + 1_500);
    const updated = await fx.admin.patch<{ share: ShareBody }>(
      `/api/documents/${documentId}/shares/${share.id}`,
      { expiresAt: soon.toISOString(), label: 'expires soon' },
    );
    expect(updated.body.share).toMatchObject({
      expiresAt: soon.toISOString(),
      label: 'expires soon',
    });
    expect(await viewer.closed(6_000)).toEqual({ code: 4410, reason: 'access_expired' });
    expect(Date.now()).toBeGreaterThanOrEqual(soon.getTime());
    viewer.destroy();
  });

  it('rotation replaces the link and invalidates everything derived from the old one', async () => {
    const { documentId } = await shared('Rotation');
    const share = await fx.createShare(documentId, { role: 'editor', label: 'team' });
    const guest = await fx.guest(share.id, share.secret);
    const connected = await connectCollab(guest, documentId);

    const rotated = await fx.admin.post<{ share: ShareBody; url: string }>(
      `/api/documents/${documentId}/shares/${share.id}/rotate`,
    );
    expect(rotated.status).toBe(201);
    expect(rotated.body.share.id).not.toBe(share.id);
    expect(rotated.body.share).toMatchObject({ role: 'editor', label: 'team', state: 'active' });
    const newSecret = new URL(rotated.body.url).hash.slice(1);
    expect(newSecret).not.toBe(share.secret);

    expect(await connected.closed(2_000)).toEqual({ code: 4403, reason: 'access_revoked' });
    expect((await guest.get(`/api/documents/${documentId}`)).code).toBe('share_revoked');
    const old = await new Agent(fx.server).post('/api/share/exchange', {
      grantId: share.id,
      secret: share.secret,
    });
    expect(old.code).toBe('share_revoked');
    // The old secret does not open the new grant.
    const crossed = await new Agent(fx.server).post('/api/share/exchange', {
      grantId: rotated.body.share.id,
      secret: share.secret,
    });
    expect(crossed.code).toBe('share_invalid');

    const renewed = await fx.guest(rotated.body.share.id, newSecret);
    const reconnected = await connectCollab(renewed, documentId);
    expect(reconnected.authenticatedScope).toBe('read-write');
    reconnected.destroy();
    connected.destroy();
    const states = await fx.admin.get<{ shares: ShareBody[] }>(
      `/api/documents/${documentId}/shares`,
    );
    expect(states.body.shares.map((item) => item.state).sort()).toEqual(['active', 'revoked']);
    expect(
      (await fx.admin.post(`/api/documents/${documentId}/shares/${share.id}/rotate`)).status,
    ).toBe(409);
  });

  it('a downgrade from editor to viewer applies to the open connection, and so does the upgrade back', async () => {
    const { documentId } = await shared('Downgrade');
    const share = await fx.createShare(documentId, { role: 'editor' });
    const guest = await fx.guest(share.id, share.secret);
    const client = await connectCollab(guest, documentId);
    expect(client.authenticatedScope).toBe('read-write');
    client.appendParagraph('written with edit access');
    await client.save();

    await fx.admin.ok(
      fx.admin.patch(`/api/documents/${documentId}/shares/${share.id}`, { role: 'viewer' }),
    );
    // Told at once; still connected.
    expect(await client.waitFor((m) => m.t === 'access' && m, { timeoutMs: 2_000 })).toEqual({
      t: 'access',
      change: 'role_changed',
      role: 'viewer',
    });
    expect(client.closes).toEqual([]);

    // The very same connection can no longer write.
    const witness = await connectCollab(fx.admin, documentId);
    client.appendParagraph('WRITTEN-AFTER-DOWNGRADE');
    client.mark();
    await sleep(500);
    expect(witness.text()).not.toContain('WRITTEN-AFTER-DOWNGRADE');
    expect(client.stateless.filter((m) => m.t === 'saved' && m.n >= client.n)).toEqual([]);
    const stored = await fx.server.sql<{ update: Buffer }>(
      'SELECT "update" FROM doc_updates WHERE document_id = $1',
      [documentId],
    );
    expect(stored.map((row) => row.update.toString('utf8')).join('')).not.toContain(
      'WRITTEN-AFTER-DOWNGRADE',
    );
    // It still receives live updates as a viewer.
    witness.appendParagraph('visible to the downgraded guest');
    await until(() => client.text().includes('visible to the downgraded guest'), {
      what: 'live as viewer',
    });
    expect((await guest.upload(documentId, demoPng(), 'x.png')).status).toBe(403);
    const info = await guest.get<DocumentBody>(`/api/documents/${documentId}`);
    expect(info.body.document.access.role).toBe('viewer');

    // Upgrade again: the connection is told and becomes writable in place.
    const upgradeFrom = client.stateless.length;
    await fx.admin.ok(
      fx.admin.patch(`/api/documents/${documentId}/shares/${share.id}`, { role: 'editor' }),
    );
    expect(
      await client.waitFor((m) => m.t === 'access' && m, { from: upgradeFrom, timeoutMs: 2_000 }),
    ).toEqual({ t: 'access', change: 'role_changed', role: 'editor' });
    // The refused paragraph is published by the next sync, as the protocol prescribes.
    client.provider.forceSync();
    await until(() => witness.text().includes('WRITTEN-AFTER-DOWNGRADE'), {
      what: 'resync after upgrade',
    });
    client.destroy();
    witness.destroy();
  });

  it('an independent membership survives the revocation of a link', async () => {
    const { documentId, assetId } = await shared('Independent');
    const member = await fx.createUser('Mia Member');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${member.userId}`, { role: 'viewer' }),
    );
    const share = await fx.createShare(documentId, { role: 'editor' });
    // The member opens the edit link while signed in: both permissions are presented.
    await member.ok(
      member.post('/api/share/exchange', { grantId: share.id, secret: share.secret }),
    );
    const before = await member.get<DocumentBody>(`/api/documents/${documentId}`);
    expect(before.body.document.access).toMatchObject({
      role: 'editor',
      via: 'share_link',
      accountId: member.userId,
    });
    const client = await connectCollab(member, documentId);
    expect(client.authenticatedScope).toBe('read-write');
    // Presence shows the signed-in account, not an anonymous guest.
    expect(client.ticket.participant).toMatchObject({
      kind: 'user',
      name: 'Mia Member',
      role: 'editor',
    });

    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/shares/${share.id}/revoke`));
    // Not disconnected: the membership still grants viewing, so it is a downgrade.
    expect(await client.waitFor((m) => m.t === 'access' && m, { timeoutMs: 2_000 })).toEqual({
      t: 'access',
      change: 'role_changed',
      role: 'viewer',
    });
    await sleep(300);
    expect(client.closes).toEqual([]);
    const after = await member.get<DocumentBody>(`/api/documents/${documentId}`);
    expect(after.body.document.access).toMatchObject({ role: 'viewer', via: 'membership' });
    expect((await member.get(`/api/documents/${documentId}/assets/${assetId}`)).status).toBe(200);
    expect((await member.upload(documentId, demoPng(), 'x.png')).status).toBe(403);
    expect((await requestTicket(member, documentId, 5)).body.role).toBe('viewer');

    // And the other way round: removing the membership does not touch a link.
    const second = await fx.createShare(documentId);
    await member.ok(
      member.post('/api/share/exchange', { grantId: second.id, secret: second.secret }),
    );
    await fx.admin.ok(fx.admin.delete(`/api/documents/${documentId}/members/${member.userId}`));
    const viaLink = await member.get<DocumentBody>(`/api/documents/${documentId}`);
    expect(viaLink.body.document.access).toMatchObject({ role: 'viewer', via: 'share_link' });
    // The open connection was authorized by the membership (and the first, revoked link):
    // it ends, and a new one is authorized by the second link.
    expect(await client.closed(2_000)).toEqual({ code: 4403, reason: 'access_revoked' });
    const viaSecondLink = await connectCollab(member, documentId);
    expect(viaSecondLink.authenticatedScope).toBe('readonly');
    viaSecondLink.destroy();
    client.destroy();
  });

  it('a guest can leave: the session ends and the cookie is cleared', async () => {
    const { documentId } = await shared('Leaving');
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const viewer = await connectCollab(guest, documentId);
    const token = guest.cookies.get(`rd_share_${documentId}`)?.value ?? '';
    const ended = await guest.post(`/api/documents/${documentId}/share-session/end`);
    expect(ended.status).toBe(204);
    expect(guest.cookies.size).toBe(0);
    expect(await viewer.closed(2_000)).toEqual({ code: 4401, reason: 'session_ended' });
    const replay = await new Agent(fx.server).get(`/api/documents/${documentId}`, {
      headers: { cookie: `rd_share_${documentId}=${token}` },
    });
    expect(replay.status).toBe(401);
    // The link itself still works for a new visit.
    expect((await fx.guest(share.id, share.secret)).cookies.size).toBe(1);
    viewer.destroy();
  });

  it('share links stop working when the document is trashed and work again when it is restored', async () => {
    const { documentId } = await shared('Trashed share');
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const viewer = await connectCollab(guest, documentId);
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/trash`));
    expect(await viewer.closed(2_000)).toEqual({ code: 4404, reason: 'document_unavailable' });
    expect(viewer.stateless).toContainEqual({ t: 'access', change: 'document_unavailable' });
    expect((await guest.get(`/api/documents/${documentId}`)).code).toBe('document_trashed');
    const exchange = await new Agent(fx.server).post('/api/share/exchange', {
      grantId: share.id,
      secret: share.secret,
    });
    expect([exchange.status, exchange.code]).toEqual([410, 'document_trashed']);
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/restore`));
    expect((await guest.get(`/api/documents/${documentId}`)).status).toBe(200);
    viewer.destroy();
  });

  it('keeps share secrets out of the audit trail and the server log', async () => {
    const { documentId } = await shared('Secrets');
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    const cookie = guest.cookies.get(`rd_share_${documentId}`)?.value ?? 'missing';
    const ticket = await requestTicket(guest, documentId, 3);
    const audit = await fx.admin.get('/api/audit?limit=500');
    const log = fx.server.log();
    for (const secret of [share.secret, cookie, ticket.body.ticket]) {
      expect(audit.text.includes(secret)).toBe(false);
      expect(log.includes(secret)).toBe(false);
    }
    expect(audit.text).toContain('share.created');
    expect(audit.text).toContain('share.exchanged');
    expect(audit.text).toContain('share.revoked');
    expect(audit.text).toContain('share.rotated');
    // The document text never appears in logs or audit events.
    expect(log).not.toContain('confidential text of');
    expect(audit.text).not.toContain('confidential text of');
  });
});
