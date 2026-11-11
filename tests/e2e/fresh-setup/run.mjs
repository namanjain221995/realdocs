#!/usr/bin/env node
/**
 * Acceptance scenario 20: a fresh, documented setup reaches the first working document.
 *
 *   node tests/e2e/fresh-setup/run.mjs [--keep]
 *
 * Follows README.md "First run with Docker Compose" literally, in an isolated Compose project
 * (`rd-e2e-fresh`, server 127.0.0.1:4331, database 127.0.0.1:54331, image `rd-e2e-fresh:local`):
 *   1. node scripts/init-env.mjs               (README step 1; `--file` keeps the repository's own .env untouched)
 *   2. docker compose up -d --build --wait     (step 2: builds the real image from the Dockerfile)
 *   3. docker compose exec server realtimedocs bootstrap-admin ... --generate   (step 3)
 *   4. docker compose exec server realtimedocs seed-sample                      (step 4)
 *   5. a browser (Playwright image) opens the printed address, signs in with the generated password,
 *      opens the sample, types, waits for "Saved", reloads and finds the text (step 5 and beyond).
 * Everything it created (containers, volumes, network, image, env file) is removed at the end
 * unless --keep is given. The default project `realtimedocs` and its ports are never addressed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const stage = path.join(here, '..', '.stage', 'fresh');
const envFile = path.join(stage, 'fresh.env');
const PROJECT = 'rd-e2e-fresh';
const PORT = 4331;
const DB_PORT = 54331;
const IMAGE = 'rd-e2e-fresh:local';
const PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';
const keep = process.argv.includes('--keep');

const log = (line) => process.stdout.write(`[fresh-setup] ${line}\n`);
const compose = (args, options = {}) =>
  spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      PROJECT,
      '--env-file',
      envFile,
      '-f',
      path.join(repoRoot, 'docker-compose.yml'),
      ...args,
    ],
    {
      encoding: 'utf8',
      cwd: repoRoot,
      env: {
        ...process.env,
        RD_COMPOSE_ENV_FILE: envFile,
        RD_IMAGE: IMAGE,
        RD_BUILD_TARGET: 'runtime',
      },
      ...options,
    },
  );

function purge() {
  // Only things that carry this Compose project's label.
  for (const [list, remove] of [
    [
      ['ps', '-aq'],
      ['rm', '--force', '--volumes'],
    ],
    [
      ['volume', 'ls', '-q'],
      ['volume', 'rm'],
    ],
    [
      ['network', 'ls', '-q'],
      ['network', 'rm'],
    ],
  ]) {
    const ids = spawnSync(
      'docker',
      [...list, '--filter', `label=com.docker.compose.project=${PROJECT}`],
      { encoding: 'utf8' },
    )
      .stdout.split('\n')
      .filter(Boolean);
    if (ids.length > 0) spawnSync('docker', [...remove, ...ids], { stdio: 'ignore' });
  }
  spawnSync('docker', ['rm', '-f', 'rd-e2e-pw-fresh'], { stdio: 'ignore' });
}

let code = 1;
try {
  purge();
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  log('step 1: node scripts/init-env.mjs');
  const init = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'init-env.mjs'),
      '--file',
      envFile,
      '--port',
      String(PORT),
      '--db-port',
      String(DB_PORT),
    ],
    { encoding: 'utf8' },
  );
  if (init.status !== 0 || !existsSync(envFile)) throw new Error(`init-env failed: ${init.stderr}`);

  log('step 2: docker compose up -d --build --wait (builds the image; takes minutes)');
  const up = compose(['up', '-d', '--build', '--wait'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (up.status !== 0) throw new Error('docker compose up failed');

  log('step 3: bootstrap-admin --generate');
  const email = 'first.admin@realtimedocs.test';
  const boot = compose([
    'exec',
    '-T',
    'server',
    'realtimedocs',
    'bootstrap-admin',
    '--email',
    email,
    '--name',
    'First Admin',
    '--generate',
  ]);
  if (boot.status !== 0) throw new Error(`bootstrap-admin failed: ${boot.stderr}`);
  const password = boot.stdout.trim().split('\n').at(-1) ?? '';
  if (password.length < 20) throw new Error('bootstrap-admin did not print a generated password');

  log('step 4: seed-sample');
  const seed = compose(['exec', '-T', 'server', 'realtimedocs', 'seed-sample']);
  if (seed.status !== 0) throw new Error(`seed-sample failed: ${seed.stderr}`);
  log(`seed-sample printed: ${seed.stdout.trim().split('\n').at(-1)}`);

  log('step 5: a browser signs in and edits');
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      'rd-e2e-pw-fresh',
      '--network',
      'host',
      '--user',
      '1000:1000',
      '-e',
      'HOME=/tmp',
      '-e',
      `RD_FRESH_URL=http://127.0.0.1:${PORT}`,
      '-e',
      `RD_FRESH_EMAIL=${email}`,
      '-e',
      'RD_FRESH_PASSWORD',
      '-v',
      `${repoRoot}:/work`,
      '-w',
      '/work/tests/e2e',
      PLAYWRIGHT_IMAGE,
      'node',
      '/work/node_modules/@playwright/test/cli.js',
      'test',
      '-c',
      'fresh-setup/playwright.config.ts',
      ...process.argv.slice(2).filter((arg) => arg !== '--keep'),
    ],
    { stdio: 'inherit', env: { ...process.env, RD_FRESH_PASSWORD: password } },
  );
  code = result.status ?? 1;
} catch (error) {
  process.stderr.write(`[fresh-setup] ${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  if (!keep) {
    log('cleaning up');
    purge();
    spawnSync('docker', ['image', 'rm', IMAGE], { stdio: 'ignore' });
    rmSync(stage, { recursive: true, force: true });
  }
}
process.exit(code);
