#!/usr/bin/env node
/**
 * The real stack for the web app's integration tests (`apps/web/test-real`):
 * PostgreSQL, the real server (API, collaboration, static web app with the
 * real CSP header) and a first administrator, all inside the web agent's
 * resource range and on 127.0.0.1 only.
 *
 *   node apps/web/test-real/stack.mjs up [--no-build]   start and stay in the foreground
 *   node apps/web/test-real/stack.mjs down              stop a running `up`
 *   node apps/web/test-real/stack.mjs status
 *
 * What `up` does:
 *   1. writes `apps/web/.stage/real.env` with generated secrets (scripts/init-env.mjs);
 *      the repository's root `.env` is never created or read;
 *   2. starts PostgreSQL as container `rd-web-pg` on 127.0.0.1:54430 (data in memory);
 *   3. builds the web app and the server, and copies the server bundle into
 *      `apps/web/.stage/real/server` so that somebody else rebuilding
 *      `apps/server/dist` cannot pull it away under the running process;
 *   4. starts the server on 127.0.0.1:4430 with `WEB_DIST_DIR` = `apps/web/dist`;
 *   5. creates the first administrator with a password generated here and passed
 *      on standard input (never printed, never a shared default), and the sample document;
 *   6. serves a control endpoint on 127.0.0.1:4432 so a test can stop and start
 *      the server (the "server goes away while typing" scenario);
 *   7. writes `apps/web/.stage/real/state.json` (owner-only) for the tests.
 *
 * Stopping (`down`, Ctrl+C or SIGTERM) stops the server, removes the container
 * and the state file. Only the container named `rd-web-pg` is ever removed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..', '..');
const serverRoot = path.join(repoRoot, 'apps', 'server');

const SERVER_PORT = 4430;
const DEV_PORT = 4431;
const CONTROL_PORT = 4432;
const DB_PORT = 54430;
const DB_CONTAINER = 'rd-web-pg';
const DB_IMAGE = 'postgres:17.11-alpine';

const envFile = path.join(webRoot, '.stage', 'real.env');
const stage = path.join(webRoot, '.stage', 'real');
const stateFile = path.join(stage, 'state.json');
const serverCopy = path.join(stage, 'server');
const serverLog = path.join(stage, 'server.log');
const baseUrl = `http://127.0.0.1:${SERVER_PORT}`;

const ADMIN = { email: 'ada.admin@realtimedocs.test', displayName: 'Ada Admin' };

const log = (line) => process.stdout.write(`[stack] ${line}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

function must(command, args, options = {}) {
  const result = run(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} … exited with ${result.status}`);
  }
}

/** KEY=VALUE lines of the generated env file. Values are never logged. */
function readEnv(file) {
  const values = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function ensureEnvFile() {
  if (existsSync(envFile)) return;
  must(process.execPath, [
    path.join(repoRoot, 'scripts', 'init-env.mjs'),
    '--file',
    envFile,
    '--port',
    String(SERVER_PORT),
    '--db-port',
    String(DB_PORT),
  ]);
}

function removeDatabase() {
  // Exact name only: this script never touches a container it did not create.
  run('docker', ['rm', '-f', DB_CONTAINER]);
}

async function startDatabase(env) {
  removeDatabase();
  const password = env.get('POSTGRES_PASSWORD');
  if (!password) throw new Error(`${envFile} has no POSTGRES_PASSWORD.`);
  must(
    'docker',
    [
      'run',
      '-d',
      '--name',
      DB_CONTAINER,
      '-p',
      `127.0.0.1:${DB_PORT}:5432`,
      '-e',
      'POSTGRES_USER=realtimedocs',
      '-e',
      'POSTGRES_DB=realtimedocs',
      // Taken from this process's environment, so the value is not in any command line.
      '-e',
      'POSTGRES_PASSWORD',
      // Test data lives in memory and goes away with the container.
      '--tmpfs',
      '/var/lib/postgresql/data:rw',
      DB_IMAGE,
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = run('docker', [
      'exec',
      DB_CONTAINER,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'realtimedocs',
      '-d',
      'realtimedocs',
    ]);
    if (ready.status === 0) return;
    await sleep(500);
  }
  throw new Error('PostgreSQL did not become ready.');
}

function build() {
  log('building the web app');
  must('pnpm', ['--filter', '@realtimedocs/web', 'run', 'build'], { cwd: repoRoot });
  log('building the server');
  must('pnpm', ['--filter', '@realtimedocs/server', 'run', 'build'], { cwd: repoRoot });
}

/** A private copy of the server bundle, with its resources where it looks for them. */
function stageServer() {
  rmSync(serverCopy, { recursive: true, force: true });
  mkdirSync(serverCopy, { recursive: true });
  cpSync(path.join(serverRoot, 'dist'), path.join(serverCopy, 'dist'), { recursive: true });
  for (const resource of ['migrations', 'assets']) {
    symlinkSync(path.join(serverRoot, resource), path.join(serverCopy, resource), 'dir');
  }
}

/** Folder the server publishes desktop builds from while a test has asked for one; else unset. */
const downloadScratch = path.join(stage, 'downloads');
let publishDownloads = false;
let allowSignup = false;

function serverEnvironment() {
  const env = {
    ...process.env,
    RD_ENV_FILE: envFile,
    NODE_ENV: 'production',
    WEB_DIST_DIR: path.join(webRoot, 'dist'),
    ASSET_DIR: path.join(stage, 'assets'),
    // The Vite development server of this stack (`vite --port 4431`).
    ALLOWED_ORIGINS: `http://127.0.0.1:${DEV_PORT}`,
  };
  // DOWNLOAD_DIR is either the scratch folder or not set at all, whatever the caller's shell had.
  delete env.DOWNLOAD_DIR;
  if (publishDownloads) env.DOWNLOAD_DIR = downloadScratch;
  delete env.ALLOW_SIGNUP;
  if (allowSignup) env.ALLOW_SIGNUP = 'true';
  return env;
}

/** Restarts the server with the scratch download folder (holding `files`) or without any. */
async function setDownloads(files, release = null) {
  await stopServer('SIGTERM');
  rmSync(downloadScratch, { recursive: true, force: true });
  publishDownloads = files !== null;
  if (files !== null) {
    mkdirSync(downloadScratch, { recursive: true });
    for (const { name, bytes } of files) {
      writeFileSync(path.join(downloadScratch, name), Buffer.alloc(bytes, 0x5a));
    }
    if (release) writeFileSync(path.join(downloadScratch, 'release.json'), JSON.stringify(release));
  }
  await startServer();
}

let server = null;

async function waitUntilReady() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (server === null) throw new Error(`The server exited while starting. See ${serverLog}.`);
    try {
      const response = await fetch(`${baseUrl}/api/ready`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error(`The server did not become ready. See ${serverLog}.`);
}

async function startServer() {
  if (server) return;
  const out = openSync(serverLog, 'a');
  const child = spawn(
    process.execPath,
    ['--enable-source-maps', path.join(serverCopy, 'dist', 'main.js')],
    { cwd: serverCopy, env: serverEnvironment(), stdio: ['ignore', out, out] },
  );
  server = child;
  child.once('exit', () => {
    if (server === child) server = null;
  });
  await waitUntilReady();
}

async function stopServer(signal = 'SIGTERM') {
  const child = server;
  if (!child) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill(signal);
  });
  server = null;
}

function cli(args, input) {
  const result = run(process.execPath, [path.join(serverCopy, 'dist', 'cli.js'), ...args], {
    cwd: serverCopy,
    env: serverEnvironment(),
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `realtimedocs ${args[0]} failed (exit ${result.status}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function startControl(token) {
  const control = createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${token}`) {
      reply(401, { error: 'unauthorized' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://control.invalid');
    const route = `${request.method} ${url.pathname}`;
    const done = (work) =>
      work.then(
        () => reply(200, { running: server !== null }),
        (error) => reply(500, { error: String(error?.message ?? error) }),
      );
    if (route === 'GET /status') reply(200, { running: server !== null });
    else if (route === 'POST /server/stop') void done(stopServer('SIGTERM'));
    else if (route === 'POST /server/kill') void done(stopServer('SIGKILL'));
    else if (route === 'POST /server/start') void done(startServer());
    else if (route === 'POST /downloads/publish') {
      // ?file=<name>&bytes=<n>: only that file; the server restarts with DOWNLOAD_DIR set.
      const name = url.searchParams.get('file') ?? '';
      const bytes = Number.parseInt(url.searchParams.get('bytes') ?? '', 10);
      if (!/^realtimedocs-[a-z0-9-]+\.zip$/.test(name) || !Number.isInteger(bytes) || bytes < 0) {
        reply(400, { error: 'bad file or bytes' });
      } else {
        const version = url.searchParams.get('version');
        const signed = url.searchParams.get('signed');
        const release =
          version === null
            ? null
            : {
                version,
                notes: 'Scratch build for tests.',
                signed: signed === null ? null : signed === 'true',
              };
        void done(setDownloads([{ name, bytes }], release));
      }
    } else if (route === 'POST /signup/enable' || route === 'POST /signup/disable') {
      allowSignup = route.endsWith('enable');
      void done(stopServer('SIGTERM').then(startServer));
    } else if (route === 'POST /downloads/reset') void done(setDownloads(null));
    else reply(404, { error: 'unknown route' });
  });
  return new Promise((resolve, reject) => {
    control.once('error', reject);
    control.listen(CONTROL_PORT, '127.0.0.1', () => resolve(control));
  });
}

async function up(options) {
  if (existsSync(stateFile)) {
    throw new Error(`${stateFile} exists: the stack seems to be running. Run "down" first.`);
  }
  mkdirSync(stage, { recursive: true });
  rmSync(serverLog, { force: true });
  rmSync(path.join(stage, 'assets'), { recursive: true, force: true });

  ensureEnvFile();
  const env = readEnv(envFile);
  let control = null;
  let stopping = false;
  const shutdown = async (code) => {
    if (stopping) return;
    stopping = true;
    log('stopping');
    rmSync(stateFile, { force: true });
    control?.close();
    await stopServer('SIGTERM').catch(() => {});
    rmSync(downloadScratch, { recursive: true, force: true });
    removeDatabase();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  try {
    log(`starting PostgreSQL (${DB_CONTAINER}, 127.0.0.1:${DB_PORT})`);
    await startDatabase(env);
    if (options.build) build();
    stageServer();
    log(`starting the server (${baseUrl})`);
    await startServer();

    const password = randomBytes(18).toString('base64url');
    cli(
      ['bootstrap-admin', '--email', ADMIN.email, '--name', ADMIN.displayName, '--password-stdin'],
      `${password}\n`,
    );
    cli(['seed-sample', '--owner-email', ADMIN.email]);
    log('created the first administrator and the sample document');

    const controlToken = randomBytes(24).toString('base64url');
    control = await startControl(controlToken);
    writeFileSync(
      stateFile,
      `${JSON.stringify(
        {
          pid: process.pid,
          baseUrl,
          devUrl: `http://127.0.0.1:${DEV_PORT}`,
          controlUrl: `http://127.0.0.1:${CONTROL_PORT}`,
          controlToken,
          admin: { ...ADMIN, password },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    log(`ready. State: ${path.relative(repoRoot, stateFile)}. Stop with Ctrl+C or "down".`);
  } catch (error) {
    process.stderr.write(`[stack] ${error instanceof Error ? error.message : String(error)}\n`);
    await shutdown(1);
  }
}

async function down() {
  if (existsSync(stateFile)) {
    const { pid } = JSON.parse(readFileSync(stateFile, 'utf8'));
    try {
      process.kill(pid, 'SIGTERM');
      for (let attempt = 0; attempt < 100 && existsSync(stateFile); attempt += 1) await sleep(100);
    } catch {
      // The supervising process is already gone.
    }
    rmSync(stateFile, { force: true });
  }
  removeDatabase();
  log('stopped');
}

async function status() {
  if (!existsSync(stateFile)) {
    log('not running');
    return;
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const ready = await fetch(`${state.baseUrl}/api/ready`).then(
    (response) => response.ok,
    () => false,
  );
  log(
    `supervisor pid ${state.pid}; server ${ready ? 'ready' : 'not answering'} at ${state.baseUrl}`,
  );
}

const [command = 'status', ...flags] = process.argv.slice(2);
if (command === 'up') await up({ build: !flags.includes('--no-build') });
else if (command === 'down') await down();
else if (command === 'status') await status();
else {
  process.stderr.write('Usage: stack.mjs up [--no-build] | down | status\n');
  process.exit(64);
}
