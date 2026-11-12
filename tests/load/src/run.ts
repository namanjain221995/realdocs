/**
 * run.ts <scenario[,scenario...]|all> [--topology A|B|C] [--keep] [--no-stack] [--workers N]
 *        [--env K=V ...] [--users N --docs N --duration S --instances N --rate R ...]
 * Brings up a fresh stack for the topology (unless --no-stack), runs the scenarios in one stack,
 * writes tests/load/results/<UTC timestamp>/<scenario>.json, metrics.json and summary.md, tears the stack down.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resultsRoot, readState, stateExists, sleep } from './common';
import { Ctx, type Opts, type ScenarioResult, log } from './ctx';
import { renderResult } from './render';
import { SCENARIOS } from './scenarios';
import { down, parseEnvArgs, topologyDefaults, up } from './stack';

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

const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/\.\d+Z$/, 'Z');

async function main() {
  const { positional, opts, env } = parseArgs(process.argv.slice(2));
  const list = (positional[0] ?? '').split(',').filter(Boolean);
  const names = list.includes('all') ? Object.keys(SCENARIOS) : list;
  if (names.length === 0 || names.some((n) => !SCENARIOS[n])) {
    process.stderr.write(
      `Usage: run.ts <${Object.keys(SCENARIOS).join('|')}|all> [--topology A|B|C]\n`,
    );
    process.exit(2);
  }
  const topology = String(opts.topology ?? 'A');
  const outDir = path.join(resultsRoot, String(opts.out ?? stamp()));
  mkdirSync(outDir, { recursive: true });
  let owned = false;
  const cleanup = async () => {
    if (owned && !opts.keep) await down().catch(() => undefined);
  };
  process.on('SIGINT', () => void cleanup().then(() => process.exit(130)));
  process.on('SIGTERM', () => void cleanup().then(() => process.exit(143)));
  if (!opts.noStack) {
    if (stateExists())
      throw new Error('a stack is already up; run stack.ts down or pass --no-stack');
    const d = topologyDefaults(topology);
    const instances = Number(opts.instances ?? d.instances);
    log(`starting topology ${topology}: ${instances} instance(s), pool ${opts.pool ?? d.pool}`);
    await up({
      topology,
      instances,
      pool: Number(opts.pool ?? d.pool),
      redis: instances > 1 ? true : d.redis,
      env,
    });
    owned = true;
  }
  const meta = {
    host: {
      cpus: os.cpus().length,
      model: os.cpus()[0]?.model,
      loadavgAtStart: os.loadavg(),
      totalMemMb: Math.round(os.totalmem() / 1048576),
      freeMemMb: Math.round(os.freemem() / 1048576),
      node: process.version,
      kernel: os.release(),
    },
    stack: readState(),
    argv: process.argv.slice(2),
  };
  writeFileSync(path.join(outDir, 'environment.json'), JSON.stringify(meta, null, 1));
  const results: ScenarioResult[] = [];
  const ctx = new Ctx(outDir, opts);
  try {
    await ctx.init(Number(opts.workers ?? 8));
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
      try {
        await sc.run(ctx, res);
        if (ctx.sampler.overload) {
          res.notes.push(
            'Host load exceeded 18 for more than a minute during this scenario; it was cut short.',
          );
        }
      } catch (e) {
        res.status = 'failed';
        res.error = (e as Error).stack ?? String(e);
        log(`scenario ${name} failed: ${res.error}`);
      }
      res.endedAt = new Date().toISOString();
      res.notes.push(
        `Host load average (1 min) peaked at ${ctx.sampler.maxLoad.toFixed(1)} during the run so far.`,
      );
      results.push(res);
      ctx.save(`${name}.json`, res);
      writeFileSync(path.join(outDir, `${name}.md`), renderResult(res));
      await ctx.all('stopAll').catch(() => undefined);
      await sleep(2000);
    }
  } finally {
    ctx.save('metrics.json', ctx.sampler.series());
    writeFileSync(
      path.join(outDir, 'summary.md'),
      `# Load test summary (${new Date().toISOString()}, topology ${topology})\n\n${results.map(renderResult).join('\n\n')}\n`,
    );
    // keep the server logs (info level) for the findings
    for (const inst of readState().instances) {
      try {
        const text = readFileSync(inst.logFile, 'utf8');
        const lines = text.split('\n');
        const warn = lines.filter((l) => /"level":(40|50|60)/.test(l));
        writeFileSync(
          path.join(outDir, `server-${inst.index}-warnings.log`),
          warn.slice(-2000).join('\n'),
        );
      } catch {
        /* no log */
      }
    }
    await ctx.close();
    await cleanup();
  }
  log(`results in ${outDir}`);
  void execFileSync;
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).stack}\n`);
  process.exit(1);
});
