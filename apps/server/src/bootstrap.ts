/** Shared start-up steps of the server process and the CLI commands. */
import { LocalDiskStorage, type AssetStorage } from './assets/storage';
import { ConfigError, loadConfig, type Config } from './config';
import { loadWorkspace, type Workspace } from './context';
import { currentSchemaVersion, readMigrations, runMigrations } from './db/migrate';
import { createDb, isDbUnavailable, type Db } from './db/pool';
import type { DestinationStream } from 'pino';
import { createLogger, type Logger } from './logger';
import { loadEnvFile } from './util/paths';

export interface Foundation {
  config: Config;
  logger: Logger;
  db: Db;
}

/** Reads `.env` (if present) and the environment; exits with a clear message on bad config. */
export function loadConfigOrExit(): Config {
  try {
    loadEnvFile();
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`Could not load the configuration: ${(error as Error).message}\n`);
    }
    process.exit(78);
  }
}

export function createFoundation(
  config: Config,
  applicationName: string,
  /** Where log lines go; the CLI keeps stdout for its own output. */
  logDestination?: DestinationStream,
): Foundation {
  const logger = createLogger(config.logLevel, logDestination);
  return { config, logger, db: createDb(config, logger, applicationName) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Brings the schema up to date (or verifies it when AUTO_MIGRATE is off).
 * Waits a little for a database that is still starting.
 */
export async function ensureSchema(
  { config, db, logger }: Foundation,
  options: { forceMigrate?: boolean; waitMs?: number } = {},
): Promise<string[]> {
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  for (;;) {
    try {
      if (config.autoMigrate || options.forceMigrate) {
        return (await runMigrations(db.pool, logger)).applied;
      }
      const expected = readMigrations().length;
      const current = await currentSchemaVersion(db.pool);
      if (current !== expected) {
        throw new Error(
          current === null
            ? 'The database has not been migrated. Run `pnpm db:migrate` or set AUTO_MIGRATE=true.'
            : `The database is at schema version ${current} but this server needs ${expected}. Run \`pnpm db:migrate\`.`,
        );
      }
      return [];
    } catch (error) {
      if (!isDbUnavailable(error) || Date.now() >= deadline) throw error;
      logger.warn('the database is not reachable yet; retrying');
      await sleep(1_000);
    }
  }
}

export async function openStorage(config: Config): Promise<AssetStorage> {
  const storage = new LocalDiskStorage(config.assetDir);
  try {
    await storage.init();
  } catch (error) {
    throw new Error(`ASSET_DIR (${config.assetDir}) is not writable: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return storage;
}

export { loadWorkspace, type Workspace };
