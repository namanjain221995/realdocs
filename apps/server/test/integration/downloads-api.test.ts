/**
 * GET /api/downloads: metadata of the published desktop builds. Only allow-listed files that
 * exist are listed, with size, lower-case SHA-256 and modification time; the hash is cached by
 * path, size and modification time; `release.json` is validated and never trusted blindly.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DownloadsResponse } from '@realtimedocs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestServer } from './harness';

const FILE = 'realtimedocs-windows-x64.zip';
const OTHER = 'realtimedocs-macos-arm64.zip';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

let unset: TestServer;
let server: TestServer;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'rd-downloads-api-'));
  unset = await TestServer.create('downloads-unset', { port: 4411 });
  server = await TestServer.create('downloads-api', { port: 4412, env: { DOWNLOAD_DIR: dir } });
  await Promise.all([unset.start(), server.start()]);
}, 120_000);

afterAll(async () => {
  await Promise.all([unset?.dispose(), server?.dispose()]);
  rmSync(dir, { recursive: true, force: true });
});

async function list(target: TestServer = server) {
  const response = await fetch(`${target.origin}/api/downloads`);
  return { response, body: DownloadsResponse.parse(await response.json()) };
}

function clean() {
  for (const name of [FILE, OTHER, 'release.json', 'secret.zip', 'realtimedocs-linux-x64.zip']) {
    rmSync(path.join(dir, name), { force: true });
  }
}

describe('GET /api/downloads', () => {
  it('is empty when DOWNLOAD_DIR is not configured', async () => {
    const { response, body } = await list(unset);
    expect(response.status).toBe(200);
    expect(body).toEqual({ release: null, artifacts: [] });
  });

  it('is empty for an empty directory, public, and never cached', async () => {
    clean();
    const { response, body } = await list();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({ release: null, artifacts: [] });
  });

  it('describes a published file with its real size and SHA-256', async () => {
    clean();
    const bytes = Buffer.from('PK\u0003\u0004 some archive bytes '.repeat(1000));
    writeFileSync(path.join(dir, FILE), bytes);
    const { body } = await list();
    expect(body.release).toBeNull();
    expect(body.artifacts).toEqual([
      {
        file: FILE,
        platform: 'windows',
        arch: 'x64',
        bytes: bytes.byteLength,
        sha256: sha(bytes),
        modifiedAt: statSync(path.join(dir, FILE)).mtime.toISOString(),
        url: `/download/${FILE}`,
      },
    ]);
    expect(body.artifacts[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The listed URL is really downloadable and identical to the hashed bytes.
    const download = await fetch(`${server.origin}${body.artifacts[0]?.url}`);
    expect(sha(Buffer.from(await download.arrayBuffer()))).toBe(body.artifacts[0]?.sha256);
  });

  it('never lists a file that is not on the allow-list, nor a directory with an allowed name', async () => {
    clean();
    writeFileSync(path.join(dir, 'secret.zip'), 'x');
    writeFileSync(path.join(dir, 'realtimedocs-linux-x64.zip'), 'x');
    mkdirSync(path.join(dir, OTHER), { recursive: true });
    const { body } = await list();
    expect(body.artifacts).toEqual([]);
    rmSync(path.join(dir, OTHER), { recursive: true, force: true });
  });

  it('reads a valid release.json and never decides that a build is signed', async () => {
    clean();
    writeFileSync(path.join(dir, FILE), 'a');
    writeFileSync(
      path.join(dir, 'release.json'),
      JSON.stringify({ version: '1.2.3', notes: 'First public build', signed: false }),
    );
    expect((await list()).body.release).toEqual({
      version: '1.2.3',
      notes: 'First public build',
      signed: false,
    });
    // A field the operator left out is unknown, never "signed".
    writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ version: '2.0.0' }));
    expect((await list()).body.release).toEqual({ version: '2.0.0', notes: null, signed: null });
  });

  it('answers release null and logs a warning for an invalid release.json', async () => {
    clean();
    writeFileSync(path.join(dir, FILE), 'a');
    writeFileSync(path.join(dir, 'release.json'), '{ not json');
    let result = await list();
    expect(result.body.release).toBeNull();
    expect(result.body.artifacts).toHaveLength(1);
    writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ version: 3, signed: 'yes' }));
    result = await list();
    expect(result.body.release).toBeNull();
    expect(result.body.artifacts).toHaveLength(1);
    expect(server.log()).toMatch(/release\.json is not valid JSON; release ignored/);
    expect(server.log()).toMatch(/release\.json does not have the expected shape; release ignored/);
  });

  it('hashes again only when size or modification time changed', async () => {
    clean();
    const file = path.join(dir, FILE);
    const first = Buffer.from('AAAAAAAAAA');
    writeFileSync(file, first);
    const stamp = new Date('2026-01-01T00:00:00Z');
    utimesSync(file, stamp, stamp);
    expect((await list()).body.artifacts[0]?.sha256).toBe(sha(first));

    // Same size and same modification time: the cached hash is served (proof that it is cached).
    const sameShape = Buffer.from('BBBBBBBBBB');
    writeFileSync(file, sameShape);
    utimesSync(file, stamp, stamp);
    expect((await list()).body.artifacts[0]?.sha256).toBe(sha(first));

    // A new modification time: recomputed.
    const later = new Date('2026-02-02T00:00:00Z');
    utimesSync(file, later, later);
    let entry = (await list()).body.artifacts[0];
    expect(entry?.sha256).toBe(sha(sameShape));
    expect(entry?.modifiedAt).toBe(later.toISOString());

    // A new size: recomputed, even with the same modification time.
    const longer = Buffer.from('CCCCCCCCCCCCCCCC');
    writeFileSync(file, longer);
    utimesSync(file, later, later);
    entry = (await list()).body.artifacts[0];
    expect(entry).toMatchObject({ sha256: sha(longer), bytes: longer.byteLength });
  });
});
