/**
 * Webhooks: endpoints, the delivery queue (a table, claimed with
 * `FOR UPDATE SKIP LOCKED`, so several server instances can share it) and the
 * worker that delivers, retries and gives up.
 *
 * Payloads carry identifiers, names, statuses and timestamps. Never document
 * content, and never an access link or any other secret.
 */
import http from 'node:http';
import https from 'node:https';
import {
  type WebhookDelivery,
  type WebhookDeliveriesPage,
  type WebhookEndpoint,
  type WebhookEndpointWithSecret,
  type WebhookEventPayload,
  type WebhookEventType,
  type CreateWebhookRequest,
  type UpdateWebhookRequest,
} from '@realtimedocs/contracts';
import { writeAudit } from '../audit';
import { newId, randomToken } from '../auth/tokens';
import type { Config } from '../config';
import type { AppContext } from '../context';
import type { Db, Queryable } from '../db/pool';
import { errors } from '../errors';
import type { Logger } from '../logger';
import { auditActorOf, type OperationActor } from './actor';
import { decryptSecret, encryptSecret } from './crypto';
import { decodeCursor, encodeCursor } from './pagination';
import {
  assertPublicHost,
  publicOnlyLookup,
  signWebhook,
  webhookUrlProblem,
} from './webhook-security';

// ── Emitting events ─────────────────────────────────────────────────────────

/**
 * Queues one delivery per enabled endpoint subscribed to `type`. Call inside
 * the transaction that made the change, so an event exists exactly when the
 * change does.
 */
export async function emitWebhookEvent(
  db: Queryable,
  workspaceId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<string> {
  const eventId = newId();
  const payload: WebhookEventPayload = {
    id: eventId,
    type,
    createdAt: new Date().toISOString(),
    data,
  };
  await db.query(
    `INSERT INTO webhook_deliveries (id, workspace_id, endpoint_id, event_id, event_type, payload)
     SELECT gen_random_uuid(), e.workspace_id, e.id, $2::uuid, $3, $4::jsonb
       FROM webhook_endpoints e
      WHERE e.workspace_id = $1 AND e.enabled AND $3 = ANY (e.events)`,
    [workspaceId, eventId, type, JSON.stringify(payload)],
  );
  return eventId;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  createdAt: Date;
  disabledAt: Date | null;
}

const ENDPOINT_COLUMNS = `id, url, secret, events, enabled, created_at AS "createdAt", disabled_at AS "disabledAt"`;

function toEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    events: row.events as WebhookEventType[],
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
  };
}

async function checkUrl(ctx: AppContext, url: string): Promise<void> {
  const production = ctx.config.nodeEnv === 'production';
  const problem =
    webhookUrlProblem(url, production) ?? (production ? await assertPublicHost(url) : null);
  if (problem)
    throw errors.validation('Some fields are not valid.', [{ path: 'url', message: problem }]);
}

export async function listEndpoints(ctx: AppContext): Promise<WebhookEndpoint[]> {
  const result = await ctx.db.query<EndpointRow>(
    `SELECT ${ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE workspace_id = $1 ORDER BY created_at DESC, id`,
    [ctx.workspace.id],
  );
  return result.rows.map(toEndpoint);
}

async function loadEndpoint(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<EndpointRow | null> {
  const result = await db.query<EndpointRow>(
    `SELECT ${ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  return result.rows[0] ?? null;
}

export async function getEndpoint(ctx: AppContext, id: string): Promise<WebhookEndpoint> {
  const row = await loadEndpoint(ctx.db, ctx.workspace.id, id);
  if (!row) throw errors.notFound('That webhook endpoint does not exist.');
  return toEndpoint(row);
}

export async function createEndpoint(
  ctx: AppContext,
  actor: OperationActor,
  input: CreateWebhookRequest,
  requestId: string,
): Promise<WebhookEndpointWithSecret> {
  const body = { enabled: true, ...input };
  await checkUrl(ctx, body.url);
  const id = newId();
  const secret = `whsec_${randomToken()}`;
  const events = [...new Set(body.events)];
  const row = await ctx.db.tx(async (tx) => {
    await tx.query(
      `INSERT INTO webhook_endpoints
         (id, workspace_id, url, secret, events, enabled, created_by_key_id, created_by_user_id, disabled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        ctx.workspace.id,
        body.url,
        encryptSecret(ctx.config.sessionSecret, 'webhook-secret', secret),
        events,
        body.enabled,
        actor.kind === 'service' ? actor.keyId : null,
        actor.kind === 'user' ? actor.userId : null,
        body.enabled ? null : new Date(),
      ],
    );
    await writeAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: auditActorOf(actor),
      action: 'webhook.created',
      targetType: 'webhook',
      targetId: id,
      details: { events: events.join(','), host: new URL(body.url).host },
      requestId,
    });
    return loadEndpoint(tx, ctx.workspace.id, id);
  });
  if (!row) throw new Error('webhook insert returned no row');
  return { endpoint: toEndpoint(row), secret };
}

export async function updateEndpoint(
  ctx: AppContext,
  actor: OperationActor,
  id: string,
  input: UpdateWebhookRequest,
  requestId: string,
): Promise<WebhookEndpoint> {
  if (input.url !== undefined) await checkUrl(ctx, input.url);
  const row = await ctx.db.tx(async (tx) => {
    const current = await loadEndpoint(tx, ctx.workspace.id, id);
    if (!current) throw errors.notFound('That webhook endpoint does not exist.');
    const enabled = input.enabled ?? current.enabled;
    await tx.query(
      `UPDATE webhook_endpoints
          SET url = $3, events = $4, enabled = $5,
              disabled_at = CASE WHEN $5 THEN NULL ELSE COALESCE(disabled_at, now()) END
        WHERE id = $1 AND workspace_id = $2`,
      [
        id,
        ctx.workspace.id,
        input.url ?? current.url,
        input.events ? [...new Set(input.events)] : current.events,
        enabled,
      ],
    );
    await writeAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: auditActorOf(actor),
      action: 'webhook.updated',
      targetType: 'webhook',
      targetId: id,
      details: { urlChanged: input.url !== undefined, enabled },
      requestId,
    });
    return loadEndpoint(tx, ctx.workspace.id, id);
  });
  if (!row) throw errors.notFound();
  return toEndpoint(row);
}

export async function deleteEndpoint(
  ctx: AppContext,
  actor: OperationActor,
  id: string,
  requestId: string,
): Promise<void> {
  await ctx.db.tx(async (tx) => {
    const result = await tx.query(
      'DELETE FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2',
      [id, ctx.workspace.id],
    );
    if (result.rowCount === 0) throw errors.notFound('That webhook endpoint does not exist.');
    await writeAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: auditActorOf(actor),
      action: 'webhook.deleted',
      targetType: 'webhook',
      targetId: id,
      requestId,
    });
  });
}

// ── Deliveries ──────────────────────────────────────────────────────────────

interface DeliveryRow {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  status: WebhookDelivery['status'];
  attempts: number;
  nextAttemptAt: Date;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

const DELIVERY_COLUMNS = `id, endpoint_id AS "endpointId", event_id AS "eventId", event_type AS "eventType",
  status, attempts, next_attempt_at AS "nextAttemptAt", last_status_code AS "lastStatusCode",
  last_error AS "lastError", created_at AS "createdAt", delivered_at AS "deliveredAt"`;

function toDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt:
      row.status === 'pending' || row.status === 'failed' ? row.nextAttemptAt.toISOString() : null,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
  };
}

export async function listDeliveries(
  ctx: AppContext,
  endpointId: string,
  query: { limit: number; cursor?: string; status?: WebhookDelivery['status'] },
): Promise<WebhookDeliveriesPage> {
  await getEndpoint(ctx, endpointId);
  const params: unknown[] = [endpointId, ctx.workspace.id];
  let where = 'endpoint_id = $1 AND workspace_id = $2';
  if (query.status) {
    params.push(query.status);
    where += ` AND status = $${params.length}`;
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    params.push(cursor.at, cursor.id);
    where += ` AND (date_trunc('milliseconds', created_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(query.limit + 1);
  const result = await ctx.db.query<DeliveryRow>(
    `SELECT ${DELIVERY_COLUMNS} FROM webhook_deliveries WHERE ${where}
      ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const more = result.rows.length > query.limit;
  const rows = more ? result.rows.slice(0, query.limit) : result.rows;
  const last = rows[rows.length - 1];
  return {
    items: rows.map(toDelivery),
    nextCursor: more && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function retryDelivery(
  ctx: AppContext,
  actor: OperationActor,
  deliveryId: string,
  requestId: string,
): Promise<WebhookDelivery> {
  const row = await ctx.db.tx(async (tx) => {
    const result = await tx.query<DeliveryRow>(
      `UPDATE webhook_deliveries
          SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
        WHERE id = $1 AND workspace_id = $2 AND status <> 'pending'
        RETURNING ${DELIVERY_COLUMNS}`,
      [deliveryId, ctx.workspace.id],
    );
    const updated = result.rows[0];
    if (!updated) {
      const exists = await tx.query(
        'SELECT 1 FROM webhook_deliveries WHERE id = $1 AND workspace_id = $2',
        [deliveryId, ctx.workspace.id],
      );
      if (exists.rows.length === 0) throw errors.notFound('That delivery does not exist.');
      throw errors.conflict('That delivery is already queued.');
    }
    await writeAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: auditActorOf(actor),
      action: 'webhook.delivery_retried',
      targetType: 'webhook',
      targetId: updated.endpointId,
      details: { deliveryId },
      requestId,
    });
    return updated;
  });
  return toDelivery(row);
}

// ── Worker ──────────────────────────────────────────────────────────────────

interface ClaimedDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  payload: WebhookEventPayload;
  attempts: number;
  url: string;
  secret: string;
}

export interface WebhookWorkerDeps {
  db: Db;
  logger: Logger;
  config: Pick<Config, 'sessionSecret' | 'nodeEnv' | 'webhooks'>;
  workspaceId: string;
  /** For metrics: the result of one delivery attempt. */
  onOutcome?: (outcome: 'delivered' | 'failed' | 'dead') => void;
}

const CLAIM_BATCH = 10;

export class WebhookWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(private readonly deps: WebhookWorkerDeps) {}

  start(): void {
    const { pollMs } = this.deps.config.webhooks;
    if (pollMs <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      this.inFlight = this.tick()
        .then(() => undefined)
        .catch((err: unknown) => this.deps.logger.warn({ err }, 'webhook delivery run failed'));
    }, pollMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  /** Claims and delivers what is due. Exposed so tests and the CLI can run it directly. */
  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      const claimed = await this.claim();
      await Promise.all(claimed.map((delivery) => this.deliver(delivery)));
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<ClaimedDelivery[]> {
    const { db, workspaceId, config } = this.deps;
    // The lease keeps another instance away while this one is delivering; if this process
    // dies mid-attempt the row becomes due again after the lease.
    const leaseSeconds = Math.ceil(config.webhooks.timeoutMs / 1000) + 30;
    const result = await db.query<{
      id: string;
      endpointId: string;
      eventType: string;
      payload: WebhookEventPayload;
      attempts: number;
      url: string;
      secret: string;
    }>(
      `WITH due AS (
         SELECT d.id FROM webhook_deliveries d
           JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.enabled
          WHERE d.workspace_id = $1 AND d.status IN ('pending', 'failed') AND d.next_attempt_at <= now()
          ORDER BY d.next_attempt_at
          LIMIT $2
            FOR UPDATE OF d SKIP LOCKED
       )
       UPDATE webhook_deliveries d
          SET attempts = d.attempts + 1, next_attempt_at = now() + make_interval(secs => $3)
         FROM due, webhook_endpoints e
        WHERE d.id = due.id AND e.id = d.endpoint_id
        RETURNING d.id, d.endpoint_id AS "endpointId", d.event_type AS "eventType", d.payload,
                  d.attempts, e.url, e.secret`,
      [workspaceId, CLAIM_BATCH, leaseSeconds],
    );
    return result.rows;
  }

  private async deliver(delivery: ClaimedDelivery): Promise<void> {
    const { db, logger, config } = this.deps;
    const outcome = await this.post(delivery);
    try {
      if (outcome.ok) {
        await db.query(
          `UPDATE webhook_deliveries
              SET status = 'delivered', delivered_at = now(), last_status_code = $2, last_error = NULL
            WHERE id = $1`,
          [delivery.id, outcome.status],
        );
        this.deps.onOutcome?.('delivered');
        return;
      }
      const schedule = config.webhooks.retryScheduleSeconds;
      const exhausted = delivery.attempts > schedule.length;
      await db.query(
        `UPDATE webhook_deliveries
            SET status = $2, last_status_code = $3, last_error = $4,
                next_attempt_at = now() + make_interval(secs => $5)
          WHERE id = $1`,
        [
          delivery.id,
          exhausted ? 'dead' : 'failed',
          outcome.status,
          outcome.error.slice(0, 300),
          exhausted ? 0 : (schedule[delivery.attempts - 1] ?? 0),
        ],
      );
      this.deps.onOutcome?.(exhausted ? 'dead' : 'failed');
      if (exhausted) {
        logger.warn(
          { deliveryId: delivery.id, endpointId: delivery.endpointId },
          'webhook delivery gave up',
        );
      }
    } catch (err) {
      logger.warn({ err, deliveryId: delivery.id }, 'could not record a webhook delivery result');
    }
  }

  private post(
    delivery: ClaimedDelivery,
  ): Promise<{ ok: true; status: number } | { ok: false; status: number | null; error: string }> {
    const { config } = this.deps;
    const production = config.nodeEnv === 'production';
    let secret: string;
    try {
      secret = decryptSecret(config.sessionSecret, 'webhook-secret', delivery.secret);
    } catch {
      return Promise.resolve({
        ok: false,
        status: null,
        error: 'The endpoint secret cannot be decrypted.',
      });
    }
    const problem = webhookUrlProblem(delivery.url, production);
    if (problem) return Promise.resolve({ ok: false, status: null, error: problem });

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const url = new URL(delivery.url);
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (
        result: { ok: true; status: number } | { ok: false; status: number | null; error: string },
      ) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const request = transport.request(
        url,
        {
          method: 'POST',
          // A redirect is a failure (http.request never follows one); the body is never re-sent.
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(body),
            'user-agent': 'RealtimeDocs-Webhooks/1',
            'rd-webhook-id': delivery.id,
            'rd-webhook-event': delivery.eventType,
            'rd-webhook-timestamp': String(timestamp),
            'rd-webhook-signature': signWebhook(secret, timestamp, body),
          },
          lookup: publicOnlyLookup(production),
          timeout: config.webhooks.timeoutMs,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          response.resume();
          response.on('end', () => {
            if (status >= 200 && status < 300) finish({ ok: true, status });
            else finish({ ok: false, status, error: `The endpoint answered HTTP ${status}.` });
          });
          response.on('error', () =>
            finish({ ok: false, status, error: 'The response was interrupted.' }),
          );
        },
      );
      const hardStop = setTimeout(() => {
        request.destroy(new Error('timeout'));
      }, config.webhooks.timeoutMs + 1_000);
      hardStop.unref();
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(hardStop);
        finish({
          ok: false,
          status: null,
          error:
            err.message === 'timeout'
              ? `No answer within ${Math.round(config.webhooks.timeoutMs / 1000)} seconds.`
              : err.code === 'EBLOCKED'
                ? 'The target resolves to a non-public address.'
                : `The request failed (${err.code ?? 'network error'}).`,
        });
      });
      request.on('close', () => clearTimeout(hardStop));
      request.end(body);
    });
  }
}
