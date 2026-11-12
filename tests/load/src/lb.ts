/**
 * Tiny round-robin TCP proxy used as the "load balancer": clients (HTTP and WebSocket) see ONE origin.
 * Round robin per TCP connection; a backend that refuses the connection is skipped.
 * Control server (HTTP, 127.0.0.1): GET /drop destroys every proxied socket, GET /stats.
 * Usage: lb.ts <listenPort> <controlPort> <backendPort,backendPort,...>
 */
import http from 'node:http';
import net from 'node:net';

const [listenArg, controlArg, backendsArg] = process.argv.slice(2);
const listenPort = Number(listenArg);
const controlPort = Number(controlArg);
const backends = (backendsArg ?? '').split(',').map(Number).filter(Boolean);
const pairs = new Set<[net.Socket, net.Socket | null]>();
let next = 0;
let accepted = 0;
let refused = 0;
let dropped = 0;
const perBackend: Record<number, number> = {};

function connectBackend(client: net.Socket, attempt: number): void {
  if (attempt >= backends.length) {
    refused += 1;
    client.destroy();
    return;
  }
  const port = backends[next % backends.length] as number;
  next += 1;
  const upstream = net.connect({ host: '127.0.0.1', port });
  const pair: [net.Socket, net.Socket | null] = [client, upstream];
  let connected = false;
  upstream.setNoDelay(true);
  upstream.once('connect', () => {
    connected = true;
    perBackend[port] = (perBackend[port] ?? 0) + 1;
    pairs.add(pair);
    client.pipe(upstream);
    upstream.pipe(client);
    client.resume();
  });
  upstream.on('error', () => {
    if (!connected) {
      upstream.destroy();
      connectBackend(client, attempt + 1);
    } else client.destroy();
  });
  const done = () => {
    pairs.delete(pair);
    client.destroy();
    upstream.destroy();
  };
  upstream.on('close', done);
  client.on('close', done);
  client.on('error', () => undefined);
}

net
  .createServer({ pauseOnConnect: true }, (client) => {
    accepted += 1;
    client.setNoDelay(true);
    connectBackend(client, 0);
  })
  .listen(listenPort, '127.0.0.1');

http
  .createServer((req, res) => {
    if (req.url === '/drop') {
      const count = pairs.size;
      for (const [c, u] of [...pairs]) {
        c.destroy();
        u?.destroy();
      }
      dropped += count;
      res.end(JSON.stringify({ dropped: count }));
    } else {
      res.end(JSON.stringify({ open: pairs.size, accepted, refused, dropped, perBackend }));
    }
  })
  .listen(controlPort, '127.0.0.1');
