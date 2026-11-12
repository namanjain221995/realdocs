import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareReleaseVersions } from '@realtimedocs/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateService, type UpdateServiceOptions } from '../../src/main/update-service';
import { ConnectionService } from '../../src/main/connection-service';
import { CH } from '../../src/shared/channels';
import {
  channelFor,
  isSafeArtifactName,
  panelUpdateView,
  resolveDownloadUrl,
  verifyDownload,
} from '../../src/shared/updates';

const ORIGIN = 'https://docs.example.com';
const BYTES = Buffer.from('pretend installer bytes '.repeat(50));
const SHA = createHash('sha256').update(BYTES).digest('hex');
const NAME = 'RealtimeDocs-1.2.0-linux-x64.tar.gz';
const PATH = `/download/releases/stable/1.2.0/${NAME}`;

describe('version comparison (shared with the server)', () => {
  it('orders releases and pre-releases', () => {
    expect(compareReleaseVersions('0.1.0', '0.1.1')).toBeLessThan(0);
    expect(compareReleaseVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareReleaseVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0);
    expect(compareReleaseVersions('1.2.0', '1.2.0')).toBe(0);
  });
  it('follows the beta channel only for beta builds', () => {
    expect(channelFor('1.2.0')).toBe('stable');
    expect(channelFor('1.2.0-beta.2')).toBe('beta');
    expect(channelFor('1.2.0-rc.1')).toBe('stable');
  });
});

describe('download URL allow-list', () => {
  const expected = { version: '1.2.0', fileName: NAME };
  it('accepts the announced path on the configured origin only', () => {
    expect(resolveDownloadUrl(ORIGIN, PATH, expected)?.href).toBe(`${ORIGIN}${PATH}`);
    expect(resolveDownloadUrl(ORIGIN, `${ORIGIN}${PATH}`, expected)).not.toBeNull();
  });
  it.each([
    ['another host', `https://evil.example.net${PATH}`],
    ['a lookalike host', `https://docs.example.com.evil.net${PATH}`],
    ['a scheme-relative URL', `//evil.example.net${PATH}`],
    ['credentials', `https://user:pw@docs.example.com${PATH}`],
    ['plain http for an https origin', `http://docs.example.com${PATH}`],
    ['a query string', `${PATH}?x=1`],
    ['a fragment', `${PATH}#x`],
    ['another path', `/api/meta`],
    ['traversal', `/download/releases/stable/1.2.0/../1.1.0/${NAME}`],
    ['another version', `/download/releases/stable/1.1.0/${NAME}`],
    ['another file', `/download/releases/stable/1.2.0/RealtimeDocs-1.2.0-linux-arm64.tar.gz`],
    ['a data URL', `data:text/plain,hi`],
  ])('rejects %s', (_label, url) => {
    expect(resolveDownloadUrl(ORIGIN, url, expected)).toBeNull();
  });
  it('rejects a file name the app would not write', () => {
    for (const bad of [
      '../x.exe',
      'setup.exe',
      'RealtimeDocs-1.2.0-win32-x64.zip',
      `${NAME}.exe`,
    ]) {
      expect(isSafeArtifactName(bad), bad).toBe(false);
      expect(
        resolveDownloadUrl(ORIGIN, `/download/releases/stable/1.2.0/${bad}`, {
          version: '1.2.0',
          fileName: bad,
        }),
      ).toBeNull();
    }
    expect(isSafeArtifactName('RealtimeDocs-1.2.0-windows-arm64.exe')).toBe(true);
    expect(isSafeArtifactName('RealtimeDocs-1.2.0-linux-x64.AppImage')).toBe(true);
  });
});

describe('verifyDownload', () => {
  it('requires size and hash', () => {
    expect(verifyDownload({ bytes: 5, sha256: SHA }, { sizeBytes: 5, sha256: SHA })).toEqual({
      ok: true,
    });
    expect(
      verifyDownload({ bytes: 5, sha256: SHA.toUpperCase() }, { sizeBytes: 5, sha256: SHA }),
    ).toEqual({ ok: true });
    expect(verifyDownload({ bytes: 6, sha256: SHA }, { sizeBytes: 5, sha256: SHA })).toEqual({
      ok: false,
      reason: 'size',
    });
    expect(
      verifyDownload({ bytes: 5, sha256: 'a'.repeat(64) }, { sizeBytes: 5, sha256: SHA }),
    ).toEqual({ ok: false, reason: 'hash' });
  });
});

describe('IPC surface of the updates feature', () => {
  it('has distinct channels', () => {
    const channels = [CH.updatesCheck, CH.updatesDownload, CH.updatesDefer, CH.updatesOpen];
    expect(new Set(channels).size).toBe(4);
    for (const channel of channels) expect(channel.startsWith('rd:updates:')).toBe(true);
  });
});

function updateResponse(over: Record<string, unknown> = {}) {
  return {
    updateAvailable: true,
    required: false,
    version: '1.2.0',
    notes: 'Notes',
    downloadUrl: PATH,
    sha256: SHA,
    sizeBytes: BYTES.length,
    signatureStatus: 'unsigned',
    releaseNotesUrl: '/releases/1.2.0',
    fileName: NAME,
    ...over,
  };
}

describe('UpdateService', () => {
  let dir: string;
  let requests: string[];
  let body: () => Response;
  let service: UpdateService;
  let opened: string[];

  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  function make(over: Partial<UpdateServiceOptions> = {}) {
    service = new UpdateService({
      fetch: async (url) => {
        requests.push(url);
        return url.includes('/api/v1/desktop/update') ? body() : download();
      },
      getServerOrigin: () => ORIGIN,
      appVersion: '1.0.0',
      platform: 'linux',
      arch: 'x64',
      schemaVersion: 2,
      protocolVersion: 1,
      stateFile: path.join(dir, 'update-state.json'),
      downloadsDir: () => path.join(dir, 'Downloads'),
      showItemInFolder: (file) => opened.push(`show:${path.basename(file)}`),
      openPath: async (file) => {
        opened.push(`open:${path.basename(file)}`);
        return '';
      },
      onChange: () => undefined,
      ...over,
    });
    return service;
  }
  let download: () => Response;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-update-'));
    requests = [];
    opened = [];
    body = () => json(updateResponse());
    download = () =>
      new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.length) } });
  });
  afterEach(() => {
    service?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('asks the configured server with platform, arch, channel, version and a stable install id', async () => {
    make();
    await service.check();
    const url = new URL(requests[0] ?? '');
    expect(url.origin).toBe(ORIGIN);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      platform: 'linux',
      arch: 'x64',
      channel: 'stable',
      currentVersion: '1.0.0',
      schemaVersion: '2',
      protocolVersion: '1',
    });
    const installId = url.searchParams.get('installId') ?? '';
    expect(installId).toMatch(/^[0-9A-Za-z-]{8,64}$/);
    expect(service.snapshot()).toMatchObject({ status: 'available', required: false });
    // A new service instance (a restart) reuses the same id.
    make();
    await service.check();
    expect(new URL(requests[1] ?? '').searchParams.get('installId')).toBe(installId);
  });

  it('says up to date when nothing is offered and unavailable on a server without the endpoint', async () => {
    body = () =>
      json(
        updateResponse({
          updateAvailable: false,
          version: null,
          downloadUrl: null,
          sha256: null,
          sizeBytes: null,
          signatureStatus: null,
          fileName: null,
          notes: null,
          releaseNotesUrl: null,
        }),
      );
    make();
    await service.check();
    expect(service.snapshot().status).toBe('up_to_date');
    body = () => new Response('{}', { status: 404 });
    await service.check();
    expect(service.snapshot().status).toBe('unavailable');
  });

  it('does nothing without a server', async () => {
    make({ getServerOrigin: () => null });
    await service.check();
    expect(requests).toEqual([]);
    expect(service.snapshot().status).toBe('unavailable');
  });

  it('refuses an offer pointing at another host or file', async () => {
    body = () => json(updateResponse({ downloadUrl: `https://evil.example.net${PATH}` }));
    make();
    await service.check();
    expect(service.snapshot()).toMatchObject({ status: 'failed', offer: null });
    body = () => json(updateResponse({ fileName: '../evil.exe' }));
    await service.check();
    expect(service.snapshot().offer).toBeNull();
  });

  it('downloads, verifies and only then offers show/open', async () => {
    make();
    await service.check();
    expect((await service.reveal('show-in-folder')).ok).toBe(false);
    await service.download();
    expect(service.snapshot()).toMatchObject({ status: 'downloaded', downloadedFile: NAME });
    const file = path.join(dir, 'Downloads', NAME);
    expect(fs.readFileSync(file).equals(BYTES)).toBe(true);
    expect(fs.existsSync(`${file}.part`)).toBe(false);
    expect((await service.reveal('show-in-folder')).ok).toBe(true);
    expect((await service.reveal('open-installer')).ok).toBe(true);
    expect(opened).toEqual([`show:${NAME}`, `open:${NAME}`]);
    expect(requests[1]).toBe(`${ORIGIN}${PATH}`);
  });

  it('deletes a download whose hash does not match and offers nothing', async () => {
    download = () =>
      new Response(Buffer.alloc(BYTES.length, 1), {
        headers: { 'content-length': String(BYTES.length) },
      });
    make();
    await service.check();
    await service.download();
    expect(service.snapshot().status).toBe('failed');
    expect(service.snapshot().message).toContain('SHA-256');
    expect(fs.existsSync(path.join(dir, 'Downloads', NAME))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'Downloads', `${NAME}.part`))).toBe(false);
    expect((await service.reveal('open-installer')).ok).toBe(false);
    expect(opened).toEqual([]);
  });

  it('deletes a download of the wrong size', async () => {
    download = () => new Response(BYTES.subarray(0, 100), { headers: { 'content-length': '100' } });
    make();
    await service.check();
    await service.download();
    expect(service.snapshot().status).toBe('failed');
    expect(fs.existsSync(path.join(dir, 'Downloads', NAME))).toBe(false);
  });

  it('stops a download that sends more than announced', async () => {
    download = () =>
      new Response(Buffer.concat([BYTES, BYTES]), {
        headers: { 'content-length': String(BYTES.length) },
      });
    make();
    await service.check();
    await service.download();
    expect(service.snapshot().status).toBe('failed');
    expect(fs.readdirSync(path.join(dir, 'Downloads'))).toEqual([]);
  });

  it('never follows redirects and sends no credentials', async () => {
    const inits: RequestInit[] = [];
    make({
      fetch: async (url, init) => {
        inits.push(init);
        return url.includes('/api/v1/desktop/update') ? json(updateResponse()) : download();
      },
    });
    await service.check();
    await service.download();
    expect(inits.map((init) => init.redirect)).toEqual(['error', 'error']);
    expect(inits.every((init) => init.credentials === 'omit')).toBe(true);
  });

  it('lets the user postpone an optional update but not a required one', async () => {
    make();
    await service.check();
    expect(await service.defer()).toBe(true);
    expect(service.snapshot().deferred).toBe(true);
    // Remembered across restarts for the same version.
    make();
    await service.check();
    expect(service.snapshot().deferred).toBe(true);
    // A newer version is not covered by the earlier deferral.
    body = () =>
      json(
        updateResponse({
          version: '1.3.0',
          fileName: 'RealtimeDocs-1.3.0-linux-x64.tar.gz',
          downloadUrl: '/download/releases/stable/1.3.0/RealtimeDocs-1.3.0-linux-x64.tar.gz',
        }),
      );
    await service.check();
    expect(service.snapshot().deferred).toBe(false);
    body = () => json(updateResponse({ required: true }));
    await service.check();
    expect(service.snapshot()).toMatchObject({ required: true, deferred: false });
    expect(await service.defer()).toBe(false);
  });

  it('reports a required update that has no download for this computer', async () => {
    body = () =>
      json(
        updateResponse({
          updateAvailable: false,
          required: true,
          version: null,
          downloadUrl: null,
          sha256: null,
          sizeBytes: null,
          signatureStatus: null,
          fileName: null,
          notes: null,
          releaseNotesUrl: null,
        }),
      );
    make();
    await service.check();
    expect(service.snapshot()).toMatchObject({ required: true, offer: null, status: 'failed' });
  });

  it('keeps the notes out of the panel copy of the state', async () => {
    make();
    await service.check();
    const view = panelUpdateView(service.snapshot());
    expect(view.offer?.notes).toBeNull();
    expect(view.offer?.version).toBe('1.2.0');
  });

  it('checks on a 6-hour schedule', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    try {
      make();
      service.start();
      await vi.advanceTimersByTimeAsync(25_000);
      await vi.waitFor(() => expect(requests.length).toBe(1));
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
      await vi.waitFor(() => expect(requests.length).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ConnectionService minimum client version', () => {
  const meta = (minimum: string | null) => ({
    name: 'RealtimeDocs',
    version: '9.9.9',
    schemaVersion: 2,
    minClientSchemaVersion: 1,
    protocolVersion: 1,
    publicOrigin: ORIGIN,
    limits: {},
    imageMimeTypes: [],
    attachmentExtensions: [],
    signupEnabled: false,
    minimumSupportedClientVersion: minimum,
    recommendedClientVersion: '1.2.0',
    documentSchemaVersion: 2,
    updateUrl: '/api/v1/desktop/update',
  });
  const service = (appVersion: string, minimum: string | null) =>
    new ConnectionService({
      appVersion,
      fetch: async () => new Response(JSON.stringify(meta(minimum)), { status: 200 }),
    });
  it('requires an update when the app is older than the server minimum', async () => {
    expect((await service('1.0.0', '1.1.0').checkServer(ORIGIN)).status).toBe('update_required');
    expect((await service('1.1.0', '1.1.0').checkServer(ORIGIN)).status).toBe('ok');
    expect((await service('1.0.0', null).checkServer(ORIGIN)).status).toBe('ok');
  });
});
