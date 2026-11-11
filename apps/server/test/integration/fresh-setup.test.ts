/**
 * Acceptance test 18 (server side): from an empty database to the first
 * working document, using only the documented commands and the public API.
 */
import { isCapabilitySecret, parseCollabDocumentName } from '@realtimedocs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  Agent,
  TestServer,
  connectCollab,
  type DocumentBody,
  type SessionBody,
} from './harness';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.create('fresh');
});

afterAll(async () => {
  await server.dispose();
});

describe('fresh setup', () => {
  it('migrates an empty database', async () => {
    const before = await server.sql<{ present: boolean }>(
      "SELECT to_regclass('public.documents') IS NOT NULL AS present",
    );
    expect(before[0]?.present).toBe(false);

    const first = await server.cli(['migrate']);
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain('0001_init');
    const second = await server.cli(['migrate']);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('up to date');

    const tables = await server.sql<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'workspaces',
        'users',
        'sessions',
        'invitations',
        'documents',
        'document_members',
        'share_grants',
        'doc_states',
        'doc_updates',
        'snapshots',
        'assets',
        'desktop_handoffs',
        'audit_events',
        'schema_migrations',
      ]),
    );
    expect(await server.sql('SELECT 1 FROM workspaces')).toHaveLength(1);
    expect(await server.sql('SELECT 1 FROM users')).toHaveLength(0);
  });

  it('has no default credentials', async () => {
    await server.start();
    const agent = new Agent(server);
    for (const [email, password] of [
      ['admin@example.com', 'admin'],
      ['admin@example.com', 'password'],
      [ADMIN_EMAIL, ADMIN_PASSWORD],
      ['admin@localhost.test', 'changeme-changeme'],
    ]) {
      const attempt = await agent.login(email as string, password as string);
      expect(attempt.status).toBe(401);
      expect(attempt.code).toBe('unauthenticated');
    }
    await server.stop();
  });

  it('refuses to bootstrap without a password and creates the first administrator once', async () => {
    const missing = await server.cli(['bootstrap-admin', '--email', ADMIN_EMAIL, '--name', 'Ada']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/No password given/);

    const weak = await server.cli(
      ['bootstrap-admin', '--email', ADMIN_EMAIL, '--name', 'Ada', '--password-stdin'],
      'short',
    );
    expect(weak.code).toBe(1);
    expect(weak.stderr).toMatch(/at least|12 to/);
    expect(await server.sql('SELECT 1 FROM users')).toHaveLength(0);

    const created = await server.cli(
      ['bootstrap-admin', '--email', ADMIN_EMAIL, '--name', 'Ada Admin', '--password-stdin'],
      `${ADMIN_PASSWORD}\n`,
    );
    expect(created.code, created.stderr).toBe(0);
    expect(created.stdout).toContain(`Administrator ${ADMIN_EMAIL} created.`);
    expect(created.stdout).not.toContain(ADMIN_PASSWORD);

    const again = await server.cli([
      'bootstrap-admin',
      '--email',
      'second@example.test',
      '--name',
      'Second',
      '--generate',
    ]);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/already exists/);

    const users = await server.sql<{ email: string; role: string; passwordHash: string }>(
      'SELECT email::text AS email, role, password_hash AS "passwordHash" FROM users',
    );
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: ADMIN_EMAIL, role: 'admin' });
    // Stored as an Argon2id hash with its parameters, never as the password.
    expect(users[0]?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(users[0]?.passwordHash).not.toContain(ADMIN_PASSWORD);
  });

  it('prints a generated password exactly once when asked to', async () => {
    const scratch = await TestServer.create('fresh-generate', { port: 4411 });
    try {
      const generated = await scratch.cli([
        'bootstrap-admin',
        '--email',
        'owner@example.test',
        '--name',
        'Owner',
        '--generate',
      ]);
      expect(generated.code, generated.stderr).toBe(0);
      const lines = generated.stdout.trim().split('\n');
      const password = lines.at(-1) ?? '';
      expect(password.length).toBeGreaterThanOrEqual(20);
      await scratch.start();
      const agent = new Agent(scratch);
      expect((await agent.login('owner@example.test', password)).status).toBe(200);
    } finally {
      await scratch.dispose();
    }
  });

  it('reaches the first working document: login, create, ticket, connect, edit, saved', async () => {
    await server.start();
    const admin = new Agent(server);
    const login = await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email: ADMIN_EMAIL, role: 'admin', status: 'active' });

    const session = await admin.get<SessionBody>('/api/auth/session');
    expect(session.body.user?.email).toBe(ADMIN_EMAIL);
    expect(session.body.csrfToken).toBe(login.body.csrfToken);

    const created = await admin.post<DocumentBody>('/api/documents', { title: 'First document' });
    expect(created.status).toBe(201);
    const documentId = created.body.document.id;
    expect(created.body.document).toMatchObject({
      title: 'First document',
      status: 'active',
      generation: 1,
      access: { role: 'admin', via: 'workspace_admin' },
    });

    const client = await connectCollab(admin, documentId);
    expect(isCapabilitySecret(client.ticket.ticket)).toBe(true);
    expect(parseCollabDocumentName(client.ticket.documentName)).toEqual({
      documentId,
      generation: 1,
    });
    expect(client.ticket.role).toBe('admin');
    expect(client.authenticatedScope).toBe('read-write');
    // The server created the initial content; the client did not.
    expect(client.json().content).toHaveLength(1);

    client.appendParagraph('Hello from the first document');
    await client.save();

    const exported = await admin.get(`/api/documents/${documentId}/export?format=txt`);
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('Hello from the first document');
    const rows = await server.sql<{ headSeq: number }>(
      'SELECT head_seq AS "headSeq" FROM documents WHERE id = $1',
      [documentId],
    );
    expect(Number(rows[0]?.headSeq)).toBeGreaterThanOrEqual(1);
    client.destroy();
  });

  it('seeds the sample document with its bundled image', async () => {
    const seeded = await server.cli(['seed-sample']);
    expect(seeded.code, seeded.stderr).toBe(0);
    const documentId = /\/d\/([0-9a-f-]{36})/.exec(seeded.stdout)?.[1] ?? '';
    expect(documentId).not.toBe('');
    const again = await server.cli(['seed-sample']);
    expect(again.stdout).toContain('already exists');

    const admin = new Agent(server);
    await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const markdown = await admin.get(`/api/documents/${documentId}/export?format=md`);
    expect(markdown.text).toContain('# Launch notes: RealtimeDocs demo');
    expect(markdown.text).toContain('```mermaid');
    expect(markdown.text).toContain('](assets/realtimedocs-demo.png)');

    const assets = await server.sql<{ id: string; mime: string; width: number; height: number }>(
      'SELECT id, mime, width, height FROM assets WHERE document_id = $1',
      [documentId],
    );
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ mime: 'image/png', width: 960, height: 540 });
    const image = await admin.get(`/api/documents/${documentId}/assets/${assets[0]?.id}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('fails fast with a clear message on bad configuration', async () => {
    const broken = await TestServer.create('fresh-bad-config', {
      port: 4412,
      env: { SESSION_SECRET: 'too-short', RD_PORT: '4412' },
    });
    await expect(broken.start()).rejects.toThrow(/exited during start-up/);
    expect(broken.log()).toMatch(/SESSION_SECRET must be at least 32 characters/);
    expect(broken.log()).not.toContain('too-short');
  });
});
