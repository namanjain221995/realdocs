/**
 * Plain-SQL migrations: `migrations/NNNN_name.sql`, applied in order, each in
 * its own transaction, serialized across processes by an advisory lock.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import type { Logger } from '../logger';
import { serverResource } from '../util/paths';

/** Arbitrary constant identifying the migration lock ("rdmg"). */
const MIGRATION_LOCK_ID = 0x7264_6d67;

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
}

export function readMigrations(dir: string = serverResource('migrations')): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Migration file name must look like 0001_name.sql: ${file}`);
    }
    const sql = readFileSync(path.join(dir, file), 'utf8');
    migrations.push({
      version: Number(match[1]),
      name: match[2],
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migrations must be numbered without gaps; expected ${index + 1}, found ${migration.version}`,
      );
    }
  });
  return migrations;
}

export async function runMigrations(
  pool: pg.Pool,
  logger: Logger,
  migrations: MigrationFile[] = readMigrations(),
): Promise<MigrationResult> {
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], alreadyApplied: 0 };
  try {
    // DDL may legitimately take longer than the request-oriented timeouts.
    await client.query('SET statement_timeout = 0');
    await client.query('SET lock_timeout = 0');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version     integer PRIMARY KEY,
          name        text NOT NULL,
          checksum    text NOT NULL,
          applied_at  timestamptz NOT NULL DEFAULT now()
        )`);
      const applied = await client.query<{ version: number; name: string; checksum: string }>(
        'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
      );
      const known = new Map(applied.rows.map((row) => [row.version, row]));
      const newest = migrations.at(-1)?.version ?? 0;
      for (const row of applied.rows) {
        if (row.version > newest) {
          throw new Error(
            `The database is at schema version ${row.version}, which is newer than this server (${newest}). Upgrade the server.`,
          );
        }
      }

      for (const migration of migrations) {
        const existing = known.get(migration.version);
        if (existing) {
          if (existing.checksum !== migration.checksum) {
            throw new Error(
              `Migration ${migration.version}_${migration.name} was changed after it was applied. Restore the original file.`,
            );
          }
          result.alreadyApplied += 1;
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [migration.version, migration.name, migration.checksum],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        result.applied.push(`${String(migration.version).padStart(4, '0')}_${migration.name}`);
        logger.info({ migration: migration.name, version: migration.version }, 'applied migration');
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
  } finally {
    // Session settings were changed; do not hand this connection back to the pool.
    client.release(true);
  }
  return result;
}

/** Highest applied schema version, or null when the database has never been migrated. */
export async function currentSchemaVersion(pool: pg.Pool): Promise<number | null> {
  const exists = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present",
  );
  if (!exists.rows[0]?.present) return null;
  const result = await pool.query<{ version: number | null }>(
    'SELECT max(version) AS version FROM schema_migrations',
  );
  return result.rows[0]?.version ?? 0;
}
