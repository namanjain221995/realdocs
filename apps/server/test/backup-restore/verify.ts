/**
 * Backup → restore round trip, data side. Used by `run.sh`:
 *
 *   tsx verify.ts populate <origin> <summary.json>   fill a fresh deployment with data
 *   tsx verify.ts check    <origin> <summary.json>   compare a restored deployment with it
 *
 * Everything goes through the public API and the collaboration endpoint of a
 * running deployment (containers), exactly like a browser would.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as Y from 'yjs';
import { Agent, connectCollab, makePng, type TestServer } from '../integration/harness';

interface Summary {
  adminEmail: string;
  adminPassword: string;
  memberEmail: string;
  memberPassword: string;
  documents: {
    id: string;
    title: string;
    status: string;
    text: string;
    markdown: string;
    assets: { id: string; name: string; sha256: string }[];
    snapshots: string[];
    members: number;
  }[];
  share: { documentId: string; grantId: string; secret: string };
  auditEvents: number;
}

const [, , phase, origin, summaryFile] = process.argv;
if (!phase || !origin || !summaryFile) {
  process.stderr.write('usage: verify.ts populate|check <origin> <summary.json>\n');
  process.exit(64);
}

const url = new URL(origin);
const server = {
  origin: url.origin,
  port: Number(url.port),
  wsUrl: `ws://${url.host}/collab`,
} as unknown as TestServer;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function fail(message: string): never {
  process.stderr.write(`FAILED: ${message}\n`);
  process.exit(1);
}

function equal(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
  process.stdout.write(`  ok  ${label}\n`);
}

interface DocumentList {
  documents: { id: string; title: string; status: string }[];
}

async function describeDocument(admin: Agent, id: string, title: string, status: string) {
  const text = await admin.get(`/api/documents/${id}/export?format=txt`);
  const markdown = await admin.get(`/api/documents/${id}/export?format=md`);
  const json = await admin.get(`/api/documents/${id}/export?format=json`);
  const assetIds = [...json.text.matchAll(/"assetId":\s*"([0-9a-f-]{36})"/g)].map(
    (match) => match[1] ?? '',
  );
  const assets = [];
  for (const assetId of assetIds) {
    const asset = await admin.get(`/api/documents/${id}/assets/${assetId}`);
    if (asset.status !== 200) fail(`asset ${assetId} of "${title}" answers ${asset.status}`);
    const disposition = asset.headers.get('content-disposition') ?? '';
    assets.push({
      id: assetId,
      name: /filename="([^"]*)"/.exec(disposition)?.[1] ?? '',
      sha256: sha256(asset.bytes),
    });
  }
  const snapshots = await admin.get<{ snapshots: { name: string }[] }>(
    `/api/documents/${id}/snapshots`,
  );
  const members = await admin.get<{ members: unknown[] }>(`/api/documents/${id}/members`);
  return {
    id,
    title,
    status,
    text: text.text,
    markdown: markdown.text,
    assets,
    snapshots: snapshots.body.snapshots.map((snapshot) => snapshot.name).sort(),
    members: members.body.members.length,
  };
}

async function populate(): Promise<void> {
  const summary = JSON.parse(readFileSync(summaryFile as string, 'utf8')) as Summary;
  const admin = new Agent(server);
  if ((await admin.login(summary.adminEmail, summary.adminPassword)).status !== 200) {
    fail('administrator cannot sign in');
  }

  // An account created through an invitation, with access to one document.
  const invitation = await admin.ok(
    admin.post<{ invitation: { id: string }; url: string }>('/api/invitations', {
      email: summary.memberEmail,
      role: 'member',
    }),
  );
  const member = new Agent(server);
  const accepted = await member.post('/api/invitations/accept', {
    invitationId: invitation.invitation.id,
    secret: new URL(invitation.url).hash.slice(1),
    displayName: 'Morgan Member',
    password: summary.memberPassword,
  });
  if (accepted.status !== 201) fail(`invitation accept failed: ${accepted.text}`);
  const memberId = (accepted.body as { user: { id: string } }).user.id;

  // A document edited through the collaboration endpoint, with an image, an attachment and a snapshot.
  const created = await admin.ok(
    admin.post<{ document: { id: string } }>('/api/documents', {
      title: 'Backup rehearsal — notes',
    }),
  );
  const documentId = created.document.id;
  await admin.ok(admin.put(`/api/documents/${documentId}/members/${memberId}`, { role: 'editor' }));
  const client = await connectCollab(admin, documentId);
  // Non-Latin text and a character outside the Basic Multilingual Plane (U+1F680).
  client.appendParagraph(
    `First paragraph written before the backup. नमस्ते ${String.fromCodePoint(0x1f680)}`,
  );
  const doomed = client.fragment.length;
  client.appendParagraph('This paragraph is deleted again.');
  client.appendParagraph('Last paragraph written before the backup.');
  await client.save();
  // A deletion-only change must survive the round trip as well.
  client.deleteBlock(doomed);
  const image = await admin.ok(
    admin.upload(documentId, makePng(120, 80, { noise: true }), 'rehearsal-chart.png'),
  );
  const attachment = await admin.ok(
    admin.upload(documentId, Buffer.from('id,value\n1,alpha\n2,beta\n'), 'rehearsal-data.csv'),
  );
  client.edit(() => {
    for (const [type, asset] of [
      ['image', image.asset],
      ['attachment', attachment.asset],
    ] as const) {
      const node = new Y.XmlElement(type);
      node.setAttribute('assetId', asset.id);
      node.setAttribute('name', asset.name);
      client.fragment.push([node]);
    }
  });
  await client.save();
  await admin.ok(
    admin.post(`/api/documents/${documentId}/snapshots`, { name: 'Before the backup' }),
  );
  client.appendParagraph('Written after the snapshot.');
  await client.save();
  client.destroy();
  // Give the server a moment to compact and unload the document.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const share = await admin.ok(
    admin.post<{ share: { id: string }; url: string }>(`/api/documents/${documentId}/shares`, {
      label: 'rehearsal link',
    }),
  );
  const archived = await admin.ok(
    admin.post<{ document: { id: string } }>('/api/documents', {
      title: 'Archived before the backup',
    }),
  );
  await admin.ok(admin.post(`/api/documents/${archived.document.id}/archive`));

  const documents: Summary['documents'] = [];
  for (const view of ['active', 'archived']) {
    const list = await admin.get<DocumentList>(`/api/documents?view=${view}`);
    for (const document of list.body.documents) {
      documents.push(await describeDocument(admin, document.id, document.title, document.status));
    }
  }
  const audit = await admin.get<{ events: unknown[] }>('/api/audit?limit=500');
  const complete: Summary = {
    ...summary,
    documents: documents.sort((a, b) => a.id.localeCompare(b.id)),
    share: { documentId, grantId: share.share.id, secret: new URL(share.url).hash.slice(1) },
    auditEvents: audit.body.events.length,
  };
  writeFileSync(summaryFile as string, JSON.stringify(complete, null, 2), { mode: 0o600 });
  process.stdout.write(
    `Populated ${url.origin}: ${complete.documents.length} documents, ${complete.documents.reduce((n, d) => n + d.assets.length, 0)} referenced assets.\n`,
  );
}

async function check(): Promise<void> {
  const summary = JSON.parse(readFileSync(summaryFile as string, 'utf8')) as Summary;
  process.stdout.write(`Checking the restored deployment at ${url.origin}\n`);

  // Accounts and password hashes came back: both accounts can sign in.
  const admin = new Agent(server);
  equal(
    'administrator signs in with the original password',
    (await admin.login(summary.adminEmail, summary.adminPassword)).status,
    200,
  );
  const member = new Agent(server);
  equal(
    'invited member signs in with the original password',
    (await member.login(summary.memberEmail, summary.memberPassword)).status,
    200,
  );

  const documents: Summary['documents'] = [];
  for (const view of ['active', 'archived']) {
    const list = await admin.get<DocumentList>(`/api/documents?view=${view}`);
    for (const document of list.body.documents) {
      documents.push(await describeDocument(admin, document.id, document.title, document.status));
    }
  }
  documents.sort((a, b) => a.id.localeCompare(b.id));
  equal(
    'same documents (ids, titles, states)',
    documents.map((d) => [d.id, d.title, d.status]),
    summary.documents.map((d) => [d.id, d.title, d.status]),
  );
  for (const [index, expected] of summary.documents.entries()) {
    const actual = documents[index];
    equal(`"${expected.title}": text export identical`, actual?.text, expected.text);
    equal(`"${expected.title}": Markdown export identical`, actual?.markdown, expected.markdown);
    equal(
      `"${expected.title}": ${expected.assets.length} asset file(s) byte-identical`,
      actual?.assets,
      expected.assets,
    );
    equal(`"${expected.title}": snapshots present`, actual?.snapshots, expected.snapshots);
    equal(`"${expected.title}": memberships present`, actual?.members, expected.members);
  }

  // Permissions came back: the member edits its document and sees nothing else.
  const memberList = await member.get<DocumentList>('/api/documents');
  equal(
    'member sees exactly its document',
    memberList.body.documents.map((d) => d.id),
    [summary.share.documentId],
  );
  // The share link still works (only its hash was stored, and that was restored).
  const guest = new Agent(server);
  const exchanged = await guest.post<{ documentId: string; role: string }>('/api/share/exchange', {
    grantId: summary.share.grantId,
    secret: summary.share.secret,
  });
  equal(
    'share link exchanges to a viewer session',
    [exchanged.status, exchanged.body.documentId, exchanged.body.role],
    [200, summary.share.documentId, 'viewer'],
  );
  const audit = await admin.get<{ events: unknown[] }>('/api/audit?limit=500');
  equal(
    'audit trail restored (it only grows afterwards)',
    audit.body.events.length >= summary.auditEvents,
    true,
  );

  // The restored deployment is fully functional: live editing with a durable acknowledgement.
  const client = await connectCollab(member, summary.share.documentId);
  equal(
    'collaboration endpoint serves the restored content',
    client.text(),
    summary.documents.find((d) => d.id === summary.share.documentId)?.text,
  );
  client.appendParagraph('Written after the restore.');
  await client.save();
  const expected = client.text();
  client.destroy();
  const after = await admin.get(`/api/documents/${summary.share.documentId}/export?format=txt`);
  equal('a new edit is acknowledged and exported by the restored deployment', after.text, expected);
  equal('the new edit is in the export', after.text.includes('Written after the restore.'), true);

  // The snapshot taken before the backup still restores (its stored state came back intact).
  const snapshots = await admin.get<{ snapshots: { id: string; name: string }[] }>(
    `/api/documents/${summary.share.documentId}/snapshots`,
  );
  const snapshot = snapshots.body.snapshots.find((entry) => entry.name === 'Before the backup');
  if (!snapshot) fail('the snapshot "Before the backup" is missing');
  const restored = await admin.post(
    `/api/documents/${summary.share.documentId}/snapshots/${snapshot.id}/restore`,
  );
  equal('restoring the snapshot is accepted', restored.status, 200);
  const rolledBack = await admin.get(
    `/api/documents/${summary.share.documentId}/export?format=txt`,
  );
  equal(
    'the document is back at the snapshot (later paragraphs gone)',
    [
      rolledBack.text.includes('Last paragraph written before the backup.'),
      rolledBack.text.includes('Written after the snapshot.'),
      rolledBack.text.includes('Written after the restore.'),
    ],
    [true, false, false],
  );
  process.stdout.write('RESTORE VERIFIED\n');
}

await (phase === 'populate'
  ? populate()
  : phase === 'check'
    ? check()
    : fail(`unknown phase ${phase}`));
process.exit(0);
