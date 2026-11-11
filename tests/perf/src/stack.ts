/**
 * Brings the benchmark stack up and down: PostgreSQL container `rd-perf-pg` (127.0.0.1:54320),
 * the built server (127.0.0.1:4320) with the built web app, and the two delay proxies
 * (4321 = +5 ms each way, 4322 = +25 ms each way). Usage: stack.ts up [--no-build] | down | status
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Y_FRAGMENT_FIELD } from '@realtimedocs/contracts';
import * as Y from 'yjs';
import {
  type DocInfo,
  HOST,
  PG_CONTAINER,
  PORTS,
  type StackState,
  readState,
  repoRoot,
  sleep,
  stageDir,
  stateFile,
  writeState,
} from './common';
import { PerfClient } from './collab';
import { Api } from './http';

const serverDir = path.join(repoRoot, 'apps/server');
const webDir = path.join(stageDir, 'web');
const PW_CONTAINER = 'rd-perf-pw-server';
const log = (line: string) => process.stdout.write(`[stack] ${line}\n`);

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function serverSettings(secrets: { pgUrl: string; session: string }): Record<string, string> {
  return {
    NODE_ENV: 'production',
    RD_HOST: HOST,
    RD_PORT: String(PORTS.server),
    PUBLIC_ORIGIN: `http://${HOST}:${PORTS.server}`,
    // The browsers reach the server through the delay proxies too: those origins must be allowed.
    ALLOWED_ORIGINS: `http://${HOST}:${PORTS.proxy10},http://${HOST}:${PORTS.proxy50},http://${HOST}:${PORTS.cut}`,
    WEB_DIST_DIR: webDir,
    ASSET_DIR: path.join(stageDir, 'assets'),
    LOG_LEVEL: 'warn',
    CLEANUP_INTERVAL_MINUTES: '0',
    // Rate limits raised so ten clients from one address are not throttled (defaults in docs/notes/server.md).
    RATE_API_PER_MINUTE: '1000000',
    RATE_LOGIN_PER_IP: '100000',
    RATE_SHARE_EXCHANGE_PER_IP: '100000',
    RATE_INVITE_PER_IP: '100000',
    RATE_DESKTOP_REDEEM_PER_IP: '100000',
    RATE_COLLAB_TICKET_PER_MINUTE: '100000',
    RATE_UPLOAD_PER_MINUTE: '100000',
    RATE_WS_UPGRADE_PER_MINUTE: '100000',
    // Typing at 5-10 chars/s with a mark per keystroke is far below the default budget (300/s),
    // so COLLAB_FRAME_BURST / COLLAB_FRAMES_PER_SECOND stay at their defaults.
    DATABASE_URL: secrets.pgUrl,
    SESSION_SECRET: secrets.session,
  };
}

/** Same settings with secrets masked, for the report. */
export function publicSettings(settings: Record<string, string>): Record<string, string> {
  const copy = { ...settings };
  copy.DATABASE_URL = 'postgres://rd:***@127.0.0.1:54320/realtimedocs_perf';
  copy.SESSION_SECRET = '*** (generated, 32 random bytes)';
  return copy;
}

async function up(build: boolean): Promise<void> {
  if (existsSync(stateFile)) throw new Error(`${stateFile} exists: run "down" first`);
  mkdirSync(stageDir, { recursive: true, mode: 0o700 });
  const pgPassword = randomBytes(18).toString('base64url');
  const session = randomBytes(32).toString('base64url');

  if (build) {
    log('building server (pnpm --filter @realtimedocs/server run build)');
    execFileSync('pnpm', ['--filter', '@realtimedocs/server', 'run', 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    log('building web app into the private directory tests/perf/.stage/web');
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@realtimedocs/web',
        'exec',
        'vite',
        'build',
        '--outDir',
        webDir,
        '--emptyOutDir',
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );
  }

  log('starting PostgreSQL container');
  docker('rm', '-f', PG_CONTAINER);
  docker(
    'run',
    '-d',
    '--name',
    PG_CONTAINER,
    '-p',
    `${HOST}:${PORTS.pg}:5432`,
    '-e',
    `POSTGRES_PASSWORD=${pgPassword}`,
    '-e',
    'POSTGRES_USER=rd',
    '-e',
    'POSTGRES_DB=realtimedocs_perf',
    'postgres:17.11-alpine',
  );
  for (let i = 0; ; i += 1) {
    try {
      docker(
        'exec',
        PG_CONTAINER,
        'pg_isready',
        '-U',
        'rd',
        '-d',
        'realtimedocs_perf',
        '-h',
        '127.0.0.1',
      );
      await sleep(1500); // the init phase restarts the server once
      docker(
        'exec',
        PG_CONTAINER,
        'pg_isready',
        '-U',
        'rd',
        '-d',
        'realtimedocs_perf',
        '-h',
        '127.0.0.1',
      );
      break;
    } catch {
      if (i > 60) throw new Error('postgres did not become ready');
      await sleep(500);
    }
  }
  const settings = serverSettings({
    pgUrl: `postgres://rd:${pgPassword}@${HOST}:${PORTS.pg}/realtimedocs_perf`,
    session,
  });
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    RD_ENV_FILE: '',
    ...settings,
  };
  rmSync(settings.ASSET_DIR as string, { recursive: true, force: true });
  // Kept (mode 600) so the server can be stopped and started again by the reconnect tests.
  writeFileSync(path.join(stageDir, 'server.env'), JSON.stringify(settings), { mode: 0o600 });

  log('creating administrator with the CLI (generated password goes to a mode-600 file)');
  const cli = execFileSync(
    process.execPath,
    [
      '--enable-source-maps',
      'dist/cli.js',
      'bootstrap-admin',
      '--email',
      'perf@example.test',
      '--name',
      'Perf Admin',
      '--generate',
    ],
    { cwd: serverDir, env, encoding: 'utf8' },
  );
  const password = cli.trim().split('\n').pop()?.trim() ?? '';
  if (password.length < 12) throw new Error('could not read the generated password');
  const passwordFile = path.join(stageDir, 'admin-password');
  writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
  chmodSync(passwordFile, 0o600);
  const seed = execFileSync(
    process.execPath,
    ['--enable-source-maps', 'dist/cli.js', 'seed-sample'],
    { cwd: serverDir, env, encoding: 'utf8' },
  );
  log(`seed-sample: ${seed.trim().split('\n')[0]}`);

  log('starting server');
  const serverLog = openSync(path.join(stageDir, 'server.log'), 'w');
  const child = spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
    cwd: serverDir,
    env,
    detached: true,
    stdio: ['ignore', serverLog, serverLog],
  });
  child.unref();
  closeSync(serverLog);
  for (let i = 0; ; i += 1) {
    try {
      if ((await fetch(`http://${HOST}:${PORTS.server}/api/health`)).ok) break;
    } catch {
      /* not yet */
    }
    if (i > 100) throw new Error('server did not start');
    await sleep(100);
  }

  log('starting delay proxies');
  const proxyLog = openSync(path.join(stageDir, 'proxy.log'), 'w');
  const proxy = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(repoRoot, 'tests/perf/src/proxy-main.ts')],
    {
      cwd: path.join(repoRoot, 'tests/perf'),
      detached: true,
      stdio: ['ignore', proxyLog, proxyLog],
    },
  );
  proxy.unref();
  closeSync(proxyLog);
  await sleep(1500);

  const meta = (await (await fetch(`http://${HOST}:${PORTS.server}/api/meta`)).json()) as {
    version?: string;
    serverVersion?: string;
  };
  const state: StackState = {
    startedAt: new Date().toISOString(),
    serverPid: child.pid as number,
    proxyPid: proxy.pid as number,
    adminEmail: 'perf@example.test',
    passwordFile,
    serverSettings: publicSettings(settings),
    serverVersion: meta.version ?? meta.serverVersion ?? JSON.stringify(meta).slice(0, 120),
    docs: {},
  };
  writeState(state);
  await fixtures(state);
  log('stack is up');
}

function lorem(i: number): string {
  const words = [
    'collaboration',
    'document',
    'editor',
    'server',
    'latency',
    'update',
    'render',
    'network',
    'client',
    'session',
    'paragraph',
    'version',
    'change',
    'sync',
    'shared',
    'review',
    'draft',
    'notes',
  ];
  let out = `Block ${i}: `;
  let k = i * 7;
  while (out.length < 245) {
    out += `${words[k % words.length]} `;
    k += 3;
  }
  return out.trimEnd() + '.';
}

async function describe(api: Api, id: string, title: string): Promise<DocInfo> {
  const client = await PerfClient.connect(api, id);
  const blocks = client.fragment.length;
  const yStateBytes = Y.encodeStateAsUpdate(client.doc).length;
  client.destroy();
  const txt = await api.request<unknown>('GET', `/api/documents/${id}/export?format=txt`);
  const share = await api.ok<{ share: { id: string }; url: string }>(
    'POST',
    `/api/documents/${id}/shares`,
    { role: 'viewer', label: 'perf viewers' },
  );
  return {
    id,
    title,
    blocks,
    textBytes: Buffer.byteLength(txt.text, 'utf8'),
    yStateBytes,
    viewerShare: { id: share.share.id, secret: new URL(share.url).hash.slice(1) },
  };
}

/** A document of `blocks` paragraphs of about `chars` characters each. */
async function generated(api: Api, title: string, blocks: number, chars: number): Promise<DocInfo> {
  const created = await api.ok<{ document: { id: string } }>('POST', '/api/documents', { title });
  const writer = await PerfClient.connect(api, created.document.id);
  for (let i = 0; i < blocks; i += 1) {
    let body = lorem(i);
    while (body.length < chars) body += ` ${lorem(i + body.length)}`;
    writer.edit(() => {
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, body);
      paragraph.insert(0, [text]);
      writer.doc.getXmlFragment(Y_FRAGMENT_FIELD).push([paragraph]);
    });
  }
  await writer.save();
  writer.destroy();
  return describe(api, created.document.id, title);
}

async function fixtures(state: StackState): Promise<void> {
  const api = new Api(PORTS.server);
  await api.login(state.adminEmail, readFileSync(state.passwordFile, 'utf8').trim());
  const list = await api.ok<{ documents: { id: string; title: string }[] }>(
    'GET',
    '/api/documents?view=active',
  );
  const sample = list.documents[0];
  if (!sample) throw new Error('no sample document');
  state.docs.small = await describe(api, sample.id, sample.title);

  const created = await api.ok<{ document: { id: string } }>('POST', '/api/documents', {
    title: 'Perf large document',
  });
  const writer = await PerfClient.connect(api, created.document.id);
  for (let i = 0; i < 200; i += 1) {
    writer.edit(() => {
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, lorem(i));
      paragraph.insert(0, [text]);
      writer.doc.getXmlFragment(Y_FRAGMENT_FIELD).push([paragraph]);
    });
  }
  await writer.save();
  writer.destroy();
  state.docs.large = await describe(api, created.document.id, 'Perf large document');
  state.docs.medium = await generated(api, 'Perf medium document', 100, 250);
  state.docs.huge = await generated(api, 'Perf huge document', 500, 800);
  writeState(state);
  log(
    `small: ${state.docs.small.blocks} blocks, ${state.docs.small.textBytes} B text; large: ${state.docs.large.blocks} blocks, ${state.docs.large.textBytes} B text`,
  );
}

function serverEnv(): NodeJS.ProcessEnv {
  const settings = JSON.parse(readFileSync(path.join(stageDir, 'server.env'), 'utf8')) as Record<
    string,
    string
  >;
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    RD_ENV_FILE: '',
    ...settings,
  };
}

async function waitHealth(up: boolean): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const ok = await fetch(`http://${HOST}:${PORTS.server}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok === up) return;
    await sleep(50);
  }
  throw new Error('server did not reach the wanted state');
}

/** Stops (SIGTERM) or starts the benchmark server again; used by the offline and reconnect tests. */
export async function serverStop(): Promise<void> {
  process.kill(readState().serverPid, 'SIGTERM');
  await waitHealth(false);
}

export async function serverStart(): Promise<void> {
  const logFd = openSync(path.join(stageDir, 'server.log'), 'a');
  const child = spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
    cwd: serverDir,
    env: serverEnv(),
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  const state = readState();
  state.serverPid = child.pid as number;
  writeState(state);
  await waitHealth(true);
}

/** Playwright server in the pinned image: host-side scripts drive the browser through it. */
export function pwUp(): void {
  try {
    docker('rm', '-f', PW_CONTAINER);
  } catch {
    /* absent */
  }
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    PW_CONTAINER,
    '--user',
    '1000:1000',
    '-e',
    'HOME=/tmp',
    '--network',
    'host',
    '--ipc=host',
    '-v',
    `${repoRoot}:/work`,
    '-w',
    '/work/tests/perf',
    'mcr.microsoft.com/playwright:v1.64.1-noble',
    'node',
    '/work/node_modules/@playwright/test/cli.js',
    'run-server',
    '--port',
    String(PORTS.pw),
    '--host',
    HOST,
  );
}

function pwDown(): void {
  try {
    docker('rm', '-f', PW_CONTAINER);
  } catch {
    /* absent */
  }
}

function killGroup(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* gone */
  }
}

async function down(): Promise<void> {
  if (existsSync(stateFile)) {
    const state = readState();
    killGroup(state.serverPid);
    killGroup(state.proxyPid);
    await sleep(1500);
  }
  pwDown();
  try {
    docker('rm', '-f', PG_CONTAINER);
  } catch {
    /* absent */
  }
  rmSync(stateFile, { force: true });
  rmSync(path.join(stageDir, 'admin-password'), { force: true });
  rmSync(path.join(stageDir, 'server.env'), { force: true });
  log('stack is down');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'up') await up(!rest.includes('--no-build'));
  else if (command === 'down') await down();
  else if (command === 'server-stop') await serverStop();
  else if (command === 'server-start') await serverStart();
  else if (command === 'pw-up') pwUp();
  else if (command === 'pw-down') pwDown();
  else if (command === 'status')
    process.stdout.write(existsSync(stateFile) ? JSON.stringify(readState(), null, 2) : 'down\n');
  else process.stderr.write('Usage: stack.ts up [--no-build] | down | status\n');
}
