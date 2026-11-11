/**
 * Starts the PostgreSQL container used by the integration suite and builds the
 * server bundle that the tests run as a child process.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PG, dockerRetry } from './pg';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function docker(args: string[], allowFailure = false): string {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

async function waitForPostgres(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = new pg.Client({ ...PG.admin, connectionTimeoutMillis: 1_000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  // Only ever touches the container with this exact name.
  docker(['rm', '-f', '-v', PG.container], true);
  await dockerRetry(
    () =>
      docker([
        'run',
        '-d',
        '--name',
        PG.container,
        '-e',
        `POSTGRES_USER=${PG.user}`,
        '-e',
        `POSTGRES_PASSWORD=${PG.password}`,
        '-e',
        'POSTGRES_DB=postgres',
        '-p',
        `127.0.0.1:${PG.port}:5432`,
        PG.image,
      ]),
    () => docker(['rm', '-f', '-v', PG.container], true),
  );
  await waitForPostgres(60_000);
  // The image restarts PostgreSQL once after initialisation; make sure it is the final instance.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await waitForPostgres(60_000);

  execFileSync(process.execPath, ['build.mjs'], { cwd: serverRoot, stdio: 'inherit' });

  return async () => {
    docker(['rm', '-f', '-v', PG.container], true);
  };
}
