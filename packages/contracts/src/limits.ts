/**
 * Default limits. The server may override the configurable ones through
 * environment variables and publishes the effective values at `GET /api/meta`;
 * clients must read them from there rather than assuming these defaults.
 */
export const DEFAULT_LIMITS = {
  titleMaxLength: 200,
  displayNameMaxLength: 80,
  emailMaxLength: 254,
  passwordMinLength: 12,
  passwordMaxLength: 256,
  snapshotNameMaxLength: 120,
  shareLabelMaxLength: 80,
  /** Inline images (PNG, JPEG, GIF, WebP, validated SVG). */
  maxImageBytes: 10 * 1024 * 1024,
  /** Download-only attachments. */
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxImageDimension: 12_000,
  /** Total stored asset bytes per document. */
  documentAssetQuotaBytes: 500 * 1024 * 1024,
  /** Soft limit for the encoded collaborative state of one document. */
  maxDocumentStateBytes: 8 * 1024 * 1024,
  /** Largest accepted WebSocket frame on the collaboration endpoint. */
  maxCollabMessageBytes: 4 * 1024 * 1024,
  /** Largest accepted JSON body on ordinary API routes. */
  maxJsonBodyBytes: 256 * 1024,
  maxMermaidSourceLength: 20_000,
} as const;

export type Limits = { -readonly [K in keyof typeof DEFAULT_LIMITS]: number };

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/**
 * Extensions accepted as download-only attachments. They are never rendered
 * or executed by RealtimeDocs and are always served with
 * `Content-Disposition: attachment` and `application/octet-stream`.
 */
export const ATTACHMENT_EXTENSIONS = [
  'pdf',
  'txt',
  'md',
  'csv',
  'tsv',
  'json',
  'log',
  'rtf',
  'zip',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
] as const;
export type AttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number];

/** Short-lived credential lifetimes (milliseconds). */
export const TTL = {
  collabTicketMs: 60_000,
  desktopHandoffCodeMs: 60_000,
} as const;
