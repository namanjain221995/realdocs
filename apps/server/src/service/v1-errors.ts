/** The error envelope of `/api/v1`: UPPER_SNAKE codes, a request id, field details. */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { V1ErrorBody, V1ErrorCode } from '@realtimedocs/contracts';
import type { AppError } from '../errors';

const BY_CODE: Record<string, V1ErrorCode> = {
  validation_failed: 'VALIDATION_ERROR',
  unauthenticated: 'UNAUTHENTICATED',
  session_expired: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  csrf_failed: 'FORBIDDEN',
  bad_origin: 'FORBIDDEN',
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
  generation_mismatch: 'CONFLICT',
  idempotency_conflict: 'IDEMPOTENCY_CONFLICT',
  idempotency_in_progress: 'IDEMPOTENCY_IN_PROGRESS',
  rate_limited: 'RATE_LIMITED',
  payload_too_large: 'PAYLOAD_TOO_LARGE',
  unsupported_media_type: 'UNSUPPORTED_MEDIA_TYPE',
  session_closed: 'SESSION_CLOSED',
  server_busy: 'SERVICE_UNAVAILABLE',
  storage_unavailable: 'SERVICE_UNAVAILABLE',
  RELEASE_NOT_AVAILABLE: 'RELEASE_NOT_AVAILABLE',
};

const BY_STATUS: Record<number, V1ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

export function v1CodeOf(error: AppError): V1ErrorCode {
  return BY_CODE[error.code] ?? BY_STATUS[error.status] ?? 'INTERNAL';
}

export function toV1Body(error: AppError, requestId: string): V1ErrorBody {
  return {
    error: {
      code: v1CodeOf(error),
      message: error.message,
      requestId,
      ...(error.issues && error.issues.length > 0 ? { details: error.issues } : {}),
    },
  };
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Request id of a `/api/v1` request: the caller's `X-Request-Id` when well formed, else a new `req_…`. */
export function v1RequestId(request: IncomingMessage): string {
  const inbound = request.headers['x-request-id'];
  if (typeof inbound === 'string' && REQUEST_ID_RE.test(inbound)) return inbound;
  return `req_${randomBytes(12).toString('hex')}`;
}

export function isV1Url(url: string | undefined): boolean {
  return (url ?? '').split('?')[0]?.startsWith('/api/v1/') === true;
}
