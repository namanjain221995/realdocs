/**
 * Runner of the performance framework.
 *
 *   cd tests/load && node --import tsx ../performance/src/run.ts <scenario[,scenario...]> [options]
 *   (or: tests/performance/perf.sh <scenario[,...]> [options])
 *
 * Options: --topology A|B|C (A: one backend, pool 10; B: one backend, pool 40; C: two backends,
 * Redis), --instances N, --pool N, --workers N (generator processes, default 8), --seed N,
 * --out NAME (directory under docs/load-test-results), --keep, --no-stack, --env K=V (server
 * setting of the test stack, repeatable), and per scenario: --docs, --duration S, --ramp S,
 * --steps a,b,c, --mix mixed|active, --sizes KiB,..., --minutes N, --rounds N, --concurrency N.
 *
 * It starts the isolated stack of tests/load (PostgreSQL container rd-load-pg with CPU and memory
 * limits, backends as local processes on 127.0.0.1:4450+, a proxy on 4459), runs the scenarios,
 * writes JSON and Markdown per scenario, and removes the stack. A watchdog aborts the run when the
 * shared host is in trouble (see monitor.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, repoRoot, sleep, stateExists } from '../../load/src/common';
import { Ctx, type Opts, type ScenarioResult, log } from '../../load/src/ctx';
import { renderResult } from '../../load/src/render';
import { down, parseEnvArgs, topologyDefaults, up } from '../../load/src/stack';
import { DEFAULT_LIMITS, Monitor } from './monitor';
import { SCENARIOS, type PerfCtx } from './scenarios';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsRoot = path.join(repoRoot, 'docs/load-test-results');

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const opts: Opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--env') {
      i += 1;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else {
        opts[key] = next;
        i += 1;
      }
    } else positional.push(a);
  }
  return { positional, opts, env: parseEnvArgs(argv) };
}

/** Secrets of the test stack never reach a result file. */
function masked(state: unknown): unknown {
  return JSON.parse(
    JSON.stringify(state, (key, value) =>
      /password|secret|token|DATABASE_URL|REDIS_URL/i.test(key) && typeof value === 'string'
        ? '<masked>'
        : value,
    ),
  );
}

async function main() {
  const { positional, opts, env } = parseArgs(process.argv.slice(2));
  const names = (positional[0] ?? '').split(',').filter(Boolean);
  if (names.length === 0 || names.some((n) => !SCENARIOS[n])) {
    process.stderr.write(`Usage: run.ts <${Object.keys(SCENARIOS).join('|')}>[,...] [options]\n`);
    process.exit(2);
  }
  const topology = String(opts.topology ?? 'A');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(resultsRoot, String(opts.out ?? `${stamp}-${names.join('+')}`));
  mkdirSync(outDir, { recursive: true });

  // The database container is bounded; the backends are single-threaded Node.js processes.
  process.env.RD_LOAD_PG_CPUS ??= '4';
  process.env.RD_LOAD_PG_MEMORY ??= '6g';
  process.env.RD_LOAD_PG_STATEMENTS ??= '1';

  const monitor = new Monitor(DEFAULT_LIMITS, 5000, (reason) =>
    log(`WATCHDOG: ${reason}; the run stops at the next check`),
  );
  const before = monitor.check();
  if (before) {
    process.stderr.write(`Not starting: the host is already over a limit (${before}).\n`);
    process.exit(3);
  }

  let owned = false;
  const cleanup = async () => {
    if (owned && !opts.keep) await down().catch(() => undefined);
  };
  process.on('SIGINT', () => void cleanup().then(() => process.exit(130)));
  process.on('SIGTERM', () => void cleanup().then(() => process.exit(143)));
  if (!opts.noStack) {
    if (stateExists()) throw new Error('a stack is already up: tests/load "stack.ts down" first');
    const d = topologyDefaults(topology);
    const instances = Number(opts.instances ?? d.instances);
    log(`starting topology ${topology}: ${instances} backend(s), pool ${opts.pool ?? d.pool}`);
    await up({
      topology,
      instances,
      pool: Number(opts.pool ?? d.pool),
      redis: instances > 1 ? true : d.redis,
      env,
    });
    owned = true;
  }
  const state = readState();
  writeFileSync(
    path.join(outDir, 'environment.json'),
    JSON.stringify(
      {
        host: {
          hostname: os.hostname(),
          cpus: os.cpus().length,
          arch: os.arch(),
          loadavgAtStart: os.loadavg(),
          totalMemMb: Math.round(os.totalmem() / 1048576),
          node: process.version,
          kernel: os.release(),
        },
        limits: {
          watchdog: DEFAULT_LIMITS,
          postgresCpus: process.env.RD_LOAD_PG_CPUS,
          postgresMemory: process.env.RD_LOAD_PG_MEMORY,
        },
        stack: masked(state),
        argv: process.argv.slice(2),
      },
      null,
      1,
    ),
  );

  const ctx = new Ctx(outDir, opts) as PerfCtx;
  ctx.workerEntry = path.join(here, 'worker.ts');
  ctx.monitor = monitor;
  ctx.seed = Number(opts.seed ?? 20261114);
  const results: ScenarioResult[] = [];
  try {
    await ctx.init(Number(opts.workers ?? 8));
    monitor.start();
    // The watchdog's verdict stops every hold() of the harness.
    const link = setInterval(() => {
      if (monitor.tripped) ctx.sampler.overload = true;
    }, 1000);
    link.unref();
    for (const name of names) {
      const sc = SCENARIOS[name]!;
      const res: ScenarioResult = {
        scenario: name,
        title: sc.title,
        topology,
        startedAt: new Date().toISOString(),
        config: {},
        phases: [],
        results: {},
        notes: [],
        status: 'ok',
      };
      log(`=== ${sc.title} (topology ${topology}) ===`);
      const t0 = Date.now();
      try {
        await sc.run(ctx, res);
      } catch (e) {
        res.status = 'failed';
        res.error = (e as Error).stack ?? String(e);
        log(`scenario ${name} failed: ${res.error}`);
      }
      if (monitor.tripped) {
        res.status = res.status === 'ok' ? 'aborted' : res.status;
        res.notes.push(`Stopped by the watchdog: ${monitor.tripped}.`);
      }
      res.endedAt = new Date().toISOString();
      res.results.systemWholeScenario = monitor.summary(t0, Date.now());
      results.push(res);
      ctx.save(`${name}.json`, res);
      writeFileSync(path.join(outDir, `${name}.md`), renderResult(res));
      await ctx.all('stopBehave').catch(() => undefined);
      await ctx.all('stopAll').catch(() => undefined);
      await sleep(2000);
      if (monitor.tripped) break;
    }
  } finally {
    monitor.stop();
    ctx.save('system.json', monitor.samples);
    ctx.save('metrics.json', ctx.sampler.series());
    writeFileSync(
      path.join(outDir, 'summary.md'),
      `# Performance run (${new Date().toISOString()}, topology ${topology})\n\n${results.map(renderResult).join('\n\n')}\n`,
    );
    if (stateExists()) {
      for (const inst of readState().instances) {
        try {
          const warn = readFileSync(inst.logFile, 'utf8')
            .split('\n')
            .filter((l) => /"level":(40|50|60)/.test(l));
          writeFileSync(
            path.join(outDir, `server-${inst.index}-warnings.log`),
            warn.slice(-500).join('\n'),
          );
        } catch {
          /* no log */
        }
      }
    }
    await ctx.close();
    await cleanup();
  }
  log(`results in ${path.relative(repoRoot, outDir)}`);
  process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).stack}\n`);
  process.exit(1);
});
