/**
 * PostgreSQL access. One pool per process; statement, lock and connection
 * timeouts make a stalled database fail fast instead of hanging requests.
 */
import pg from 'pg';
import type { Config } from '../config';
import type { Logger } from '../logger';

// int8 (bigint) columns in this schema are sequence numbers and byte counts
// far below 2^53, and count(*) results; parse them as numbers.
pg.types.setTypeParser(20, (value) => Number(value));

export type QueryParams = readonly unknown[];

/** Minimal query interface shared by the pool and a transaction client. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: QueryParams,
  ): Promise<pg.QueryResult<R>>;
}

export interface Db extends Queryable {
  readonly pool: pg.Pool;
  /** Runs `fn` in one transaction. Rolls back when `fn` throws. */
  tx<T>(fn: (client: Queryable) => Promise<T>, options?: TxOptions): Promise<T>;
  /** True when a trivial query succeeds within `timeoutMs`. */
  ping(timeoutMs?: number): Promise<boolean>;
  close(): Promise<void>;
}

export interface TxOptions {
  isolation?: 'read committed' | 'repeatable read' | 'serializable';
  readOnly?: boolean;
}

export type DbSettings = Pick<Config, 'databaseUrl'> & { db: Config['db'] };

export function createDb(
  settings: DbSettings,
  logger: Logger,
  applicationName = 'realtimedocs',
): Db {
  const pool = new pg.Pool({
    connectionString: settings.databaseUrl,
    max: settings.db.poolMax,
    application_name: applicationName,
    connectionTimeoutMillis: settings.db.connectTimeoutMs,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    statement_timeout: settings.db.statementTimeoutMs,
    lock_timeout: settings.db.lockTimeoutMs,
    // Client-side guard for a server that stops answering at all.
    query_timeout: settings.db.statementTimeoutMs + 5_000,
    idle_in_transaction_session_timeout: 60_000,
  });

  // Idle clients emit 'error' when the server goes away; without a listener
  // that would crash the process. The pool discards the broken client itself.
  pool.on('error', (err) => {
    logger.warn({ err }, 'idle database connection failed');
  });

  const query: Queryable['query'] = (text, params) =>
    pool.query(text, params === undefined ? undefined : [...params]);

  async function tx<T>(fn: (client: Queryable) => Promise<T>, options: TxOptions = {}): Promise<T> {
    const client = await pool.connect();
    let broken: unknown;
    try {
      const mode = [
        options.isolation ? `ISOLATION LEVEL ${options.isolation.toUpperCase()}` : '',
        options.readOnly ? 'READ ONLY' : '',
      ]
        .filter(Boolean)
        .join(' ');
      await client.query(mode ? `BEGIN ${mode}` : 'BEGIN');
      const wrapped: Queryable = {
        query: (text, params) => client.query(text, params === undefined ? undefined : [...params]),
      };
      const result = await fn(wrapped);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // The connection is unusable; make the pool drop it.
        broken = rollbackError;
      }
      throw error;
    } finally {
      client.release(broken instanceof Error ? broken : undefined);
    }
  }

  async function ping(timeoutMs = 2_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('database ping timed out')), timeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    pool,
    query,
    tx,
    ping,
    close: () => pool.end(),
  };
}

const UNAVAILABLE_SQLSTATES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '57014', // query_canceled (statement timeout)
  '55P03', // lock_not_available
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '25P03', // idle_in_transaction_session_timeout
]);

const UNAVAILABLE_NODE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** True for errors that mean "the database cannot be reached or is not answering". */
export function isDbUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === 'string') {
    if (UNAVAILABLE_SQLSTATES.has(code) || code.startsWith('08')) return true;
    if (UNAVAILABLE_NODE_CODES.has(code)) return true;
  }
  if (error instanceof AggregateError) return error.errors.some((inner) => isDbUnavailable(inner));
  return /Connection terminated|timeout exceeded when trying to connect|Query read timeout|connection timeout|Client has encountered a connection error|the database system is (starting up|shutting down)/i.test(
    error.message,
  );
}

/** SQLSTATE of a PostgreSQL error, if it is one. */
export function sqlState(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}
