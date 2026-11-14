/**
 * Isolated load-test stack: PostgreSQL `rd-load-pg` (127.0.0.1:15450), optional Redis `rd-load-redis`
 * (127.0.0.1:16450), N server processes (127.0.0.1:4450+) run from a PRIVATE copy of the built bundle
 * (tests/load/.stage/server), and a round-robin proxy on 127.0.0.1:4459 that every client uses.
 *
 *   stack.ts stage                      build apps/server and copy dist/migrations/assets to .stage/server
 *   stack.ts up --topology A|B|C [--instances N] [--pool N] [--env K=V ...]
 *   stack.ts down | status
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  HOST,
  METRICS_TOKEN,
  PG_CONTAINER,
  PORTS,
  REDIS_CONTAINER,
  type InstanceState,
  type StackState,
  readState,
  repoRoot,
  serverStage,
  sleep,
  stageDir,
  stateExists,
  stateFile,
  writeState,
  loadRoot,
} from './common';

const log = (line: string) => process.stdout.write(`[stack] ${line}\n`);

function docker(...args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function stage(): void {
  log('building apps/server (pnpm --filter @realtimedocs/server run build)');
  execFileSync('pnpm', ['--filter', '@realtimedocs/server', 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  const src = path.join(repoRoot, 'apps/server');
  rmSync(serverStage, { recursive: true, force: true });
  mkdirSync(serverStage, { recursive: true });
  for (const dir of ['dist', 'migrations', 'assets']) {
    if (existsSync(path.join(src, dir)))
      cpSync(path.join(src, dir), path.join(serverStage, dir), { recursive: true });
  }
  const stat = execFileSync('du', ['-sh', serverStage], { encoding: 'utf8' }).split('\t')[0];
  log(`staged bundle in ${serverStage} (${stat})`);
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, HOST, () => s.close(() => resolve(true)));
  });
}

export function instancePort(index: number): number {
  return PORTS.instanceBase + index;
}

/** Per-IP limits are raised because every simulated user shares 127.0.0.1; per-session/per-email/per-grant limits stay default except the share-exchange per-grant. */
export const RAISED_LIMITS: Record<string, string> = {
  RATE_API_PER_MINUTE: '10000000',
  RATE_LOGIN_PER_IP: '1000000',
  RATE_SHARE_EXCHANGE_PER_IP: '1000000',
  RATE_SHARE_EXCHANGE_PER_GRANT: '1000000',
  RATE_INVITE_PER_IP: '1000000',
  RATE_SIGNUP_PER_IP: '1000000',
  RATE_DESKTOP_REDEEM_PER_IP: '1000000',
  RATE_DOWNLOAD_PER_IP: '1000000',
  RATE_WS_UPGRADE_PER_MINUTE: '1000000',
};

function baseEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    RD_ENV_FILE: '',
  };
}

function readServerEnv(): Record<string, string> {
  return JSON.parse(readFileSync(path.join(stageDir, 'server.env'), 'utf8')) as Record<
    string,
    string
  >;
}

function instanceEnv(index: number, count: number): Record<string, string> {
  const shared = readServerEnv();
  const port = instancePort(index);
  const env: Record<string, string> = { ...baseEnv(), ...shared, RD_PORT: String(port) };
  if (count > 1 || shared.REDIS_URL) env.CLUSTER_INTERNAL_URL = `http://${HOST}:${port}`;
  return env;
}

async function waitHealth(port: number, up: boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(`http://${HOST}:${port}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok === up) return;
    await sleep(50);
  }
  throw new Error(`instance on ${port} did not become ${up ? 'healthy' : 'unreachable'}`);
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Starts (or restarts) instance `index`, appends to its log, records the pid. */
export async function startInstance(index: number): Promise<InstanceState> {
  const state = readState();
  const port = instancePort(index);
  const logFile = path.join(stageDir, `server-${index}.log`);
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
    cwd: serverStage,
    env: instanceEnv(index, state.instances.length),
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  closeSync(fd);
  const inst: InstanceState = { index, port, pid: child.pid as number, logFile };
  state.instances[index] = inst;
  writeState(state);
  await waitHealth(port, true);
  return inst;
}

/** SIGTERM and wait for the process to exit. Returns the shutdown duration in ms. */
export async function stopInstance(
  index: number,
  signal: NodeJS.Signals = 'SIGTERM',
): Promise<number> {
  const state = readState();
  const inst = state.instances[index];
  if (!inst) throw new Error(`no instance ${index}`);
  const t0 = Date.now();
  try {
    process.kill(inst.pid, signal);
  } catch {
    return 0;
  }
  while (alive(inst.pid)) {
    if (Date.now() - t0 > 60_000) {
      process.kill(inst.pid, 'SIGKILL');
      break;
    }
    await sleep(25);
  }
  return Date.now() - t0;
}

async function waitPg(): Promise<void> {
  for (let i = 0; ; i += 1) {
    try {
      docker(
        'exec',
        PG_CONTAINER,
        'pg_isready',
        '-U',
        'rd',
        '-d',
        'realtimedocs_load',
        '-h',
        '127.0.0.1',
      );
      await sleep(1500);
      docker(
        'exec',
        PG_CONTAINER,
        'pg_isready',
        '-U',
        'rd',
        '-d',
        'realtimedocs_load',
        '-h',
        '127.0.0.1',
      );
      return;
    } catch {
      if (i > 90) throw new Error('postgres did not become ready');
      await sleep(500);
    }
  }
}

export interface UpOptions {
  topology: string;
  instances: number;
  pool: number;
  redis: boolean;
  env: Record<string, string>;
}

export function topologyDefaults(
  topology: string,
): Pick<UpOptions, 'instances' | 'pool' | 'redis'> {
  if (topology === 'A') return { instances: 1, pool: 10, redis: false };
  if (topology === 'B') return { instances: 1, pool: 40, redis: false };
  if (topology === 'C') return { instances: 2, pool: 10, redis: true };
  throw new Error(`unknown topology ${topology}`);
}

export async function up(options: UpOptions): Promise<StackState> {
  if (stateExists()) throw new Error(`${stateFile} exists: run "down" first`);
  if (!existsSync(path.join(serverStage, 'dist/main.js'))) throw new Error('run "stage" first');
  for (const p of [
    PORTS.lb,
    PORTS.lbControl,
    PORTS.pg,
    PORTS.redis,
    ...Array.from({ length: options.instances }, (_, i) => instancePort(i)),
  ]) {
    if (!(await portFree(p))) throw new Error(`port ${p} is not free`);
  }
  mkdirSync(stageDir, { recursive: true, mode: 0o700 });
  const pgPassword = randomBytes(18).toString('base64url');
  const session = randomBytes(32).toString('base64url');

  log('starting PostgreSQL container rd-load-pg');
  try {
    docker('rm', '-f', '-v', PG_CONTAINER);
  } catch {
    /* absent */
  }
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
    'POSTGRES_DB=realtimedocs_load',
    // Optional bounds and statement statistics for the performance framework (tests/performance).
    ...(process.env.RD_LOAD_PG_CPUS ? ['--cpus', process.env.RD_LOAD_PG_CPUS] : []),
    ...(process.env.RD_LOAD_PG_MEMORY ? ['--memory', process.env.RD_LOAD_PG_MEMORY] : []),
    'postgres:17.11-alpine',
    ...(process.env.RD_LOAD_PG_STATEMENTS === '1'
      ? ['-c', 'shared_preload_libraries=pg_stat_statements', '-c', 'track_io_timing=on']
      : []),
  );
  if (options.redis) {
    log('starting Redis container rd-load-redis');
    try {
      docker('rm', '-f', '-v', REDIS_CONTAINER);
    } catch {
      /* absent */
    }
    docker(
      'run',
      '-d',
      '--name',
      REDIS_CONTAINER,
      '-p',
      `${HOST}:${PORTS.redis}:6379`,
      'redis:8.8.3',
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
    );
  }
  await waitPg();

  const origin = `http://${HOST}:${PORTS.lb}`;
  const allowed = [
    origin,
    ...Array.from({ length: options.instances }, (_, i) => `http://${HOST}:${instancePort(i)}`),
  ];
  const assetDir = path.join(stageDir, 'assets');
  rmSync(assetDir, { recursive: true, force: true });
  const settings: Record<string, string> = {
    NODE_ENV: 'production',
    RD_HOST: HOST,
    RD_PORT: String(instancePort(0)),
    PUBLIC_ORIGIN: origin,
    ALLOWED_ORIGINS: allowed.join(','),
    ASSET_DIR: assetDir,
    LOG_LEVEL: 'info',
    CLEANUP_INTERVAL_MINUTES: '0',
    METRICS_TOKEN,
    DATABASE_URL: `postgres://rd:${pgPassword}@${HOST}:${PORTS.pg}/realtimedocs_load`,
    SESSION_SECRET: session,
    DB_POOL_MAX: String(options.pool),
    COLLAB_MAX_CONNECTIONS: '5000',
    ...RAISED_LIMITS,
    ...(options.redis ? { REDIS_URL: `redis://${HOST}:${PORTS.redis}` } : {}),
    ...options.env,
  };
  writeFileSync(path.join(stageDir, 'server.env'), JSON.stringify(settings), { mode: 0o600 });

  log('creating administrator with the CLI');
  const cli = execFileSync(
    process.execPath,
    [
      '--enable-source-maps',
      'dist/cli.js',
      'bootstrap-admin',
      '--email',
      'load@example.test',
      '--name',
      'Load Admin',
      '--generate',
    ],
    { cwd: serverStage, env: { ...baseEnv(), ...settings }, encoding: 'utf8' },
  );
  const password = cli.trim().split('\n').pop()?.trim() ?? '';
  if (password.length < 12) throw new Error('could not read the generated password');
  const passwordFile = path.join(stageDir, 'admin-password');
  writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
  chmodSync(passwordFile, 0o600);

  const masked = { ...settings };
  masked.DATABASE_URL = `postgres://rd:***@${HOST}:${PORTS.pg}/realtimedocs_load`;
  masked.SESSION_SECRET = '*** (generated)';
  masked.METRICS_TOKEN = '*** (load-test constant)';
  const state: StackState = {
    startedAt: new Date().toISOString(),
    topology: options.topology,
    instances: [],
    lbPid: null,
    origin,
    settings: masked,
    adminEmail: 'load@example.test',
    extraEnv: options.env,
    redis: options.redis,
  };
  writeState(state);

  for (let i = 0; i < options.instances; i += 1) {
    const inst = await startInstance(i);
    log(`instance ${i} pid ${inst.pid} on ${inst.port}`);
  }

  const lbLog = openSync(path.join(stageDir, 'lb.log'), 'w');
  const lb = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      path.join(loadRoot, 'src/lb.ts'),
      String(PORTS.lb),
      String(PORTS.lbControl),
      Array.from({ length: options.instances }, (_, i) => instancePort(i)).join(','),
    ],
    { cwd: loadRoot, detached: true, stdio: ['ignore', lbLog, lbLog] },
  );
  lb.unref();
  closeSync(lbLog);
  const fresh = readState();
  fresh.lbPid = lb.pid as number;
  writeState(fresh);
  for (let i = 0; ; i += 1) {
    const ok = await fetch(`${origin}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    if (i > 100) throw new Error('proxy did not come up');
    await sleep(100);
  }
  log(
    `stack up: topology ${options.topology}, ${options.instances} instance(s), pool ${options.pool}, redis ${options.redis}`,
  );
  return readState();
}

export async function down(): Promise<void> {
  if (stateExists()) {
    const state = readState();
    for (const pid of [state.lbPid, ...state.instances.map((i) => i?.pid)]) {
      if (!pid) continue;
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
    const deadline = Date.now() + 20_000;
    while (
      Date.now() < deadline &&
      [state.lbPid, ...state.instances.map((i) => i?.pid)].some((p) => p && alive(p))
    ) {
      await sleep(100);
    }
    for (const pid of [state.lbPid, ...state.instances.map((i) => i?.pid)]) {
      if (pid && alive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }
  }
  for (const name of [PG_CONTAINER, REDIS_CONTAINER]) {
    try {
      docker('rm', '-f', '-v', name);
    } catch {
      /* absent */
    }
  }
  rmSync(stateFile, { force: true });
  rmSync(path.join(stageDir, 'admin-password'), { force: true });
  rmSync(path.join(stageDir, 'server.env'), { force: true });
  rmSync(path.join(stageDir, 'assets'), { recursive: true, force: true });
  log('stack is down (containers rd-load-* removed)');
}

export function parseEnvArgs(args: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--env') {
      const [k, ...v] = (args[i + 1] ?? '').split('=');
      if (k) env[k] = v.join('=');
    }
  }
  return env;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (command === 'stage') stage();
  else if (command === 'up') {
    const topology = flag('topology') ?? 'A';
    const d = topologyDefaults(topology);
    await up({
      topology,
      instances: Number(flag('instances') ?? d.instances),
      pool: Number(flag('pool') ?? d.pool),
      redis: Number(flag('instances') ?? d.instances) > 1 ? true : d.redis,
      env: parseEnvArgs(rest),
    });
  } else if (command === 'down') await down();
  else if (command === 'status')
    process.stdout.write(stateExists() ? JSON.stringify(readState(), null, 2) : 'down\n');
  else process.stderr.write('Usage: stack.ts stage | up --topology A|B|C | down | status\n');
}
