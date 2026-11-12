/**
 * Two server instances, one PostgreSQL, one Redis (docs/scaling.md).
 *
 * Everything here runs against real processes: instance A on 4410, instance B
 * on 4411, a throw-away Redis container. It shows that a document has one
 * owner whichever instance a client reaches, that tickets, revocation and
 * rate limits work across instances, and that acknowledged edits survive the
 * loss of the owning instance and of Redis.
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  Agent,
  TestServer,
  connectCollab,
  createFixture,
  openCollab,
  requestTicket,
  sleep,
  until,
  type Fixture,
} from './harness';
import { dockerRetry } from './pg';

const REDIS = { container: 'rd-srv-redis-test', image: 'redis:8.8.3', port: 16410 };
const METRICS_TOKEN = 'metrics-token-for-integration-tests';

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let fx: Fixture;
let a: TestServer;
let b: TestServer;
let adminB: Agent;

const env = (port: number): Record<string, string> => ({
  REDIS_URL: `redis://127.0.0.1:${REDIS.port}`,
  CLUSTER_INTERNAL_URL: `http://127.0.0.1:${port}`,
  // Long on purpose: a graceful stop must hand documents over at once, not after the lease runs out.
  CLUSTER_LEASE_TTL_SECONDS: '30',
  // Both instances are one site in production; here they have two local addresses.
  ALLOWED_ORIGINS: 'http://127.0.0.1:4410,http://127.0.0.1:4411',
  METRICS_TOKEN,
  // Long, so that a revocation seen quickly was delivered, not swept.
  COLLAB_SWEEP_INTERVAL_SECONDS: '600',
});

async function metric(server: TestServer, name: string): Promise<number> {
  const response = await fetch(`${server.origin}/metrics`, {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  const line = text.split('\n').find((row) => row.startsWith(`${name} `));
  return line ? Number(line.split(' ')[1]) : Number.NaN;
}

beforeAll(async () => {
  try {
    docker('rm', '-f', '-v', REDIS.container);
  } catch {
    // Not there: fine.
  }
  await dockerRetry(() =>
    docker(
      'run',
      '-d',
      '--name',
      REDIS.container,
      '-p',
      `127.0.0.1:${REDIS.port}:6379`,
      REDIS.image,
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
    ),
  );
  await until(
    () => {
      try {
        return docker('exec', REDIS.container, 'redis-cli', 'ping').trim() === 'PONG';
      } catch {
        return false;
      }
    },
    { timeoutMs: 30_000, intervalMs: 200 },
  );
  fx = await createFixture('cluster', { port: 4410, env: env(4410) });
  a = fx.server;
  b = await TestServer.create('cluster-b', {
    port: 4411,
    database: a.database,
    assetDir: a.assetDir,
    env: env(4411),
  });
  await b.start();
  adminB = new Agent(b);
  expect((await adminB.login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
}, 180_000);

afterAll(async () => {
  await b?.dispose();
  await fx?.server.dispose();
  try {
    docker('rm', '-f', '-v', REDIS.container);
  } catch {
    // Already gone.
  }
});

describe('one document, two instances', () => {
  it('editors on different instances are in the same room', async () => {
    const documentId = await fx.createDocument('Shared across instances');
    const onA = await connectCollab(fx.admin, documentId);
    const onB = await connectCollab(adminB, documentId);

    onA.appendParagraph('typed through instance A');
    await onA.save();
    await until(() => onB.text().includes('typed through instance A'));
    onB.appendParagraph('typed through instance B');
    await onB.save();
    await until(() => onA.text().includes('typed through instance B'));

    // One instance holds the document; the other only passes its socket on.
    const loaded = [await metric(a, 'rd_documents_loaded'), await metric(b, 'rd_documents_loaded')];
    const forwarded = [
      await metric(a, 'rd_ws_forwarded_connections'),
      await metric(b, 'rd_ws_forwarded_connections'),
    ];
    expect(loaded.sort()).toEqual([0, 1]);
    expect(forwarded.sort()).toEqual([0, 1]);

    // Both changes are durable, in order, attributed, written by one writer.
    const rows = await a.sql<{ op: string }>(
      `SELECT operation_type AS op FROM doc_history
        WHERE document_id = $1 AND kind = 'update' ORDER BY hseq`,
      [documentId],
    );
    expect(rows).toHaveLength(2);
    onA.destroy();
    onB.destroy();
  });

  it('a ticket issued by one instance is redeemed once, by the other', async () => {
    const documentId = await fx.createDocument('Tickets');
    const first = await connectCollab(fx.admin, documentId);
    const ticket = await requestTicket(fx.admin, documentId, 4242);
    expect(ticket.status).toBe(200);
    const viaB = await openCollab(adminB, documentId, { ticket: ticket.body, wsUrl: b.wsUrl });
    await viaB.synced();
    // The same ticket again, on either instance: refused.
    const again = await openCollab(fx.admin, documentId, { ticket: ticket.body });
    await until(() => again.authFailures.length > 0 || again.closes.length > 0);
    expect(again.isSynced).toBe(false);
    for (const client of [first, viaB, again]) client.destroy();
  });

  it('a revocation on one instance closes a socket that entered through the other', async () => {
    const documentId = await fx.createDocument('Revocation');
    const share = await fx.createShare(documentId, { role: 'editor' });
    // The owner of the document is A (first connection through A).
    const owner = await connectCollab(fx.admin, documentId);
    const guest = new Agent(b);
    expect(
      (await guest.post('/api/share/exchange', { grantId: share.id, secret: share.secret })).status,
    ).toBe(200);
    const guestSocket = await connectCollab(guest, documentId);
    guestSocket.appendParagraph('from the guest');
    await guestSocket.save();

    // Revoked through instance B's API; the socket is served by A.
    const revoked = await adminB.post(`/api/documents/${documentId}/shares/${share.id}/revoke`);
    expect(revoked.status).toBeLessThan(300);
    const closed = await guestSocket.closed(5_000);
    expect(closed.code).toBeGreaterThanOrEqual(4000);
    expect((await guest.get(`/api/documents/${documentId}`)).status).toBeGreaterThanOrEqual(400);
    owner.destroy();
    guestSocket.destroy();
  });

  it('counts a rate limit once for both instances', async () => {
    const email = 'nobody@example.test';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const agent = new Agent(attempt % 2 === 0 ? a : b);
      statuses.push((await agent.login(email, 'wrong-password-123')).status);
    }
    // Default: 8 attempts per address in 15 minutes, wherever they arrive.
    expect(statuses.slice(0, 8).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
  });
});

describe('failures', () => {
  it('acknowledged edits survive the loss of the owning instance', async () => {
    const documentId = await fx.createDocument('Failover');
    const onB = await connectCollab(adminB, documentId);
    expect(await metric(b, 'rd_documents_loaded')).toBeGreaterThanOrEqual(1);
    const viaA = await connectCollab(fx.admin, documentId);
    viaA.appendParagraph('acknowledged before the owner went away');
    await viaA.save();

    // The owner (B) stops as in a rolling restart.
    await b.stop();
    await viaA.closed(10_000);
    onB.destroy();
    viaA.destroy();

    // A takes the document over and has everything that was acknowledged.
    const stoppedAt = Date.now();
    const afterwards = await until(
      async () => {
        try {
          return await connectCollab(fx.admin, documentId);
        } catch {
          return null;
        }
      },
      { timeoutMs: 20_000, intervalMs: 250 },
    );
    // The stopped instance gave its leases back: no waiting for them to expire.
    expect(Date.now() - stoppedAt).toBeLessThan(3_000);
    expect(afterwards.text()).toContain('acknowledged before the owner went away');
    afterwards.appendParagraph('written after the failover');
    await afterwards.save();
    afterwards.destroy();

    await b.start();
    const back = await connectCollab(adminB, documentId);
    expect(back.text()).toContain('written after the failover');
    back.destroy();
  }, 90_000);

  it('hands many documents over quickly when their owner stops while clients are connected', async () => {
    // Twenty documents owned by B, each with one editor that entered through A
    // (forwarded) and one that entered through B.
    const documents: string[] = [];
    const clients = [];
    for (let index = 0; index < 20; index += 1) {
      const documentId = await fx.createDocument(`Handover ${index}`);
      documents.push(documentId);
      clients.push(await connectCollab(adminB, documentId));
      const viaA = await connectCollab(fx.admin, documentId);
      viaA.appendParagraph(`acknowledged ${index}`);
      await viaA.save();
      clients.push(viaA);
    }
    expect(await metric(b, 'rd_documents_loaded')).toBeGreaterThanOrEqual(20);

    const stopping = b.stop();
    const started = Date.now();
    // Every editor reconnects through A as soon as it can, without waiting for B to exit.
    const times = await Promise.all(
      documents.map(async (documentId, index) => {
        for (;;) {
          try {
            const client = await connectCollab(fx.admin, documentId);
            const elapsed = Date.now() - started;
            expect(client.text()).toContain(`acknowledged ${index}`);
            client.destroy();
            return elapsed;
          } catch {
            if (Date.now() - started > 25_000) throw new Error(`document ${index} never came back`);
            await sleep(100);
          }
        }
      }),
    );
    await stopping;
    for (const client of clients) client.destroy();
    // Far below the 30 s lease: the leases were given back, not left to run out.
    expect(Math.max(...times)).toBeLessThan(5_000);
    await b.start();
  }, 120_000);

  it('keeps saving while Redis is away and says "not ready"; recovers when it returns', async () => {
    const documentId = await fx.createDocument('Redis outage');
    const client = await connectCollab(fx.admin, documentId);
    client.appendParagraph('before the outage');
    await client.save();

    docker('stop', REDIS.container);
    try {
      await until(async () => (await fetch(`${a.origin}/api/ready`)).status === 503, {
        timeoutMs: 15_000,
        intervalMs: 250,
      });
      // The open document does not depend on Redis: edits are still committed.
      client.appendParagraph('during the outage');
      await client.save();
      // The process itself stays alive.
      expect((await fetch(`${a.origin}/api/health`)).status).toBe(200);
    } finally {
      await dockerRetry(() => docker('start', REDIS.container));
    }
    await until(async () => (await fetch(`${a.origin}/api/ready`)).status === 200, {
      timeoutMs: 30_000,
      intervalMs: 250,
    });
    client.appendParagraph('after the outage');
    await client.save();
    client.destroy();
    await sleep(100);
    const fresh = await until(
      async () => {
        try {
          return await connectCollab(adminB, documentId);
        } catch {
          return null;
        }
      },
      { timeoutMs: 20_000, intervalMs: 250 },
    );
    expect(fresh.text()).toContain('during the outage');
    expect(fresh.text()).toContain('after the outage');
    fresh.destroy();
  }, 120_000);
});
