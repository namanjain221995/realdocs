/** Server entry point: HTTP API, collaboration endpoint and the retention timer. */
import { runCleanup } from './cleanup';
import {
  createFoundation,
  ensureSchema,
  loadConfigOrExit,
  loadWorkspace,
  openStorage,
} from './bootstrap';
import { CollabServer } from './collab/server';
import { Cluster, clusterSecret } from './cluster/cluster';
import { TicketStore, type Tickets } from './collab/tickets';
import { Metrics } from './metrics';
import { emitDocumentFirstEdited } from './service/sessions';
import { describeConfig } from './config';
import type { AppContext } from './context';
import { buildApp } from './http/app';
import { WebhookWorker } from './service/webhooks';
import { SERVER_VERSION } from './version';

async function main(): Promise<void> {
  const config = loadConfigOrExit();
  const foundation = createFoundation(config, 'realtimedocs-server');
  const { logger, db } = foundation;
  logger.info(describeConfig(config), 'starting RealtimeDocs server');

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception; exiting');
    process.exit(1);
  });

  if (!config.webDistDir) {
    logger.info('no built web application found (WEB_DIST_DIR): serving the API only');
  }
  if (config.trustProxy === true) {
    logger.warn(
      'TRUST_PROXY=true believes any X-Forwarded-For value a client sends: per-address limits and ' +
        'API-key address restrictions can then be evaded. Set it to the number of proxies in front ' +
        'of the server (1 behind one proxy or tunnel).',
    );
  }
  if (config.nodeEnv === 'production' && !config.cookieSecure) {
    logger.warn('session cookies are not marked Secure: PUBLIC_ORIGIN is not https');
  }

  await ensureSchema(foundation);
  const workspace = await loadWorkspace(db);
  const storage = await openStorage(config);
  const metrics = new Metrics();
  // With REDIS_URL this instance coordinates with others; without it, it runs alone.
  let cluster: Cluster | null = null;
  if (config.cluster.redisUrl) {
    cluster = new Cluster({
      redisUrl: config.cluster.redisUrl,
      internalUrl: config.cluster.internalUrl,
      leaseTtlMs: config.cluster.leaseTtlMs,
      ticketTtlMs: config.collab.ticketTtlMs,
      secret: clusterSecret(config.sessionSecret),
      logger: logger.child({ component: 'cluster' }),
    });
    await cluster.start();
  }
  const tickets: Tickets = cluster ? cluster.tickets : new TicketStore(config.collab.ticketTtlMs);
  const collab = new CollabServer({
    config,
    db,
    logger,
    workspaceId: workspace.id,
    tickets,
    cluster,
    metrics,
    // First edit after a document was loaded: tells an interview session's
    // integration that work has begun. The claim in the database makes the
    // event fire once per session, however many instances or reloads there are.
    onFirstEdit: (documentId) => {
      emitDocumentFirstEdited({ db, workspace }, documentId).catch((err: unknown) =>
        logger.warn({ err, documentId }, 'first-edit event could not be queued'),
      );
    },
  });
  const ctx: AppContext = {
    config,
    db,
    logger,
    workspace,
    storage,
    tickets,
    cluster,
    metrics,
    collab,
    accessDeps: { db, sessionTtl: config.sessions, workspaceId: workspace.id },
    version: SERVER_VERSION,
  };

  metrics.gauge(
    'rd_db_pool_connections',
    'PostgreSQL connections open in the pool.',
    () => db.pool.totalCount,
  );
  metrics.gauge(
    'rd_db_pool_idle',
    'Idle PostgreSQL connections in the pool.',
    () => db.pool.idleCount,
  );
  metrics.gauge(
    'rd_db_pool_waiting',
    'Requests waiting for a PostgreSQL connection (pool saturation).',
    () => db.pool.waitingCount,
  );
  metrics.gauge(
    'rd_db_pool_max',
    'Configured size of the PostgreSQL pool.',
    () => config.db.poolMax,
  );

  const app = await buildApp(ctx);
  collab.attach(app.server);
  await app.listen({ host: config.host, port: config.port });

  const accounts = await db.query<{ count: number }>(
    'SELECT count(*) AS count FROM users WHERE workspace_id = $1',
    [workspace.id],
  );
  if ((accounts.rows[0]?.count ?? 0) === 0) {
    logger.warn(
      'no account exists yet: create the first administrator with `pnpm bootstrap:admin`',
    );
  }

  const webhookWorker = new WebhookWorker({
    db,
    logger,
    config,
    workspaceId: workspace.id,
    onOutcome: (outcome) => metrics.webhookDeliveries.inc({ outcome }),
  });
  webhookWorker.start();

  let cleanupTimer: NodeJS.Timeout | null = null;
  if (config.retention.cleanupIntervalMinutes > 0) {
    const run = () => {
      runCleanup({ db, storage, retention: config.retention, workspaceId: workspace.id, logger })
        .then((report) => logger.info({ report }, 'retention cleanup finished'))
        .catch((err: unknown) => logger.error({ err }, 'retention cleanup failed'));
    };
    cleanupTimer = setInterval(run, config.retention.cleanupIntervalMinutes * 60_000);
    cleanupTimer.unref();
    // First run shortly after start-up, once the service has settled.
    setTimeout(run, 10 * 60_000).unref();
  }

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) {
      logger.warn({ signal }, 'second signal received; exiting immediately');
      process.exit(1);
    }
    stopping = true;
    logger.info({ signal }, 'shutting down');
    const hardStop = setTimeout(() => {
      logger.error('graceful shutdown timed out; exiting');
      process.exit(1);
    }, 15_000 + config.shutdownDrainMs);
    hardStop.unref();
    void (async () => {
      try {
        if (cleanupTimer) clearInterval(cleanupTimer);
        // Readiness answers 503 from now on. Give the load balancer time to stop
        // sending new connections here before the open ones are closed.
        collab.beginDrain();
        if (config.shutdownDrainMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.shutdownDrainMs));
        }
        await webhookWorker.stop();
        // Flushes the durable logs. Correctness never depends on this: anything
        // not acknowledged is still held by the clients and re-sent on reconnect.
        await collab.shutdown();
        await app.close();
        tickets.close();
        // Leases are given back last, when nothing is served here any more.
        await cluster?.stop();
        metrics.close();
        await db.close();
        logger.info('stopped');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      }
    })();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(`RealtimeDocs server failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
