#!/usr/bin/env node
// Native launch check for a packaged build: starts the real executable on the operating system it
// was built for and requires that it is still running after a while.
//
//   node scripts/launch-check.mjs --platform win32|darwin|linux --arch x64|arm64 [--seconds 20]
//
// What a pass means: the operating system loaded and started the packaged executable and the main
// process neither crashed nor exited during the wait. What it does NOT mean: nothing is clicked,
// no window content is inspected, capture exclusion is not measured and no meeting application is
// involved. It refuses to run a package for another platform or architecture: such a result would
// say nothing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'RealtimeDocs';

const { values } = parseArgs({
  options: {
    platform: { type: 'string', default: process.platform },
    arch: { type: 'string', default: process.arch },
    seconds: { type: 'string', default: '20' },
    out: { type: 'string', default: path.resolve(here, '../out') },
  },
});

function fail(message) {
  console.error(`launch-check: ${message}`);
  process.exit(1);
}

if (values.platform !== process.platform || values.arch !== process.arch) {
  fail(
    `this host is ${process.platform}-${process.arch}; a ${values.platform}-${values.arch} package is not started here.`,
  );
}
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) fail('--seconds must be 5 to 120');

const folder = path.join(values.out, `${APP_NAME}-${values.platform}-${values.arch}`);
const executable =
  values.platform === 'win32'
    ? path.join(folder, `${APP_NAME}.exe`)
    : values.platform === 'darwin'
      ? path.join(folder, `${APP_NAME}.app`, 'Contents', 'MacOS', APP_NAME)
      : path.join(folder, APP_NAME);
if (!fs.existsSync(executable)) fail(`no executable at ${executable}`);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-launch-check-'));
const args = [`--user-data-dir=${userData}`];
// A CI container or runner without a usable setuid sandbox helper: stated, not hidden.
if (values.platform === 'linux' && process.env.RD_LAUNCH_NO_SANDBOX === '1') {
  args.push('--no-sandbox');
}

console.log(`Starting ${executable} for ${seconds} s`);
const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const collect = (chunk) => {
  output = (output + chunk.toString()).slice(-8000);
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);

let exited = null;
child.on('exit', (code, signal) => {
  exited = { code, signal };
});
child.on('error', (error) => {
  exited = { code: null, signal: null, error: error.message };
});

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

if (exited) {
  console.error(output);
  fail(
    `the application ended within ${seconds} s (${JSON.stringify(exited)}). It did not stay running.`,
  );
}
console.log(`Still running after ${seconds} s (pid ${child.pid}). Stopping it.`);
child.kill();
await new Promise((resolve) => setTimeout(resolve, 2000));
if (exited === null) child.kill('SIGKILL');
fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
console.log(
  `RESULT: ${APP_NAME} ${values.platform}-${values.arch} started natively and stayed running.`,
);
process.exit(0);
