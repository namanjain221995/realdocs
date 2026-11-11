/**
 * Ping-style RTT measurement per network condition. Method: an application-level WebSocket
 * ping frame answered with a pong by the `ws` library on the server (RFC 6455 control frames,
 * handled without touching Hocuspocus), timed with performance.now() on ONE clock, one host.
 * This is a round-trip time measured at the sender, not a one-way delay.
 */
import http from 'node:http';
import WebSocket from 'ws';
import { CONDITIONS, type Condition, HOST, type Stats, sleep, stats } from './common';

export interface PingResult {
  condition: Condition['key'];
  label: string;
  addedRttMs: number;
  method: string;
  rtt: Stats;
  samples: number[];
  /** HTTP request/response on a keep-alive connection (includes server handling). */
  httpRtt: Stats;
}

function openSocket(condition: Condition): Promise<WebSocket> {
  const origin = `http://${HOST}:${CONDITIONS.loopback.port}`;
  const ws = new WebSocket(`ws://${HOST}:${condition.port}/collab`, { origin });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** One ping on an open socket, or null when the server closed the socket meanwhile. */
function pingOnce(ws: WebSocket): Promise<number | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const onPong = () => {
      ws.off('close', onClose);
      resolve(performance.now() - start);
    };
    const onClose = () => {
      ws.off('pong', onPong);
      resolve(null);
    };
    ws.once('pong', onPong);
    ws.once('close', onClose);
    ws.ping();
  });
}

/** HTTP GET /api/health on a warm keep-alive connection (includes about 0.3 ms of server handling). */
async function httpRtt(condition: Condition, count: number): Promise<number[]> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const get = () =>
    new Promise<number>((resolve, reject) => {
      const start = performance.now();
      const req = http.get(
        { host: HOST, port: condition.port, path: '/api/health', agent },
        (res) => {
          res.resume();
          res.on('end', () => resolve(performance.now() - start));
        },
      );
      req.on('error', reject);
    });
  const out: number[] = [];
  for (let i = 0; i < count + 20; i += 1) {
    const v = await get();
    if (i >= 20) out.push(v);
    await sleep(20);
  }
  agent.destroy();
  return out;
}

export async function pingCondition(
  condition: Condition,
  count = 300,
  gapMs = 20,
): Promise<PingResult> {
  const samples: number[] = [];
  let ws = await openSocket(condition);
  let warm = 20;
  while (samples.length < count) {
    const rtt = await pingOnce(ws);
    if (rtt === null) {
      // The server closes a socket that never authenticates after a few control frames: reconnect.
      ws = await openSocket(condition);
      continue;
    }
    if (warm > 0) warm -= 1;
    else samples.push(rtt);
    await sleep(gapMs);
  }
  ws.close();
  const httpStats = await httpRtt(condition, 200);
  return {
    condition: condition.key,
    label: condition.label,
    addedRttMs: condition.addedOneWayMs * 2,
    method: `WebSocket ping/pong to /collab (${count} samples after 20 warm-up, ${gapMs} ms apart, sender-side performance.now())`,
    rtt: stats(samples),
    samples,
    httpRtt: stats(httpStats),
  };
}

export async function pingAll(): Promise<PingResult[]> {
  const out: PingResult[] = [];
  for (const condition of Object.values(CONDITIONS)) out.push(await pingCondition(condition));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const r of await pingAll()) {
    process.stdout.write(
      `${r.condition}: p50 ${r.rtt.p50.toFixed(2)} ms, p95 ${r.rtt.p95.toFixed(2)} ms, p99 ${r.rtt.p99.toFixed(2)} ms, max ${r.rtt.max.toFixed(2)} (n=${r.rtt.n}); http p50 ${r.httpRtt.p50.toFixed(2)} p95 ${r.httpRtt.p95.toFixed(2)}\n`,
    );
  }
}
