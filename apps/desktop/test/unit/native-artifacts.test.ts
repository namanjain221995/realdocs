import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIVE_MANIFEST_NAME as LOADER_MANIFEST_NAME } from '../../src/main/native/display-affinity';
import { hashFromManifest } from '../../src/main/native/display-affinity';
import { planBuild } from '../../scripts/build-native.mjs';
import {
  NATIVE_MANIFEST_NAME,
  collectNativeArtifacts,
} from '../../scripts/lib/native-artifacts.mjs';

const BYTES = Buffer.from('native bytes');
const HASH = createHash('sha256').update(BYTES).digest('hex');
const DIST = path.join('/', 'dist');
const reader = (files: Record<string, Buffer | string>) => (file: string) => {
  const value = files[file];
  if (value === undefined) throw new Error('ENOENT');
  return value as Buffer;
};

describe('native artifacts', () => {
  it('returns nothing for platforms other than Windows', () => {
    for (const platform of ['linux', 'darwin']) {
      const result = collectNativeArtifacts({ platform, arch: 'arm64', distDir: DIST });
      expect(result).toMatchObject({ status: 'not_applicable', files: [], hashFile: null });
    }
    expect(collectNativeArtifacts({ platform: 'win32', arch: 'ia32', distDir: DIST }).status).toBe(
      'not_applicable',
    );
  });

  it('reports a Windows target whose module was not built, with no files', () => {
    const result = collectNativeArtifacts({
      platform: 'win32',
      arch: 'x64',
      distDir: DIST,
      readFile: reader({}),
    });
    expect(result.status).toBe('not_built');
    expect(result.files).toEqual([]);
    expect(result.hashFile).toBeNull();
    expect(result.reason).toContain('build-native.mjs');
  });

  it('returns the file outside the asar and a manifest the loader can read', () => {
    const from = path.join(DIST, 'win32-x64', 'display_affinity.node');
    const result = collectNativeArtifacts({
      platform: 'win32',
      arch: 'x64',
      distDir: DIST,
      readFile: reader({ [from]: BYTES, [`${from}.sha256`]: `${HASH}  display_affinity.node\n` }),
    });
    expect(result.status).toBe('included');
    expect(result.files).toEqual([{ from, to: 'native/win32-x64/display_affinity.node' }]);
    expect(result.hashFile?.name).toBe(NATIVE_MANIFEST_NAME);
    expect(hashFromManifest(result.hashFile?.contents ?? '', 'win32-x64')).toBe(HASH);
  });

  it('refuses a binary that does not match its recorded hash', () => {
    const from = path.join(DIST, 'win32-arm64', 'display_affinity.node');
    expect(() =>
      collectNativeArtifacts({
        platform: 'win32',
        arch: 'arm64',
        distDir: DIST,
        readFile: reader({ [from]: BYTES, [`${from}.sha256`]: `${'b'.repeat(64)}\n` }),
      }),
    ).toThrow(/does not match/);
  });

  it('uses the same manifest name as the loader', () => {
    expect(NATIVE_MANIFEST_NAME).toBe(LOADER_MANIFEST_NAME);
  });
});

describe('build-native plan', () => {
  it('refuses on a host that is not Windows', () => {
    for (const hostPlatform of ['linux', 'darwin']) {
      const plan = planBuild({ hostPlatform, hostArch: 'arm64', argv: [] });
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.message).toMatch(/only be built on a Windows host/);
    }
  });

  it('targets Electron 45.2.3 with the Electron headers on Windows', () => {
    const plan = planBuild({ hostPlatform: 'win32', hostArch: 'x64', argv: ['--arch', 'arm64'] });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.arch).toBe('arm64');
      expect(plan.args).toEqual(
        expect.arrayContaining([
          '--runtime=electron',
          '--target=45.2.3',
          '--arch=arm64',
          '--dist-url=https://electronjs.org/headers',
        ]),
      );
    }
    expect(planBuild({ hostPlatform: 'win32', hostArch: 'x64', argv: ['--arch', 'ia32'] }).ok).toBe(
      false,
    );
  });
});
