/** Uploads, downloads, exports and duplicates. The server runs with small limits to hit them. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { collectAssetIds } from '@realtimedocs/editor/export';
import { getDocumentSchema, type DocJSON } from '@realtimedocs/editor/schema';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  Agent,
  connectCollab,
  createFixture,
  makePng,
  makePngHeaderOnly,
  type AssetBody,
  type DocumentBody,
  type Fixture,
} from './harness';

let fx: Fixture;
let editor: Awaited<ReturnType<Fixture['createUser']>>;
let viewer: Awaited<ReturnType<Fixture['createUser']>>;

const KIB = 1024;
const LIMITS = {
  LIMIT_MAX_IMAGE_BYTES: String(64 * KIB),
  LIMIT_MAX_ATTACHMENT_BYTES: String(128 * KIB),
  LIMIT_MAX_SVG_BYTES: String(16 * KIB),
  LIMIT_MAX_IMAGE_DIMENSION: '2000',
  LIMIT_MAX_IMAGE_PIXELS: '2000000',
  LIMIT_DOCUMENT_ASSET_QUOTA_BYTES: String(200 * KIB),
};

const text = (value: string) => Buffer.from(value, 'utf8');
const SVG_OK = text(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#2563eb"/><circle cx="60" cy="40" r="20" fill="#fff"/></svg>',
);

function allFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(full) : [full];
  });
}

async function newDocument(title: string): Promise<string> {
  const documentId = await fx.createDocument(title);
  await fx.admin.ok(
    fx.admin.put(`/api/documents/${documentId}/members/${editor.userId}`, { role: 'editor' }),
  );
  await fx.admin.ok(
    fx.admin.put(`/api/documents/${documentId}/members/${viewer.userId}`, { role: 'viewer' }),
  );
  return documentId;
}

/** Inserts an image or attachment node that references an uploaded asset. */
function insertAssetNode(
  client: Awaited<ReturnType<typeof connectCollab>>,
  type: 'image' | 'attachment',
  asset: AssetBody,
): void {
  client.edit(() => {
    const node = new Y.XmlElement(type);
    node.setAttribute('assetId', asset.id);
    node.setAttribute('name', asset.name);
    if (type === 'image') node.setAttribute('alt', `alt of ${asset.name}`);
    client.fragment.push([node]);
  });
}

beforeAll(async () => {
  fx = await createFixture('assets', { env: LIMITS });
  editor = await fx.createUser('Uma Uploader');
  viewer = await fx.createUser('Val Viewer');
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
});

describe('uploading', () => {
  it('accepts a valid image and serves it only to authorized principals', async () => {
    const documentId = await newDocument('Images');
    const otherDocument = await newDocument('Other images');
    const png = makePng(320, 200);
    const uploaded = await editor.upload(documentId, png, 'Team photo.PNG', {
      contentType: 'text/html',
    });
    expect(uploaded.status).toBe(201);
    const asset = uploaded.body.asset;
    // Type and dimensions come from the bytes, not from the declared content type.
    expect(asset).toMatchObject({
      documentId,
      kind: 'image',
      name: 'Team photo.PNG',
      mime: 'image/png',
      sizeBytes: png.length,
      width: 320,
      height: 200,
    });

    const url = `/api/documents/${documentId}/assets/${asset.id}`;
    const download = await viewer.get(url);
    expect(download.status).toBe(200);
    expect(download.bytes.equals(png)).toBe(true);
    expect(download.headers.get('content-type')).toBe('image/png');
    expect(download.headers.get('content-length')).toBe(String(png.length));
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(download.headers.get('cache-control')).toBe('private, no-cache');
    expect(download.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(download.headers.get('content-disposition')).toBe(
      'inline; filename="Team photo.PNG"; filename*=UTF-8\'\'Team%20photo.PNG',
    );
    const etag = download.headers.get('etag') ?? '';
    expect(etag).toBe(`"${createHash('sha256').update(png).digest('hex').slice(0, 40)}"`);

    // Revalidation: 304 only for someone who may still read it.
    const cached = await viewer.get(url, { headers: { 'if-none-match': etag } });
    expect(cached.status).toBe(304);
    expect(cached.bytes).toHaveLength(0);
    expect((await viewer.get(url, { headers: { 'if-none-match': '"other"' } })).status).toBe(200);
    const forced = await viewer.get(`${url}?download=1`);
    expect(forced.headers.get('content-type')).toBe('application/octet-stream');
    expect(forced.headers.get('content-disposition')).toMatch(/^attachment;/);

    // Not without a session, not for outsiders, not under another document.
    const outsider = await fx.createUser('Otto Outsider');
    expect((await new Agent(fx.server).get(url)).status).toBe(401);
    expect((await outsider.get(url)).status).toBe(404);
    expect((await outsider.get(url, { headers: { 'if-none-match': etag } })).status).toBe(404);
    expect((await editor.get(`/api/documents/${otherDocument}/assets/${asset.id}`)).status).toBe(
      404,
    );
    expect((await fx.admin.get(`/api/documents/${documentId}/assets/${randomUUID()}`)).status).toBe(
      404,
    );
    expect((await fx.admin.get(`/api/documents/${documentId}/assets/not-a-uuid`)).status).toBe(404);

    // Stored under a random key inside the private volume, never under the file name.
    const [row] = await fx.server.sql<{ key: string; sha: Buffer; status: string }>(
      'SELECT storage_key AS key, sha256 AS sha, status FROM assets WHERE id = $1',
      [asset.id],
    );
    expect(row?.key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{40}$/);
    expect(row?.status).toBe('ready');
    expect(row?.sha.equals(createHash('sha256').update(png).digest())).toBe(true);
    const stored = path.join(fx.server.assetDir, 'objects', row?.key ?? '');
    expect(readFileSync(stored).equals(png)).toBe(true);
    expect(statSync(stored).mode & 0o077).toBe(0);
  });

  it('refuses uploads from viewers, guests with view links and unauthenticated clients', async () => {
    const documentId = await newDocument('No upload');
    const before = allFiles(fx.server.assetDir).length;
    const asViewer = await viewer.upload(documentId, makePng(10, 10), 'x.png');
    expect([asViewer.status, asViewer.code]).toEqual([403, 'forbidden']);
    const share = await fx.createShare(documentId);
    const guest = await fx.guest(share.id, share.secret);
    expect((await guest.upload(documentId, makePng(10, 10), 'x.png')).status).toBe(403);
    expect((await new Agent(fx.server).upload(documentId, makePng(10, 10), 'x.png')).status).toBe(
      401,
    );
    const outsider = await fx.createUser('Olga Outsider');
    expect((await outsider.upload(documentId, makePng(10, 10), 'x.png')).status).toBe(404);
    // A guest with an edit link may upload.
    const editShare = await fx.createShare(documentId, { role: 'editor' });
    const editGuest = await fx.guest(editShare.id, editShare.secret);
    expect((await editGuest.upload(documentId, makePng(10, 10), 'ok.png')).status).toBe(201);
    expect(
      await fx.server.sql('SELECT 1 FROM assets WHERE document_id = $1', [documentId]),
    ).toHaveLength(1);
    expect(allFiles(fx.server.assetDir).length).toBe(before + 1);
    // Archived documents are read-only for everyone, administrators included.
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/archive`));
    const archived = await fx.admin.upload(documentId, makePng(10, 10), 'x.png');
    expect([archived.status, archived.code]).toEqual([403, 'forbidden']);
  });

  it('enforces size limits with a hard cut-off', async () => {
    const documentId = await newDocument('Sizes');
    const before = allFiles(fx.server.assetDir).length;
    // Larger than any upload limit: cut off while streaming.
    const huge = await editor.upload(documentId, Buffer.alloc(400 * KIB, 0x61), 'huge.txt');
    expect([huge.status, huge.code]).toEqual([413, 'payload_too_large']);
    expect((huge.body as unknown as { error: { reason: string } }).error.reason).toBe('too_large');
    // A real image above the image limit but below the attachment limit.
    const bigImage = makePng(200, 200, { noise: true });
    expect(bigImage.length).toBeGreaterThan(64 * KIB);
    expect(bigImage.length).toBeLessThan(128 * KIB);
    const tooBig = await editor.upload(documentId, bigImage, 'big.png');
    expect([tooBig.status, tooBig.code]).toEqual([413, 'payload_too_large']);
    // An attachment above the attachment limit.
    const bigText = await editor.upload(documentId, Buffer.alloc(129 * KIB, 0x62), 'notes.txt');
    expect(bigText.status).toBe(413);
    // Exactly at a limit is fine.
    const atLimit = await editor.upload(documentId, Buffer.alloc(100 * KIB, 0x63), 'limit.txt');
    expect(atLimit.status).toBe(201);
    const empty = await editor.upload(documentId, Buffer.alloc(0), 'empty.txt');
    expect([empty.status, empty.code]).toEqual([422, 'upload_rejected']);
    expect((empty.body as unknown as { error: { reason: string } }).error.reason).toBe('empty');

    // Rejected uploads leave nothing behind: one stored object, no staging files.
    expect(allFiles(fx.server.assetDir).length).toBe(before + 1);
    expect(allFiles(path.join(fx.server.assetDir, 'tmp'))).toEqual([]);
    expect(
      await fx.server.sql('SELECT 1 FROM assets WHERE document_id = $1', [documentId]),
    ).toHaveLength(1);
  });

  it('decides the type from the bytes and rejects mismatches', async () => {
    const documentId = await newDocument('Sniffing');
    const reasonOf = (result: { body: unknown }) =>
      (result.body as { error?: { reason?: string } }).error?.reason;
    const cases: [string, Buffer, string, number, string | undefined][] = [
      ['text named .png', text('this is not an image'), 'photo.png', 422, 'content_mismatch'],
      [
        'html named .jpg',
        text('<html><script>alert(1)</script></html>'),
        'x.jpg',
        422,
        'content_mismatch',
      ],
      [
        'executable',
        Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]),
        'setup.exe',
        422,
        'type_not_allowed',
      ],
      [
        'html page',
        text('<html><script>alert(1)</script></html>'),
        'page.html',
        422,
        'type_not_allowed',
      ],
      ['shell script', text('#!/bin/sh\nrm -rf /\n'), 'run.sh', 422, 'type_not_allowed'],
      ['no extension', text('hello'), 'README', 422, 'type_not_allowed'],
      ['fake pdf', text('<script>alert(1)</script>'), 'invoice.pdf', 422, 'content_mismatch'],
      ['fake docx', text('plain text, not a zip'), 'letter.docx', 422, 'content_mismatch'],
      [
        'binary named .txt',
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]),
        'notes.txt',
        422,
        'content_mismatch',
      ],
      ['truncated png', makePng(50, 50).subarray(0, 20), 'cut.png', 422, 'content_mismatch'],
      [
        'dimension bomb',
        makePngHeaderOnly(30_000, 30_000),
        'bomb.png',
        422,
        'dimensions_too_large',
      ],
      ['too many pixels', makePngHeaderOnly(1999, 1999), 'wide.png', 422, 'dimensions_too_large'],
      ['unusable name', text('hello'), '...', 422, 'bad_filename'],
    ];
    for (const [label, content, name, status, reason] of cases) {
      const result = await editor.upload(documentId, content, name);
      expect([label, result.status, reasonOf(result)]).toEqual([label, status, reason]);
    }
    expect(
      await fx.server.sql('SELECT 1 FROM assets WHERE document_id = $1', [documentId]),
    ).toHaveLength(0);

    // Images are recognised whatever they are called; the name is corrected.
    const disguised = await editor.upload(documentId, makePng(20, 10), 'report.pdf');
    expect(disguised.body.asset).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      name: 'report.png',
    });
    const gif = Buffer.concat([
      text('GIF89a'),
      Buffer.from([16, 0, 8, 0, 0, 0, 0]),
      Buffer.from([0x3b]),
    ]);
    const asGif = await editor.upload(documentId, gif, 'anim');
    expect(asGif.body.asset).toMatchObject({
      kind: 'image',
      mime: 'image/gif',
      name: 'anim.gif',
      width: 16,
      height: 8,
    });

    // Allowed attachments are stored and only ever served as downloads.
    const pdf = text('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const attached = await editor.upload(documentId, pdf, 'Quarterly report.pdf');
    expect(attached.body.asset).toMatchObject({
      kind: 'attachment',
      mime: 'application/octet-stream',
      name: 'Quarterly report.pdf',
      width: null,
    });
    // HTML disguised as text is accepted as an attachment — and can never render.
    const sneaky = await editor.upload(
      documentId,
      text('<script>alert(document.cookie)</script>'),
      'x.txt',
    );
    expect(sneaky.status).toBe(201);
    for (const asset of [attached.body.asset, sneaky.body.asset]) {
      const served = await viewer.get(`/api/documents/${documentId}/assets/${asset.id}`);
      expect(served.headers.get('content-type')).toBe('application/octet-stream');
      expect(served.headers.get('content-disposition')).toMatch(/^attachment; filename="/);
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      expect(served.headers.get('content-security-policy')).toContain('sandbox');
    }
  });

  it('accepts only SVG that passes strict validation', async () => {
    const documentId = await newDocument('SVG');
    const good = await editor.upload(documentId, SVG_OK, 'logo.svg');
    expect(good.status).toBe(201);
    expect(good.body.asset).toMatchObject({
      kind: 'image',
      mime: 'image/svg+xml',
      width: 120,
      height: 80,
    });
    const served = await viewer.get(`/api/documents/${documentId}/assets/${good.body.asset.id}`);
    expect(served.headers.get('content-type')).toBe('image/svg+xml');
    expect(served.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(served.bytes.equals(SVG_OK)).toBe(true);

    const ns = 'xmlns="http://www.w3.org/2000/svg"';
    const malicious: [string, string][] = [
      ['script', `<svg ${ns}><script>fetch('/api/users')</script></svg>`],
      ['event handler', `<svg ${ns} onload="alert(1)"><rect width="1" height="1"/></svg>`],
      [
        'foreignObject',
        `<svg ${ns}><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"/></foreignObject></svg>`,
      ],
      ['external image', `<svg ${ns}><image href="https://attacker.example/track.png"/></svg>`],
      ['external use', `<svg ${ns}><use href="https://attacker.example/x.svg#a"/></svg>`],
      [
        'css import',
        `<svg ${ns}><style>@import url(https://attacker.example/x.css);</style></svg>`,
      ],
      [
        'entity expansion',
        `<!DOCTYPE svg [<!ENTITY x "xxxxxxxxxx">]><svg ${ns}><text>&x;</text></svg>`,
      ],
      [
        'animation',
        `<svg ${ns}><a><animate attributeName="href" to="javascript:alert(1)"/></a></svg>`,
      ],
    ];
    for (const [label, source] of malicious) {
      const result = await editor.upload(documentId, text(source), 'evil.svg');
      expect([label, result.status, result.code]).toEqual([label, 422, 'upload_rejected']);
      const error = (result.body as unknown as { error: { reason: string; message: string } })
        .error;
      expect([label, error.reason]).toEqual([label, 'active_content']);
      // The same content under an image name it is not, or an attachment name, is refused too.
      expect((await editor.upload(documentId, text(source), 'evil.png')).status).toBe(422);
      expect((await editor.upload(documentId, text(source), 'evil.txt')).status).toBe(422);
    }
    const tooBig = await editor.upload(
      documentId,
      text(`<svg ${ns}>${'<rect width="1" height="1"/>'.repeat(1000)}</svg>`),
      'big.svg',
    );
    expect(tooBig.status).toBe(413);
    expect(
      await fx.server.sql('SELECT 1 FROM assets WHERE document_id = $1', [documentId]),
    ).toHaveLength(1);
    const audit = await fx.admin.get('/api/audit?limit=200');
    expect(audit.text).toContain('asset.rejected_active_content');
  });

  it('neutralises hostile file names', async () => {
    const documentId = await newDocument('Names');
    const filesBefore = new Set(allFiles(fx.server.assetDir));
    const cases: [string, string][] = [
      ['../../../etc/passwd.png', 'passwd.png'],
      ['..\\..\\windows\\system32\\evil.png', 'evil.png'],
      ['/absolute/secret.png', 'secret.png'],
      ['....//....//x.png', 'x.png'],
      [
        `inva${String.fromCodePoint(0)}lid${String.fromCodePoint(0x202e)}gnp.exe.png`,
        'invalidgnp.exe.png',
      ],
      ['CON.png', '_CON.png'],
      ['a<b>:c|d?.png', 'a_b__c_d_.png'],
      ['.hidden.png', 'hidden.png'],
      [`${'long'.repeat(100)}.png`, `${'long'.repeat(100).slice(0, 116)}.png`],
    ];
    for (const [given, expected] of cases) {
      const result = await editor.upload(documentId, makePng(4, 4), given);
      expect([given, result.status, result.body.asset?.name]).toEqual([given, 201, expected]);
      const served = await viewer.get(
        `/api/documents/${documentId}/assets/${result.body.asset.id}`,
      );
      expect(served.headers.get('content-disposition')).not.toMatch(/[\r\n\\/]|\.\./);
    }
    // Every new file sits under objects/<2 hex>/<2 hex>/<40 hex>; nothing was written elsewhere.
    const created = allFiles(fx.server.assetDir).filter((file) => !filesBefore.has(file));
    expect(created).toHaveLength(cases.length);
    for (const file of created) {
      expect(path.relative(path.join(fx.server.assetDir, 'objects'), file)).toMatch(
        /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{40}$/,
      );
    }
    expect(existsSync(path.join(fx.server.assetDir, '..', 'etc'))).toBe(false);
    expect(
      allFiles(path.dirname(fx.server.assetDir)).some((file) => /passwd|evil|secret/.test(file)),
    ).toBe(false);
  });

  it('enforces the per-document quota', async () => {
    const documentId = await newDocument('Quota');
    const other = await newDocument('Quota neighbour');
    const chunk = Buffer.alloc(90 * KIB, 0x71);
    expect((await editor.upload(documentId, chunk, 'one.txt')).status).toBe(201);
    expect((await editor.upload(documentId, chunk, 'two.txt')).status).toBe(201);
    const over = await editor.upload(documentId, chunk, 'three.txt');
    expect([over.status, over.code]).toEqual([413, 'quota_exceeded']);
    expect((over.body as unknown as { error: { message: string } }).error.message).toMatch(
      /storage/,
    );
    // Concurrent uploads cannot slip past the limit together.
    const small = Buffer.alloc(8 * KIB, 0x72);
    const burst = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        editor.upload(documentId, small, `burst-${index}.txt`),
      ),
    );
    expect(burst.filter((result) => result.status === 201)).toHaveLength(2);
    expect(burst.filter((result) => result.code === 'quota_exceeded')).toHaveLength(4);
    const [usage] = await fx.server.sql<{ used: string }>(
      'SELECT sum(size_bytes) AS used FROM assets WHERE document_id = $1',
      [documentId],
    );
    expect(Number(usage?.used)).toBeLessThanOrEqual(200 * KIB);
    // The quota is per document.
    expect((await editor.upload(other, chunk, 'fine.txt')).status).toBe(201);
  });

  it('rejects malformed upload requests', async () => {
    const documentId = await newDocument('Malformed uploads');
    const notMultipart = await editor.post(`/api/documents/${documentId}/assets`, { file: 'x' });
    expect([notMultipart.status, notMultipart.code]).toEqual([415, 'unsupported_media_type']);
    const wrongField = await editor.upload(documentId, makePng(4, 4), 'x.png', {
      field: 'attachment',
    });
    expect([wrongField.status, wrongField.code]).toEqual([400, 'validation_failed']);
    const noCsrf = await editor.request('POST', `/api/documents/${documentId}/assets`, {
      raw: { content: 'x', contentType: 'multipart/form-data; boundary=x' },
      csrf: null,
    });
    expect(noCsrf.code).toBe('csrf_failed');
    expect(
      await fx.server.sql('SELECT 1 FROM assets WHERE document_id = $1', [documentId]),
    ).toHaveLength(0);
  });
});

describe('exports', () => {
  it('exports text, Markdown, JSON and a zip with the assets of this document only', async () => {
    const documentId = await newDocument('Export "me" / please?');
    const client = await connectCollab(editor, documentId);
    client.deleteBlock(0);
    client.appendParagraph('First paragraph with *asterisks*.');
    const image = (await editor.upload(documentId, makePng(64, 48), 'diagram.png')).body.asset;
    const twin = (await editor.upload(documentId, makePng(32, 32), 'diagram.png')).body.asset;
    const file = (await editor.upload(documentId, text('a,b\n1,2\n'), 'data.csv')).body.asset;
    const unreferenced = (await editor.upload(documentId, makePng(8, 8), 'unused.png')).body.asset;
    const foreignDocument = await newDocument('Foreign');
    const foreign = (await editor.upload(foreignDocument, makePng(9, 9), 'foreign.png')).body.asset;
    insertAssetNode(client, 'image', image);
    insertAssetNode(client, 'image', twin);
    insertAssetNode(client, 'attachment', file);
    // A node that points at an asset of another document must not pull it into the export.
    insertAssetNode(client, 'image', foreign);
    await client.save();

    const txt = await viewer.get(`/api/documents/${documentId}/export?format=txt`);
    expect(txt.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(txt.headers.get('content-disposition')).toContain(
      'filename="Export _me_ _ please_.txt"',
    );
    expect(txt.text).toBe(
      [
        'First paragraph with *asterisks*.',
        '',
        '[Image: alt of diagram.png]',
        '',
        '[Image: alt of diagram.png]',
        '',
        '[Attachment: data.csv]',
        '',
        '[Image: alt of foreign.png]',
        '',
      ].join('\n'),
    );

    const md = await viewer.get(`/api/documents/${documentId}/export?format=md`);
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(md.text).toBe(
      [
        'First paragraph with \\*asterisks\\*.',
        '',
        '![alt of diagram.png](assets/diagram.png)',
        '',
        '![alt of diagram.png](assets/diagram-2.png)',
        '',
        '[data.csv](assets/data.csv)',
        '',
        '*\\[image: alt of foreign.png\\]*',
        '',
      ].join('\n'),
    );

    const json = await viewer.get<DocJSON>(`/api/documents/${documentId}/export?format=json`);
    expect(json.headers.get('content-type')).toContain('application/json');
    // Every export format is a download, JSON included.
    expect(json.headers.get('content-disposition')).toContain(
      'attachment; filename="Export _me_ _ please_.json"',
    );
    expect(md.headers.get('content-disposition')).toMatch(
      /^attachment; filename="Export _me_ _ please_\.md"/,
    );
    expect(json.body.type).toBe('doc');
    expect(collectAssetIds(json.body)).toEqual([image.id, twin.id, file.id, foreign.id]);

    const zip = await viewer.get(`/api/documents/${documentId}/export?format=md-zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect(zip.headers.get('content-disposition')).toMatch(
      /^attachment; filename="Export _me_ _ please_\.zip"/,
    );
    const entries = unzipSync(new Uint8Array(zip.bytes));
    expect(Object.keys(entries).sort()).toEqual([
      'assets/data.csv',
      'assets/diagram-2.png',
      'assets/diagram.png',
      'document.md',
    ]);
    expect(strFromU8(entries['document.md'] ?? new Uint8Array())).toBe(md.text);
    const originals = await Promise.all(
      [image, twin, file].map((asset) =>
        viewer.get(`/api/documents/${documentId}/assets/${asset.id}`),
      ),
    );
    expect(Buffer.from(entries['assets/diagram.png'] ?? []).equals(originals[0]!.bytes)).toBe(true);
    expect(Buffer.from(entries['assets/diagram-2.png'] ?? []).equals(originals[1]!.bytes)).toBe(
      true,
    );
    expect(strFromU8(entries['assets/data.csv'] ?? new Uint8Array())).toBe('a,b\n1,2\n');
    expect(JSON.stringify(Object.keys(entries))).not.toContain('foreign');
    expect(unreferenced.id).not.toBe(image.id);

    expect((await viewer.get(`/api/documents/${documentId}/export?format=docx`)).code).toBe(
      'validation_failed',
    );
    expect((await viewer.get(`/api/documents/${documentId}/export`)).code).toBe(
      'validation_failed',
    );
    expect(
      (await new Agent(fx.server).get(`/api/documents/${documentId}/export?format=txt`)).status,
    ).toBe(401);
    client.destroy();
  });

  it('exports what collaborators see right now, and the stored state when nobody is connected', async () => {
    const documentId = await newDocument('Live export');
    const client = await connectCollab(editor, documentId);
    client.appendParagraph('visible immediately');
    await client.save();
    expect((await viewer.get(`/api/documents/${documentId}/export?format=txt`)).text).toContain(
      'visible immediately',
    );
    client.destroy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await viewer.get(`/api/documents/${documentId}/export?format=txt`)).text).toBe(
      'visible immediately\n',
    );
  });
});

describe('duplicating a document', () => {
  it('copies content and assets, rewrites asset ids and keeps the copy independent', async () => {
    const documentId = await newDocument('Original');
    const client = await connectCollab(editor, documentId);
    client.appendParagraph('text to be copied');
    const image = (await editor.upload(documentId, makePng(40, 30), 'figure.png')).body.asset;
    const attachment = (await editor.upload(documentId, text('hello'), 'hello.txt')).body.asset;
    const unused = (await editor.upload(documentId, makePng(5, 5), 'unused.png')).body.asset;
    insertAssetNode(client, 'image', image);
    insertAssetNode(client, 'attachment', attachment);
    await client.save();
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/shares`, {}));
    await fx.admin.ok(
      fx.admin.post(`/api/documents/${documentId}/snapshots`, { name: 'before copy' }),
    );

    expect((await editor.post(`/api/documents/${documentId}/duplicate`)).status).toBe(403);
    const duplicated = await fx.admin.post<DocumentBody>(`/api/documents/${documentId}/duplicate`);
    expect(duplicated.status).toBe(201);
    const copyId = duplicated.body.document.id;
    expect(copyId).not.toBe(documentId);
    expect(duplicated.body.document).toMatchObject({
      title: 'Copy of Original',
      generation: 1,
      status: 'active',
    });

    const original = await fx.admin.get<DocJSON>(`/api/documents/${documentId}/export?format=json`);
    const copy = await fx.admin.get<DocJSON>(`/api/documents/${copyId}/export?format=json`);
    const originalIds = collectAssetIds(original.body);
    const copyIds = collectAssetIds(copy.body);
    expect(originalIds).toEqual([image.id, attachment.id]);
    expect(copyIds).toHaveLength(2);
    // Same content, entirely new asset ids.
    expect(copyIds.filter((id) => originalIds.includes(id))).toEqual([]);
    const schema = getDocumentSchema();
    const normalised = (json: DocJSON) =>
      JSON.stringify(schema.nodeFromJSON(json).toJSON()).replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        'ID',
      );
    expect(normalised(copy.body)).toBe(normalised(original.body));
    expect(JSON.stringify(copy.body)).toContain('text to be copied');

    // The copied assets are served under the copy and hold identical bytes in separate files.
    for (const [index, id] of copyIds.entries()) {
      const copied = await fx.admin.get(`/api/documents/${copyId}/assets/${id}`);
      const source = await fx.admin.get(
        `/api/documents/${documentId}/assets/${originalIds[index]}`,
      );
      expect(copied.status).toBe(200);
      expect(copied.bytes.equals(source.bytes)).toBe(true);
      expect((await fx.admin.get(`/api/documents/${documentId}/assets/${id}`)).status).toBe(404);
      expect(
        (await fx.admin.get(`/api/documents/${copyId}/assets/${originalIds[index]}`)).status,
      ).toBe(404);
    }
    const keys = await fx.server.sql<{ documentId: string; key: string; name: string }>(
      `SELECT document_id AS "documentId", storage_key AS key, name FROM assets
        WHERE document_id = ANY($1::uuid[]) ORDER BY name`,
      [[documentId, copyId]],
    );
    expect(new Set(keys.map((row) => row.key)).size).toBe(keys.length);
    // Only referenced assets are copied; the unused upload stays with the original.
    expect(keys.filter((row) => row.documentId === copyId).map((row) => row.name)).toEqual([
      'figure.png',
      'hello.txt',
    ]);
    expect(unused.name).toBe('unused.png');

    // Permissions, links and snapshots are not copied.
    expect((await editor.get(`/api/documents/${copyId}`)).status).toBe(404);
    const access = await fx.admin.get<{ members: unknown[]; shares: unknown[] }>(
      `/api/documents/${copyId}/access`,
    );
    expect(access.body).toMatchObject({ members: [], shares: [] });
    const snapshots = await fx.admin.get<{ snapshots: unknown[] }>(
      `/api/documents/${copyId}/snapshots`,
    );
    expect(snapshots.body.snapshots).toEqual([]);
    // A new Yjs history: nothing of the original's edit history is shared.
    const [copyState] = await fx.server.sql<{ state: Buffer }>(
      'SELECT state FROM doc_states WHERE document_id = $1',
      [copyId],
    );
    const copyDoc = new Y.Doc();
    Y.applyUpdate(copyDoc, copyState?.state ?? new Uint8Array());
    const sourceClients = new Set(Y.decodeStateVector(Y.encodeStateVector(client.doc)).keys());
    expect(
      [...Y.decodeStateVector(Y.encodeStateVector(copyDoc)).keys()].filter((id) =>
        sourceClients.has(id),
      ),
    ).toEqual([]);

    // Independent afterwards: editing or deleting the original does not affect the copy.
    client.appendParagraph('only in the original');
    await client.save();
    client.destroy();
    await fx.admin.ok(fx.admin.post(`/api/documents/${documentId}/trash`));
    expect((await fx.admin.delete(`/api/documents/${documentId}`)).status).toBe(204);
    const afterDelete = await fx.admin.get(`/api/documents/${copyId}/export?format=txt`);
    expect(afterDelete.text).toContain('text to be copied');
    expect(afterDelete.text).not.toContain('only in the original');
    for (const id of copyIds) {
      expect((await fx.admin.get(`/api/documents/${copyId}/assets/${id}`)).status).toBe(200);
    }
    // The original's files are gone from the volume, the copy's remain.
    const remaining = allFiles(path.join(fx.server.assetDir, 'objects'));
    for (const row of keys) {
      const present = remaining.some((file) => file.endsWith(row.key));
      expect([row.name, present]).toEqual([row.name, row.documentId === copyId]);
    }
  });
});
