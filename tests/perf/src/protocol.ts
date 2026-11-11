/**
 * Protocol-level benchmark, no rendering. Node clients on @hocuspocus/provider + yjs + ws, all in
 * ONE Node process (one clock: performance.now()), authenticated with collaboration tickets.
 *
 * Per sample: client A inserts one character into a scratch paragraph (t0 = just before
 * doc.transact) and sends `mark` like the editor does. Every other client takes t1 in its
 * Y.Doc `afterTransaction` handler once the remote update has been applied to its document.
 * A takes tSaved when the server's `saved` for that mark arrives (after the PostgreSQL commit).
 */
import {
  CONDITIONS,
  type Condition,
  HOST,
  adminPassword,
  readState,
  runDir,
  saveJson,
  sleep,
  stats,
} from './common';
import { PerfClient } from './collab';
import { Api } from './http';
import * as Y from 'yjs';

export interface ProtocolResult {
  scenario: 'protocol';
  condition: Condition['key'];
  doc: 'small' | 'large';
  clients: number;
  warmup: number;
  /** Per measured edit: latency to each observer (ms) and the durable-ack latency (ms). */
  relayMs: number[][];
  savedMs: number[];
  /** Sender-side write cost: how long doc.transact itself took (ms). */
  transactMs: number[];
}

function lastText(client: PerfClient): Y.XmlText | null {
  const f = client.fragment;
  const last = f.length ? f.get(f.length - 1) : null;
  if (last instanceof Y.XmlElement) {
    const t = last.get(0);
    return t instanceof Y.XmlText ? t : null;
  }
  return null;
}

export async function runProtocol(
  condition: Condition,
  docKey: 'small' | 'large',
  clients: number,
  samples: number,
  warmup = 50,
): Promise<ProtocolResult> {
  const state = readState();
  const info = state.docs[docKey];
  if (!info) throw new Error(`document ${docKey} missing`);
  const api = new Api(condition.port);
  await api.login(state.adminEmail, adminPassword(state));
  const all: PerfClient[] = [];
  for (let i = 0; i < clients; i += 1) all.push(await PerfClient.connect(api, info.id));
  const writer = all[0] as PerfClient;
  const observers = all.slice(1);

  // Scratch paragraph at the end of the document where the "typing" happens.
  writer.edit(() => {
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText()]);
    writer.fragment.push([p]);
  });
  const arrived = async () => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      if (
        observers.every((o) => lastText(o) !== null && o.fragment.length === writer.fragment.length)
      )
        return;
      if (Date.now() > deadline) throw new Error('scratch paragraph did not arrive');
      await sleep(10);
    }
  };
  await arrived();
  await writer.save();
  const baseLen = (lastText(writer) as Y.XmlText).length;

  const total = warmup + samples;
  const t0 = new Array<number>(total + 1).fill(Number.NaN);
  const tObs: number[][] = observers.map(() => new Array<number>(total + 1).fill(Number.NaN));
  const tSaved = new Array<number>(total + 1).fill(Number.NaN);
  const transactMs = new Array<number>(total + 1).fill(Number.NaN);

  observers.forEach((o, idx) => {
    o.doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.local) return;
      const text = lastText(o);
      if (!text) return;
      const k = text.length - baseLen;
      const now = performance.now();
      for (let j = k; j >= 1 && Number.isNaN((tObs[idx] as number[])[j]); j -= 1)
        (tObs[idx] as number[])[j] = now;
    });
  });
  const nToK = new Map<number, number>();
  writer.onStateless((m) => {
    if (m.t !== 'saved') return;
    const now = performance.now();
    for (const [n, k] of nToK) {
      if (n <= m.n && Number.isNaN(tSaved[k] as number)) tSaved[k] = now;
    }
  });

  for (let k = 1; k <= total; k += 1) {
    const text = lastText(writer) as Y.XmlText;
    const before = performance.now();
    t0[k] = before;
    writer.edit(() => text.insert(text.length, 'x'));
    transactMs[k] = performance.now() - before;
    const writerN = writer.n;
    nToK.set(writerN, k);
    writer.provider.sendStateless(JSON.stringify({ t: 'mark', n: writerN }));
    // Human typing rate: 5-10 characters per second.
    await sleep(100 + Math.random() * 100);
  }
  await sleep(1000 + (condition.addedOneWayMs * 2 + 50));

  const relay: number[][] = [];
  const saved: number[] = [];
  const tx: number[] = [];
  for (let k = warmup + 1; k <= total; k += 1) {
    relay.push(
      observers.map((_, idx) => ((tObs[idx] as number[])[k] as number) - (t0[k] as number)),
    );
    saved.push((tSaved[k] as number) - (t0[k] as number));
    tx.push(transactMs[k] as number);
  }

  // Remove the scratch paragraph again so the benchmark document keeps its size.
  writer.edit(() => writer.fragment.delete(writer.fragment.length - 1, 1));
  await writer.save().catch(() => undefined);
  for (const c of all) c.destroy();
  await sleep(200);
  return {
    scenario: 'protocol',
    condition: condition.key,
    doc: docKey,
    clients,
    warmup,
    relayMs: relay,
    savedMs: saved,
    transactMs: tx,
  };
}

export function summarise(r: ProtocolResult) {
  return {
    relay: stats(r.relayMs.flat()),
    saved: stats(r.savedMs),
    transact: stats(r.transactMs),
    worstObserver: stats(r.relayMs.map((row) => Math.max(...row))),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cond = 'loopback', doc = 'small', clients = '2', samples = '400'] = process.argv.slice(2);
  const condition = CONDITIONS[cond as Condition['key']];
  const result = await runProtocol(
    condition,
    doc as 'small' | 'large',
    Number(clients),
    Number(samples),
  );
  const s = summarise(result);
  const dir = runDir();
  saveJson(dir, `protocol-${cond}-${doc}-${clients}.json`, result);
  process.stdout.write(
    `${HOST} ${cond} ${doc} clients=${clients}\n relay ${JSON.stringify(s.relay)}\n saved ${JSON.stringify(s.saved)}\n`,
  );
}
