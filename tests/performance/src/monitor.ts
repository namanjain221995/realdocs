/**
 * Host watchdog and system/database sampling for the performance runs.
 *
 * Watchdog: a run is aborted when the shared host is in trouble, whatever the scenario thinks:
 * 1-minute load average above the limit, available memory below the floor, or swap use growing by
 * more than the allowance since the run started.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { PG_CONTAINER, readState, stateExists } from '../../load/src/common';

function meminfo(): { availableMb: number; swapUsedMb: number } {
  const text = readFileSync('/proc/meminfo', 'utf8');
  const kb = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0);
  return {
    availableMb: kb('MemAvailable') / 1024,
    swapUsedMb: (kb('SwapTotal') - kb('SwapFree')) / 1024,
  };
}

export interface Limits {
  maxLoad1: number;
  minAvailableMb: number;
  maxSwapGrowthMb: number;
}
export const DEFAULT_LIMITS: Limits = {
  maxLoad1: 18,
  minAvailableMb: 10 * 1024,
  maxSwapGrowthMb: 2 * 1024,
};

interface ProcSample {
  cpuPct: number | null;
  rssMb: number | null;
}
export interface Sample {
  t: number;
  load1: number;
  availableMb: number;
  swapUsedMb: number;
  server: Record<string, ProcSample>;
  pg: {
    cpuPct: number | null;
    memMb: number | null;
    commits: number | null;
    rollbacks: number | null;
    tupInserted: number | null;
    blkReadMs: number | null;
    blkWriteMs: number | null;
    deadlocks: number | null;
    backends: number | null;
    active: number | null;
    waitingOnLocks: number | null;
    walBytes: number | null;
  };
}

const HZ = 100;
const PAGE = 4096;
function procStat(pid: number): { ticks: number; rssMb: number } | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return {
      ticks: Number(rest[11]) + Number(rest[12]),
      rssMb: (Number(rest[21]) * PAGE) / 1048576,
    };
  } catch {
    return null;
  }
}
function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (_err, stdout) => resolve(String(stdout ?? '')));
  });
}

const PG_QUERY = `SELECT xact_commit, xact_rollback, tup_inserted, blk_read_time, blk_write_time, deadlocks,
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()),
  (SELECT count(*) FROM pg_locks WHERE NOT granted),
  (SELECT wal_bytes FROM pg_stat_wal)
  FROM pg_stat_database WHERE datname = current_database()`;

export class Monitor {
  readonly samples: Sample[] = [];
  tripped: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private last = new Map<number, { ticks: number; at: number }>();
  private readonly swapAtStart = meminfo().swapUsedMb;
  private busy = false;
  constructor(
    readonly limits: Limits = DEFAULT_LIMITS,
    readonly intervalMs = 5000,
    readonly onTrip: (reason: string) => void = () => undefined,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The reason the host is over a limit right now, or null. */
  check(): string | null {
    const load1 = os.loadavg()[0] ?? 0;
    const m = meminfo();
    if (load1 > this.limits.maxLoad1)
      return `load average ${load1.toFixed(1)} > ${this.limits.maxLoad1}`;
    if (m.availableMb < this.limits.minAvailableMb)
      return `available memory ${Math.round(m.availableMb)} MiB < ${this.limits.minAvailableMb} MiB`;
    if (m.swapUsedMb - this.swapAtStart > this.limits.maxSwapGrowthMb)
      return `swap grew by ${Math.round(m.swapUsedMb - this.swapAtStart)} MiB > ${this.limits.maxSwapGrowthMb} MiB`;
    return null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const reason = this.check();
      if (reason && !this.tripped) {
        this.tripped = reason;
        this.onTrip(reason);
      }
      const m = meminfo();
      const now = performance.now();
      const server: Record<string, ProcSample> = {};
      if (stateExists()) {
        for (const inst of readState().instances) {
          const s = procStat(inst.pid);
          const prev = this.last.get(inst.pid);
          server[String(inst.port)] = {
            cpuPct:
              s && prev ? ((s.ticks - prev.ticks) / HZ / ((now - prev.at) / 1000)) * 100 : null,
            rssMb: s?.rssMb ?? null,
          };
          if (s) this.last.set(inst.pid, { ticks: s.ticks, at: now });
        }
      }
      const [stats, rows] = await Promise.all([
        run('docker', [
          'stats',
          '--no-stream',
          '--format',
          '{{.CPUPerc}}|{{.MemUsage}}',
          PG_CONTAINER,
        ]),
        run('docker', [
          'exec',
          PG_CONTAINER,
          'psql',
          '-U',
          'rd',
          '-d',
          'realtimedocs_load',
          '-At',
          '-F',
          '|',
          '-c',
          PG_QUERY,
        ]),
      ]);
      const [cpu, mem] = stats.trim().split('|');
      const memMatch = /^([\d.]+)(MiB|GiB|KiB)/.exec(mem ?? '');
      const f = rows.trim().split('|').map(Number);
      const num = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? null : v);
      this.samples.push({
        t: Date.now(),
        load1: os.loadavg()[0] ?? 0,
        availableMb: m.availableMb,
        swapUsedMb: m.swapUsedMb,
        server,
        pg: {
          cpuPct: cpu ? Number.parseFloat(cpu) : null,
          memMb: memMatch
            ? Number(memMatch[1]) *
              (memMatch[2] === 'GiB' ? 1024 : memMatch[2] === 'KiB' ? 1 / 1024 : 1)
            : null,
          commits: num(f[0]),
          rollbacks: num(f[1]),
          tupInserted: num(f[2]),
          blkReadMs: num(f[3]),
          blkWriteMs: num(f[4]),
          deadlocks: num(f[5]),
          backends: num(f[6]),
          active: num(f[7]),
          waitingOnLocks: num(f[8]),
          walBytes: num(f[9]),
        },
      });
    } finally {
      this.busy = false;
    }
  }

  /** Peaks, averages and database rates between two wall-clock times. */
  summary(from: number, to: number) {
    const rows = this.samples.filter((s) => s.t >= from && s.t <= to + this.intervalMs);
    const max = (f: (s: Sample) => number | null) =>
      rows.reduce<number | null>((a, s) => {
        const v = f(s);
        return v === null ? a : a === null ? v : Math.max(a, v);
      }, null);
    const avg = (f: (s: Sample) => number | null) => {
      const v = rows.map(f).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const first = rows[0];
    const last = rows[rows.length - 1];
    const seconds = first && last ? (last.t - first.t) / 1000 : 0;
    const rate = (f: (s: Sample) => number | null) => {
      if (!first || !last || seconds <= 0) return null;
      const a = f(first);
      const b = f(last);
      return a === null || b === null ? null : (b - a) / seconds;
    };
    const ports = [...new Set(rows.flatMap((s) => Object.keys(s.server)))];
    const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    return {
      samples: rows.length,
      host: {
        load1Max: r1(max((s) => s.load1)),
        availableMbMin: r1(rows.reduce((a, s) => Math.min(a, s.availableMb), Infinity)),
        swapUsedMbMax: r1(max((s) => s.swapUsedMb)),
      },
      server: Object.fromEntries(
        ports.map((p) => [
          p,
          {
            cpuPctAvg: r1(avg((s) => s.server[p]?.cpuPct ?? null)),
            cpuPctMax: r1(max((s) => s.server[p]?.cpuPct ?? null)),
            rssMbMax: r1(max((s) => s.server[p]?.rssMb ?? null)),
          },
        ]),
      ),
      postgres: {
        cpuPctAvg: r1(avg((s) => s.pg.cpuPct)),
        cpuPctMax: r1(max((s) => s.pg.cpuPct)),
        memMbMax: r1(max((s) => s.pg.memMb)),
        commitsPerSecond: r1(rate((s) => s.pg.commits)),
        rollbacksPerSecond: r1(rate((s) => s.pg.rollbacks)),
        rowsInsertedPerSecond: r1(rate((s) => s.pg.tupInserted)),
        walMbPerSecond: r1((rate((s) => s.pg.walBytes) ?? 0) / 1048576),
        blockReadMs: r1((last?.pg.blkReadMs ?? 0) - (first?.pg.blkReadMs ?? 0)),
        blockWriteMs: r1((last?.pg.blkWriteMs ?? 0) - (first?.pg.blkWriteMs ?? 0)),
        deadlocks: (last?.pg.deadlocks ?? 0) - (first?.pg.deadlocks ?? 0),
        backendsMax: max((s) => s.pg.backends),
        activeMax: max((s) => s.pg.active),
        waitingOnLocksMax: max((s) => s.pg.waitingOnLocks),
      },
    };
  }
}

/** The statements that cost the most time, from pg_stat_statements (test container only). */
export async function topStatements(
  limit = 12,
): Promise<{ calls: number; meanMs: number; totalMs: number; rows: number; query: string }[]> {
  const out = await run(
    'docker',
    [
      'exec',
      PG_CONTAINER,
      'psql',
      '-U',
      'rd',
      '-d',
      'realtimedocs_load',
      '-At',
      '-F',
      '\t',
      '-c',
      `CREATE EXTENSION IF NOT EXISTS pg_stat_statements; SELECT calls, round(mean_exec_time::numeric, 3), round(total_exec_time::numeric, 1), rows, regexp_replace(left(query, 220), '\\s+', ' ', 'g') FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat%' ORDER BY total_exec_time DESC LIMIT ${limit}`,
    ],
    15_000,
  );
  return out
    .trim()
    .split('\n')
    .filter((l) => l.includes('\t'))
    .map((l) => {
      const [calls, mean, total, rows, query] = l.split('\t');
      return {
        calls: Number(calls),
        meanMs: Number(mean),
        totalMs: Number(total),
        rows: Number(rows),
        query: query ?? '',
      };
    });
}
export async function resetStatements(): Promise<void> {
  await run('docker', [
    'exec',
    PG_CONTAINER,
    'psql',
    '-U',
    'rd',
    '-d',
    'realtimedocs_load',
    '-c',
    'CREATE EXTENSION IF NOT EXISTS pg_stat_statements; SELECT pg_stat_statements_reset()',
  ]);
}
