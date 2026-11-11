/**
 * Maps an `app://realtimedocs/...` request to a file inside the packaged
 * renderer directory, or refuses it. Pure (no Electron import) so the
 * traversal corpus in the unit tests exercises exactly the code that runs.
 *
 * Rules:
 * - scheme `app:`, host exactly `realtimedocs`, no port, no credentials;
 * - `GET`/`HEAD` only;
 * - only the known HTML entry points, `boot.js` and files below `/assets/`;
 * - plain ASCII paths only: no percent-encoding, backslashes or dot segments;
 * - the resolved path must stay inside the renderer root;
 * - only allow-listed file types, each with a fixed content type.
 */
import path from 'node:path';
import type { RendererWindowKind } from '../shared/csp';

export const APP_SCHEME = 'app';
export const APP_HOST = 'realtimedocs';

export const ENTRY_POINTS: Record<string, RendererWindowKind> = {
  '/panel.html': 'panel',
  '/settings.html': 'settings',
  '/probe.html': 'probe',
};

/**
 * Files served from the root besides the entry pages. `boot.js` is the
 * classic script every page loads before its module bundle.
 */
export const ROOT_FILES: readonly string[] = ['/boot.js'];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
};

export type AppRequestRefusal =
  | 'bad_url'
  | 'wrong_scheme'
  | 'wrong_host'
  | 'method_not_allowed'
  | 'bad_path'
  | 'not_allowed'
  | 'unsupported_type'
  | 'outside_root';

export type AppRequestResolution =
  | {
      ok: true;
      filePath: string;
      contentType: string;
      /** Set for HTML entry points: decides which CSP the document gets. */
      windowKind: RendererWindowKind | null;
      /** Hashed build assets can be cached; HTML must not be. */
      immutable: boolean;
    }
  | { ok: false; status: 400 | 403 | 404 | 405; reason: AppRequestRefusal };

/** Our own URLs are plain ASCII file names: nothing in them is ever percent-encoded. */
const SAFE_PATH = /^\/[A-Za-z0-9._\-/]+$/;

export function resolveAppRequest(
  requestUrl: string,
  method: string,
  rendererRoot: string,
): AppRequestResolution {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { ok: false, status: 400, reason: 'bad_url' };
  }
  if (url.protocol !== `${APP_SCHEME}:`) return { ok: false, status: 400, reason: 'wrong_scheme' };
  if (url.hostname !== APP_HOST || url.port !== '' || url.username !== '' || url.password !== '') {
    return { ok: false, status: 403, reason: 'wrong_host' };
  }
  const verb = method.toUpperCase();
  if (verb !== 'GET' && verb !== 'HEAD') {
    return { ok: false, status: 405, reason: 'method_not_allowed' };
  }

  // No percent-encoding at all (so no encoded or double-encoded separators,
  // dots or NULs), no backslashes, no empty or dot segments.
  const decoded = url.pathname;
  if (
    !SAFE_PATH.test(decoded) ||
    decoded.includes('//') ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return { ok: false, status: 400, reason: 'bad_path' };
  }

  const windowKind = ENTRY_POINTS[decoded] ?? null;
  const isAsset = decoded.startsWith('/assets/') && decoded.length > '/assets/'.length;
  const isRootFile = ROOT_FILES.includes(decoded);
  if (!windowKind && !isAsset && !isRootFile) {
    return { ok: false, status: 404, reason: 'not_allowed' };
  }

  const extension = path.posix.extname(decoded).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) return { ok: false, status: 404, reason: 'unsupported_type' };

  const root = path.resolve(rendererRoot);
  const filePath = path.resolve(root, `.${decoded}`);
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, status: 403, reason: 'outside_root' };
  }

  return { ok: true, filePath, contentType, windowKind, immutable: isAsset };
}

/** Headers sent with every `app://` response. */
export function appResponseHeaders(
  resolution: Extract<AppRequestResolution, { ok: true }>,
  contentSecurityPolicy: string,
): Record<string, string> {
  return {
    'Content-Type': resolution.contentType,
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Only feature names Chromium recognises: an unknown one is reported as a
    // console warning on every page load.
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=()',
    'Cache-Control': resolution.immutable ? 'public, max-age=31536000, immutable' : 'no-store',
  };
}
