/**
 * Audit trail for administrative and security events. Details are small,
 * non-sensitive scalars: never document content, passwords, secrets or tokens.
 */
import type { Queryable } from './db/pool';
import type { Logger } from './logger';
import { newId } from './auth/tokens';

export type AuditDetails = Record<string, string | number | boolean | null>;

export interface AuditActor {
  kind: 'user' | 'guest' | 'system';
  userId?: string | null;
  name?: string | null;
}

export interface AuditEntry {
  workspaceId: string;
  actor: AuditActor;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: AuditDetails;
  requestId?: string | null;
}

export const SYSTEM_ACTOR: AuditActor = { kind: 'system', name: 'system' };

const FORBIDDEN_DETAIL_KEY = /password|secret|token|ticket|cookie|content|body|hash/i;

function cleanDetails(details: AuditDetails | undefined): AuditDetails {
  const clean: AuditDetails = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (FORBIDDEN_DETAIL_KEY.test(key)) continue;
    clean[key] = typeof value === 'string' ? value.slice(0, 300) : value;
  }
  return clean;
}

/** Writes an audit event. Use inside the transaction that performs the action. */
export async function writeAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_events
       (id, workspace_id, actor_kind, actor_user_id, actor_name, action, target_type, target_id,
        details, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      newId(),
      entry.workspaceId,
      entry.actor.kind,
      entry.actor.userId ?? null,
      entry.actor.name ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(cleanDetails(entry.details)),
      entry.requestId ?? null,
    ],
  );
}

/**
 * Best-effort variant for events recorded outside a business transaction
 * (failed sign-ins, rejected collaboration frames). A storage failure is
 * logged and never turns into a second error for the caller.
 */
export async function tryAudit(db: Queryable, logger: Logger, entry: AuditEntry): Promise<void> {
  try {
    await writeAudit(db, entry);
  } catch (err) {
    logger.warn({ err, action: entry.action }, 'audit event could not be stored');
  }
}
