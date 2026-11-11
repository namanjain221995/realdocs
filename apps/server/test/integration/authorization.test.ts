/**
 * Acceptance test 8: knowing an id grants nothing. Every document endpoint —
 * metadata, members, shares, access list, tickets, assets, exports, snapshots,
 * desktop handoff — goes through the same access resolution.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Agent,
  RawCollab,
  createFixture,
  demoPng,
  requestTicket,
  type AssetBody,
  type DocumentBody,
  type Fixture,
  type RawMessage,
} from './harness';

let fx: Fixture;
let mine: string;
let other: string;
let otherAsset: string;
let otherSnapshot: string;
let otherShare: string;
let editor: Awaited<ReturnType<Fixture['createUser']>>;
let viewer: Awaited<ReturnType<Fixture['createUser']>>;
let outsider: Awaited<ReturnType<Fixture['createUser']>>;
let anonymous: Agent;

interface Probe {
  name: string;
  run: (agent: Agent, documentId: string) => ReturnType<Agent['get']>;
}

/** Every per-document route. `kind` says what it needs when access exists. */
const routes: (Probe & { needs: 'view' | 'edit' | 'manage' })[] = [
  { name: 'GET metadata', needs: 'view', run: (a, d) => a.get(`/api/documents/${d}`) },
  {
    name: 'PATCH rename',
    needs: 'manage',
    run: (a, d) => a.patch(`/api/documents/${d}`, { title: 'Renamed' }),
  },
  {
    name: 'POST duplicate',
    needs: 'manage',
    run: (a, d) => a.post(`/api/documents/${d}/duplicate`),
  },
  { name: 'POST archive', needs: 'manage', run: (a, d) => a.post(`/api/documents/${d}/archive`) },
  {
    name: 'POST unarchive',
    needs: 'manage',
    run: (a, d) => a.post(`/api/documents/${d}/unarchive`),
  },
  { name: 'GET access list', needs: 'manage', run: (a, d) => a.get(`/api/documents/${d}/access`) },
  { name: 'GET members', needs: 'manage', run: (a, d) => a.get(`/api/documents/${d}/members`) },
  {
    name: 'PUT member',
    needs: 'manage',
    run: (a, d) =>
      a.put(`/api/documents/${d}/members/${a.userId ?? randomUUID()}`, { role: 'editor' }),
  },
  {
    name: 'DELETE member',
    needs: 'manage',
    run: (a, d) => a.delete(`/api/documents/${d}/members/${randomUUID()}`),
  },
  { name: 'GET shares', needs: 'manage', run: (a, d) => a.get(`/api/documents/${d}/shares`) },
  {
    name: 'POST share',
    needs: 'manage',
    run: (a, d) => a.post(`/api/documents/${d}/shares`, { role: 'editor' }),
  },
  {
    name: 'PATCH share',
    needs: 'manage',
    run: (a, d) => a.patch(`/api/documents/${d}/shares/${otherShare}`, { role: 'editor' }),
  },
  {
    name: 'POST share revoke',
    needs: 'manage',
    run: (a, d) => a.post(`/api/documents/${d}/shares/${otherShare}/revoke`),
  },
  {
    name: 'POST share rotate',
    needs: 'manage',
    run: (a, d) => a.post(`/api/documents/${d}/shares/${otherShare}/rotate`),
  },
  { name: 'POST collab ticket', needs: 'view', run: (a, d) => requestTicket(a, d, 7) },
  {
    name: 'POST asset upload',
    needs: 'edit',
    run: (a, d) => a.upload(d, demoPng(), 'probe.png'),
  },
  {
    name: 'GET asset',
    needs: 'view',
    run: (a, d) => a.get(`/api/documents/${d}/assets/${otherAsset}`),
  },
  {
    name: 'GET export txt',
    needs: 'view',
    run: (a, d) => a.get(`/api/documents/${d}/export?format=txt`),
  },
  {
    name: 'GET export md',
    needs: 'view',
    run: (a, d) => a.get(`/api/documents/${d}/export?format=md`),
  },
  {
    name: 'GET export zip',
    needs: 'view',
    run: (a, d) => a.get(`/api/documents/${d}/export?format=md-zip`),
  },
  {
    name: 'GET export json',
    needs: 'view',
    run: (a, d) => a.get(`/api/documents/${d}/export?format=json`),
  },
  { name: 'GET snapshots', needs: 'manage', run: (a, d) => a.get(`/api/documents/${d}/snapshots`) },
  {
    name: 'POST snapshot',
    needs: 'manage',
    run: (a, d) => a.post(`/api/documents/${d}/snapshots`, { name: 'probe' }),
  },
  {
    name: 'POST snapshot restore',
    needs: 'manage',
    run: (a, d) => a.post(`/api/documents/${d}/snapshots/${otherSnapshot}/restore`),
  },
  {
    name: 'DELETE snapshot',
    needs: 'manage',
    run: (a, d) => a.delete(`/api/documents/${d}/snapshots/${otherSnapshot}`),
  },
  {
    name: 'POST desktop handoff',
    needs: 'view',
    run: (a, d) => a.post(`/api/documents/${d}/desktop-handoff`),
  },
  { name: 'POST trash', needs: 'manage', run: (a, d) => a.post(`/api/documents/${d}/trash`) },
  { name: 'POST restore', needs: 'manage', run: (a, d) => a.post(`/api/documents/${d}/restore`) },
  { name: 'DELETE document', needs: 'manage', run: (a, d) => a.delete(`/api/documents/${d}`) },
];

async function fingerprint(server: Fixture['server']): Promise<string> {
  const [row] = await server.sql<{ fingerprint: string }>(`
    SELECT md5(
      (SELECT COALESCE(string_agg(id::text || title || status || generation || head_seq, ',' ORDER BY id), '') FROM documents) ||
      (SELECT COALESCE(string_agg(document_id::text || user_id::text || role, ',' ORDER BY document_id, user_id), '') FROM document_members) ||
      (SELECT COALESCE(string_agg(id::text || role || COALESCE(revoked_at::text, ''), ',' ORDER BY id), '') FROM share_grants) ||
      (SELECT count(*)::text FROM snapshots) || (SELECT count(*)::text FROM assets) ||
      (SELECT count(*)::text FROM doc_updates)
    ) AS fingerprint`);
  return row?.fingerprint ?? '';
}

beforeAll(async () => {
  fx = await createFixture('authz');
  mine = await fx.createDocument('Mine');
  other = await fx.createDocument('Other (secret plans)');
  editor = await fx.createUser('Erin Editor');
  viewer = await fx.createUser('Vic Viewer');
  outsider = await fx.createUser('Olly Outsider');
  anonymous = new Agent(fx.server);
  await fx.admin.ok(
    fx.admin.put(`/api/documents/${mine}/members/${editor.userId}`, { role: 'editor' }),
  );
  await fx.admin.ok(
    fx.admin.put(`/api/documents/${mine}/members/${viewer.userId}`, { role: 'viewer' }),
  );
  // The other document has an asset, a snapshot and a share link of its own.
  otherAsset = (
    await fx.admin.ok<{ asset: AssetBody }>(fx.admin.upload(other, demoPng(), 'secret-chart.png'))
  ).asset.id;
  otherSnapshot = (
    await fx.admin.ok(
      fx.admin.post<{ snapshot: { id: string } }>(`/api/documents/${other}/snapshots`, {
        name: 'v1',
      }),
    )
  ).snapshot.id;
  otherShare = (await fx.createShare(other)).id;
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

describe('principals without any permission', () => {
  it('get one indistinguishable answer for existing, foreign and non-existent documents', async () => {
    const missing = randomUUID();
    const before = await fingerprint(fx.server);
    for (const route of routes) {
      const real = await route.run(outsider, other);
      const ghost = await route.run(outsider, missing);
      expect([route.name, real.status, real.code]).toEqual([route.name, 404, 'not_found']);
      expect([route.name, ghost.status, ghost.code]).toEqual([route.name, 404, 'not_found']);
      // Same message too: nothing tells the two cases apart.
      const realBody = real.body as { error: { message: string } };
      const ghostBody = ghost.body as { error: { message: string } };
      expect(realBody.error.message).toBe(ghostBody.error.message);
      expect(real.text).not.toContain('secret plans');
    }
    expect(await fingerprint(fx.server)).toBe(before);
  });

  it('treat malformed and probing ids the same way', async () => {
    for (const id of [
      'not-a-uuid',
      '1',
      `${other}x`,
      other.toUpperCase(),
      '..%2f..%2fetc%2fpasswd',
      "'; DROP TABLE documents; --",
      '00000000-0000-0000-0000-000000000000',
    ]) {
      const response = await outsider.get(`/api/documents/${encodeURIComponent(id)}`);
      expect([id, response.status, response.code]).toEqual([id, 404, 'not_found']);
      const asset = await outsider.get(
        `/api/documents/${encodeURIComponent(id)}/assets/${otherAsset}`,
      );
      expect([id, asset.status]).toEqual([id, 404]);
    }
    expect(await fx.server.sql('SELECT 1 FROM documents')).not.toHaveLength(0);
  });

  it('are asked to sign in when they present no session at all', async () => {
    const missing = randomUUID();
    for (const route of routes) {
      const real = await route.run(anonymous, other);
      const ghost = await route.run(anonymous, missing);
      expect([route.name, real.status, real.code]).toEqual([route.name, 401, 'unauthenticated']);
      expect([route.name, ghost.status, ghost.code]).toEqual([route.name, 401, 'unauthenticated']);
    }
  });

  it('cannot list or search documents they are not a member of', async () => {
    for (const view of ['active', 'recent', 'archived', 'trash']) {
      const list = await outsider.get<{ documents: unknown[] }>(`/api/documents?view=${view}`);
      expect(list.body.documents).toEqual([]);
    }
    const search = await outsider.get<{ documents: unknown[] }>('/api/documents?q=secret');
    expect(search.body.documents).toEqual([]);
    expect((await anonymous.get('/api/documents')).status).toBe(401);
  });
});

describe('members of one document', () => {
  it('cannot reach any endpoint of another document', async () => {
    const before = await fingerprint(fx.server);
    for (const agent of [editor, viewer]) {
      for (const route of routes) {
        const response = await route.run(agent, other);
        expect([route.name, response.status, response.code]).toEqual([
          route.name,
          404,
          'not_found',
        ]);
      }
    }
    expect(await fingerprint(fx.server)).toBe(before);
  });

  it("cannot use another document's asset, snapshot or share ids through their own document", async () => {
    // Real ids, wrong document: the lookup is scoped by document, so they do not exist here.
    const asset = await editor.get(`/api/documents/${mine}/assets/${otherAsset}`);
    expect([asset.status, asset.code]).toEqual([404, 'not_found']);
    const adminAsset = await fx.admin.get(`/api/documents/${mine}/assets/${otherAsset}`);
    expect(adminAsset.status).toBe(404);
    const restore = await fx.admin.post(
      `/api/documents/${mine}/snapshots/${otherSnapshot}/restore`,
    );
    expect([restore.status, restore.code]).toEqual([404, 'not_found']);
    const remove = await fx.admin.delete(`/api/documents/${mine}/snapshots/${otherSnapshot}`);
    expect(remove.status).toBe(404);
    const revoke = await fx.admin.post(`/api/documents/${mine}/shares/${otherShare}/revoke`);
    expect(revoke.status).toBe(404);
    const rotate = await fx.admin.post(`/api/documents/${mine}/shares/${otherShare}/rotate`);
    expect(rotate.status).toBe(404);
    // The other document is untouched.
    const snapshots = await fx.admin.get<{ snapshots: unknown[] }>(
      `/api/documents/${other}/snapshots`,
    );
    expect(snapshots.body.snapshots).toHaveLength(1);
    const shares = await fx.admin.get<{ shares: { state: string }[] }>(
      `/api/documents/${other}/shares`,
    );
    expect(shares.body.shares.map((share) => share.state)).toEqual(['active']);
  });

  it('see exactly the documents they are members of', async () => {
    const list = await editor.get<{ documents: DocumentBody['document'][] }>('/api/documents');
    expect(list.body.documents.map((document) => document.id)).toEqual([mine]);
    expect(list.body.documents[0]?.access).toMatchObject({ role: 'editor', via: 'membership' });
    const viewerList = await viewer.get<{ documents: DocumentBody['document'][] }>(
      '/api/documents?view=recent',
    );
    expect(viewerList.body.documents[0]?.access.role).toBe('viewer');
    const adminList = await fx.admin.get<{ documents: DocumentBody['document'][] }>(
      '/api/documents',
    );
    expect(adminList.body.documents.map((document) => document.id).sort()).toEqual(
      [mine, other].sort(),
    );
    const search = await fx.admin.get<{ documents: DocumentBody['document'][] }>(
      '/api/documents?q=SECRET%20pl',
    );
    expect(search.body.documents.map((document) => document.id)).toEqual([other]);
    const literal = await fx.admin.get<{ documents: unknown[] }>('/api/documents?q=%25');
    expect(literal.body.documents).toEqual([]);
  });
});

describe('role matrix on a document the principal can reach', () => {
  /** Status of a permitted call (the asset id belongs to the other document, so it never resolves). */
  const allowed = (name: string): number => {
    if (name === 'GET asset') return 404;
    return /upload|handoff/.test(name) ? 201 : 200;
  };

  it('lets viewers read and nothing else', async () => {
    const before = await fingerprint(fx.server);
    for (const route of routes) {
      const response = await route.run(viewer, mine);
      if (route.needs === 'view') {
        expect([route.name, response.status]).toEqual([route.name, allowed(route.name)]);
      } else {
        expect([route.name, response.status, response.code]).toEqual([
          route.name,
          403,
          'forbidden',
        ]);
      }
    }
    // Uploads, renames, membership, shares, snapshots, lifecycle: nothing happened.
    expect(await fingerprint(fx.server)).toBe(before);
  });

  it('lets editors edit content but not manage the document', async () => {
    const before = await fingerprint(fx.server);
    for (const route of routes) {
      if (route.needs === 'edit') continue;
      const response = await route.run(editor, mine);
      if (route.needs === 'manage') {
        expect([route.name, response.status, response.code]).toEqual([
          route.name,
          403,
          'forbidden',
        ]);
      } else {
        expect([route.name, response.status]).toEqual([route.name, allowed(route.name)]);
      }
    }
    expect(await fingerprint(fx.server)).toBe(before);

    const upload = await editor.upload(mine, demoPng(), 'editor.png');
    expect(upload.status).toBe(201);
    const download = await viewer.get(`/api/documents/${mine}/assets/${upload.body.asset.id}`);
    expect(download.status).toBe(200);
    // … but that asset does not exist under the other document, even for an administrator.
    const crossed = await fx.admin.get(`/api/documents/${other}/assets/${upload.body.asset.id}`);
    expect(crossed.status).toBe(404);
    for (const agent of [editor, viewer]) {
      expect((await agent.post('/api/documents', { title: 'nope' })).status).toBe(403);
    }
  });

  it('reports the effective role and how it was obtained', async () => {
    const asAdmin = await fx.admin.get<DocumentBody>(`/api/documents/${mine}`);
    expect(asAdmin.body.document.access).toMatchObject({
      role: 'admin',
      via: 'workspace_admin',
      accountId: fx.admin.userId,
    });
    const asEditor = await editor.get<DocumentBody>(`/api/documents/${mine}`);
    expect(asEditor.body.document.access).toMatchObject({
      role: 'editor',
      via: 'membership',
      accountId: editor.userId,
    });
    const asViewer = await viewer.get<DocumentBody>(`/api/documents/${mine}`);
    expect(asViewer.body.document.access).toMatchObject({ role: 'viewer', via: 'membership' });
  });

  it('applies membership changes to the very next request', async () => {
    const temp = await fx.createUser('Tam Temporary');
    expect((await temp.get(`/api/documents/${mine}`)).status).toBe(404);
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${mine}/members/${temp.userId}`, { role: 'viewer' }),
    );
    expect((await temp.get(`/api/documents/${mine}`)).status).toBe(200);
    expect((await temp.upload(mine, demoPng(), 'x.png')).status).toBe(403);
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${mine}/members/${temp.userId}`, { role: 'editor' }),
    );
    expect((await temp.upload(mine, demoPng(), 'x.png')).status).toBe(201);
    const members = await fx.admin.delete<{ members: { userId: string }[] }>(
      `/api/documents/${mine}/members/${temp.userId}`,
    );
    expect(members.body.members.map((member) => member.userId)).not.toContain(temp.userId);
    expect((await temp.get(`/api/documents/${mine}`)).status).toBe(404);
    expect((await temp.get(`/api/documents/${mine}/export?format=txt`)).status).toBe(404);
    const missingUser = await fx.admin.put(`/api/documents/${mine}/members/${randomUUID()}`, {
      role: 'viewer',
    });
    expect(missingUser.status).toBe(404);
  });
});

describe('collaboration tickets follow the same rules', () => {
  it('are refused without access and bound to the document they were issued for', async () => {
    expect((await requestTicket(outsider, other, 1)).status).toBe(404);
    expect((await requestTicket(anonymous, other, 1)).status).toBe(401);
    expect((await requestTicket(editor, other, 1)).status).toBe(404);

    // A valid ticket for one document cannot open another one.
    const ticket = await requestTicket(editor, mine, 99);
    expect(ticket.status).toBe(200);
    const raw = await RawCollab.open(fx.server);
    raw.auth(`${other}.g1`, ticket.body.ticket);
    const denied = await raw.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(denied).toMatchObject({ status: 'denied', detail: 'ticket_invalid' });
    // No content was sent before or after the refusal.
    expect(raw.messages.filter((message) => message.kind === 'sync')).toEqual([]);
    // … and the attempt consumed the ticket.
    const second = await RawCollab.open(fx.server);
    second.auth(ticket.body.documentName, ticket.body.ticket);
    const again = await second.waitFor<Extract<RawMessage, { kind: 'auth' }>>(
      (message) => message.kind === 'auth',
    );
    expect(again).toMatchObject({ status: 'denied', detail: 'ticket_invalid' });
    raw.destroy();
    second.destroy();
  });
});
