import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releaseArtifactName, type ReleaseArtifactManifest } from '@realtimedocs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRange } from '../../src/releases/range';
import {
  decideUpdate,
  detectPlatform,
  inRollout,
  pickArtifact,
  rolloutBucket,
} from '../../src/releases/select';
import { ReleaseStore } from '../../src/releases/store';
import { compareVersions } from '../../src/releases/version';

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.1', '1.0.0', 1],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '10.0.0', -1],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0.0-beta.2', '1.0.0-beta.10', -1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
  ])('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
  it('rejects non-versions', () => {
    expect(() => compareVersions('1.0', '1.0.0')).toThrow();
  });
});

describe('parseRange', () => {
  it('handles the single-range forms', () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'partial', start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'partial', start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'partial', start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ kind: 'partial', start: 50, end: 99 });
  });
  it('rejects unsatisfiable ranges and ignores unsupported ones', () => {
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'full' });
    expect(parseRange('items=0-1', 100)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=9-2', 100)).toEqual({ kind: 'full' });
  });
});

const art = (
  platform: ReleaseArtifactManifest['platform'],
  arch: ReleaseArtifactManifest['arch'],
  format: ReleaseArtifactManifest['format'],
  signatureStatus: ReleaseArtifactManifest['signatureStatus'] = 'unsigned',
): ReleaseArtifactManifest => ({
  platform,
  arch,
  format,
  fileName: releaseArtifactName('1.0.0', platform, arch, format),
  sizeBytes: 10,
  sha256: 'a'.repeat(64),
  minimumOsVersion: 'x',
  signatureStatus,
});

describe('pickArtifact', () => {
  it('windows: exe only when signed, otherwise zip', () => {
    const unsigned = [art('windows', 'x64', 'exe'), art('windows', 'x64', 'zip')];
    expect(pickArtifact(unsigned, 'windows', 'x64')?.format).toBe('zip');
    const signed = [art('windows', 'x64', 'exe', 'signed'), art('windows', 'x64', 'zip')];
    expect(pickArtifact(signed, 'windows', 'x64')?.format).toBe('exe');
  });
  it('windows arm64 falls back to x64 but x64 never gets arm64', () => {
    expect(pickArtifact([art('windows', 'x64', 'zip')], 'windows', 'arm64')?.arch).toBe('x64');
    expect(pickArtifact([art('windows', 'arm64', 'zip')], 'windows', 'x64')).toBeNull();
  });
  it('macos: dmg only when notarized; falls back to universal; never to another arch', () => {
    const list = [art('macos', 'universal', 'zip'), art('macos', 'x64', 'dmg', 'notarized')];
    expect(pickArtifact(list, 'macos', 'arm64')?.arch).toBe('universal');
    expect(pickArtifact(list, 'macos', 'x64')?.format).toBe('dmg');
    expect(pickArtifact([art('macos', 'x64', 'zip')], 'macos', 'arm64')).toBeNull();
  });
  it('linux: AppImage before tar.gz; never another platform', () => {
    const list = [art('linux', 'x64', 'tar.gz'), art('linux', 'x64', 'appimage')];
    expect(pickArtifact(list, 'linux', 'x64')?.format).toBe('appimage');
    expect(pickArtifact([art('windows', 'x64', 'zip')], 'linux', 'x64')).toBeNull();
  });
});

describe('detectPlatform', () => {
  it('prefers the client hint, then the user agent, and refuses mobile', () => {
    expect(detectPlatform({ 'sec-ch-ua-platform': '"Windows"' })?.source).toBe(
      'sec-ch-ua-platform',
    );
    expect(
      detectPlatform({ 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }),
    ).toEqual({
      source: 'user-agent',
      platform: 'macos',
    });
    expect(detectPlatform({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' })?.platform).toBe(
      'linux',
    );
    expect(detectPlatform({ 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' })).toBeNull();
    expect(
      detectPlatform({ 'sec-ch-ua-platform': '"Android"', 'user-agent': 'Windows NT' }),
    ).toBeNull();
    expect(detectPlatform({})).toBeNull();
  });
});

describe('rollout', () => {
  it('is stable per install and version', () => {
    expect(rolloutBucket('install-0001', '1.2.0')).toBe(rolloutBucket('install-0001', '1.2.0'));
    expect(rolloutBucket('install-0001', '1.2.0')).toBeGreaterThanOrEqual(0);
    expect(rolloutBucket('install-0001', '1.2.0')).toBeLessThan(100);
  });
  it('approximates the percentage and is monotonic', () => {
    let at25 = 0;
    for (let i = 0; i < 4000; i += 1) {
      const id = `install-${i}`;
      if (inRollout(25, id, '2.0.0')) at25 += 1;
      if (inRollout(25, id, '2.0.0')) expect(inRollout(50, id, '2.0.0')).toBe(true);
    }
    expect(at25 / 4000).toBeGreaterThan(0.2);
    expect(at25 / 4000).toBeLessThan(0.3);
  });
  it('full, none and missing install id', () => {
    expect(inRollout(undefined, undefined, '1.0.0')).toBe(true);
    expect(inRollout(100, undefined, '1.0.0')).toBe(true);
    expect(inRollout(0, 'install-0001', '1.0.0')).toBe(false);
    expect(inRollout(50, undefined, '1.0.0')).toBe(false);
  });
});

describe('decideUpdate', () => {
  const base = {
    currentVersion: '1.0.0',
    releaseVersion: '1.1.0',
    minimumSupportedVersion: null,
    hasArtifact: true,
    minClientSchemaVersion: 1,
    protocolVersion: 1,
  };
  it('offers a newer release and nothing for equal or older', () => {
    expect(decideUpdate(base)).toEqual({ updateAvailable: true, required: false });
    expect(decideUpdate({ ...base, currentVersion: '1.1.0' }).updateAvailable).toBe(false);
    expect(decideUpdate({ ...base, currentVersion: '2.0.0' }).updateAvailable).toBe(false);
  });
  it('marks required below the minimum, or on schema/protocol mismatch', () => {
    expect(decideUpdate({ ...base, minimumSupportedVersion: '1.0.1' }).required).toBe(true);
    expect(decideUpdate({ ...base, minimumSupportedVersion: '1.0.0' }).required).toBe(false);
    expect(decideUpdate({ ...base, clientSchemaVersion: 0 }).required).toBe(true);
    expect(decideUpdate({ ...base, clientProtocolVersion: 2 }).required).toBe(true);
  });
  it('required with no artifact is reported but nothing is offered', () => {
    expect(decideUpdate({ ...base, minimumSupportedVersion: '1.0.1', hasArtifact: false })).toEqual(
      {
        updateAvailable: false,
        required: true,
      },
    );
  });
  it('holds back a staged rollout but never a required update', () => {
    expect(
      decideUpdate({ ...base, rolloutPercent: 0, installId: 'install-0001' }).updateAvailable,
    ).toBe(false);
    expect(
      decideUpdate({ ...base, rolloutPercent: 0, minimumSupportedVersion: '1.0.1' })
        .updateAvailable,
    ).toBe(true);
  });
});

describe('ReleaseStore', () => {
  let dir: string;
  const logger = { warn: () => undefined, info: () => undefined };
  const bytes = Buffer.from('artifact bytes');
  const sha = createHash('sha256').update(bytes).digest('hex');

  function writeRelease(version: string, entries: Partial<ReleaseArtifactManifest>[], extra = {}) {
    const releaseDir = path.join(dir, 'releases', 'stable', version);
    mkdirSync(releaseDir, { recursive: true });
    const artifacts = entries.map((e) => ({
      ...art('linux', 'x64', 'tar.gz'),
      fileName: releaseArtifactName(
        version,
        e.platform ?? 'linux',
        e.arch ?? 'x64',
        e.format ?? 'tar.gz',
      ),
      sizeBytes: bytes.length,
      sha256: sha,
      ...e,
    }));
    writeFileSync(
      path.join(releaseDir, 'release.json'),
      JSON.stringify({
        version,
        channel: 'stable',
        publishedAt: '2026-11-12T10:00:00.000Z',
        notes: 'n',
        artifacts,
        ...extra,
      }),
    );
    return { releaseDir, artifacts };
  }

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rd-release-store-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('offers only files that exist, match size, name pattern and hash', async () => {
    const { releaseDir, artifacts } = writeRelease('1.0.0', [
      { platform: 'linux', arch: 'x64', format: 'tar.gz' },
      { platform: 'linux', arch: 'arm64', format: 'tar.gz' }, // file missing
      { platform: 'windows', arch: 'x64', format: 'zip', sha256: 'b'.repeat(64) }, // wrong hash
      { platform: 'macos', arch: 'x64', format: 'zip', fileName: '../evil.zip' }, // bad name
      { platform: 'macos', arch: 'arm64', format: 'zip', sizeBytes: 3 }, // wrong size
    ]);
    writeFileSync(path.join(releaseDir, artifacts[0]!.fileName), bytes);
    writeFileSync(path.join(releaseDir, artifacts[2]!.fileName), bytes);
    writeFileSync(path.join(releaseDir, artifacts[4]!.fileName), bytes);
    const store = new ReleaseStore(dir, logger, 0);
    const release = await store.current('stable');
    expect(release?.version).toBe('1.0.0');
    expect(release?.problems).toHaveLength(3);
    const ok = await store.verified(release!);
    expect(ok.map((a) => a.fileName)).toEqual(['RealtimeDocs-1.0.0-linux-x64.tar.gz']);
  });

  it('does not follow a symbolic link as an artifact', async () => {
    const { releaseDir, artifacts } = writeRelease('1.0.1', [{}]);
    writeFileSync(path.join(dir, 'outside.bin'), bytes);
    symlinkSync(path.join(dir, 'outside.bin'), path.join(releaseDir, artifacts[0]!.fileName));
    const store = new ReleaseStore(dir, logger, 0);
    const release = await store.find('stable', '1.0.1');
    expect(release?.artifacts).toEqual([]);
  });

  it('finds artifacts only by exact snapshot entry, so traversal never resolves', async () => {
    const store = new ReleaseStore(dir, logger, 0);
    for (const [channel, version, name] of [
      ['stable', '1.0.0', '../1.0.1/RealtimeDocs-1.0.1-linux-x64.tar.gz'],
      ['stable', '..', 'release.json'],
      ['../stable', '1.0.0', 'RealtimeDocs-1.0.0-linux-x64.tar.gz'],
      ['stable', '1.0.0', 'release.json'],
    ] as const) {
      expect(await store.findArtifact(channel, version, name)).toBeNull();
    }
    expect(
      await store.findArtifact('stable', '1.0.0', 'RealtimeDocs-1.0.0-linux-x64.tar.gz'),
    ).not.toBeNull();
  });

  it('rejects a manifest whose version differs from its directory', async () => {
    const releaseDir = path.join(dir, 'releases', 'stable', '3.0.0');
    mkdirSync(releaseDir, { recursive: true });
    writeFileSync(
      path.join(releaseDir, 'release.json'),
      JSON.stringify({
        version: '3.0.1',
        channel: 'stable',
        publishedAt: '2026-11-12T10:00:00.000Z',
        notes: '',
        artifacts: [],
      }),
    );
    const store = new ReleaseStore(dir, logger, 0);
    const snap = await store.snapshot();
    expect(snap.channels.stable.broken.map((b) => b.version)).toContain('3.0.0');
  });

  it('uses the channel pointer over the newest version (rollback)', async () => {
    mkdirSync(path.join(dir, 'channels'), { recursive: true });
    writeFileSync(
      path.join(dir, 'channels', 'stable.json'),
      JSON.stringify({ version: '1.0.0', rolloutPercent: 10 }),
    );
    const store = new ReleaseStore(dir, logger, 0);
    expect((await store.current('stable'))?.version).toBe('1.0.0');
    expect((await store.snapshot()).channels.stable.pointer?.rolloutPercent).toBe(10);
    writeFileSync(path.join(dir, 'channels', 'stable.json'), JSON.stringify({ version: '9.9.9' }));
    expect(await new ReleaseStore(dir, logger, 0).current('stable')).toBeNull();
  });

  it('is empty when no directory is configured', async () => {
    const store = new ReleaseStore(null, logger);
    expect(store.configured).toBe(false);
    expect(await store.current('stable')).toBeNull();
  });
});
