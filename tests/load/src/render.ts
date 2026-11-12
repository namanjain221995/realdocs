/** Renders result JSON into markdown tables (summary.md and the report). */
import type { PhaseRecord, ScenarioResult } from './ctx';
import type { Stats } from './common';

const f1 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(1);
const f0 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? 'n/a'
    : Math.round(v).toLocaleString('en-US');

export function statRow(label: string, s: Stats | undefined): string {
  if (!s || s.n === 0) return `| ${label} | 0 | | | | | |`;
  return `| ${label} | ${s.n} | ${f1(s.p50)} | ${f1(s.p95)} | ${f1(s.p99)} | ${f1(s.max)} | ${f1(s.mean)} |`;
}

export function renderPhase(ph: PhaseRecord): string {
  const out: string[] = [];
  out.push(`#### ${ph.name} (${ph.durationS.toFixed(0)} s)`);
  const rows: string[] = [];
  const groups = Object.keys(ph.latency).filter((g) => g !== 'ALL');
  for (const group of groups.length > 1 ? [...groups, 'ALL'] : ['ALL']) {
    for (const [metric, s] of Object.entries(ph.latency[group] ?? {})) {
      rows.push(statRow(groups.length > 1 ? `${group} / ${metric}` : metric, s));
    }
  }
  const unique = [...new Set(rows)];
  if (unique.length) {
    out.push(
      '',
      '| metric (ms) | n | p50 | p95 | p99 | max | mean |',
      '|---|---:|---:|---:|---:|---:|---:|',
      ...unique,
    );
  }
  const counts: Record<string, number> = {};
  for (const g of Object.values(ph.counts))
    for (const [k, v] of Object.entries(g)) counts[k] = (counts[k] ?? 0) + v;
  if (Object.keys(counts).length)
    out.push(
      '',
      `Client counters: ${Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );
  if (Object.keys(ph.errors).length)
    out.push(
      '',
      `Client errors: ${Object.entries(ph.errors)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );
  if (Object.keys(ph.closeCodes).length)
    out.push(
      '',
      `WebSocket close codes seen: ${Object.entries(ph.closeCodes)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );
  if (ph.server.length) {
    out.push(
      '',
      '| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    for (const s of ph.server) {
      out.push(
        `| :${s.port} | ${f1(s.cpuPctAvg)} | ${f1(s.cpuPctMax)} | ${f0(s.rssMbMax)} | ${f0(s.heapMbMax)} | ${f0(s.wsMax)} | ${f0(s.wsForwardedMax)} | ${f0(s.docsLoadedMax)} | ${f0(s.poolConnectionsMax)} / ${f0(s.poolMax)} | ${f0(s.poolWaitingMax)} (${f1(s.poolWaitingAvg)}) | ${f1(s.lagP99MaxMs)} | ${f0(s.queueBytesMax)} | ${f1(s.redisPingMaxMs)} | ${f0(s.persistFailures)} |`,
      );
    }
    for (const s of ph.server) {
      const p = Object.entries(s.persist)
        .map(
          ([k, v]) =>
            `${k}: n=${f0(v.count)} mean ${f1(v.meanMs)} ms, p95 <= ${f1(v.p95UpperMs)} ms, p99 <= ${f1(v.p99UpperMs)} ms`,
        )
        .join('; ');
      const h = s.http['ALL /api'];
      out.push(
        '',
        `Server :${s.port} persist ${p || 'n/a'}; yjs updates ${f0(s.yjsUpdates)}; HTTP /api (server-side) n=${f0(h?.count)} mean ${f1(h?.meanMs)} ms, p95 <= ${f1(h?.p95UpperMs)} ms; ws outcomes ${
          Object.entries(s.wsOutcomes)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ') || 'n/a'
        }`,
      );
    }
  }
  if (ph.generator.length) {
    out.push(
      '',
      `Generator (${ph.generator.length} worker processes): CPU % per worker ${ph.generator.map((g) => f0(g.cpuPct)).join('/')}; event-loop lag p99 max ${f1(Math.max(...ph.generator.map((g) => g.lagP99Ms)))} ms (max ${f1(Math.max(...ph.generator.map((g) => g.lagMaxMs)))} ms); host load1 max ${f1(ph.hostLoadMax)}`,
    );
  }
  if (ph.extra) {
    const x = { ...ph.extra } as Record<string, unknown>;
    delete x.readySeries;
    out.push('', '```json', JSON.stringify(x, null, 1), '```');
  }
  return out.join('\n');
}

export function renderResult(r: ScenarioResult): string {
  const out: string[] = [
    `## ${r.title} (topology ${r.topology}) [${r.status}]`,
    '',
    `Started ${r.startedAt}, ended ${r.endedAt ?? 'n/a'}.`,
    '',
    '```json',
    JSON.stringify(r.config, null, 1),
    '```',
  ];
  for (const ph of r.phases) out.push('', renderPhase(ph));
  if (Object.keys(r.results).length)
    out.push('', '### Results', '', '```json', JSON.stringify(r.results, null, 1), '```');
  if (r.notes.length) out.push('', '### Notes', '', ...r.notes.map((n) => `- ${n}`));
  if (r.error) out.push('', `### Error`, '', '```', r.error, '```');
  return out.join('\n');
}
