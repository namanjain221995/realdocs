/** Authentication, sessions, CSRF and origin rules, invitations, account administration. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  Agent,
  connectCollab,
  createFixture,
  type DocumentBody,
  type Fixture,
  type SessionBody,
} from './harness';

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture('auth');
});

afterAll(async () => {
  await fx.server.dispose();
});

describe('sign-in', () => {
  it('sets an HttpOnly, SameSite=Lax session cookie and stores only a hash of the token', async () => {
    const agent = new Agent(fx.server);
    const login = await agent.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(login.status).toBe(200);
    const cookie = agent.cookies.get('rd_session');
    expect(cookie).toMatchObject({ path: '/', httpOnly: true, sameSite: 'Lax', secure: false });
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.text).not.toContain(cookie?.value ?? 'x');

    const stored = await fx.server.sql<{ hash: Buffer; matches: boolean }>(
      `SELECT token_hash AS hash, token_hash = sha256($1::bytea) AS matches
         FROM sessions ORDER BY created_at DESC LIMIT 1`,
      [Buffer.from(cookie?.value ?? '', 'utf8')],
    );
    expect(stored[0]?.matches).toBe(true);
    expect(stored[0]?.hash).toHaveLength(32);
    const raw = await fx.server.sql(
      "SELECT 1 FROM sessions WHERE encode(token_hash, 'escape') LIKE $1",
      [`%${cookie?.value}%`],
    );
    expect(raw).toHaveLength(0);
  });

  it('answers the same way for a wrong password, an unknown email and a disabled account', async () => {
    const victim = await fx.createUser('Disabled Dana');
    await fx.admin.ok(fx.admin.patch(`/api/users/${victim.userId}`, { status: 'disabled' }));

    const agent = new Agent(fx.server);
    const wrong = await agent.login(ADMIN_EMAIL, 'not-the-right-password');
    const unknown = await agent.login('nobody@example.test', 'not-the-right-password');
    const disabled = await agent.login(victim.email, victim.password);
    for (const attempt of [wrong, unknown, disabled]) {
      expect(attempt.status).toBe(401);
      expect(attempt.code).toBe('unauthenticated');
      expect(attempt.headers.getSetCookie()).toEqual([]);
    }
    const message = (wrong.body as unknown as { error: { message: string } }).error.message;
    expect((unknown.body as unknown as { error: { message: string } }).error.message).toBe(message);
    expect((disabled.body as unknown as { error: { message: string } }).error.message).toBe(
      message,
    );
  });

  it('spends comparable time on unknown and known accounts', async () => {
    const agent = new Agent(fx.server);
    const time = async (email: string) => {
      const started = performance.now();
      await agent.login(email, 'wrong-password-wrong-password');
      return performance.now() - started;
    };
    await time(ADMIN_EMAIL);
    const known = Math.min(await time(ADMIN_EMAIL), await time(ADMIN_EMAIL));
    const unknown = Math.min(await time('ghost1@example.test'), await time('ghost2@example.test'));
    // Both paths run one Argon2id derivation; neither returns "instantly".
    expect(unknown).toBeGreaterThan(known * 0.4);
    expect(unknown).toBeGreaterThan(20);
  });

  it('rate-limits failed sign-ins per email address and reports when to retry', async () => {
    const target = await fx.createUser('Limited Lee');
    const agent = new Agent(fx.server);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      statuses.push((await agent.login(target.email, 'wrong-password-wrong')).status);
    }
    expect(statuses).toEqual(Array.from({ length: 8 }, () => 401));

    const limited = await agent.login(target.email, 'wrong-password-wrong');
    expect(limited.status).toBe(429);
    expect(limited.code).toBe('rate_limited');
    const retryAfter = (limited.body as unknown as { error: { retryAfterSeconds: number } }).error
      .retryAfterSeconds;
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(Number(limited.headers.get('retry-after'))).toBe(retryAfter);

    // The correct password is not accepted while the address is locked out …
    expect((await agent.login(target.email, target.password)).status).toBe(429);
    // … and other accounts are unaffected.
    expect((await new Agent(fx.server).login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
  });
});

describe('sessions', () => {
  it('logout revokes the session on the server, not just the cookie', async () => {
    const agent = new Agent(fx.server);
    await agent.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = agent.cookies.get('rd_session')?.value ?? '';
    expect((await agent.get('/api/documents')).status).toBe(200);

    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(204);
    expect(agent.cookies.has('rd_session')).toBe(false);

    // Replaying the old cookie does not work.
    const replay = await new Agent(fx.server).get('/api/documents', {
      headers: { cookie: `rd_session=${token}` },
    });
    expect(replay.status).toBe(401);
    expect(replay.code).toBe('unauthenticated');
    expect((await agent.get<SessionBody>('/api/auth/session')).body.user).toBeNull();
  });

  it('enforces absolute and idle expiry on every request', async () => {
    const agent = new Agent(fx.server);
    await agent.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = agent.cookies.get('rd_session')?.value ?? '';
    const hash = "sha256(convert_to($1, 'UTF8'))";
    expect((await agent.get('/api/documents')).status).toBe(200);

    // Idle for longer than the idle limit (3 days by default).
    await fx.server.sql(
      `UPDATE sessions SET last_seen_at = now() - interval '4 days' WHERE token_hash = ${hash}`,
      [token],
    );
    const idle = await agent.get('/api/documents');
    expect(idle.status).toBe(401);
    expect(idle.code).toBe('session_expired');
    // The dead cookie is cleared so the browser stops presenting it.
    expect(agent.cookies.has('rd_session')).toBe(false);

    const second = new Agent(fx.server);
    await second.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const secondToken = second.cookies.get('rd_session')?.value ?? '';
    await fx.server.sql(
      `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = ${hash}`,
      [secondToken],
    );
    const absolute = await second.get('/api/documents');
    expect(absolute.code).toBe('session_expired');
    expect((await second.post('/api/documents', { title: 'x' })).status).toBe(401);
  });

  it('changing the password ends every other session of the account', async () => {
    const user = await fx.createUser('Pat Password');
    const other = new Agent(fx.server);
    await other.login(user.email, user.password);
    expect((await other.get('/api/documents')).status).toBe(200);

    const wrongCurrent = await user.post('/api/auth/password', {
      currentPassword: 'definitely not it',
      newPassword: 'A-brand-new-password-42',
    });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.code).toBe('validation_failed');
    const tooShort = await user.post('/api/auth/password', {
      currentPassword: user.password,
      newPassword: 'short',
    });
    expect(tooShort.code).toBe('validation_failed');

    const changed = await user.post('/api/auth/password', {
      currentPassword: user.password,
      newPassword: 'A-brand-new-password-42',
    });
    expect(changed.status).toBe(204);

    // The session that changed the password stays; the other one is gone.
    expect((await user.get('/api/documents')).status).toBe(200);
    expect((await other.get('/api/documents')).status).toBe(401);
    expect((await new Agent(fx.server).login(user.email, user.password)).status).toBe(401);
    expect((await new Agent(fx.server).login(user.email, 'A-brand-new-password-42')).status).toBe(
      200,
    );
  });

  it('"sign out everywhere else" ends every other session of the account and nothing else', async () => {
    const user = await fx.createUser('Sasha Sessions');
    const documentId = await fx.createDocument('Session test');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${user.userId}`, { role: 'editor' }),
    );
    // `user` is the calling browser; a second browser and desktop sessions of both exist.
    const otherBrowser = new Agent(fx.server);
    await otherBrowser.login(user.email, user.password);
    const desktopOf = async (browser: Agent) => {
      const handoff = await browser.ok(
        browser.post<{ code: string }>(`/api/documents/${documentId}/desktop-handoff`),
      );
      const redeemed = await new Agent(fx.server, null).post<{ token: string }>(
        '/api/desktop/redeem',
        {
          documentId,
          code: handoff.code,
        },
      );
      const desktop = new Agent(fx.server, 'app://realtimedocs');
      desktop.bearer = redeemed.body.token;
      return desktop;
    };
    const desktopOfOther = await desktopOf(otherBrowser);
    const desktopOfCaller = await desktopOf(user);
    const bystander = await fx.createUser('Bo Bystander');

    const liveOther = await connectCollab(otherBrowser, documentId);
    const liveDesktop = await connectCollab(desktopOfOther, documentId);
    const liveCaller = await connectCollab(user, documentId);

    // Needs a signed-in account and the CSRF token, like every mutation.
    expect((await new Agent(fx.server).post('/api/auth/sessions/revoke-others')).status).toBe(401);
    expect(
      (await user.post('/api/auth/sessions/revoke-others', undefined, { csrf: '1' })).code,
    ).toBe('csrf_failed');
    expect((await desktopOfCaller.post('/api/auth/sessions/revoke-others')).status).toBe(401);

    const result = await user.post<{ revoked: number }>('/api/auth/sessions/revoke-others');
    expect(result.status).toBe(200);
    // The other browser session and the desktop session created from it.
    expect(result.body).toEqual({ revoked: 2 });

    // Their live connections close through the session-ended path.
    for (const connection of [liveOther, liveDesktop]) {
      expect(await connection.waitFor((m) => m.t === 'access' && m, { timeoutMs: 2_000 })).toEqual({
        t: 'access',
        change: 'session_ended',
      });
      expect(await connection.closed(2_000)).toEqual({ code: 4401, reason: 'session_ended' });
    }
    expect((await otherBrowser.get('/api/documents')).status).toBe(401);
    expect((await otherBrowser.get<SessionBody>('/api/auth/session')).body.user).toBeNull();
    expect((await desktopOfOther.get('/api/desktop/session')).status).toBe(401);
    expect((await desktopOfOther.get(`/api/documents/${documentId}`)).status).toBe(401);

    // The caller, its own desktop session and its live connection are untouched.
    expect((await user.get('/api/documents')).status).toBe(200);
    expect((await desktopOfCaller.get('/api/desktop/session')).status).toBe(200);
    liveCaller.appendParagraph('still connected');
    await liveCaller.save();
    expect(liveCaller.closes).toEqual([]);
    // Other accounts are not affected.
    expect((await bystander.get('/api/documents')).status).toBe(200);
    expect((await fx.admin.get('/api/documents')).status).toBe(200);

    // Nothing left to end the second time.
    expect((await user.post<{ revoked: number }>('/api/auth/sessions/revoke-others')).body).toEqual(
      {
        revoked: 0,
      },
    );
    // Signing in again works as usual.
    expect((await otherBrowser.login(user.email, user.password)).status).toBe(200);
    for (const connection of [liveOther, liveDesktop, liveCaller]) connection.destroy();
  });

  it('an operator can reset a forgotten password from the command line', async () => {
    const user = await fx.createUser('Fern Forgetful');
    const documentId = await fx.createDocument('Reset test');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${user.userId}`, { role: 'editor' }),
    );
    const live = await connectCollab(user, documentId);
    const hashOf = async () =>
      (
        await fx.server.sql<{ hash: string }>(
          'SELECT password_hash AS hash FROM users WHERE id = $1',
          [user.userId],
        )
      )[0]?.hash;
    const before = await hashOf();

    // Refusals: unknown account, bad arguments, weak password, disabled account. Nothing changes.
    const unknown = await fx.server.cli([
      'reset-password',
      '--email',
      'nobody@example.test',
      '--generate',
    ]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/No account with the email address nobody@example\.test exists/);
    expect(unknown.stdout).toBe('');
    const noEmail = await fx.server.cli(['reset-password', '--generate']);
    expect([noEmail.code, noEmail.stderr]).toEqual([1, 'A valid --email is required.\n']);
    const both = await fx.server.cli(
      ['reset-password', '--email', user.email, '--generate', '--password-stdin'],
      'Another-password-123',
    );
    expect(both.code).toBe(1);
    const noPassword = await fx.server.cli(['reset-password', '--email', user.email]);
    expect(noPassword.code).toBe(1);
    expect(noPassword.stderr).toMatch(/No password given/);
    const weak = await fx.server.cli(
      ['reset-password', '--email', user.email, '--password-stdin'],
      'short',
    );
    expect(weak.code).toBe(1);
    const unknownFlag = await fx.server.cli([
      'reset-password',
      '--email',
      user.email,
      '--password',
      'x',
    ]);
    expect(unknownFlag.code).toBe(64);
    const disabled = await fx.createUser('Dana Disabled');
    await fx.admin.ok(fx.admin.patch(`/api/users/${disabled.userId}`, { status: 'disabled' }));
    const refused = await fx.server.cli([
      'reset-password',
      '--email',
      disabled.email,
      '--generate',
    ]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/is disabled/);
    // No generated password was printed for a refused account.
    expect(refused.stdout).toBe('');
    expect(await hashOf()).toBe(before);
    expect((await user.get('/api/documents')).status).toBe(200);

    // The reset itself: the new password is read from stdin and never echoed.
    const newPassword = 'Operator-chosen-password-77';
    const reset = await fx.server.cli(
      ['reset-password', '--email', user.email.toUpperCase(), '--password-stdin'],
      `${newPassword}\n`,
    );
    expect(reset.code, reset.stderr).toBe(0);
    expect(reset.stdout).toMatch(/Password of .* was reset\. 1 session\(s\) were ended\./);
    expect(reset.stdout + reset.stderr).not.toContain(newPassword);
    const after = await hashOf();
    expect(after).not.toBe(before);
    expect(after).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);

    // Every session of the account is gone; the live connection is closed by the server's next check.
    expect((await user.get('/api/documents')).status).toBe(401);
    expect(await live.closed(8_000)).toEqual({ code: 4401, reason: 'session_ended' });
    expect((await new Agent(fx.server).login(user.email, user.password)).status).toBe(401);
    const fresh = new Agent(fx.server);
    expect((await fresh.login(user.email, newPassword)).status).toBe(200);

    // --generate prints the new password exactly once, as the last line.
    const generated = await fx.server.cli(['reset-password', '--email', user.email, '--generate']);
    expect(generated.code).toBe(0);
    const password = generated.stdout.trim().split('\n').at(-1) ?? '';
    expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await fresh.get('/api/documents')).status).toBe(401);
    expect((await new Agent(fx.server).login(user.email, newPassword)).status).toBe(401);
    expect((await new Agent(fx.server).login(user.email, password)).status).toBe(200);

    const audit = await fx.admin.get<{
      events: { action: string; details: Record<string, unknown> }[];
    }>('/api/audit?limit=500');
    const events = audit.body.events.filter((event) => event.action === 'auth.password_reset');
    expect(events).toHaveLength(2);
    expect(events[0]?.details).toMatchObject({ by: 'operator_cli' });
    expect(audit.text).not.toContain(newPassword);
    expect(audit.text).not.toContain(password);
    live.destroy();
  });

  it('updates the profile name', async () => {
    const user = await fx.createUser('Old Name');
    const updated = await user.patch<SessionBody>('/api/auth/profile', {
      displayName: '  New Name  ',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.user?.displayName).toBe('New Name');
    expect((await user.patch('/api/auth/profile', { displayName: '' })).code).toBe(
      'validation_failed',
    );
  });
});

describe('CSRF and origin rules', () => {
  it('rejects mutations from origins that are not on the allow-list', async () => {
    const evil = await fx.admin.post(
      '/api/documents',
      { title: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(evil.status).toBe(403);
    expect(evil.code).toBe('bad_origin');
    const similar = await fx.admin.post(
      '/api/documents',
      { title: 'x' },
      { origin: `${fx.server.origin}.evil.example` },
    );
    expect(similar.code).toBe('bad_origin');
    const nullOrigin = await fx.admin.post('/api/documents', { title: 'x' }, { origin: 'null' });
    expect(nullOrigin.code).toBe('bad_origin');
  });

  it('rejects cookie-authenticated mutations without an Origin header', async () => {
    const missing = await fx.admin.post('/api/documents', { title: 'x' }, { origin: null });
    expect(missing.status).toBe(403);
    expect(missing.code).toBe('bad_origin');
  });

  it('requires the CSRF header and, for accounts, the per-session token', async () => {
    const countDocuments = async () =>
      Number((await fx.server.sql<{ n: string }>('SELECT count(*) AS n FROM documents'))[0]?.n);
    const before = await countDocuments();
    const none = await fx.admin.post('/api/documents', { title: 'x' }, { csrf: null });
    expect(none.status).toBe(403);
    expect(none.code).toBe('csrf_failed');
    const guess = await fx.admin.post('/api/documents', { title: 'x' }, { csrf: '1' });
    expect(guess.code).toBe('csrf_failed');

    // A token of another session of the same account is not accepted either.
    const other = new Agent(fx.server);
    await other.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(other.csrfToken).not.toBe(fx.admin.csrfToken);
    const swapped = await fx.admin.post(
      '/api/documents',
      { title: 'x' },
      { csrf: other.csrfToken },
    );
    expect(swapped.code).toBe('csrf_failed');

    // None of the rejected requests had any effect.
    expect(await countDocuments()).toBe(before);
    expect((await fx.admin.post('/api/documents', { title: 'allowed' })).status).toBe(201);
    expect(await countDocuments()).toBe(before + 1);
  });

  it('never honours cookies on cross-site requests', async () => {
    // A cross-site page that somehow obtained the token still gets nowhere.
    const crossSitePost = await fx.admin.post(
      '/api/documents',
      { title: 'x' },
      { headers: { 'sec-fetch-site': 'cross-site' } },
    );
    expect(crossSitePost.status).toBe(403);
    expect(crossSitePost.code).toBe('csrf_failed');

    const crossSiteGet = await fx.admin.get('/api/documents', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSiteGet.status).toBe(401);
    const foreignOriginGet = await fx.admin.get('/api/documents', {
      headers: { origin: 'https://evil.example' },
    });
    expect(foreignOriginGet.status).toBe(401);
    // CORS never allows a web origin to read responses with credentials.
    expect(foreignOriginGet.headers.get('access-control-allow-origin')).toBeNull();
    expect(foreignOriginGet.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('applies the same rules to sign-in itself', async () => {
    const agent = new Agent(fx.server);
    const noHeader = await agent.post(
      '/api/auth/login',
      { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      { csrf: null },
    );
    expect(noHeader.code).toBe('csrf_failed');
    const badOrigin = await agent.post(
      '/api/auth/login',
      { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      { origin: 'https://phish.example' },
    );
    expect(badOrigin.code).toBe('bad_origin');
    expect(agent.cookies.size).toBe(0);
  });
});

describe('request handling', () => {
  it('returns structured errors with a request id for every failure', async () => {
    const cases = [
      await fx.admin.get('/api/does-not-exist'),
      await fx.admin.post('/api/documents', undefined, {
        raw: { content: '{"title": ', contentType: 'application/json' },
      }),
      await fx.admin.post('/api/documents', { title: '' }),
      await fx.admin.post('/api/documents', undefined, {
        raw: { content: `{"title":"${'x'.repeat(300_000)}"}`, contentType: 'application/json' },
      }),
      await fx.admin.post('/api/documents', undefined, {
        raw: { content: '<a/>', contentType: 'application/xml' },
      }),
    ];
    expect(cases.map((result) => [result.status, result.code])).toEqual([
      [404, 'not_found'],
      [400, 'validation_failed'],
      [400, 'validation_failed'],
      [413, 'payload_too_large'],
      [415, 'unsupported_media_type'],
    ]);
    for (const result of cases) {
      const error = (result.body as { error: { requestId: string; message: string } }).error;
      expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.headers.get('x-request-id')).toBe(error.requestId);
      expect(error.message).not.toMatch(/stack|at \w+ \(/);
    }
    const issues = (cases[2]?.body as { error: { issues: { path: string }[] } }).error.issues;
    expect(issues[0]?.path).toBe('title');
  });

  it('does not trust a request id supplied by the client', async () => {
    const response = await fx.admin.get('/api/health', {
      headers: { 'x-request-id': 'attacker-chosen' },
    });
    expect(response.headers.get('x-request-id')).not.toBe('attacker-chosen');
  });

  it('sends security headers and serves the web application with a fallback route', async () => {
    const page = await fx.admin.get('/d/00000000-0000-4000-8000-000000000000');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.text).toContain('RealtimeDocs test shell');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const csp = page.headers.get('content-security-policy') ?? '';
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toMatch(/connect-src 'self' ws:\/\/127\.0\.0\.1:4410(;|$)/);
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    // HSTS only when the public origin is HTTPS.
    expect(page.headers.get('strict-transport-security')).toBeNull();

    // Files of the build are served as files: hashed assets immutable, the rest revalidated.
    const asset = await fx.admin.get('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('console.log("app");');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const boot = await fx.admin.get('/boot.js');
    expect(boot.status).toBe(200);
    expect(boot.text).toBe('window.__rdBoot = true;');
    expect(boot.headers.get('content-type')).toMatch(/javascript/);
    expect(boot.headers.get('cache-control')).toBe('no-cache');
    const favicon = await fx.admin.get('/favicon.svg');
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get('content-type')).toBe('image/svg+xml');
    const index = await fx.admin.get('/');
    expect(index.text).toContain('RealtimeDocs test shell');
    expect(index.headers.get('cache-control')).toBe('no-cache');

    // Every other GET outside /api falls back to the app shell (client-side routes) …
    for (const route of [
      '/login',
      '/s/abc',
      '/invite/x',
      '/settings',
      '/admin/users',
      '/some/file.txt',
    ]) {
      const response = await fx.admin.get(route);
      expect([route, response.status, response.headers.get('content-type')]).toEqual([
        route,
        200,
        'text/html; charset=utf-8',
      ]);
      expect(response.headers.get('cache-control')).toBe('no-cache');
    }
    // … except a missing build asset, which is a real 404 and never the shell …
    const missing = await fx.admin.get('/assets/missing-123.js');
    expect([missing.status, missing.code]).toEqual([404, 'not_found']);
    expect(missing.text).not.toContain('test shell');
    // … and the API, which always answers with the JSON error, whatever the method.
    for (const method of ['GET', 'POST', 'DELETE']) {
      const unknown = await fx.admin.request(method, '/api/unknown/route');
      expect([method, unknown.status, unknown.code]).toEqual([method, 404, 'not_found']);
      expect(unknown.headers.get('content-type')).toContain('application/json');
    }
    expect((await fx.admin.get('/api')).code).toBe('not_found');
    expect((await fx.admin.get('/collab')).status).toBe(404);
    expect((await fx.admin.post('/login')).status).toBe(404);
    expect((await fx.admin.get('/../../etc/passwd')).text).not.toContain('root:');
  });

  it('publishes metadata and health without authentication', async () => {
    const anonymous = new Agent(fx.server);
    const meta = await anonymous.get<{
      name: string;
      publicOrigin: string;
      limits: Record<string, number>;
    }>('/api/meta');
    expect(meta.body).toMatchObject({ name: 'RealtimeDocs', publicOrigin: fx.server.origin });
    expect(meta.body.limits.maxCollabMessageBytes).toBe(4 * 1024 * 1024);
    expect((await anonymous.get('/api/health')).body).toMatchObject({ status: 'ok' });
    expect((await anonymous.get('/api/ready')).body).toMatchObject({ status: 'ok' });
    expect((await anonymous.get('/api/users')).status).toBe(401);
    expect((await anonymous.get('/api/audit')).status).toBe(401);
  });
});

describe('invitations', () => {
  it('creates accounts through single-use invitation links and nothing else', async () => {
    const created = await fx.admin.post<{ invitation: { id: string; state: string }; url: string }>(
      '/api/invitations',
      { role: 'member' },
    );
    expect(created.status).toBe(201);
    const url = new URL(created.body.url);
    const id = created.body.invitation.id;
    const secret = url.hash.slice(1);
    expect(url.pathname).toBe(`/invite/${id}`);
    expect(url.search).toBe('');
    // Only the hash of the secret is stored.
    const stored = await fx.server.sql<{ matches: boolean }>(
      `SELECT secret_hash = sha256(convert_to($1, 'UTF8')) AS matches FROM invitations WHERE id = $2`,
      [secret, id],
    );
    expect(stored[0]?.matches).toBe(true);

    const visitor = new Agent(fx.server);
    const lookup = await visitor.post('/api/invitations/lookup', { invitationId: id, secret });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toMatchObject({
      email: null,
      role: 'member',
      workspaceName: 'RealtimeDocs',
    });

    const wrongSecret = await visitor.post('/api/invitations/lookup', {
      invitationId: id,
      secret: `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`,
    });
    const unknownId = await visitor.post('/api/invitations/lookup', {
      invitationId: '00000000-0000-4000-8000-000000000000',
      secret,
    });
    expect([wrongSecret.status, wrongSecret.code]).toEqual([404, 'invite_invalid']);
    expect([unknownId.status, unknownId.code]).toEqual([404, 'invite_invalid']);

    const noEmail = await visitor.post('/api/invitations/accept', {
      invitationId: id,
      secret,
      displayName: 'Ivy Invited',
      password: 'Invited-password-123',
    });
    expect(noEmail.code).toBe('validation_failed');
    const accepted = await visitor.post<SessionBody>('/api/invitations/accept', {
      invitationId: id,
      secret,
      email: 'ivy@example.test',
      displayName: 'Ivy Invited',
      password: 'Invited-password-123',
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.user).toMatchObject({ email: 'ivy@example.test', role: 'member' });
    expect(visitor.cookies.has('rd_session')).toBe(true);

    // Single use.
    const reuse = await new Agent(fx.server).post('/api/invitations/accept', {
      invitationId: id,
      secret,
      email: 'second@example.test',
      displayName: 'Second',
      password: 'Invited-password-123',
    });
    expect(reuse.code).toBe('invite_invalid');

    // An invitation is not a document permission.
    visitor.csrfToken = accepted.body.csrfToken;
    const documents = await visitor.get<{ documents: unknown[] }>('/api/documents');
    expect(documents.body.documents).toEqual([]);
    expect((await visitor.post('/api/documents', { title: 'mine' })).status).toBe(403);
    expect((await visitor.get('/api/invitations')).status).toBe(403);
  });

  it('supports expiry, revocation and email-bound invitations', async () => {
    const bound = await fx.admin.ok(
      fx.admin.post<{ invitation: { id: string }; url: string }>('/api/invitations', {
        email: 'Bound@Example.test',
        role: 'member',
      }),
    );
    const secret = new URL(bound.url).hash.slice(1);
    const visitor = new Agent(fx.server);
    const mismatch = await visitor.post('/api/invitations/accept', {
      invitationId: bound.invitation.id,
      secret,
      email: 'someone.else@example.test',
      displayName: 'Mallory',
      password: 'Invited-password-123',
    });
    expect(mismatch.code).toBe('validation_failed');

    await fx.server.sql(
      "UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [bound.invitation.id],
    );
    const expired = await visitor.post('/api/invitations/lookup', {
      invitationId: bound.invitation.id,
      secret,
    });
    expect([expired.status, expired.code]).toEqual([410, 'invite_expired']);

    const revocable = await fx.admin.ok(
      fx.admin.post<{ invitation: { id: string }; url: string }>('/api/invitations', {}),
    );
    expect((await fx.admin.delete(`/api/invitations/${revocable.invitation.id}`)).status).toBe(204);
    const revoked = await visitor.post('/api/invitations/lookup', {
      invitationId: revocable.invitation.id,
      secret: new URL(revocable.url).hash.slice(1),
    });
    expect(revoked.code).toBe('invite_invalid');

    const list = await fx.admin.get<{ invitations: { id: string; state: string }[] }>(
      '/api/invitations',
    );
    const states = new Map(list.body.invitations.map((item) => [item.id, item.state]));
    expect(states.get(bound.invitation.id)).toBe('expired');
    expect(states.get(revocable.invitation.id)).toBe('revoked');
    expect(JSON.stringify(list.body)).not.toContain(secret);

    const duplicate = await fx.admin.post('/api/invitations', { email: ADMIN_EMAIL });
    expect([duplicate.status, duplicate.code]).toEqual([409, 'conflict']);
  });
});

describe('account administration', () => {
  it('lets administrators change roles and disable accounts, with guard rails', async () => {
    const member = await fx.createUser('Morgan Member');
    expect((await member.get('/api/users')).status).toBe(403);
    expect((await member.patch(`/api/users/${fx.admin.userId}`, { role: 'member' })).status).toBe(
      403,
    );

    const self = await fx.admin.patch(`/api/users/${fx.admin.userId}`, { status: 'disabled' });
    expect([self.status, self.code]).toEqual([409, 'conflict']);
    expect((await fx.admin.patch(`/api/users/${member.userId}`, {})).code).toBe(
      'validation_failed',
    );
    expect(
      (await fx.admin.patch('/api/users/00000000-0000-4000-8000-000000000000', { role: 'admin' }))
        .code,
    ).toBe('not_found');

    const promoted = await fx.admin.patch<{ users: { id: string; role: string }[] }>(
      `/api/users/${member.userId}`,
      { role: 'admin' },
    );
    expect(promoted.body.users.find((user) => user.id === member.userId)?.role).toBe('admin');
    expect((await member.get('/api/users')).status).toBe(200);
    await fx.admin.ok(fx.admin.patch(`/api/users/${member.userId}`, { role: 'member' }));
    expect((await member.get('/api/users')).status).toBe(403);
  });

  it('disabling an account ends its sessions and live connections at once', async () => {
    const editor = await fx.createUser('Eddie Editor');
    const documentId = await fx.createDocument('Disable test');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
    );
    const client = await connectCollab(editor, documentId);
    expect(
      (await editor.get<DocumentBody>(`/api/documents/${documentId}`)).body.document.access.role,
    ).toBe('editor');

    await fx.admin.ok(fx.admin.patch(`/api/users/${editor.userId}`, { status: 'disabled' }));
    const notice = await client.waitFor((message) => message.t === 'access' && message);
    expect(notice).toMatchObject({ t: 'access', change: 'revoked' });
    expect(await client.closed()).toMatchObject({ code: 4403, reason: 'access_revoked' });
    expect((await editor.get(`/api/documents/${documentId}`)).status).toBe(401);
    expect((await editor.post(`/api/documents/${documentId}/collab-ticket`, {})).status).toBe(401);
    client.destroy();
  });

  it('records administrative and security events without secrets or content', async () => {
    const audit = await fx.admin.get<{
      events: { action: string; details: object; actorKind: string }[];
    }>('/api/audit?limit=500');
    expect(audit.status).toBe(200);
    const actions = new Set(audit.body.events.map((event) => event.action));
    for (const expected of [
      'bootstrap.admin_created',
      'auth.login',
      'auth.login_failed',
      'auth.logout',
      'auth.password_changed',
      'auth.password_reset',
      'auth.other_sessions_revoked',
      'invitation.created',
      'invitation.accepted',
      'invitation.revoked',
      'invitation.rejected',
      'user.updated',
      'document.created',
      'member.added',
    ]) {
      expect(actions.has(expected), expected).toBe(true);
    }
    const serialized = JSON.stringify(audit.body);
    for (const secret of [ADMIN_PASSWORD, 'A-brand-new-password-42', 'Invited-password-123']) {
      expect(serialized).not.toContain(secret);
    }
    expect((await fx.admin.get('/api/audit?limit=0')).code).toBe('validation_failed');
    const member = await fx.createUser('Not Admin');
    expect((await member.get('/api/audit')).status).toBe(403);
  });

  it('keeps passwords, tokens and secrets out of the server log', async () => {
    const log = fx.server.log();
    expect(log.length).toBeGreaterThan(1000);
    const session = fx.admin.cookies.get('rd_session')?.value ?? 'missing';
    for (const secret of [
      ADMIN_PASSWORD,
      'A-brand-new-password-42',
      'Invited-password-123',
      session,
      fx.admin.csrfToken ?? 'missing',
      'integration-test-session-secret',
      'rd-integration-only',
    ]) {
      expect(log.includes(secret), `log contains ${secret.slice(0, 6)}…`).toBe(false);
    }
    // Requests are logged with an id, method, path and status, but no bodies.
    expect(log).toMatch(/"method":"POST","url":"\/api\/auth\/login"/);
    expect(log).not.toMatch(/"password"\s*:/);
    expect(log).not.toMatch(/rd_session=/);
  });
});
