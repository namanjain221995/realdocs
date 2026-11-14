/** Orchestrator context: workers, admin session, provisioning, aggregation, verification. */
import { type ChildProcess, execFileSync, fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Api } from './api';
import type { ClientSpec } from './client';
import {
  type Stats,
  type StackState,
  PORTS,
  adminPassword,
  loadRoot,
  mergeCounts,
  readState,
  sleep,
  stats,
} from './common';
import { type ServerSummary, Sampler, summarize } from './metrics';

export interface Opts {
  [k: string]: string | number | boolean | undefined;
}

export interface Collected {
  samples: Record<string, Record<string, number[]>>;
  counts: Record<string, Record<string, number>>;
  errors: Record<string, number>;
  closeCodes: Record<string, number>;
  uploadCounts: Record<string, Record<string, number>>;
  uploadSamples: Record<string, number[]>;
  health: {
    pid: number;
    cpuPct: number;
    cpuSecondsTotal: number;
    rssMb: number;
    lagP99Ms: number;
    lagMaxMs: number;
    clients: number;
  }[];
}

export interface DocRef {
  key: string;
  id: string;
  grantId: string;
  secret: string;
}

export interface PhaseRecord {
  name: string;
  durationS: number;
  latency: Record<string, Record<string, Stats>>;
  counts: Record<string, Record<string, number>>;
  errors: Record<string, number>;
  closeCodes: Record<string, number>;
  generator: Collected['health'];
  server: ServerSummary[];
  hostLoadMax: number;
  extra?: Record<string, unknown>;
}

export interface ScenarioResult {
  scenario: string;
  title: string;
  topology: string;
  startedAt: string;
  endedAt?: string;
  config: Record<string, unknown>;
  phases: PhaseRecord[];
  results: Record<string, unknown>;
  notes: string[];
  status: 'ok' | 'failed' | 'aborted';
  error?: string;
}

export class Ctx {
  workers: {
    proc: ChildProcess;
    pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
    nextId: number;
  }[] = [];
  admin!: Api;
  state!: StackState;
  sampler!: Sampler;
  specCounter = 0;
  /** The worker script; tests/performance uses its own, which extends this one. */
  workerEntry = path.join(loadRoot, 'src/worker.ts');
  docCounter = 0;
  constructor(
    readonly outDir: string,
    readonly opts: Opts,
  ) {}

  get origin(): string {
    return this.state.origin;
  }
  get ports(): number[] {
    return this.state.instances.map((i) => i.port);
  }
  num(name: string, def: number): number {
    const v = this.opts[name];
    return v === undefined ? def : Number(v);
  }

  async init(workerCount: number): Promise<void> {
    this.state = readState();
    this.admin = new Api(this.origin);
    await this.admin.login(this.state.adminEmail, adminPassword());
    this.sampler = new Sampler(() => readState().instances.map((i) => i.port), 5000);
    this.sampler.start();
    for (let i = 0; i < workerCount; i += 1) await this.spawnWorker();
    await this.all('init', { origin: this.origin });
  }

  private spawnWorker(): Promise<void> {
    return new Promise((resolve) => {
      const proc = fork(this.workerEntry, [], {
        execArgv: ['--import', 'tsx', '--max-old-space-size=3072'],
        serialization: 'advanced',
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      const w = {
        proc,
        pending: new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>(),
        nextId: 1,
      };
      proc.on('message', (m: any) => {
        if (m.ready) return resolve();
        const p = w.pending.get(m.id);
        if (!p) return;
        w.pending.delete(m.id);
        if (m.ok) p.resolve(m.result);
        else p.reject(new Error(m.error));
      });
      proc.on('exit', (code) => {
        for (const p of w.pending.values()) p.reject(new Error(`worker exited (${code})`));
      });
      this.workers.push(w);
    });
  }

  call<T = any>(i: number, cmd: string, args: unknown = {}): Promise<T> {
    const w = this.workers[i]!;
    return new Promise<T>((resolve, reject) => {
      const id = w.nextId++;
      w.pending.set(id, { resolve, reject });
      w.proc.send({ id, cmd, args });
    });
  }
  all<T = any>(cmd: string, args: unknown = {}): Promise<T[]> {
    return Promise.all(this.workers.map((_, i) => this.call<T>(i, cmd, args)));
  }

  async close(): Promise<void> {
    this.sampler?.stop();
    try {
      await Promise.race([this.all('stopAll'), sleep(10_000)]);
    } catch {
      /* ignore */
    }
    for (const w of this.workers) w.proc.kill('SIGKILL');
    this.workers = [];
  }

  // ── Provisioning ─────────────────────────────────────────────────────────

  async provision(
    count: number,
    title: string,
    opts: { role?: string; expiresAt?: string } = {},
  ): Promise<DocRef[]> {
    const out: DocRef[] = new Array(count);
    let next = 0;
    const run = async () => {
      for (;;) {
        const i = next++;
        if (i >= count) return;
        this.docCounter += 1;
        const seq = this.docCounter;
        const created = await this.admin.ok<{ document: { id: string } }>(
          'POST',
          '/api/documents',
          { title: `${title} ${seq}` },
        );
        const share = await this.admin.ok<{ share: { id: string }; url: string }>(
          'POST',
          `/api/documents/${created.document.id}/shares`,
          {
            role: opts.role ?? 'editor',
            label: 'load',
            ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
          },
        );
        out[i] = {
          key: `d${seq}`,
          id: created.document.id,
          grantId: share.share.id,
          secret: new URL(share.url).hash.slice(1),
        };
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, count) }, run));
    return out;
  }

  /** Builds specs for `perDoc` clients per document; documents are spread over workers. */
  specs(
    docs: DocRef[],
    perDoc: number,
    group: string | ((idx: number) => string),
    awareness = false,
    observeMode: 'default' | 'all' = 'default',
  ): ClientSpec[][] {
    const byWorker: ClientSpec[][] = this.workers.map(() => []);
    docs.forEach((doc, d) => {
      const w = byWorker[d % this.workers.length]!;
      for (let idx = 0; idx < perDoc; idx += 1) {
        this.specCounter += 1;
        w.push({
          key: `u${this.specCounter}`,
          docKey: doc.key,
          docId: doc.id,
          grantId: doc.grantId,
          secret: doc.secret,
          idx,
          group: typeof group === 'function' ? group(idx) : group,
          awareness,
          observe:
            perDoc < 2
              ? 'none'
              : idx === 0
                ? 'all'
                : idx === 1
                  ? 'first'
                  : observeMode === 'all' && idx < 3
                    ? 'all'
                    : 'none',
        });
      }
    });
    return byWorker;
  }

  async addClients(
    byWorker: ClientSpec[][],
    rampMs: number,
    auto: boolean,
  ): Promise<Record<string, number>> {
    const total: Record<string, number> = {};
    const results = await Promise.all(
      byWorker.map((specs, i) =>
        specs.length
          ? this.call<{ first: Record<string, number> }>(i, 'add', { specs, rampMs, auto })
          : Promise.resolve({ first: {} }),
      ),
    );
    for (const r of results) mergeCounts(total, r.first);
    return total;
  }

  async status() {
    const s = await this.all<{
      total: number;
      ready: number;
      notReady: number;
      unacked: number;
      acked: number;
      edits: number;
      access: number;
    }>('status');
    return s.reduce(
      (a, b) => ({
        total: a.total + b.total,
        ready: a.ready + b.ready,
        notReady: a.notReady + b.notReady,
        unacked: a.unacked + b.unacked,
        acked: a.acked + b.acked,
        edits: a.edits + b.edits,
        access: a.access + b.access,
      }),
      { total: 0, ready: 0, notReady: 0, unacked: 0, acked: 0, edits: 0, access: 0 },
    );
  }

  async collect(reset = true): Promise<Collected> {
    const parts: any[] = await this.all<any>('collect', { reset });
    const merged: Collected = {
      samples: {},
      counts: {},
      errors: {},
      closeCodes: {},
      uploadCounts: {},
      uploadSamples: {},
      health: [],
    };
    for (const p of parts) {
      for (const [group, metrics] of Object.entries(
        p.samples as Record<string, Record<string, number[]>>,
      )) {
        const g = (merged.samples[group] ??= {});
        for (const [m, arr] of Object.entries(metrics as Record<string, number[]>))
          pushAll((g[m] ??= []), arr);
      }
      for (const [group, c] of Object.entries(p.counts as Record<string, Record<string, number>>))
        mergeCounts((merged.counts[group] ??= {}), c);
      mergeCounts(merged.errors, p.errors);
      mergeCounts(merged.closeCodes, p.closeCodes);
      for (const [group, c] of Object.entries(
        p.uploadCounts as Record<string, Record<string, number>>,
      ))
        mergeCounts((merged.uploadCounts[group] ??= {}), c);
      for (const [k, arr] of Object.entries(p.uploadSamples as Record<string, number[]>))
        pushAll((merged.uploadSamples[k] ??= []), arr);
      merged.health.push(p.health);
    }
    return merged;
  }

  async phase(
    name: string,
    t0: number,
    t1: number,
    c: Collected,
    extra?: Record<string, unknown>,
  ): Promise<PhaseRecord> {
    await this.sampler.sampleNow();
    const latency: PhaseRecord['latency'] = {};
    const all: Record<string, number[]> = {};
    for (const [group, metrics] of Object.entries(c.samples)) {
      latency[group] = {};
      for (const [metric, arr] of Object.entries(metrics)) {
        latency[group]![metric] = stats(arr);
        pushAll((all[metric] ??= []), arr);
      }
    }
    latency.ALL = Object.fromEntries(Object.entries(all).map(([m, arr]) => [m, stats(arr)]));
    const counts = c.counts;
    return {
      name,
      durationS: (t1 - t0) / 1000,
      latency,
      counts,
      errors: c.errors,
      closeCodes: c.closeCodes,
      generator: c.health,
      server: this.ports.map((p) => summarize(this.sampler.rows, t0, t1 + 6000, p)),
      hostLoadMax: Math.max(
        0,
        ...this.sampler.rows.filter((r) => r.t >= t0 && r.t <= t1 + 6000).map((r) => r.load1),
      ),
      extra,
    };
  }

  /** Sleeps `ms`, logging progress, returning early if the host is overloaded. */
  async hold(ms: number, label: string, onTick?: () => Promise<void>): Promise<boolean> {
    const end = Date.now() + ms;
    let nextLog = Date.now();
    while (Date.now() < end) {
      if (this.sampler.overload) {
        log(`${label}: stopping early, host overloaded`);
        return false;
      }
      if (Date.now() >= nextLog) {
        log(
          `${label}: ${Math.max(0, Math.round((end - Date.now()) / 1000))}s left (host load ${os.loadavg()[0]?.toFixed(1)})`,
        );
        nextLog += 30_000;
      }
      if (onTick) await onTick();
      await sleep(Math.min(1000, Math.max(0, end - Date.now())));
    }
    return true;
  }

  async waitQuiet(timeoutMs = 60_000): Promise<{ ok: boolean; unacked: number; waitedMs: number }> {
    const t0 = Date.now();
    for (;;) {
      const s = await this.status();
      if (s.unacked === 0 && s.notReady === 0)
        return { ok: true, unacked: 0, waitedMs: Date.now() - t0 };
      if (Date.now() - t0 > timeoutMs)
        return { ok: false, unacked: s.unacked, waitedMs: Date.now() - t0 };
      await sleep(500);
    }
  }

  /** Every acknowledged marker must be in the document the server exports. */
  async verifyAcked(): Promise<{
    docs: number;
    checked: number;
    missing: number;
    missingSamples: string[];
    unackedAtEnd: number;
    exportErrors: number;
  }> {
    const parts = await this.all<Record<string, { acked: string[]; unacked: number }>>('verify');
    const docs: Record<string, { acked: Set<string>; unacked: number }> = {};
    for (const p of parts) {
      for (const [k, v] of Object.entries(p)) {
        const d = (docs[k] ??= { acked: new Set(), unacked: 0 });
        for (const m of v.acked) d.acked.add(m);
        d.unacked += v.unacked;
      }
    }
    const idByKey = new Map(this.knownDocs.map((d) => [d.key, d.id]));
    let checked = 0;
    let missing = 0;
    let unacked = 0;
    let exportErrors = 0;
    const samples: string[] = [];
    const keys = Object.keys(docs);
    let next = 0;
    const run = async () => {
      for (;;) {
        const i = next++;
        if (i >= keys.length) return;
        const key = keys[i]!;
        const d = docs[key]!;
        unacked += d.unacked;
        const id = idByKey.get(key);
        if (!id) continue;
        const r = await this.admin.request<any>('GET', `/api/documents/${id}/export?format=json`);
        if (r.status !== 200) {
          exportErrors += 1;
          continue;
        }
        const tokens = new Set<string>();
        const walk = (n: any) => {
          if (!n || typeof n !== 'object') return;
          if (typeof n.text === 'string') for (const t of n.text.split(/\s+/)) if (t) tokens.add(t);
          if (Array.isArray(n.content)) n.content.forEach(walk);
        };
        walk(r.body);
        for (const m of d.acked) {
          checked += 1;
          if (!tokens.has(m)) {
            missing += 1;
            if (samples.length < 10) samples.push(`${key}:${m}`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, run));
    return {
      docs: keys.length,
      checked,
      missing,
      missingSamples: samples,
      unackedAtEnd: unacked,
      exportErrors,
    };
  }
  knownDocs: DocRef[] = [];

  save(name: string, data: unknown): void {
    mkdirSync(this.outDir, { recursive: true });
    writeFileSync(path.join(this.outDir, name), JSON.stringify(data, null, 1));
  }

  async lb(pathname: string): Promise<any> {
    const r = await fetch(`http://127.0.0.1:${PORTS.lbControl}${pathname}`);
    return r.json();
  }

  dockerContainerStats(names: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const n of names) {
      try {
        out[n] = execFileSync(
          'docker',
          ['stats', '--no-stream', '--format', '{{.CPUPerc}} cpu, {{.MemUsage}}', n],
          { encoding: 'utf8' },
        ).trim();
      } catch {
        out[n] = 'n/a';
      }
    }
    return out;
  }
}

export function pushAll(into: number[], from: number[]): void {
  for (let i = 0; i < from.length; i += 1) into.push(from[i] as number);
}

export function log(line: string): void {
  process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${line}\n`);
}
