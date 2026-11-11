/**
 * Desktop download endpoint: only the allow-listed names are served, only from
 * the configured directory, with no directory traversal, and a build that is
 * not present is a 404 (indistinguishable from an unknown name).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestServer } from './harness';

const PRESENT = 'realtimedocs-windows-x64.zip';
const ABSENT = 'realtimedocs-macos-arm64.zip';
const BODY = Buffer.from('PK\u0003\u0004 not a real archive, just bytes for the test');

let server: TestServer;
let downloadDir: string;

beforeAll(async () => {
  downloadDir = mkdtempSync(path.join(tmpdir(), 'rd-downloads-'));
  writeFileSync(path.join(downloadDir, PRESENT), BODY);
  server = await TestServer.create('download', { port: 4412, env: { DOWNLOAD_DIR: downloadDir } });
  await server.start();
});

afterAll(async () => {
  await server.dispose();
  rmSync(downloadDir, { recursive: true, force: true });
});

function fetchDownload(name: string, method = 'GET') {
  return fetch(`${server.origin}/download/${name}`, { method, redirect: 'manual' });
}

describe('GET/HEAD /download/:file', () => {
  it('serves a published build as an attachment with its length', async () => {
    const response = await fetchDownload(PRESENT);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-length')).toBe(String(BODY.byteLength));
    expect(response.headers.get('content-disposition')).toContain(`filename="${PRESENT}"`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer()).equals(BODY)).toBe(true);
  });

  it('answers HEAD with the size and no body', async () => {
    const response = await fetchDownload(PRESENT, 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(BODY.byteLength));
    expect((await response.text()).length).toBe(0);
  });

  it('returns 404 for an allow-listed name whose build is not published', async () => {
    const response = await fetchDownload(ABSENT);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('not_found');
    const head = await fetchDownload(ABSENT, 'HEAD');
    expect(head.status).toBe(404);
  });

  it('returns 404 for a name that is not on the allow-list', async () => {
    for (const name of ['realtimedocs-linux-x64.zip', 'secret.zip', 'index.html']) {
      expect((await fetchDownload(name)).status).toBe(404);
    }
  });

  it('does not allow directory traversal out of the download directory', async () => {
    for (const raw of ['..%2f..%2f.env', '..%2f..%2fpackage.json', '%2e%2e%2fsecret']) {
      const response = await fetch(`${server.origin}/download/${raw}`, { redirect: 'manual' });
      expect([raw, response.status]).toEqual([raw, 404]);
    }
  });
});
