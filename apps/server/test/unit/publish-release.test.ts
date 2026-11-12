import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReleaseManifest, ChannelPointer } from '@realtimedocs/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildManifest,
  buildPointer,
  parseArtifactName,
  signatureFor,
  validateRollout,
} from '../../../../scripts/lib/release-publish.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const file = (name: string) => ({ name, sizeBytes: 5, sha256: 'c'.repeat(64) });

describe('parseArtifactName', () => {
  it('accepts the strict pattern only', () => {
    expect(parseArtifactName('RealtimeDocs-1.2.3-linux-x64.AppImage')).toMatchObject({
      platform: 'linux',
      format: 'appimage',
    });
    expect(parseArtifactName('RealtimeDocs-1.2.3-beta.1-macos-universal.zip')?.version).toBe(
      '1.2.3-beta.1',
    );
    for (const bad of [
      'RealtimeDocs-1.2.3-win32-x64.zip',
      'RealtimeDocs-1.2-windows-x64.zip',
      'realtimedocs-1.2.3-windows-x64.zip',
      'RealtimeDocs-1.2.3-windows-x64.zip.exe',
      '../RealtimeDocs-1.2.3-windows-x64.zip',
      'RealtimeDocs-1.2.3-linux-x64.appimage',
    ]) {
      expect(parseArtifactName(bad), bad).toBeNull();
    }
  });
});

describe('buildManifest', () => {
  const base = {
    version: '1.2.3',
    channel: 'stable',
    notes: 'n',
    publishedAt: '2026-11-12T00:00:00.000Z',
  };
  it('never infers signing: unsigned unless stated', () => {
    const m = buildManifest({
      ...base,
      files: [
        file('RealtimeDocs-1.2.3-windows-x64.zip'),
        file('RealtimeDocs-1.2.3-macos-arm64.zip'),
        file('RealtimeDocs-1.2.3-linux-x64.tar.gz'),
      ],
    });
    expect(m.artifacts.map((a) => a.signatureStatus)).toEqual(['unsigned', 'unsigned', 'unsigned']);
    const stated = buildManifest({
      ...base,
      signedWindows: true,
      notarizedMacos: true,
      files: [
        file('RealtimeDocs-1.2.3-windows-x64.zip'),
        file('RealtimeDocs-1.2.3-macos-arm64.zip'),
      ],
    });
    expect(stated.artifacts.map((a) => a.signatureStatus).sort()).toEqual(['notarized', 'signed']);
    expect(signatureFor('linux', { signedWindows: true, notarizedMacos: true })).toBe('unsigned');
  });
  it('produces a manifest the server contract accepts', () => {
    const m = buildManifest({
      ...base,
      minimumSupportedVersion: '1.0.0',
      files: [file('RealtimeDocs-1.2.3-linux-arm64.tar.gz')],
    });
    expect(ReleaseManifest.safeParse(m).success).toBe(true);
  });
  it('rejects mismatched versions, duplicates, empty files and long notes', () => {
    expect(() =>
      buildManifest({ ...base, files: [file('RealtimeDocs-1.2.4-linux-x64.zip')] }),
    ).toThrow();
    expect(() =>
      buildManifest({
        ...base,
        files: [file('RealtimeDocs-1.2.3-linux-x64.zip'), file('RealtimeDocs-1.2.3-linux-x64.zip')],
      }),
    ).toThrow(/Two artifacts/);
    expect(() =>
      buildManifest({
        ...base,
        files: [{ ...file('RealtimeDocs-1.2.3-linux-x64.zip'), sizeBytes: 0 }],
      }),
    ).toThrow();
    expect(() =>
      buildManifest({
        ...base,
        notes: 'x'.repeat(20_001),
        files: [file('RealtimeDocs-1.2.3-linux-x64.zip')],
      }),
    ).toThrow();
    expect(() =>
      buildManifest({
        ...base,
        channel: 'nightly',
        files: [file('RealtimeDocs-1.2.3-linux-x64.zip')],
      }),
    ).toThrow();
  });
});

describe('pointer and rollout', () => {
  it('validates and omits a full rollout', () => {
    expect(validateRollout('25')).toBe(25);
    expect(() => validateRollout('101')).toThrow();
    expect(() => validateRollout('1.5')).toThrow();
    expect(buildPointer('1.0.0', 100)).toEqual({ version: '1.0.0' });
    expect(ChannelPointer.safeParse(buildPointer('1.0.0', 30)).success).toBe(true);
  });
});

describe('publish-release CLI (filesystem)', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'rd-publish-'));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [path.join(root, 'scripts/publish-release.mjs'), ...args], {
      encoding: 'utf8',
    });

  it('publishes, keeps old releases, rolls back and changes rollout', () => {
    const notes = path.join(work, 'notes.md');
    writeFileSync(notes, 'notes');
    const target = path.join(work, 'target');
    for (const version of ['1.0.0', '1.1.0']) {
      const src = path.join(work, `src-${version}`);
      mkdirSync(src);
      writeFileSync(path.join(src, `RealtimeDocs-${version}-linux-x64.tar.gz`), 'bytes');
      writeFileSync(path.join(src, 'ignored.txt'), 'x');
      run(src, '--channel', 'stable', '--notes-file', notes, '--target', target);
    }
    const pointer = () =>
      JSON.parse(readFileSync(path.join(target, 'channels/stable.json'), 'utf8'));
    expect(pointer()).toEqual({ version: '1.1.0' });
    expect(readdirSync(path.join(target, 'releases/stable')).sort()).toEqual(['1.0.0', '1.1.0']);
    const manifest = JSON.parse(
      readFileSync(path.join(target, 'releases/stable/1.0.0/release.json'), 'utf8'),
    );
    expect(ReleaseManifest.safeParse(manifest).success).toBe(true);

    run('--rollback', '1.0.0', '--channel', 'stable', '--target', target);
    expect(pointer()).toEqual({ version: '1.0.0' });
    run('--rollout', '20', '--channel', 'stable', '--target', target);
    expect(pointer()).toEqual({ version: '1.0.0', rolloutPercent: 20 });
    expect(() => run('--rollback', '9.9.9', '--channel', 'stable', '--target', target)).toThrow();
    // Publishing an existing version again is refused: releases are immutable.
    expect(() =>
      run(
        path.join(work, 'src-1.0.0'),
        '--channel',
        'stable',
        '--notes-file',
        notes,
        '--target',
        target,
      ),
    ).toThrow();
  });
});
