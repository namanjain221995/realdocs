/**
 * Scenarios of the performance framework. Letters follow the owner's test plan:
 * A two people in one document, B 100 documents x 2, C 500 documents x 2, D up to 100 people in
 * one document, E connection and editor escalation; plus api, large, stress, soak, reliability.
 * Building blocks (provisioning through the real API, clients, latency probes, the zero-loss
 * check against the server's export) come from tests/load.
 */
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api } from '../../load/src/api';
import { adminPassword, round, sleep, stats, type Stats } from '../../load/src/common';
import { type Ctx, type DocRef, type ScenarioResult, log } from '../../load/src/ctx';
import { noisePng } from '../../load/src/png';
import { SCENARIOS as LOAD } from '../../load/src/scenarios';
import { resetStatements, topStatements, type Monitor } from './monitor';
import type { Profile } from './worker';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROFILES = JSON.parse(
  readFileSync(path.join(here, 'profiles.json'), 'utf8'),
) as Record<string, Profile>;
const sec = (s: number) => s * 1000;

export interface PerfCtx extends Ctx {
  monitor: Monitor;
  seed: number;
}
export type Scenario = (ctx: PerfCtx, res: ScenarioResult) => Promise<void>;

/** Objectives of the test plan; a step is "stable" only when all of them hold. */
export const OBJECTIVES = { p50: 50, p95: 100, p99: 200, connectSuccessPct: 99.9 };

interface Verdict {
  stable: boolean;
  reasons: string[];
}
function judge(input: {
  remote?: Stats;
  connectOkPct?: number;
  missing?: number;
  diverged?: number;
  aborted?: string | null;
  notReady?: number;
}): Verdict {
  const reasons: string[] = [];
  const r = input.remote;
  if (r && r.n > 0) {
    if ((r.p50 ?? 0) > OBJECTIVES.p50) reasons.push(`p50 ${r.p50} ms > ${OBJECTIVES.p50}`);
    if ((r.p95 ?? 0) > OBJECTIVES.p95) reasons.push(`p95 ${r.p95} ms > ${OBJECTIVES.p95}`);
    if ((r.p99 ?? 0) > OBJECTIVES.p99) reasons.push(`p99 ${r.p99} ms > ${OBJECTIVES.p99}`);
  }
  if (input.connectOkPct !== undefined && input.connectOkPct < OBJECTIVES.connectSuccessPct)
    reasons.push(`connection success ${input.connectOkPct}% < ${OBJECTIVES.connectSuccessPct}%`);
  if (input.missing) reasons.push(`${input.missing} acknowledged edits missing from the export`);
  if (input.diverged) reasons.push(`${input.diverged} documents diverged between clients`);
  if (input.notReady) reasons.push(`${input.notReady} clients not connected at the end`);
  if (input.aborted) reasons.push(`aborted by the watchdog: ${input.aborted}`);
  return { stable: reasons.length === 0, reasons };
}

async function converge(ctx: Ctx) {
  const parts = await ctx.all<{
    docs: number;
    diverged: number;
    compared: number;
    samples: string[];
    digests: Record<string, string>;
  }>('converge');
  return parts.reduce(
    (a, b) => ({
      docs: a.docs + b.docs,
      diverged: a.diverged + b.diverged,
      clientsCompared: a.clientsCompared + b.compared,
      samples: [...a.samples, ...b.samples].slice(0, 5),
    }),
    { docs: 0, diverged: 0, clientsCompared: 0, samples: [] as string[] },
  );
}

interface EditRun {
  docs: number;
  perDoc: number;
  assign: string[];
  rampS: number;
  warmupS: number;
  durationS: number;
  name: string;
}
/** Connect, behave by profile, measure a steady interval, quiesce, verify durability and convergence. */
async function editRun(ctx: PerfCtx, res: ScenarioResult, p: EditRun) {
  const docs = await ctx.provision(p.docs, res.scenario);
  ctx.knownDocs.push(...docs);
  const specs = ctx.specs(docs, p.perDoc, 'u', true);
  const users = p.docs * p.perDoc;
  log(`connecting ${users} users to ${p.docs} documents over ${p.rampS}s`);
  const t0 = Date.now();
  const first = await ctx.addClients(specs, sec(p.rampS), true);
  res.phases.push(
    await ctx.phase('connect', t0, Date.now(), await ctx.collect(true), { firstAttempt: first }),
  );
  await sleep(3000);
  await ctx.all('behave', { seed: ctx.seed, profiles: PROFILES, assign: p.assign });
  await ctx.hold(sec(p.warmupS), 'warm-up');
  await ctx.collect(true);
  await resetStatements();
  const tStart = Date.now();
  const full = await ctx.hold(sec(p.durationS), p.name);
  const tEnd = Date.now();
  const c = await ctx.collect(true);
  const sum = (name: string) => Object.values(c.counts).reduce((a, g) => a + (g[name] ?? 0), 0);
  const seconds = (tEnd - tStart) / 1000;
  const phase = await ctx.phase(p.name, tStart, tEnd, c, {
    usersActive: users,
    markerEditsPerSecond: round(sum('edits') / seconds, 1),
    deletesPerSecond: round(sum('deletes') / seconds, 2),
    formatsPerSecond: round(sum('formats') / seconds, 2),
    cursorUpdatesPerSecond: round(sum('cursor_updates') / seconds, 2),
    connectionDrops: sum('drops'),
    reconnects: sum('reconnects'),
    completedFullDuration: full,
    system: ctx.monitor.summary(tStart, tEnd),
  });
  res.phases.push(phase);
  await ctx.all('stopBehave');
  const quiet = await ctx.waitQuiet(90_000);
  const status = await ctx.status();
  const verification = await ctx.verifyAcked();
  const convergence = await converge(ctx);
  const statements = await topStatements();
  const okFirst = first.ok ?? 0;
  const remote = phase.latency.ALL?.remote;
  res.results = {
    ...res.results,
    connection: {
      attempted: users,
      succeededFirstAttempt: okFirst,
      successPct: round((okFirst / users) * 100, 3),
      failuresByCause: Object.fromEntries(Object.entries(first).filter(([k]) => k !== 'ok')),
    },
    quiesce: quiet,
    connectedAtEnd: status.ready,
    verification,
    convergence,
    topStatements: statements,
    verdict: judge({
      remote,
      connectOkPct: (okFirst / users) * 100,
      missing: verification.missing,
      diverged: convergence.diverged,
      aborted: ctx.monitor.tripped,
      notReady: status.notReady,
    }),
  };
  return docs;
}

// A ─────────────────────────────────────────────────────────────────────────────
const A: Scenario = async (ctx, res) => {
  const rounds = ctx.num('rounds', 40);
  res.config = { documents: 1, users: 2, rounds, workers: 'one process, one clock' };
  const [doc] = await ctx.provision(1, 'pair');
  ctx.knownDocs.push(doc!);
  const specs = ctx.specs([doc!], 2, 'pair', true, 'all');
  const t0 = Date.now();
  const first = await ctx.addClients(specs, 500, true);
  const worker = specs.findIndex((s) => s.length > 0);
  const tStart = Date.now();
  const out = await ctx.call<{
    samples: Record<string, number[]>;
    simultaneousTokens: number;
    simultaneousMissingAtA: number;
    converged: boolean;
    digest: string;
    stateBytes: number;
  }>(worker, 'pairSession', { rounds });
  const tEnd = Date.now();
  const latency = Object.fromEntries(
    Object.entries(out.samples).map(([k, v]) => [k, stats(v.filter((x) => !Number.isNaN(x)))]),
  );
  const timeouts = Object.fromEntries(
    Object.entries(out.samples).map(([k, v]) => [k, v.filter((x) => Number.isNaN(x)).length]),
  );
  const edits = Object.entries(out.samples)
    .filter(([k]) => k.endsWith(':remote') && !k.startsWith('cursor'))
    .flatMap(([, v]) => v.filter((x) => !Number.isNaN(x)));
  const acks = Object.entries(out.samples)
    .filter(([k]) => k.endsWith(':ack'))
    .flatMap(([, v]) => v.filter((x) => !Number.isNaN(x)));
  res.phases.push(
    await ctx.phase('pair session', tStart, tEnd, await ctx.collect(true), {
      firstAttempt: first,
      system: ctx.monitor.summary(t0, tEnd),
    }),
  );
  // Save and reload: a fresh client must receive exactly what the two people hold.
  const reload = await ctx.call<{ ms: number | null; stateBytes?: number; blocks?: number }[]>(
    worker,
    'probe',
    { spec: { ...specs[worker]![0]!, key: 'reload' }, count: 3 },
  );
  const exported = await ctx.admin.request<any>(
    'GET',
    `/api/documents/${doc!.id}/export?format=json`,
  );
  const text = JSON.stringify(exported.body);
  res.results = {
    operationLatencyMs: latency,
    timeoutsPerOperation: timeouts,
    editToRemoteVisibleAllOperations: stats(edits),
    editToSavedAcknowledgement: stats(acks),
    simultaneousTyping: {
      tokensTyped: out.simultaneousTokens,
      missingAfterMerge: out.simultaneousMissingAtA,
      inServerExport: (text.match(/s[ab]\d+x/g) ?? []).length,
    },
    convergedBetweenTheTwoClients: out.converged,
    reloadByFreshClient: reload,
    serverExportStatus: exported.status,
    documentStateBytes: out.stateBytes,
    verdict: judge({
      remote: stats(edits),
      connectOkPct: ((first.ok ?? 0) / 2) * 100,
      missing: out.simultaneousMissingAtA,
      diverged: out.converged ? 0 : 1,
      aborted: ctx.monitor.tripped,
    }),
  };
};

// B, C ──────────────────────────────────────────────────────────────────────────
const B: Scenario = async (ctx, res) => {
  const p: EditRun = {
    docs: ctx.num('docs', 100),
    perDoc: 2,
    assign: ['active'],
    rampS: ctx.num('ramp', 20),
    warmupS: 15,
    durationS: ctx.num('duration', 180),
    name: '200 active editors',
  };
  res.config = { ...p, profile: PROFILES.active, seed: ctx.seed };
  await editRun(ctx, res, p);
};
const C: Scenario = async (ctx, res) => {
  const p: EditRun = {
    docs: ctx.num('docs', 500),
    perDoc: 2,
    // Everyone edits; two in five at the "normal" pace, two at "active", one "heavy".
    assign: ['normal', 'active', 'heavy', 'active', 'normal'],
    rampS: ctx.num('ramp', 60),
    warmupS: 20,
    durationS: ctx.num('duration', 300),
    name: '1,000 active editors',
  };
  res.config = {
    ...p,
    profiles: { normal: PROFILES.normal, active: PROFILES.active, heavy: PROFILES.heavy },
    seed: ctx.seed,
  };
  await editRun(ctx, res, p);
};

// D ─────────────────────────────────────────────────────────────────────────────
const D: Scenario = async (ctx, res) => {
  const steps = String(ctx.opts.steps ?? '2,5,10,25,50,75,100')
    .split(',')
    .map(Number);
  const holdS = ctx.num('duration', 60);
  res.config = { steps, holdS, profile: PROFILES.active, seed: ctx.seed, documents: 1 };
  const [doc] = await ctx.provision(1, 'hot');
  ctx.knownDocs.push(doc!);
  const max = Math.max(...steps);
  const all = ctx
    .specs([doc!], max, (idx) => (idx < 10 ? 'core' : 'rest'), true, 'all')
    .find((s) => s.length > 0)!;
  const worker = 0;
  const rows: unknown[] = [];
  let connected = 0;
  for (const n of steps) {
    if (ctx.monitor.tripped) break;
    const add = all.slice(connected, n);
    const byWorker = ctx.workers.map((_, i) => (i === worker ? add : []));
    const t0 = Date.now();
    const first = await ctx.addClients(byWorker, 3000, true);
    connected = n;
    await ctx.all('behave', { seed: ctx.seed, profiles: PROFILES, assign: ['active'] });
    await ctx.hold(sec(10), `warm-up ${n}`);
    await ctx.collect(true);
    const tStart = Date.now();
    await ctx.hold(sec(holdS), `${n} people editing one document`);
    const tEnd = Date.now();
    const c = await ctx.collect(true);
    const edits = Object.values(c.counts).reduce((a, g) => a + (g.edits ?? 0), 0);
    const phase = await ctx.phase(`${n} editors`, tStart, tEnd, c, {
      connected: n,
      activelyEditing: n,
      firstAttempt: first,
      markerEditsPerSecond: round(edits / ((tEnd - tStart) / 1000), 1),
      system: ctx.monitor.summary(tStart, tEnd),
      connectS: round((tStart - t0) / 1000, 1),
    });
    res.phases.push(phase);
    const remote = phase.latency.ALL?.remote;
    rows.push({
      connected: n,
      activelyEditing: n,
      editsPerSecond: round(edits / ((tEnd - tStart) / 1000), 1),
      remote,
      ack: phase.latency.ALL?.ack,
      verdict: judge({ remote, aborted: ctx.monitor.tripped }),
    });
    await ctx.all('stopBehave');
  }
  // Connected is not the same as editing: all connected, ten editing.
  if (!ctx.monitor.tripped && connected >= 25) {
    await ctx.all('behave', {
      seed: ctx.seed,
      profiles: PROFILES,
      assign: ['active'],
      groups: ['core'],
    });
    await ctx.hold(sec(10), 'warm-up (10 of all editing)');
    await ctx.collect(true);
    const tStart = Date.now();
    await ctx.hold(sec(holdS), `${connected} connected, 10 editing`);
    const tEnd = Date.now();
    const c = await ctx.collect(true);
    const phase = await ctx.phase(`${connected} connected, 10 editing`, tStart, tEnd, c, {
      connected,
      activelyEditing: 10,
      system: ctx.monitor.summary(tStart, tEnd),
    });
    res.phases.push(phase);
    rows.push({
      connected,
      activelyEditing: 10,
      remote: phase.latency.ALL?.remote,
      ack: phase.latency.ALL?.ack,
      verdict: judge({ remote: phase.latency.ALL?.remote, aborted: ctx.monitor.tripped }),
    });
    await ctx.all('stopBehave');
  }
  const quiet = await ctx.waitQuiet(120_000);
  res.results = {
    steps: rows,
    quiesce: quiet,
    verification: await ctx.verifyAcked(),
    convergence: await converge(ctx),
  };
};

// E ─────────────────────────────────────────────────────────────────────────────
/**
 * Escalation. `mix` gives the share of documents per class: `idle` (connected, presence only),
 * `viewing` (one light editor, cursor movement), `active` (both people on the "active" profile).
 * With `--mix active` every user is an active editor.
 */
const E: Scenario = async (ctx, res) => {
  const steps = String(ctx.opts.steps ?? '100,250,500,750,1000,1500,2000,3000,5000')
    .split(',')
    .map(Number);
  const allActive = String(ctx.opts.mix ?? 'mixed') === 'active';
  const holdS = ctx.num('duration', 60);
  const share = allActive
    ? { idle: 0, viewing: 0, active: 1 }
    : { idle: 0.5, viewing: 0.3, active: 0.2 };
  res.config = {
    steps,
    holdS,
    perDocument: 2,
    classShares: share,
    profiles: { viewing: PROFILES.light, active: PROFILES.active },
    seed: ctx.seed,
  };
  const rows: any[] = [];
  let users = 0;
  let lastStable = 0;
  for (const target of steps) {
    const reason = ctx.monitor.check() ?? ctx.monitor.tripped;
    if (reason) {
      rows.push({ users: target, skipped: `not attempted: ${reason}` });
      break;
    }
    const addDocs = Math.round((target - users) / 2);
    const nIdle = Math.round(addDocs * share.idle);
    const nView = Math.round(addDocs * share.viewing);
    const docs = await ctx.provision(addDocs, `E${target}`);
    ctx.knownDocs.push(...docs);
    const merged = ctx.workers.map(() => [] as any[]);
    const put = (slice: DocRef[], group: string) =>
      ctx.specs(slice, 2, group, true).forEach((s, i) => merged[i]!.push(...s));
    put(docs.slice(0, nIdle), 'idle');
    put(docs.slice(nIdle, nIdle + nView), 'viewing');
    put(docs.slice(nIdle + nView), 'active');
    const t0 = Date.now();
    const first = await ctx.addClients(
      merged,
      sec(Math.min(90, Math.max(10, (target - users) / 40))),
      true,
    );
    users = target;
    await ctx.all('presence', { on: true, rate: 0.1, groups: ['idle'] });
    await ctx.all('behave', {
      seed: ctx.seed,
      profiles: PROFILES,
      assign: ['light'],
      groups: ['viewing'],
    });
    await ctx.all('behave', {
      seed: ctx.seed,
      profiles: PROFILES,
      assign: ['active'],
      groups: ['active'],
    });
    await ctx.hold(sec(10), `warm-up ${target}`);
    await ctx.collect(true);
    const tStart = Date.now();
    const full = await ctx.hold(sec(holdS), `${target} users`);
    const tEnd = Date.now();
    // The profiles drop connections on purpose; a client that is reconnecting at this instant is
    // not a failure. Only someone who stays disconnected for ten seconds counts.
    let status = await ctx.status();
    for (let i = 0; i < 20 && status.notReady > 0; i += 1) {
      await sleep(500);
      status = await ctx.status();
    }
    const c = await ctx.collect(true);
    const edits = Object.values(c.counts).reduce((a, g) => a + (g.edits ?? 0), 0);
    const phase = await ctx.phase(`${target} users`, tStart, tEnd, c, {
      firstAttempt: first,
      connectS: round((tStart - t0) / 1000, 1),
      connected: status.ready,
      notConnected: status.notReady,
      classes: {
        idle: allActive ? 0 : Math.round(target * share.idle),
        viewing: allActive ? 0 : Math.round(target * share.viewing),
        activeEditors: allActive ? target : Math.round(target * share.active),
      },
      markerEditsPerSecond: round(edits / ((tEnd - tStart) / 1000), 1),
      completedFullDuration: full,
      system: ctx.monitor.summary(tStart, tEnd),
    });
    res.phases.push(phase);
    const added = addDocs * 2;
    const okPct = ((first.ok ?? 0) / added) * 100;
    const verdict = judge({
      remote: phase.latency.ALL?.remote,
      connectOkPct: okPct,
      aborted: ctx.monitor.tripped,
      notReady: status.notReady,
    });
    rows.push({
      users: target,
      connected: status.ready,
      newConnectionSuccessPct: round(okPct, 3),
      failuresByCause: Object.fromEntries(Object.entries(first).filter(([k]) => k !== 'ok')),
      editsPerSecond: round(edits / ((tEnd - tStart) / 1000), 1),
      remote: phase.latency.ALL?.remote,
      ack: phase.latency.ALL?.ack,
      presence: phase.latency.ALL?.presence,
      verdict,
    });
    log(
      `step ${target}: ${verdict.stable ? 'stable' : `NOT stable (${verdict.reasons.join('; ')})`}`,
    );
    if (verdict.stable) lastStable = target;
    else break;
  }
  await ctx.all('stopBehave');
  await ctx.all('presence', { on: false });
  const quiet = await ctx.waitQuiet(120_000);
  res.results = {
    steps: rows,
    maximumStableUsers: lastStable,
    criterion: `all of: p50 <= ${OBJECTIVES.p50} ms, p95 <= ${OBJECTIVES.p95} ms, p99 <= ${OBJECTIVES.p99} ms edit to remote; new connections >= ${OBJECTIVES.connectSuccessPct}% on the first attempt; nobody disconnected at the end of the step; watchdog quiet`,
    quiesce: quiet,
    verification: await ctx.verifyAcked(),
    convergence: await converge(ctx),
  };
};

// API ───────────────────────────────────────────────────────────────────────────
async function closedLoop(
  concurrency: number,
  seconds: number,
  fn: (i: number) => Promise<{ status: number; ms: number }>,
) {
  const ms: number[] = [];
  const statuses: Record<string, number> = {};
  const end = Date.now() + seconds * 1000;
  let i = 0;
  let total = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < end) {
        try {
          const r = await fn(i++);
          // Latency of the successful requests only: a refusal by a limiter is fast and would flatter it.
          if (r.status >= 200 && r.status < 300) ms.push(r.ms);
          total += 1;
          statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        } catch (e) {
          const k = `error_${(e as any)?.cause?.code ?? (e as Error).name}`;
          statuses[k] = (statuses[k] ?? 0) + 1;
        }
      }
    }),
  );
  const elapsed = (Date.now() - t0) / 1000;
  const limited = statuses['429'] ?? 0;
  const errors = Object.entries(statuses)
    .filter(([k]) => !/^2\d\d$/.test(k) && k !== '429' && k !== '409')
    .reduce((a, [, v]) => a + v, 0);
  return {
    concurrency,
    seconds: round(elapsed, 1),
    requests: total,
    successfulPerSecond: round(ms.length / elapsed, 1),
    latencyOfSuccessfulMs: stats(ms),
    statuses,
    refusedByLimiter: limited,
    errorRatePct: round((errors / Math.max(1, total)) * 100, 3),
  };
}

const api: Scenario = async (ctx, res) => {
  const seconds = ctx.num('duration', 20);
  const conc = ctx.num('concurrency', 16);
  const admin = ctx.admin;
  res.config = { secondsPerEndpoint: seconds, concurrency: conc, loop: 'closed loop' };
  const out: Record<string, unknown> = {};
  await resetStatements();
  const tStart = Date.now();
  // Login as it is: a deliberately slow password hash and a per-address and per-account limiter.
  const logins: { status: number; ms: number }[] = [];
  for (let i = 0; i < 12; i += 1) {
    const a = new Api(ctx.origin);
    const r = await a.request('POST', '/api/auth/login', {
      email: ctx.state.adminEmail,
      password: adminPassword(),
    });
    logins.push({ status: r.status, ms: r.ms });
  }
  out.login = {
    attempts: logins.length,
    statuses: logins.reduce<Record<string, number>>((a, l) => {
      a[l.status] = (a[l.status] ?? 0) + 1;
      return a;
    }, {}),
    latencyOfSuccessfulMs: stats(logins.filter((l) => l.status === 200).map((l) => l.ms)),
    note: 'sequential; correct password; the per-account limit of the stack was left at its default',
  };
  out.session = await closedLoop(conc, seconds, () => admin.request('GET', '/api/auth/session'));
  const ids: string[] = [];
  out.documentCreate = await closedLoop(conc, seconds, async (i) => {
    const r = await admin.request<any>('POST', '/api/documents', { title: `api bench ${i}` });
    if (r.status < 300) ids.push(r.body.document.id);
    return r;
  });
  const pick = (i: number) => ids[i % ids.length]!;
  out.documentList = await closedLoop(conc, seconds, () => admin.request('GET', '/api/documents'));
  (out.documentList as any).documentsInWorkspace = ids.length;
  out.documentSearch = await closedLoop(conc, seconds, (i) =>
    admin.request('GET', `/api/documents?q=${encodeURIComponent(`bench ${i % 500}`)}`),
  );
  out.documentOpen = await closedLoop(conc, seconds, (i) =>
    admin.request('GET', `/api/documents/${pick(i)}`),
  );
  out.shareCreate = await closedLoop(conc, seconds, (i) =>
    admin.request('POST', `/api/documents/${pick(i)}/shares`, { role: 'editor', label: 'bench' }),
  );
  out.members = await closedLoop(conc, seconds, (i) =>
    admin.request('GET', `/api/documents/${pick(i)}/members`),
  );
  out.collabTicket = await closedLoop(conc, seconds, (i) =>
    admin.request('POST', `/api/documents/${pick(i)}/collab-ticket`, {
      clientId: 1000 + i,
      schemaVersion: 3,
      protocolVersion: 1,
    }),
  );
  // History and export need content: use the busiest document of an earlier scenario, or seed one.
  let busy = ctx.knownDocs[0]?.id;
  if (!busy) {
    const [doc] = await ctx.provision(1, 'api-history');
    const spec = ctx.specs([doc!], 1, 'seed')[0]![0]!;
    await ctx.call(0, 'seed', { spec, targetBytes: 200_000, batch: 20, chars: 500 });
    busy = doc!.id;
  }
  out.history = await closedLoop(conc, seconds, () =>
    admin.request('GET', `/api/documents/${busy}/history`),
  );
  out.exportJson = await closedLoop(conc, seconds, () =>
    admin.request('GET', `/api/documents/${busy}/export?format=json`),
  );
  out.snapshotList = await closedLoop(conc, seconds, () =>
    admin.request('GET', `/api/documents/${busy}/snapshots`),
  );
  out.snapshotCreate = await closedLoop(4, Math.min(seconds, 10), (i) =>
    admin.request('POST', `/api/documents/${busy}/snapshots`, { name: `bench ${i}` }),
  );
  const png = noisePng(100 * 1024).bytes;
  const assets: string[] = [];
  out.upload100kB = await closedLoop(4, Math.min(seconds, 15), async (i) => {
    const r = await admin.upload(pick(i), png, 'bench.png', 'image/png');
    const id = (r.body as any)?.asset?.id;
    if (r.status < 300 && id) assets.push(`${pick(i)}/assets/${id}`);
    return r;
  });
  if (assets.length > 0) {
    out.download100kB = await closedLoop(conc, Math.min(seconds, 15), (i) =>
      admin.request('GET', `/api/documents/${assets[i % assets.length]}`),
    );
  }
  const tEnd = Date.now();
  res.phases.push(
    await ctx.phase('api', tStart, tEnd, await ctx.collect(true), {
      system: ctx.monitor.summary(tStart, tEnd),
    }),
  );
  res.results = { endpoints: out, topStatements: await topStatements(15) };
};

// Large documents ───────────────────────────────────────────────────────────────
const large: Scenario = async (ctx, res) => {
  const targets = String(ctx.opts.sizes ?? '5,100,1024,5120')
    .split(',')
    .map(Number);
  res.config = {
    targetsKiB: targets,
    measure: 'Yjs state size (encodeStateAsUpdate), not attached files',
    productLimitBytes: 8 * 1024 * 1024,
  };
  const rows: unknown[] = [];
  for (const kib of targets) {
    if (ctx.monitor.tripped) break;
    const [doc] = await ctx.provision(1, `large-${kib}KiB`);
    ctx.knownDocs.push(doc!);
    const spec = ctx.specs([doc!], 1, 'seed')[0]![0]!;
    const before = ctx.monitor.samples.at(-1)?.server;
    const small = kib <= 200;
    const tSeed = Date.now();
    const seed = await ctx.call(0, 'seed', {
      spec,
      targetBytes: kib * 1024,
      batch: small ? Math.max(1, Math.round(kib / 4)) : 100,
      chars: small ? 200 : 1000,
    });
    log(`seed ${kib} KiB: ${JSON.stringify(seed)}`);
    let probe: unknown = null;
    let exportMs: number | null = null;
    if (seed.ok) {
      probe = await ctx.call(0, 'probe', { spec: { ...spec, key: `probe${kib}` }, count: 5 });
      const r = await ctx.admin.request('GET', `/api/documents/${doc!.id}/export?format=json`);
      exportMs = r.status === 200 ? round(r.ms, 1) : null;
    }
    await sleep(6000);
    rows.push({
      targetKiB: kib,
      seed,
      seedSeconds: round((Date.now() - tSeed) / 1000, 1),
      freshClientOpen: probe,
      exportJsonMs: exportMs,
      serverRssMbBefore: before,
      serverRssMbAfter: ctx.monitor.samples.at(-1)?.server,
    });
    await ctx.collect(true);
  }
  res.results.documents = rows;
};

// Stress, soak, reliability: scenarios of the load harness, run inside this framework ──────
const reuse =
  (name: string, defaults: Record<string, unknown>): Scenario =>
  async (ctx, res) => {
    for (const [k, v] of Object.entries(defaults))
      if (ctx.opts[k] === undefined) ctx.opts[k] = v as never;
    const t0 = Date.now();
    await LOAD[name]!.run(ctx, res);
    res.results.system = ctx.monitor.summary(t0, Date.now());
    res.notes.push(
      `Scenario ${name} of tests/load/src/scenarios.ts, run by the performance framework.`,
    );
  };

/** Soak: the 1,000-editor workload for a stated time, with trend lines. */
const soak: Scenario = async (ctx, res) => {
  const minutes = ctx.num('minutes', 30);
  const p: EditRun = {
    docs: ctx.num('docs', 500),
    perDoc: 2,
    assign: ['normal', 'active', 'heavy', 'active', 'normal'],
    rampS: 60,
    warmupS: 20,
    durationS: minutes * 60,
    name: `soak ${minutes} min, 1,000 editors`,
  };
  res.config = { ...p, minutes, seed: ctx.seed };
  const docs = await ctx.provision(p.docs, 'soak');
  ctx.knownDocs.push(...docs);
  const first = await ctx.addClients(ctx.specs(docs, 2, 'u', true), sec(p.rampS), true);
  await ctx.all('behave', { seed: ctx.seed, profiles: PROFILES, assign: p.assign });
  await ctx.hold(sec(p.warmupS), 'warm-up');
  await ctx.collect(true);
  const windows: any[] = [];
  const tStart = Date.now();
  const slice = 5 * 60;
  for (let done = 0; done < p.durationS; done += slice) {
    const t0 = Date.now();
    const full = await ctx.hold(sec(Math.min(slice, p.durationS - done)), `soak ${done / 60} min`);
    const t1 = Date.now();
    const ph = await ctx.phase(
      `minutes ${done / 60}-${(done + slice) / 60}`,
      t0,
      t1,
      await ctx.collect(true),
      {
        system: ctx.monitor.summary(t0, t1),
      },
    );
    res.phases.push(ph);
    const s = ph.server[0];
    windows.push({
      fromMinute: done / 60,
      remote: ph.latency.ALL?.remote,
      ack: ph.latency.ALL?.ack,
      serverRssMbEnd: s?.rssMbEnd,
      serverHeapMbMax: s?.heapMbMax,
      eventLoopP99MaxMs: s?.lagP99MaxMs,
      poolWaitingMax: s?.poolWaitingMax,
      connected: (await ctx.status()).ready,
    });
    if (!full) break;
  }
  await ctx.all('stopBehave');
  const quiet = await ctx.waitQuiet(120_000);
  res.results = {
    firstAttempt: first,
    windows,
    wholeRun: ctx.monitor.summary(tStart, Date.now()),
    quiesce: quiet,
    verification: await ctx.verifyAcked(),
    convergence: await converge(ctx),
    abortedBy: ctx.monitor.tripped,
  };
};

// Generator on another machine ──────────────────────────────────────────────────
/**
 * The same typing workload driven by the stand-alone generator (remote-gen.ts), either on this
 * machine (`--gen-host local`, over loopback) or on another one reached with ssh
 * (`--gen-host 10.100.184.2 --link 10.100.184.1`), where `link` is this machine's address on the
 * direct connection. The backend stays on loopback; a forwarder bound to the link address only
 * carries the traffic. Needs `--env ALLOWED_ORIGINS=...` to include `http://<link>:4460`.
 */
const remote: Scenario = async (ctx, res) => {
  const genHost = String(ctx.opts.genHost ?? 'local');
  const link = String(ctx.opts.link ?? '127.0.0.1');
  const docsN = ctx.num('docs', 500);
  const procs = ctx.num('procs', 6);
  const rate = ctx.num('rate', 1);
  const durationS = ctx.num('duration', 120);
  const local = genHost === 'local';
  const origin = local ? ctx.origin : `http://${link}:4460`;
  res.config = {
    generator: genHost,
    origin,
    documents: docsN,
    users: docsN * 2,
    processes: procs,
    rate,
    durationS,
  };
  const docs = await ctx.provision(docsN, 'remote');
  ctx.knownDocs.push(...docs);
  const work = mkdtempSync(path.join(tmpdir(), 'rd-perf-remote-'));
  const bundle = path.join(work, 'remote-gen.mjs');
  const docsFile = path.join(work, 'docs.json');
  writeFileSync(docsFile, JSON.stringify(docs));
  execFileSync(process.execPath, [path.join(here, 'bundle-remote.mjs'), bundle], {
    stdio: 'ignore',
  });
  const sh = (cmd: string, args: string[], timeoutMs = 60_000) =>
    new Promise<string>((resolve, reject) =>
      execFile(
        cmd,
        args,
        { timeout: timeoutMs, maxBuffer: 256 * 1048576 },
        (err, stdout, stderr) =>
          err
            ? reject(new Error(`${cmd} ${args[0]}: ${String(stderr).slice(0, 400)}`))
            : resolve(String(stdout)),
      ),
    );
  const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', genHost];
  const remoteDir = `/tmp/rd-perf-gen-${process.pid}`;
  let forwarder: ChildProcess | null = null;
  let ping = 'loopback';
  try {
    if (!local) {
      forwarder = spawn(process.execPath, [path.join(here, 'forward.mjs'), link, '4460', '4459'], {
        stdio: 'ignore',
      });
      await sleep(500);
      ping = (await sh('ping', ['-c', '5', '-q', genHost])).split('\n').slice(-2).join(' ').trim();
      await sh('ssh', [...ssh, `mkdir -m 700 ${remoteDir}`]);
      await sh('scp', ['-o', 'BatchMode=yes', bundle, docsFile, `${genHost}:${remoteDir}/`]);
    }
    const per = Math.ceil(docsN / procs);
    const tStart = Date.now();
    const outs = await Promise.all(
      Array.from({ length: procs }, (_, i) => {
        const args = [
          '--origin',
          origin,
          '--from',
          String(i * per),
          '--count',
          String(per),
          '--rate',
          String(rate),
          '--ramp',
          '30',
          '--warmup',
          '15',
          '--duration',
          String(durationS),
        ];
        const limit = (durationS + 120) * 1000;
        return local
          ? sh(process.execPath, [bundle, '--docs', docsFile, ...args], limit)
          : sh(
              'ssh',
              [
                ...ssh,
                `cd ${remoteDir} && ulimit -n 65536 && nice -n 5 node --max-old-space-size=1024 remote-gen.mjs --docs docs.json ${args.join(' ')}`,
              ],
              limit,
            );
      }),
    );
    const tEnd = Date.now();
    const parts = outs.map((o) => JSON.parse(o.trim().split('\n').pop()!));
    const merge = (k: 'remote' | 'ack' | 'connect') => ({
      n: parts.reduce((a, p) => a + p[k].n, 0),
      p50Max: Math.max(...parts.map((p) => p[k].p50 ?? 0)),
      p95Max: Math.max(...parts.map((p) => p[k].p95 ?? 0)),
      p99Max: Math.max(...parts.map((p) => p[k].p99 ?? 0)),
      max: Math.max(...parts.map((p) => p[k].max ?? 0)),
      perProcess: parts.map((p) => ({
        p50: round(p[k].p50, 2),
        p95: round(p[k].p95, 2),
        p99: round(p[k].p99, 2),
      })),
    });
    // Durability: every acknowledged marker must be in the server's export.
    let checked = 0;
    let missing = 0;
    const idByKey = new Map(docs.map((d) => [d.key, d.id]));
    const acked = parts.flatMap((p) => Object.entries(p.acked as Record<string, string[]>));
    let next = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        for (;;) {
          const item = acked[next++];
          if (!item) return;
          const r = await ctx.admin.request<any>(
            'GET',
            `/api/documents/${idByKey.get(item[0])}/export?format=json`,
          );
          const text = JSON.stringify(r.body);
          for (const m of item[1]) {
            checked += 1;
            if (!text.includes(m)) missing += 1;
          }
        }
      }),
    );
    res.phases.push(
      await ctx.phase('remote generator', tStart, tEnd, await ctx.collect(true), {
        system: ctx.monitor.summary(tStart, tEnd),
      }),
    );
    res.results = {
      link: ping,
      clients: parts.reduce((a, p) => a + p.clients, 0),
      firstAttempt: parts.reduce<Record<string, number>>((a, p) => {
        for (const [k, v] of Object.entries(p.firstAttempt as Record<string, number>))
          a[k] = (a[k] ?? 0) + v;
        return a;
      }, {}),
      readyAtEnd: parts.reduce((a, p) => a + p.readyAtEnd, 0),
      editsPerSecond: round(
        parts.reduce((a, p) => a + p.editsPerSecond, 0),
        1,
      ),
      editToRemoteVisibleMs: merge('remote'),
      editToSavedMs: merge('ack'),
      connectMs: merge('connect'),
      generatorProcesses: parts.map((p) => ({
        cpuPct: round(p.generator.cpuPct, 1),
        rssMb: round(p.generator.rssMb, 0),
        eventLoopP99Ms: round(p.generator.eventLoopP99Ms, 1),
      })),
      errors: parts.map((p) => p.errors),
      verification: { checked, missing },
      note: 'Percentiles are per generator process; the table gives the worst process (p50Max, p95Max, p99Max), not a merged distribution.',
    };
  } finally {
    forwarder?.kill();
    if (!local) await sh('ssh', [...ssh, `rm -rf ${remoteDir}`]).catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  }
};

export const SCENARIOS: Record<string, { title: string; run: Scenario }> = {
  A: { title: 'A. Two people editing one document', run: A },
  B: { title: 'B. 100 documents, 2 active editors each (200 users)', run: B },
  C: { title: 'C. 500 documents, 2 active editors each (1,000 users)', run: C },
  D: { title: 'D. Up to 100 people editing one document', run: D },
  E: { title: 'E. Escalation of concurrent users', run: E },
  api: { title: 'API endpoints (closed loop)', run: api },
  large: { title: 'Large documents', run: large },
  storm: {
    title: 'Stress: reconnect storm',
    run: reuse('s13', { docs: 250, perDoc: 4, ramp: 60 }),
  },
  rates: { title: 'Stress: typing rate steps', run: reuse('s2b', {}) },
  restart: { title: 'Reliability: backend restart while typing', run: reuse('s10', {}) },
  dbpause: { title: 'Reliability: database unavailable for a while', run: reuse('s12', {}) },
  access: { title: 'Reliability: revoked and expired links', run: reuse('s14', {}) },
  soak: { title: 'Soak', run: soak },
  remote: { title: 'Stand-alone generator (this machine or another one)', run: remote },
};
