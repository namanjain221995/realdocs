/**
 * Versioned desktop releases: latest per platform, the 404 state, Range downloads, a hash mismatch
 * that is not offered, anonymous counters, traversal attempts and the legacy flat files.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DesktopUpdateResponse,
  DownloadsResponse,
  LatestReleaseResponse,
  MetaResponse,
  ReleaseListResponse,
  releaseArtifactName,
  type ReleaseArch,
  type ReleaseFormat,
  type ReleasePlatform,
  type SignatureStatus,
} from '@realtimedocs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, sleep, until, type Fixture } from './harness';

// The server re-reads the release directory at most every 2 seconds.
const settle = () => sleep(2300);

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const BODY = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

let fx: Fixture;
let dir: string;

function publish(
  version: string,
  items: {
    platform: ReleasePlatform;
    arch: ReleaseArch;
    format: ReleaseFormat;
    status?: SignatureStatus;
    corrupt?: boolean;
  }[],
  extra: Record<string, unknown> = {},
) {
  const releaseDir = path.join(dir, 'releases', 'stable', version);
  mkdirSync(releaseDir, { recursive: true });
  const artifacts = items.map((item) => {
    const fileName = releaseArtifactName(version, item.platform, item.arch, item.format);
    writeFileSync(
      path.join(releaseDir, fileName),
      item.corrupt ? Buffer.alloc(BODY.length, 7) : BODY,
    );
    return {
      platform: item.platform,
      arch: item.arch,
      format: item.format,
      fileName,
      sizeBytes: BODY.length,
      sha256: sha(BODY),
      minimumOsVersion: 'test OS 1',
      signatureStatus: item.status ?? 'unsigned',
    };
  });
  writeFileSync(
    path.join(releaseDir, 'release.json'),
    JSON.stringify({
      version,
      channel: 'stable',
      publishedAt: '2026-11-12T10:00:00.000Z',
      notes: `Notes for ${version}`,
      artifacts,
      ...extra,
    }),
  );
}

function point(version: string, rolloutPercent?: number) {
  mkdirSync(path.join(dir, 'channels'), { recursive: true });
  writeFileSync(
    path.join(dir, 'channels', 'stable.json'),
    JSON.stringify(rolloutPercent === undefined ? { version } : { version, rolloutPercent }),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'rd-releases-'));
  fx = await createFixture('releases', { port: 4413, env: { DOWNLOAD_DIR: dir } });
}, 120_000);

afterAll(async () => {
  await fx?.server.dispose();
  rmSync(dir, { recursive: true, force: true });
});

const get = (p: string, init?: RequestInit) => fetch(`${fx.server.origin}${p}`, init);

describe('before anything is published', () => {
  it('answers 404 RELEASE_NOT_AVAILABLE and lists nothing', async () => {
    const response = await get('/api/v1/desktop/releases/latest?platform=windows&arch=x64');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RELEASE_NOT_AVAILABLE');
    const list = ReleaseListResponse.parse(await (await get('/api/v1/desktop/releases')).json());
    expect(list.releases).toEqual([]);
    const meta = MetaResponse.parse(await (await get('/api/meta')).json());
    expect(meta.recommendedClientVersion).toBeNull();
  });
});

describe('a published release', () => {
  beforeAll(async () => {
    publish(
      '1.0.0',
      [
        { platform: 'windows', arch: 'x64', format: 'zip' },
        { platform: 'windows', arch: 'x64', format: 'exe', status: 'signed' },
        { platform: 'macos', arch: 'universal', format: 'zip' },
        { platform: 'linux', arch: 'x64', format: 'tar.gz' },
        { platform: 'linux', arch: 'x64', format: 'appimage' },
        { platform: 'linux', arch: 'arm64', format: 'tar.gz', corrupt: true },
      ],
      { minimumSupportedVersion: '0.9.0' },
    );
    point('1.0.0');
    await settle();
  });

  async function latest(query: string) {
    const response = await get(`/api/v1/desktop/releases/latest?${query}`);
    return {
      response,
      body: response.ok ? LatestReleaseResponse.parse(await response.json()) : null,
    };
  }

  it('picks the preferred format per platform and falls back honestly', async () => {
    const win = (await latest('platform=windows&arch=x64')).body;
    expect(win).toMatchObject({ format: 'exe', signatureStatus: 'signed', version: '1.0.0' });
    expect(win?.downloadUrl).toBe(
      '/download/releases/stable/1.0.0/RealtimeDocs-1.0.0-windows-x64.exe',
    );
    expect(win?.sha256).toBe(sha(BODY));
    expect(win?.releaseNotesUrl).toBe('/releases/1.0.0');
    // Windows on Arm falls back to the x64 build.
    expect((await latest('platform=windows&arch=arm64')).body?.arch).toBe('x64');
    // macOS falls back to universal; unsigned zip is chosen, not a dmg.
    expect((await latest('platform=macos&arch=arm64')).body).toMatchObject({
      arch: 'universal',
      format: 'zip',
    });
    expect((await latest('platform=linux&arch=x64')).body?.format).toBe('appimage');
  });

  it('does not offer an artifact whose hash does not match', async () => {
    const { response } = await latest('platform=linux&arch=arm64');
    expect(response.status).toBe(404);
    const download = await get(
      '/download/releases/stable/1.0.0/RealtimeDocs-1.0.0-linux-arm64.tar.gz',
    );
    expect(download.status).toBe(404);
    const list = ReleaseListResponse.parse(await (await get('/api/v1/desktop/releases')).json());
    expect(list.releases[0]?.artifacts.map((a) => a.fileName)).not.toContain(
      'RealtimeDocs-1.0.0-linux-arm64.tar.gz',
    );
  });

  it('uses request headers only as a fallback and says so', async () => {
    const response = await get('/api/v1/desktop/releases/latest', {
      headers: { 'sec-ch-ua-platform': '"Linux"' },
    });
    const body = LatestReleaseResponse.parse(await response.json());
    expect(body.platform).toBe('linux');
    expect(body.detected).toEqual({ source: 'sec-ch-ua-platform', platform: 'linux' });
    const explicit = LatestReleaseResponse.parse(
      await (
        await get('/api/v1/desktop/releases/latest?platform=windows', {
          headers: { 'sec-ch-ua-platform': '"Linux"' },
        })
      ).json(),
    );
    expect(explicit.platform).toBe('windows');
    expect(explicit.detected).toBeUndefined();
    expect(
      (await get('/api/v1/desktop/releases/latest', { headers: { 'user-agent': 'curl/8' } }))
        .status,
    ).toBe(400);
  });

  it('exposes the stable release through /api/meta and the legacy /api/downloads', async () => {
    const meta = MetaResponse.parse(await (await get('/api/meta')).json());
    expect(meta.recommendedClientVersion).toBe('1.0.0');
    expect(meta.minimumSupportedClientVersion).toBe('0.9.0');
    expect(meta.updateUrl).toBe('/api/v1/desktop/update');
    const legacy = DownloadsResponse.parse(await (await get('/api/downloads')).json());
    expect(legacy.release?.version).toBe('1.0.0');
    expect(legacy.artifacts.length).toBe(5);
  });

  it('streams with Range support and resumes', async () => {
    const url = '/download/releases/stable/1.0.0/RealtimeDocs-1.0.0-linux-x64.tar.gz';
    const full = await get(url);
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('cache-control')).toContain('immutable');
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');
    expect(full.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await full.arrayBuffer()).equals(BODY)).toBe(true);

    const part = await get(url, { headers: { range: 'bytes=100-199' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 100-199/${BODY.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(BODY.subarray(100, 200))).toBe(true);

    const tail = await get(url, { headers: { range: 'bytes=4000-' } });
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer()).equals(BODY.subarray(4000))).toBe(true);

    const bad = await get(url, { headers: { range: `bytes=${BODY.length}-` } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe(`bytes */${BODY.length}`);

    const head = await get(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(BODY.length));
  });

  it('counts downloads per artifact without personal data', async () => {
    const before = await fx.server.sql<{ count: string }>(
      `SELECT coalesce(sum(count),0)::text AS count FROM release_download_counts WHERE platform = 'windows'`,
    );
    const url = '/download/releases/stable/1.0.0/RealtimeDocs-1.0.0-windows-x64.zip';
    expect((await get(url)).status).toBe(200);
    expect((await get(url, { method: 'HEAD' })).status).toBe(200);
    expect((await get(url, { headers: { range: 'bytes=10-20' } })).status).toBe(206);
    await until(async () => {
      const after = await fx.server.sql<{ count: string }>(
        `SELECT coalesce(sum(count),0)::text AS count FROM release_download_counts WHERE platform = 'windows'`,
      );
      return Number(after[0]?.count) === Number(before[0]?.count) + 1 ? true : null;
    });
    const columns = await fx.server.sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'release_download_counts'`,
    );
    expect(columns.map((r) => r.column_name).sort()).toEqual(
      ['arch', 'channel', 'count', 'day', 'format', 'platform', 'version'].sort(),
    );
    const admin = await fx.admin.ok(
      fx.admin.get<{ channels: { releases: { downloads: number }[] }[] }>('/api/admin/releases'),
    );
    expect(admin.channels[0]?.releases[0]?.downloads).toBeGreaterThanOrEqual(1);
    const anonymous = await get('/api/admin/releases');
    expect(anonymous.status).toBe(401);
  });

  it('never resolves traversal or unlisted names', async () => {
    for (const p of [
      '/download/releases/stable/1.0.0/release.json',
      '/download/releases/stable/1.0.0/..%2F..%2Fchannels%2Fstable.json',
      '/download/releases/stable/..%2F1.0.0/RealtimeDocs-1.0.0-linux-x64.tar.gz',
      '/download/releases/%2e%2e/stable/1.0.0/RealtimeDocs-1.0.0-linux-x64.tar.gz',
      '/download/releases/beta/1.0.0/RealtimeDocs-1.0.0-linux-x64.tar.gz',
      '/download/releases/stable/1.0.0/RealtimeDocs-1.0.0-linux-x64.tar.gz%00',
      '/download/releases/stable/1.0.0/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    ]) {
      const response = await get(p);
      // A path the HTTP client normalised away from /download/releases falls to the web app shell.
      if (response.status === 200) {
        expect(response.headers.get('content-type'), p).toContain('text/html');
      } else {
        expect(response.status, p).toBe(404);
      }
      expect(Buffer.from(await response.arrayBuffer()).equals(BODY), p).toBe(false);
    }
  });
});

describe('updates, rollout and rollback', () => {
  const q = (extra: string) =>
    `/api/v1/desktop/update?platform=linux&arch=x64&currentVersion=${extra}`;
  const update = async (p: string) => DesktopUpdateResponse.parse(await (await get(p)).json());

  beforeAll(async () => {
    publish('1.1.0', [{ platform: 'linux', arch: 'x64', format: 'tar.gz' }], {
      minimumSupportedVersion: '1.0.0',
    });
    point('1.1.0', 0);
    await settle();
  });

  it('holds an update back by rollout percent, per install id', async () => {
    const held = await update(q('1.0.0&installId=install-aaaaaaaa'));
    expect(held).toMatchObject({ updateAvailable: false, required: false });
    point('1.1.0', 100);
    await settle();
    const offered = await update(q('1.0.0&installId=install-aaaaaaaa'));
    expect(offered).toMatchObject({ updateAvailable: true, required: false, version: '1.1.0' });
    expect(offered.sha256).toBe(sha(BODY));
    expect(offered.downloadUrl).toContain('/download/releases/stable/1.1.0/');
  });

  it('marks required when below the minimum, even inside a rollout hold-back', async () => {
    point('1.1.0', 0);
    await settle();
    const required = await update(q('0.9.0&installId=install-aaaaaaaa'));
    expect(required).toMatchObject({ updateAvailable: true, required: true });
    const incompatible = await update(q('1.0.0&installId=install-aaaaaaaa&protocolVersion=99'));
    expect(incompatible.required).toBe(true);
  });

  it('rollback: pointing back makes the older release current and offers no downgrade', async () => {
    point('1.0.0');
    await settle();
    const latest = LatestReleaseResponse.parse(
      await (await get('/api/v1/desktop/releases/latest?platform=linux&arch=x64')).json(),
    );
    expect(latest.version).toBe('1.0.0');
    const client = await update(q('1.1.0&installId=install-aaaaaaaa'));
    expect(client.updateAvailable).toBe(false);
    const list = ReleaseListResponse.parse(await (await get('/api/v1/desktop/releases')).json());
    expect(list.releases.map((r) => [r.version, r.current])).toEqual([
      ['1.1.0', false],
      ['1.0.0', true],
    ]);
    expect((await get('/api/v1/desktop/releases/1.1.0')).status).toBe(200);
    expect((await get('/api/v1/desktop/releases/9.9.9')).status).toBe(404);
  });
});

describe('legacy flat files', () => {
  it('are still listed and served alongside the versioned store', async () => {
    const legacyDir = mkdtempSync(path.join(tmpdir(), 'rd-releases-legacy-'));
    const name = 'realtimedocs-windows-x64.zip';
    try {
      writeFileSync(path.join(legacyDir, name), BODY);
      const legacy = await createFixture('releases-legacy', {
        port: 4414,
        env: { DOWNLOAD_DIR: legacyDir },
      });
      try {
        const listed = DownloadsResponse.parse(
          await (await fetch(`${legacy.server.origin}/api/downloads`)).json(),
        );
        expect(listed.artifacts.map((a) => a.file)).toEqual([name]);
        const file = await fetch(`${legacy.server.origin}/download/${name}`);
        expect(file.status).toBe(200);
        expect(Buffer.from(await file.arrayBuffer()).equals(BODY)).toBe(true);
        const none = await fetch(
          `${legacy.server.origin}/api/v1/desktop/releases/latest?platform=windows&arch=x64`,
        );
        expect(none.status).toBe(404);
      } finally {
        await legacy.server.dispose();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
