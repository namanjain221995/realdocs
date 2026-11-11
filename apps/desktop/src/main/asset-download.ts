/**
 * Downloading an attachment of the open document.
 *
 * The editor's download chip is an ordinary link to the server's asset
 * endpoint. In the panel that would be a navigation away from the packaged
 * page, which is never allowed, and the page has no credential to give to the
 * server anyway. The main process therefore recognises exactly this one kind
 * of link and fetches the file itself:
 *
 * - with the session token on that one request and nothing else (no cookies,
 *   no Origin, no Referer);
 * - without following redirects. A redirect is an error: the token must never
 *   travel to wherever a redirect points. Chromium's own download machinery is
 *   not used for this reason. Observed with Electron 45.2.3 on Linux:
 *   `session.downloadURL` with a header sends that header on to the target of
 *   a redirect on another origin, the `webRequest` listeners that guard the
 *   panel's requests never see such a download, and with
 *   `webContents.downloadURL` a redirect whose headers a listener changes ends
 *   the main process;
 * - into a file the person chooses in the operating system's save dialog,
 *   under a name taken from the server's `Content-Disposition` header and
 *   cleaned here.
 *
 * Pure: no Electron imports. The dialog and the file are the controller's.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AssetDownloadContext {
  /** The configured server. */
  serverOrigin: string | null;
  /** The document the current session is scoped to. */
  documentId: string | null;
}

export interface AssetDownload {
  /** Rebuilt from its checked parts; never the string that was passed in. */
  url: string;
  assetId: string;
}

/**
 * Returns the download if `input` is exactly
 * `<configured origin>/api/documents/<open document>/assets/<uuid>?download=1`,
 * otherwise null. Another origin, another document, credentials in the URL, a
 * fragment, other or extra query parameters, or a path that only looks similar
 * are all refused.
 */
export function matchAssetDownload(
  input: unknown,
  context: AssetDownloadContext,
): AssetDownload | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  if (!context.serverOrigin || !context.documentId || !UUID.test(context.documentId)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.origin !== context.serverOrigin) return null;
  if (url.username || url.password || url.hash) return null;
  const prefix = `/api/documents/${context.documentId}/assets/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const assetId = url.pathname.slice(prefix.length);
  if (!UUID.test(assetId)) return null;
  if (url.search !== '?download=1') return null;
  return { url: `${context.serverOrigin}${prefix}${assetId}?download=1`, assetId };
}

/**
 * The largest attachment the app downloads. The file is held in memory while
 * the save dialog is open. The server's default limit for an attachment is 25 MB.
 */
export const MAX_ATTACHMENT_DOWNLOAD_BYTES = 256 * 1024 * 1024;

const MAX_FILE_NAME_LENGTH = 150;
/** Marks that turn the direction of text around; they can make `…exe` look like `…txt`. */
const DIRECTION_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Control characters, and the characters Windows refuses in a file name. */
function isRefusedInFileNames(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || '<>:"/\\|?*'.includes(character);
}
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * The file name a `Content-Disposition` header proposes, or null. The UTF-8
 * form (`filename*`, RFC 5987) wins over the plain one, as RFC 6266 says. The
 * result is what the server said, not yet something to give to a file dialog:
 * see `safeFileName`.
 */
export function fileNameFromContentDisposition(header: string | null | undefined): string | null {
  if (typeof header !== 'string' || header.length === 0 || header.length > 4096) return null;
  const extended = /;\s*filename\*\s*=\s*UTF-8''([^;]*)/i.exec(header);
  if (extended?.[1]) {
    try {
      const decoded = decodeURIComponent(extended[1].trim());
      if (decoded !== '') return decoded;
    } catch {
      // Not valid percent-encoding: use the plain parameter instead.
    }
  }
  const quoted = /;\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted?.[1] !== undefined) return quoted[1].replace(/\\(.)/g, '$1') || null;
  const bare = /;\s*filename\s*=\s*([^;"\s]+)/i.exec(header);
  return bare?.[1] ?? null;
}

/**
 * A name that can be proposed in a save dialog on any operating system. It is
 * always a plain file name: never a path, never hidden, never a Windows device
 * name, without control characters, and without the characters that turn the
 * direction of text around (they can make `…exe` look like `…txt`).
 */
export function safeFileName(input: string | null | undefined, fallback = 'attachment'): string {
  let name = typeof input === 'string' ? input.normalize('NFC') : '';
  // Only the last segment, whichever separator was used.
  name = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  name = [...name.replace(DIRECTION_MARKS, '').replace(/\s+/g, ' ')]
    .map((character) => (isRefusedInFileNames(character) ? '_' : character))
    .join('')
    .trim()
    // Not hidden, and no trailing dot or space (Windows drops those silently).
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '');
  if (WINDOWS_DEVICE_NAME.test(name)) name = `_${name}`;
  const characters = [...name];
  if (characters.length > MAX_FILE_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? [...name.slice(dot)] : [];
    const kept = extension.length > 0 && extension.length <= 16 ? extension : [];
    name = [...characters.slice(0, MAX_FILE_NAME_LENGTH - kept.length), ...kept].join('');
  }
  return name === '' ? fallback : name;
}

/**
 * A neutral name for the save dialog while private mode is on: the dialog is
 * drawn by the operating system, outside the protected window, so it shows
 * "attachment" and the extension instead of the name the document gave it.
 */
export function neutralFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  return /^\.[A-Za-z0-9]{1,10}$/.test(extension) ? `attachment${extension}` : 'attachment';
}

export type BodyResult =
  { ok: true; chunks: Uint8Array[]; size: number } | { ok: false; reason: 'too_large' };

/**
 * Reads a response body into memory, giving up (and cancelling the stream) as
 * soon as it is larger than `maxBytes`, whatever the response claimed about
 * its length.
 */
export async function readBodyLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<BodyResult> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { ok: true, chunks, size };
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
}
