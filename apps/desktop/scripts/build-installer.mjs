#!/usr/bin/env node
// Builds the per-user Windows installer (build/windows/installer.nsi) for the
// packaged Windows folders in out/.
//
//   node scripts/build-installer.mjs [--arch x64,arm64] [--container]
//
// On Windows (or any host with makensis 3.08+ on PATH) makensis runs directly.
// `--container` (the Linux build server) runs it in a throw-away Debian
// container named rd-desk-nsis, with NSIS installed from Debian's packages.
// Run `pnpm --filter @realtimedocs/desktop run package:win` first.
//
// Signing placeholder (Windows hosts only, environment only):
//   WINDOWS_INSTALLER_SIGN_COMMAND  e.g. signtool sign /fd SHA256 /tr <url> /td SHA256 /sha1 <thumbprint>
//   It signs the installer and the uninstaller it writes. Without it the
//   installer is UNSIGNED and Windows SmartScreen warns about it.
//
// An installer built on Linux is labelled "built on Linux, unsigned, never
// executed": nothing here can run it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, artifactFileName } from './lib/app-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = 'build/windows/installer.nsi';
const IMAGE = 'node:24-trixie-slim';
const CONTAINER = 'rd-desk-nsis';

function parseArgs(argv) {
  const options = { arch: ['x64', 'arm64'], container: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--arch') options.arch = String(argv[(index += 1)]).split(',');
    else if (arg === '--container') options.container = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const arch of options.arch) {
    if (arch !== 'x64' && arch !== 'arm64')
      throw new Error(`--arch must be x64 or arm64 (got ${arch})`);
  }
  return options;
}

/** "PE32" (x86) or "PE32+" (x64) and the machine, from the file's own header. */
export function peKind(file) {
  const buffer = fs.readFileSync(file);
  const offset = buffer.readUInt32LE(0x3c);
  if (buffer.toString('latin1', offset, offset + 4) !== 'PE\u0000\u0000') return null;
  const machine = buffer.readUInt16LE(offset + 4);
  const magic = buffer.readUInt16LE(offset + 24);
  return {
    format: magic === 0x20b ? 'PE32+' : magic === 0x10b ? 'PE32' : 'unknown',
    machine:
      machine === 0x8664
        ? 'x64'
        : machine === 0x14c
          ? 'x86'
          : machine === 0xaa64
            ? 'arm64'
            : 'other',
  };
}

/** `-D` works for makensis on every host; the `/D` form is Windows-only. */
function defines(arch, version, sourceDir, outFile, iconFile) {
  return [
    `-DARCH=${arch}`,
    `-DVERSION=${version}`,
    `-DSOURCE_DIR=${sourceDir}`,
    `-DOUT_FILE=${outFile}`,
    `-DICON_FILE=${iconFile}`,
  ];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const signCommand = process.env.WINDOWS_INSTALLER_SIGN_COMMAND?.trim() || null;
  let failed = false;

  for (const arch of options.arch) {
    const folder = `${APP_NAME}-win32-${arch}`;
    const outName = artifactFileName(version, 'win32', arch, 'exe');
    if (!fs.existsSync(path.join(root, 'out', folder, `${APP_NAME}.exe`))) {
      console.error(`FAILED ${arch}: out/${folder} is missing. Run package:win first.`);
      failed = true;
      continue;
    }
    fs.rmSync(path.join(root, 'out', outName), { force: true });
    let result;
    if (options.container) {
      if (signCommand)
        console.log(
          '  WINDOWS_INSTALLER_SIGN_COMMAND is ignored in the container: signing needs Windows.',
        );
      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      const args = defines(
        arch,
        version,
        `/work/out/${folder}`,
        `/work/out/${outName}`,
        '/work/build/icons/icon.ico',
      )
        .map((value) => JSON.stringify(value))
        .join(' ');
      spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
      result = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          CONTAINER,
          '-e',
          'DEBIAN_FRONTEND=noninteractive',
          '-v',
          `${root}:/work`,
          '-w',
          '/work',
          IMAGE,
          'bash',
          '-c',
          `set -e; apt-get update -qq >/dev/null; apt-get install -y -qq nsis >/dev/null; makensis -V2 ${args} ${script}; chown ${uid}:${gid} /work/out/${outName}`,
        ],
        { stdio: 'inherit' },
      );
    } else {
      const args = [
        ...defines(
          arch,
          version,
          path.join(root, 'out', folder),
          path.join(root, 'out', outName),
          path.join(root, 'build', 'icons', 'icon.ico'),
        ),
      ];
      if (signCommand) args.push(`-DSIGN_COMMAND=${signCommand}`);
      result = spawnSync('makensis', ['-V2', ...args, path.join(root, script)], {
        stdio: 'inherit',
      });
    }
    const target = path.join(root, 'out', outName);
    if (result.status !== 0 || !fs.existsSync(target)) {
      console.error(
        `FAILED ${arch}: makensis did not produce ${outName} (${result.error?.message ?? `exit ${result.status}`}).`,
      );
      failed = true;
      continue;
    }
    const kind = peKind(target);
    const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
    const host = `${process.platform}-${process.arch}`;
    const label =
      process.platform === 'win32'
        ? signCommand
          ? `built on ${host}, signed with the configured command`
          : `built on ${host}, UNSIGNED`
        : `built on Linux (${host}) in a container, unsigned, never executed`;
    console.log(
      `win32-${arch}: out/${outName} (${size} MB, ${kind?.format ?? '?'} ${kind?.machine ?? '?'} installer) — ${label}`,
    );
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
