/**
 * The "version history document" of a document: its recorded history folded into numbered
 * versions (one editor, one stretch of work), each with the lines that were added and removed and
 * the whole text at that point. It is produced as plain text (`doc.txt`), as JSON, and as a zip
 * with the images that ever appeared (docs/version-history.md).
 */
import { isIanaTimezone } from './service';
import { z } from './zod';

/** Bounds and defaults of the grouping parameters, in seconds. */
export const VERSION_HISTORY_GROUPING = {
  gapSeconds: { min: 1, max: 3600, default: 15 },
  maxSpanSeconds: { min: 5, max: 86_400, default: 60 },
} as const;

export const VersionHistoryQuery = z.object({
  /** `txt` is the document itself (`doc.txt`); `json` is the same content as data. */
  format: z.enum(['txt', 'json']).default('txt'),
  /**
   * IANA time zone of the "Edited At" lines. Default: the interview session's time zone when the
   * document belongs to one, otherwise UTC.
   */
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isIanaTimezone, { message: 'Must be an IANA time zone such as Asia/Kolkata.' })
    .optional(),
  /** A pause of the same editor longer than this starts a new version. */
  gapSeconds: z.coerce
    .number()
    .int()
    .min(VERSION_HISTORY_GROUPING.gapSeconds.min)
    .max(VERSION_HISTORY_GROUPING.gapSeconds.max)
    .default(VERSION_HISTORY_GROUPING.gapSeconds.default),
  /** One version never covers more than this much time. */
  maxSpanSeconds: z.coerce
    .number()
    .int()
    .min(VERSION_HISTORY_GROUPING.maxSpanSeconds.min)
    .max(VERSION_HISTORY_GROUPING.maxSpanSeconds.max)
    .default(VERSION_HISTORY_GROUPING.maxSpanSeconds.default),
});
export type VersionHistoryQuery = z.infer<typeof VersionHistoryQuery>;

/** The grouping parameters alone (image list and archive). */
export const VersionHistoryGroupingQuery = VersionHistoryQuery.omit({ format: true });
export type VersionHistoryGroupingQuery = z.infer<typeof VersionHistoryGroupingQuery>;

export const VersionHistoryImage = z.object({
  /** The asset id of the image; the same id the document text names in `[IMAGE <id>]`. */
  id: z.string(),
  /** `<id>.<extension>`: the file's name under `images/` in the archive. */
  fileName: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  /** Hex SHA-256 of the file. */
  sha256: z.string(),
  /** The version in which the image first appeared. */
  firstVersion: z.number().int(),
  /** The last version that still contained it; null while it is in the document. */
  lastVersion: z.number().int().nullable(),
  /** Path of the image's bytes, relative to the server. */
  url: z.string(),
});
export type VersionHistoryImage = z.infer<typeof VersionHistoryImage>;

/** One added or removed line with the server time of the change that added or removed it. */
export const VersionHistoryLine = z.object({
  text: z.string(),
  at: z.string(),
  /** The time as printed in the text form, e.g. `02:21:18 AM`, in the document's time zone. */
  atText: z.string(),
});
export type VersionHistoryLine = z.infer<typeof VersionHistoryLine>;

export const VERSION_ACTIONS = [
  'Typed',
  'Pasted',
  'Deleted',
  'Formatted',
  'Restored',
  'Initial',
  'Mixed',
] as const;

export const VersionHistoryEditor = z.object({
  name: z.string(),
  /** `Candidate`, `Interviewer`, `Admin`, `Member`, `Guest`, `Service` or `System`. */
  role: z.string(),
  /** The account's or the interview participant's address; null for anonymous link guests. */
  email: z.string().nullable(),
  kind: z.enum(['user', 'guest', 'service', 'system']),
});
export type VersionHistoryEditor = z.infer<typeof VersionHistoryEditor>;

export const VersionHistoryVersion = z.object({
  version: z.number().int(),
  /** Server time of the first change in the version, ISO 8601. */
  startedAt: z.string(),
  startedAtText: z.string(),
  /** Server time of the last change in the version, ISO 8601. */
  editedAt: z.string(),
  /** The same moment as printed in the text form, e.g. `2026-06-30 02:21:18 AM IST`. */
  editedAtText: z.string(),
  /** The editor as printed: `Meera Iyer (Interviewer, meera@acme.example)`. */
  editedBy: z.string(),
  editor: VersionHistoryEditor,
  /**
   * What the editor did: typed, pasted (text or an image; always a version of its own), deleted,
   * only formatted, a restored version, the content that existed when recording began
   * (`Initial`), or several of these (`Mixed`).
   */
  action: z.enum(VERSION_ACTIONS),
  /** Lines present now and not in the previous version, in document order. */
  added: z.array(z.string()),
  /** Lines of the previous version that are gone. */
  removed: z.array(z.string()),
  /** `added` with the exact time each line appeared. */
  addedDetail: z.array(VersionHistoryLine),
  /** `removed` with the exact time each line went. */
  removedDetail: z.array(VersionHistoryLine),
  /** The whole text of the document at this version. */
  snapshot: z.string(),
  /** Ids of the images in the document at this version. */
  images: z.array(z.string()),
});
export type VersionHistoryVersion = z.infer<typeof VersionHistoryVersion>;

export const VersionHistoryResponse = z.object({
  document: z.object({ id: z.string(), title: z.string(), url: z.string() }),
  session: z
    .object({
      id: z.string(),
      candidate: z.string().nullable(),
      company: z.string(),
      round: z.object({ number: z.string(), name: z.string().nullable() }),
    })
    .nullable(),
  /** Time of the first recorded history entry; null when nothing was recorded. */
  trackingStartedAt: z.string().nullable(),
  /** When the session was closed, otherwise the time of the last recorded entry. */
  finalizedAt: z.string().nullable(),
  timezone: z.string(),
  versions: z.array(VersionHistoryVersion),
  /** Text of the document after the last recorded entry. */
  finalContent: z.string(),
  images: z.array(VersionHistoryImage),
  /** True when the size limit cut the list of versions; `finalContent` is complete either way. */
  truncated: z.boolean(),
});
export type VersionHistoryResponse = z.infer<typeof VersionHistoryResponse>;

export const VersionHistoryImagesResponse = z.object({ images: z.array(VersionHistoryImage) });
export type VersionHistoryImagesResponse = z.infer<typeof VersionHistoryImagesResponse>;
