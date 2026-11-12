/**
 * Idempotency for `POST` requests of the service API.
 *
 * The first request with an `Idempotency-Key` claims the key (a unique
 * constraint decides races), does its work, and stores the response
 * encrypted. A repeat with the same body replays that response; a repeat with
 * another body is refused; a repeat while the first is running waits briefly
 * and then answers `IDEMPOTENCY_IN_PROGRESS`.
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '../db/pool';
import { AppError, errors } from '../errors';
import { decryptSecret, encryptSecret } from './crypto';

export const IDEMPOTENCY_RETENTION_HOURS = 24;
/** An unfinished claim older than this belongs to a crashed request and may be taken over. */
const STALE_CLAIM_SECONDS = 120;
const WAIT_MS = 5_000;
const POLL_MS = 100;

const KEY_RE = /^[\x21-\x7e]{1,128}$/;

export function parseIdempotencyKey(header: unknown): string | null {
  if (header === undefined) return null;
  if (typeof header !== 'string' || !KEY_RE.test(header)) {
    throw errors.validation('The Idempotency-Key header is not valid.', [
      { path: 'Idempotency-Key', message: 'Use 1 to 128 visible ASCII characters.' },
    ]);
  }
  return header;
}

/** JSON with sorted keys, so equal bodies hash equally whatever their key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}\n${path}\n${canonicalJson(body ?? null)}`)
    .digest('hex');
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

export type Claim = { kind: 'owner' } | { kind: 'replay'; response: StoredResponse };

interface Row {
  requestHash: string;
  response: { enc: string } | null;
  statusCode: number | null;
  stale: boolean;
}

export class IdempotencyStore {
  constructor(
    private readonly db: Queryable,
    private readonly workspaceId: string,
    private readonly secret: string,
  ) {}

  async claim(apiKeyId: string, key: string, hash: string): Promise<Claim> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const inserted = await this.db.query(
        `INSERT INTO idempotency_keys (workspace_id, api_key_id, key, request_hash)
         VALUES ($1, $2, $3, $4) ON CONFLICT (api_key_id, key) DO NOTHING RETURNING key`,
        [this.workspaceId, apiKeyId, key, hash],
      );
      if (inserted.rows.length > 0) return { kind: 'owner' };

      const found = await this.db.query<Row>(
        `SELECT request_hash AS "requestHash", response, status_code AS "statusCode",
                created_at < now() - make_interval(secs => $3) AS stale
           FROM idempotency_keys WHERE api_key_id = $1 AND key = $2`,
        [apiKeyId, key, STALE_CLAIM_SECONDS],
      );
      const row = found.rows[0];
      if (!row) continue; // released between the two statements: claim again
      if (row.requestHash !== hash) {
        throw new AppError(
          'idempotency_conflict',
          'This Idempotency-Key was already used with a different request.',
        );
      }
      if (row.response && row.statusCode !== null) {
        const body = JSON.parse(
          decryptSecret(this.secret, 'idempotent-response', row.response.enc),
        );
        return { kind: 'replay', response: { status: row.statusCode, body } };
      }
      if (row.stale) {
        await this.release(apiKeyId, key);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new AppError(
          'idempotency_in_progress',
          'A request with this Idempotency-Key is still being processed. Retry shortly.',
          { retryAfterSeconds: 1 },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  /** Stores the response. Call inside the transaction that did the work. */
  async complete(
    db: Queryable,
    apiKeyId: string,
    key: string,
    response: StoredResponse,
  ): Promise<void> {
    const enc = encryptSecret(this.secret, 'idempotent-response', JSON.stringify(response.body));
    await db.query(
      `UPDATE idempotency_keys SET response = $3::jsonb, status_code = $4
        WHERE api_key_id = $1 AND key = $2`,
      [apiKeyId, key, JSON.stringify({ enc }), response.status],
    );
  }

  /** Gives the key back (the request failed): the client may retry with the same key. */
  async release(apiKeyId: string, key: string): Promise<void> {
    await this.db.query(
      'DELETE FROM idempotency_keys WHERE api_key_id = $1 AND key = $2 AND response IS NULL',
      [apiKeyId, key],
    );
  }
}
