/**
 * Upload limits and messages.
 *
 * Limits come from `GET /api/meta` (the server may override the defaults);
 * the contract defaults are only a fallback while the request is pending or
 * failed. The server remains the authority: these checks exist so a user is
 * told immediately instead of after a long upload.
 */
import {
  ATTACHMENT_EXTENSIONS,
  ApiError,
  DEFAULT_LIMITS,
  IMAGE_MIME_TYPES,
  type ApiClient,
  type UploadRejectReason,
} from '@realtimedocs/contracts';

export interface UploadLimits {
  maxImageBytes: number;
  maxAttachmentBytes: number;
  maxMermaidSourceLength: number;
  imageMimeTypes: readonly string[];
  attachmentExtensions: readonly string[];
}

export const FALLBACK_LIMITS: UploadLimits = {
  maxImageBytes: DEFAULT_LIMITS.maxImageBytes,
  maxAttachmentBytes: DEFAULT_LIMITS.maxAttachmentBytes,
  maxMermaidSourceLength: DEFAULT_LIMITS.maxMermaidSourceLength,
  imageMimeTypes: IMAGE_MIME_TYPES,
  attachmentExtensions: ATTACHMENT_EXTENSIONS,
};

const cache = new WeakMap<ApiClient, { value: UploadLimits; pending: Promise<UploadLimits> }>();

/** Limits known right now (defaults until `GET /api/meta` answered). */
export function currentLimits(api: ApiClient): UploadLimits {
  return cache.get(api)?.value ?? FALLBACK_LIMITS;
}

/**
 * Fetches the server's limits once per API client. Never rejects: a failed
 * request resolves with the defaults and is retried on the next call.
 */
export function loadUploadLimits(api: ApiClient): Promise<UploadLimits> {
  const cached = cache.get(api);
  if (cached) return cached.pending;
  const entry = {
    value: FALLBACK_LIMITS,
    pending: Promise.resolve(FALLBACK_LIMITS),
  };
  entry.pending = api
    .meta()
    .then((meta) => {
      const pick = (key: string, fallback: number): number => {
        const value = meta.limits[key];
        return typeof value === 'number' && value > 0 ? value : fallback;
      };
      entry.value = {
        maxImageBytes: pick('maxImageBytes', FALLBACK_LIMITS.maxImageBytes),
        maxAttachmentBytes: pick('maxAttachmentBytes', FALLBACK_LIMITS.maxAttachmentBytes),
        maxMermaidSourceLength: pick(
          'maxMermaidSourceLength',
          FALLBACK_LIMITS.maxMermaidSourceLength,
        ),
        imageMimeTypes:
          meta.imageMimeTypes.length > 0 ? meta.imageMimeTypes : FALLBACK_LIMITS.imageMimeTypes,
        attachmentExtensions:
          meta.attachmentExtensions.length > 0
            ? meta.attachmentExtensions
            : FALLBACK_LIMITS.attachmentExtensions,
      };
      return entry.value;
    })
    .catch(() => {
      // Ask again the next time an editor is created.
      cache.delete(api);
      return FALLBACK_LIMITS;
    });
  cache.set(api, entry);
  return entry.pending;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit] ?? 'KB'}`;
}

const IMAGE_EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match && match[1] ? match[1].toLowerCase() : '';
}

export type FileVerdict =
  | { ok: true; kind: 'image' | 'attachment' }
  | { ok: false; reason: 'type' | 'size' | 'empty'; message: string };

/** Client-side pre-check of one file against the server's limits. */
export function checkFile(
  file: { name: string; type: string; size: number },
  limits: UploadLimits,
): FileVerdict {
  const extension = fileExtension(file.name);
  const declared = file.type.toLowerCase();
  const imageType = limits.imageMimeTypes.includes(declared)
    ? declared
    : declared === '' || declared === 'application/octet-stream'
      ? (IMAGE_EXTENSION_TYPES[extension] ?? '')
      : '';
  const isImage = imageType !== '' && limits.imageMimeTypes.includes(imageType);
  if (!isImage && !limits.attachmentExtensions.includes(extension)) {
    return {
      ok: false,
      reason: 'type',
      message: `“${file.name}” is not a supported file type. Images (PNG, JPEG, GIF, WebP, SVG) and these attachments are accepted: ${limits.attachmentExtensions.join(', ')}.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, reason: 'empty', message: `“${file.name}” is empty.` };
  }
  const limit = isImage ? limits.maxImageBytes : limits.maxAttachmentBytes;
  if (file.size > limit) {
    return {
      ok: false,
      reason: 'size',
      message: `“${file.name}” is ${formatBytes(file.size)}; the limit for ${isImage ? 'images' : 'attachments'} is ${formatBytes(limit)}.`,
    };
  }
  return { ok: true, kind: isImage ? 'image' : 'attachment' };
}

const REJECT_MESSAGES: Record<UploadRejectReason, string> = {
  too_large: 'The file is larger than the server allows.',
  empty: 'The file is empty.',
  type_not_allowed: 'This file type is not allowed.',
  content_mismatch: 'The content of the file does not match its type.',
  dimensions_too_large: 'The image has too many pixels for the server to accept.',
  active_content: 'The file contains active content (such as scripts) and was rejected.',
  bad_filename: 'The file name is not allowed.',
};

export interface UploadFailure {
  message: string;
  /** Trying again without changing the file can succeed. */
  retryable: boolean;
  cancelled: boolean;
}

/** Turns a failed upload into words a user can act on. */
export function describeUploadError(error: unknown): UploadFailure {
  if (!(error instanceof ApiError)) {
    return { message: 'The upload failed unexpectedly.', retryable: true, cancelled: false };
  }
  switch (error.code) {
    case 'aborted':
      return { message: 'The upload was cancelled.', retryable: true, cancelled: true };
    case 'upload_rejected':
      return {
        message: error.reason ? REJECT_MESSAGES[error.reason] : 'The server rejected the file.',
        retryable: false,
        cancelled: false,
      };
    case 'payload_too_large':
      return { message: REJECT_MESSAGES.too_large, retryable: false, cancelled: false };
    case 'unsupported_media_type':
      return { message: REJECT_MESSAGES.type_not_allowed, retryable: false, cancelled: false };
    case 'quota_exceeded':
      return {
        message: 'This document has reached its storage limit for files.',
        retryable: false,
        cancelled: false,
      };
    case 'forbidden':
    case 'unauthenticated':
    case 'session_expired':
    case 'share_revoked':
    case 'share_expired':
    case 'not_found':
      return {
        message: 'You no longer have permission to upload to this document.',
        retryable: false,
        cancelled: false,
      };
    case 'rate_limited':
      return {
        message: 'Too many uploads at once. Try again in a moment.',
        retryable: true,
        cancelled: false,
      };
    case 'network_error':
      return {
        message: 'The upload could not be sent. Check the connection and try again.',
        retryable: true,
        cancelled: false,
      };
    case 'server_busy':
    case 'storage_unavailable':
    case 'internal':
      return {
        message: 'The server could not store the file right now. Try again.',
        retryable: true,
        cancelled: false,
      };
    default:
      return { message: 'The upload failed.', retryable: true, cancelled: false };
  }
}
