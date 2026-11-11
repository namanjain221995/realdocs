/** Shared constants, paths, state file and statistics for the performance harness. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const perfRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(perfRoot, '../..');
export const stageDir = path.join(perfRoot, '.stage');
export const resultsRoot = path.join(perfRoot, 'results');
export const stateFile = path.join(stageDir, 'state.json');

export const PORTS = {
  server: 4320,
  proxy10: 4321,
  proxy50: 4322,
  pw: 4323,
  cut: 4324,
  pg: 54320,
} as const;
export const PG_CONTAINER = 'rd-perf-pg';
export const HOST = '127.0.0.1';

/** One network condition = one label, one entry port, one nominal one-way delay per direction. */
export interface Condition {
  key: 'loopback' | 'rtt10' | 'rtt50';
  label: string;
  port: number;
  /** Delay added by the userspace proxy in EACH direction (ms). 0 = no proxy. */
  addedOneWayMs: number;
}

export const CONDITIONS: Record<Condition['key'], Condition> = {
  loopback: {
    key: 'loopback',
    label: 'loopback on one host',
    port: PORTS.server,
    addedOneWayMs: 0,
  },
  rtt10: {
    key: 'rtt10',
    label: 'emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)',
    port: PORTS.proxy10,
    addedOneWayMs: 5,
  },
  rtt50: {
    key: 'rtt50',
    label: 'emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN)',
    port: PORTS.proxy50,
    addedOneWayMs: 25,
  },
};

export interface DocInfo {
  id: string;
  title: string;
  blocks: number;
  textBytes: number;
  /** Size of the Yjs state encoded by a fresh client after sync (bytes). */
  yStateBytes: number;
  viewerShare: { id: string; secret: string };
}

export interface StackState {
  startedAt: string;
  serverPid: number;
  proxyPid: number;
  adminEmail: string;
  passwordFile: string;
  serverSettings: Record<string, string>;
  serverVersion: string;
  docs: { small?: DocInfo; large?: DocInfo; medium?: DocInfo; huge?: DocInfo };
}

export function readState(): StackState {
  if (!existsSync(stateFile))
    throw new Error('stack is not up: run `pnpm --filter @realtimedocs/perf run stack:up`');
  return JSON.parse(readFileSync(stateFile, 'utf8')) as StackState;
}

export function writeState(state: StackState): void {
  mkdirSync(stageDir, { recursive: true, mode: 0o700 });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(stateFile, 0o600);
}

export function adminPassword(_state?: StackState): string {
  // Resolved from the stage directory, so the same state works on the host and inside the container.
  return readFileSync(path.join(stageDir, 'admin-password'), 'utf8').trim();
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wall clock in ms with sub-ms resolution, comparable across processes on this host. */
export const wallNow = () => performance.timeOrigin + performance.now();

// ── Statistics ──────────────────────────────────────────────────────────────

export interface Stats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
}

/** Nearest-rank percentile on a sorted array: the smallest value with at least p of the samples at or below it. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] as number;
}

export function stats(values: number[]): Stats {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n,
    min: sorted[0] ?? Number.NaN,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    mean: n ? sum / n : Number.NaN,
    max: sorted[n - 1] ?? Number.NaN,
  };
}

export const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');

export function statsRow(label: string, s: Stats): string {
  return `| ${label} | ${s.n} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.mean)} | ${fmt(s.max)} |`;
}

export const STATS_HEADER =
  '| configuration | samples | p50 ms | p95 ms | p99 ms | mean ms | max ms |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |';

// ── Result directory ────────────────────────────────────────────────────────

export function runDir(): string {
  const fromEnv = process.env.PERF_RUN_DIR;
  if (fromEnv) {
    mkdirSync(fromEnv, { recursive: true });
    return fromEnv;
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const dir = path.join(resultsRoot, stamp);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveJson(dir: string, name: string, data: unknown): void {
  writeFileSync(path.join(dir, name), JSON.stringify(data));
}
