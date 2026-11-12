import type { AccessDeps } from './access/resolve';
import type { AssetStorage } from './assets/storage';
import type { CollabServer } from './collab/server';
import type { Tickets } from './collab/tickets';
import type { Cluster } from './cluster/cluster';
import type { Config } from './config';
import type { Db } from './db/pool';
import type { Logger } from './logger';
import type { Metrics } from './metrics';

export interface Workspace {
  id: string;
  name: string;
}

/** Everything a request handler needs; built once at start-up. */
export interface AppContext {
  config: Config;
  db: Db;
  logger: Logger;
  workspace: Workspace;
  storage: AssetStorage;
  tickets: Tickets;
  /** Coordination with other instances; null when the server runs alone. */
  cluster: Cluster | null;
  collab: CollabServer;
  accessDeps: AccessDeps;
  metrics: Metrics;
  version: string;
}

/**
 * The single workspace of this deployment (created by the first migration).
 * Every query is scoped to it.
 */
export async function loadWorkspace(db: Db): Promise<Workspace> {
  const result = await db.query<Workspace>(
    'SELECT id, name FROM workspaces ORDER BY created_at, id LIMIT 1',
  );
  const workspace = result.rows[0];
  if (!workspace) {
    throw new Error('The database has no workspace row. Run the migrations (`pnpm db:migrate`).');
  }
  return workspace;
}
