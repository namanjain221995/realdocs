import { z } from './zod';

/**
 * Machine-readable error codes shared by HTTP responses, collaboration
 * authentication failures and client UI states.
 */
export const ErrorCode = z.enum([
  'validation_failed',
  'unauthenticated',
  'session_expired',
  'forbidden',
  'csrf_failed',
  'bad_origin',
  'not_found',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'upload_rejected',
  'quota_exceeded',
  'share_invalid',
  'share_expired',
  'share_revoked',
  'invite_invalid',
  'invite_expired',
  'handoff_invalid',
  'document_trashed',
  'generation_mismatch',
  'update_required',
  'server_busy',
  'storage_unavailable',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  session_expired: 401,
  forbidden: 403,
  csrf_failed: 403,
  bad_origin: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  upload_rejected: 422,
  quota_exceeded: 413,
  share_invalid: 404,
  share_expired: 410,
  share_revoked: 410,
  invite_invalid: 404,
  invite_expired: 410,
  handoff_invalid: 400,
  document_trashed: 410,
  generation_mismatch: 409,
  update_required: 426,
  server_busy: 503,
  storage_unavailable: 503,
  internal: 500,
};

/** Why an upload was rejected (`upload_rejected` / `payload_too_large`). */
export const UploadRejectReason = z.enum([
  'too_large',
  'empty',
  'type_not_allowed',
  'content_mismatch',
  'dimensions_too_large',
  'active_content',
  'bad_filename',
]);
export type UploadRejectReason = z.infer<typeof UploadRejectReason>;

/** Body of every non-2xx JSON response. Never contains secrets or document content. */
export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** Present for `upload_rejected`. */
    reason: UploadRejectReason.optional(),
    /** Field-level validation issues (`validation_failed`). */
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    /** Seconds until a rate limit resets (`rate_limited`). */
    retryAfterSeconds: z.number().optional(),
    /** Correlates with the server log line; safe to show to users. */
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
