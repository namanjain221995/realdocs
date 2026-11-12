/**
 * Service API (`/api/v1`): API keys, interview sessions with role-scoped links,
 * idempotency, live revocation, server-side participant permissions and the
 * isolation of API keys from browser sessions.
 */
import {
  CreateInterviewSessionResponse,
  InterviewSession,
  V1ErrorBody,
  type ServiceScope,
  SERVICE_SCOPES,
} from '@realtimedocs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Agent,
  connectCollab,
  createFixture,
  requestTicket,
  sleep,
  until,
  type Fixture,
} from './harness';

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture('service', { env: { RATE_API_KEY_PER_MINUTE: '100000' } });
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

interface KeyBody {
  key: { id: string; keyPrefix: string; scopes: string[]; state: string };
  secret: string;
}

async function makeKey(
  scopes: readonly ServiceScope[] = SERVICE_SCOPES,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; secret: string; client: Agent }> {
  const created = await fx.admin.ok<KeyBody>(
    fx.admin.post('/api/admin/api-keys', { name: 'test key', scopes, ...extra }),
  );
  return { id: created.key.id, secret: created.secret, client: serviceClient(created.secret) };
}

/** A server-to-server client: no cookies, no Origin, only the key. */
function serviceClient(secret: string): Agent {
  const client = new Agent(fx.server, null);
  client.bearer = secret;
  return client;
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function sessionBody(overrides: Record<string, unknown> = {}) {
  return {
    candidate: { name: 'Aarav Sharma', email: 'aarav@example.com' },
    interviewers: [
      { name: 'Meera Iyer', email: 'meera@acme.example' },
      { name: 'Dev Patel', email: 'dev@acme.example' },
    ],
    companyName: 'Acme Corp',
    round: { number: 2, name: 'System design' },
    scheduledAt: '2030-03-14T15:30:00+05:30',
    timezone: 'Asia/Kolkata',
    expiresAt: inDays(7),
    metadata: { externalInterviewId: 'int_84721' },
    ...overrides,
  };
}

let counter = 0;
/** Unique names keep titles from colliding between tests. */
function uniqueBody(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return sessionBody({
    candidate: { name: `Candidate ${counter}`, email: `candidate${counter}@example.com` },
    ...overrides,
  });
}

async function createSession(
  client: Agent,
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const result = await client.post<CreateInterviewSessionResponse>(
    '/api/v1/interview-sessions',
    uniqueBody(overrides),
    { headers },
  );
  expect(result.status, result.text).toBe(201);
  return result.body;
}

function linkParts(url: string): { grantId: string; secret: string } {
  const parsed = new URL(url);
  return { grantId: parsed.pathname.split('/')[2] ?? '', secret: parsed.hash.slice(1) };
}

async function open(url: string): Promise<Agent> {
  const { grantId, secret } = linkParts(url);
  return fx.guest(grantId, secret);
}

describe('API keys', () => {
  it('are shown once, stored only as a hash, and listed without the secret', async () => {
    const key = await makeKey(['sessions:read']);
    expect(key.secret).toMatch(/^rdk_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const list = await fx.admin.get<{ keys: { id: string; keyPrefix: string }[] }>(
      '/api/admin/api-keys',
    );
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(key.secret);
    expect(list.body.keys.find((k) => k.id === key.id)?.keyPrefix).toBe(key.secret.slice(0, 12));
    const rows = await fx.server.sql<{ secret_hash: Buffer }>(
      'SELECT secret_hash FROM api_keys WHERE id = $1',
      [key.id],
    );
    expect(rows[0]?.secret_hash.toString('utf8')).not.toContain(key.secret);
    expect(rows[0]?.secret_hash).toHaveLength(32);
  });

  it('can only be managed by an administrator with a CSRF token', async () => {
    const member = await fx.createUser('Key Member');
    expect((await member.get('/api/admin/api-keys')).status).toBe(403);
    expect(
      (await member.post('/api/admin/api-keys', { name: 'x', scopes: ['sessions:read'] })).status,
    ).toBe(403);
    const noCsrf = await fx.admin.post(
      '/api/admin/api-keys',
      { name: 'x', scopes: ['sessions:read'] },
      { csrf: null },
    );
    expect(noCsrf.status).toBe(403);
    expect((await new Agent(fx.server).get('/api/admin/api-keys')).status).toBe(401);
  });

  it('validates scopes, expiry and CIDR blocks', async () => {
    const bad = await fx.admin.post<V1ErrorBody>('/api/admin/api-keys', {
      name: 'x',
      scopes: ['sessions:nope'],
    });
    expect(bad.status).toBe(400);
    const past = await fx.admin.post('/api/admin/api-keys', {
      name: 'x',
      scopes: ['sessions:read'],
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(past.status).toBe(400);
    const cidr = await fx.admin.post('/api/admin/api-keys', {
      name: 'x',
      scopes: ['sessions:read'],
      allowedCidrs: ['not-a-cidr'],
    });
    expect(cidr.status).toBe(400);
  });

  it('authenticate, and are rejected when missing, wrong, revoked or expired', async () => {
    const key = await makeKey(['sessions:read']);
    expect((await key.client.get('/api/v1/interview-sessions')).status).toBe(200);

    const none = new Agent(fx.server, null);
    const missing = await none.get<V1ErrorBody>('/api/v1/interview-sessions');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('UNAUTHENTICATED');

    const wrongSecret = serviceClient(
      `${key.secret.slice(0, -1)}${key.secret.endsWith('A') ? 'B' : 'A'}`,
    );
    expect((await wrongSecret.get('/api/v1/interview-sessions')).status).toBe(401);
    expect((await serviceClient('rdk_garbage').get('/api/v1/interview-sessions')).status).toBe(401);

    await fx.server.sql(
      "UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [key.id],
    );
    const expired = await key.client.get<V1ErrorBody>('/api/v1/interview-sessions');
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('UNAUTHENTICATED');

    const second = await makeKey(['sessions:read']);
    expect((await second.client.get('/api/v1/interview-sessions')).status).toBe(200);
    await fx.admin.ok(fx.admin.post(`/api/admin/api-keys/${second.id}/revoke`));
    expect((await second.client.get('/api/v1/interview-sessions')).status).toBe(401);
  });

  it('record failed authentications in the audit log without the secret', async () => {
    const key = await makeKey(['sessions:read']);
    const wrong = `${key.secret.slice(0, -2)}zz`;
    await serviceClient(wrong).get('/api/v1/interview-sessions');
    const events = await fx.server.sql<{ details: Record<string, unknown>; actor_kind: string }>(
      `SELECT details, actor_kind FROM audit_events WHERE action = 'api_key.auth_failed' ORDER BY at DESC LIMIT 5`,
    );
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(JSON.stringify(event.details)).not.toContain(wrong.slice(13));
    }
    expect(events.some((event) => event.details.keyPrefix === key.secret.slice(0, 12))).toBe(true);
  });

  it('enforce scopes', async () => {
    const reader = await makeKey(['sessions:read']);
    const denied = await reader.client.post<V1ErrorBody>(
      '/api/v1/interview-sessions',
      uniqueBody(),
    );
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    expect(denied.body.error.message).toContain('sessions:create');
    const writer = await makeKey(['sessions:create']);
    expect((await writer.client.get('/api/v1/interview-sessions')).status).toBe(403);
    expect((await writer.client.get('/api/v1/webhooks')).status).toBe(403);
  });

  it('honour the CIDR allow-list', async () => {
    const blocked = await makeKey(['sessions:read'], { allowedCidrs: ['203.0.113.0/24'] });
    const denied = await blocked.client.get<V1ErrorBody>('/api/v1/interview-sessions');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    const allowed = await makeKey(['sessions:read'], { allowedCidrs: ['127.0.0.0/8', '::1/128'] });
    expect((await allowed.client.get('/api/v1/interview-sessions')).status).toBe(200);
  });

  it('rotate: the new key works and the old one stops at once', async () => {
    const key = await makeKey(['sessions:read']);
    const rotated = await fx.admin.ok<KeyBody>(
      fx.admin.post(`/api/admin/api-keys/${key.id}/rotate`),
    );
    expect(rotated.secret).not.toBe(key.secret);
    expect(rotated.key.scopes).toEqual(['sessions:read']);
    expect((await key.client.get('/api/v1/interview-sessions')).status).toBe(401);
    expect((await serviceClient(rotated.secret).get('/api/v1/interview-sessions')).status).toBe(
      200,
    );
    expect((await fx.admin.post(`/api/admin/api-keys/${key.id}/rotate`)).status).toBe(409);
  });

  it('write audit events for creation, rotation and revocation', async () => {
    const actions = await fx.server.sql<{ action: string }>(
      `SELECT DISTINCT action FROM audit_events WHERE action LIKE 'api_key.%'`,
    );
    const names = actions.map((row) => row.action);
    expect(names).toEqual(
      expect.arrayContaining(['api_key.created', 'api_key.rotated', 'api_key.revoked']),
    );
  });

  it('never share rights with a browser session or the other way round', async () => {
    const key = await makeKey(['sessions:read']);
    // An API key together with an administrator cookie must not be an administrator.
    const mixed = new Agent(fx.server, null);
    mixed.cookies.set(
      'rd_session',
      [...fx.admin.cookies.values()][0] ?? {
        value: '',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    );
    mixed.csrfToken = fx.admin.csrfToken;
    mixed.bearer = key.secret;
    expect([...mixed.cookies.keys()]).toContain('rd_session');
    for (const path of [
      '/api/admin/api-keys',
      '/api/admin/interview-sessions',
      '/api/documents',
      '/api/audit',
      '/api/users',
    ]) {
      const result = await mixed.get(path);
      expect(result.status, path).toBe(401);
    }
    const create = await mixed.post('/api/admin/api-keys', {
      name: 'x',
      scopes: ['sessions:read'],
    });
    expect(create.status).toBe(401);
    // The key does not work outside /api/v1, with or without cookies.
    expect((await key.client.get('/api/documents')).status).toBe(401);
    expect((await key.client.get('/api/auth/session')).body).toMatchObject({ user: null });
    // And an administrator cookie alone is not a service credential.
    const cookieOnly = await fx.admin.get<V1ErrorBody>('/api/v1/interview-sessions');
    expect(cookieOnly.status).toBe(401);
    expect(cookieOnly.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('are rate limited per key', async () => {
    const limited = await createFixture('service-limit', {
      port: 4411,
      env: { RATE_API_KEY_PER_MINUTE: '3' },
    });
    try {
      const created = await limited.admin.ok<KeyBody>(
        limited.admin.post('/api/admin/api-keys', { name: 'k', scopes: ['sessions:read'] }),
      );
      const client = new Agent(limited.server, null);
      client.bearer = created.secret;
      const statuses: number[] = [];
      let last = await client.get<V1ErrorBody>('/api/v1/interview-sessions');
      statuses.push(last.status);
      for (let i = 0; i < 4; i += 1) {
        last = await client.get<V1ErrorBody>('/api/v1/interview-sessions');
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
      expect(last.status).toBe(429);
      expect(last.body.error.code).toBe('RATE_LIMITED');
      expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await limited.server.dispose();
    }
  });
});

describe('error model', () => {
  it('uses the v1 envelope with a request id and field details', async () => {
    const { client } = await makeKey();
    const bad = await client.post<V1ErrorBody>('/api/v1/interview-sessions', {
      ...uniqueBody(),
      candidate: { name: 'X', email: 'nope' },
      timezone: 'Mars/Base',
    });
    expect(bad.status).toBe(400);
    const parsed = V1ErrorBody.parse(bad.body);
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.requestId).toMatch(/^req_[0-9a-f]{24}$/);
    expect(bad.headers.get('x-request-id')).toBe(parsed.error.requestId);
    const paths = (parsed.error.details ?? []).map((detail) => detail.path);
    expect(paths).toEqual(expect.arrayContaining(['candidate.email', 'timezone']));
    expect(bad.text).not.toMatch(/stack|at .*\.ts:\d+/i);
  });

  it('echoes a well-formed X-Request-Id and replaces a malformed one', async () => {
    const { client } = await makeKey();
    const good = await client.get('/api/v1/interview-sessions', {
      headers: { 'x-request-id': 'trace-12345678' },
    });
    expect(good.headers.get('x-request-id')).toBe('trace-12345678');
    const bad = await client.get('/api/v1/interview-sessions', {
      headers: { 'x-request-id': 'no good!' },
    });
    expect(bad.headers.get('x-request-id')).toMatch(/^req_/);
    const missing = await client.get<V1ErrorBody>('/api/v1/interview-sessions/not-a-uuid', {
      headers: { 'x-request-id': 'trace-87654321' },
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 'NOT_FOUND', requestId: 'trace-87654321' });
    expect((await client.get<V1ErrorBody>('/api/v1/nope')).body.error.code).toBe('NOT_FOUND');
  });

  it('keeps the old envelope for the other API routes', async () => {
    const result = await new Agent(fx.server).get<{ error: { code: string } }>('/api/documents');
    expect(result.body.error.code).toBe('unauthenticated');
  });
});

describe('creating a session', () => {
  it('creates one document, a grant per participant and stores both e-mail addresses', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    CreateInterviewSessionResponse.parse(created);
    expect(created.status).toBe('scheduled');
    expect(created.participants).toHaveLength(3);
    expect(created.adminUrl).toBe(`/admin/interview-sessions/${created.sessionId}`);

    const grants = await fx.server.sql<{ role: string; participant_id: string }>(
      'SELECT role, participant_id FROM share_grants WHERE document_id = $1',
      [created.documentId],
    );
    expect(grants).toHaveLength(3);
    expect(grants.every((grant) => grant.participant_id)).toBe(true);
    const docs = await fx.server.sql('SELECT id FROM documents WHERE id = $1', [
      created.documentId,
    ]);
    expect(docs).toHaveLength(1);
    const people = await fx.server.sql<{ role: string; email: string }>(
      'SELECT role, email::text FROM interview_participants WHERE session_id = $1 ORDER BY created_at',
      [created.sessionId],
    );
    expect(people.map((p) => p.email).sort()).toEqual(
      expect.arrayContaining(['dev@acme.example', 'meera@acme.example']),
    );
    expect(people.find((p) => p.role === 'candidate')?.email).toMatch(
      /^candidate\d+@example\.com$/,
    );

    // The secrets are only in the fragments; no secret is stored.
    const url = new URL(created.candidateAccess.url);
    expect(url.origin).toBe(fx.server.origin);
    expect(url.pathname).toMatch(/^\/s\/[0-9a-f-]{36}$/);
    const hashes = await fx.server.sql<{ secret_hash: Buffer }>(
      'SELECT secret_hash FROM share_grants WHERE document_id = $1',
      [created.documentId],
    );
    expect(hashes.map((h) => h.secret_hash.length)).toEqual([32, 32, 32]);
    expect(created.interviewerAccess.url).toBe(created.participants[1]?.access.url);
  });

  it('names the document {Candidate}_{Company}_Round_{N}_{date} in the session time zone', async () => {
    const { client } = await makeKey();
    const created = await createSession(client, {
      candidate: { name: 'Aarav  Sharma', email: 'aarav.title@example.com' },
      companyName: 'Acme/Corp: "Labs"',
      round: { number: 3 },
      scheduledAt: '2030-03-14T15:30:00+05:30',
      timezone: 'America/New_York',
    });
    // 10:00 UTC on 14 March 2030 is 06:00 in New York (daylight time).
    expect(created.title).toMatch(
      /^Aarav_Sharma_Acme_Corp_Labs_Round_3_2030-03-14_06-00(_[A-Z2-7]{4})?$/,
    );
    const doc = await fx.admin.ok<{ document: { title: string } }>(
      fx.admin.get(`/api/documents/${created.documentId}`),
    );
    expect(doc.document.title).toBe(created.title);
  });

  it('adds a four character suffix when the title is taken', async () => {
    const { client } = await makeKey();
    const same = {
      candidate: { name: 'Same Person', email: 'same@example.com' },
      companyName: 'Same Co',
    };
    const first = await client.post<CreateInterviewSessionResponse>(
      '/api/v1/interview-sessions',
      sessionBody(same),
    );
    const second = await client.post<CreateInterviewSessionResponse>(
      '/api/v1/interview-sessions',
      sessionBody(same),
    );
    expect(first.body.title).toBe('Same_Person_Same_Co_Round_2_2030-03-14_15-30');
    expect(second.body.title).toMatch(/^Same_Person_Same_Co_Round_2_2030-03-14_15-30_[A-Z2-7]{4}$/);
    const generated = await fx.server.sql<{ generated_title: string }>(
      'SELECT generated_title FROM interview_sessions WHERE id = $1',
      [second.body.sessionId],
    );
    expect(generated[0]?.generated_title).toBe(second.body.title);
  });

  it('lets the candidate and the interviewer edit the same room and see each other with a role label', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const candidate = await open(created.candidateAccess.url);
    const interviewer = await open(created.interviewerAccess.url);

    const candidateClient = await connectCollab(candidate, created.documentId, { awareness: true });
    const interviewerClient = await connectCollab(interviewer, created.documentId, {
      awareness: true,
    });
    expect(candidateClient.authenticatedScope).toBe('read-write');

    candidateClient.appendParagraph('written by the candidate');
    await candidateClient.save();
    await until(() => interviewerClient.text().includes('written by the candidate'), {
      what: 'candidate edit to reach interviewer',
    });
    interviewerClient.appendParagraph('written by the interviewer');
    await interviewerClient.save();
    await until(() => candidateClient.text().includes('written by the interviewer'), {
      what: 'interviewer edit to reach candidate',
    });

    // Presence names come from the participant record, with the role label.
    interviewerClient.awareness?.setLocalState({
      user: { name: 'Impostor', roleLabel: 'Admin' },
      cursor: null,
    });
    const seen = await until(
      () => {
        const users = [...(candidateClient.awareness?.getStates().values() ?? [])]
          .map((state) => state.user as { name?: string; roleLabel?: string } | undefined)
          .filter((user) => user?.name);
        return users.find((user) => user?.name === 'Meera Iyer');
      },
      { what: 'interviewer presence' },
    );
    expect(seen).toMatchObject({ name: 'Meera Iyer', roleLabel: 'Interviewer' });
    await sleep(400);
    const names = [...(candidateClient.awareness?.getStates().values() ?? [])].map(
      (state) => (state.user as { name?: string } | undefined)?.name,
    );
    expect(names).not.toContain('Impostor');

    const people = await fx.server.sql<{
      role: string;
      first_joined_at: Date | null;
      last_joined_at: Date | null;
    }>(
      'SELECT role, first_joined_at, last_joined_at FROM interview_participants WHERE session_id = $1',
      [created.sessionId],
    );
    expect(
      people
        .filter((p) => p.first_joined_at && p.last_joined_at)
        .map((p) => p.role)
        .sort(),
    ).toEqual(['candidate', 'interviewer']);
    candidateClient.destroy();
    interviewerClient.destroy();
  });

  it('records the first edit once and attributes history to the participant roles', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const firstEditedAt = async () =>
      (
        await fx.server.sql<{ at: Date | null }>(
          'SELECT first_edited_at AS at FROM interview_sessions WHERE id = $1',
          [created.sessionId],
        )
      )[0]?.at ?? null;
    expect(await firstEditedAt()).toBeNull();

    const candidate = await open(created.candidateAccess.url);
    const interviewer = await open(created.interviewerAccess.url);
    const candidateClient = await connectCollab(candidate, created.documentId);
    candidateClient.appendParagraph('answer from the candidate');
    await candidateClient.save();
    const first = await until(firstEditedAt);
    const interviewerClient = await connectCollab(interviewer, created.documentId);
    interviewerClient.appendParagraph('note from the interviewer');
    await interviewerClient.save();
    candidateClient.destroy();
    interviewerClient.destroy();

    // A later edit, after the document was unloaded and loaded again, does not move it.
    await sleep(300);
    const again = await connectCollab(interviewer, created.documentId);
    again.appendParagraph('second note');
    await again.save();
    again.destroy();
    await sleep(200);
    expect((await firstEditedAt())?.getTime()).toBe(first.getTime());

    // Who typed what: the server's record names the role of each participant.
    const rows = await fx.server.sql<{ role: string; kind: string; op: string }>(
      `SELECT participant_role AS role, actor_kind AS kind, operation_type AS op
         FROM doc_history WHERE document_id = $1 AND kind = 'update' ORDER BY hseq`,
      [created.documentId],
    );
    expect(rows.map((row) => row.role)).toEqual(['candidate', 'interviewer', 'interviewer']);
    expect(rows.every((row) => row.kind === 'guest' && row.op === 'text_inserted')).toBe(true);
  });

  it('is idempotent: same key and body replay the first response, another body conflicts', async () => {
    const { client } = await makeKey();
    const body = uniqueBody();
    const headers = { 'idempotency-key': 'order-1234' };
    const first = await client.post<CreateInterviewSessionResponse>(
      '/api/v1/interview-sessions',
      body,
      { headers },
    );
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotency-replayed')).toBeNull();

    // Key order in the body does not matter.
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    const replay = await client.post<CreateInterviewSessionResponse>(
      '/api/v1/interview-sessions',
      reordered,
      { headers },
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(replay.body).toEqual(first.body);

    const conflict = await client.post<V1ErrorBody>(
      '/api/v1/interview-sessions',
      { ...body, companyName: 'Other Co' },
      { headers },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const documents = await fx.server.sql(
      "SELECT id FROM interview_sessions WHERE metadata ->> 'externalInterviewId' = $1 AND id = $2",
      ['int_84721', first.body.sessionId],
    );
    expect(documents).toHaveLength(1);
    // The stored response (it contains links) is encrypted at rest.
    const stored = await fx.server.sql<{ response: unknown }>(
      `SELECT response FROM idempotency_keys WHERE key = 'order-1234'`,
    );
    expect(JSON.stringify(stored[0]?.response)).not.toContain('/s/');

    // Another key creates another session; a bad key is a validation error.
    const other = await client.post<CreateInterviewSessionResponse>(
      '/api/v1/interview-sessions',
      body,
      {
        headers: { 'idempotency-key': 'order-5678' },
      },
    );
    expect(other.body.sessionId).not.toBe(first.body.sessionId);
    const bad = await client.post<V1ErrorBody>('/api/v1/interview-sessions', body, {
      headers: { 'idempotency-key': 'has space' },
    });
    expect(bad.status).toBe(400);
  });

  it('creates exactly one session for concurrent requests with the same key', async () => {
    const { client } = await makeKey();
    const body = uniqueBody();
    const headers = { 'idempotency-key': 'parallel-1' };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        client.post<CreateInterviewSessionResponse>('/api/v1/interview-sessions', body, {
          headers,
        }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.sessionId)).size).toBe(1);
    expect(results.filter((r) => r.headers.get('idempotency-replayed') === 'true')).toHaveLength(3);
  });

  it('does not keep a failed attempt: the key can be reused after a validation error', async () => {
    const { client } = await makeKey();
    const headers = { 'idempotency-key': 'retry-after-error' };
    const invalid = await client.post(
      '/api/v1/interview-sessions',
      { ...uniqueBody(), interviewers: [] },
      { headers },
    );
    expect(invalid.status).toBe(400);
    const valid = await client.post('/api/v1/interview-sessions', uniqueBody(), { headers });
    expect(valid.status).toBe(201);
  });
});

describe('participant permissions are enforced by the server', () => {
  it('forbids export and the desktop handoff for a candidate, allows them for an interviewer', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const candidate = await open(created.candidateAccess.url);
    const interviewer = await open(created.interviewerAccess.url);

    for (const format of ['txt', 'md', 'json', 'md-zip']) {
      const denied = await candidate.get(
        `/api/documents/${created.documentId}/export?format=${format}`,
      );
      expect(denied.status, format).toBe(403);
    }
    const handoff = await candidate.post(
      `/api/documents/${created.documentId}/desktop-handoff`,
      {},
    );
    expect(handoff.status).toBe(403);
    expect(
      (await interviewer.get(`/api/documents/${created.documentId}/export?format=txt`)).status,
    ).toBe(200);
    expect(
      (await interviewer.post(`/api/documents/${created.documentId}/desktop-handoff`, {})).status,
    ).toBe(201);

    // The access payload tells the web app what to hide.
    const asCandidate = await candidate.get<{
      document: {
        access: { participant: { role: string }; capabilities: Record<string, boolean> };
      };
    }>(`/api/documents/${created.documentId}`);
    expect(asCandidate.body.document.access.participant.role).toBe('candidate');
    expect(asCandidate.body.document.access.capabilities).toEqual({
      canExport: false,
      canViewHistory: false,
      canShare: false,
      canUseDesktop: false,
    });
    const asInterviewer = await interviewer.get<{
      document: { access: { capabilities: Record<string, boolean> } };
    }>(`/api/documents/${created.documentId}`);
    expect(asInterviewer.body.document.access.capabilities.canExport).toBe(true);
    expect(asInterviewer.body.document.access.capabilities.canUseDesktop).toBe(true);

    // A desktop session cannot be obtained with a candidate link either.
    const { grantId, secret } = linkParts(created.candidateAccess.url);
    const bearer = await new Agent(fx.server, null).post('/api/share/exchange', {
      grantId,
      secret,
      mode: 'bearer',
    });
    expect(bearer.status).toBe(403);
    // Candidates cannot create share links or read the snapshot list.
    expect((await candidate.post(`/api/documents/${created.documentId}/shares`, {})).status).toBe(
      403,
    );
    expect((await candidate.get(`/api/documents/${created.documentId}/snapshots`)).status).toBe(
      403,
    );
  });

  it('allows a candidate to export when the session says so', async () => {
    const { client } = await makeKey();
    const created = await createSession(client, { permissions: { candidateCanExport: true } });
    const candidate = await open(created.candidateAccess.url);
    expect(
      (await candidate.get(`/api/documents/${created.documentId}/export?format=txt`)).status,
    ).toBe(200);
    const doc = await candidate.get<{
      document: { access: { capabilities: { canExport: boolean; canUseDesktop: boolean } } };
    }>(`/api/documents/${created.documentId}`);
    expect(doc.body.document.access.capabilities).toMatchObject({
      canExport: true,
      canUseDesktop: false,
    });
  });

  it('makes a candidate a viewer when candidateCanEdit is false, and follows later changes live', async () => {
    const { client } = await makeKey();
    const created = await createSession(client, { permissions: { candidateCanEdit: false } });
    const candidate = await open(created.candidateAccess.url);
    const ticket = await requestTicket(candidate, created.documentId, 4242);
    expect(ticket.body.role).toBe('viewer');

    const interviewer = await open(created.interviewerAccess.url);
    expect((await requestTicket(interviewer, created.documentId, 4243)).body.role).toBe('editor');

    // Switching it on reaches the open connection.
    const connected = await connectCollab(candidate, created.documentId);
    expect(connected.authenticatedScope).toBe('readonly');
    const patched = await client.patch(`/api/v1/interview-sessions/${created.sessionId}`, {
      permissions: { candidateCanEdit: true },
    });
    expect(patched.status, patched.text).toBe(200);
    await connected.waitFor(
      (message) => message.t === 'access' && message.change === 'role_changed',
      {
        what: 'role change',
      },
    );
    expect((await requestTicket(candidate, created.documentId, 4244)).body.role).toBe('editor');
    connected.destroy();
  });
});

describe('links: revocation, rotation, removal and expiry', () => {
  it('rotating links disconnects open sockets and the old link stops working', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const candidate = await open(created.candidateAccess.url);
    const connected = await connectCollab(candidate, created.documentId);
    const oldCandidate = linkParts(created.candidateAccess.url);

    const rotated = await client.post<{
      participants: { participantId: string; role: string; access: { url: string } }[];
    }>(`/api/v1/interview-sessions/${created.sessionId}/rotate-links`, {
      participantIds: [created.participants[0]?.participantId],
    });
    expect(rotated.status, rotated.text).toBe(200);
    expect(rotated.body.participants).toHaveLength(1);
    const closed = await connected.closed();
    expect([4403, 4401, 4410]).toContain(closed.code);

    const old = await new Agent(fx.server).post('/api/share/exchange', oldCandidate);
    expect(old.status).toBe(410);
    expect(old.code).toBe('share_revoked');
    const fresh = await open(rotated.body.participants[0]?.access.url ?? '');
    expect((await requestTicket(fresh, created.documentId, 1)).status).toBe(200);
    // The interviewer's link was not part of the rotation.
    const interviewer = await open(created.interviewerAccess.url);
    expect((await requestTicket(interviewer, created.documentId, 2)).status).toBe(200);

    // Rotating everyone returns a link per active participant.
    const all = await client.post<{ participants: unknown[] }>(
      `/api/v1/interview-sessions/${created.sessionId}/rotate-links`,
      {},
    );
    expect(all.body.participants).toHaveLength(3);
    expect((await requestTicket(interviewer, created.documentId, 3)).status).toBe(410);
  });

  it('removing a participant revokes the link and disconnects them', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const second = created.participants[2];
    const agent = await open(second?.access.url ?? '');
    const connected = await connectCollab(agent, created.documentId);
    const removed = await client.delete<InterviewSession>(
      `/api/v1/interview-sessions/${created.sessionId}/participants/${second?.participantId}`,
    );
    expect(removed.status, removed.text).toBe(200);
    expect(
      removed.body.participants.find((p) => p.participantId === second?.participantId)?.removedAt,
    ).not.toBeNull();
    await connected.closed();
    const again = await new Agent(fx.server).post(
      '/api/share/exchange',
      linkParts(second?.access.url ?? ''),
    );
    expect(again.status).toBe(410);
    expect(
      (
        await client.delete(
          `/api/v1/interview-sessions/${created.sessionId}/participants/${second?.participantId}`,
        )
      ).status,
    ).toBe(409);
  });

  it('adds an interviewer with their own link', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const added = await client.post<{
      participant: { access: { url: string }; participantId: string };
    }>(`/api/v1/interview-sessions/${created.sessionId}/participants`, {
      name: 'Late Joiner',
      email: 'late@acme.example',
    });
    expect(added.status, added.text).toBe(201);
    const agent = await open(added.body.participant.access.url);
    const connected = await connectCollab(agent, created.documentId, { awareness: true });
    expect(connected.ticket.participant).toMatchObject({
      name: 'Late Joiner',
      roleLabel: 'Interviewer',
    });
    connected.destroy();
  });

  it('moves the expiry of every link with the session and refuses past or distant dates', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const later = inDays(30);
    const patched = await client.patch<InterviewSession>(
      `/api/v1/interview-sessions/${created.sessionId}`,
      {
        expiresAt: later,
      },
    );
    expect(patched.status, patched.text).toBe(200);
    const grants = await fx.server.sql<{ expires_at: Date }>(
      'SELECT expires_at FROM share_grants WHERE document_id = $1 AND revoked_at IS NULL',
      [created.documentId],
    );
    expect(grants).toHaveLength(3);
    for (const grant of grants)
      expect(grant.expires_at.toISOString()).toBe(new Date(later).toISOString());
    expect(
      (
        await client.patch(`/api/v1/interview-sessions/${created.sessionId}`, {
          expiresAt: inDays(120),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.patch(`/api/v1/interview-sessions/${created.sessionId}`, {
          expiresAt: inDays(-1),
        })
      ).status,
    ).toBe(400);
    expect((await client.patch(`/api/v1/interview-sessions/${created.sessionId}`, {})).status).toBe(
      400,
    );
  });
});

describe('lifecycle', () => {
  it('follows the state machine and refuses everything else', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const base = `/api/v1/interview-sessions/${created.sessionId}`;
    expect((await client.post(`${base}/complete`)).status).toBe(409);
    const started = await client.post<InterviewSession>(`${base}/start`);
    expect(started.status, started.text).toBe(200);
    expect(started.body.status).toBe('in_progress');
    expect(started.body.startedAt).not.toBeNull();
    expect((await client.post(`${base}/start`)).status).toBe(409);
    const completed = await client.post<InterviewSession>(`${base}/complete`);
    expect(completed.body.status).toBe('completed');
    expect((await client.post(`${base}/cancel`)).status).toBe(409);
    expect((await client.patch(base, { companyName: 'Late' })).status).toBe(409);
    expect((await client.post(`${base}/rotate-links`, {})).status).toBe(409);
    const archived = await client.delete<InterviewSession>(base);
    expect(archived.body.status).toBe('archived');
    expect((await client.delete(base)).status).toBe(409);
    expect((await client.get(base)).status).toBe(200);
  });

  it('completing closes the candidate out and leaves interviewers read-only', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const base = `/api/v1/interview-sessions/${created.sessionId}`;
    const candidate = await open(created.candidateAccess.url);
    const interviewer = await open(created.interviewerAccess.url);
    const candidateSocket = await connectCollab(candidate, created.documentId);
    const interviewerSocket = await connectCollab(interviewer, created.documentId);
    await client.post(`${base}/start`);
    await client.post(`${base}/complete`);

    await candidateSocket.closed();
    const blocked = await candidate.get(`/api/documents/${created.documentId}`);
    expect(blocked.status).toBe(410);
    expect(blocked.code).toBe('session_closed');
    expect(
      (await candidate.get(`/api/documents/${created.documentId}/export?format=txt`)).code,
    ).toBe('session_closed');
    const exchange = await new Agent(fx.server).post(
      '/api/share/exchange',
      linkParts(created.candidateAccess.url),
    );
    expect(exchange.status).toBe(410);
    expect(exchange.code).toBe('session_closed');

    await interviewerSocket.waitFor(
      (message) => message.t === 'access' && message.change === 'role_changed',
      {
        what: 'interviewer downgrade',
      },
    );
    const still = await interviewer.get<{ document: { access: { role: string } } }>(
      `/api/documents/${created.documentId}`,
    );
    expect(still.status).toBe(200);
    expect(still.body.document.access.role).toBe('viewer');
    // A fresh exchange of the interviewer's link still works (until expiry) and is read-only.
    const again = await open(created.interviewerAccess.url);
    expect((await requestTicket(again, created.documentId, 9)).body.role).toBe('viewer');
    interviewerSocket.destroy();
  });

  it('cancelling closes the candidate out the same way, and archiving revokes everything', async () => {
    const { client } = await makeKey();
    const cancelled = await createSession(client);
    await client.post(`/api/v1/interview-sessions/${cancelled.sessionId}/cancel`);
    const exchange = await new Agent(fx.server).post(
      '/api/share/exchange',
      linkParts(cancelled.candidateAccess.url),
    );
    expect(exchange.code).toBe('session_closed');

    const archived = await createSession(client);
    const interviewer = await open(archived.interviewerAccess.url);
    const response = await client.delete<InterviewSession>(
      `/api/v1/interview-sessions/${archived.sessionId}`,
    );
    expect(response.status).toBe(200);
    expect((await interviewer.get(`/api/documents/${archived.documentId}`)).status).toBe(410);
    const doc = await fx.admin.ok<{ document: { status: string } }>(
      fx.admin.get(`/api/documents/${archived.documentId}`),
    );
    expect(doc.document.status).toBe('archived');
    const grants = await fx.server.sql<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM share_grants WHERE document_id = $1',
      [archived.documentId],
    );
    expect(grants.every((grant) => grant.revoked_at)).toBe(true);
  });
});

describe('reading', () => {
  it('lists with filters and cursor pagination', async () => {
    const { client } = await makeKey();
    const marker = `Zeta${Date.now()}`;
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      made.push(
        await createSession(client, {
          candidate: {
            name: `${marker} Person ${i}`,
            email: `${marker.toLowerCase()}.${i}@example.com`,
          },
          companyName: `${marker} Labs`,
          round: { number: i + 1 },
        }),
      );
    }
    await client.post(`/api/v1/interview-sessions/${made[0]?.sessionId}/cancel`);

    const first = await client.get<{ items: InterviewSession[]; nextCursor: string | null }>(
      `/api/v1/interview-sessions?company=${marker}&limit=2`,
    );
    expect(first.status, first.text).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await client.get<{ items: InterviewSession[]; nextCursor: string | null }>(
      `/api/v1/interview-sessions?company=${marker}&limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.items, ...second.body.items].map((item) => item.sessionId);
    expect(new Set(ids).size).toBe(3);
    // Newest first.
    expect(ids[0]).toBe(made[2]?.sessionId);

    const byStatus = await client.get<{ items: InterviewSession[] }>(
      `/api/v1/interview-sessions?company=${marker}&status=cancelled`,
    );
    expect(byStatus.body.items.map((i) => i.sessionId)).toEqual([made[0]?.sessionId]);
    const byRound = await client.get<{ items: InterviewSession[] }>(
      `/api/v1/interview-sessions?company=${marker}&round=2`,
    );
    expect(byRound.body.items).toHaveLength(1);
    const byCandidate = await client.get<{ items: InterviewSession[] }>(
      `/api/v1/interview-sessions?candidateEmail=${marker.toLowerCase()}.1@`,
    );
    expect(byCandidate.body.items.map((i) => i.sessionId)).toEqual([made[1]?.sessionId]);
    const byInterviewer = await client.get<{ items: InterviewSession[] }>(
      `/api/v1/interview-sessions?company=${marker}&interviewerEmail=meera@acme.example`,
    );
    expect(byInterviewer.body.items).toHaveLength(3);
    const byTitle = await client.get<{ items: InterviewSession[] }>(
      `/api/v1/interview-sessions?q=${marker}_Person_2`,
    );
    expect(byTitle.body.items.map((i) => i.sessionId)).toEqual([made[2]?.sessionId]);
    const byDate = await client.get<{ items: InterviewSession[] }>(
      `/api/v1/interview-sessions?company=${marker}&from=2031-01-01T00:00:00Z`,
    );
    expect(byDate.body.items).toHaveLength(0);
    expect((await client.get('/api/v1/interview-sessions?limit=101')).status).toBe(400);
    expect((await client.get('/api/v1/interview-sessions?cursor=garbage')).status).toBe(400);
  });

  it('returns a session, its document content and its audit trail', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const candidate = await open(created.candidateAccess.url);
    const room = await connectCollab(candidate, created.documentId);
    room.appendParagraph('Design a rate limiter');
    await room.save();

    const session = await client.get<InterviewSession>(
      `/api/v1/interview-sessions/${created.sessionId}`,
    );
    expect(session.status).toBe(200);
    InterviewSession.parse(session.body);
    expect(session.body.metadata).toEqual({ externalInterviewId: 'int_84721' });
    expect(session.body.participants.map((p) => p.role)).toEqual([
      'candidate',
      'interviewer',
      'interviewer',
    ]);
    expect(session.body.participants[0]?.liveConnections).toBe(1);
    expect(session.text).not.toContain('#');

    const doc = await client.get<{ content: { type: string }; documentId: string }>(
      `/api/v1/interview-sessions/${created.sessionId}/document`,
    );
    expect(doc.status).toBe(200);
    expect(doc.body.documentId).toBe(created.documentId);
    expect(JSON.stringify(doc.body.content)).toContain('Design a rate limiter');

    const audit = await client.get<{ items: { action: string; actorKind: string }[] }>(
      `/api/v1/interview-sessions/${created.sessionId}/audit`,
    );
    expect(audit.status).toBe(200);
    expect(audit.body.items.map((e) => e.action)).toContain('interview_session.created');
    expect(audit.body.items.find((e) => e.action === 'interview_session.created')?.actorKind).toBe(
      'service',
    );

    // Scopes: documents:read and documents:history:read are separate.
    const readOnly = await makeKey(['sessions:read']);
    expect(
      (await readOnly.client.get(`/api/v1/interview-sessions/${created.sessionId}/document`))
        .status,
    ).toBe(403);
    expect(
      (await readOnly.client.get(`/api/v1/interview-sessions/${created.sessionId}/audit`)).status,
    ).toBe(403);
    expect((await client.get(`/api/v1/interview-sessions/${crypto.randomUUID()}`)).status).toBe(
      404,
    );
    room.destroy();
  });
});

describe('admin interface', () => {
  it('serves the same operations to a signed-in administrator and audits reads', async () => {
    const { client } = await makeKey();
    const created = await createSession(client);
    const list = await fx.admin.get<{ items: { sessionId: string }[] }>(
      '/api/admin/interview-sessions?limit=100',
    );
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.some((item) => item.sessionId === created.sessionId)).toBe(true);

    const before = await fx.server.sql<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events WHERE action = 'admin.session_viewed' AND target_id = $1`,
      [created.sessionId],
    );
    expect((await fx.admin.get(`/api/admin/interview-sessions/${created.sessionId}`)).status).toBe(
      200,
    );
    expect(
      (await fx.admin.get(`/api/admin/interview-sessions/${created.sessionId}/document`)).status,
    ).toBe(200);
    expect(
      (await fx.admin.get(`/api/admin/interview-sessions/${created.sessionId}/audit`)).status,
    ).toBe(200);
    const after = await fx.server.sql<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events WHERE action = 'admin.session_viewed' AND target_id = $1`,
      [created.sessionId],
    );
    expect((after[0]?.count ?? 0) - (before[0]?.count ?? 0)).toBe(3);

    const rotated = await fx.admin.post(
      `/api/admin/interview-sessions/${created.sessionId}/rotate-links`,
      {},
    );
    expect(rotated.status, rotated.text).toBe(200);
    const events = await fx.server.sql<{ actor_kind: string }>(
      `SELECT actor_kind FROM audit_events WHERE action = 'interview_session.links_rotated' AND target_id = $1`,
      [created.sessionId],
    );
    expect(events[0]?.actor_kind).toBe('user');

    const member = await fx.createUser('Session Member');
    expect((await member.get('/api/admin/interview-sessions')).status).toBe(403);
    expect(
      (await fx.admin.post('/api/admin/interview-sessions', uniqueBody(), { csrf: null })).status,
    ).toBe(403);
    const viaAdmin = await fx.admin.post<CreateInterviewSessionResponse>(
      '/api/admin/interview-sessions',
      uniqueBody(),
    );
    expect(viaAdmin.status, viaAdmin.text).toBe(201);
  });
});

describe('OpenAPI and the portal routes', () => {
  it('serves the OpenAPI document publicly and cacheably', async () => {
    const result = await new Agent(fx.server).get<{
      openapi: string;
      paths: Record<string, unknown>;
    }>('/api/openapi.json');
    expect(result.status).toBe(200);
    expect(result.body.openapi).toBe('3.1.0');
    expect(Object.keys(result.body.paths)).toContain('/api/v1/interview-sessions');
    expect(result.headers.get('cache-control')).toContain('max-age');
    expect(result.headers.get('cache-control')).not.toContain('no-store');
  });

  it('serves the single-page shell for /docs, /guides and the admin pages', async () => {
    const anonymous = new Agent(fx.server);
    for (const path of [
      '/docs',
      '/docs/api',
      '/guides/security',
      '/admin/api-keys',
      '/admin/interview-sessions',
      '/admin/webhooks',
    ]) {
      const page = await anonymous.get(path);
      expect(page.status, path).toBe(200);
      expect(page.text).toContain('RealtimeDocs test shell');
    }
  });
});
