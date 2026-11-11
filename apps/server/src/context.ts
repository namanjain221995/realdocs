import type { AccessDeps } from './access/resolve';
import type { AssetStorage } from './assets/storage';
import type { CollabServer } from './collab/server';
import type { TicketStore } from './collab/tickets';
import type { Config } from './config';
import type { Db } from './db/pool';
import type { Logger } from './logger';

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
  tickets: TicketStore;
  collab: CollabServer;
  accessDeps: AccessDeps;
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
