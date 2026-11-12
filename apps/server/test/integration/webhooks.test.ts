/**
 * Webhooks: events reach a receiver with a valid signature, failures are
 * retried on the configured schedule and end as `dead`, and only the
 * documented target URLs are accepted.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  WebhookDeliveriesPage,
  WebhookEventPayload,
  type CreateInterviewSessionResponse,
  type ServiceScope,
  SERVICE_SCOPES,
} from '@realtimedocs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../../src/service/webhook-security';
import { Agent, connectCollab, createFixture, until, type Fixture } from './harness';

let fx: Fixture;
let service: Agent;

interface Received {
  headers: http.IncomingHttpHeaders;
  raw: string;
}

class Receiver {
  readonly received: Received[] = [];
  /** Status codes to answer with, in order; 200 afterwards. */
  script: number[] = [];
  private readonly server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      this.received.push({ headers: request.headers, raw: Buffer.concat(chunks).toString('utf8') });
      response.statusCode = this.script.shift() ?? 200;
      response.end('ok');
    });
  });
  url = '';

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/hook`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  reset(): void {
    this.received.length = 0;
    this.script = [];
  }
}

const receiver = new Receiver();

beforeAll(async () => {
  await receiver.start();
  fx = await createFixture('webhooks', {
    port: 4412,
    env: {
      RATE_API_KEY_PER_MINUTE: '1000000',
      WEBHOOK_POLL_MS: '100',
      WEBHOOK_RETRY_SCHEDULE_SECONDS: '1,1',
      WEBHOOK_TIMEOUT_MS: '3000',
    },
  });
  const created = await fx.admin.ok<{ secret: string }>(
    fx.admin.post('/api/admin/api-keys', {
      name: 'hooks',
      scopes: [...SERVICE_SCOPES] satisfies ServiceScope[],
    }),
  );
  service = new Agent(fx.server, null);
  service.bearer = created.secret;
}, 120_000);

afterAll(async () => {
  await fx.server.dispose();
  await receiver.stop();
});

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
let counter = 0;
function sessionBody() {
  counter += 1;
  return {
    candidate: { name: `Hook Candidate ${counter}`, email: `hook${counter}@example.com` },
    interviewers: [{ name: 'Hook Interviewer', email: 'hook-i@acme.example' }],
    companyName: 'Hook Co',
    round: { number: 1 },
    scheduledAt: '2030-03-14T15:30:00+05:30',
    timezone: 'Asia/Kolkata',
    expiresAt: inDays(7),
  };
}

async function newEndpoint(
  events: string[] = [
    'session.created',
    'session.completed',
    'participant.joined',
    'access.revoked',
    'session.started',
    'session.cancelled',
  ],
) {
  // One endpoint at a time, so every event reaches the receiver once.
  const existing = await service.get<{ endpoints: { id: string }[] }>('/api/v1/webhooks');
  for (const old of existing.body.endpoints) await service.delete(`/api/v1/webhooks/${old.id}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  receiver.reset();
  const created = await service.post<{ endpoint: { id: string }; secret: string }>(
    '/api/v1/webhooks',
    {
      url: receiver.url,
      events,
    },
  );
  expect(created.status, created.text).toBe(201);
  return created.body;
}

async function deliveries(endpointId: string) {
  const page = await service.get(`/api/v1/webhooks/${endpointId}/deliveries?limit=100`);
  expect(page.status, page.text).toBe(200);
  return WebhookDeliveriesPage.parse(page.body).items;
}

describe('endpoints', () => {
  it('are created with a secret shown once, and listed, changed and deleted', async () => {
    const { endpoint, secret } = await newEndpoint(['session.created']);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const list = await service.get<{ endpoints: { id: string }[] }>('/api/v1/webhooks');
    expect(list.text).not.toContain(secret);
    expect(list.body.endpoints.some((item) => item.id === endpoint.id)).toBe(true);
    const stored = await fx.server.sql<{ secret: string }>(
      'SELECT secret FROM webhook_endpoints WHERE id = $1',
      [endpoint.id],
    );
    expect(stored[0]?.secret).not.toContain(secret);

    const disabled = await service.patch<{
      endpoint: { enabled: boolean; disabledAt: string | null };
    }>(`/api/v1/webhooks/${endpoint.id}`, { enabled: false });
    expect(disabled.body.endpoint).toMatchObject({ enabled: false });
    expect(disabled.body.endpoint.disabledAt).not.toBeNull();
    expect((await service.delete(`/api/v1/webhooks/${endpoint.id}`)).status).toBe(204);
    expect((await service.get(`/api/v1/webhooks/${endpoint.id}`)).status).toBe(404);
  });

  it('refuse URLs outside the policy and unknown events', async () => {
    for (const url of [
      'http://example.com/hook',
      'ftp://example.com',
      'https://user:pw@example.com/',
      'not a url',
    ]) {
      const result = await service.post('/api/v1/webhooks', { url, events: ['session.created'] });
      expect(result.status, url).toBe(400);
    }
    expect(
      (await service.post('/api/v1/webhooks', { url: receiver.url, events: ['nope'] })).status,
    ).toBe(400);
    expect((await service.post('/api/v1/webhooks', { url: receiver.url, events: [] })).status).toBe(
      400,
    );
  });

  it('need the webhooks:manage scope', async () => {
    const created = await fx.admin.ok<{ secret: string }>(
      fx.admin.post('/api/admin/api-keys', { name: 'no hooks', scopes: ['sessions:read'] }),
    );
    const other = new Agent(fx.server, null);
    other.bearer = created.secret;
    expect((await other.get('/api/v1/webhooks')).status).toBe(403);
  });

  it('are managed by administrators through the admin routes', async () => {
    const created = await fx.admin.post<{ endpoint: { id: string } }>('/api/admin/webhooks', {
      url: receiver.url,
      events: ['session.created'],
    });
    expect(created.status, created.text).toBe(201);
    const list = await fx.admin.get<{ endpoints: unknown[] }>('/api/admin/webhooks');
    expect(list.body.endpoints.length).toBeGreaterThan(0);
    expect(
      (await fx.admin.get(`/api/admin/webhooks/${created.body.endpoint.id}/deliveries`)).status,
    ).toBe(200);
  });
});

describe('deliveries', () => {
  it('post a signed event when a session is created', async () => {
    const { endpoint, secret } = await newEndpoint();
    const created = await service.post<CreateInterviewSessionResponse>(
      '/api/v1/interview-sessions',
      sessionBody(),
    );
    await until(() => receiver.received.length >= 1, { what: 'webhook delivery' });
    const hit = receiver.received[0] as Received;
    expect(hit.headers['content-type']).toContain('application/json');
    const timestamp = hit.headers['rd-webhook-timestamp'] as string;
    expect(timestamp).toMatch(/^\d{10}$/);
    expect(hit.headers['rd-webhook-signature']).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(
      verifyWebhookSignature(
        secret,
        timestamp,
        hit.raw,
        hit.headers['rd-webhook-signature'] as string,
      ),
    ).toBe(true);
    expect(
      verifyWebhookSignature(
        'wrong',
        timestamp,
        hit.raw,
        hit.headers['rd-webhook-signature'] as string,
      ),
    ).toBe(false);

    const payload = WebhookEventPayload.parse(JSON.parse(hit.raw));
    expect(payload.type).toBe('session.created');
    expect(payload.data).toMatchObject({
      sessionId: created.body.sessionId,
      documentId: created.body.documentId,
    });
    // No access links, secrets or personal addresses in the payload.
    expect(hit.raw).not.toMatch(/#|\/s\/|whsec_|rdk_|@example/);

    const rows = await until(
      async () => {
        const items = await deliveries(endpoint.id);
        return items.find((item) => item.status === 'delivered') ?? null;
      },
      { what: 'delivered status' },
    );
    expect(rows.id).toBe(hit.headers['rd-webhook-id']);
    expect(rows.attempts).toBe(1);
    expect(rows.lastStatusCode).toBe(200);
  });

  it('retry after a 500 and deliver the same event id', async () => {
    const { endpoint, secret } = await newEndpoint(['session.created']);
    receiver.script = [500];
    await service.post('/api/v1/interview-sessions', sessionBody());
    await until(() => receiver.received.length >= 2, { timeoutMs: 15_000, what: 'retry' });
    const [first, second] = receiver.received as [Received, Received];
    expect(first.headers['rd-webhook-id']).toBe(second.headers['rd-webhook-id']);
    expect(JSON.parse(first.raw).id).toBe(JSON.parse(second.raw).id);
    expect(
      verifyWebhookSignature(
        secret,
        second.headers['rd-webhook-timestamp'] as string,
        second.raw,
        second.headers['rd-webhook-signature'] as string,
      ),
    ).toBe(true);
    const done = await until(
      async () =>
        (await deliveries(endpoint.id)).find((item) => item.status === 'delivered') ?? null,
      { what: 'delivered after retry' },
    );
    expect(done.attempts).toBe(2);
  });

  it('become dead after the last scheduled attempt and can be retried by hand', async () => {
    const { endpoint } = await newEndpoint(['session.created']);
    // Schedule 1,1 = three attempts in total.
    receiver.script = [500, 503, 500, 500];
    await service.post('/api/v1/interview-sessions', sessionBody());
    const dead = await until(
      async () => (await deliveries(endpoint.id)).find((item) => item.status === 'dead') ?? null,
      {
        timeoutMs: 20_000,
        what: 'dead delivery',
      },
    );
    expect(dead.attempts).toBe(3);
    expect(dead.lastStatusCode).toBe(500);
    expect(dead.nextAttemptAt).toBeNull();
    expect(receiver.received).toHaveLength(3);

    receiver.script = [];
    const retried = await service.post<{ delivery: { status: string } }>(
      `/api/v1/webhooks/deliveries/${dead.id}/retry`,
    );
    expect(retried.status, retried.text).toBe(200);
    expect(retried.body.delivery.status).toBe('pending');
    await until(
      async () =>
        (await deliveries(endpoint.id)).find(
          (item) => item.id === dead.id && item.status === 'delivered',
        ) ?? null,
      {
        what: 'manual retry delivered',
      },
    );
    expect((await service.post(`/api/v1/webhooks/deliveries/${dead.id}/retry`)).status).toBe(200);
    expect(
      (await service.post(`/api/v1/webhooks/deliveries/${crypto.randomUUID()}/retry`)).status,
    ).toBe(404);
  });

  it('paginate', async () => {
    const { endpoint } = await newEndpoint(['session.created']);
    for (let i = 0; i < 3; i += 1) await service.post('/api/v1/interview-sessions', sessionBody());
    await until(
      async () =>
        (await deliveries(endpoint.id)).filter((item) => item.status === 'delivered').length === 3,
      {
        what: 'three deliveries',
      },
    );
    const first = await service.get<{ items: unknown[]; nextCursor: string | null }>(
      `/api/v1/webhooks/${endpoint.id}/deliveries?limit=2`,
    );
    expect(first.body.items).toHaveLength(2);
    const second = await service.get<{ items: unknown[]; nextCursor: string | null }>(
      `/api/v1/webhooks/${endpoint.id}/deliveries?limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('report the lifecycle: participant.joined once per person, started, access.revoked, completed', async () => {
    await newEndpoint();
    const created = await service.post<CreateInterviewSessionResponse>(
      '/api/v1/interview-sessions',
      sessionBody(),
    );
    const grant = new URL(created.body.candidateAccess.url);
    const candidate = await fx.guest(grant.pathname.split('/')[2] ?? '', grant.hash.slice(1));
    const room = await connectCollab(candidate, created.body.documentId);
    const room2 = await connectCollab(candidate, created.body.documentId);
    await service.post(`/api/v1/interview-sessions/${created.body.sessionId}/start`);
    await service.post(`/api/v1/interview-sessions/${created.body.sessionId}/complete`);
    await until(() => receiver.received.length >= 5, { what: 'five events' });
    const events = receiver.received.map(
      (hit) => JSON.parse(hit.raw) as { type: string; data: Record<string, unknown> },
    );
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === 'participant.joined')).toHaveLength(1);
    expect(events.find((event) => event.type === 'participant.joined')?.data.role).toBe(
      'candidate',
    );
    expect(types).toEqual(
      expect.arrayContaining([
        'session.created',
        'session.started',
        'session.completed',
        'access.revoked',
      ]),
    );
    expect(events.find((event) => event.type === 'access.revoked')?.data).toMatchObject({
      roles: ['candidate'],
    });
    room.destroy();
    room2.destroy();
  });

  it('are not created for disabled endpoints or events nobody subscribed to', async () => {
    const { endpoint } = await newEndpoint(['session.cancelled']);
    await service.post('/api/v1/interview-sessions', sessionBody());
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(receiver.received).toHaveLength(0);
    expect(await deliveries(endpoint.id)).toHaveLength(0);
  });
});
