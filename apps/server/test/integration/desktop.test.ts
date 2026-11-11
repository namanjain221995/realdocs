/**
 * "Open in Desktop": single-use handoff codes, document-scoped bearer
 * sessions, and their revocation together with whatever they were derived from.
 */
import { parseDesktopHandoffUrl } from '@realtimedocs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Agent,
  connectCollab,
  createFixture,
  makePng,
  requestTicket,
  type DocumentBody,
  type Fixture,
} from './harness';

let fx: Fixture;
let editor: Awaited<ReturnType<Fixture['createUser']>>;
let documentId: string;
let otherDocument: string;

interface HandoffBody {
  code: string;
  url: string;
  expiresAt: string;
}

interface DesktopSession {
  token?: string;
  documentId: string;
  title: string;
  role: string;
  expiresAt: string | null;
  accountId: string | null;
}

const DESKTOP_ORIGIN = 'app://realtimedocs';

/** The desktop main process: no cookies, no Origin header. */
const mainProcess = () => new Agent(fx.server, null);

/** The desktop renderer after the main process injected the bearer token. */
function desktopClient(token: string): Agent {
  const agent = new Agent(fx.server, DESKTOP_ORIGIN);
  agent.bearer = token;
  return agent;
}

async function handoff(agent: Agent, target = documentId): Promise<HandoffBody> {
  return agent.ok(agent.post<HandoffBody>(`/api/documents/${target}/desktop-handoff`));
}

async function redeem(code: string, target = documentId) {
  return mainProcess().post<DesktopSession>('/api/desktop/redeem', { documentId: target, code });
}

beforeAll(async () => {
  fx = await createFixture('desktop');
  editor = await fx.createUser('Dee Desktop');
  documentId = await fx.createDocument('Desktop document');
  otherDocument = await fx.createDocument('Another document');
  await fx.admin.ok(
    fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
  );
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

describe('handoff codes', () => {
  it('produce a validated deep link and a document-scoped session, exactly once', async () => {
    const created = await editor.post<HandoffBody>(`/api/documents/${documentId}/desktop-handoff`);
    expect(created.status).toBe(201);
    const lifetime = new Date(created.body.expiresAt).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(50_000);
    expect(lifetime).toBeLessThanOrEqual(60_000);
    expect(parseDesktopHandoffUrl(created.body.url)).toEqual({
      serverOrigin: fx.server.origin,
      documentId,
      code: created.body.code,
    });
    // Only a hash of the code is stored.
    const [stored] = await fx.server.sql<{ matches: boolean }>(
      `SELECT code_hash = sha256(convert_to($1, 'UTF8')) AS matches FROM desktop_handoffs
        ORDER BY created_at DESC LIMIT 1`,
      [created.body.code],
    );
    expect(stored?.matches).toBe(true);

    const redeemed = await redeem(created.body.code);
    expect(redeemed.status).toBe(201);
    expect(redeemed.body).toMatchObject({
      documentId,
      title: 'Desktop document',
      role: 'editor',
      accountId: editor.userId,
    });
    expect(redeemed.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(redeemed.headers.getSetCookie()).toEqual([]);

    // Single use: a second redemption fails, also for the legitimate holder.
    const again = await redeem(created.body.code);
    expect([again.status, again.code]).toEqual([400, 'handoff_invalid']);
  });

  it('are rejected when unknown, expired, used for another document, or sent from a foreign origin', async () => {
    const unknown = await redeem('A'.repeat(43));
    expect([unknown.status, unknown.code]).toEqual([400, 'handoff_invalid']);
    expect((await redeem('too-short')).code).toBe('validation_failed');

    const expired = await handoff(editor);
    await fx.server.sql(
      `UPDATE desktop_handoffs SET expires_at = now() - interval '1 second'
        WHERE code_hash = sha256(convert_to($1, 'UTF8'))`,
      [expired.code],
    );
    expect((await redeem(expired.code)).code).toBe('handoff_invalid');

    // Presenting a code for the wrong document fails and burns the code.
    const wrong = await handoff(editor);
    expect((await redeem(wrong.code, otherDocument)).code).toBe('handoff_invalid');
    expect((await redeem(wrong.code)).code).toBe('handoff_invalid');

    const foreign = await handoff(editor);
    const evil = await new Agent(fx.server, 'https://evil.example').post('/api/desktop/redeem', {
      documentId,
      code: foreign.code,
    });
    expect(evil.code).toBe('bad_origin');
    // … while the packaged renderer's origin is accepted.
    const renderer = await new Agent(fx.server, DESKTOP_ORIGIN).post<DesktopSession>(
      '/api/desktop/redeem',
      {
        documentId,
        code: foreign.code,
      },
    );
    expect(renderer.status).toBe(201);

    // All failures look the same to the caller.
    expect(unknown.text.replace(/"requestId":"[^"]+"/, '')).toBe(
      (await redeem(expired.code)).text.replace(/"requestId":"[^"]+"/, ''),
    );
    // No handoff without access.
    const outsider = await fx.createUser('Olaf Outsider');
    expect((await outsider.post(`/api/documents/${documentId}/desktop-handoff`)).status).toBe(404);
    expect(
      (await new Agent(fx.server).post(`/api/documents/${documentId}/desktop-handoff`)).status,
    ).toBe(401);
  });

  it('cannot be redeemed after the principal lost access', async () => {
    const temp = await fx.createUser('Tess Temporary');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${temp.userId}`, { role: 'viewer' }),
    );
    const pending = await handoff(temp);
    await fx.admin.ok(fx.admin.delete(`/api/documents/${documentId}/members/${temp.userId}`));
    expect((await redeem(pending.code)).code).toBe('handoff_invalid');

    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${temp.userId}`, { role: 'viewer' }),
    );
    const second = await handoff(temp);
    await temp.post('/api/auth/logout');
    expect((await redeem(second.code)).code).toBe('handoff_invalid');
  });
});

describe('desktop sessions', () => {
  it('are scoped to one document and never carry management rights', async () => {
    const { token } = (await redeem((await handoff(fx.admin)).code)).body;
    const desktop = desktopClient(token ?? '');

    const session = await desktop.get<DesktopSession>('/api/desktop/session');
    expect(session.status).toBe(200);
    // An administrator's desktop session edits; administration stays in the browser.
    expect(session.body).toMatchObject({ documentId, role: 'editor', accountId: fx.admin.userId });
    expect(session.body.token).toBeUndefined();

    const document = await desktop.get<DocumentBody>(`/api/documents/${documentId}`);
    expect(document.body.document.access).toMatchObject({ role: 'editor', via: 'workspace_admin' });
    expect((await desktop.get(`/api/documents/${documentId}/export?format=txt`)).status).toBe(200);
    // Bearer requests need no CSRF token; the renderer origin is allowed by CORS.
    const upload = await desktop.upload(documentId, makePng(8, 8), 'from-desktop.png');
    expect(upload.status).toBe(201);
    const image = await desktop.get(`/api/documents/${documentId}/assets/${upload.body.asset.id}`);
    expect(image.status).toBe(200);
    // Images are embedded cross-origin by the renderer.
    expect(image.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const client = await connectCollab(desktop, documentId);
    expect(client.ticket.role).toBe('editor');
    expect(client.ticket.participant).toMatchObject({ name: 'Ada Admin', kind: 'user' });
    client.appendParagraph('typed in the desktop panel');
    await client.save();
    client.destroy();

    // No management, even though the account is an administrator.
    for (const [method, path] of [
      ['GET', `/api/documents/${documentId}/shares`],
      ['POST', `/api/documents/${documentId}/shares`],
      ['GET', `/api/documents/${documentId}/members`],
      ['GET', `/api/documents/${documentId}/access`],
      ['GET', `/api/documents/${documentId}/snapshots`],
      ['POST', `/api/documents/${documentId}/trash`],
      ['POST', `/api/documents/${documentId}/duplicate`],
      ['PATCH', `/api/documents/${documentId}`],
      ['DELETE', `/api/documents/${documentId}`],
    ] as const) {
      const response = await desktop.request(
        method,
        path,
        method === 'GET' ? {} : { body: { title: 'x', role: 'editor' } },
      );
      expect([method, path, response.status, response.code]).toEqual([
        method,
        path,
        403,
        'forbidden',
      ]);
    }
    // No other document, no account-level routes.
    expect((await desktop.get(`/api/documents/${otherDocument}`)).status).toBe(404);
    expect((await desktop.get(`/api/documents/${otherDocument}/export?format=txt`)).status).toBe(
      404,
    );
    expect((await requestTicket(desktop, otherDocument, 1)).status).toBe(404);
    for (const path of ['/api/documents', '/api/users', '/api/audit', '/api/invitations']) {
      expect([path, (await desktop.get(path)).status]).toEqual([path, 401]);
    }
    expect((await desktop.post('/api/documents', { title: 'x' })).status).toBe(401);
    // The token is not a browser session.
    const asCookie = await new Agent(fx.server).get('/api/documents', {
      headers: { cookie: `rd_session=${token}` },
    });
    expect(asCookie.status).toBe(401);
    // A bearer request ignores cookies entirely: the administrator's cookie adds nothing.
    desktop.cookies.set('rd_session', fx.admin.cookies.get('rd_session')!);
    expect((await desktop.get('/api/users')).status).toBe(401);
    expect((await desktop.get(`/api/documents/${otherDocument}`)).status).toBe(404);
  });

  it('answer CORS preflights for the desktop origin only, never with credentials', async () => {
    const preflight = (origin: string) =>
      fetch(`${fx.server.origin}/api/documents/${documentId}/collab-ticket`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type,x-rd-csrf',
        },
      });
    const allowed = await preflight(DESKTOP_ORIGIN);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(DESKTOP_ORIGIN);
    expect(allowed.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    );
    expect(allowed.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-rd-csrf',
    );
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();
    for (const origin of ['https://evil.example', fx.server.origin]) {
      const denied = await preflight(origin);
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    }
    // A cookie sent from the desktop origin is not honoured (bearer tokens only).
    const withCookie = await new Agent(fx.server, DESKTOP_ORIGIN).get('/api/documents', {
      headers: {
        origin: DESKTOP_ORIGIN,
        cookie: `rd_session=${fx.admin.cookies.get('rd_session')?.value}`,
      },
    });
    expect(withCookie.status).toBe(401);
  });

  it('end when the user signs out of the desktop app', async () => {
    const { token } = (await redeem((await handoff(editor)).code)).body;
    const desktop = desktopClient(token ?? '');
    const client = await connectCollab(desktop, documentId);
    expect((await desktop.post('/api/desktop/logout')).status).toBe(204);
    expect(await client.closed(2_000)).toEqual({ code: 4401, reason: 'session_ended' });
    expect((await desktop.get('/api/desktop/session')).status).toBe(401);
    expect((await desktop.get(`/api/documents/${documentId}`)).status).toBe(401);
    // The browser session it came from is untouched.
    expect((await editor.get(`/api/documents/${documentId}`)).status).toBe(200);
    client.destroy();
  });

  it('are revoked together with the browser session they were derived from', async () => {
    const browser = new Agent(fx.server);
    await browser.login(editor.email, editor.password);
    const { token } = (await redeem((await handoff(browser)).code)).body;
    const desktop = desktopClient(token ?? '');
    const client = await connectCollab(desktop, documentId);
    expect((await desktop.get('/api/desktop/session')).status).toBe(200);

    // Signing out in the browser ends the desktop session derived from it …
    expect((await browser.post('/api/auth/logout')).status).toBe(204);
    expect(await client.closed(2_000)).toEqual({ code: 4401, reason: 'session_ended' });
    expect((await desktop.get('/api/desktop/session')).status).toBe(401);
    expect((await desktop.get(`/api/documents/${documentId}/export?format=txt`)).status).toBe(401);
    expect((await requestTicket(desktop, documentId, 3)).status).toBe(401);
    // … but not the user's other browser session or desktop sessions derived from that one.
    expect((await editor.get('/api/auth/session')).status).toBe(200);
    client.destroy();
  });

  it('follow the account: role changes, removed membership, disabled account', async () => {
    const user = await fx.createUser('Rory Role');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${user.userId}`, { role: 'editor' }),
    );
    const { token } = (await redeem((await handoff(user)).code)).body;
    const desktop = desktopClient(token ?? '');
    const client = await connectCollab(desktop, documentId);
    expect(client.authenticatedScope).toBe('read-write');

    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${user.userId}`, { role: 'viewer' }),
    );
    expect(await client.waitFor((m) => m.t === 'access' && m, { timeoutMs: 2_000 })).toEqual({
      t: 'access',
      change: 'role_changed',
      role: 'viewer',
    });
    expect((await desktop.get<DesktopSession>('/api/desktop/session')).body.role).toBe('viewer');
    expect((await desktop.upload(documentId, makePng(4, 4), 'x.png')).status).toBe(403);

    await fx.admin.ok(fx.admin.delete(`/api/documents/${documentId}/members/${user.userId}`));
    expect(await client.closed(2_000)).toEqual({ code: 4403, reason: 'access_revoked' });
    expect((await desktop.get('/api/desktop/session')).status).toBe(404);

    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${user.userId}`, { role: 'editor' }),
    );
    expect((await desktop.get('/api/desktop/session')).status).toBe(200);
    await fx.admin.ok(fx.admin.patch(`/api/users/${user.userId}`, { status: 'disabled' }));
    expect((await desktop.get('/api/desktop/session')).status).toBe(401);
    client.destroy();
  });

  it('derived from a share link end when the link is revoked', async () => {
    const share = await fx.createShare(documentId, { role: 'editor' });
    const guest = await fx.guest(share.id, share.secret);
    // Open in Desktop from the browser guest session …
    const viaHandoff = (await redeem((await handoff(guest)).code)).body;
    expect(viaHandoff).toMatchObject({ role: 'editor', accountId: null });
    // … and "Paste share link" in the desktop app.
    const pasted = await mainProcess().post<{ token: string; role: string; documentId: string }>(
      '/api/share/exchange',
      { grantId: share.id, secret: share.secret, mode: 'bearer' },
    );
    expect(pasted.body).toMatchObject({ role: 'editor', documentId });

    const clients = [];
    for (const token of [viaHandoff.token ?? '', pasted.body.token]) {
      const desktop = desktopClient(token);
      const info = await desktop.get<DocumentBody>(`/api/documents/${documentId}`);
      expect(info.body.document.access).toMatchObject({
        role: 'editor',
        via: 'share_link',
        accountId: null,
      });
      expect((await desktop.get(`/api/documents/${otherDocument}`)).status).toBe(404);
      const client = await connectCollab(desktop, documentId);
      expect(client.ticket.participant.kind).toBe('guest');
      clients.push({ desktop, client });
    }

    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/shares/${share.id}/revoke`));
    for (const { desktop, client } of clients) {
      expect(await client.closed(2_000)).toEqual({ code: 4403, reason: 'access_revoked' });
      const session = await desktop.get('/api/desktop/session');
      expect([session.status, session.code]).toEqual([410, 'share_revoked']);
      expect((await desktop.get(`/api/documents/${documentId}/export?format=txt`)).status).toBe(
        410,
      );
      expect((await requestTicket(desktop, documentId, 9)).status).toBe(410);
      client.destroy();
    }
  });

  it('keep handoff codes and bearer tokens out of logs and audit events', async () => {
    const created = await handoff(editor);
    const { token } = (await redeem(created.code)).body;
    const audit = await fx.admin.get('/api/audit?limit=500');
    const log = fx.server.log();
    for (const secret of [created.code, token ?? 'missing']) {
      expect(log.includes(secret)).toBe(false);
      expect(audit.text.includes(secret)).toBe(false);
    }
    expect(audit.text).toContain('desktop.session_created');
    expect(audit.text).toContain('desktop.redeem_failed');
  });
});
