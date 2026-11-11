/**
 * Userspace delay proxy. Every chunk read from one side is released to the other side after a
 * fixed delay, in order (a FIFO per direction). It delays application data only: the TCP
 * handshake of the client with the proxy is not delayed. It does not model bandwidth, loss or
 * jitter. Labelled everywhere as "emulated with a userspace delay proxy, not a real LAN".
 */
import net from 'node:net';
import { HOST } from './common';

export interface DelayProxyOptions {
  listenPort: number;
  targetPort: number;
  /** Added delay per direction, ms. */
  oneWayMs: number;
}

function pipeDelayed(from: net.Socket, to: net.Socket, delayMs: number): void {
  const queue: { due: number; chunk: Buffer }[] = [];
  let timer: NodeJS.Timeout | null = null;
  let ended = false;
  const flush = () => {
    timer = null;
    const now = performance.now();
    while (queue.length && (queue[0] as { due: number }).due <= now + 0.05) {
      const item = queue.shift() as { chunk: Buffer };
      if (!to.destroyed) to.write(item.chunk);
    }
    if (queue.length) {
      timer = setTimeout(flush, Math.max(0, (queue[0] as { due: number }).due - performance.now()));
    } else if (ended && !to.destroyed) {
      to.end();
    }
  };
  from.on('data', (chunk: Buffer) => {
    queue.push({ due: performance.now() + delayMs, chunk });
    if (!timer) timer = setTimeout(flush, delayMs);
  });
  from.on('end', () => {
    ended = true;
    if (!timer) flush();
  });
}

export function startDelayProxy(options: DelayProxyOptions): net.Server {
  const server = net.createServer({ noDelay: true }, (client) => {
    const upstream = net.connect({ host: HOST, port: options.targetPort, noDelay: true });
    client.setNoDelay(true);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
    if (options.oneWayMs > 0) {
      pipeDelayed(client, upstream, options.oneWayMs);
      pipeDelayed(upstream, client, options.oneWayMs);
    } else {
      client.pipe(upstream);
      upstream.pipe(client);
    }
  });
  server.listen(options.listenPort, HOST);
  return server;
}

/**
 * A pass-through proxy that can be cut and restored: `cut()` closes the listener and destroys every
 * open socket (the browser sees a connection reset and refused connections), `restore()` listens again.
 */
export class ControlledProxy {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();

  constructor(
    private readonly listenPort: number,
    private readonly targetPort: number,
  ) {}

  async start(): Promise<void> {
    const server = net.createServer({ noDelay: true }, (client) => {
      const upstream = net.connect({ host: HOST, port: this.targetPort, noDelay: true });
      this.sockets.add(client);
      this.sockets.add(upstream);
      const close = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on('error', close);
      upstream.on('error', close);
      client.on('close', close);
      upstream.on('close', close);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.listenPort, HOST, () => resolve());
    });
    this.server = server;
  }

  async cut(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  async stop(): Promise<void> {
    await this.cut();
  }
}
