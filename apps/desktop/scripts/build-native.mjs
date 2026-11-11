// Builds native/win-display-affinity for the Electron target. WINDOWS HOSTS ONLY.
//
//   node scripts/build-native.mjs [--arch x64|arm64]
//
// Needs on the Windows host: Visual Studio Build Tools 2022 with "Desktop development with C++"
// and a Windows 10/11 SDK, Python 3, and node-gyp (the copy bundled with npm is found through
// `npm_config_node_gyp`, or install it once with `npm i -g node-gyp`). Electron headers are
// downloaded from https://electronjs.org/headers.
//
// Output: native/dist/win32-<arch>/display_affinity.node and display_affinity.node.sha256.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DIST_DIR,
  NATIVE_ARCHES,
  NATIVE_MODULE_FILE,
  sha256Of,
} from './lib/native-artifacts.mjs';

export const ELECTRON_TARGET = '45.2.3';
export const ELECTRON_HEADERS = 'https://electronjs.org/headers';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = path.resolve(here, '../native/win-display-affinity');

/** Pure planning step, so it can be tested on any host. */
export function planBuild({ hostPlatform, hostArch, argv }) {
  if (hostPlatform !== 'win32') {
    return {
      ok: false,
      message:
        `The Windows diagnostics module can only be built on a Windows host (this host: ${hostPlatform}). ` +
        'Nothing was built. Packages made elsewhere ship without it and the app reports ' +
        '"Diagnostics module not present — status from Electron only".',
    };
  }
  const index = argv.indexOf('--arch');
  const arch = index >= 0 ? argv[index + 1] : hostArch;
  if (!NATIVE_ARCHES.includes(arch)) {
    return {
      ok: false,
      message: `--arch must be one of ${NATIVE_ARCHES.join(', ')} (got ${arch}).`,
    };
  }
  return {
    ok: true,
    arch,
    args: [
      'rebuild',
      `--directory=${MODULE_DIR}`,
      '--runtime=electron',
      `--target=${ELECTRON_TARGET}`,
      `--arch=${arch}`,
      `--dist-url=${ELECTRON_HEADERS}`,
    ],
  };
}

function findNodeGyp() {
  try {
    return {
      command: process.execPath,
      prefix: [createRequire(import.meta.url).resolve('node-gyp/bin/node-gyp.js')],
    };
  } catch {
    /* not installed locally */
  }
  const fromNpm = process.env.npm_config_node_gyp;
  if (fromNpm && fs.existsSync(fromNpm)) return { command: process.execPath, prefix: [fromNpm] };
  return { command: 'node-gyp', prefix: [], shell: true };
}

function main() {
  const plan = planBuild({
    hostPlatform: process.platform,
    hostArch: process.arch,
    argv: process.argv.slice(2),
  });
  if (!plan.ok) {
    console.error(plan.message);
    process.exit(2);
  }
  const gyp = findNodeGyp();
  console.log(`building display_affinity for Electron ${ELECTRON_TARGET} win32-${plan.arch}`);
  const run = spawnSync(gyp.command, [...gyp.prefix, ...plan.args], {
    stdio: 'inherit',
    shell: gyp.shell === true,
  });
  if (run.status !== 0) {
    console.error(
      `node-gyp failed (${run.error?.message ?? `exit ${run.status}`}). Check the requirements at the top of scripts/build-native.mjs.`,
    );
    process.exit(1);
  }
  const built = path.join(MODULE_DIR, 'build', 'Release', NATIVE_MODULE_FILE);
  const outDir = path.join(DEFAULT_DIST_DIR, `win32-${plan.arch}`);
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, NATIVE_MODULE_FILE);
  fs.copyFileSync(built, target);
  const digest = sha256Of(fs.readFileSync(target));
  fs.writeFileSync(`${target}.sha256`, `${digest}  ${NATIVE_MODULE_FILE}\n`);
  console.log(`wrote ${target}\nsha256 ${digest}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
