import { ApiError, type ClientErrorCode, ErrorCode } from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import {
  errorMessage,
  errorScreenKind,
  type ErrorScreenKind,
  fieldIssues,
  formatWait,
  isClientError,
  isRetryableScreen,
  requestIdOf,
} from '../src/lib/errors';

const ONLINE = { online: true };
const OFFLINE = { online: false };

function apiError(code: ClientErrorCode, status = 0): ApiError {
  return new ApiError(code, `server message for ${code}`, { status });
}

describe('errorScreenKind', () => {
  const expected: Record<ClientErrorCode, ErrorScreenKind> = {
    not_found: 'not_found',
    document_trashed: 'document_trashed',
    forbidden: 'forbidden',
    csrf_failed: 'forbidden',
    bad_origin: 'forbidden',
    unauthenticated: 'session_expired',
    session_expired: 'session_expired',
    share_invalid: 'link_invalid',
    share_expired: 'link_expired',
    share_revoked: 'link_revoked',
    session_closed: 'session_closed',
    invite_invalid: 'invite_invalid',
    invite_expired: 'invite_expired',
    rate_limited: 'rate_limited',
    update_required: 'update_required',
    server_busy: 'server_unavailable',
    storage_unavailable: 'server_unavailable',
    internal: 'server_unavailable',
    invalid_response: 'server_unavailable',
    network_error: 'server_unavailable',
    // Codes that belong to an action rather than a page load.
    validation_failed: 'unexpected',
    conflict: 'unexpected',
    payload_too_large: 'unexpected',
    unsupported_media_type: 'unexpected',
    upload_rejected: 'unexpected',
    quota_exceeded: 'unexpected',
    handoff_invalid: 'unexpected',
    generation_mismatch: 'unexpected',
    aborted: 'unexpected',
    RELEASE_NOT_AVAILABLE: 'unexpected',
    idempotency_conflict: 'unexpected',
    idempotency_in_progress: 'unexpected',
  };

  it.each(Object.entries(expected) as [ClientErrorCode, ErrorScreenKind][])(
    '%s shows the %s screen',
    (code, screen) => {
      expect(errorScreenKind(apiError(code), ONLINE)).toBe(screen);
    },
  );

  it('covers every error code in the contract', () => {
    for (const code of ErrorCode.options) {
      expect(expected).toHaveProperty(code);
    }
  });

  it('shows the offline screen for a network failure while the browser is offline', () => {
    expect(errorScreenKind(apiError('network_error'), OFFLINE)).toBe('offline');
    // Being offline does not change what a real server answer means.
    expect(errorScreenKind(apiError('not_found', 404), OFFLINE)).toBe('not_found');
  });

  it('treats anything that is not an API error as unexpected', () => {
    expect(errorScreenKind(new TypeError('x is not a function'), ONLINE)).toBe('unexpected');
    expect(errorScreenKind(null, ONLINE)).toBe('unexpected');
  });

  it('offers a retry only where retrying can help', () => {
    expect(isRetryableScreen('offline')).toBe(true);
    expect(isRetryableScreen('server_unavailable')).toBe(true);
    expect(isRetryableScreen('rate_limited')).toBe(true);
    expect(isRetryableScreen('not_found')).toBe(false);
    expect(isRetryableScreen('document_trashed')).toBe(false);
    expect(isRetryableScreen('forbidden')).toBe(false);
    expect(isRetryableScreen('link_revoked')).toBe(false);
    expect(isRetryableScreen('session_closed')).toBe(false);
  });
});

describe('errorMessage', () => {
  it('states the wait for a rate limit, rounded up', () => {
    const limited = new ApiError('rate_limited', 'x', { status: 429, retryAfterSeconds: 41.2 });
    expect(errorMessage(limited)).toBe('Too many attempts. Try again in 42 seconds.');
    expect(errorMessage(apiError('rate_limited', 429))).toBe(
      'Too many attempts. Wait a moment and try again.',
    );
  });

  it('uses its own wording instead of echoing the server for most codes', () => {
    expect(errorMessage(apiError('forbidden', 403))).toBe('You do not have permission to do that.');
    expect(errorMessage(apiError('internal', 500))).not.toContain('server message');
  });

  it('keeps the server wording where only the server knows the specifics', () => {
    const conflict = new ApiError('conflict', 'An account with this email already exists.', {
      status: 409,
    });
    expect(errorMessage(conflict)).toBe('An account with this email already exists.');
    const invalid = new ApiError('validation_failed', 'Invalid input', {
      status: 400,
      issues: [{ path: 'displayName', message: 'Enter a name.' }],
    });
    expect(errorMessage(invalid)).toBe('Enter a name.');
  });

  it('falls back for errors it does not recognise', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
    expect(errorMessage(undefined, 'Could not save.')).toBe('Could not save.');
  });
});

describe('helpers', () => {
  it('formats waits in whole units', () => {
    expect(formatWait(0.2)).toBe('1 second');
    expect(formatWait(59)).toBe('59 seconds');
    expect(formatWait(60)).toBe('1 minute');
    expect(formatWait(61)).toBe('2 minutes');
    expect(formatWait(3600)).toBe('1 hour');
    expect(formatWait(7201)).toBe('3 hours');
  });

  it('exposes the request id when the server sent one', () => {
    expect(requestIdOf(new ApiError('internal', 'x', { status: 500, requestId: 'req-9f2' }))).toBe(
      'req-9f2',
    );
    expect(requestIdOf(apiError('internal', 500))).toBeUndefined();
    expect(requestIdOf(new Error('x'))).toBeUndefined();
  });

  it('indexes validation issues by field, first message wins', () => {
    const error = new ApiError('validation_failed', 'Invalid', {
      status: 400,
      issues: [
        { path: 'email', message: 'Enter an email address.' },
        { path: 'email', message: 'Second message.' },
        { path: 'password', message: 'Too short.' },
      ],
    });
    expect(fieldIssues(error)).toEqual({
      email: 'Enter an email address.',
      password: 'Too short.',
    });
    expect(fieldIssues(new Error('x'))).toEqual({});
  });

  it('classifies 4xx answers as client errors', () => {
    expect(isClientError(apiError('not_found', 404))).toBe(true);
    expect(isClientError(apiError('rate_limited', 429))).toBe(true);
    expect(isClientError(apiError('internal', 500))).toBe(false);
    expect(isClientError(apiError('network_error'))).toBe(false);
  });
});
