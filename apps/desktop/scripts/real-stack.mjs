#!/usr/bin/env node
// Runs the desktop app against the REAL stack: a real PostgreSQL, the real
// server (API + collaboration endpoint) and the real editor in the panel.
//
//   node scripts/real-stack.mjs [--skip-build] [-- <playwright args>]
//       start everything, run test/real/*.spec.ts, stop everything
//   node scripts/real-stack.mjs up [--skip-build]
//       start the stack and keep it running until Ctrl+C / SIGTERM
//   node scripts/real-stack.mjs test [--skip-build] [-- <playwright args>]
//       run the tests against a stack started with `up`
//
// Resources, all in the desktop agent's range and all on 127.0.0.1:
//   PostgreSQL   container rd-desk-pg, port 54440 (no volume: the data is gone afterwards)
//   server       port 4440, a child process of this script
//   control      port 4449: lets a test stop, kill and start the server
//   tests        container rd-desk-real (Playwright image, Xvfb), like the smoke run
//
// Nothing outside apps/desktop is written: the environment file, the server
// bundle, uploaded files and logs live in apps/desktop/.stage. The repository's
// own .env is never read or created. The server is bundled here from
// apps/server/src with the options of apps/server/build.mjs, into .stage, so a
// server that someone else runs from apps/server/dist is not disturbed.
//
// The administrator is created with the server's own command line tool and a
// generated password, which exists only in .stage/real/control.json (mode
// 0600) while the stack is up.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { buildApp } from './build.mjs';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const serverRoot = path.join(repoRoot, 'apps', 'server');
const stage = path.join(desktopRoot, '.stage');
const real = path.join(stage, 'real');
const envFile = path.join(stage, 'real.env');
const controlFile = path.join(real, 'control.json');
const serverDist = path.join(real, 'server', 'dist');
const serverLog = path.join(real, 'server.log');

const SERVER_PORT = 4440;
const DB_PORT = 54440;
const CONTROL_PORT = 4449;
const DB_CONTAINER = 'rd-desk-pg';
const TEST_CONTAINER = 'rd-desk-real';
const DB_IMAGE = 'postgres:17.11-alpine'; // the image of docker-compose.yml
const TEST_IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble';
const ORIGIN = `http://127.0.0.1:${SERVER_PORT}`;
const ADMIN_EMAIL = 'desk-admin@example.test';
/** apps/server/build.mjs as it was when its options were copied into `buildServer`. */
const SERVER_BUILD_SCRIPT_SHA256 =
  '513c2510fe38885bf82169867d1f96f95a09df43b515f4aefeebee07dfe09e14';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const own = separator === -1 ? argv : argv.slice(0, separator);
const forwarded = separator === -1 ? [] : argv.slice(separator + 1);
const mode = own.find((arg) => !arg.startsWith('--')) ?? 'all';
const skipBuild = own.includes('--skip-build');
if (!['all', 'up', 'test'].includes(mode)) {
  console.error(`Unknown mode: ${mode} (expected nothing, "up" or "test")`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => console.log(`[real] ${line}`);

function readEnvFile(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function ensureEnvFile() {
  if (fs.existsSync(envFile)) return;
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'init-env.mjs'),
      '--file',
      envFile,
      '--port',
      String(SERVER_PORT),
      '--db-port',
      String(DB_PORT),
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (result.status !== 0) throw new Error('scripts/init-env.mjs failed');
  log(`wrote ${path.relative(repoRoot, envFile)} (generated secrets, mode 0600)`);
}

/** The same bundle `apps/server/build.mjs` makes, written to .stage instead of apps/server/dist. */
async function buildServer() {
  const script = fs.readFileSync(path.join(serverRoot, 'build.mjs'));
  if (createHash('sha256').update(script).digest('hex') !== SERVER_BUILD_SCRIPT_SHA256) {
    log(
      'WARNING: apps/server/build.mjs changed since its options were copied into scripts/real-stack.mjs.',
    );
    log('         Compare the two and update SERVER_BUILD_SCRIPT_SHA256.');
  }
  fs.rmSync(path.dirname(serverDist), { recursive: true, force: true });
  await esbuild({
    absWorkingDir: serverRoot,
    entryPoints: { main: 'src/main.ts', cli: 'src/cli.ts' },
    outdir: serverDist,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'warning',
    external: ['pg-native', 'bufferutil', 'utf-8-validate'],
    banner: {
      js: [
        "import { createRequire as __rdCreateRequire } from 'node:module';",
        "import { fileURLToPath as __rdFileURLToPath } from 'node:url';",
        "import { dirname as __rdDirname } from 'node:path';",
        'const require = __rdCreateRequire(import.meta.url);',
        'const __filename = __rdFileURLToPath(import.meta.url);',
        'const __dirname = __rdDirname(__filename);',
      ].join('\n'),
    },
  });
  fs.writeFileSync(path.join(serverDist, 'package.json'), '{ "type": "module" }\n');
  // The server looks for these two directories next to its bundle.
  for (const directory of ['migrations', 'assets']) {
    fs.cpSync(path.join(serverRoot, directory), path.join(real, 'server', directory), {
      recursive: true,
    });
  }
}

function serverEnvironment() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    RD_ENV_FILE: envFile,
    NODE_ENV: 'production',
    // Uploaded files of this run, and no web app: only the API and the collaboration endpoint.
    ASSET_DIR: path.join(real, 'assets'),
    WEB_DIST_DIR: path.join(real, 'no-web-app'),
    LOG_LEVEL: 'info',
  };
}

function removeContainer(name) {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
}

async function startDatabase(env) {
  removeContainer(DB_CONTAINER);
  // The password goes through a file, not through the command line.
  const databaseEnv = path.join(real, 'pg.env');
  fs.writeFileSync(
    databaseEnv,
    `POSTGRES_USER=realtimedocs\nPOSTGRES_DB=realtimedocs\nPOSTGRES_PASSWORD=${env.POSTGRES_PASSWORD}\n`,
    { mode: 0o600 },
  );
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      DB_CONTAINER,
      '--env-file',
      databaseEnv,
      '-p',
      `127.0.0.1:${DB_PORT}:5432`,
      '--tmpfs',
      '/var/lib/postgresql/data',
      DB_IMAGE,
    ],
    { encoding: 'utf8' },
  );
  fs.rmSync(databaseEnv, { force: true });
  if (run.status !== 0) throw new Error(`docker run ${DB_CONTAINER} failed: ${run.stderr.trim()}`);
  // The image starts a temporary server while it initialises, so "ready" must hold twice.
  let ready = 0;
  for (let attempt = 0; attempt < 90 && ready < 2; attempt += 1) {
    await sleep(1000);
    const probe = spawnSync(
      'docker',
      ['exec', DB_CONTAINER, 'psql', '-U', 'realtimedocs', '-d', 'realtimedocs', '-c', 'select 1'],
      { stdio: 'ignore' },
    );
    ready = probe.status === 0 ? ready + 1 : 0;
  }
  if (ready < 2) throw new Error('PostgreSQL did not become ready');
}

/** Runs the server's command line tool; returns what it printed for the operator. */
function serverCli(args) {
  const result = spawnSync(process.execPath, [path.join(serverDist, 'cli.js'), ...args], {
    cwd: real,
    env: serverEnvironment(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    // stderr is the tool's JSON log; it never contains a password.
    throw new Error(`server command "${args[0]}" failed:\n${result.stderr.slice(-2000)}`);
  }
  return result.stdout;
}

class ServerProcess {
  child = null;

  async start() {
    if (this.child) return;
    const output = fs.openSync(serverLog, 'a');
    this.child = spawn(
      process.execPath,
      ['--enable-source-maps', path.join(serverDist, 'main.js')],
      { cwd: real, env: serverEnvironment(), stdio: ['ignore', output, output] },
    );
    fs.closeSync(output);
    const child = this.child;
    child.on('exit', () => {
      if (this.child === child) this.child = null;
    });
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`the server exited at start (see ${serverLog})`);
      try {
        const response = await fetch(`${ORIGIN}/api/ready`);
        if (response.ok) return;
      } catch {
        // not listening yet
      }
      await sleep(200);
    }
    throw new Error('the server did not become ready');
  }

  /** SIGTERM (orderly shutdown) or SIGKILL (as if the machine lost power). */
  async stop(signal = 'SIGTERM') {
    const child = this.child;
    if (!child) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill(signal);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    await exited;
    clearTimeout(timer);
    this.child = null;
  }
}

/** Lets the tests (in their container) stop, kill and start the server (on this host). */
function startControl(server, token) {
  const control = http.createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers['x-rd-control'] !== token) return reply(403, { ok: false });
    const actions = {
      'POST /server/stop': () => server.stop('SIGTERM'),
      'POST /server/kill': () => server.stop('SIGKILL'),
      'POST /server/start': () => server.start(),
      'GET /server/status': () => Promise.resolve(),
    };
    const action = actions[`${request.method} ${request.url}`];
    if (!action) return reply(404, { ok: false });
    action().then(
      () => reply(200, { ok: true, running: server.child !== null }),
      (error) => reply(500, { ok: false, message: String(error?.message ?? error) }),
    );
    return undefined;
  });
  return new Promise((resolve, reject) => {
    control.on('error', reject);
    control.listen(CONTROL_PORT, '127.0.0.1', () => resolve(control));
  });
}

/**
 * Runs the specs in the test container. Asynchronous on purpose: in the
 * one-process mode this same process serves the control endpoint the specs
 * use to stop and start the server, so it must not block while they run.
 */
function runTests() {
  if (!fs.existsSync(controlFile)) {
    throw new Error('The stack is not running. Start it with `node scripts/real-stack.mjs up`.');
  }
  removeContainer(TEST_CONTAINER);
  const quoted = forwarded.map((arg) => JSON.stringify(arg)).join(' ');
  const child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--init',
      '--name',
      TEST_CONTAINER,
      '--network',
      'host',
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '-e',
      'HOME=/tmp/home',
      '-e',
      'RD_REAL_CONTROL=/work/apps/desktop/.stage/real/control.json',
      // The Chromium sandbox stays on, exactly as in scripts/smoke.mjs.
      '--security-opt',
      'seccomp=unconfined',
      '-v',
      `${repoRoot}:/work`,
      '-w',
      '/work',
      TEST_IMAGE,
      'bash',
      '-c',
      `mkdir -p "$HOME" && xvfb-run -a --server-args="-screen 0 1600x900x24" node node_modules/@playwright/test/cli.js test -c apps/desktop/test/real/playwright.config.ts ${quoted}`,
    ],
    { stdio: 'inherit' },
  );
  return new Promise((resolve) => {
    child.on('error', () => {
      removeContainer(TEST_CONTAINER);
      resolve(1);
    });
    child.on('exit', (code) => {
      removeContainer(TEST_CONTAINER);
      resolve(code ?? 1);
    });
  });
}

async function main() {
  if (!skipBuild) {
    await buildApp({ mode: 'development' });
    // The bundle that gets packaged: one spec starts it (unpackaged) to see the
    // minified, code-split renderer under the policy against the real server.
    await buildApp({ mode: 'production', out: path.join(stage, 'app') });
  }
  if (mode === 'test') process.exit(await runTests());

  fs.mkdirSync(real, { recursive: true });
  fs.rmSync(controlFile, { force: true });
  fs.rmSync(path.join(real, 'assets'), { recursive: true, force: true });
  fs.rmSync(serverLog, { force: true });
  ensureEnvFile();
  const env = readEnvFile(envFile);
  if (env.RD_PORT !== String(SERVER_PORT) || env.RD_DB_PORT !== String(DB_PORT)) {
    throw new Error(`${envFile} is not for ports ${SERVER_PORT}/${DB_PORT}; delete it and retry.`);
  }

  const server = new ServerProcess();
  let control = null;
  let stopping = false;
  const stopAll = async () => {
    if (stopping) return;
    stopping = true;
    fs.rmSync(controlFile, { force: true });
    await new Promise((resolve) => {
      if (!control) return resolve();
      control.closeAllConnections();
      return control.close(resolve);
    });
    await server.stop().catch(() => undefined);
    removeContainer(DB_CONTAINER);
    log('stopped: server, control endpoint, database container removed');
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => void stopAll().then(() => process.exit(130)));
  }

  let status;
  try {
    log('bundling the server from apps/server/src');
    await buildServer();
    log(`starting PostgreSQL (${DB_IMAGE}) as ${DB_CONTAINER} on 127.0.0.1:${DB_PORT}`);
    await startDatabase(env);
    serverCli(['migrate']);
    const bootstrap = serverCli([
      'bootstrap-admin',
      '--email',
      ADMIN_EMAIL,
      '--name',
      'Dana Desk',
      '--generate',
    ]);
    // The tool prints the generated password once, as its last line.
    const adminPassword = bootstrap.trim().split('\n').at(-1)?.trim() ?? '';
    if (adminPassword.length < 12) throw new Error('could not read the generated password');
    log(`administrator ${ADMIN_EMAIL} created with a generated password`);
    serverCli(['seed-sample']);
    log('sample document seeded');
    await server.start();
    log(`server ready on ${ORIGIN} (log: ${path.relative(repoRoot, serverLog)})`);

    const controlToken = randomBytes(24).toString('base64url');
    control = await startControl(server, controlToken);
    fs.writeFileSync(
      controlFile,
      `${JSON.stringify(
        {
          origin: ORIGIN,
          controlUrl: `http://127.0.0.1:${CONTROL_PORT}`,
          controlToken,
          adminEmail: ADMIN_EMAIL,
          adminPassword,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    if (mode === 'up') {
      log('stack is up. Run the tests with `node scripts/real-stack.mjs test`; Ctrl+C stops it.');
      await new Promise(() => undefined);
    }
    status = await runTests();
  } finally {
    await stopAll();
  }
  process.exit(status ?? 1);
}

await main();
