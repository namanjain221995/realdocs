import fs from 'node:fs';
import path from 'node:path';
import { FuseV1Options } from '@electron/fuses';
import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  ARCHS,
  PLATFORMS,
  URL_SCHEME,
  fuseSettings,
  macSigningPlan,
  type PackagePlatform,
} from '../../scripts/lib/app-config.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('packaged-build fuses', () => {
  const platforms: PackagePlatform[] = ['win32', 'darwin', 'linux'];

  it.each(platforms)('%s: the Node.js escape hatches are closed', (platform) => {
    const fuses = fuseSettings(platform);
    expect(fuses.RunAsNode).toBe(false);
    expect(fuses.EnableNodeOptionsEnvironmentVariable).toBe(false);
    expect(fuses.EnableNodeCliInspectArguments).toBe(false);
    expect(fuses.OnlyLoadAppFromAsar).toBe(true);
    expect(fuses.GrantFileProtocolExtraPrivileges).toBe(false);
  });

  it('validates app.asar wherever Electron supports it', () => {
    expect(fuseSettings('win32').EnableEmbeddedAsarIntegrityValidation).toBe(true);
    expect(fuseSettings('darwin').EnableEmbeddedAsarIntegrityValidation).toBe(true);
    // Electron has no asar integrity support on Linux; a set fuse would only mislead.
    expect(fuseSettings('linux').EnableEmbeddedAsarIntegrityValidation).toBe(false);
  });

  it.each(platforms)('%s: decides every fuse this Electron tooling knows', (platform) => {
    const known = Object.keys(FuseV1Options).filter((key) => Number.isNaN(Number(key)));
    expect(known.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(fuseSettings(platform)).sort()).toEqual([...known].sort());
  });
});

describe('packaging configuration', () => {
  it('targets Windows and macOS on x64 and arm64', () => {
    expect(PLATFORMS).toEqual(['win32', 'darwin', 'linux']);
    expect(ARCHS.win32).toEqual(['x64', 'arm64']);
    expect(ARCHS.darwin).toEqual(['x64', 'arm64', 'universal']);
    expect(APP_ID).toBe('com.realtimedocs.desktop');
    expect(URL_SCHEME).toBe('realtimedocs');
  });

  it('grants only the JIT entitlement on macOS', () => {
    const entitlements = read('resources/entitlements.mac.plist').replace(/<!--[\s\S]*?-->/g, '');
    const keys = [...entitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]);
    expect(keys).toEqual(['com.apple.security.cs.allow-jit']);
    expect(entitlements).not.toMatch(/device|personal-information|disable-library-validation/);
  });

  it('never declares a usage description or weakens the sandbox', () => {
    const script = read('scripts/package.mjs');
    // No camera, microphone, screen-recording or similar permission string is ever added …
    expect(script).not.toMatch(/usageDescription\s*:/);
    expect(script).not.toMatch(/NS[A-Za-z]+UsageDescription/);
    // … and the ones Electron ships are removed before packaging.
    expect(script).toContain('stripUsageDescriptions(');
    expect(script).not.toContain('--no-sandbox');
    // A failed signature must fail the build, never be skipped silently.
    expect(script).toContain('continueOnError: false');
    expect(script).toContain('strictlyRequireAllFuses: true');
  });

  it('keeps signing secrets out of the source', () => {
    const script = `${read('scripts/package.mjs')}\n${read('scripts/lib/app-config.mjs')}`;
    for (const name of ['APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_KEY', 'APPLE_SIGNING_IDENTITY']) {
      // Only ever read from the environment.
      expect(script).toContain(`env.${name}`);
    }
    expect(script).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(script).not.toMatch(/(password|secret)\s*[:=]\s*['"][^'"]+['"]/i);
  });
});

describe('macOS signing plan', () => {
  it('cannot sign anywhere but on a Mac, and says so', () => {
    for (const hostPlatform of ['linux', 'win32']) {
      const plan = macSigningPlan({
        hostPlatform,
        env: { APPLE_SIGNING_IDENTITY: 'Developer ID Application: Example (ABCDE12345)' },
      });
      expect(plan.sign).toBe(false);
      expect(plan.note).toContain('UNSIGNED');
    }
  });

  it('on a Mac without an identity, signs the finished app ad hoc instead of leaving it unsigned', () => {
    // The same answer whatever is being built: the plan does not depend on the
    // architecture, so the universal build is covered like the others.
    for (const env of [{}, { APPLE_SIGNING_IDENTITY: '' }, { APPLE_SIGNING_IDENTITY: '   ' }]) {
      const plan = macSigningPlan({ hostPlatform: 'darwin', env });
      expect(plan).toMatchObject({ sign: true, identity: '-', adHoc: true, notarize: null });
      expect(plan.note).toContain('AD HOC');
      expect(plan.note).toContain('Gatekeeper rejects it');
    }
    expect(macSigningPlan.length).toBe(1);
  });

  it('treats an explicit "-" the same way', () => {
    expect(
      macSigningPlan({ hostPlatform: 'darwin', env: { APPLE_SIGNING_IDENTITY: '-' } }),
    ).toMatchObject({ sign: true, identity: '-', adHoc: true, notarize: null });
  });

  it('never notarizes an ad-hoc signature, even with notary credentials present', () => {
    const plan = macSigningPlan({
      hostPlatform: 'darwin',
      env: { APPLE_ID: 'a@example.test', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'T' },
    });
    expect(plan).toMatchObject({ sign: true, adHoc: true, notarize: null });
  });

  const identity = 'Developer ID Application: Example (ABCDE12345)';
  it.each([
    [
      'an Apple ID',
      { APPLE_ID: 'a@example.test', APPLE_APP_SPECIFIC_PASSWORD: 'pw-value', APPLE_TEAM_ID: 'T1' },
      { appleId: 'a@example.test', appleIdPassword: 'pw-value', teamId: 'T1' },
    ],
    [
      'an API key',
      { APPLE_API_KEY: '/keys/k.p8', APPLE_API_KEY_ID: 'KID', APPLE_API_ISSUER: 'issuer' },
      { appleApiKey: '/keys/k.p8', appleApiKeyId: 'KID', appleApiIssuer: 'issuer' },
    ],
    ['a keychain profile', { APPLE_KEYCHAIN_PROFILE: 'notary' }, { keychainProfile: 'notary' }],
  ])('signs with the Developer ID and notarizes with %s', (_name, credentials, expected) => {
    const plan = macSigningPlan({
      hostPlatform: 'darwin',
      env: { APPLE_SIGNING_IDENTITY: identity, ...credentials },
    });
    expect(plan).toMatchObject({ sign: true, identity, adHoc: false, notarize: expected });
    // The note names the identity (not a secret) and never a credential.
    expect(plan.note).toContain(identity);
    expect(plan.note).not.toMatch(/pw-value|k\.p8|issuer/);
  });

  it('signs without notarizing when credentials are incomplete, and says that it was skipped', () => {
    const plan = macSigningPlan({
      hostPlatform: 'darwin',
      env: { APPLE_SIGNING_IDENTITY: identity, APPLE_ID: 'a@example.test' },
    });
    expect(plan).toMatchObject({ sign: true, adHoc: false, notarize: null });
    expect(plan.note).toContain('Notarization SKIPPED');
  });

  it('the packaging script signs the finished app, never at the moment the fuses change', () => {
    const script = read('scripts/package.mjs');
    expect(script).toContain(
      'macSigningPlan({ hostPlatform: process.platform, env: process.env })',
    );
    expect(script).toContain('resetAdHocDarwinSignature: false');
    expect(script).not.toMatch(/resetAdHocDarwinSignature:\s*true/);
    // A build that ends up without a valid signature fails with the reason.
    expect(script).toContain("['--verify', '--deep', '--strict', bundle]");
    expect(script).toContain('the finished app has no valid code signature');
  });
});

describe('Windows installer configuration', () => {
  const nsi = read('build/windows/installer.nsi');
  const code = nsi
    .split('\n')
    .filter((line) => !line.trim().startsWith(';'))
    .join('\n');

  it('installs for the current user only: no administrator rights, nothing machine-wide', () => {
    expect(code).toContain('RequestExecutionLevel user');
    expect(code).toContain('InstallDir "$LOCALAPPDATA\\Programs\\${APP_NAME}"');
    expect(code).not.toMatch(
      /HKLM|\$PROGRAMFILES|RequestExecutionLevel admin|\$COMMONFILES|SetShellVarContext all/,
    );
  });

  it('adds a Start-menu shortcut, an uninstaller, and realtimedocs:// under HKCU', () => {
    expect(code).toContain('CreateShortCut "$SMPROGRAMS\\${APP_NAME}.lnk"');
    expect(code).toContain('WriteUninstaller "$INSTDIR\\${UNINSTALLER}"');
    expect(code).toContain('!define URL_SCHEME "realtimedocs"');
    expect(code).toContain('WriteRegStr HKCU "Software\\Classes\\${URL_SCHEME}" "URL Protocol" ""');
    // The same command line the app registers itself: "--" ends the options.
    expect(code).toContain(
      'shell\\open\\command" "" "$\\"$INSTDIR\\${APP_EXE}$\\" $\\"--$\\" $\\"%1$\\""',
    );
    expect(code).toContain('Section "Uninstall"');
  });

  it('starts with Windows only if the user ticks that option', () => {
    // `/o`: the section is not selected by default.
    expect(code).toMatch(/Section \/o "Start \$\{APP_NAME\} when I sign in"/);
    expect(code.match(/WriteRegStr HKCU "\$\{RUN_KEY\}"/g)).toHaveLength(1);
  });

  it('signs only through a command passed from the environment, never with a secret in the file', () => {
    expect(code).toContain('!finalize \'${SIGN_COMMAND} "%1"\'');
    expect(code).toContain('!uninstfinalize \'${SIGN_COMMAND} "%1"\'');
    expect(nsi).not.toMatch(/\/p\s+\S+|password|\.pfx/i);
    const script = read('scripts/build-installer.mjs');
    expect(script).toContain('process.env.WINDOWS_INSTALLER_SIGN_COMMAND');
    expect(read('package.json')).toContain(
      '"package:win:installer": "node scripts/build-installer.mjs"',
    );
  });
});
