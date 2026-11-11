#!/usr/bin/env node
/**
 * The stack of the acceptance suite (`tests/e2e`): PostgreSQL, the real server
 * bundle serving the real web build with its own Content-Security-Policy, a
 * first administrator and the sample document. Own range: server 4330,
 * control endpoint 4332, PostgreSQL 54330 (container `rd-e2e-pg`).
 *
 *   node tests/e2e/stack.mjs up [--no-build]   start and stay in the foreground
 *   node tests/e2e/stack.mjs down              stop a running `up`
 *   node tests/e2e/stack.mjs status
 *
 * Why this is not `apps/web/test-real/stack.mjs`: that script has its ports
 * (4430-4432, 54430) and its state file compiled in and cannot run next to the
 * web agent's own stack. The shape is the same on purpose.
 *
 * Differences: the web build is written to a private folder (`.stage/web`), so
 * nobody's `apps/web/dist` is touched; the database keeps its data in the
 * container (not tmpfs), so the control endpoint can stop and start PostgreSQL
 * ("database unavailable" scenarios) without losing it.
 *
 * Control endpoint (Bearer token from `.stage/state.json`):
 *   POST /server/stop|kill|start   SIGTERM, SIGKILL, start the server
 *   POST /server/config?COLLAB_TICKET_TTL_SECONDS=1   restart with that setting (no parameters: defaults)
 *   POST /db/stop|start            docker stop / start of `rd-e2e-pg`
 *   POST /downloads/publish?file=realtimedocs-win-x64.zip&bytes=n  (restarts the server)
 *   POST /downloads/reset
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
const repoRoot = path.resolve(here, '..', '..');
const serverRoot = path.join(repoRoot, 'apps', 'server');

export const SERVER_PORT = 4330;
const CONTROL_PORT = 4332;
const DB_PORT = 54330;
const DB_CONTAINER = 'rd-e2e-pg';
const DB_IMAGE = 'postgres:17.11-alpine';

const stage = path.join(here, '.stage');
const envFile = path.join(stage, 'stack.env');
const stateFile = path.join(stage, 'state.json');
const webDist = path.join(stage, 'web');
const serverCopy = path.join(stage, 'server');
const serverLog = path.join(stage, 'server.log');
const downloadScratch = path.join(stage, 'downloads');
const baseUrl = `http://127.0.0.1:${SERVER_PORT}`;
const ADMIN = { email: 'ada.admin@realtimedocs.test', displayName: 'Ada Admin' };

const log = (line) => process.stdout.write(`[e2e-stack] ${line}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}
function must(command, args, options = {}) {
  const result = run(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} exited with ${result.status}`);
}

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
  run('docker', ['rm', '-f', '-v', DB_CONTAINER]); // exact name only
}

async function waitForDatabase() {
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
      '-e',
      'POSTGRES_PASSWORD',
      DB_IMAGE,
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: 'ignore' },
  );
  await waitForDatabase();
}

function build(buildWeb) {
  if (buildWeb || !existsSync(path.join(webDist, 'index.html'))) {
    log('building the web app into tests/e2e/.stage/web');
    must(
      'pnpm',
      [
        '--filter',
        '@realtimedocs/web',
        'exec',
        'vite',
        'build',
        '--outDir',
        webDist,
        '--emptyOutDir',
      ],
      { cwd: repoRoot },
    );
  }
  if (!existsSync(path.join(serverRoot, 'dist', 'main.js'))) {
    log('building the server');
    must('pnpm', ['--filter', '@realtimedocs/server', 'run', 'build'], { cwd: repoRoot });
  }
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

let publishDownloads = false;
/** Extra server settings a spec asked for through the control endpoint (allow-listed). */
let extraEnv = {};
const CONFIGURABLE = new Set(['COLLAB_TICKET_TTL_SECONDS']);
function serverEnvironment() {
  const env = {
    ...process.env,
    RD_ENV_FILE: envFile,
    NODE_ENV: 'production',
    WEB_DIST_DIR: webDist,
    ASSET_DIR: path.join(stage, 'assets'),
    // One address plays every user: keep the per-address limits out of the way.
    // Per-account, per-link and per-socket limits stay at their defaults.
    RATE_LOGIN_PER_IP: '100000',
    RATE_SHARE_EXCHANGE_PER_IP: '100000',
    RATE_INVITE_PER_IP: '100000',
    RATE_WS_UPGRADE_PER_MINUTE: '100000',
    RATE_COLLAB_TICKET_PER_MINUTE: '100000',
  };
  delete env.DOWNLOAD_DIR;
  if (publishDownloads) env.DOWNLOAD_DIR = downloadScratch;
  delete env.ALLOW_SIGNUP;
  return { ...env, ...extraEnv };
}

let server = null;

async function waitUntilReady() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
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
    {
      cwd: serverCopy,
      env: serverEnvironment(),
      stdio: ['ignore', out, out],
    },
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
  if (result.status !== 0)
    throw new Error(
      `realtimedocs ${args[0]} failed (exit ${result.status}): ${result.stderr.trim()}`,
    );
  return result.stdout;
}

async function setDownloads(file, bytes) {
  await stopServer('SIGTERM');
  rmSync(downloadScratch, { recursive: true, force: true });
  publishDownloads = file !== null;
  if (file !== null) {
    mkdirSync(downloadScratch, { recursive: true });
    writeFileSync(path.join(downloadScratch, file), Buffer.alloc(bytes, 0x5a));
  }
  await startServer();
}

function startControl(token) {
  const control = createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${token}`)
      return reply(401, { error: 'unauthorized' });
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
    else if (route === 'POST /server/config') {
      // ?COLLAB_TICKET_TTL_SECONDS=1 : restart the server with that setting; no parameters: back to the defaults.
      const next = {};
      for (const [key, value] of url.searchParams) {
        if (!CONFIGURABLE.has(key) || !/^[0-9]{1,6}$/.test(value))
          return reply(400, { error: 'setting not allowed' });
        next[key] = value;
      }
      extraEnv = next;
      void done(stopServer('SIGTERM').then(startServer));
    } else if (route === 'POST /db/stop') {
      const result = run('docker', ['stop', '-t', '1', DB_CONTAINER]);
      reply(result.status === 0 ? 200 : 500, { stderr: result.stderr });
    } else if (route === 'POST /db/start') {
      const result = run('docker', ['start', DB_CONTAINER]);
      if (result.status !== 0) return reply(500, { stderr: result.stderr });
      void done(waitForDatabase());
    } else if (route === 'POST /downloads/publish') {
      const name = url.searchParams.get('file') ?? '';
      const bytes = Number.parseInt(url.searchParams.get('bytes') ?? '', 10);
      if (!/^realtimedocs-[a-z0-9-]+\.zip$/.test(name) || !Number.isInteger(bytes) || bytes < 0) {
        reply(400, { error: 'bad file or bytes' });
      } else void done(setDownloads(name, bytes));
    } else if (route === 'POST /downloads/reset') void done(setDownloads(null, 0));
    else reply(404, { error: 'unknown route' });
  });
  return new Promise((resolve, reject) => {
    control.once('error', reject);
    control.listen(CONTROL_PORT, '127.0.0.1', () => resolve(control));
  });
}

async function up(options) {
  if (existsSync(stateFile))
    throw new Error(`${stateFile} exists: the stack seems to be running. Run "down" first.`);
  mkdirSync(stage, { recursive: true });
  rmSync(serverLog, { force: true });
  rmSync(path.join(stage, 'assets'), { recursive: true, force: true });
  rmSync(envFile, { force: true }); // fresh secrets for every run
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
    build(options.build);
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
      `${JSON.stringify({ pid: process.pid, baseUrl, controlUrl: `http://127.0.0.1:${CONTROL_PORT}`, controlToken, admin: { ...ADMIN, password } }, null, 2)}\n`,
      { mode: 0o600 },
    );
    log(`ready. State: ${path.relative(repoRoot, stateFile)}. Stop with Ctrl+C or "down".`);
  } catch (error) {
    process.stderr.write(`[e2e-stack] ${error instanceof Error ? error.message : String(error)}\n`);
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
      // Already gone.
    }
    rmSync(stateFile, { force: true });
  }
  removeDatabase();
  log('stopped');
}

async function status() {
  if (!existsSync(stateFile)) return log('not running');
  const response = await fetch(`${baseUrl}/api/ready`).catch(() => null);
  log(response?.ok ? 'running and ready' : 'state file present, server not ready');
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'up') await up({ build: !rest.includes('--no-build') });
else if (command === 'down') await down();
else if (command === 'status') await status();
else {
  process.stderr.write('usage: stack.mjs up [--no-build] | down | status\n');
  process.exit(64);
}
