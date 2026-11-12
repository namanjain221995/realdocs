/** Prometheus text scraping, time series and window summaries for the server instances. */
import os from 'node:os';
import { METRICS_TOKEN, HOST, sleep } from './common';

export type Parsed = Map<string, number>;

export function parseProm(text: string): Parsed {
  const out: Parsed = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.lastIndexOf(' ');
    if (i < 0) continue;
    const v = Number(line.slice(i + 1));
    if (Number.isFinite(v)) out.set(line.slice(0, i), v);
  }
  return out;
}

export async function scrape(port: number, timeoutMs = 4000): Promise<Parsed | null> {
  try {
    const r = await fetch(`http://${HOST}:${port}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return parseProm(await r.text());
  } catch {
    return null;
  }
}

const GAUGES = [
  'rd_ws_connections',
  'rd_ws_forwarded_connections',
  'rd_documents_loaded',
  'rd_persist_queue_bytes',
  'rd_db_pool_connections',
  'rd_db_pool_idle',
  'rd_db_pool_waiting',
  'rd_db_pool_max',
  'rd_event_loop_lag_p99_seconds',
  'rd_process_resident_memory_bytes',
  'rd_process_heap_used_bytes',
  'rd_process_cpu_seconds_total',
  'rd_yjs_updates_total',
  'rd_redis_ping_seconds',
  'rd_redis_up',
  'rd_persist_failures_total',
  'rd_redis_errors_total',
  'rd_uploads_total',
];

export interface Row {
  t: number;
  load1: number;
  inst: { port: number; up: boolean; all: Parsed | null }[];
}

export class Sampler {
  rows: Row[] = [];
  private timer: NodeJS.Timeout | null = null;
  loadHighSince: number | null = null;
  overload = false;
  maxLoad = 0;
  constructor(
    private readonly ports: () => number[],
    private readonly intervalMs = 5000,
    private readonly loadLimit = 18,
  ) {}

  async sampleNow(): Promise<Row> {
    const t = Date.now();
    const load1 = os.loadavg()[0] ?? 0;
    const inst = await Promise.all(
      this.ports().map(async (port) => {
        const all = await scrape(port);
        return { port, up: all !== null, all };
      }),
    );
    const row: Row = { t, load1, inst };
    this.rows.push(row);
    this.maxLoad = Math.max(this.maxLoad, load1);
    if (load1 > this.loadLimit) {
      this.loadHighSince ??= t;
      if (t - this.loadHighSince > 60_000 && !this.overload) {
        this.overload = true;
        process.stderr.write(
          `[guard] host load ${load1.toFixed(1)} > ${this.loadLimit} for over a minute\n`,
        );
      }
    } else {
      this.loadHighSince = null;
    }
    return row;
  }

  start(): void {
    const tick = async () => {
      await this.sampleNow().catch(() => undefined);
      this.timer = setTimeout(() => void tick(), this.intervalMs);
    };
    void tick();
  }
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Compact series for the result file (gauges only, one object per instance). */
  series(from = 0, to = Infinity) {
    return this.rows
      .filter((r) => r.t >= from && r.t <= to)
      .map((r) => ({
        t: r.t,
        load1: r.load1,
        inst: r.inst.map((i) => {
          const m: Record<string, number> = {};
          if (i.all)
            for (const g of GAUGES) {
              const v = i.all.get(g);
              if (v !== undefined) m[g] = v;
            }
          return { port: i.port, up: i.up, m };
        }),
      }));
  }
}

export interface ServerSummary {
  port: number;
  samples: number;
  upSamples: number;
  cpuPctAvg: number | null;
  cpuPctMax: number | null;
  rssMbMax: number | null;
  rssMbEnd: number | null;
  heapMbMax: number | null;
  wsMax: number | null;
  wsForwardedMax: number | null;
  docsLoadedMax: number | null;
  poolMax: number | null;
  poolConnectionsMax: number | null;
  poolWaitingMax: number | null;
  poolWaitingAvg: number | null;
  lagP99MaxMs: number | null;
  queueBytesMax: number | null;
  redisPingMaxMs: number | null;
  yjsUpdates: number | null;
  persistFailures: number | null;
  persist: Record<
    string,
    { count: number; meanMs: number | null; p95UpperMs: number | null; p99UpperMs: number | null }
  >;
  http: Record<string, { count: number; meanMs: number | null; p95UpperMs: number | null }>;
  wsOutcomes: Record<string, number>;
}

function g(p: Parsed | null, k: string): number | undefined {
  return p?.get(k);
}

function histDelta(
  start: Parsed | null,
  end: Parsed | null,
  name: string,
  match: (labels: string) => string | null,
): Record<
  string,
  {
    count: number;
    meanMs: number | null;
    p95UpperMs: number | null;
    p99UpperMs: number | null;
    _b: [number, number][];
  }
> {
  const groups: Record<string, { sum: number; count: number; buckets: Map<number, number> }> = {};
  if (!end) return {};
  for (const [key, value] of end) {
    if (!key.startsWith(name)) continue;
    const m = /^([a-z_]+)(\{.*\})?$/.exec(key);
    if (!m) continue;
    const suffix = m[1]!.slice(name.length);
    const labels = m[2] ?? '';
    if (!['_bucket', '_sum', '_count'].includes(suffix)) continue;
    const base = start?.get(key) ?? 0;
    const delta = value - base;
    let lab = labels;
    let le: number | null = null;
    if (suffix === '_bucket') {
      const lm = /le="([^"]+)"/.exec(labels);
      if (!lm) continue;
      le = lm[1] === '+Inf' ? Infinity : Number(lm[1]);
      lab = labels
        .replace(/,?le="[^"]+"/, '')
        .replace('{,', '{')
        .replace(/\{\}$/, '');
    }
    const grp = match(lab);
    if (grp === null) continue;
    const entry = (groups[grp] ??= { sum: 0, count: 0, buckets: new Map() });
    if (suffix === '_sum') entry.sum += delta;
    else if (suffix === '_count') entry.count += delta;
    else entry.buckets.set(le!, (entry.buckets.get(le!) ?? 0) + delta);
  }
  const out: ReturnType<typeof histDelta> = {};
  for (const [grp, e] of Object.entries(groups)) {
    const sorted = [...e.buckets.entries()].sort((a, b) => a[0] - b[0]);
    const upper = (q: number): number | null => {
      if (e.count <= 0) return null;
      for (const [le, c] of sorted)
        if (c >= q * e.count) return le === Infinity ? Infinity : le * 1000;
      return null;
    };
    out[grp] = {
      count: e.count,
      meanMs: e.count > 0 ? (e.sum / e.count) * 1000 : null,
      p95UpperMs: upper(0.95),
      p99UpperMs: upper(0.99),
      _b: sorted,
    };
  }
  return out;
}

export function summarize(rows: Row[], from: number, to: number, port: number): ServerSummary {
  const sel = rows.filter((r) => r.t >= from && r.t <= to);
  const pts = sel
    .map((r) => ({ t: r.t, i: r.inst.find((x) => x.port === port) }))
    .filter((x) => x.i);
  const ups = pts.filter((p) => p.i!.up);
  const vals = (k: string) =>
    ups.map((p) => g(p.i!.all, k)).filter((v): v is number => v !== undefined);
  const max = (a: number[]) => (a.length ? Math.max(...a) : null);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  // CPU% from consecutive cpu-second counters (skip restarts: negative deltas).
  const cpu: number[] = [];
  for (let i = 1; i < ups.length; i += 1) {
    const a = g(ups[i - 1]!.i!.all, 'rd_process_cpu_seconds_total');
    const b = g(ups[i]!.i!.all, 'rd_process_cpu_seconds_total');
    const dt = (ups[i]!.t - ups[i - 1]!.t) / 1000;
    if (a !== undefined && b !== undefined && b >= a && dt > 0.5) cpu.push(((b - a) / dt) * 100);
  }
  const first = ups[0]?.i?.all ?? null;
  const last = ups[ups.length - 1]?.i?.all ?? null;
  const mb = (v: number | null) => (v === null ? null : v / 1048576);
  const persistHist = histDelta(
    first,
    last,
    'rd_persist_duration_seconds',
    (l) => /phase="([^"]+)"/.exec(l)?.[1] ?? 'all',
  );
  const httpHist = histDelta(first, last, 'rd_http_request_duration_seconds', (l) => {
    const route = /route="([^"]+)"/.exec(l)?.[1] ?? '';
    if (!route.startsWith('/api/') || route === '/api/health' || route === '/api/ready')
      return null;
    return route;
  });
  // Aggregate of all /api routes
  const allHttp: ServerSummary['http'] = {};
  const agg = new Map<number, number>();
  let aggCount = 0;
  let aggSum = 0;
  const httpSumCount = histDelta(first, last, 'rd_http_request_duration_seconds', (l) => {
    const route = /route="([^"]+)"/.exec(l)?.[1] ?? '';
    return route.startsWith('/api/') && route !== '/api/health' && route !== '/api/ready'
      ? 'ALL /api'
      : null;
  });
  for (const [route, v] of Object.entries(httpSumCount)) {
    void route;
    aggCount = v.count;
    aggSum = (v.meanMs ?? 0) * v.count;
    for (const [le, c] of v._b) agg.set(le, c);
  }
  void aggSum;
  for (const [route, v] of Object.entries(httpSumCount)) {
    allHttp[route] = { count: v.count, meanMs: v.meanMs, p95UpperMs: v.p95UpperMs };
  }
  void aggCount;
  const top = Object.entries(httpHist)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12);
  for (const [route, v] of top)
    allHttp[route] = { count: v.count, meanMs: v.meanMs, p95UpperMs: v.p95UpperMs };
  const wsOutcomes: Record<string, number> = {};
  if (last) {
    for (const [k, v] of last) {
      const m = /^rd_ws_connections_total\{outcome="([^"]+)"\}$/.exec(k);
      if (m) wsOutcomes[m[1]!] = v - (first?.get(k) ?? 0);
    }
  }
  const yjs = g(last, 'rd_yjs_updates_total');
  const yjs0 = g(first, 'rd_yjs_updates_total');
  return {
    port,
    samples: pts.length,
    upSamples: ups.length,
    cpuPctAvg: avg(cpu),
    cpuPctMax: max(cpu),
    rssMbMax: mb(max(vals('rd_process_resident_memory_bytes'))),
    rssMbEnd: mb(g(last, 'rd_process_resident_memory_bytes') ?? null),
    heapMbMax: mb(max(vals('rd_process_heap_used_bytes'))),
    wsMax: max(vals('rd_ws_connections')),
    wsForwardedMax: max(vals('rd_ws_forwarded_connections')),
    docsLoadedMax: max(vals('rd_documents_loaded')),
    poolMax: max(vals('rd_db_pool_max')),
    poolConnectionsMax: max(vals('rd_db_pool_connections')),
    poolWaitingMax: max(vals('rd_db_pool_waiting')),
    poolWaitingAvg: avg(vals('rd_db_pool_waiting')),
    lagP99MaxMs: (() => {
      const m = max(vals('rd_event_loop_lag_p99_seconds'));
      return m === null ? null : m * 1000;
    })(),
    queueBytesMax: max(vals('rd_persist_queue_bytes')),
    redisPingMaxMs: (() => {
      const m = max(vals('rd_redis_ping_seconds'));
      return m === null ? null : m * 1000;
    })(),
    yjsUpdates: yjs !== undefined ? yjs - (yjs0 ?? 0) : null,
    persistFailures:
      (g(last, 'rd_persist_failures_total') ?? 0) - (g(first, 'rd_persist_failures_total') ?? 0),
    persist: Object.fromEntries(
      Object.entries(persistHist).map(([k, v]) => [
        k,
        { count: v.count, meanMs: v.meanMs, p95UpperMs: v.p95UpperMs, p99UpperMs: v.p99UpperMs },
      ]),
    ),
    http: allHttp,
    wsOutcomes,
  };
}

export { sleep };
