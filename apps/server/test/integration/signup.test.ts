/**
 * Optional self-service sign-up (`ALLOW_SIGNUP`): off by default; when on, it creates a plain
 * workspace member with no document access, signs it in like an invitation accept, answers a
 * duplicate address with `conflict`, is rate limited per address and per e-mail, and obeys the
 * same Origin and CSRF rules as the other public POST routes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createFixture, requestTicket, type Fixture, type SessionBody } from './harness';

let off: Fixture;
let on: Fixture;
let limited: Fixture;
let documentId: string;

const PASSWORD = 'Signup-password-for-tests-1';

beforeAll(async () => {
  off = await createFixture('signup-off', { port: 4410 });
  on = await createFixture('signup-on', { port: 4411, env: { ALLOW_SIGNUP: 'true' } });
  limited = await createFixture('signup-limited', {
    port: 4412,
    env: { ALLOW_SIGNUP: 'true', RATE_SIGNUP_PER_IP: '4', RATE_SIGNUP_PER_EMAIL: '2' },
  });
  documentId = await on.createDocument('Existing confidential document');
}, 240_000);

afterAll(async () => {
  await Promise.all([off?.server.dispose(), on?.server.dispose(), limited?.server.dispose()]);
});

const body = (email: string, displayName = 'New Person') => ({
  email,
  displayName,
  password: PASSWORD,
});

async function userCount(fx: Fixture): Promise<number> {
  const rows = await fx.server.sql<{ n: string }>('SELECT count(*)::text AS n FROM users');
  return Number(rows[0]?.n);
}

describe('sign-up disabled (the default)', () => {
  it('reports signupEnabled false and answers forbidden without creating anything', async () => {
    const meta = await new Agent(off.server).get<{ signupEnabled: boolean }>('/api/meta');
    expect(meta.body.signupEnabled).toBe(false);
    const before = await userCount(off);
    const agent = new Agent(off.server);
    const result = await agent.post('/api/auth/signup', body('nobody@example.test'));
    expect([result.status, result.code]).toEqual([403, 'forbidden']);
    expect(result.headers.getSetCookie()).toEqual([]);
    expect(await userCount(off)).toBe(before);
  });
});

describe('sign-up enabled', () => {
  it('reports signupEnabled true', async () => {
    const meta = await new Agent(on.server).get<{ signupEnabled: boolean }>('/api/meta');
    expect(meta.body.signupEnabled).toBe(true);
  });

  it('creates a member, signs it in like an invitation accept, and audits it', async () => {
    const agent = new Agent(on.server);
    const result = await agent.post<SessionBody>(
      '/api/auth/signup',
      body('Newcomer@Example.test', 'Nia Newcomer'),
    );
    expect(result.status).toBe(201);
    expect(result.body.user).toMatchObject({
      email: 'newcomer@example.test',
      displayName: 'Nia Newcomer',
      role: 'member',
    });
    expect(result.body.csrfToken).toEqual(expect.any(String));
    const cookie = result.headers.getSetCookie().find((c) => c.startsWith('rd_session='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    // The session works with the cookie and the token that came back.
    agent.csrfToken = result.body.csrfToken;
    const session = await agent.get<SessionBody>('/api/auth/session');
    expect(session.body.user?.email).toBe('newcomer@example.test');
    expect(session.body.user?.role).toBe('member');
    const list = await agent.get<{ documents: unknown[] }>('/api/documents?view=active');
    expect(list.body.documents).toEqual([]);
    // Members cannot use administrator routes.
    expect((await agent.get('/api/invitations')).status).toBe(403);

    // The password works for a later sign-in.
    const again = new Agent(on.server);
    expect((await again.login('newcomer@example.test', PASSWORD)).status).toBe(200);

    const audit = await on.server.sql<{ action: string; details: { role: string } }>(
      `SELECT action, details FROM audit_events WHERE action = 'auth.signup'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toEqual({ role: 'member' });
    // Neither the password nor its hash is logged.
    expect(on.server.log()).not.toContain(PASSWORD);
  });

  it('gives the new member no access to an existing document (404, like an unknown id)', async () => {
    const agent = new Agent(on.server);
    const created = await agent.post<SessionBody>(
      '/api/auth/signup',
      body('outsider@example.test'),
    );
    agent.csrfToken = created.body.csrfToken;
    const real = await agent.get(`/api/documents/${documentId}`);
    const unknown = await agent.get('/api/documents/00000000-0000-4000-8000-000000000000');
    expect([real.status, real.code]).toEqual([404, 'not_found']);
    expect(real.body).toMatchObject({ error: { code: unknown.code } });
    expect((await agent.get(`/api/documents/${documentId}/export?format=txt`)).status).toBe(404);
    expect((await requestTicket(agent, documentId, 77)).status).toBe(404);
    const members = await on.server.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM document_members m JOIN users u ON u.id = m.user_id
        WHERE u.email = 'outsider@example.test'`,
    );
    expect(members[0]?.n).toBe('0');
  });

  it('answers a duplicate address with conflict, in any letter case, and leaks nothing else', async () => {
    const first = new Agent(on.server);
    expect((await first.post('/api/auth/signup', body('dup@example.test'))).status).toBe(201);
    const before = await userCount(on);
    for (const email of ['dup@example.test', 'DUP@Example.test']) {
      const second = new Agent(on.server);
      const result = await second.post('/api/auth/signup', {
        ...body(email, 'Someone Else'),
        password: 'A-completely-different-1',
      });
      expect([result.status, result.code]).toEqual([409, 'conflict']);
      expect(result.headers.getSetCookie()).toEqual([]);
      expect(result.text).not.toMatch(/dup@example|Someone|password|hash/i);
    }
    expect(await userCount(on)).toBe(before);
    // The existing password was not replaced.
    expect((await new Agent(on.server).login('dup@example.test', PASSWORD)).status).toBe(200);
  });

  it('refuses a foreign Origin, a missing Origin and a missing CSRF header', async () => {
    const before = await userCount(on);
    const agent = new Agent(on.server);
    const foreign = await agent.post('/api/auth/signup', body('evil@example.test'), {
      origin: 'http://evil.example',
    });
    expect([foreign.status, foreign.code]).toEqual([403, 'bad_origin']);
    const none = await agent.post('/api/auth/signup', body('evil@example.test'), { origin: null });
    expect([none.status, none.code]).toEqual([403, 'bad_origin']);
    const noCsrf = await agent.post('/api/auth/signup', body('evil@example.test'), { csrf: null });
    expect([noCsrf.status, noCsrf.code]).toEqual([403, 'csrf_failed']);
    expect(await userCount(on)).toBe(before);
  });

  it('validates the input', async () => {
    const agent = new Agent(on.server);
    const weak = await agent.post('/api/auth/signup', {
      ...body('weak@example.test'),
      password: 'short',
    });
    expect([weak.status, weak.code]).toEqual([400, 'validation_failed']);
    const bad = await agent.post('/api/auth/signup', body('not-an-address'));
    expect([bad.status, bad.code]).toEqual([400, 'validation_failed']);
  });

  it('never creates an administrator, even when asked to', async () => {
    const agent = new Agent(on.server);
    const result = await agent.post<SessionBody>('/api/auth/signup', {
      ...body('sneaky@example.test'),
      role: 'admin',
    });
    expect(result.status).toBe(201);
    expect(result.body.user?.role).toBe('member');
    const rows = await on.server.sql<{ role: string }>(
      `SELECT role FROM users WHERE email = 'sneaky@example.test'`,
    );
    expect(rows[0]?.role).toBe('member');
  });
});

describe('sign-up rate limits', () => {
  it('limits attempts per e-mail address and per client address', async () => {
    // A new browser each time: a browser that signed up already holds a session and token.
    const agent = {
      post: (...args: Parameters<Agent['post']>) => new Agent(limited.server).post(...args),
    };
    // Per e-mail (2): create, duplicate, then the limit.
    expect((await agent.post('/api/auth/signup', body('rate@example.test'))).status).toBe(201);
    expect((await agent.post('/api/auth/signup', body('rate@example.test'))).status).toBe(409);
    const emailLimited = await agent.post('/api/auth/signup', body('rate@example.test'));
    expect([emailLimited.status, emailLimited.code]).toEqual([429, 'rate_limited']);
    expect(Number(emailLimited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Per address (4): three attempts so far; the fourth passes, the fifth does not,
    // whatever the address in the body.
    expect((await agent.post('/api/auth/signup', body('rate2@example.test'))).status).toBe(201);
    const ipLimited = await agent.post('/api/auth/signup', body('rate3@example.test'));
    expect([ipLimited.status, ipLimited.code]).toEqual([429, 'rate_limited']);
    const rows = await limited.server.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM users WHERE email = 'rate3@example.test'`,
    );
    expect(rows[0]?.n).toBe('0');
  });
});
