/**
 * Turning a share link into access.
 *
 * By the time this runs, `lib/capability.ts` has already taken the secret out
 * of the address bar. The secret travels once, in the body of
 * `POST /api/share/exchange`; the server answers by setting an HttpOnly cookie
 * scoped to the document. Nothing here logs the secret, stores it, or lets it
 * into a result or message.
 */
import {
  isUuid,
  type ShareExchangeRequest,
  type ShareExchangeResponse,
} from '@realtimedocs/contracts';
import type { Capability } from '../../lib/capability';
import { isApiError } from '../../lib/errors';

export type ShareFailureKind =
  /** The link has no usable secret (cut short, altered, or the page was reloaded). */
  | 'incomplete'
  /** The server does not know this link. */
  | 'invalid'
  | 'expired'
  | 'revoked'
  /** The interview this link belongs to has ended. */
  | 'session_closed'
  /** The link is fine but its document is in the trash or was deleted. */
  | 'document_unavailable'
  | 'rate_limited'
  | 'offline'
  | 'unavailable';

export type ShareExchangeOutcome =
  | { ok: true; documentId: string }
  | { ok: false; kind: ShareFailureKind; retryAfterSeconds?: number; requestId?: string };

/** Failures after which trying the same secret again cannot work. */
export function isFinalShareFailure(kind: ShareFailureKind): boolean {
  return (
    kind === 'incomplete' ||
    kind === 'invalid' ||
    kind === 'expired' ||
    kind === 'revoked' ||
    kind === 'session_closed' ||
    kind === 'document_unavailable'
  );
}

type ExchangeCall = (body: ShareExchangeRequest) => Promise<ShareExchangeResponse>;

function failureFrom(error: unknown, online: boolean): ShareExchangeOutcome {
  if (!isApiError(error)) return { ok: false, kind: 'unavailable' };
  const requestId = error.requestId;
  switch (error.code) {
    case 'share_invalid':
    case 'not_found':
    case 'validation_failed':
      return { ok: false, kind: 'invalid', requestId };
    case 'share_expired':
      return { ok: false, kind: 'expired', requestId };
    case 'share_revoked':
      return { ok: false, kind: 'revoked', requestId };
    case 'session_closed':
      return { ok: false, kind: 'session_closed', requestId };
    case 'document_trashed':
      return { ok: false, kind: 'document_unavailable', requestId };
    case 'rate_limited':
      return {
        ok: false,
        kind: 'rate_limited',
        retryAfterSeconds: error.retryAfterSeconds,
        requestId,
      };
    case 'network_error':
      return { ok: false, kind: online ? 'unavailable' : 'offline' };
    default:
      return { ok: false, kind: 'unavailable', requestId };
  }
}

// One request per captured secret at a time, however often the screen asks
// (React runs effects twice in development).
const inFlight = new WeakMap<object, Promise<ShareExchangeOutcome>>();

export function exchangeShareLink(
  grantId: string,
  capability: Capability,
  exchange: ExchangeCall,
  isOnline: () => boolean = () => navigator.onLine,
): Promise<ShareExchangeOutcome> {
  if (!isUuid(grantId)) return Promise.resolve({ ok: false, kind: 'invalid' });
  if (capability.kind !== 'ok') return Promise.resolve({ ok: false, kind: 'incomplete' });

  const pending = inFlight.get(capability);
  if (pending) return pending;

  const request = exchange({ grantId, secret: capability.secret, mode: 'cookie' })
    .then(
      (response): ShareExchangeOutcome => ({ ok: true, documentId: response.documentId }),
      (error: unknown) => failureFrom(error, isOnline()),
    )
    .finally(() => {
      inFlight.delete(capability);
    });
  inFlight.set(capability, request);
  return request;
}
