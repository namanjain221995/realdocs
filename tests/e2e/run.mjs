#!/usr/bin/env node
/**
 * One command for the acceptance suite: starts the stack (stack.mjs), runs the
 * Playwright specs inside the pinned Playwright image, stops everything.
 *
 *   node tests/e2e/run.mjs [--no-build] [--keep-stack] [-- <playwright arguments>]
 *
 * Default Playwright arguments run the three browsers. Anything after `--` replaces them,
 * e.g. `-- --project=chromium -g "images"`.
 * Needs Docker, the image mcr.microsoft.com/playwright:v1.64.1-noble, free ports
 * 4330-4332 and 54330 on 127.0.0.1.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const stage = path.join(here, '.stage');
const stateFile = path.join(stage, 'state.json');
const IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';
const CONTAINER = 'rd-e2e-pw';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split === -1 ? argv : argv.slice(0, split);
const passthrough = split === -1 ? [] : argv.slice(split + 1);
const noBuild = own.includes('--no-build');

mkdirSync(stage, { recursive: true });
rmSync(stateFile, { force: true });
const log = openSync(path.join(stage, 'stack.log'), 'w');
const stack = spawn(
  process.execPath,
  [path.join(here, 'stack.mjs'), 'up', ...(noBuild ? ['--no-build'] : [])],
  {
    stdio: ['ignore', log, log],
  },
);
let stackExited = false;
stack.once('exit', () => {
  stackExited = true;
});

let code = 1;
try {
  for (let waited = 0; !existsSync(stateFile); waited += 1) {
    if (stackExited)
      throw new Error(`The stack did not start. See ${path.join(stage, 'stack.log')}.`);
    if (waited > 1500) throw new Error('The stack did not become ready within 5 minutes.');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const docker = (args) =>
    spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        CONTAINER,
        '--network',
        'host',
        '--user',
        '1000:1000',
        '-e',
        'HOME=/tmp',
        '-v',
        `${repoRoot}:/work`,
        '-w',
        '/work/tests/e2e',
        IMAGE,
        'node',
        '/work/node_modules/@playwright/test/cli.js',
        'test',
        '-c',
        'playwright.config.ts',
        ...args,
      ],
      { stdio: 'inherit' },
    ).status ?? 1;
  if (passthrough.length > 0) {
    code = docker(passthrough);
  } else {
    // The specs that stop the shared server or database must not overlap with anything else.
    const parallel = docker(['--project=chromium', '--project=firefox', '--project=webkit']);
    const disruptive = docker([
      '--project=disruptive-chromium',
      '--project=disruptive-firefox',
      '--project=disruptive-webkit',
      '--workers=1',
    ]);
    code = parallel === 0 && disruptive === 0 ? 0 : 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  if (!own.includes('--keep-stack')) {
    spawnSync(process.execPath, [path.join(here, 'stack.mjs'), 'down'], { stdio: 'inherit' });
    if (!stackExited) stack.kill('SIGTERM');
  }
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
}
process.exit(code);
