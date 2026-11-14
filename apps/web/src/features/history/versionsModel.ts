/**
 * The "version history document": URLs of the downloads, the JSON form the
 * "View versions" panel reads, and the pure helpers that turn it into rows.
 * Everything here is plain data; the panel renders it as text.
 */
import { ApiError, type ClientErrorCode } from '@realtimedocs/contracts';

export interface VersionImage {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  firstVersion: number;
  lastVersion: number | null;
  url: string;
}

export interface LineDetail {
  text: string;
  at: string;
  atText: string;
}

export interface VersionEditor {
  name: string;
  role: string;
  email: string | null;
  kind: string;
}

export interface VersionEntry {
  addedDetail?: LineDetail[];
  removedDetail?: LineDetail[];
  action?: string;
  startedAt?: string;
  startedAtText?: string;
  editor?: VersionEditor;
  version: number;
  editedAt: string;
  editedAtText: string;
  editedBy: string;
  added: string[];
  removed: string[];
  snapshot: string;
  images: string[];
}

export interface VersionHistoryDocument {
  document: { id: string; title: string; url: string };
  session: { id: string; candidate: string; company: string; round: string | number } | null;
  trackingStartedAt: string | null;
  finalizedAt: string | null;
  timezone: string;
  versions: VersionEntry[];
  finalContent: string;
  images: VersionImage[];
}

export const VERSIONS_PAGE_SIZE = 25;

/** The browser's IANA time zone, or `undefined` when it cannot be named. */
export function browserTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone || undefined;
  } catch {
    return undefined;
  }
}

function base(documentId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/version-history`;
}

export function versionsTxtUrl(documentId: string, timeZone: string | undefined): string {
  const zone = timeZone ? `&timezone=${encodeURIComponent(timeZone)}` : '';
  return `${base(documentId)}?format=txt${zone}`;
}

export function versionsZipUrl(documentId: string): string {
  return `${base(documentId)}/archive`;
}

export function versionsJsonUrl(documentId: string, timeZone: string | undefined): string {
  const zone = timeZone ? `&timezone=${encodeURIComponent(timeZone)}` : '';
  return `${base(documentId)}?format=json${zone}`;
}

/** The server's image path when it is a path on this origin, else `null` (never link elsewhere). */
export function safeImageUrl(url: string): string | null {
  return /^\/(?!\/)[^\\\s]*$/.test(url) ? url : null;
}

export interface ImageLine {
  id: string;
  /** The rest of the line after the marker, e.g. "image pasted (images/x.png)". */
  rest: string;
}

/** Parses a line that starts with `[IMAGE <id>]`; `null` for any other line. */
export function parseImageLine(line: string): ImageLine | null {
  const match = /^\[IMAGE ([^\]\s]{1,200})\]\s?(.*)$/s.exec(line);
  if (!match) return null;
  return { id: match[1] as string, rest: match[2] ?? '' };
}

/** The snapshot's lines, kept as they are (empty lines too), without a trailing empty line. */
export function snapshotLines(snapshot: string): string[] {
  const lines = snapshot.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

export interface PageSlice<T> {
  items: T[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
}

/** One page of a list, 1-based and clamped into range. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  size = VERSIONS_PAGE_SIZE,
): PageSlice<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pageCount, Math.max(1, Math.floor(page) || 1));
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: current,
    pageCount,
    from: slice.length ? start + 1 : 0,
    to: start + slice.length,
  };
}

/** "Aarav Sharma (Candidate, aarav@example.com)" when the editor is known, else the plain name. */
export function editorText(entry: Pick<VersionEntry, 'editedBy' | 'editor'>): string {
  const editor = entry.editor;
  if (!editor || typeof editor.name !== 'string') return entry.editedBy;
  const extra = [editor.role, editor.email].filter((part): part is string => !!part);
  return extra.length ? `${editor.name} (${extra.join(', ')})` : editor.name;
}

export interface ShownLine {
  text: string;
  atText: string | null;
}

/** The lines to show: the detail array when it matches the plain one, else the plain lines. */
export function shownLines(plain: string[], detail: LineDetail[] | undefined): ShownLine[] {
  if (Array.isArray(detail) && detail.length === plain.length && detail.length > 0) {
    return detail.map((each) => ({
      text: String(each.text),
      atText: typeof each.atText === 'string' && each.atText ? each.atText : null,
    }));
  }
  return plain.map((text) => ({ text, atText: null }));
}

/** Images keyed by id. */
export function imagesById(images: readonly VersionImage[]): Map<string, VersionImage> {
  return new Map(images.map((image) => [image.id, image]));
}

/** The images that first appeared in `version`, in list order. */
export function imagesFirstIn(images: readonly VersionImage[], version: number): VersionImage[] {
  return images.filter((image) => image.firstVersion === version);
}

function errorCodeFor(status: number): ClientErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'server_busy';
  return 'internal';
}

/** Loads the JSON form; failures are `ApiError`s so the shared error screens apply. */
export async function fetchVersionHistory(
  documentId: string,
  signal?: AbortSignal,
): Promise<VersionHistoryDocument> {
  let response: Response;
  try {
    response = await fetch(versionsJsonUrl(documentId, browserTimeZone()), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    throw new ApiError('network_error', 'The version history could not be reached.');
  }
  if (!response.ok) {
    throw new ApiError(errorCodeFor(response.status), 'The version history could not be loaded.', {
      status: response.status,
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('invalid_response', 'The version history answer was not readable.');
  }
  const value = body as Partial<VersionHistoryDocument> | null;
  if (!value || !Array.isArray(value.versions)) {
    throw new ApiError('invalid_response', 'The version history answer was not readable.');
  }
  return {
    document: value.document ?? { id: documentId, title: '', url: '' },
    session: value.session ?? null,
    trackingStartedAt: value.trackingStartedAt ?? null,
    finalizedAt: value.finalizedAt ?? null,
    timezone: value.timezone ?? 'UTC',
    versions: value.versions.map((each) => ({
      ...each,
      added: Array.isArray(each.added) ? each.added : [],
      removed: Array.isArray(each.removed) ? each.removed : [],
      images: Array.isArray(each.images) ? each.images : [],
      snapshot: typeof each.snapshot === 'string' ? each.snapshot : '',
    })),
    finalContent: value.finalContent ?? '',
    images: Array.isArray(value.images) ? value.images : [],
  };
}
