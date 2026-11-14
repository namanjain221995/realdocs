/**
 * Stand-alone load generator for a second machine (topology "backend here, generator there").
 * It is bundled into one file (see README) and needs only Node.js on the other machine.
 *
 *   node remote-gen.mjs --origin http://10.100.184.1:4460 --docs docs.json --from 0 --count 50 \
 *        --rate 1 --ramp 30 --warmup 15 --duration 120
 *
 * Two clients per document, both in this process: an edit is timed from the local transaction
 * to its arrival in the other client's Y.Doc, so the path is generator -> network -> backend ->
 * network -> generator and one clock measures it (no clock offset between machines is involved).
 * Prints one JSON object.
 */
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { LoadClient, Shared, type ClientSpec } from '../../load/src/client';
import { sleep, stats } from '../../load/src/common';

const arg = (name: string, def?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : def;
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
};
const origin = arg('origin');
const docs = (
  JSON.parse(readFileSync(arg('docs'), 'utf8')) as {
    key: string;
    id: string;
    grantId: string;
    secret: string;
  }[]
).slice(Number(arg('from', '0')), Number(arg('from', '0')) + Number(arg('count', '1000000')));
const rate = Number(arg('rate', '1'));
const rampS = Number(arg('ramp', '30'));
const warmupS = Number(arg('warmup', '15'));
const durationS = Number(arg('duration', '120'));

const shared = new Shared(origin);
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
const clients: LoadClient[] = [];
docs.forEach((doc, d) => {
  for (let idx = 0; idx < 2; idx += 1) {
    const spec: ClientSpec = {
      key: `r${process.pid}-${d}-${idx}`,
      docKey: doc.key,
      docId: doc.id,
      grantId: doc.grantId,
      secret: doc.secret,
      idx,
      group: 'remote',
      awareness: true,
      observe: idx === 0 ? 'all' : 'first',
    };
    const c = new LoadClient(spec, shared);
    shared.clients.push(c);
    clients.push(c);
  }
});
await Promise.all(
  clients.map(async (c) => {
    await sleep(Math.random() * rampS * 1000);
    await c.startAndWaitFirst(true);
  }),
);
const first: Record<string, number> = {};
for (const c of clients) first[c.firstAttemptResult] = (first[c.firstAttemptResult] ?? 0) + 1;
for (const c of clients) c.startTyping(rate);
await sleep(warmupS * 1000);
for (const k of Object.keys(shared.samples)) delete shared.samples[k];
for (const k of Object.keys(shared.counts)) delete shared.counts[k];
lag.reset();
const cpu0 = process.cpuUsage();
const t0 = Date.now();
await sleep(durationS * 1000);
const seconds = (Date.now() - t0) / 1000;
const cpu = process.cpuUsage(cpu0);
const samples = shared.samples.remote ?? {};
const counts = shared.counts.remote ?? {};
for (const c of clients) c.stopTyping();
await sleep(3000);
const out = {
  pid: process.pid,
  documents: docs.length,
  clients: clients.length,
  firstAttempt: first,
  readyAtEnd: clients.filter((c) => c.ready).length,
  seconds,
  editsPerSecond: (counts.edits ?? 0) / seconds,
  remote: stats(samples.remote ?? []),
  ack: stats(samples.ack ?? []),
  connect: stats(samples.connect ?? []),
  unackedAtEnd: clients.reduce((a, c) => a + c.unacked, 0),
  acked: Object.fromEntries(
    docs.map((d, i) => [d.key, [...clients[i * 2]!.acked, ...clients[i * 2 + 1]!.acked]]),
  ),
  generator: {
    cpuPct: ((cpu.user + cpu.system) / 1000 / (seconds * 1000)) * 100,
    rssMb: process.memoryUsage().rss / 1048576,
    eventLoopP99Ms: lag.percentile(99) / 1e6,
  },
  errors: shared.errors,
  closeCodes: shared.closeCodes,
};
// Exit only after the whole line is written: a pipe takes 64 KiB at a time.
process.stdout.write(`${JSON.stringify(out)}\n`, () => process.exit(0));
