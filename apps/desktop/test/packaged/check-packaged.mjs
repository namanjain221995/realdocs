#!/usr/bin/env node
// Runs the PACKAGED Linux build (out/RealtimeDocs-linux-<arch>) and checks from
// the outside that the hardening of a packaged build is really in effect:
// start-up, renderer sandbox, single instance + deep link, "Open in Desktop"
// end to end against a stand-in server, and that ELECTRON_RUN_AS_NODE,
// NODE_OPTIONS, --inspect, --remote-debugging-port and a loose `app` folder
// are all ignored. When the real stack of scripts/real-stack.mjs is running
// (RD_REAL_CONTROL points at its control file), the packaged build also opens
// the sample document on the real server and must end up with a live
// collaboration connection.
//
// A packaged build has no test hook and accepts no debugger, so Playwright
// cannot attach to it. Everything here is observed from outside the process:
// its log lines (stderr), its process tree, TCP ports, files, and the X
// framebuffer.
//
// Every "is ignored" check has a CONTROL: the same probe against the
// development Electron binary, where it must succeed. A probe that cannot
// tell the difference would prove nothing.
//
//   node test/packaged/check-packaged.mjs [--app <packaged folder>]
//
// Normally started through `node scripts/smoke.mjs --packaged` (Docker + Xvfb).
// Linux evidence only. It says nothing about Windows or macOS.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { readDisplay } from '../lib/xwd.mjs';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const appFlag = argv.indexOf('--app');
const packagedDir = path.resolve(
  appFlag === -1
    ? path.join(desktopRoot, 'out', `RealtimeDocs-linux-${process.arch}`)
    : argv[appFlag + 1],
);
const packagedBinary = path.join(packagedDir, 'realtimedocs');
const devDist = path.join(desktopRoot, 'dist');
const resultsDir = path.join(desktopRoot, 'test-results', 'packaged');
// Scratch ports of the desktop agent (docs/notes/build-brief.md).
const SERVER_PORT = 4441;
const INSPECT_PORT = 4445;
const DEVTOOLS_PORT = 4446;
const SIGNAL_INSPECT_PORT = 4447;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-packaged-'));
const checks = [];
const notes = [];
const running = new Set();
let display = process.env.DISPLAY ?? '';
let framebufferDir = null;
let xvfb = null;

function record(ok, name, detail = '') {
  checks.push({ ok, name, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
}

/** An observation that is neither a pass nor a failure. */
function note(text) {
  notes.push(text);
  console.log(`  note ${text}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
}

/** Start a process in its own group, collecting its output. */
function launch(label, command, args, env = {}) {
  const home = path.join(work, `home-${label}`);
  fs.mkdirSync(path.join(home, '.config'), { recursive: true });
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      DISPLAY: display,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      ...env,
    },
  });
  const proc = { label, child, home, output: '', exit: null };
  child.stdout.on('data', (chunk) => (proc.output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk) => (proc.output += chunk.toString('utf8')));
  proc.exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      proc.exit = { code, signal };
      running.delete(proc);
      resolve(proc.exit);
    });
    child.on('error', (error) => {
      proc.exit = { code: null, signal: null, error: error.message };
      running.delete(proc);
      resolve(proc.exit);
    });
  });
  running.add(proc);
  return proc;
}

const started = (proc) => waitFor(() => proc.output.includes('"event":"app.started"'), 30_000);

/** Ask the app to quit; report whether it did so by itself. */
async function stop(proc) {
  if (proc.exit) return true;
  proc.child.kill('SIGTERM');
  const clean = await waitFor(() => proc.exit !== null, 10_000);
  if (!clean) {
    try {
      process.kill(-proc.child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
    await proc.exited;
  }
  // Give helper processes a moment to release ports and locks.
  await sleep(300);
  return clean;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

/** All processes below `rootPid`, with their command lines. */
function descendants(rootPid) {
  const parents = new Map();
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
      // The command name is in parentheses and may contain spaces.
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      parents.set(Number(name), Number(fields[1]));
    } catch {
      // The process ended while we were reading.
    }
  }
  const result = [];
  const visit = (pid) => {
    for (const [child, parent] of parents) {
      if (parent !== pid) continue;
      let cmdline = '';
      let status = '';
      try {
        cmdline = fs.readFileSync(`/proc/${child}/cmdline`, 'utf8').replaceAll('\u0000', ' ');
        status = fs.readFileSync(`/proc/${child}/status`, 'utf8');
      } catch {
        // gone
      }
      result.push({ pid: child, cmdline, status });
      visit(child);
    }
  };
  visit(rootPid);
  return result;
}

function screenshot(name) {
  const converted = readDisplay(framebufferDir);
  if (!converted) return null;
  const file = path.join(resultsDir, name);
  fs.writeFileSync(file, converted.png);
  return { ...converted, file };
}

async function startDisplay() {
  if (spawnSync('Xvfb', ['-help'], { stdio: 'ignore' }).error) {
    note('Xvfb not found: using the current DISPLAY, no screenshot.');
    return;
  }
  framebufferDir = path.join(work, 'framebuffer');
  fs.mkdirSync(framebufferDir, { recursive: true });
  for (let number = 97; number < 107; number += 1) {
    if (fs.existsSync(`/tmp/.X11-unix/X${number}`)) continue;
    xvfb = spawn(
      'Xvfb',
      [`:${number}`, '-screen', '0', '1600x900x24', '-fbdir', framebufferDir, '-nolisten', 'tcp'],
      { stdio: 'ignore' },
    );
    if (await waitFor(() => fs.existsSync(`/tmp/.X11-unix/X${number}`), 5000)) {
      display = `:${number}`;
      return;
    }
    xvfb.kill('SIGKILL');
    xvfb = null;
  }
  throw new Error('could not start Xvfb');
}

// ── the checks ───────────────────────────────────────────────────────────────

async function checkStartAndSandbox() {
  console.log('\nPackaged app: start-up, sandbox, single instance, deep link, quit');
  const app = launch('start', packagedBinary, []);
  const up = await started(app);
  record(up, 'packaged app starts', up ? '' : app.output.slice(-600));
  if (!up) {
    await stop(app);
    return;
  }
  await sleep(2500);

  record(
    app.output.includes('"packaged":true'),
    'the app reports itself as packaged',
    (/"event":"app.started"[^\n]*/.exec(app.output) ?? [''])[0],
  );
  const problems = [
    'startup.failed',
    'panel.load_failed',
    'panel.renderer_gone',
    'renderer.console',
    'renderer.policy_violation',
    'app_protocol.refused',
  ].filter((event) => app.output.includes(`"event":"${event}"`));
  record(
    problems.length === 0,
    'no load failure, renderer console error or CSP violation logged',
    problems.join(', '),
  );

  const processes = descendants(app.child.pid);
  const renderers = processes.filter((entry) => entry.cmdline.includes('--type=renderer'));
  record(renderers.length >= 1, 'a renderer process is running', `${renderers.length} renderer(s)`);
  const filtered = renderers.filter((entry) => /^Seccomp:\s*2$/m.test(entry.status));
  record(
    renderers.length >= 1 && filtered.length === renderers.length,
    'every renderer runs under a seccomp-bpf sandbox filter',
    renderers.map((entry) => (/^Seccomp:\s*(\d)$/m.exec(entry.status) ?? [])[1]).join(','),
  );
  const unsandboxed = processes.filter((entry) => entry.cmdline.includes('--no-sandbox'));
  record(unsandboxed.length === 0, 'no process was started with --no-sandbox');

  const preferences = path.join(app.home, '.config', 'RealtimeDocs');
  record(
    fs.existsSync(preferences),
    'profile is in the standard per-user location',
    path.relative(app.home, preferences),
  );

  const shot = screenshot('packaged-linux-first-run.png');
  if (shot) {
    record(
      shot.litRatio > 0.002,
      'the panel is drawn on screen',
      `${path.relative(desktopRoot, shot.file)} (${shot.width}x${shot.height}, ${(shot.litRatio * 100).toFixed(1)}% lit)`,
    );
  }

  // A second launch hands its link to the first instance and exits.
  const secret = 'S'.repeat(43);
  const link = `realtimedocs://open?server=${encodeURIComponent('https://docs.example.com')}&doc=3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d&code=${secret}`;
  const second = launch('second', packagedBinary, [link], {
    HOME: app.home,
    XDG_CONFIG_HOME: path.join(app.home, '.config'),
  });
  const secondExited = await waitFor(() => second.exit !== null, 15_000);
  record(
    secondExited && second.exit.code === 0,
    'a second launch exits by itself',
    JSON.stringify(second.exit),
  );
  if (!secondExited) await stop(second);
  const delivered = await waitFor(() => app.output.includes('"event":"deep_link.rejected"'), 5000);
  record(
    delivered && app.output.includes('"reason":"no_server_configured"'),
    'the first instance received the link and refused it (no server configured)',
  );
  record(
    !app.output.includes(secret) && !second.output.includes(secret),
    'the handoff code from the link is not in any log line',
  );

  const clean = await stop(app);
  record(clean, 'the app quits on SIGTERM', JSON.stringify(app.exit));
}

async function checkDebugFlags() {
  console.log('\n--inspect and --remote-debugging-port');
  const flags = [`--inspect=${INSPECT_PORT}`, `--remote-debugging-port=${DEVTOOLS_PORT}`];

  const control = launch('debug-control', electronPath, [...flags, devDist], {
    RD_DESKTOP_USER_DATA: path.join(work, 'profile-debug-control'),
  });
  const controlUp = await started(control);
  await waitFor(
    async () => (await portOpen(INSPECT_PORT)) && (await portOpen(DEVTOOLS_PORT)),
    5000,
  );
  const controlInspect = await portOpen(INSPECT_PORT);
  const controlDevtools = await portOpen(DEVTOOLS_PORT);
  record(
    controlUp && controlInspect && controlDevtools,
    'CONTROL development build: both debugging ports open',
    `inspector ${controlInspect ? 'open' : 'closed'}, DevTools ${controlDevtools ? 'open' : 'closed'}`,
  );
  await stop(control);
  await waitFor(
    async () => !(await portOpen(INSPECT_PORT)) && !(await portOpen(DEVTOOLS_PORT)),
    5000,
  );

  const app = launch('debug', packagedBinary, flags);
  const up = await started(app);
  await sleep(2000);
  const inspect = await portOpen(INSPECT_PORT);
  const devtools = await portOpen(DEVTOOLS_PORT);
  record(up, 'packaged app starts with the debugging flags present');
  record(!inspect, 'packaged: --inspect opens no inspector port', `port ${INSPECT_PORT}`);
  record(
    !devtools,
    'packaged: --remote-debugging-port opens no DevTools port',
    `port ${DEVTOOLS_PORT}`,
  );
  record(
    !/Debugger listening|DevTools listening/.test(app.output),
    'packaged: no "listening" line is printed',
  );
  await stop(app);
}

async function checkSignalInspector() {
  console.log('\nSIGUSR1 (Node.js starts its inspector on this signal)');
  const flag = `--inspect-port=${SIGNAL_INSPECT_PORT}`;

  const control = launch('signal-control', electronPath, [flag, devDist], {
    RD_DESKTOP_USER_DATA: path.join(work, 'profile-signal-control'),
  });
  const controlUp = await started(control);
  if (controlUp) control.child.kill('SIGUSR1');
  const controlOpen = await waitFor(() => portOpen(SIGNAL_INSPECT_PORT), 5000);
  record(
    controlUp && controlOpen,
    'CONTROL development build: SIGUSR1 opens the inspector',
    `port ${SIGNAL_INSPECT_PORT} ${controlOpen ? 'open' : 'closed'}`,
  );
  await stop(control);
  await waitFor(async () => !(await portOpen(SIGNAL_INSPECT_PORT)), 5000);

  const app = launch('signal', packagedBinary, [flag]);
  const up = await started(app);
  record(up, 'packaged app starts with --inspect-port present');
  if (up) app.child.kill('SIGUSR1');
  await sleep(2500);
  const open = await portOpen(SIGNAL_INSPECT_PORT);
  record(!open, 'packaged: SIGUSR1 opens no inspector port', `port ${SIGNAL_INSPECT_PORT}`);
  record(!/Debugger listening/.test(app.output), 'packaged: no "Debugger listening" line');
  note(
    app.exit
      ? `after SIGUSR1 the packaged process ended (${JSON.stringify(app.exit)}): with the inspector fuse off no handler is installed, so the signal has its default action`
      : 'after SIGUSR1 the packaged process kept running',
  );
  await stop(app);
}

async function checkRunAsNode() {
  console.log('\nELECTRON_RUN_AS_NODE');
  const script = (file) =>
    `require('node:fs').writeFileSync(${JSON.stringify(file)}, 'ran as node')`;

  const controlProof = path.join(work, 'proof-run-as-node-control');
  const control = launch('node-control', electronPath, ['-e', script(controlProof)], {
    ELECTRON_RUN_AS_NODE: '1',
  });
  await waitFor(() => control.exit !== null, 10_000);
  record(
    fs.existsSync(controlProof),
    'CONTROL development binary: runs the script as plain Node.js',
    JSON.stringify(control.exit),
  );
  await stop(control);

  const proof = path.join(work, 'proof-run-as-node');
  const app = launch('node', packagedBinary, ['-e', script(proof)], { ELECTRON_RUN_AS_NODE: '1' });
  const up = await started(app);
  await sleep(1000);
  record(up, 'packaged: starts as the app, not as Node.js');
  record(!fs.existsSync(proof), 'packaged: the script passed with -e did not run');
  await stop(app);
}

async function checkNodeOptions() {
  console.log('\nNODE_OPTIONS');
  const inject = (file) => {
    const module = path.join(work, `inject-${path.basename(file)}.cjs`);
    fs.writeFileSync(
      module,
      `require('node:fs').writeFileSync(${JSON.stringify(file)}, 'injected');\n`,
    );
    return `--require=${module}`;
  };

  const controlProof = path.join(work, 'proof-node-options-control');
  const control = launch('options-control', electronPath, [devDist], {
    NODE_OPTIONS: inject(controlProof),
    RD_DESKTOP_USER_DATA: path.join(work, 'profile-options-control'),
  });
  await started(control);
  record(
    fs.existsSync(controlProof),
    'CONTROL development build: NODE_OPTIONS --require injects a module',
  );
  await stop(control);

  const proof = path.join(work, 'proof-node-options');
  const app = launch('options', packagedBinary, [], {
    NODE_OPTIONS: inject(proof),
    ELECTRON_ENABLE_LOGGING: '1',
  });
  const up = await started(app);
  await sleep(1000);
  record(up, 'packaged app starts with NODE_OPTIONS set');
  record(!fs.existsSync(proof), 'packaged: the module named in NODE_OPTIONS was not loaded');
  const line = (/[^\n]*NODE_OPTIONS[^\n]*/.exec(app.output) ?? [''])[0];
  record(
    /disabled nodeOptions fuse/.test(line),
    'packaged: Electron says the fuse is the reason',
    line.trim().slice(0, 160),
  );
  await stop(app);
}

/** A stand-in RealtimeDocs server: just enough of the API for "Open in Desktop". */
function startStandInServer() {
  const origin = `http://127.0.0.1:${SERVER_PORT}`;
  const documentId = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
  const accountId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const code = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
  const token = 'packaged-check-session-token-0123456789abcdefgh';
  const requests = [];
  const headers = {
    'access-control-allow-origin': 'app://realtimedocs',
    'access-control-allow-headers': 'content-type, accept, x-rd-csrf',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
    // The desktop app signs in with a bearer token and must never use cookies.
    // This server offers some on every response to see whether one comes back.
    'set-cookie': ['rd_probe=1; Path=/', 'rd_probe_none=1; Path=/; SameSite=None; Secure'],
  };
  const json = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  };
  const session = { documentId, title: 'Packaged check document', role: 'editor', expiresAt: null };

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const pathname = new URL(request.url ?? '/', origin).pathname;
      requests.push({ method: request.method, path: pathname, headers: request.headers, body });
      if (request.method === 'OPTIONS') {
        response.writeHead(204, headers);
        response.end();
        return;
      }
      switch (`${request.method} ${pathname}`) {
        case 'GET /api/meta':
          json(response, 200, {
            name: 'RealtimeDocs',
            version: '0.1.0-packaged-check',
            schemaVersion: 1,
            minClientSchemaVersion: 1,
            protocolVersion: 1,
            publicOrigin: origin,
            limits: {},
            imageMimeTypes: [],
            attachmentExtensions: [],
          });
          return;
        case 'POST /api/desktop/redeem': {
          const parsed = JSON.parse(body || '{}');
          if (parsed.documentId !== documentId || parsed.code !== code) {
            json(response, 400, {
              error: { code: 'handoff_invalid', message: 'handoff_invalid' },
            });
            return;
          }
          json(response, 200, { ...session, token, accountId });
          return;
        }
        case 'GET /api/desktop/session':
          if (request.headers.authorization !== `Bearer ${token}`) {
            json(response, 401, {
              error: { code: 'unauthenticated', message: 'unauthenticated' },
            });
            return;
          }
          json(response, 200, { ...session, accountId });
          return;
        case `POST /api/documents/${documentId}/collab-ticket`:
          // No collaboration endpoint here: "busy" keeps the editor retrying.
          json(response, 503, { error: { code: 'server_busy', message: 'server_busy' } });
          return;
        default:
          json(response, 404, { error: { code: 'not_found', message: 'not_found' } });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(SERVER_PORT, '127.0.0.1', () =>
      resolve({
        origin,
        documentId,
        code,
        token,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      }),
    );
  });
}

/**
 * The production bundle, loaded from app.asar with the fuses set, opens a
 * document through "Open in Desktop": server check, code redemption from the
 * main process, then the panel's own request with the bearer token that only
 * the main process holds.
 */
async function checkServerRoundTrip() {
  console.log('\nPackaged app against a stand-in server: "Open in Desktop" end to end');
  const server = await startStandInServer();
  try {
    const profile = path.join(work, 'home-server', '.config', 'RealtimeDocs');
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(
      path.join(profile, 'preferences.json'),
      JSON.stringify({ connection: { serverOrigin: server.origin } }),
    );
    const query = new URLSearchParams({
      server: server.origin,
      doc: server.documentId,
      code: server.code,
    });
    const app = launch('server', packagedBinary, [`realtimedocs://open?${query.toString()}`]);
    const up = await started(app);
    record(up, 'packaged app starts with a configured server and a link on its command line');

    const seen = (method, pathname, filter = () => true) =>
      server.requests.filter(
        (entry) => entry.method === method && entry.path === pathname && filter(entry),
      );
    const bearer = `Bearer ${server.token}`;
    const fromPanel = (entry) =>
      entry.headers.origin === 'app://realtimedocs' && entry.headers.authorization === bearer;
    // The editor in the panel asks for a collaboration ticket.
    const ticketPath = `/api/documents/${server.documentId}/collab-ticket`;
    await waitFor(() => seen('POST', ticketPath, fromPanel).length > 0, 20_000);
    await sleep(1500);

    record(seen('GET', '/api/meta').length > 0, 'the server was checked (GET /api/meta)');
    const redeems = seen('POST', '/api/desktop/redeem');
    record(
      redeems.length === 1 && redeems[0].headers.origin === 'app://realtimedocs',
      'the handoff code was redeemed once, as origin app://realtimedocs',
      `${redeems.length} request(s)`,
    );
    record(
      seen('POST', ticketPath, fromPanel).length > 0,
      'the editor in the panel reached the API with the bearer token added by the main process',
    );
    const preflights = server.requests.filter((entry) => entry.method === 'OPTIONS');
    record(
      preflights.every((entry) => entry.headers.authorization === undefined),
      'no CORS preflight carried the token',
      `${preflights.length} preflight(s)`,
    );
    const withCookie = server.requests.filter((entry) => entry.headers.cookie !== undefined);
    record(
      withCookie.length === 0,
      'no request carried a cookie, although the server offered some on every response',
      `${server.requests.length} requests`,
    );
    record(
      !app.output.includes(server.token) && !app.output.includes(server.code),
      'neither the token nor the handoff code is in any log line',
    );
    // The stand-in refuses every ticket ("busy"); the app handles that, so it is
    // not a console error either.
    const problems = [
      'startup.failed',
      'panel.load_failed',
      'panel.renderer_gone',
      'renderer.console',
      'renderer.policy_violation',
      'deep_link.rejected',
    ].filter((event) => app.output.includes(`"event":"${event}"`));
    record(
      problems.length === 0,
      'no load failure, console error, CSP violation or rejected link logged',
      problems.join(', '),
    );
    const paths = [...new Set(server.requests.map((entry) => `${entry.method} ${entry.path}`))];
    note(`requests seen by the stand-in server: ${paths.join('; ')}`);
    const shot = screenshot('packaged-linux-stand-in-server.png');
    if (shot) note(`screenshot: ${path.relative(desktopRoot, shot.file)}`);
    await stop(app);
  } finally {
    await server.close();
  }
}

/**
 * The packaged build against the real server (only while the stack of
 * scripts/real-stack.mjs is up): "Open in Desktop" for the sample document.
 * Nothing can be read out of the packaged app, so the evidence comes from the
 * server (it lists who is connected to a document right now), from the app's
 * log and from the screen.
 */
async function checkRealServer() {
  console.log('\nPackaged app against the real server: the sample document, live');
  const controlFile = process.env.RD_REAL_CONTROL;
  if (!controlFile || !fs.existsSync(controlFile)) {
    note(
      'the real stack is not running, so the packaged build was NOT run against the real server (start it with `node scripts/real-stack.mjs up` and run this check again)',
    );
    return;
  }
  const { origin, adminEmail, adminPassword } = JSON.parse(fs.readFileSync(controlFile, 'utf8'));

  // The administrator, signed in like a browser on the server's own pages.
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-rd-csrf': '1' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const cookie = login.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
  const { csrfToken } = await login.json();
  const unsafe = { cookie, origin, 'x-rd-csrf': csrfToken };
  const get = async (pathname) =>
    (await fetch(`${origin}${pathname}`, { headers: { cookie } })).json();
  const { documents } = await get('/api/documents?view=active&q=sample');
  const sample = documents.find((document) => document.title.includes('sample'));
  record(login.ok && Boolean(sample), 'signed in to the real server and found the sample document');
  if (!sample) return;
  const liveNow = async () => (await get(`/api/documents/${sample.id}/access`)).live ?? [];
  const before = (await liveNow()).length;

  // What the web app does for "Open in Desktop", and what the operating system
  // does with the link when the app is not running: start it with the link.
  const handoff = await (
    await fetch(`${origin}/api/documents/${sample.id}/desktop-handoff`, {
      method: 'POST',
      headers: unsafe,
    })
  ).json();
  const profile = path.join(work, 'home-real', '.config', 'RealtimeDocs');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ connection: { serverOrigin: origin } }),
  );
  const app = launch('real', packagedBinary, [handoff.url]);
  const up = await started(app);
  record(up, 'packaged app starts with the real server configured and a handoff link');

  const connected = await waitFor(async () => (await liveNow()).length > before, 30_000);
  const live = await liveNow();
  record(
    connected,
    'the server lists the packaged panel as connected to the document (live collaboration)',
    live.map((participant) => `${participant.name} (${participant.role})`).join(', '),
  );
  // Time for the image and the diagram to be drawn.
  await sleep(5000);
  const problems = [
    'startup.failed',
    'panel.load_failed',
    'panel.renderer_gone',
    'renderer.console',
    'renderer.policy_violation',
    'deep_link.rejected',
  ].filter((event) => app.output.includes(`"event":"${event}"`));
  record(
    problems.length === 0,
    'no load failure, console error, CSP violation or rejected link logged',
    problems.join(', '),
  );
  record(!app.output.includes(handoff.code), 'the handoff code is not in any log line');
  const shot = screenshot('packaged-linux-real-document.png');
  if (shot) {
    record(
      shot.litRatio > 0.02,
      'the document is drawn on screen',
      `${path.relative(desktopRoot, shot.file)} (${(shot.litRatio * 100).toFixed(1)}% lit)`,
    );
  }
  await stop(app);
  const gone = await waitFor(async () => (await liveNow()).length <= before, 15_000);
  record(gone, 'after the app quit, the server no longer lists it as connected');
  await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: unsafe });
}

async function checkLooseAppFolder() {
  console.log('\nLoose `app` folder in place of app.asar');
  const plant = (resources, proofFile) => {
    const folder = path.join(resources, 'app');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'package.json'), '{"name":"planted","main":"main.js"}\n');
    fs.writeFileSync(
      path.join(folder, 'main.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(proofFile)}, 'planted app ran');\nprocess.exit(0);\n`,
    );
  };

  // Control: an untouched Electron loads a loose `app` folder.
  const controlCopy = path.join(work, 'electron-control');
  fs.cpSync(path.dirname(electronPath), controlCopy, { recursive: true, verbatimSymlinks: true });
  const controlProof = path.join(work, 'proof-loose-app-control');
  plant(path.join(controlCopy, 'resources'), controlProof);
  const control = launch('loose-control', path.join(controlCopy, path.basename(electronPath)), []);
  await waitFor(() => control.exit !== null, 15_000);
  record(
    fs.existsSync(controlProof),
    'CONTROL stock Electron: loads the planted app folder',
    JSON.stringify(control.exit),
  );
  await stop(control);

  // Packaged build with app.asar replaced by a loose folder.
  const tampered = path.join(work, 'packaged-tampered');
  fs.cpSync(packagedDir, tampered, { recursive: true, verbatimSymlinks: true });
  fs.rmSync(path.join(tampered, 'resources', 'app.asar'));
  const proof = path.join(work, 'proof-loose-app');
  plant(path.join(tampered, 'resources'), proof);
  const app = launch('loose', path.join(tampered, 'realtimedocs'), []);
  const ended = await waitFor(() => app.exit !== null, 15_000);
  record(!fs.existsSync(proof), 'packaged: the planted app folder was not run');
  record(
    ended && app.exit.code !== 0,
    'packaged: without app.asar the app refuses to start',
    `${JSON.stringify(app.exit)} ${(/[^\n]*(?:Unable to find|valid app)[^\n]*/.exec(app.output) ?? [''])[0].trim().slice(0, 120)}`,
  );
  await stop(app);
}

// ── run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Packaged build: ${path.relative(process.cwd(), packagedDir)}`);
  console.log(
    `Control binary: ${path.relative(process.cwd(), electronPath)} (unmodified Electron)`,
  );
  if (process.platform !== 'linux') {
    console.error('This check runs the Linux package only.');
    process.exit(2);
  }
  if (!fs.existsSync(packagedBinary)) {
    console.error(
      `Not found: ${packagedBinary}\nRun \`pnpm --filter @realtimedocs/desktop run package:linux\` first.`,
    );
    process.exit(2);
  }
  if (!fs.existsSync(path.join(devDist, 'main', 'main.cjs'))) {
    console.error(
      `Not found: ${devDist}\nRun \`pnpm --filter @realtimedocs/desktop run build\` first (the controls use it).`,
    );
    process.exit(2);
  }
  fs.rmSync(resultsDir, { recursive: true, force: true });
  fs.mkdirSync(resultsDir, { recursive: true });
  await startDisplay();

  try {
    await checkStartAndSandbox();
    await checkServerRoundTrip();
    await checkRealServer();
    await checkDebugFlags();
    await checkSignalInspector();
    await checkRunAsNode();
    await checkNodeOptions();
    await checkLooseAppFolder();
  } finally {
    for (const proc of [...running]) {
      try {
        process.kill(-proc.child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    if (xvfb) xvfb.kill('SIGTERM');
    fs.rmSync(work, { recursive: true, force: true });
  }

  const failed = checks.filter((check) => !check.ok);
  fs.writeFileSync(
    path.join(resultsDir, 'results.json'),
    `${JSON.stringify({ host: `${process.platform}-${process.arch}`, package: path.basename(packagedDir), checks, notes }, null, 2)}\n`,
  );
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed (Linux package under Xvfb; not Windows, not macOS).`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
