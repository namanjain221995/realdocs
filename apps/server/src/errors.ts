import {
  HTTP_STATUS_BY_CODE,
  type ApiErrorBody,
  type ErrorCode,
  type UploadRejectReason,
} from '@realtimedocs/contracts';

export interface AppErrorDetails {
  reason?: UploadRejectReason;
  issues?: { path: string; message: string }[];
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * An error with a machine-readable code from the shared contract. Messages are
 * written for end users and never contain secrets or document content.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly reason?: UploadRejectReason;
  readonly issues?: { path: string; message: string }[];
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message: string, details: AppErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'AppError';
    this.code = code;
    this.reason = details.reason;
    this.issues = details.issues;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }

  get status(): number {
    return HTTP_STATUS_BY_CODE[this.code];
  }

  toBody(requestId?: string): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.reason ? { reason: this.reason } : {}),
        ...(this.issues ? { issues: this.issues } : {}),
        ...(this.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: this.retryAfterSeconds }
          : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }
}

export const errors = {
  validation: (message: string, issues?: { path: string; message: string }[]) =>
    new AppError('validation_failed', message, { issues }),
  unauthenticated: (message = 'Sign in to continue.') => new AppError('unauthenticated', message),
  sessionExpired: () =>
    new AppError('session_expired', 'Your session has expired. Sign in again to continue.'),
  forbidden: (message = 'You do not have permission to do that.') =>
    new AppError('forbidden', message),
  csrf: () =>
    new AppError(
      'csrf_failed',
      'The request could not be verified. Reload the page and try again.',
    ),
  badOrigin: () => new AppError('bad_origin', 'Requests from this origin are not accepted.'),
  // One message for unknown and unauthorized documents: knowing an id reveals nothing.
  notFound: (message = 'Not found, or you do not have access.') =>
    new AppError('not_found', message),
  conflict: (message: string) => new AppError('conflict', message),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError('rate_limited', 'Too many attempts. Try again later.', {
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    }),
  payloadTooLarge: (message: string, reason?: UploadRejectReason) =>
    new AppError('payload_too_large', message, { reason }),
  unsupportedMediaType: (message: string) => new AppError('unsupported_media_type', message),
  uploadRejected: (reason: UploadRejectReason, message: string) =>
    new AppError('upload_rejected', message, { reason }),
  quotaExceeded: (message: string) => new AppError('quota_exceeded', message),
  shareInvalid: () => new AppError('share_invalid', 'This share link is not valid.'),
  shareExpired: () => new AppError('share_expired', 'This share link has expired.'),
  shareRevoked: () => new AppError('share_revoked', 'This share link has been revoked.'),
  inviteInvalid: () => new AppError('invite_invalid', 'This invitation is not valid.'),
  inviteExpired: () => new AppError('invite_expired', 'This invitation has expired.'),
  handoffInvalid: () =>
    new AppError(
      'handoff_invalid',
      'This desktop handoff code is not valid or has already been used.',
    ),
  documentTrashed: () => new AppError('document_trashed', 'This document is in the trash.'),
  generationMismatch: () =>
    new AppError('generation_mismatch', 'The document was restored to another version.'),
  updateRequired: () =>
    new AppError('update_required', 'This document needs a newer version of the application.'),
  serverBusy: (message = 'The server is busy. Try again in a moment.') =>
    new AppError('server_busy', message),
  storageUnavailable: (cause?: unknown) =>
    new AppError(
      'storage_unavailable',
      'Storage is temporarily unavailable. Try again in a moment.',
      {
        cause,
      },
    ),
  internal: (cause?: unknown) =>
    new AppError('internal', 'Something went wrong on the server.', { cause }),
};
