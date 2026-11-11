#!/usr/bin/env node
// Runs the Electron smoke tests against the built app.
//
//   node scripts/smoke.mjs [--skip-build] [--native] [-- <playwright args>]
//       test/smoke/*.spec.ts with Playwright, against the development build
//   node scripts/smoke.mjs --packaged [--skip-build] [--native]
//       test/packaged/check-packaged.mjs against out/RealtimeDocs-linux-<arch>
//       (run `pnpm run package:linux` first)
//
// Default (the headless Linux build server): inside the Playwright Docker
// image under Xvfb. Container details that matter:
//   --init                           xvfb-run must not be PID 1 (it waits for a
//                                    signal that PID 1 never receives)
//   --security-opt seccomp=unconfined  lets Chromium create the user namespaces
//                                    its own sandbox needs. The Chromium sandbox
//                                    therefore stays ON; `--no-sandbox` is not used.
//   --network host                   the tests talk to fake servers on 127.0.0.1:4441/4442
//
// `--native` runs directly on this machine instead (Windows/macOS or a Linux
// desktop session; the packaged check is Linux only). A pass under Xvfb is
// Linux evidence only.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './build.mjs';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const own = separator === -1 ? argv : argv.slice(0, separator);
const forwarded = separator === -1 ? [] : argv.slice(separator + 1);
const skipBuild = own.includes('--skip-build');
const native = own.includes('--native');
const packaged = own.includes('--packaged');
const CONTAINER = packaged ? 'rd-desk-packaged' : 'rd-desk-smoke';

if (!skipBuild) {
  // Development build: it contains the env-gated test hook the smoke tests use,
  // and it is the control the packaged check compares against.
  await buildApp({ mode: 'development' });
}

const config = 'apps/desktop/test/smoke/playwright.config.ts';
const quoted = forwarded.map((arg) => JSON.stringify(arg)).join(' ');
// The packaged check starts its own Xvfb so that it can read the framebuffer.
const nodeArgs = packaged
  ? ['apps/desktop/test/packaged/check-packaged.mjs', ...forwarded]
  : ['node_modules/@playwright/test/cli.js', 'test', '-c', config, ...forwarded];
const inner = packaged
  ? `node apps/desktop/test/packaged/check-packaged.mjs ${quoted}`
  : // `-fbdir`: Xvfb keeps the screen in a file, so a test can take a picture of the
    // whole display (a native dialog is not part of any page screenshot).
    `mkdir -p /tmp/rd-xvfb && RD_XVFB_FBDIR=/tmp/rd-xvfb xvfb-run -a --server-args="-screen 0 1600x900x24 -fbdir /tmp/rd-xvfb" node node_modules/@playwright/test/cli.js test -c ${config} ${quoted}`;

let result;
if (native) {
  result = spawnSync(process.execPath, nodeArgs, { cwd: repoRoot, stdio: 'inherit' });
} else {
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--init',
      '--name',
      CONTAINER,
      '--network',
      'host',
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '-e',
      'HOME=/tmp/home',
      ...(process.env.RD_SMOKE_NO_SANDBOX === '1' ? ['-e', 'RD_SMOKE_NO_SANDBOX=1'] : []),
      // While the real stack is up (scripts/real-stack.mjs), the packaged check also uses it.
      ...(packaged && fs.existsSync(path.join(desktopRoot, '.stage', 'real', 'control.json'))
        ? ['-e', 'RD_REAL_CONTROL=/work/apps/desktop/.stage/real/control.json']
        : []),
      '--security-opt',
      'seccomp=unconfined',
      '-v',
      `${repoRoot}:/work`,
      '-w',
      '/work',
      IMAGE,
      'bash',
      '-c',
      `mkdir -p "$HOME" && ${inner}`,
    ],
    { stdio: 'inherit' },
  );
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
}
process.exit(result.status ?? 1);
