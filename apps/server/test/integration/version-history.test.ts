/**
 * The version history document (docs/version-history.md) and interviewers with an account
 * (docs/session-integration.md), against the real server and PostgreSQL: two people editing
 * through real collaboration, an uploaded image, the text, JSON, image list, image bytes and
 * archive through a browser session and through an API key, and the documents list of a member
 * who is an interviewer.
 */
import { createHash } from 'node:crypto';
import {
  CreateInterviewSessionResponse,
  InterviewSession,
  VersionHistoryImagesResponse,
  VersionHistoryResponse,
  type ServiceScope,
  SERVICE_SCOPES,
} from '@realtimedocs/contracts';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Agent, connectCollab, createFixture, demoPng, type Fixture } from './harness';

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture('version-history', { env: { RATE_API_KEY_PER_MINUTE: '100000' } });
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

async function makeKey(
  scopes: readonly ServiceScope[] = SERVICE_SCOPES,
): Promise<{ id: string; client: Agent }> {
  const created = await fx.admin.ok<{ key: { id: string }; secret: string }>(
    fx.admin.post('/api/admin/api-keys', { name: 'version history key', scopes }),
  );
  const client = new Agent(fx.server, null);
  client.bearer = created.secret;
  return { id: created.key.id, client };
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

let counter = 0;
function sessionBody(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    candidate: { name: `Aarav Sharma ${counter}`, email: `aarav${counter}@example.com` },
    interviewers: [{ name: 'Meera Iyer', email: `meera${counter}@acme.example` }],
    companyName: `Acme ${counter}`,
    round: { number: '2', name: 'System design' },
    scheduledAt: '2030-03-14T15:30:00+05:30',
    timezone: 'Asia/Kolkata',
    expiresAt: inDays(7),
    ...overrides,
  };
}

async function createSession(
  client: Agent,
  overrides: Record<string, unknown> = {},
): Promise<CreateInterviewSessionResponse> {
  const result = await client.post<CreateInterviewSessionResponse>(
    '/api/v1/interview-sessions',
    sessionBody(overrides),
  );
  expect(result.status, result.text).toBe(201);
  return CreateInterviewSessionResponse.parse(result.body);
}

async function open(url: string): Promise<Agent> {
  const parsed = new URL(url);
  return fx.guest(parsed.pathname.split('/')[2] ?? '', parsed.hash.slice(1));
}

interface DocumentsList {
  documents: {
    id: string;
    access: { role: string; via: string };
    interview?: {
      sessionId: string;
      company: string;
      round: { number: string; name: string | null };
      candidate: string | null;
      scheduledAt: string;
      status: string;
    };
  }[];
}

const listOf = async (agent: Agent): Promise<DocumentsList['documents']> =>
  (await agent.ok(agent.get<DocumentsList>('/api/documents'))).documents;

describe('version history document', () => {
  let key: Awaited<ReturnType<typeof makeKey>>;
  let session: CreateInterviewSessionResponse;
  let imageId: string;
  let attachmentId: string;
  const first = 'Design a URL shortener.';
  const pasted = 'Start with the API: POST /shorten and GET /{code}.';

  beforeAll(async () => {
    key = await makeKey();
    session = await createSession(key.client);
    const interviewer = await open(session.interviewerAccess.url);
    const candidate = await open(session.candidateAccess.url);

    const a = await connectCollab(interviewer, session.documentId);
    a.appendParagraph(first);
    await a.save();
    a.destroy();

    const upload = await candidate.upload(session.documentId, demoPng(), 'whiteboard.png', {
      contentType: 'image/png',
    });
    expect(upload.status, upload.text).toBe(201);
    imageId = upload.body.asset.id;
    const file = await candidate.upload(
      session.documentId,
      Buffer.from('plain notes\n'),
      'notes.txt',
      { contentType: 'text/plain' },
    );
    expect(file.status, file.text).toBe(201);
    attachmentId = file.body.asset.id;

    const b = await connectCollab(candidate, session.documentId);
    b.send({ t: 'hint', kind: 'paste', at: Date.now() });
    b.appendParagraph(pasted);
    await b.save();
    b.edit(() => {
      const image = new Y.XmlElement('image');
      image.setAttribute('assetId', imageId);
      b.fragment.push([image]);
    });
    await b.save();
    b.destroy();

    // The interviewer removes the image again: it stays in the history.
    const c = await connectCollab(interviewer, session.documentId);
    c.edit(() => {
      const last = c.fragment.length - 1;
      c.fragment.delete(last, 1);
    });
    await c.save();
    c.destroy();
  }, 60_000);

  const base = () => `/api/documents/${session.documentId}/version-history`;

  it('is doc.txt in the agreed layout, with who, when and what for every version', async () => {
    const result = await fx.admin.get(base());
    expect(result.status, result.text).toBe(200);
    expect(result.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(result.headers.get('content-disposition')).toContain('filename="doc.txt"');
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    const text = result.text;
    const lines = text.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'DOCUMENT VERSION HISTORY',
      `Document ID: ${session.documentId}`,
      `Document URL: ${fx.server.origin}/d/${session.documentId}`,
      `Title: ${session.title}`,
    ]);
    expect(text).toContain(`Session ID: ${session.sessionId}\n`);
    expect(text).toMatch(
      /\nCandidate: Aarav Sharma \d+\nCompany: Acme \d+\nRound: 2 System design\n/,
    );
    expect(text).toMatch(
      /\nTracking Started: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\n\n\n={50}\nVERSION 1\n/,
    );
    // The session's time zone decides the "Edited At" lines.
    expect(text).toMatch(/\nEdited At: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d (AM|PM) IST\n/);
    expect(text).toMatch(
      /\nEdited By: Meera Iyer \(Interviewer, meera\d+@acme\.example\)\nAction: Typed\n/,
    );
    expect(text).toMatch(
      /\nEdited By: Aarav Sharma \d+ \(Candidate, aarav\d+@example\.com\)\nAction: Pasted\n/,
    );
    expect(text).toMatch(
      new RegExp(`\\n- \\[\\d\\d:\\d\\d:\\d\\d (AM|PM)\\] ${first.replace(/[.]/g, '\\.')}\\n`),
    );
    expect(text).toContain(`] [IMAGE ${imageId}] image pasted (images/${imageId}.png)\n`);
    expect(text).toContain(`] [IMAGE ${imageId}] image removed\n`);
    expect(text).toContain(`\n[IMAGE ${imageId}] images/${imageId}.png\n`);
    expect(text).toContain('\nREMOVED:\n- (nothing removed)\n');
    expect(text).toMatch(
      /\n={50}\nCURRENT FINAL CONTENT\n[^]*\n\n\n={50}\nFINALIZED AT: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\n$/,
    );
    // The same history gives the same document, byte for byte.
    expect((await fx.admin.get(base())).text).toBe(text);
  });

  it('is the same content as JSON, with a time on every line and the editor', async () => {
    const body = VersionHistoryResponse.parse(
      await fx.admin.ok(fx.admin.get(`${base()}?format=json`)),
    );
    expect(body.document).toEqual({
      id: session.documentId,
      title: session.title,
      url: `${fx.server.origin}/d/${session.documentId}`,
    });
    expect(body.session).toMatchObject({
      id: session.sessionId,
      round: { number: '2', name: 'System design' },
    });
    expect(body.timezone).toBe('Asia/Kolkata');
    expect(body.truncated).toBe(false);
    expect(body.versions.map((version) => version.version)).toEqual(
      body.versions.map((_, index) => index + 1),
    );
    const [v1] = body.versions;
    expect(v1?.added).toEqual([first]);
    expect(v1?.editor).toMatchObject({ name: 'Meera Iyer', role: 'Interviewer', kind: 'guest' });
    expect(v1?.editor.email).toMatch(/^meera\d+@acme\.example$/);
    expect(v1?.action).toBe('Typed');
    expect(v1?.addedDetail[0]?.text).toBe(first);
    expect(Date.parse(v1?.addedDetail[0]?.at ?? '')).toBeGreaterThan(Date.now() - 120_000);
    expect(v1?.addedDetail[0]?.atText).toMatch(/^\d\d:\d\d:\d\d (AM|PM)$/);

    // A paste is a version of its own, by the candidate.
    const paste = body.versions.find((version) => version.added.includes(pasted));
    expect(paste?.action).toBe('Pasted');
    expect(paste?.editor.role).toBe('Candidate');
    const withImage = body.versions.find((version) => version.images.includes(imageId));
    expect(withImage?.added).toContain(`[IMAGE ${imageId}] image pasted (images/${imageId}.png)`);
    const last = body.versions.at(-1);
    expect(last?.removed).toEqual([`[IMAGE ${imageId}] image removed`]);
    expect(last?.editor.role).toBe('Interviewer');
    expect(body.finalContent).toBe(`${first}\n${pasted}`);
    expect(body.images).toEqual([
      expect.objectContaining({
        id: imageId,
        fileName: `${imageId}.png`,
        mime: 'image/png',
        firstVersion: withImage?.version,
        lastVersion: withImage?.version,
        url: `${base()}/images/${imageId}`,
      }),
    ]);
    // Server times, in order.
    const times = body.versions.map((version) => Date.parse(version.editedAt));
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(Date.parse(body.trackingStartedAt ?? '')).toBeLessThanOrEqual(times[0] ?? 0);
  });

  it('honours the time zone and grouping parameters and refuses bad ones', async () => {
    const utc = await fx.admin.get(`${base()}?timezone=UTC`);
    expect(utc.text).toMatch(/\nEdited At: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d (AM|PM) UTC\n/);
    expect((await fx.admin.get(`${base()}?timezone=Mars/Olympus`)).status).toBe(400);
    expect((await fx.admin.get(`${base()}?gapSeconds=0`)).status).toBe(400);
    expect((await fx.admin.get(`${base()}?format=pdf`)).status).toBe(400);
  });

  it('lists the images and serves their bytes, and nothing that is not this document’s image', async () => {
    const list = VersionHistoryImagesResponse.parse(
      await fx.admin.ok(fx.admin.get(`${base()}/images`)),
    );
    expect(list.images).toHaveLength(1);
    const [image] = list.images;
    const bytes = await fx.admin.get(image?.url ?? '');
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('image/png');
    expect(bytes.headers.get('content-disposition')).toContain(`${imageId}.png`);
    expect(bytes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(bytes.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(createHash('sha256').update(bytes.bytes).digest('hex')).toBe(image?.sha256);
    expect(bytes.bytes.length).toBe(image?.sizeBytes);

    // An attachment is not an image; an unknown id and another document's image are not found.
    expect((await fx.admin.get(`${base()}/images/${attachmentId}`)).status).toBe(404);
    expect(
      (await fx.admin.get(`${base()}/images/11111111-1111-4111-8111-111111111111`)).status,
    ).toBe(404);
    expect((await fx.admin.get(`${base()}/images/not-a-uuid`)).status).toBe(404);
    const other = await fx.createDocument('Another document');
    const foreign = await fx.admin.get(`/api/documents/${other}/version-history/images/${imageId}`);
    expect(foreign.status).toBe(404);
    // An image that was uploaded to a document but never placed in it is not in its history.
    const loose = await fx.admin.upload(other, demoPng(), 'loose.png', {
      contentType: 'image/png',
    });
    expect(
      (await fx.admin.get(`/api/documents/${other}/version-history/images/${loose.body.asset.id}`))
        .status,
    ).toBe(404);
  });

  it('packs doc.txt, the images and a manifest into the archive', async () => {
    const result = await fx.admin.get(`${base()}/archive`);
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('application/zip');
    expect(result.headers.get('content-disposition')).toContain('-version-history.zip');
    const files = unzipSync(new Uint8Array(result.bytes));
    expect(Object.keys(files).sort()).toEqual(
      ['docs/doc.txt', `images/${imageId}.png`, 'manifest.json'].sort(),
    );
    expect(strFromU8(files['docs/doc.txt'] as Uint8Array)).toBe((await fx.admin.get(base())).text);
    expect(Buffer.from(files[`images/${imageId}.png`] as Uint8Array).equals(demoPng())).toBe(true);
    const manifest = JSON.parse(strFromU8(files['manifest.json'] as Uint8Array)) as {
      versions: Record<string, unknown>[];
      images: { id: string }[];
    };
    expect(manifest.images.map((image) => image.id)).toEqual([imageId]);
    expect(manifest.versions[0]).not.toHaveProperty('snapshot');
  });

  it('is only for people who manage the document', async () => {
    const member = await fx.createUser('Mia Member');
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${session.documentId}/members/${member.userId}`, {
        role: 'editor',
      }),
    );
    for (const path of ['', '?format=json', '/images', `/images/${imageId}`, '/archive']) {
      expect((await member.get(`${base()}${path}`)).status, path).toBe(403);
      expect((await new Agent(fx.server).get(`${base()}${path}`)).status, path).toBe(401);
    }
    const candidate = await open(
      (
        await key.client.ok<{ participants: { role: string; access: { url: string } }[] }>(
          key.client.post(`/api/v1/interview-sessions/${session.sessionId}/rotate-links`, {}),
        )
      ).participants.find((p) => p.role === 'candidate')?.access.url ?? '',
    );
    expect((await candidate.get(base())).status).toBe(403);
  });

  it('is served to an API key with documents:history:read, by document and by session', async () => {
    for (const root of [
      `/api/v1/documents/${session.documentId}`,
      `/api/v1/interview-sessions/${session.sessionId}`,
    ]) {
      const text = await key.client.get(`${root}/version-history`);
      expect(text.status, text.text).toBe(200);
      expect(text.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(text.text).toBe((await fx.admin.get(base())).text);

      const json = VersionHistoryResponse.parse(
        await key.client.ok(key.client.get(`${root}/version-history?format=json`)),
      );
      expect(json.images[0]?.url).toBe(`${root}/version-history/images/${imageId}`);

      const images = VersionHistoryImagesResponse.parse(
        await key.client.ok(key.client.get(`${root}/version-history/images`)),
      );
      expect(images.images.map((image) => image.id)).toEqual([imageId]);
      const bytes = await key.client.get(images.images[0]?.url ?? '');
      expect(bytes.status).toBe(200);
      expect(bytes.bytes.subarray(0, 4).toString('hex')).toBe('89504e47');

      const archive = await key.client.get(`${root}/version-history/archive`);
      expect(archive.status).toBe(200);
      expect(Object.keys(unzipSync(new Uint8Array(archive.bytes)))).toContain('docs/doc.txt');

      expect((await key.client.get(`${root}/version-history/images/${attachmentId}`)).status).toBe(
        404,
      );
    }
    const exported = await fx.server.sql<{ count: string }>(
      "SELECT count(*) AS count FROM audit_events WHERE action = 'history.exported' AND actor_kind = 'service' AND target_id = $1",
      [session.documentId],
    );
    expect(Number(exported[0]?.count)).toBeGreaterThanOrEqual(4);
  });

  it('enforces the scope and does not reveal other resources', async () => {
    const limited = await makeKey(['sessions:read', 'documents:read']);
    const denied = await limited.client.get(
      `/api/v1/documents/${session.documentId}/version-history`,
    );
    expect(denied.status).toBe(403);
    expect(denied.text).toContain('documents:history:read');
    expect(
      (
        await limited.client.get(
          `/api/v1/interview-sessions/${session.sessionId}/version-history/archive`,
        )
      ).status,
    ).toBe(403);
    const unknown = '22222222-2222-4222-8222-222222222222';
    expect((await key.client.get(`/api/v1/documents/${unknown}/version-history`)).status).toBe(404);
    expect(
      (await key.client.get(`/api/v1/interview-sessions/${unknown}/version-history`)).status,
    ).toBe(404);
    expect(
      (
        await new Agent(fx.server, null).get(
          `/api/v1/documents/${session.documentId}/version-history`,
        )
      ).status,
    ).toBe(401);
  });

  it('writes a document without history as an empty one', async () => {
    const documentId = await fx.createDocument('Untouched');
    const result = await fx.admin.get(`/api/documents/${documentId}/version-history`);
    expect(result.status).toBe(200);
    expect(result.text).toContain('Tracking Started: (no history recorded)');
    expect(result.text).not.toContain('VERSION 1');
  });

  it('starts a new version after a pause and keeps a restored version apart', async () => {
    const documentId = await fx.createDocument('Pauses');
    const a = await connectCollab(fx.admin, documentId);
    a.appendParagraph('one');
    await a.save();
    a.appendParagraph('two');
    await a.save();
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    a.appendParagraph('three');
    await a.save();
    a.destroy();
    const url = `/api/documents/${documentId}/version-history?format=json`;
    const joined = VersionHistoryResponse.parse(await fx.admin.ok(fx.admin.get(url)));
    expect(joined.versions).toHaveLength(1);
    expect(joined.versions[0]?.added).toEqual(['one', 'two', 'three']);
    expect(joined.versions[0]?.editor).toMatchObject({ role: 'Admin', kind: 'user' });
    // Each line has the time of its own change, not the version's.
    const [one, , three] = joined.versions[0]?.addedDetail ?? [];
    expect(Date.parse(three?.at ?? '') - Date.parse(one?.at ?? '')).toBeGreaterThan(1_000);

    const split = VersionHistoryResponse.parse(
      await fx.admin.ok(fx.admin.get(`${url}&gapSeconds=1`)),
    );
    expect(split.versions.map((version) => version.added)).toEqual([['one', 'two'], ['three']]);
  });
});

describe('interview session API: strings', () => {
  it('takes the round as a string, still accepts a number, and answers a string', async () => {
    const key = await makeKey();
    const asString = await createSession(key.client, { round: { number: '7' } });
    const asNumber = await createSession(key.client, { round: { number: 3, name: 'Coding' } });
    const read = async (id: string) =>
      InterviewSession.parse(
        await key.client.ok(key.client.get(`/api/v1/interview-sessions/${id}`)),
      );
    expect((await read(asString.sessionId)).round).toEqual({ number: '7', name: null });
    expect((await read(asNumber.sessionId)).round).toEqual({ number: '3', name: 'Coding' });
    expect(asString.title).toContain('_Round_7_');

    const updated = await key.client.patch<InterviewSession>(
      `/api/v1/interview-sessions/${asString.sessionId}`,
      { round: { number: '12' } },
    );
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body.round.number).toBe('12');

    for (const bad of ['0', '100', '2.5', 'two', '', ' ']) {
      const refused = await key.client.post(
        '/api/v1/interview-sessions',
        sessionBody({ round: { number: bad } }),
      );
      expect(refused.status, `round ${JSON.stringify(bad)}`).toBe(400);
    }
    // The list filter keeps taking a number in the query string.
    const listed = await key.client.ok<{ items: InterviewSession[] }>(
      key.client.get('/api/v1/interview-sessions?round=12'),
    );
    expect(listed.items.map((item) => item.sessionId)).toEqual([asString.sessionId]);
  });
});

describe('interviewers with an account', () => {
  it('puts the session document into the interviewer’s own list, and takes it out again', async () => {
    const key = await makeKey();
    const ivy = await fx.createUser('Ivy Interviewer');
    const session = await createSession(key.client, {
      interviewers: [
        // The address is compared without regard to case.
        { name: 'Ivy Interviewer', email: ivy.email.toUpperCase() },
        { name: 'Nobody Yet', email: 'nobody.yet@acme.example' },
      ],
    });
    const linked = Object.fromEntries(session.participants.map((p) => [p.name, p.accountLinked]));
    expect(linked['Ivy Interviewer']).toBe(true);
    expect(linked['Nobody Yet']).toBe(false);
    expect(session.participants.find((p) => p.role === 'candidate')?.accountLinked).toBe(false);

    const mine = await listOf(ivy);
    const entry = mine.find((document) => document.id === session.documentId);
    expect(entry?.access).toMatchObject({ role: 'editor', via: 'membership' });
    expect(entry?.interview).toMatchObject({
      sessionId: session.sessionId,
      round: { number: '2', name: 'System design' },
      status: 'scheduled',
    });
    expect(entry?.interview?.candidate).toMatch(/^Aarav Sharma/);
    // She opens and edits it with her own account.
    expect((await ivy.get(`/api/documents/${session.documentId}`)).status).toBe(200);
    const client = await connectCollab(ivy, session.documentId);
    client.appendParagraph('written from my own account');
    await client.save();
    client.destroy();

    const read = InterviewSession.parse(
      await key.client.ok(key.client.get(`/api/v1/interview-sessions/${session.sessionId}`)),
    );
    const participant = read.participants.find((p) => p.name === 'Ivy Interviewer');
    expect(participant?.accountLinked).toBe(true);
    const audit = await fx.server.sql<{ details: Record<string, unknown> }>(
      "SELECT details FROM audit_events WHERE action = 'member.added' AND target_id = $1",
      [session.documentId],
    );
    expect(audit[0]?.details).toMatchObject({
      userId: ivy.userId,
      via: 'interview_session',
      sessionId: session.sessionId,
    });

    // View-only interviewers are view-only members.
    await key.client.ok(
      key.client.patch(`/api/v1/interview-sessions/${session.sessionId}`, {
        permissions: { interviewerCanEdit: false },
      }),
    );
    expect(
      (await listOf(ivy)).find((document) => document.id === session.documentId)?.access.role,
    ).toBe('viewer');

    // Removing the interviewer removes the membership that was made for her.
    const removed = await key.client.delete(
      `/api/v1/interview-sessions/${session.sessionId}/participants/${participant?.participantId}`,
    );
    expect(removed.status, removed.text).toBe(200);
    expect((await listOf(ivy)).some((document) => document.id === session.documentId)).toBe(false);
    expect((await ivy.get(`/api/documents/${session.documentId}`)).status).toBe(404);
  });

  it('links an interviewer who is added later, and leaves a membership made by hand alone', async () => {
    const key = await makeKey();
    const hank = await fx.createUser('Hank Hand');
    const lena = await fx.createUser('Lena Later');
    const session = await createSession(key.client);
    // The administrator shares the document with Hank by hand.
    await fx.admin.ok(
      fx.admin.put(`/api/documents/${session.documentId}/members/${hank.userId}`, {
        role: 'viewer',
      }),
    );
    const add = async (name: string, email: string) =>
      key.client.ok<{ participant: { participantId: string; accountLinked?: boolean } }>(
        key.client.post(`/api/v1/interview-sessions/${session.sessionId}/participants`, {
          name,
          email,
        }),
      );
    const hankAdded = await add('Hank Hand', hank.email);
    const lenaAdded = await add('Lena Later', lena.email);
    // Hank already was a member: his membership is not taken over.
    expect(hankAdded.participant.accountLinked).toBe(false);
    expect(lenaAdded.participant.accountLinked).toBe(true);
    const roleOf = async (agent: Agent) =>
      (await listOf(agent)).find((document) => document.id === session.documentId)?.access.role;
    expect(await roleOf(hank)).toBe('viewer');
    expect(await roleOf(lena)).toBe('editor');

    for (const id of [hankAdded.participant.participantId, lenaAdded.participant.participantId]) {
      const removed = await key.client.delete(
        `/api/v1/interview-sessions/${session.sessionId}/participants/${id}`,
      );
      expect(removed.status, removed.text).toBe(200);
    }
    // Lena's went with her; Hank keeps what the administrator gave him.
    expect(await roleOf(lena)).toBeUndefined();
    expect(await roleOf(hank)).toBe('viewer');
  });

  it('follows the session: read-only when it is over, gone when it is archived', async () => {
    const key = await makeKey();
    const ivy = await fx.createUser('Ivy Over');
    const session = await createSession(key.client, {
      interviewers: [{ name: 'Ivy Over', email: ivy.email }],
    });
    const roleOf = async () =>
      (await listOf(ivy)).find((document) => document.id === session.documentId)?.access.role;
    expect(await roleOf()).toBe('editor');
    for (const action of ['start', 'complete']) {
      const result = await key.client.post(
        `/api/v1/interview-sessions/${session.sessionId}/${action}`,
      );
      expect(result.status, result.text).toBe(200);
    }
    expect(await roleOf()).toBe('viewer');
    const archived = await key.client.delete(`/api/v1/interview-sessions/${session.sessionId}`);
    expect(archived.status, archived.text).toBe(200);
    expect(await roleOf()).toBeUndefined();
    const archivedList = (await ivy.ok(ivy.get<DocumentsList>('/api/documents?view=archived')))
      .documents;
    expect(archivedList.some((document) => document.id === session.documentId)).toBe(false);
  });

  it('links an account created later only when an administrator fixed its address', async () => {
    const key = await makeKey();
    const fixed = `late.${Date.now()}@acme.example`;
    const claimed = `claimed.${Date.now()}@acme.example`;
    const session = await createSession(key.client, {
      interviewers: [
        { name: 'Late Joiner', email: fixed },
        { name: 'Claimed Address', email: claimed },
      ],
    });
    expect(session.participants.every((p) => p.accountLinked === false)).toBe(true);

    const accept = async (invite: Record<string, unknown>, extra: Record<string, unknown>) => {
      const invitation = await fx.admin.ok(
        fx.admin.post<{ invitation: { id: string }; url: string }>('/api/invitations', invite),
      );
      const agent = new Agent(fx.server);
      const accepted = await agent.post<{ csrfToken: string; user: { id: string } }>(
        '/api/invitations/accept',
        {
          invitationId: invitation.invitation.id,
          secret: new URL(invitation.url).hash.slice(1),
          displayName: 'New Person',
          password: 'A-long-password-for-tests-1!',
          ...extra,
        },
      );
      expect(accepted.status, accepted.text).toBe(201);
      agent.csrfToken = accepted.body.csrfToken;
      return agent;
    };

    // An invitation issued for the interviewer's address: the document is there at once.
    const late = await accept({ email: fixed, role: 'member' }, {});
    const entry = (await listOf(late)).find((document) => document.id === session.documentId);
    expect(entry?.access.role).toBe('editor');
    expect(entry?.interview?.sessionId).toBe(session.sessionId);

    // An invitation without an address, and a person who types in an interviewer's address:
    // the server cannot know it is theirs, so nothing is linked, now or by a later session.
    const claimer = await accept({ role: 'member' }, { email: claimed });
    expect(await listOf(claimer)).toEqual([]);
    const again = await createSession(key.client, {
      interviewers: [{ name: 'Claimed Address', email: claimed }],
    });
    expect(again.participants.every((p) => p.accountLinked === false)).toBe(true);
    expect(await listOf(claimer)).toEqual([]);
  });

  it('never links the candidate, and not a disabled account', async () => {
    const key = await makeKey();
    const cara = await fx.createUser('Cara Candidate');
    const dan = await fx.createUser('Dan Disabled');
    await fx.admin.ok(fx.admin.patch(`/api/users/${dan.userId}`, { status: 'disabled' }));
    const session = await createSession(key.client, {
      candidate: { name: 'Cara Candidate', email: cara.email },
      interviewers: [{ name: 'Dan Disabled', email: dan.email }],
    });
    expect(session.participants.every((p) => p.accountLinked === false)).toBe(true);
    expect(await listOf(cara)).toEqual([]);
    const members = await fx.server.sql<{ count: string }>(
      'SELECT count(*) AS count FROM document_members WHERE document_id = $1',
      [session.documentId],
    );
    expect(Number(members[0]?.count)).toBe(0);
  });
});
