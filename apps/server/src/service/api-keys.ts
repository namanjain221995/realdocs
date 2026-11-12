/**
 * API keys (service credentials): creation, rotation, revocation, listing and
 * authentication of a presented key. Only the SHA-256 of a key is stored.
 */
import {
  ServiceScope,
  type ApiKey,
  type ApiKeyState,
  type ApiKeyWithSecret,
  type CreateApiKeyRequest,
} from '@realtimedocs/contracts';
import type { FastifyRequest } from 'fastify';
import { tryAudit, writeAudit, type AuditActor } from '../audit';
import { newId } from '../auth/tokens';
import type { AppContext } from '../context';
import type { Queryable } from '../db/pool';
import { errors, type AppError } from '../errors';
import { generateApiKey, ipInCidrs, keyMatches, parseApiKey, parseCidr } from './api-key-format';

export interface ServicePrincipal {
  keyId: string;
  keyPrefix: string;
  name: string;
  scopes: ServiceScope[];
}

interface KeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  secretHash: Buffer;
  scopes: string[];
  allowedCidrs: string[] | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
  revokedAt: Date | null;
  rotatedFrom: string | null;
}

const KEY_COLUMNS = `
  k.id, k.name, k.key_prefix AS "keyPrefix", k.secret_hash AS "secretHash", k.scopes,
  k.allowed_cidrs AS "allowedCidrs", k.expires_at AS "expiresAt", k.last_used_at AS "lastUsedAt",
  k.created_at AS "createdAt", (SELECT u.display_name FROM users u WHERE u.id = k.created_by) AS "createdByName",
  k.revoked_at AS "revokedAt", k.rotated_from AS "rotatedFrom"`;

export function keyState(
  row: Pick<KeyRow, 'revokedAt' | 'expiresAt'>,
  now = Date.now(),
): ApiKeyState {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now) return 'expired';
  return 'active';
}

function toApiKey(row: KeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes.filter(
      (scope): scope is ServiceScope => ServiceScope.safeParse(scope).success,
    ),
    allowedCidrs: row.allowedCidrs,
    state: keyState(row),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    rotatedFrom: row.rotatedFrom,
  };
}

export async function listApiKeys(ctx: AppContext): Promise<ApiKey[]> {
  const result = await ctx.db.query<KeyRow>(
    `SELECT ${KEY_COLUMNS} FROM api_keys k WHERE k.workspace_id = $1 ORDER BY k.created_at DESC, k.id`,
    [ctx.workspace.id],
  );
  return result.rows.map(toApiKey);
}

async function loadKey(db: Queryable, workspaceId: string, id: string, lock = false) {
  const result = await db.query<KeyRow>(
    `SELECT ${KEY_COLUMNS} FROM api_keys k WHERE k.id = $1 AND k.workspace_id = $2 ${lock ? 'FOR UPDATE OF k' : ''}`,
    [id, workspaceId],
  );
  return result.rows[0] ?? null;
}

function validateCidrs(cidrs: readonly string[] | null | undefined): string[] | null {
  if (!cidrs || cidrs.length === 0) return null;
  const bad = cidrs.findIndex((cidr) => parseCidr(cidr) === null);
  if (bad >= 0) {
    throw errors.validation('Some fields are not valid.', [
      {
        path: `allowedCidrs.${bad}`,
        message: 'Use an IP address or CIDR block such as 203.0.113.0/24.',
      },
    ]);
  }
  return [...cidrs];
}

export async function createApiKey(
  ctx: AppContext,
  actor: { userId: string; name: string },
  input: CreateApiKeyRequest,
  requestId: string,
): Promise<ApiKeyWithSecret> {
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw errors.validation('Some fields are not valid.', [
      { path: 'expiresAt', message: 'Choose a time in the future.' },
    ]);
  }
  const cidrs = validateCidrs(input.allowedCidrs);
  const scopes = [...new Set(input.scopes)];
  const generated = generateApiKey();
  const id = newId();
  const row = await ctx.db.tx(async (tx) => {
    await tx.query(
      `INSERT INTO api_keys
         (id, workspace_id, name, key_prefix, secret_hash, scopes, allowed_cidrs, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        ctx.workspace.id,
        input.name,
        generated.prefix,
        generated.hash,
        scopes,
        cidrs,
        expiresAt,
        actor.userId,
      ],
    );
    await writeAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: { kind: 'user', userId: actor.userId, name: actor.name },
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: id,
      details: { keyPrefix: generated.prefix, name: input.name, scopes: scopes.join(',') },
      requestId,
    });
    return loadKey(tx, ctx.workspace.id, id);
  });
  if (!row) throw new Error('api key insert returned no row');
  return { key: toApiKey(row), secret: generated.key };
}

export async function rotateApiKey(
  ctx: AppContext,
  actor: { userId: string; name: string },
  keyId: string,
  requestId: string,
): Promise<ApiKeyWithSecret> {
  const generated = generateApiKey();
  const id = newId();
  const row = await ctx.db.tx(async (tx) => {
    const current = await loadKey(tx, ctx.workspace.id, keyId, true);
    if (!current) throw errors.notFound('That API key does not exist.');
    if (keyState(current) !== 'active') {
      throw errors.conflict('Only an active key can be rotated. Create a new key instead.');
    }
    // The old key stops working at once; the new one carries the same scopes and limits.
    await tx.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [keyId]);
    await tx.query(
      `INSERT INTO api_keys
         (id, workspace_id, name, key_prefix, secret_hash, scopes, allowed_cidrs, expires_at,
          created_by, rotated_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        ctx.workspace.id,
        current.name,
        generated.prefix,
        generated.hash,
        current.scopes,
        current.allowedCidrs,
        current.expiresAt,
        actor.userId,
        keyId,
      ],
    );
    await writeAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: { kind: 'user', userId: actor.userId, name: actor.name },
      action: 'api_key.rotated',
      targetType: 'api_key',
      targetId: keyId,
      details: { keyPrefix: current.keyPrefix, newKeyPrefix: generated.prefix, newKeyId: id },
      requestId,
    });
    return loadKey(tx, ctx.workspace.id, id);
  });
  if (!row) throw new Error('rotated key was not created');
  return { key: toApiKey(row), secret: generated.key };
}

export async function revokeApiKey(
  ctx: AppContext,
  actor: { userId: string; name: string },
  keyId: string,
  requestId: string,
): Promise<ApiKey> {
  const row = await ctx.db.tx(async (tx) => {
    const current = await loadKey(tx, ctx.workspace.id, keyId, true);
    if (!current) throw errors.notFound('That API key does not exist.');
    if (!current.revokedAt) {
      await tx.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [keyId]);
      await writeAudit(tx, {
        workspaceId: ctx.workspace.id,
        actor: { kind: 'user', userId: actor.userId, name: actor.name },
        action: 'api_key.revoked',
        targetType: 'api_key',
        targetId: keyId,
        details: { keyPrefix: current.keyPrefix },
        requestId,
      });
    }
    return loadKey(tx, ctx.workspace.id, keyId);
  });
  if (!row) throw errors.notFound();
  return toApiKey(row);
}

// ── Authentication ──────────────────────────────────────────────────────────

const authCache = new WeakMap<FastifyRequest, Promise<ServicePrincipal>>();

export type KeyFailure =
  'malformed' | 'unknown_key' | 'bad_secret' | 'revoked' | 'expired' | 'ip_not_allowed';

const UNAUTHENTICATED_MESSAGE = 'The API key is missing, not valid, revoked or expired.';

/**
 * Checks a presented key. The error for every failure except a disallowed
 * address is the same `UNAUTHENTICATED`, so a caller learns nothing about
 * which keys exist.
 */
export async function authenticateApiKey(
  ctx: AppContext,
  request: FastifyRequest,
  token: string,
  onFailure: (reason: KeyFailure) => Promise<void>,
): Promise<ServicePrincipal> {
  let pending = authCache.get(request);
  if (!pending) {
    pending = check(ctx, request, token, onFailure);
    authCache.set(request, pending);
  }
  return pending;
}

async function check(
  ctx: AppContext,
  request: FastifyRequest,
  token: string,
  onFailure: (reason: KeyFailure) => Promise<void>,
): Promise<ServicePrincipal> {
  const fail = async (
    reason: KeyFailure,
    row: KeyRow | null,
    error: AppError = errors.unauthenticated(UNAUTHENTICATED_MESSAGE),
  ): Promise<never> => {
    await onFailure(reason);
    await tryAudit(ctx.db, ctx.logger, {
      workspaceId: ctx.workspace.id,
      actor: { kind: 'system', name: 'anonymous' },
      action: 'api_key.auth_failed',
      targetType: 'api_key',
      targetId: row?.id ?? null,
      // Never the key or any part of its secret.
      details: { reason, keyPrefix: row?.keyPrefix ?? null, ip: request.ip },
      requestId: request.id,
    });
    throw error;
  };

  const parsed = parseApiKey(token);
  if (!parsed) return fail('malformed', null);
  const result = await ctx.db.query<KeyRow>(
    `SELECT ${KEY_COLUMNS} FROM api_keys k WHERE k.key_prefix = $1 AND k.workspace_id = $2`,
    [parsed.prefix, ctx.workspace.id],
  );
  const row = result.rows[0] ?? null;
  // Compare even when the key is unknown, so both cases take the same time.
  const matches = keyMatches(row?.secretHash ?? null, parsed.hash);
  if (!row) return fail('unknown_key', null);
  if (!matches) return fail('bad_secret', row);
  if (row.revokedAt) return fail('revoked', row);
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return fail('expired', row);
  if (row.allowedCidrs && row.allowedCidrs.length > 0 && !ipInCidrs(request.ip, row.allowedCidrs)) {
    return fail(
      'ip_not_allowed',
      row,
      errors.forbidden('This API key cannot be used from this address.'),
    );
  }

  // At most one write a minute per key.
  ctx.db
    .query(
      `UPDATE api_keys SET last_used_at = now()
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
      [row.id],
    )
    .catch((err: unknown) => ctx.logger.debug({ err }, 'could not record API key use'));

  return {
    keyId: row.id,
    keyPrefix: row.keyPrefix,
    name: row.name,
    scopes: toApiKey(row).scopes,
  };
}

export function serviceActor(principal: ServicePrincipal): AuditActor {
  return { kind: 'service', name: `${principal.name} (${principal.keyPrefix})` };
}
