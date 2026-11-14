/**
 * Load worker process: holds a few hundred simulated users and executes commands from the
 * orchestrator over IPC. All clients of one document live in the same worker, so edit->remote-apply
 * latency uses a single clock.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import * as Y from 'yjs';
import {
  COLLAB_PROTOCOL_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  Y_FRAGMENT_FIELD,
} from '@realtimedocs/contracts';
import { bump, sleep, wallNow } from './common';
import { LoadClient, Shared, type ClientSpec } from './client';
import { noisePng } from './png';

let shared: Shared;
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
let lastCpu = process.cpuUsage();
let lastCpuAt = performance.now();
const uploadCounts: Record<string, Record<string, number>> = {};
const uploadSamples: Record<string, number[]> = {};
let uploading = false;

type Cmd = { id: number; cmd: string; args: any };

function pick(groups?: string[]): LoadClient[] {
  return shared.clients.filter((c) => !groups || groups.includes(c.group));
}

/** Exported so that tests/performance can add commands to the same worker process. */
export const getShared = (): Shared => shared;
export const handlers: Record<string, (args: any) => Promise<unknown> | unknown> = {
  init({ origin }: { origin: string }) {
    shared = new Shared(origin);
    setInterval(() => shared.prune(), 30_000).unref();
    return { pid: process.pid };
  },

  /** Creates clients; each starts its first connection at a random offset inside rampMs. */
  async add({ specs, rampMs, auto }: { specs: ClientSpec[]; rampMs: number; auto: boolean }) {
    const created = specs.map((spec) => {
      const c = new LoadClient(spec, shared);
      shared.clients.push(c);
      return c;
    });
    await Promise.all(
      created.map(async (c) => {
        await sleep(Math.random() * rampMs);
        await c.startAndWaitFirst(auto);
      }),
    );
    const first: Record<string, number> = {};
    for (const c of created) bump(first, c.firstAttemptResult);
    return { first };
  },

  status() {
    let ready = 0;
    let connecting = 0;
    let unacked = 0;
    let acked = 0;
    let edits = 0;
    let access = 0;
    for (const c of shared.clients) {
      if (c.ready) ready += 1;
      else if (!c.destroyed) connecting += 1;
      unacked += c.unacked;
      acked += c.acked.length;
      edits += c.editsMade;
      if (c.accessMessageAt !== null) access += 1;
    }
    return {
      total: shared.clients.length,
      ready,
      notReady: connecting,
      unacked,
      acked,
      edits,
      access,
    };
  },

  typing({ on, rate, groups }: { on: boolean; rate?: number; groups?: string[] }) {
    for (const c of pick(groups)) {
      if (c.spec.group === 'reader') continue;
      if (on) c.startTyping(rate ?? 1);
      else c.stopTyping();
    }
    return pick(groups).length;
  },

  presence({ on, rate, groups }: { on: boolean; rate?: number; groups?: string[] }) {
    for (const c of pick(groups)) {
      if (on) c.startPresence(rate ?? 5);
      else c.stopPresence();
    }
    return pick(groups).length;
  },

  paste({ kind, size, cols, groups, everyMs, durationMs }: any) {
    // Each selected client pastes every `everyMs` (staggered) for `durationMs`; kinds cycle if an array.
    const kinds: { kind: 'text' | 'table'; size: number; cols?: number }[] = Array.isArray(kind)
      ? kind
      : [{ kind, size, cols }];
    const end = Date.now() + durationMs;
    for (const c of pick(groups)) {
      let i = Math.floor(Math.random() * kinds.length);
      const fire = () => {
        if (Date.now() > end || c.destroyed) return;
        const k = kinds[i % kinds.length]!;
        i += 1;
        c.paste(k.kind, k.size, k.cols);
        setTimeout(fire, everyMs);
      };
      setTimeout(fire, Math.random() * everyMs);
    }
    return pick(groups).length;
  },

  async upload({ bytes, groups, durationMs, delayMs, burst, limit }: any) {
    // Closed-loop uploaders (one request in flight per client); `burst` = N back-to-back uploads then stop.
    uploading = true;
    const end = Date.now() + (durationMs ?? 0);
    const clients = pick(groups).slice(0, limit ?? Infinity);
    await Promise.all(
      clients.map(async (c) => {
        let sent = 0;
        while (uploading && !c.destroyed) {
          if (burst ? sent >= burst : Date.now() > end) break;
          const png = noisePng(bytes).bytes;
          const t0 = performance.now();
          let key: string;
          let retryAfter = '';
          try {
            const r = await c.api.upload(c.spec.docId, png, 'load.png', 'image/png');
            key = String(r.status);
            if (r.status === 429)
              retryAfter = r.headers.get('retry-after') ? 'with_retry_after' : 'no_retry_after';
          } catch (e) {
            key = `net_${(e as any)?.cause?.code ?? (e as Error).name}`;
          }
          const ms = performance.now() - t0;
          (uploadCounts[c.group] ??= {})[key] = ((uploadCounts[c.group] ??= {})[key] ?? 0) + 1;
          if (retryAfter) bump((uploadCounts[c.group] ??= {}), `429_${retryAfter}`);
          (uploadSamples[`${c.group}:${key}`] ??= []).push(ms);
          sent += 1;
          if (delayMs) await sleep(delayMs);
        }
      }),
    );
    return { clients: clients.length };
  },
  async ticketProbe({ docKeys }: { docKeys: string[] }) {
    const out: Record<string, number> = {};
    for (const c of shared.clients) {
      if (!docKeys.includes(c.spec.docKey)) continue;
      const r = await c.api
        .request('POST', `/api/documents/${c.spec.docId}/collab-ticket`, {
          clientId: c.doc.clientID,
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          protocolVersion: COLLAB_PROTOCOL_VERSION,
        })
        .catch(() => null);
      bump(out, String(r?.status ?? 'net_error'));
    }
    return out;
  },
  stopUpload() {
    uploading = false;
    return true;
  },

  /** Returns and optionally clears samples, counters and process health. */
  collect({ reset }: { reset?: boolean }) {
    const out = {
      samples: shared.samples,
      counts: shared.counts,
      errors: shared.errors,
      closeCodes: shared.closeCodes,
      uploadCounts,
      uploadSamples,
    };
    const usage = process.cpuUsage();
    const now = performance.now();
    const cpuPct =
      ((usage.user - lastCpu.user + usage.system - lastCpu.system) / 1000 / (now - lastCpuAt)) *
      100;
    lastCpu = usage;
    lastCpuAt = now;
    const health = {
      pid: process.pid,
      cpuPct,
      cpuSecondsTotal: (usage.user + usage.system) / 1e6,
      rssMb: process.memoryUsage().rss / 1048576,
      lagP99Ms: lag.percentile(99) / 1e6,
      lagMaxMs: lag.max / 1e6,
      clients: shared.clients.length,
    };
    const payload = JSON.parse(JSON.stringify({ ...out, health }));
    if (reset) {
      for (const k of Object.keys(shared.samples)) delete shared.samples[k];
      for (const k of Object.keys(shared.counts)) delete shared.counts[k];
      for (const k of Object.keys(shared.errors)) delete shared.errors[k];
      for (const k of Object.keys(shared.closeCodes)) delete shared.closeCodes[k];
      for (const k of Object.keys(uploadCounts)) delete uploadCounts[k];
      for (const k of Object.keys(uploadSamples)) delete uploadSamples[k];
      lag.reset();
    }
    return payload;
  },

  /** Every acknowledged marker per document, and what is still unacknowledged. */
  verify() {
    const docs: Record<string, { acked: string[]; unacked: number }> = {};
    for (const c of shared.clients) {
      const d = (docs[c.spec.docKey] ??= { acked: [], unacked: 0 });
      d.acked.push(...c.acked);
      d.unacked += c.unacked;
    }
    return docs;
  },

  /** Per-client wall-clock times at which an `access` message / close was seen (revocation test). */
  accessTimes() {
    return shared.clients.map((c) => ({
      key: c.spec.key,
      docKey: c.spec.docKey,
      accessAt: c.accessMessageAt,
      closeAt: c.lastCloseAt,
      close: c.lastClose,
      ready: c.ready,
    }));
  },

  /** Seeds a large document: appends batches of paragraphs until the Yjs state reaches targetBytes. */
  async seed({
    spec,
    targetBytes,
    batch,
    chars,
  }: {
    spec: ClientSpec;
    targetBytes: number;
    batch: number;
    chars: number;
  }) {
    const c = new LoadClient({ ...spec, observe: 'none' }, shared);
    shared.clients.push(c);
    await c.startAndWaitFirst(false);
    if (c.firstAttemptResult !== 'ok') return { ok: false, error: c.firstAttemptResult };
    const t0 = wallNow();
    let size = Y.encodeStateAsUpdate(c.doc).length;
    let batches = 0;
    try {
      while (size < targetBytes) {
        c.appendParagraphs(batch, chars);
        batches += 1;
        await c.saved(120_000);
        size = Y.encodeStateAsUpdate(c.doc).length;
        if (!c.ready) throw new Error('connection lost while seeding');
      }
    } catch (e) {
      const close = c.lastClose;
      return {
        ok: false,
        error: (e as Error).message,
        close,
        stateBytes: size,
        batches,
        ms: wallNow() - t0,
      };
    }
    const result = {
      ok: true,
      stateBytes: size,
      batches,
      ms: wallNow() - t0,
      paragraphs: c.fragment.length,
    };
    c.destroy();
    shared.clients.splice(shared.clients.indexOf(c), 1);
    return result;
  },

  /** Fresh read-only-ish connections one after another: sync time of an existing document. */
  async probe({ spec, count }: { spec: ClientSpec; count: number }) {
    const out: { ms: number | null; error?: string; stateBytes?: number; blocks?: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const c = new LoadClient(
        { ...spec, key: `${spec.key}-p${i}`, group: 'reader', observe: 'none' },
        shared,
      );
      const t0 = wallNow();
      await c.startAndWaitFirst(false);
      if (c.firstAttemptResult === 'ok') {
        out.push({
          ms: wallNow() - t0,
          stateBytes: Y.encodeStateAsUpdate(c.doc).length,
          blocks: c.doc.getXmlFragment(Y_FRAGMENT_FIELD).length,
        });
      } else out.push({ ms: null, error: c.firstAttemptResult });
      c.destroy();
      await sleep(500);
    }
    return out;
  },

  stopAll() {
    for (const c of shared.clients) c.destroy();
    shared.clients.length = 0;
    return true;
  },
};

process.on('message', (msg: Cmd) => void handle(msg));
async function handle(msg: Cmd): Promise<void> {
  try {
    const result = await handlers[msg.cmd]!(msg.args);
    process.send?.({ id: msg.id, ok: true, result });
  } catch (e) {
    process.send?.({ id: msg.id, ok: false, error: (e as Error).stack ?? String(e) });
  }
}
process.on('uncaughtException', (e) => {
  process.stderr.write(`[worker ${process.pid}] uncaught: ${e.stack}\n`);
});
process.on('unhandledRejection', (e) => {
  process.stderr.write(`[worker ${process.pid}] unhandled rejection: ${String(e)}\n`);
});
process.send?.({ ready: true });

process.on('disconnect', () => process.exit(0));
