#!/usr/bin/env node
// Packages RealtimeDocs Desktop with @electron/packager.
//
//   node scripts/package.mjs [--platform win32|darwin|linux] [--arch x64|arm64|universal[,...]]
//                            [--out <dir>] [--no-archive] [--no-inspect]
//
// For each platform/arch:
//   1. production build into .stage/app (everything bundled, no node_modules);
//   2. @electron/packager: asar, app id, icons, `realtimedocs://` URL scheme;
//   3. on the freshly extracted Electron, before it is renamed or signed: flip
//      the fuses and, for macOS, delete the usage-description strings that
//      Electron's stock Info.plist files declare (camera, microphone, ...);
//   4. sign / notarize when the host and the environment allow it;
//   5. archive (.zip everywhere, .dmg on macOS hosts) and inspect the result.
//
// Signing is driven only by environment variables; nothing secret is in source.
//
//   macOS (needs a Mac with the Xcode command line tools):
//     APPLE_SIGNING_IDENTITY   "Developer ID Application: Name (TEAMID)" for a
//                              distributable build, or "-" to re-sign ad hoc
//     notarization (only with a Developer ID identity), one of:
//       APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//       APPLE_API_KEY (path to the .p8 file) + APPLE_API_KEY_ID [+ APPLE_API_ISSUER]
//       APPLE_KEYCHAIN_PROFILE [+ APPLE_KEYCHAIN]
//   Windows (needs Windows; the variables are read by @electron/windows-sign):
//     WINDOWS_CERTIFICATE_FILE + WINDOWS_CERTIFICATE_PASSWORD, or
//     WINDOWS_SIGN_WITH_PARAMS (signtool arguments, for example a certificate-store
//     or hardware-token identity), or WINDOWS_SIGN_HOOK_MODULE_PATH
//     optional: WINDOWS_TIMESTAMP_SERVER, WINDOWS_SIGNTOOL_PATH
//
// ELECTRON_CACHE overrides where Electron downloads are kept (default .stage/electron-cache).
//
// Cross-building from Linux produces UNSIGNED Windows and macOS bundles that
// have never been executed on those systems.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import { packager } from '@electron/packager';
import { buildApp, readManifest } from './build.mjs';
import { inspectArchive, inspectPackage, printInspection } from './inspect-package.mjs';
import {
  APP_ID,
  APP_NAME,
  ARCHS,
  LINUX_EXECUTABLE,
  PLATFORMS,
  URL_SCHEME,
  fuseSettings,
  macSigningPlan,
} from './lib/app-config.mjs';
import { NATIVE_MANIFEST_NAME, collectNativeArtifacts } from './lib/native-artifacts.mjs';
import { ICON_DIRECTORY } from './make-icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, '.stage');
// `plist` is a dependency of @electron/packager; using its copy keeps this
// script free of extra installs.
const requireFromPackager = createRequire(import.meta.resolve('@electron/packager'));
const plist = requireFromPackager('plist');

function parseArgs(argv) {
  const options = {
    platform: process.platform,
    arch: [process.arch],
    out: path.join(root, 'out'),
    archive: true,
    inspect: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') options.platform = argv[(index += 1)];
    else if (arg === '--arch') options.arch = String(argv[(index += 1)]).split(',');
    else if (arg === '--out') options.out = path.resolve(argv[(index += 1)]);
    else if (arg === '--no-archive') options.archive = false;
    else if (arg === '--no-inspect') options.inspect = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!PLATFORMS.includes(options.platform)) {
    throw new Error(`--platform must be one of ${PLATFORMS.join(', ')} (got ${options.platform})`);
  }
  for (const arch of options.arch) {
    if (!ARCHS[options.platform].includes(arch)) {
      throw new Error(
        `--arch for ${options.platform} must be one of ${ARCHS[options.platform].join(', ')} (got ${arch})`,
      );
    }
  }
  return options;
}

/** The @electron/fuses configuration for `fuseSettings(platform)`. */
function fuseConfig(platform) {
  const config = {
    version: FuseVersion.V1,
    // Fail the build if this Electron version has a fuse the settings do not decide.
    strictlyRequireAllFuses: true,
    // The finished app is signed as a whole instead (see `macSigning`).
    resetAdHocDarwinSignature: false,
  };
  for (const [name, enabled] of Object.entries(fuseSettings(platform))) {
    if (FuseV1Options[name] === undefined) throw new Error(`Unknown fuse: ${name}`);
    config[FuseV1Options[name]] = enabled;
  }
  return config;
}

/**
 * Electron's stock Info.plist files declare camera, microphone, Bluetooth and
 * audio-capture usage strings. This app asks for none of those, so no such
 * key may ship.
 */
function stripUsageDescriptions(appPath) {
  const removed = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.name === 'Info.plist') {
        const data = plist.parse(fs.readFileSync(full, 'utf8'));
        let changed = false;
        for (const key of Object.keys(data)) {
          if (/UsageDescription$/.test(key)) {
            delete data[key];
            removed.push(`${path.relative(appPath, full)}: ${key}`);
            changed = true;
          }
        }
        if (changed) fs.writeFileSync(full, plist.build(data));
      }
    }
  };
  visit(appPath);
  return removed;
}

function macSigning() {
  // See `macSigningPlan`: on a Mac the finished app is always signed (ad hoc
  // when no identity is configured), for every architecture and for universal.
  const plan = macSigningPlan({ hostPlatform: process.platform, env: process.env });
  if (!plan.sign) return { note: plan.note };
  const { adHoc } = plan;
  const entitlements = path.join(root, 'resources', 'entitlements.mac.plist');
  const osxSign = {
    identity: plan.identity,
    // "-" is not a keychain identity, so it cannot be looked up.
    ...(adHoc ? { identityValidation: false } : {}),
    // Fail the build rather than ship a half-signed app.
    continueOnError: false,
    // Never pick up a provisioning profile that happens to lie in the working directory.
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({
      // The same minimal entitlements for every binary. The signing tool's own
      // defaults would add camera, microphone, Bluetooth, USB, location and photos.
      entitlements,
      // The hardened runtime needs a real Team ID: with an ad-hoc signature its
      // library validation would refuse the app's own frameworks.
      hardenedRuntime: !adHoc,
      // Ad-hoc signatures cannot be timestamped.
      ...(adHoc ? { timestamp: 'none' } : {}),
    }),
  };
  return {
    osxSign,
    ...(plan.notarize ? { osxNotarize: plan.notarize } : {}),
    note: plan.note,
  };
}

function windowsSigning() {
  if (process.platform !== 'win32') {
    return { note: 'Windows signing needs a Windows host (signtool): this build is UNSIGNED.' };
  }
  const env = process.env;
  const configured =
    env.WINDOWS_CERTIFICATE_FILE ||
    env.WINDOWS_SIGN_WITH_PARAMS ||
    env.WINDOWS_SIGN_HOOK_MODULE_PATH;
  if (!configured) {
    return { note: 'No Windows signing variables are set: the executable is UNSIGNED.' };
  }
  // @electron/windows-sign reads the certificate, password, signtool parameters
  // and hook module from the environment itself. SHA-256 only: Windows 10 and
  // later, the only supported systems, do not need a second SHA-1 signature.
  return {
    windowsSign: { hashes: ['sha256'] },
    note: 'Signing every executable and DLL with the configured Windows certificate.',
  };
}

function archive(appDirectory, platform, arch, version, outDirectory) {
  const base = `${APP_NAME}-${version}-${platform}-${arch}`;
  const results = [];
  const zipPath = path.join(outDirectory, `${base}.zip`);
  fs.rmSync(zipPath, { force: true });
  const folder = path.basename(appDirectory);
  const parent = path.dirname(appDirectory);

  if (process.platform === 'darwin' && platform === 'darwin') {
    // Apple's own archiver keeps bundle metadata intact.
    const zipped = spawnSync(
      'ditto',
      ['-c', '-k', '--sequesterRsrc', '--keepParent', `${APP_NAME}.app`, zipPath],
      { cwd: appDirectory, stdio: 'inherit' },
    );
    if (zipped.status === 0) results.push(zipPath);
    else console.error('  ditto failed: no .zip written.');
  } else if (process.platform === 'win32') {
    // bsdtar ships with Windows 10 and later; `-a` picks the format from the file name.
    const zipped = spawnSync('tar', ['-a', '-c', '-f', zipPath, folder], {
      cwd: parent,
      stdio: 'inherit',
    });
    if (zipped.status === 0) results.push(zipPath);
    else console.error('  tar failed: no .zip written.');
  } else {
    // -y stores symbolic links as links; a macOS bundle is full of them.
    const zipped = spawnSync('zip', ['-r', '-y', '-q', zipPath, folder], {
      cwd: parent,
      stdio: 'inherit',
    });
    if (zipped.status === 0) results.push(zipPath);
    else console.error('  zip failed or is not installed: no .zip written.');
  }

  if (platform === 'darwin') {
    const dmgPath = path.join(outDirectory, `${base}.dmg`);
    if (process.platform === 'darwin') {
      fs.rmSync(dmgPath, { force: true });
      const dmgRoot = path.join(stage, `dmg-${arch}`);
      fs.rmSync(dmgRoot, { recursive: true, force: true });
      fs.mkdirSync(dmgRoot, { recursive: true });
      fs.cpSync(path.join(appDirectory, `${APP_NAME}.app`), path.join(dmgRoot, `${APP_NAME}.app`), {
        recursive: true,
        verbatimSymlinks: true,
      });
      fs.symlinkSync('/Applications', path.join(dmgRoot, 'Applications'));
      const created = spawnSync(
        'hdiutil',
        ['create', '-volname', APP_NAME, '-srcfolder', dmgRoot, '-ov', '-format', 'UDZO', dmgPath],
        { stdio: 'inherit' },
      );
      if (created.status === 0) results.push(dmgPath);
      else console.error('  hdiutil failed: no .dmg written.');
    } else {
      console.log(
        `  .dmg skipped: hdiutil exists only on macOS (this host is ${process.platform}).`,
      );
    }
  }
  return results;
}

async function packageOne({
  platform,
  arch,
  out,
  version,
  electronVersion,
  archiveOutput,
  inspect,
}) {
  console.log(`\n== ${platform}-${arch} ==`);
  if (platform === 'darwin' && arch === 'universal' && process.platform !== 'darwin') {
    throw new Error(
      'a universal macOS app can only be built on macOS: @electron/universal merges the x64 and arm64 builds with `lipo`. ' +
        'Run on a Mac: pnpm --filter @realtimedocs/desktop run package:mac:universal',
    );
  }
  const signing =
    platform === 'darwin' ? macSigning() : platform === 'win32' ? windowsSigning() : {};
  if (signing.note) console.log(`  ${signing.note}`);

  // The optional Windows diagnostics module. Its hash goes INTO the staged app
  // (so asar integrity covers it) before the asar is built; the `.node` file
  // itself is copied next to app.asar afterwards (a native library cannot be
  // loaded from inside an asar).
  const native = collectNativeArtifacts({ platform, arch });
  const stagedManifest = path.join(stage, 'app', NATIVE_MANIFEST_NAME);
  fs.rmSync(stagedManifest, { force: true });
  if (native.status === 'included' && native.hashFile) {
    fs.writeFileSync(path.join(stage, 'app', native.hashFile.name), native.hashFile.contents);
    console.log(`  native module: included (${native.reason})`);
    if (signing.windowsSign) {
      console.log(
        '  The .node file must already carry the same Authenticode signature as the app: it was\n' +
          '  hashed as it is now. Sign it (signtool) before packaging, never after.',
      );
    }
  } else if (native.status === 'not_built') {
    console.log(`  native module: not built — Electron-only status (${native.reason})`);
  }

  const icon =
    platform === 'darwin'
      ? path.join(ICON_DIRECTORY, 'icon.icns')
      : platform === 'win32'
        ? path.join(ICON_DIRECTORY, 'icon.ico')
        : undefined;

  const [appDirectory] = await packager({
    dir: path.join(stage, 'app'),
    out,
    name: APP_NAME,
    ...(platform === 'linux' ? { executableName: LINUX_EXECUTABLE } : {}),
    platform,
    arch,
    electronVersion,
    appVersion: version,
    appBundleId: APP_ID,
    appCategoryType: 'public.app-category.productivity',
    appCopyright: 'RealtimeDocs',
    asar: true,
    // The staged app has no node_modules: everything is bundled.
    prune: false,
    overwrite: true,
    tmpdir: path.join(stage, 'tmp'),
    download: { cacheRoot: process.env.ELECTRON_CACHE || path.join(stage, 'electron-cache') },
    ...(icon ? { icon } : {}),
    // Info.plist CFBundleURLTypes (macOS). Windows registers the scheme at first run.
    protocols: [{ name: APP_NAME, schemes: [URL_SCHEME] }],
    win32metadata: {
      CompanyName: 'RealtimeDocs',
      FileDescription: 'RealtimeDocs Desktop',
      ProductName: APP_NAME,
    },
    ...(signing.osxSign ? { osxSign: signing.osxSign } : {}),
    ...(signing.osxNotarize ? { osxNotarize: signing.osxNotarize } : {}),
    ...(signing.windowsSign ? { windowsSign: signing.windowsSign } : {}),
    afterExtract: [
      async ({ buildPath, platform: targetPlatform, arch: targetArch }) => {
        // Runs on the freshly extracted Electron, before it is renamed, sealed or signed.
        const mac = targetPlatform === 'darwin' || targetPlatform === 'mas';
        if (mac) {
          const removed = stripUsageDescriptions(path.join(buildPath, 'Electron.app'));
          const keys = [...new Set(removed.map((entry) => entry.split(': ')[1]))].sort();
          console.log(
            `  removed ${removed.length} usage-description string(s) from Info.plist files: ${keys.join(', ') || 'none'}`,
          );
        }
        const binary = mac
          ? path.join(buildPath, 'Electron.app')
          : path.join(buildPath, targetPlatform === 'win32' ? 'electron.exe' : 'electron');
        // Changing the fuse bytes invalidates the ad-hoc signature that Electron's
        // macOS build ships with, and Apple Silicon refuses to run code whose
        // signature is invalid. Nothing is re-signed here: on a Mac the FINISHED
        // app is always signed (`macSigning`), which covers this change, the
        // integrity digest that the packager embeds later, and the universal
        // build, whose two halves must stay unsigned until they are merged.
        await flipFuses(binary, fuseConfig(mac ? 'darwin' : targetPlatform));
        if (mac && process.platform !== 'darwin' && targetArch === 'arm64') {
          console.log(
            '  fuses changed WITHOUT re-signing (there is no codesign on this host). The ad-hoc signature of\n' +
              '  the Electron Framework is now invalid: Apple Silicon will refuse to start this app until it is\n' +
              '  signed on a Mac.',
          );
        }
      },
    ],
  });
  if (!appDirectory) throw new Error('the packager did not report an output directory');
  console.log(`  packaged: ${path.relative(process.cwd(), appDirectory)}`);
  fs.rmSync(stagedManifest, { force: true });
  if (native.status === 'included') {
    for (const { from, to } of native.files) {
      const target = path.join(appDirectory, 'resources', to);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(from, target);
      console.log(`  native module copied to resources/${to} (outside app.asar)`);
    }
  }

  if (platform === 'darwin' && process.platform === 'darwin') {
    // The finished app must carry a signature that matches its content, or
    // Apple Silicon will not start it. Checked here so that a build which
    // somehow ended up without one fails now, with the reason, instead of on
    // somebody's Mac. (Like the signing itself, never executed: see `macSigningPlan`.)
    const bundle = path.join(appDirectory, `${APP_NAME}.app`);
    const verified = spawnSync('codesign', ['--verify', '--deep', '--strict', bundle], {
      encoding: 'utf8',
    });
    if (verified.status !== 0) {
      throw new Error(
        `the finished app has no valid code signature (codesign --verify failed: ${String(verified.stderr || verified.error?.message || '').trim()}). ` +
          'It would not start on Apple Silicon. Nothing was archived.',
      );
    }
    console.log('  code signature verified (codesign --verify --deep --strict).');
  }

  const archives = archiveOutput ? archive(appDirectory, platform, arch, version, out) : [];
  for (const file of archives) {
    console.log(
      `  archive:  ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB)`,
    );
  }

  let ok = true;
  if (inspect) {
    const inspection = await inspectPackage(appDirectory, platform, arch);
    printInspection(inspection);
    ok = inspection.ok;
    for (const file of archives.filter((name) => name.endsWith('.zip'))) {
      const archiveInspection = inspectArchive(file, platform, arch);
      printInspection(archiveInspection);
      ok = ok && archiveInspection.ok;
    }
  }
  return { platform, arch, appDirectory, archives, ok };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest();
  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
  ).version;

  console.log(
    `Building ${APP_NAME} ${manifest.version} (production) for Electron ${electronVersion}`,
  );
  fs.mkdirSync(stage, { recursive: true });
  await buildApp({ mode: 'production', out: path.join(stage, 'app') });

  const results = [];
  let failed = false;
  for (const arch of options.arch) {
    try {
      results.push(
        await packageOne({
          platform: options.platform,
          arch,
          out: options.out,
          version: manifest.version,
          electronVersion,
          archiveOutput: options.archive,
          inspect: options.inspect,
        }),
      );
    } catch (error) {
      failed = true;
      console.error(
        `  FAILED ${options.platform}-${arch}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const host = `${process.platform}-${process.arch}`;
  console.log('');
  for (const result of results) {
    const native = result.platform === process.platform;
    const origin = native
      ? `built on ${host}`
      : `CROSS-BUILT on ${host}, unsigned, never executed on ${result.platform === 'win32' ? 'Windows' : 'macOS'}`;
    console.log(
      `${result.platform}-${result.arch}: ${origin}${result.ok ? '' : ' -- INSPECTION FOUND PROBLEMS'}`,
    );
    if (!result.ok) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

await main();
