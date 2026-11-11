/**
 * Retention job (CLI `cleanup` and the in-process timer).
 *
 * - Trashed documents are purged after the trash retention period.
 * - An asset is deleted only after it has been unreferenced by the live
 *   document AND every retained snapshot for the whole grace period, observed
 *   by at least two runs (one marks it, a later one deletes it).
 * - Unfinished uploads and stale staging files are removed.
 * - Automatic pre-restore snapshots, dead sessions, used handoff codes and old
 *   audit events are trimmed.
 */
import { collectAssetIds } from '@realtimedocs/editor/export';
import { drainAssetDeletions } from './assets/service';
import type { AssetStorage } from './assets/storage';
import { SYSTEM_ACTOR, writeAudit } from './audit';
import type { Config } from './config';
import type { Db } from './db/pool';
import { loadDurableState } from './documents/store';
import { stateToJson } from './documents/ydoc';
import type { Logger } from './logger';

/** Arbitrary constant identifying the cleanup lock ("rdcl"). */
const CLEANUP_LOCK_ID = 0x7264_636c;

export interface CleanupReport {
  skipped: boolean;
  documentsPurged: number;
  pendingUploadsRemoved: number;
  assetsMarkedUnreferenced: number;
  assetsRestoredToReferenced: number;
  assetsDeleted: number;
  filesDeleted: number;
  stagingFilesRemoved: number;
  preRestoreSnapshotsRemoved: number;
  sessionsRemoved: number;
  handoffsRemoved: number;
  auditEventsRemoved: number;
}

export interface CleanupDeps {
  db: Db;
  storage: AssetStorage;
  retention: Config['retention'];
  workspaceId: string;
  logger: Logger;
}

function emptyReport(): CleanupReport {
  return {
    skipped: false,
    documentsPurged: 0,
    pendingUploadsRemoved: 0,
    assetsMarkedUnreferenced: 0,
    assetsRestoredToReferenced: 0,
    assetsDeleted: 0,
    filesDeleted: 0,
    stagingFilesRemoved: 0,
    preRestoreSnapshotsRemoved: 0,
    sessionsRemoved: 0,
    handoffsRemoved: 0,
    auditEventsRemoved: 0,
  };
}

async function purgeTrash(deps: CleanupDeps, report: CleanupReport): Promise<void> {
  const { db, workspaceId, retention } = deps;
  const due = await db.query<{ id: string }>(
    `SELECT id FROM documents
      WHERE workspace_id = $1 AND status = 'trashed'
        AND trashed_at <= now() - make_interval(days => $2)`,
    [workspaceId, retention.trashDays],
  );
  for (const { id } of due.rows) {
    await db.tx(async (tx) => {
      // Re-check under lock: an administrator may have restored it meanwhile.
      const locked = await tx.query(
        `SELECT 1 FROM documents
          WHERE id = $1 AND workspace_id = $2 AND status = 'trashed'
            AND trashed_at <= now() - make_interval(days => $3)
            FOR UPDATE`,
        [id, workspaceId, retention.trashDays],
      );
      if (locked.rowCount === 0) return;
      await tx.query(
        `INSERT INTO asset_deletions (storage_key)
         SELECT storage_key FROM assets WHERE document_id = $1 AND workspace_id = $2
         ON CONFLICT DO NOTHING`,
        [id, workspaceId],
      );
      await tx.query('DELETE FROM documents WHERE id = $1 AND workspace_id = $2', [
        id,
        workspaceId,
      ]);
      await writeAudit(tx, {
        workspaceId,
        actor: SYSTEM_ACTOR,
        action: 'document.purged',
        targetType: 'document',
        targetId: id,
        details: { afterDays: retention.trashDays },
      });
      report.documentsPurged += 1;
    });
  }
}

async function removePendingUploads(deps: CleanupDeps, report: CleanupReport): Promise<void> {
  const { db, workspaceId, retention } = deps;
  await db.tx(async (tx) => {
    const removed = await tx.query<{ storageKey: string }>(
      `DELETE FROM assets
        WHERE workspace_id = $1 AND status = 'pending'
          AND created_at <= now() - make_interval(hours => $2)
        RETURNING storage_key AS "storageKey"`,
      [workspaceId, retention.pendingUploadHours],
    );
    for (const { storageKey } of removed.rows) {
      await tx.query(
        'INSERT INTO asset_deletions (storage_key) VALUES ($1) ON CONFLICT DO NOTHING',
        [storageKey],
      );
    }
    report.pendingUploadsRemoved += removed.rowCount ?? 0;
  });
}

/** Asset ids referenced by the live document or by any retained snapshot. */
async function referencedAssetIds(deps: CleanupDeps, documentId: string): Promise<Set<string>> {
  const referenced = new Set<string>();
  const durable = await loadDurableState(deps.db, deps.workspaceId, documentId);
  if (durable) {
    for (const id of collectAssetIds(stateToJson(durable.state, durable.updates))) {
      referenced.add(id);
    }
  }
  const snapshots = await deps.db.query<{ assetIds: string[] }>(
    `SELECT asset_ids AS "assetIds" FROM snapshots WHERE document_id = $1 AND workspace_id = $2`,
    [documentId, deps.workspaceId],
  );
  for (const row of snapshots.rows) for (const id of row.assetIds) referenced.add(id);
  return referenced;
}

async function sweepAssets(deps: CleanupDeps, report: CleanupReport): Promise<void> {
  const { db, workspaceId, retention } = deps;
  const documents = await db.query<{ id: string }>(
    `SELECT DISTINCT document_id AS id FROM assets WHERE workspace_id = $1 AND status = 'ready'`,
    [workspaceId],
  );
  for (const { id } of documents.rows) {
    let referenced: Set<string>;
    try {
      referenced = await referencedAssetIds(deps, id);
    } catch (err) {
      // Never delete on incomplete information.
      deps.logger.error({ err, documentId: id }, 'asset references could not be determined');
      continue;
    }
    const ids = [...referenced];
    await db.tx(async (tx) => {
      const restored = await tx.query(
        `UPDATE assets SET unreferenced_since = NULL
          WHERE document_id = $1 AND workspace_id = $2 AND unreferenced_since IS NOT NULL
            AND id = ANY($3::uuid[])`,
        [id, workspaceId, ids],
      );
      report.assetsRestoredToReferenced += restored.rowCount ?? 0;

      // Only assets that an earlier run already found unreferenced, a full grace period ago.
      const deleted = await tx.query<{ storageKey: string }>(
        `DELETE FROM assets
          WHERE document_id = $1 AND workspace_id = $2 AND status = 'ready'
            AND unreferenced_since IS NOT NULL
            AND unreferenced_since <= now() - make_interval(days => $4)
            AND NOT (id = ANY($3::uuid[]))
          RETURNING storage_key AS "storageKey"`,
        [id, workspaceId, ids, retention.assetGraceDays],
      );
      for (const { storageKey } of deleted.rows) {
        await tx.query(
          'INSERT INTO asset_deletions (storage_key) VALUES ($1) ON CONFLICT DO NOTHING',
          [storageKey],
        );
      }
      report.assetsDeleted += deleted.rowCount ?? 0;

      const marked = await tx.query(
        `UPDATE assets SET unreferenced_since = now()
          WHERE document_id = $1 AND workspace_id = $2 AND status = 'ready'
            AND unreferenced_since IS NULL AND NOT (id = ANY($3::uuid[]))`,
        [id, workspaceId, ids],
      );
      report.assetsMarkedUnreferenced += marked.rowCount ?? 0;
    });
  }
}

async function trimRecords(deps: CleanupDeps, report: CleanupReport): Promise<void> {
  const { db, workspaceId, retention } = deps;
  const snapshots = await db.query(
    `DELETE FROM snapshots
      WHERE workspace_id = $1 AND kind = 'pre_restore'
        AND created_at <= now() - make_interval(days => $2)`,
    [workspaceId, retention.preRestoreSnapshotDays],
  );
  report.preRestoreSnapshotsRemoved = snapshots.rowCount ?? 0;

  const sessions = await db.query(
    `DELETE FROM sessions
      WHERE workspace_id = $1
        AND LEAST(expires_at, COALESCE(revoked_at, expires_at)) <= now() - make_interval(days => $2)`,
    [workspaceId, retention.sessionDays],
  );
  report.sessionsRemoved = sessions.rowCount ?? 0;

  const handoffs = await db.query(
    `DELETE FROM desktop_handoffs
      WHERE workspace_id = $1 AND expires_at <= now() - interval '1 day'`,
    [workspaceId],
  );
  report.handoffsRemoved = handoffs.rowCount ?? 0;

  const audit = await db.query(
    `DELETE FROM audit_events WHERE workspace_id = $1 AND at <= now() - make_interval(days => $2)`,
    [workspaceId, retention.auditDays],
  );
  report.auditEventsRemoved = audit.rowCount ?? 0;
}

/**
 * Runs every retention rule once. Concurrent runs (CLI and server timer) are
 * serialized with an advisory lock; the loser returns `skipped: true`.
 */
export async function runCleanup(deps: CleanupDeps): Promise<CleanupReport> {
  const report = emptyReport();
  const client = await deps.db.pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [CLEANUP_LOCK_ID],
    );
    if (!lock.rows[0]?.locked) {
      report.skipped = true;
      return report;
    }
    try {
      await purgeTrash(deps, report);
      await removePendingUploads(deps, report);
      await sweepAssets(deps, report);
      await trimRecords(deps, report);
      report.stagingFilesRemoved = await deps.storage.removeStaleTemp(
        deps.retention.pendingUploadHours * 3_600_000,
      );
      report.filesDeleted = await drainAssetDeletions(deps.db, deps.storage);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [CLEANUP_LOCK_ID]);
    }
  } finally {
    client.release();
  }
  return report;
}
