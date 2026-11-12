/** The 16 scenarios. Each one fills `res` (phases, results, notes); run.ts saves and renders it. */
import { execFileSync } from 'node:child_process';
import { Api } from './api';
import {
  readState,
  round,
  sleep,
  slope,
  stats,
  wallNow,
  REDIS_CONTAINER,
  PG_CONTAINER,
  adminPassword,
} from './common';
import { type Ctx, type DocRef, type ScenarioResult, log } from './ctx';
import { startInstance, stopInstance } from './stack';

type Scenario = (ctx: Ctx, res: ScenarioResult) => Promise<void>;

const sec = (ms: number) => ms * 1000;

async function typingRun(
  ctx: Ctx,
  res: ScenarioResult,
  p: {
    docs: number;
    perDoc: number;
    rate: number;
    rampS: number;
    warmupS: number;
    durationS: number;
    verify?: boolean;
    name?: string;
  },
): Promise<DocRef[]> {
  const docs = await ctx.provision(p.docs, res.scenario);
  ctx.knownDocs.push(...docs);
  const specs = ctx.specs(docs, p.perDoc, 'u');
  log(`connecting ${p.docs * p.perDoc} clients over ${p.rampS}s`);
  const t0 = Date.now();
  const first = await ctx.addClients(specs, sec(p.rampS), true);
  const connectC = await ctx.collect(true);
  res.phases.push(await ctx.phase('connect', t0, Date.now(), connectC, { firstAttempt: first }));
  await sleep(5000);
  log(
    `typing at ${p.rate} edits/s per client (${(p.rate * p.docs * p.perDoc).toFixed(0)} edits/s total)`,
  );
  await ctx.all('typing', { on: true, rate: p.rate });
  await ctx.hold(sec(p.warmupS), 'warm-up');
  await ctx.collect(true);
  const tStart = Date.now();
  await ctx.sampler.sampleNow();
  const full = await ctx.hold(sec(p.durationS), p.name ?? 'typing');
  const tEnd = Date.now();
  const c = await ctx.collect(true);
  const edits = Object.values(c.counts).reduce((a, g) => a + (g.edits ?? 0), 0);
  res.phases.push(
    await ctx.phase(p.name ?? 'typing', tStart, tEnd, c, {
      editsPerSecondAchieved: round(edits / ((tEnd - tStart) / 1000), 1),
      targetEditsPerSecond: p.rate * p.docs * p.perDoc,
      completedFullDuration: full,
    }),
  );
  await ctx.all('typing', { on: false });
  const quiet = await ctx.waitQuiet(60_000);
  res.results.quiesce = quiet;
  if (p.verify !== false) res.results.verification = await ctx.verifyAcked();
  return docs;
}

// 1 ────────────────────────────────────────────────────────────────────────────
const s1: Scenario = async (ctx, res) => {
  const docsN = ctx.num('docs', 250);
  const perDoc = ctx.num('perDoc', 4);
  const ramp = ctx.num('ramp', 60);
  const hold = ctx.num('hold', 120);
  res.config = {
    docs: docsN,
    perDoc,
    users: docsN * perDoc,
    rampS: ramp,
    holdS: hold,
    awareness: true,
    autoReconnectDuringTest: false,
  };
  const docs = await ctx.provision(docsN, 'connect-1000');
  ctx.knownDocs.push(...docs);
  const specs = ctx.specs(docs, perDoc, 'u', true);
  const t0 = Date.now();
  const first = await ctx.addClients(specs, sec(ramp), false);
  const tConnected = Date.now();
  const st = await ctx.status();
  const c1 = await ctx.collect(true);
  res.phases.push(
    await ctx.phase('ramp', t0, tConnected, c1, {
      firstAttempt: first,
      readyAtEndOfRamp: st.ready,
    }),
  );
  // presence: every client updates its awareness once, then idle
  await ctx.all('presence', { on: true, rate: 0.2 });
  await ctx.hold(sec(hold), 'hold');
  const st2 = await ctx.status();
  const tEnd = Date.now();
  const c2 = await ctx.collect(true);
  res.phases.push(
    await ctx.phase('hold', tConnected, tEnd, c2, {
      readyAtEndOfHold: st2.ready,
      total: st2.total,
    }),
  );
  const ok = first.ok ?? 0;
  res.results.connectionEstablishment = {
    attempted: docsN * perDoc,
    succeededFirstAttempt: ok,
    successRatePct: round((ok / (docsN * perDoc)) * 100, 3),
    failuresByCause: Object.fromEntries(Object.entries(first).filter(([k]) => k !== 'ok')),
    connectedAtEndOfHold: st2.ready,
    lostDuringHold: st.ready - st2.ready,
  };
  res.notes.push(
    'Presence: every client set an awareness state at connect and updated its cursor every 5 s (0.2/s) during the hold.',
  );
};

// 2 / 3 ────────────────────────────────────────────────────────────────────────
const s2: Scenario = async (ctx, res) => {
  const p = {
    docs: ctx.num('docs', 250),
    perDoc: ctx.num('perDoc', 4),
    rate: ctx.num('rate', 1),
    rampS: ctx.num('ramp', 40),
    warmupS: 15,
    durationS: ctx.num('duration', 180),
  };
  res.config = p;
  await typingRun(ctx, res, p);
};
const s3: Scenario = async (ctx, res) => {
  const p = {
    docs: ctx.num('docs', 100),
    perDoc: ctx.num('perDoc', 10),
    rate: ctx.num('rate', 1),
    rampS: ctx.num('ramp', 40),
    warmupS: 15,
    durationS: ctx.num('duration', 180),
  };
  res.config = p;
  await typingRun(ctx, res, p);
};

// 2b: rate steps to find the sustainable rate
const s2b: Scenario = async (ctx, res) => {
  const docsN = ctx.num('docs', 250);
  const perDoc = ctx.num('perDoc', 4);
  const rates = String(ctx.opts.rates ?? '1,2,3,4,6')
    .split(',')
    .map(Number);
  const stepS = ctx.num('step', 45);
  res.config = { docs: docsN, perDoc, rates, stepS };
  const docs = await ctx.provision(docsN, 'knee');
  ctx.knownDocs.push(...docs);
  await ctx.addClients(ctx.specs(docs, perDoc, 'u'), sec(40), true);
  await ctx.collect(true);
  const rows: unknown[] = [];
  for (const rate of rates) {
    await ctx.all('typing', { on: true, rate });
    await ctx.hold(sec(10), `rate ${rate} warm-up`);
    await ctx.collect(true);
    const t0 = Date.now();
    await ctx.sampler.sampleNow();
    await ctx.hold(sec(stepS), `rate ${rate}`);
    const t1 = Date.now();
    const c = await ctx.collect(true);
    const ph = await ctx.phase(
      `rate ${rate}/s per client (${rate * docsN * perDoc} edits/s target)`,
      t0,
      t1,
      c,
    );
    const edits = Object.values(c.counts).reduce((a, g) => a + (g.edits ?? 0), 0);
    ph.extra = {
      targetEditsPerSecond: rate * docsN * perDoc,
      editsPerSecondAchieved: round(edits / ((t1 - t0) / 1000), 1),
    };
    res.phases.push(ph);
    rows.push({
      rate,
      achieved: ph.extra.editsPerSecondAchieved,
      ackP95: ph.latency.ALL?.ack?.p95,
      remoteP95: ph.latency.ALL?.remote?.p95,
    });
    const ackP95 = ph.latency.ALL?.ack?.p95 ?? 0;
    if (ackP95 > 3000 || (ph.latency.ALL?.remote?.p95 ?? 0) > 3000) {
      res.notes.push(`stopped stepping at ${rate}/s: p95 above 3 s`);
      break;
    }
  }
  await ctx.all('typing', { on: false });
  res.results.steps = rows;
  res.results.quiesce = await ctx.waitQuiet(90_000);
  res.results.verification = await ctx.verifyAcked();
};

// 4 hot document ───────────────────────────────────────────────────────────────
const s4: Scenario = async (ctx, res) => {
  const counts = String(ctx.opts.editors ?? '10,25,50')
    .split(',')
    .map(Number);
  const rate = ctx.num('rate', 2);
  const dur = ctx.num('duration', 60);
  res.config = { editors: counts, ratePerEditor: rate, durationS: dur };
  for (const n of counts) {
    await ctx.all('stopAll');
    const [doc] = await ctx.provision(1, `hot-${n}`);
    ctx.knownDocs.push(doc!);
    // one document -> one worker, so the sender and the receivers share a clock
    const specs = ctx.specs([doc!], n, 'u', false, 'all');
    await ctx.addClients(specs, 5000, true);
    await ctx.collect(true);
    await ctx.all('typing', { on: true, rate });
    await ctx.hold(sec(8), 'warm-up');
    await ctx.collect(true);
    const t0 = Date.now();
    await ctx.sampler.sampleNow();
    await ctx.hold(sec(dur), `hot doc ${n} editors`);
    const t1 = Date.now();
    const c = await ctx.collect(true);
    const ph = await ctx.phase(`${n} editors in one document (${n * rate} edits/s)`, t0, t1, c, {
      editors: n,
      editsPerSecondTarget: n * rate,
    });
    res.phases.push(ph);
    await ctx.all('typing', { on: false });
    await ctx.waitQuiet(30_000);
  }
  res.results.verification = await ctx.verifyAcked();
};

// 5 paste ──────────────────────────────────────────────────────────────────────
const s5: Scenario = async (ctx, res) => {
  const base = ctx.num('baseline', 45);
  const burst = ctx.num('burst', 60);
  const after = ctx.num('recovery', 30);
  const everyMs = ctx.num('everyMs', 4000);
  res.config = {
    bystanderTypists: 180,
    neighbourTypists: 20,
    pasters: 20,
    baselineS: base,
    burstS: burst,
    recoveryS: after,
    pasteEveryMs: everyMs,
    kinds: ['20 KB text', '200 KB text', '50x20 table (nested XmlElements)'],
    typingRate: 1,
  };
  const by = await ctx.provision(45, 'paste-bystander');
  const nb = await ctx.provision(10, 'paste-neighbour');
  ctx.knownDocs.push(...by, ...nb);
  const specsBy = ctx.specs(by, 4, 'bystander');
  const specsNb = ctx.specs(nb, 4, (idx) => (idx < 2 ? 'neighbour' : 'paster'));
  await ctx.addClients(
    specsBy.map((s, i) => [...s, ...(specsNb[i] ?? [])]),
    sec(30),
    true,
  );
  await ctx.collect(true);
  await ctx.all('typing', { on: true, rate: 1, groups: ['bystander', 'neighbour'] });
  await ctx.hold(sec(10), 'warm-up');
  await ctx.collect(true);
  const mark = async (name: string, secs: number, extra?: Record<string, unknown>) => {
    const t0 = Date.now();
    await ctx.sampler.sampleNow();
    await ctx.hold(sec(secs), name);
    const t1 = Date.now();
    const c = await ctx.collect(true);
    res.phases.push(await ctx.phase(name, t0, t1, c, extra));
  };
  await mark('baseline (typing only)', base);
  await ctx.all('paste', {
    kind: [
      { kind: 'text', size: 20_000 },
      { kind: 'text', size: 200_000 },
      { kind: 'table', size: 50, cols: 20 },
    ],
    groups: ['paster'],
    everyMs,
    durationMs: sec(burst),
  });
  await mark('burst (pastes + typing)', burst);
  await mark('recovery (typing only)', after);
  await ctx.all('typing', { on: false });
  res.results.quiesce = await ctx.waitQuiet(60_000);
  res.results.verification = await ctx.verifyAcked();
};

// 6 presence ───────────────────────────────────────────────────────────────────
const s6: Scenario = async (ctx, res) => {
  const docsN = ctx.num('docs', 100);
  const perDoc = ctx.num('perDoc', 4);
  const rate = ctx.num('rate', 5);
  const dur = ctx.num('duration', 90);
  res.config = {
    docs: docsN,
    perDoc,
    clients: docsN * perDoc,
    awarenessUpdatesPerSecondPerClient: rate,
    durationS: dur,
  };
  const docs = await ctx.provision(docsN, 'presence');
  ctx.knownDocs.push(...docs);
  await ctx.addClients(ctx.specs(docs, perDoc, 'u', true), sec(20), true);
  await ctx.collect(true);
  await ctx.all('presence', { on: true, rate });
  await ctx.hold(sec(10), 'warm-up');
  await ctx.collect(true);
  const t0 = Date.now();
  await ctx.sampler.sampleNow();
  await ctx.hold(sec(dur), 'presence');
  const t1 = Date.now();
  const c = await ctx.collect(true);
  res.phases.push(
    await ctx.phase('presence updates', t0, t1, c, {
      targetUpdatesPerSecond: docsN * perDoc * rate,
    }),
  );
  await ctx.all('presence', { on: false });
  res.notes.push(
    'Presence latency is awareness-update send time (timestamp inside the awareness state) to apply time at the sampled receiver in the same worker process. The server throttles/coalesces presence frames (collab/presence.ts), so latency includes that trailing throttle.',
  );
};

// 7 uploads ────────────────────────────────────────────────────────────────────
const s7: Scenario = async (ctx, res) => {
  const bytes = ctx.num('bytes', 200_000);
  const dur = ctx.num('duration', 60);
  const delay = ctx.num('delayMs', 500);
  res.config = {
    uploaders: 50,
    uploadBytes: bytes,
    durationS: dur,
    delayBetweenUploadsMs: delay,
    backgroundTypists: 200,
  };
  const bg = await ctx.provision(50, 'upload-bg');
  const up = await ctx.provision(10, 'upload-target');
  ctx.knownDocs.push(...bg, ...up);
  const specsBg = ctx.specs(bg, 4, 'bg');
  const specsUp = ctx.specs(up, 5, 'uploader');
  await ctx.addClients(
    specsBg.map((s, i) => [...s, ...(specsUp[i] ?? [])]),
    sec(25),
    true,
  );
  await ctx.collect(true);
  await ctx.all('typing', { on: true, rate: 1, groups: ['bg'] });
  await ctx.hold(sec(10), 'warm-up');
  await ctx.collect(true);
  let t0 = Date.now();
  await ctx.sampler.sampleNow();
  await ctx.hold(sec(30), 'baseline');
  let t1 = Date.now();
  res.phases.push(await ctx.phase('baseline (typing only)', t0, t1, await ctx.collect(true)));
  t0 = Date.now();
  await ctx.sampler.sampleNow();
  const uploadRun = ctx.all('upload', {
    bytes,
    groups: ['uploader'],
    durationMs: sec(dur),
    delayMs: delay,
  });
  await ctx.hold(sec(dur), 'uploads');
  await uploadRun;
  t1 = Date.now();
  const c = await ctx.collect(true);
  const ph = await ctx.phase('50 concurrent uploaders + typing', t0, t1, c);
  const codes: Record<string, number> = {};
  for (const g of Object.values(c.uploadCounts))
    for (const [k, v] of Object.entries(g)) codes[k] = (codes[k] ?? 0) + v;
  const okMs = Object.entries(c.uploadSamples)
    .filter(([k]) => k.endsWith(':201') || k.endsWith(':200'))
    .flatMap(([, v]) => v);
  ph.extra = {
    uploadStatusCounts: codes,
    uploadLatencyMsOk: stats(okMs),
    uploadsPerSecond: round(
      Object.values(codes).reduce((a, b) => a + b, 0) / ((t1 - t0) / 1000),
      1,
    ),
  };
  res.phases.push(ph);
  // Part B: default RATE_UPLOAD_PER_MINUTE (240 per session), one session per worker hammering uploads
  await ctx.all('typing', { on: false });
  await ctx.collect(true);
  const tb0 = Date.now();
  await ctx.all('upload', { bytes: 20_000, groups: ['uploader'], burst: 300, limit: 1 });
  const cb = await ctx.collect(true);
  const codesB: Record<string, number> = {};
  for (const g of Object.values(cb.uploadCounts))
    for (const [k, v] of Object.entries(g)) codesB[k] = (codesB[k] ?? 0) + v;
  res.phases.push(
    await ctx.phase(
      'burst of 300 uploads per session at default RATE_UPLOAD_PER_MINUTE',
      tb0,
      Date.now(),
      cb,
      { statusCounts: codesB },
    ),
  );
  res.notes.push(
    'RATE_UPLOAD_PER_MINUTE is a PER-SESSION limit (default 240/min) and was left at its default for the whole scenario; the 50 uploaders each stay below it. In the burst phase every uploader client sent 300 requests back to back, so the 429 share shows the default behaviour.',
  );
};

// 8 session API ────────────────────────────────────────────────────────────────
const s8: Scenario = async (ctx, res) => {
  const rate = ctx.num('rate', 20);
  const dur = ctx.num('duration', 60);
  const keysN = ctx.num('keys', 1);
  const replayShare = 0.3;
  res.config = {
    requestsPerSecond: rate,
    durationS: dur,
    apiKeys: keysN,
    replayShare,
    serverEnvOverrides: ctx.state.extraEnv,
    note: 'RATE_API_KEY_PER_MINUTE is per API key (default 600/min)',
  };
  const spec = await fetch(`${ctx.origin}/api/openapi.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!spec) {
    res.status = 'aborted';
    res.notes.push('NOT RUN: GET /api/openapi.json did not answer at test time.');
    return;
  }
  const secrets: string[] = [];
  for (let i = 0; i < keysN; i += 1) {
    const key = await ctx.admin.request<any>('POST', '/api/admin/api-keys', {
      name: `load-${i}`,
      scopes: ['sessions:create', 'sessions:read'],
    });
    if (key.status >= 300) {
      res.status = 'aborted';
      res.notes.push(
        `NOT RUN: could not create an API key (${key.status} ${key.text.slice(0, 200)}).`,
      );
      return;
    }
    secrets.push(key.body.secret);
  }
  const body = (n: number) => ({
    candidate: { name: `Candidate ${n}`, email: `candidate${n}@example.test` },
    interviewers: [{ name: 'Interviewer', email: `interviewer${n}@example.test` }],
    companyName: 'Load Test Co',
    round: { number: 1 },
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    timezone: 'Asia/Kolkata',
    expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  });
  const created: { key: string; body: any; secret: string }[] = [];
  const lat: Record<string, number[]> = { create: [], replay: [] };
  const codes: Record<string, number> = {};
  let sent = 0;
  let replayedHeader = 0;
  let retryAfter429 = 0;
  const inflight = new Set<Promise<void>>();
  const t0 = Date.now();
  await ctx.sampler.sampleNow();
  const total = rate * dur;
  const fire = async (i: number) => {
    const replay = created.length > 5 && Math.random() < replayShare;
    let item: { key: string; body: any; secret: string };
    if (replay) item = created[Math.floor(Math.random() * created.length)]!;
    else
      item = {
        key: `load-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        body: body(i),
        secret: secrets[i % secrets.length]!,
      };
    const t = performance.now();
    try {
      const r = await fetch(`${ctx.origin}/api/v1/interview-sessions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${item.secret}`,
          'content-type': 'application/json',
          'idempotency-key': item.key,
        },
        body: JSON.stringify(item.body),
      });
      await r.text();
      const ms = performance.now() - t;
      const kind = replay ? 'replay' : 'create';
      codes[`${kind}_${r.status}`] = (codes[`${kind}_${r.status}`] ?? 0) + 1;
      if (r.status === 201 || r.status === 200) lat[kind]!.push(ms);
      if (replay && r.headers.get('idempotency-replayed') === 'true') replayedHeader += 1;
      if (r.status === 429 && r.headers.get('retry-after')) retryAfter429 += 1;
      if (!replay && r.status === 201) created.push(item);
    } catch (e) {
      const k = `net_${(e as any)?.cause?.code ?? (e as Error).name}`;
      codes[k] = (codes[k] ?? 0) + 1;
    }
  };
  for (let i = 0; i < total; i += 1) {
    const due = t0 + (i * 1000) / rate;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
    const p = fire(i).finally(() => inflight.delete(p));
    inflight.add(p);
    sent += 1;
  }
  await Promise.all(inflight);
  const t1 = Date.now();
  res.phases.push(
    await ctx.phase(`${rate} req/s for ${dur} s`, t0, t1, await ctx.collect(true), {
      sent,
      achievedRequestsPerSecond: round(sent / ((t1 - t0) / 1000), 2),
      statusCounts: codes,
      createLatencyMs: stats(lat.create!),
      replayLatencyMs: stats(lat.replay!),
      replayResponsesWithReplayedHeader: replayedHeader,
      rateLimited429WithRetryAfter: retryAfter429,
    }),
  );
  res.results.openApiPaths = Object.keys(spec.paths ?? {});
};

// 9 history reads ───────────────────────────────────────────────────────────────
const s9: Scenario = async (ctx, res) => {
  const readers = ctx.num('readers', 50);
  const dur = ctx.num('duration', 45);
  res.config = { backgroundTypists: 200, readers, readDurationS: dur };
  const docs = await ctx.provision(50, 'history');
  ctx.knownDocs.push(...docs);
  await ctx.addClients(ctx.specs(docs, 4, 'u'), sec(20), true);
  await ctx.all('typing', { on: true, rate: 2 });
  await ctx.hold(sec(ctx.num('prime', 120)), 'building history');
  await ctx.collect(true);
  const busiest = docs[0]!;
  const lat: Record<string, number[]> = { list: [], revision: [] };
  const codes: Record<string, number> = {};
  const end = Date.now() + sec(dur);
  const t0 = Date.now();
  await ctx.sampler.sampleNow();
  const reader = async () => {
    const api = new Api(ctx.origin);
    await api.login(ctx.state.adminEmail, adminPassword());
    while (Date.now() < end) {
      let before: number | null = null;
      type Page = { status: number; ms: number; body: any };
      const entries: number[] = [];
      for (let page = 0; page < 3; page += 1) {
        const q: string = `limit=50${before ? `&before=${before}` : ''}`;
        const r: Page = await api.request<any>('GET', `/api/documents/${busiest.id}/history?${q}`);
        codes[`list_${r.status}`] = (codes[`list_${r.status}`] ?? 0) + 1;
        if (r.status === 200) lat.list!.push(r.ms);
        if (r.status !== 200) break;
        for (const e of r.body.entries ?? []) entries.push(e.revision);
        before = r.body.nextBefore;
        if (!before) break;
      }
      for (let k = 0; k < 2 && entries.length; k += 1) {
        const rev = entries[Math.floor(Math.random() * entries.length)];
        const r: Page = await api.request<any>(
          'GET',
          `/api/documents/${busiest.id}/history/${rev}`,
        );
        codes[`revision_${r.status}`] = (codes[`revision_${r.status}`] ?? 0) + 1;
        if (r.status === 200) lat.revision!.push(r.ms);
      }
    }
  };
  await Promise.all(Array.from({ length: readers }, reader));
  const t1 = Date.now();
  const c = await ctx.collect(true);
  const ph = await ctx.phase(
    `${readers} concurrent history readers on the busiest document (typing continues elsewhere)`,
    t0,
    t1,
    c,
    {
      listLatencyMs: stats(lat.list!),
      revisionLatencyMs: stats(lat.revision!),
      statusCounts: codes,
    },
  );
  res.phases.push(ph);
  await ctx.all('typing', { on: false });
  const hist = await ctx.admin.request<any>('GET', `/api/documents/${busiest.id}/history?limit=1`);
  res.results.busiestDocumentRevisions = hist.body?.entries?.[0]?.revision ?? null;
};

// 10 rolling restart ───────────────────────────────────────────────────────────
const s10: Scenario = async (ctx, res) => {
  const docsN = ctx.num('docs', 100);
  const perDoc = ctx.num('perDoc', 4);
  const settle = ctx.num('settle', 30);
  const down = ctx.num('downS', 5);
  const state = readState();
  res.config = {
    instances: state.instances.length,
    docs: docsN,
    clients: docsN * perDoc,
    settleS: settle,
    instanceDownS: down,
    typingRate: 1,
    backoff:
      '400 ms base, x2, cap 30 s, equal jitter 0.5 (same as packages/editor/src/collab/backoff.ts)',
  };
  const docs = await ctx.provision(docsN, 'rolling');
  ctx.knownDocs.push(...docs);
  await ctx.addClients(ctx.specs(docs, perDoc, 'u'), sec(20), true);
  await ctx.collect(true);
  await ctx.all('typing', { on: true, rate: 1 });
  await ctx.hold(sec(settle), 'steady');
  await ctx.collect(true);
  const events: unknown[] = [];
  for (const idx of state.instances.map((_, i) => i)) {
    const tStart = Date.now();
    await ctx.sampler.sampleNow();
    const sigtermAt = Date.now();
    const exitMs = await stopInstance(idx, 'SIGTERM');
    log(`instance ${idx} exited after ${exitMs} ms`);
    await sleep(sec(down));
    const startAt = Date.now();
    await startInstance(idx);
    const healthyMs = Date.now() - startAt;
    log(`instance ${idx} healthy again after ${healthyMs} ms`);
    await ctx.hold(sec(settle), `after restart of instance ${idx}`);
    const tEnd = Date.now();
    const c = await ctx.collect(true);
    const st = await ctx.status();
    res.phases.push(
      await ctx.phase(
        `restart of instance ${idx + 1} (SIGTERM, ${down}s down, start)`,
        tStart,
        tEnd,
        c,
        {
          sigtermAt: new Date(sigtermAt).toISOString(),
          shutdownMs: exitMs,
          startToHealthyMs: healthyMs,
          readyClientsAtEnd: st.ready,
          total: st.total,
        },
      ),
    );
    events.push({ instance: idx + 1, shutdownMs: exitMs, startToHealthyMs: healthyMs });
  }
  res.results.restarts = events;
  await ctx.all('typing', { on: false });
  res.results.quiesce = await ctx.waitQuiet(90_000);
  res.results.verification = await ctx.verifyAcked();
};

// 11 redis restart ─────────────────────────────────────────────────────────────
const s11: Scenario = async (ctx, res) => {
  const docsN = ctx.num('docs', 100);
  const perDoc = ctx.num('perDoc', 4);
  const state = readState();
  if (!state.redis) throw new Error('needs topology C');
  res.config = { docs: docsN, clients: docsN * perDoc, typingRate: 1 };
  const docs = await ctx.provision(docsN, 'redis-restart');
  ctx.knownDocs.push(...docs);
  await ctx.addClients(ctx.specs(docs, perDoc, 'u'), sec(20), true);
  await ctx.collect(true);
  await ctx.all('typing', { on: true, rate: 1 });
  await ctx.hold(sec(30), 'steady');
  await ctx.collect(true);
  const t0 = Date.now();
  await ctx.sampler.sampleNow();
  // readiness probe on every instance every 250 ms
  const ready: { t: number; port: number; status: number }[] = [];
  let probing = true;
  const probe = (async () => {
    while (probing) {
      await Promise.all(
        state.instances.map(async (i) => {
          try {
            const r = await fetch(`http://127.0.0.1:${i.port}/api/ready`, {
              signal: AbortSignal.timeout(2000),
            });
            ready.push({ t: Date.now(), port: i.port, status: r.status });
          } catch {
            ready.push({ t: Date.now(), port: i.port, status: 0 });
          }
        }),
      );
      await sleep(250);
    }
  })();
  await sleep(5000);
  const restartAt = Date.now();
  execFileSync('docker', ['restart', REDIS_CONTAINER], { stdio: 'ignore' });
  const restartDone = Date.now();
  log(`docker restart rd-load-redis took ${restartDone - restartAt} ms`);
  await ctx.hold(sec(45), 'after redis restart');
  probing = false;
  await probe;
  const t1 = Date.now();
  const c = await ctx.collect(true);
  const notReady = ready.filter((r) => r.t >= restartAt && r.status !== 200);
  const firstBad = notReady[0]?.t ?? null;
  const lastBad = notReady[notReady.length - 1]?.t ?? null;
  res.phases.push(
    await ctx.phase('Redis restarted during typing', t0, t1, c, {
      dockerRestartMs: restartDone - restartAt,
      readinessProbes: ready.length,
      readinessNon200: notReady.length,
      readinessStatusCounts: notReady.reduce<Record<string, number>>(
        (a, r) => ((a[`${r.port}:${r.status}`] = (a[`${r.port}:${r.status}`] ?? 0) + 1), a),
        {},
      ),
      notReadyWindowMs: firstBad && lastBad ? lastBad - firstBad : 0,
      firstNotReadyAfterRestartMs: firstBad ? firstBad - restartAt : null,
    }),
  );
  await ctx.all('typing', { on: false });
  res.results.quiesce = await ctx.waitQuiet(90_000);
  res.results.verification = await ctx.verifyAcked();
};

// 12 database slowdown ────────────────────────────────────────────────────────
const s12: Scenario = async (ctx, res) => {
  const docsN = ctx.num('docs', 100);
  const perDoc = ctx.num('perDoc', 4);
  const pauseS = ctx.num('pauseS', 10);
  res.config = { docs: docsN, clients: docsN * perDoc, typingRate: 1, pauseS };
  const docs = await ctx.provision(docsN, 'db-pause');
  ctx.knownDocs.push(...docs);
  await ctx.addClients(ctx.specs(docs, perDoc, 'u'), sec(20), true);
  await ctx.collect(true);
  await ctx.all('typing', { on: true, rate: 1 });
  await ctx.hold(sec(30), 'steady');
  await ctx.collect(true);
  const t0 = Date.now();
  await ctx.sampler.sampleNow();
  await sleep(5000);
  execFileSync('docker', ['pause', PG_CONTAINER], { stdio: 'ignore' });
  const pausedAt = Date.now();
  log('database paused');
  // keep sampling the queue while paused (the sampler runs every 5 s)
  await sleep(sec(pauseS));
  execFileSync('docker', ['unpause', PG_CONTAINER], { stdio: 'ignore' });
  const resumedAt = Date.now();
  log('database resumed');
  await ctx.hold(sec(45), 'after resume');
  const t1 = Date.now();
  const c = await ctx.collect(true);
  res.phases.push(
    await ctx.phase(`database paused for ${pauseS} s during typing`, t0, t1, c, {
      pausedAt: new Date(pausedAt).toISOString(),
      resumedAt: new Date(resumedAt).toISOString(),
    }),
  );
  await ctx.all('typing', { on: false });
  res.results.quiesce = await ctx.waitQuiet(120_000);
  res.results.verification = await ctx.verifyAcked();
};

// 13 reconnect storm ────────────────────────────────────────────────────────────
const s13: Scenario = async (ctx, res) => {
  const docsN = ctx.num('docs', 250);
  const perDoc = ctx.num('perDoc', 4);
  const ramp = ctx.num('ramp', 60);
  const variant = String(ctx.opts.variant ?? 'lb');
  const total = docsN * perDoc;
  res.config = {
    docs: docsN,
    clients: total,
    rampS: ramp,
    variant,
    serverEnvOverrides: ctx.state.extraEnv,
    typingDuringStorm: false,
  };
  const docs = await ctx.provision(docsN, 'storm');
  ctx.knownDocs.push(...docs);
  const t0 = Date.now();
  await ctx.addClients(ctx.specs(docs, perDoc, 'u'), sec(ramp), true);
  // With auto-reconnect, failures retry in the background; wait until everyone is ready (or give up)
  const deadline = Date.now() + sec(ctx.num('connectTimeout', 900));
  for (;;) {
    const st = await ctx.status();
    if (st.ready >= total || Date.now() > deadline) break;
    await sleep(2000);
  }
  const before = await ctx.status();
  const c0 = await ctx.collect(true);
  res.phases.push(
    await ctx.phase('initial connect', t0, Date.now(), c0, {
      readyAfterInitial: before.ready,
      total,
    }),
  );
  await ctx.hold(sec(10), 'idle');
  await ctx.collect(true);
  const ts0 = Date.now();
  await ctx.sampler.sampleNow();
  if (variant === 'restart') {
    const inst = readState().instances[0]!;
    void inst;
    await stopInstance(0, 'SIGTERM');
    await sleep(sec(3));
    await startInstance(0);
  } else {
    const d = await ctx.lb('/drop');
    log(`proxy dropped ${d.dropped} proxied connections`);
  }
  const stormAt = Date.now();
  const series: { tMs: number; ready: number }[] = [];
  let t99: number | null = null;
  let t100: number | null = null;
  const limit = Date.now() + sec(ctx.num('stormTimeout', 900));
  while (Date.now() < limit) {
    const st = await ctx.status();
    series.push({ tMs: Date.now() - stormAt, ready: st.ready });
    if (t99 === null && st.ready >= 0.99 * total) t99 = Date.now() - stormAt;
    if (st.ready >= total) {
      t100 = Date.now() - stormAt;
      break;
    }
    await sleep(500);
  }
  const ts1 = Date.now();
  const c = await ctx.collect(true);
  res.phases.push(
    await ctx.phase('storm and recovery', ts0, ts1, c, {
      timeTo99PctSyncedMs: t99,
      timeToAllSyncedMs: t100,
      readyAtEnd: series[series.length - 1]?.ready,
      total,
      readySeries: series.filter((_, i) => i % 4 === 0).slice(0, 400),
    }),
  );
  res.results.storm = { timeTo99PctSyncedMs: t99, timeToAllSyncedMs: t100, total };
};

// 14 revoked / expired links ───────────────────────────────────────────────────
const s14: Scenario = async (ctx, res) => {
  const state = readState();
  const revokeDocs = ctx.num('docs', 50);
  const expireInS = ctx.num('expireInS', 150);
  res.config = {
    revokedLinks: revokeDocs,
    guests: revokeDocs * 4,
    expiringLinks: 25,
    expiringGuests: 100,
    revokedThroughInstance: state.instances.length > 1 ? 2 : 1,
    collabSweepIntervalS: 'server default 30',
    expiresInS: expireInS,
  };
  const docs = await ctx.provision(revokeDocs, 'revoke');
  const expiresAt = new Date(Date.now() + sec(expireInS)).toISOString();
  const expiring = await ctx.provision(25, 'expire', { expiresAt });
  ctx.knownDocs.push(...docs, ...expiring);
  const a = ctx.specs(docs, 4, 'revoke');
  const b = ctx.specs(expiring, 4, 'expire');
  await ctx.addClients(
    a.map((s, i) => [...s, ...(b[i] ?? [])]),
    sec(20),
    false,
  );
  await ctx.collect(true);
  const st = await ctx.status();
  log(`${st.ready}/${st.total} guests connected`);
  const direct = state.instances[state.instances.length - 1]!;
  const adminOther = new Api(`http://127.0.0.1:${direct.port}`);
  await adminOther.login(state.adminEmail, adminPassword());
  const revokeAt: Record<string, number> = {};
  const t0 = Date.now();
  await ctx.sampler.sampleNow();
  const revokeStatus: Record<string, number> = {};
  await Promise.all(
    docs.map(async (d) => {
      revokeAt[d.key] = wallNow();
      const r = await adminOther.request(
        'POST',
        `/api/documents/${d.id}/shares/${d.grantId}/revoke`,
        {},
      );
      revokeStatus[String(r.status)] = (revokeStatus[String(r.status)] ?? 0) + 1;
    }),
  );
  const respondedAt = wallNow();
  await ctx.hold(sec(20), 'after revoke');
  const times = (await ctx.all<any[]>('accessTimes')).flat();
  const lat = times
    .filter((t) => t.key && revokeAt[t.docKey] !== undefined)
    .map((t) => ({ ...t, ms: (t.closeAt ?? NaN) - revokeAt[t.docKey]! }));
  const closed = lat.filter((t) => Number.isFinite(t.ms));
  const stillOpen = lat.filter((t) => t.ready).length;
  const codes: Record<string, number> = {};
  for (const t of lat)
    codes[t.close ? `${t.close.code} ${t.close.reason}` : 'open'] =
      (codes[t.close ? `${t.close.code} ${t.close.reason}` : 'open'] ?? 0) + 1;
  // can a revoked link still get a ticket / exchange?
  const probeTicket = await ctx.all<Record<string, number>>('ticketProbe', {
    docKeys: docs.map((d) => d.key),
  });
  const probeExchange: Record<string, number> = {};
  for (const d of docs.slice(0, 20)) {
    const g = new Api(ctx.origin);
    const r = await g.request('POST', '/api/share/exchange', {
      grantId: d.grantId,
      secret: d.secret,
    });
    probeExchange[String(r.status)] = (probeExchange[String(r.status)] ?? 0) + 1;
  }
  const c = await ctx.collect(true);
  res.phases.push(
    await ctx.phase('revoke 50 links through the other instance', t0, Date.now(), c, {
      revokeApiStatus: revokeStatus,
      revokeApiMs: respondedAt - revokeAt[docs[0]!.key]!,
      socketsToCloseAfterRevoke: lat.length,
      closeLatencyMs: stats(closed.map((t) => t.ms)),
      socketsClosed: closed.length,
      socketsStillOpen: stillOpen,
      closeCodes: codes,
      ticketAfterRevokeStatusCounts: probeTicket.reduce<Record<string, number>>(
        (acc, p) => (Object.entries(p).forEach(([k, v]) => (acc[k] = (acc[k] ?? 0) + v)), acc),
        {},
      ),
      exchangeAfterRevokeStatusCounts: probeExchange,
    }),
  );
  // expiry
  const expireMs = Date.parse(expiresAt);
  const waitMs = expireMs - Date.now() + sec(75);
  if (waitMs > 0) await ctx.hold(waitMs, 'waiting for link expiry + sweep');
  const times2 = (await ctx.all<any[]>('accessTimes'))
    .flat()
    .filter((t) => expiring.some((d) => d.key === t.docKey));
  const closed2 = times2.filter((t) => t.closeAt).map((t) => t.closeAt - expireMs);
  const probeExchangeExpired = new Api(ctx.origin);
  const re = await probeExchangeExpired.request('POST', '/api/share/exchange', {
    grantId: expiring[0]!.grantId,
    secret: expiring[0]!.secret,
  });
  res.results.expiry = {
    guests: times2.length,
    closedAfterExpiryMs: stats(closed2),
    stillOpen: times2.filter((t) => t.ready).length,
    exchangeAfterExpiryStatus: re.status,
  };
  res.results.revocation = { closeLatencyMs: stats(closed.map((t) => t.ms)), stillOpen };
};

// 15 large documents ─────────────────────────────────────────────────────────
const s15: Scenario = async (ctx, res) => {
  const targets = String(ctx.opts.sizes ?? '1,5,20')
    .split(',')
    .map(Number);
  res.config = {
    targetsMiB: targets,
    paragraphBytes: 1000,
    batchParagraphs: 100,
    serverEnvOverrides: ctx.state.extraEnv,
  };
  const rows: unknown[] = [];
  for (const mib of targets) {
    const [doc] = await ctx.provision(1, `large-${mib}MiB`);
    ctx.knownDocs.push(doc!);
    const spec = ctx.specs([doc!], 1, 'seed')[0]![0]!;
    const rssBefore = await Promise.all(
      ctx.ports.map(async (p) => (await import('./metrics')).scrape(p)),
    );
    const seed = await ctx.call(0, 'seed', {
      spec,
      targetBytes: mib * 1048576,
      batch: 100,
      chars: 1000,
    });
    log(`seed ${mib} MiB: ${JSON.stringify(seed)}`);
    const rssAfterSeed = await Promise.all(
      ctx.ports.map(async (p) => (await import('./metrics')).scrape(p)),
    );
    if (seed.ok) {
      const t0 = Date.now();
      await ctx.sampler.sampleNow();
      const probe = await ctx.call(0, 'probe', { spec: { ...spec, key: `probe${mib}` }, count: 5 });
      const rssAfterProbe = await Promise.all(
        ctx.ports.map(async (p) => (await import('./metrics')).scrape(p)),
      );
      await ctx.sampler.sampleNow();
      res.phases.push(
        await ctx.phase(
          `fresh clients opening the ${mib} MiB document`,
          t0,
          Date.now(),
          await ctx.collect(true),
        ),
      );
      rows.push({
        mib,
        seed,
        probe,
        rssMb: ctx.ports.map((p, i) => ({
          port: p,
          beforeSeed: round(
            (rssBefore[i]?.get('rd_process_resident_memory_bytes') ?? NaN) / 1048576,
          ),
          afterSeed: round(
            (rssAfterSeed[i]?.get('rd_process_resident_memory_bytes') ?? NaN) / 1048576,
          ),
          afterProbes: round(
            (rssAfterProbe[i]?.get('rd_process_resident_memory_bytes') ?? NaN) / 1048576,
          ),
        })),
      });
    } else {
      rows.push({ mib, seed, probe: null });
    }
    await ctx.collect(true);
  }
  res.results.documents = rows;
};

// 16 soak ───────────────────────────────────────────────────────────────────────
const s16: Scenario = async (ctx, res) => {
  const docsN = ctx.num('docs', 250);
  const perDoc = ctx.num('perDoc', 4);
  const rate = ctx.num('rate', 0.2);
  const minutes = ctx.num('minutes', 60);
  res.config = {
    docs: docsN,
    clients: docsN * perDoc,
    ratePerClient: rate,
    editsPerSecondTotal: rate * docsN * perDoc,
    minutes,
    metricSampleIntervalS: 5,
  };
  const docs = await ctx.provision(docsN, 'soak');
  ctx.knownDocs.push(...docs);
  await ctx.addClients(ctx.specs(docs, perDoc, 'u'), sec(60), true);
  await ctx.collect(true);
  await ctx.all('typing', { on: true, rate });
  const tStart = Date.now();
  const windows: unknown[] = [];
  let wStart = Date.now();
  const windowMs = 5 * 60_000;
  const endAt = tStart + minutes * 60_000;
  while (Date.now() < endAt && !ctx.sampler.overload) {
    await sleep(Math.min(windowMs, endAt - Date.now()));
    const c = await ctx.collect(true);
    const ph = await ctx.phase(
      `minute ${Math.round((Date.now() - tStart) / 60000)}`,
      wStart,
      Date.now(),
      c,
    );
    windows.push({
      atMinute: Math.round((Date.now() - tStart) / 60000),
      remoteP95: ph.latency.ALL?.remote?.p95,
      ackP95: ph.latency.ALL?.ack?.p95,
      remoteN: ph.latency.ALL?.remote?.n,
      reconnects: Object.values(ph.counts).reduce((a, g) => a + (g.reconnects ?? 0), 0),
      errors: ph.errors,
      rssMb: ph.server.map((s) => round(s.rssMbEnd ?? NaN)),
      generatorCpu: ph.generator.map((g) => round(g.cpuPct)),
    });
    wStart = Date.now();
    log(`soak minute ${Math.round((Date.now() - tStart) / 60000)} of ${minutes}`);
  }
  const ranMin = (Date.now() - tStart) / 60000;
  await ctx.all('typing', { on: false });
  const rows = ctx.sampler.rows.filter((r) => r.t >= tStart);
  const per: Record<string, unknown> = {};
  for (const port of ctx.ports) {
    const pts = (k: string, from: number) =>
      rows
        .filter((r) => r.t >= from)
        .map((r) => ({ t: r.t, v: r.inst.find((i) => i.port === port)?.all?.get(k) }))
        .filter((p): p is { t: number; v: number } => p.v !== undefined);
    const rss = (from: number) => pts('rd_process_resident_memory_bytes', from);
    const heap = (from: number) => pts('rd_process_heap_used_bytes', from);
    const m = (n: number) => tStart + n * 60_000;
    const half = ranMin / 2;
    per[port] = {
      rssSlopeBytesPerMinAfter10min: round(slope(rss(m(10))) * 60_000, 0),
      heapSlopeBytesPerMinAfter10min: round(slope(heap(m(10))) * 60_000, 0),
      rssSlopeBytesPerMinSecondHalf: round(slope(rss(m(half))) * 60_000, 0),
      heapSlopeBytesPerMinSecondHalf: round(slope(heap(m(half))) * 60_000, 0),
      rssSlopeBytesPerMinWholeRun: round(slope(rss(tStart)) * 60_000, 0),
      rssMbAt: Object.fromEntries(
        [5, 10, 20, 30, 40, 50, 60]
          .filter((x) => x <= ranMin)
          .map((x) => [`min${x}`, round((rss(m(x))[0]?.v ?? NaN) / 1048576)]),
      ),
      heapMbAt: Object.fromEntries(
        [5, 10, 20, 30, 40, 50, 60]
          .filter((x) => x <= ranMin)
          .map((x) => [`min${x}`, round((heap(m(x))[0]?.v ?? NaN) / 1048576)]),
      ),
    };
  }
  res.results.soak = { ranMinutes: round(ranMin, 1), perInstance: per, windows };
  res.results.quiesce = await ctx.waitQuiet(90_000);
  res.results.verification = await ctx.verifyAcked();
  res.results.rssSeries = rows
    .filter((_, i) => i % 6 === 0)
    .map((r) => ({
      min: round((r.t - tStart) / 60000, 1),
      rssMb: r.inst.map((i) =>
        round((i.all?.get('rd_process_resident_memory_bytes') ?? NaN) / 1048576),
      ),
      heapMb: r.inst.map((i) => round((i.all?.get('rd_process_heap_used_bytes') ?? NaN) / 1048576)),
    }));
};

export const SCENARIOS: Record<string, { title: string; run: Scenario }> = {
  s1: { title: '1. connect-1000: concurrent authenticated sockets', run: s1 },
  s2: { title: '2. 250 docs x 4 collaborators typing', run: s2 },
  s2b: { title: '2b. typing rate steps (sustainable rate)', run: s2b },
  s3: { title: '3. 100 docs x 10 collaborators typing', run: s3 },
  s4: { title: '4. hot document: 10 / 25 / 50 editors', run: s4 },
  s5: { title: '5. concurrent paste bursts', run: s5 },
  s6: { title: '6. presence updates', run: s6 },
  s7: { title: '7. image uploads', run: s7 },
  s8: { title: '8. session creation API', run: s8 },
  s9: { title: '9. version-history reads', run: s9 },
  s10: { title: '10. rolling restart (2 instances)', run: s10 },
  s11: { title: '11. Redis restart during typing', run: s11 },
  s12: { title: '12. temporary database pause', run: s12 },
  s13: { title: '13. reconnect storm', run: s13 },
  s14: { title: '14. revoked and expired links', run: s14 },
  s15: { title: '15. large documents', run: s15 },
  s16: { title: '16. soak', run: s16 },
};
