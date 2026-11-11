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
import { TicketStore } from './collab/tickets';
import { describeConfig } from './config';
import type { AppContext } from './context';
import { buildApp } from './http/app';
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
  if (config.nodeEnv === 'production' && !config.cookieSecure) {
    logger.warn('session cookies are not marked Secure: PUBLIC_ORIGIN is not https');
  }

  await ensureSchema(foundation);
  const workspace = await loadWorkspace(db);
  const storage = await openStorage(config);
  const tickets = new TicketStore(config.collab.ticketTtlMs);
  const collab = new CollabServer({ config, db, logger, workspaceId: workspace.id, tickets });
  const ctx: AppContext = {
    config,
    db,
    logger,
    workspace,
    storage,
    tickets,
    collab,
    accessDeps: { db, sessionTtl: config.sessions, workspaceId: workspace.id },
    version: SERVER_VERSION,
  };

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
    }, 15_000);
    hardStop.unref();
    void (async () => {
      try {
        if (cleanupTimer) clearInterval(cleanupTimer);
        // Flushes the durable logs. Correctness never depends on this: anything
        // not acknowledged is still held by the clients and re-sent on reconnect.
        await collab.shutdown();
        await app.close();
        tickets.close();
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
