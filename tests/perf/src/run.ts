/**
 * Runs the whole benchmark against a stack that is already up (`pnpm --filter @realtimedocs/perf run stack:up`)
 * and writes results/<UTC timestamp>/ with raw JSON and summary.md.
 *   node --import tsx src/run.ts [--edits N] [--protocol-edits N] [--loads N] [--images N] [--only a,b]
 */
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONDITIONS, type Condition, runDir, saveJson } from './common';
import { envInfo } from './envinfo';
import { runInDocker } from './in-docker';
import { pingAll } from './ping';
import { runProtocol } from './protocol';
import { writeSummary } from './report';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] as string) : fallback;
};
const edits = Number(arg('edits', '320'));
const protocolEdits = Number(arg('protocol-edits', '400'));
const loads = Number(arg('loads', '30'));
const images = Number(arg('images', '20'));
const only = new Set(arg('only', 'ping,browser-edit,protocol,initial-load,image').split(','));
const conditions: Condition['key'][] = ['loopback', 'rtt10', 'rtt50'];
const docs = ['small', 'large'] as const;
const clientCounts = [2, 5, 10];

const dir = runDir();
const log: {
  step: string;
  startedAt: string;
  endedAt: string;
  loadavgStart: string;
  loadavgEnd: string;
  ok: boolean;
}[] = [];
const loadavg = () => readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');

async function step(name: string, fn: () => Promise<boolean | void>): Promise<void> {
  const startedAt = new Date().toISOString();
  const loadavgStart = loadavg();
  process.stdout.write(`\n== ${name} (load ${loadavgStart})\n`);
  let ok = true;
  try {
    const r = await fn();
    if (r === false) ok = false;
  } catch (error) {
    ok = false;
    process.stdout.write(`FAILED ${name}: ${String(error)}\n`);
  }
  log.push({
    step: name,
    startedAt,
    endedAt: new Date().toISOString(),
    loadavgStart,
    loadavgEnd: loadavg(),
    ok,
  });
  writeFileSync(path.join(dir, 'run-log.json'), JSON.stringify(log, null, 2));
}

saveJson(dir, 'env.json', await envInfo());

if (only.has('ping')) {
  await step('ping before', async () => {
    const r = await pingAll();
    saveJson(dir, 'ping-before.json', r);
    for (const x of r)
      process.stdout.write(
        `${x.condition}: p50 ${x.rtt.p50.toFixed(2)} p95 ${x.rtt.p95.toFixed(2)} ms\n`,
      );
  });
}

if (only.has('browser-edit')) {
  for (const cond of conditions) {
    for (const doc of docs) {
      for (const clients of clientCounts) {
        await step(`browser-edit ${cond} ${doc} ${clients}`, async () => {
          let code = runInDocker(
            'src/browser-edit.ts',
            [cond, doc, String(clients), String(edits)],
            dir,
          ).code;
          if (code !== 0)
            code = runInDocker(
              'src/browser-edit.ts',
              [cond, doc, String(clients), String(edits)],
              dir,
            ).code;
          return code === 0;
        });
      }
    }
  }
}

if (only.has('protocol')) {
  for (const cond of conditions) {
    for (const doc of docs) {
      for (const clients of clientCounts) {
        await step(`protocol ${cond} ${doc} ${clients}`, async () => {
          const r = await runProtocol(CONDITIONS[cond], doc, clients, protocolEdits);
          saveJson(dir, `protocol-${cond}-${doc}-${clients}.json`, r);
        });
      }
    }
  }
}

if (only.has('initial-load')) {
  for (const cond of conditions) {
    for (const doc of docs) {
      await step(
        `initial-load ${cond} ${doc}`,
        async () => runInDocker('src/initial-load.ts', [cond, doc, String(loads)], dir).code === 0,
      );
    }
  }
}

if (only.has('image')) {
  for (const cond of conditions) {
    for (const clients of [2, 5]) {
      for (const bytes of [200_000, 2_000_000]) {
        await step(
          `image ${cond} ${clients} ${bytes}`,
          async () =>
            runInDocker('src/image.ts', [cond, String(clients), String(bytes), String(images)], dir)
              .code === 0,
        );
      }
    }
  }
}

if (only.has('ping')) {
  await step('ping after', async () => {
    saveJson(dir, 'ping-after.json', await pingAll());
  });
}

writeSummary(dir);
process.stdout.write(`\nresults: ${dir}\n`);
