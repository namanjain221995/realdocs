// Packaging facts shared by scripts/package.mjs (which applies them) and
// scripts/inspect-package.mjs (which checks a finished package against them).

export const APP_NAME = 'RealtimeDocs';
export const APP_ID = 'com.realtimedocs.desktop';
export const URL_SCHEME = 'realtimedocs';
/** Lower-case binary name on Linux; Windows and macOS use APP_NAME. */
export const LINUX_EXECUTABLE = 'realtimedocs';

export const PLATFORMS = ['win32', 'darwin', 'linux'];
export const ARCHS = {
  win32: ['x64', 'arm64'],
  linux: ['x64', 'arm64'],
  darwin: ['x64', 'arm64', 'universal'],
};

/** Packager platform names (Node's `process.platform`) to the names used in public artifact names. */
export const PUBLIC_PLATFORM = { win32: 'windows', darwin: 'macos', linux: 'linux' };

/**
 * `RealtimeDocs-<version>-<windows|macos|linux>-<x64|arm64|universal>.<ext>`: the one artifact name
 * the release store, the publish script and the download page accept (docs/desktop-release.md).
 */
export function artifactFileName(version, platform, arch, ext) {
  const publicPlatform = PUBLIC_PLATFORM[platform];
  if (!publicPlatform) throw new Error(`unknown platform ${platform}`);
  return `${APP_NAME}-${version}-${publicPlatform}-${arch}.${ext}`;
}

/**
 * Electron fuses for packaged builds, by fuse name (the names of
 * `FuseV1Options` in @electron/fuses). `true` = enabled, `false` = disabled.
 * https://www.electronjs.org/docs/latest/tutorial/fuses
 */
export function fuseSettings(platform) {
  return {
    // ELECTRON_RUN_AS_NODE is ignored: the binary cannot be used as a plain Node.js.
    RunAsNode: false,
    // NODE_OPTIONS and NODE_EXTRA_CA_CERTS are ignored.
    EnableNodeOptionsEnvironmentVariable: false,
    // --inspect, --inspect-brk and friends are ignored.
    EnableNodeCliInspectArguments: false,
    // The app code is only ever read from app.asar, never from a loose `app` folder.
    OnlyLoadAppFromAsar: true,
    // app.asar is checked against the hash embedded in the executable (Windows)
    // or Info.plist (macOS). Electron has no asar integrity support on Linux.
    EnableEmbeddedAsarIntegrityValidation: platform !== 'linux',
    // file:// pages get no extra privileges; the app only serves app://realtimedocs.
    GrantFileProtocolExtraPrivileges: false,
    // Sign-in uses a bearer token held by the main process, not cookies. Should a
    // server set one anyway, it is encrypted at rest with the operating system's key.
    EnableCookieEncryption: true,
    // No separate browser-process V8 snapshot is shipped.
    LoadBrowserProcessSpecificV8Snapshot: false,
    // Electron's default.
    WasmTrapHandlers: true,
  };
}

/**
 * What to do about signing a macOS build, decided from the host and the
 * environment only (so it can be unit-tested; scripts/package.mjs applies it).
 *
 * On a Mac the FINISHED app is always signed, for every architecture and for
 * the universal build alike:
 *
 * - with the Developer ID named by APPLE_SIGNING_IDENTITY, and notarized when
 *   notary credentials are in the environment; or
 * - ad hoc ("-") when APPLE_SIGNING_IDENTITY is unset or is "-".
 *
 * An unsigned result is not an option there. Changing the fuses and embedding
 * the asar integrity digest both modify the Electron Framework after Electron
 * signed it, and Apple Silicon refuses to run code whose signature does not
 * match. The two halves of a universal build are never signed on their own
 * (the merge would reject them), so the signature of the merged app is the
 * only one it gets.
 *
 * On any other host there is no `codesign`: the build is unsigned.
 *
 * This path was written from the sources of @electron/packager 20.3.0,
 * @electron/osx-sign 2.7.2 and @electron/fuses 2.1.3. It has never been
 * executed: the project is built on Linux.
 *
 * @param {{ hostPlatform: string, env: Record<string, string | undefined> }} input
 */
export function macSigningPlan({ hostPlatform, env }) {
  if (hostPlatform !== 'darwin') {
    return {
      sign: false,
      note: 'macOS signing and notarization need a Mac (codesign, notarytool): this build is UNSIGNED.',
    };
  }
  const configured = env.APPLE_SIGNING_IDENTITY?.trim() || null;
  const identity = configured ?? '-';
  if (identity === '-') {
    return {
      sign: true,
      identity: '-',
      adHoc: true,
      notarize: null,
      note: configured
        ? 'Ad-hoc signature (APPLE_SIGNING_IDENTITY=-): the finished app runs on this Mac and cannot be distributed.'
        : 'APPLE_SIGNING_IDENTITY is not set: the finished app is signed AD HOC. It runs on this Mac;\n' +
          '  Gatekeeper rejects it on any other. Set APPLE_SIGNING_IDENTITY to a "Developer ID Application"\n' +
          '  identity to build something that can be distributed.',
    };
  }
  /** @type {Record<string, string> | null} */
  let notarize = null;
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    notarize = {
      appleId: env.APPLE_ID,
      appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: env.APPLE_TEAM_ID,
    };
  } else if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID) {
    notarize = {
      appleApiKey: env.APPLE_API_KEY,
      appleApiKeyId: env.APPLE_API_KEY_ID,
      ...(env.APPLE_API_ISSUER ? { appleApiIssuer: env.APPLE_API_ISSUER } : {}),
    };
  } else if (env.APPLE_KEYCHAIN_PROFILE) {
    notarize = {
      keychainProfile: env.APPLE_KEYCHAIN_PROFILE,
      ...(env.APPLE_KEYCHAIN ? { keychain: env.APPLE_KEYCHAIN } : {}),
    };
  }
  return {
    sign: true,
    identity,
    adHoc: false,
    notarize,
    note: notarize
      ? `Signing as "${identity}" and notarizing.`
      : `Signing as "${identity}". Notarization SKIPPED: no Apple notary credentials in the environment.`,
  };
}
