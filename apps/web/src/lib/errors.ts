/**
 * One place that turns an API failure into what the person sees: which
 * dedicated screen a failed page load shows, and the sentence a failed action
 * puts in a toast. Messages are written here rather than echoed from the
 * server, except where only the server knows the specifics (conflicts and
 * field validation).
 */
import { ApiError } from '@realtimedocs/contracts';

export type ErrorScreenKind =
  | 'not_found'
  | 'document_trashed'
  | 'forbidden'
  | 'session_expired'
  | 'link_invalid'
  | 'link_expired'
  | 'link_revoked'
  | 'session_closed'
  | 'invite_invalid'
  | 'invite_expired'
  | 'rate_limited'
  | 'update_required'
  | 'offline'
  | 'server_unavailable'
  | 'unexpected';

export interface ErrorEnvironment {
  /** `navigator.onLine` at the time of the failure. */
  online: boolean;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Which full-page screen a failed load should show. */
export function errorScreenKind(error: unknown, env: ErrorEnvironment): ErrorScreenKind {
  if (!isApiError(error)) return 'unexpected';
  switch (error.code) {
    case 'not_found':
      return 'not_found';
    case 'document_trashed':
      return 'document_trashed';
    case 'forbidden':
    case 'csrf_failed':
    case 'bad_origin':
      return 'forbidden';
    case 'unauthenticated':
    case 'session_expired':
      return 'session_expired';
    case 'share_invalid':
      return 'link_invalid';
    case 'share_expired':
      return 'link_expired';
    case 'share_revoked':
      return 'link_revoked';
    case 'session_closed':
      return 'session_closed';
    case 'invite_invalid':
      return 'invite_invalid';
    case 'invite_expired':
      return 'invite_expired';
    case 'rate_limited':
      return 'rate_limited';
    case 'update_required':
      return 'update_required';
    case 'network_error':
      return env.online ? 'server_unavailable' : 'offline';
    case 'server_busy':
    case 'storage_unavailable':
    case 'internal':
    case 'invalid_response':
      return 'server_unavailable';
    default:
      return 'unexpected';
  }
}

/** True when showing a "Try again" button makes sense for this screen. */
export function isRetryableScreen(kind: ErrorScreenKind): boolean {
  return (
    kind === 'offline' ||
    kind === 'server_unavailable' ||
    kind === 'rate_limited' ||
    kind === 'unexpected'
  );
}

/** "42 seconds", "1 minute", "3 minutes". Rounds up so the wait is never understated. */
export function formatWait(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  if (whole < 60) return `${whole} ${whole === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.ceil(whole / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** One plain sentence for a toast or an inline form error. Never includes secrets. */
export function errorMessage(
  error: unknown,
  fallback = 'Something went wrong. Try again.',
): string {
  if (!isApiError(error)) return fallback;
  switch (error.code) {
    case 'network_error':
      return 'The server could not be reached. Check your connection and try again.';
    case 'rate_limited':
      return error.retryAfterSeconds !== undefined
        ? `Too many attempts. Try again in ${formatWait(error.retryAfterSeconds)}.`
        : 'Too many attempts. Wait a moment and try again.';
    case 'unauthenticated':
    case 'session_expired':
      return 'Your session has ended. Sign in again to continue.';
    case 'forbidden':
      return 'You do not have permission to do that.';
    case 'csrf_failed':
      return 'Your session changed, possibly in another tab. Check which account is signed in and try again.';
    case 'bad_origin':
      return 'The server refused this request because of the address it came from.';
    case 'not_found':
      return 'That no longer exists, or you no longer have access to it.';
    case 'document_trashed':
      return 'This document is in the trash.';
    case 'session_closed':
      return 'This interview has ended.';
    case 'conflict':
      return error.message || 'That conflicts with a newer change. Reload and try again.';
    case 'validation_failed': {
      const first = error.issues?.[0];
      return first?.message ?? (error.message || 'Some of the values were not accepted.');
    }
    case 'server_busy':
      return 'The server is busy. Try again in a moment.';
    case 'storage_unavailable':
      return 'The server cannot reach its storage right now. Try again in a moment.';
    case 'internal':
      return 'The server ran into a problem. Try again.';
    case 'invalid_response':
      return 'The server sent a response this version of the app does not understand. Reload the page.';
    case 'update_required':
      return 'This version of the app is out of date. Reload the page.';
    case 'aborted':
      return 'The request was cancelled.';
    default:
      return error.message || fallback;
  }
}

/** The server's request id for this failure, when it sent one. Safe to show. */
export function requestIdOf(error: unknown): string | undefined {
  return isApiError(error) ? error.requestId : undefined;
}

/** Field-level messages of a `validation_failed` response, keyed by field path. */
export function fieldIssues(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isApiError(error) || !error.issues) return out;
  for (const issue of error.issues) {
    if (!(issue.path in out)) out[issue.path] = issue.message;
  }
  return out;
}

/** 4xx responses are answers, not outages: retrying them cannot help. */
export function isClientError(error: unknown): boolean {
  return isApiError(error) && error.status >= 400 && error.status < 500;
}
