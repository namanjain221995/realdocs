/** Shared constants, paths, state file and statistics for the load harness. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const loadRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(loadRoot, '../..');
export const stageDir = path.join(loadRoot, '.stage');
export const serverStage = path.join(stageDir, 'server');
export const resultsRoot = path.join(loadRoot, 'results');
export const stateFile = path.join(stageDir, 'state.json');

export const HOST = '127.0.0.1';
export const PG_CONTAINER = 'rd-load-pg';
export const REDIS_CONTAINER = 'rd-load-redis';
export const PORTS = {
  /** Server instances: 4450, 4451, 4452 … */
  instanceBase: 4450,
  /** The round-robin proxy ("load balancer") every client uses. */
  lb: 4459,
  /** Control port of the proxy (drop all sockets, statistics). */
  lbControl: 4458,
  pg: 15450,
  redis: 16450,
} as const;
export const METRICS_TOKEN = 'rd-load-metrics-token-0123456789abcdef';

export interface InstanceState {
  index: number;
  port: number;
  pid: number;
  logFile: string;
}

export interface StackState {
  startedAt: string;
  topology: string;
  instances: InstanceState[];
  lbPid: number | null;
  /** Origin every client uses. */
  origin: string;
  /** Environment of the server processes (secrets are in server.env only; this copy is masked). */
  settings: Record<string, string>;
  adminEmail: string;
  extraEnv: Record<string, string>;
  redis: boolean;
}

export function readState(): StackState {
  if (!existsSync(stateFile)) throw new Error('stack is not up: run `stack.ts up` first');
  return JSON.parse(readFileSync(stateFile, 'utf8')) as StackState;
}
export function stateExists(): boolean {
  return existsSync(stateFile);
}
export function writeState(state: StackState): void {
  mkdirSync(stageDir, { recursive: true, mode: 0o700 });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(stateFile, 0o600);
}
export function adminPassword(): string {
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] as number;
}

export function stats(values: number[]): Stats {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (const v of sorted) sum += v;
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

export const emptyStats = (): Stats => stats([]);

export function round(value: number, digits = 1): number | null {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function fmtStats(s: Stats): string {
  if (s.n === 0) return 'n=0';
  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');
  return `n=${s.n} p50 ${f(s.p50)} / p95 ${f(s.p95)} / p99 ${f(s.p99)} / max ${f(s.max)} ms`;
}

export function slope(points: { t: number; v: number }[]): number {
  // least squares slope, value per millisecond of t
  const n = points.length;
  if (n < 2) return Number.NaN;
  let st = 0;
  let sv = 0;
  for (const p of points) {
    st += p.t;
    sv += p.v;
  }
  const mt = st / n;
  const mv = sv / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - mt) * (p.v - mv);
    den += (p.t - mt) ** 2;
  }
  return den === 0 ? Number.NaN : num / den;
}

export function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

export function mergeCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) bump(into, k, v);
}
