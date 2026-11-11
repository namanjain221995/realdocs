/**
 * Share-link, invitation-link and desktop-handoff URL formats.
 *
 * Secrets travel in the URL fragment, which browsers never send to the server,
 * never include in the Referer header and which the web app removes from the
 * address bar before exchanging it. Pure functions: safe to use in the
 * browser, the server and the Electron main process.
 */

import { isStrictHostname } from './urls';

export const DESKTOP_PROTOCOL = 'realtimedocs';
/** Origin of the packaged desktop renderer (custom privileged scheme). */
export const DESKTOP_APP_ORIGIN = 'app://realtimedocs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 32 random bytes, base64url without padding. */
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isCapabilitySecret(value: unknown): value is string {
  return typeof value === 'string' && SECRET_RE.test(value);
}

/**
 * Normalises a user-entered server address to an origin, or returns null.
 *
 * Only http(s) origins with a plain host name (DNS labels, IPv4 or bracketed
 * IPv6) are accepted. The URL standard would also let characters such as `;`,
 * `'`, `"`, `,` and `*` through in a host; an origin is interpolated into
 * headers and content-security policies, so those are rejected here.
 */
export function normalizeServerOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (!isStrictHostname(url.hostname)) return null;
  return url.origin;
}

/** Loopback hosts are the only place plain HTTP is acceptable. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function buildShareUrl(serverOrigin: string, grantId: string, secret: string): string {
  return `${serverOrigin}/s/${grantId}#${secret}`;
}

export interface ParsedShareLink {
  serverOrigin: string;
  grantId: string;
  secret: string;
}

export function parseShareUrl(input: string): ParsedShareLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search) return null;
  const match = /^\/s\/([0-9a-f-]{36})\/?$/.exec(url.pathname);
  const secret = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  if (!match || !match[1] || !isUuid(match[1]) || !isCapabilitySecret(secret)) return null;
  return { serverOrigin: url.origin, grantId: match[1], secret };
}

export function buildInvitationUrl(
  serverOrigin: string,
  invitationId: string,
  secret: string,
): string {
  return `${serverOrigin}/invite/${invitationId}#${secret}`;
}

export interface DesktopHandoff {
  serverOrigin: string;
  documentId: string;
  code: string;
}

/** `realtimedocs://open?server=<origin>&doc=<uuid>&code=<single-use code>` */
export function buildDesktopHandoffUrl(handoff: DesktopHandoff): string {
  const params = new URLSearchParams({
    server: handoff.serverOrigin,
    doc: handoff.documentId,
    code: handoff.code,
  });
  return `${DESKTOP_PROTOCOL}://open?${params.toString()}`;
}

/**
 * Strict parser for deep links received by the desktop app. Rejects other
 * schemes, actions, extra parameters, credentials, non-origin server values
 * and malformed identifiers. The caller must additionally compare
 * `serverOrigin` with the server the user configured.
 */
export function parseDesktopHandoffUrl(input: string): DesktopHandoff | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${DESKTOP_PROTOCOL}:`) return null;
  // `realtimedocs://open?...` parses with host "open"; tolerate `realtimedocs:open?...` too.
  const action = url.host || url.pathname.replace(/^\/+/, '');
  if (action !== 'open' || url.username || url.password || url.hash) return null;
  if (url.host && url.pathname !== '' && url.pathname !== '/') return null;
  const allowed = new Set(['server', 'doc', 'code']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return null;
  }
  const server = url.searchParams.getAll('server');
  const doc = url.searchParams.getAll('doc');
  const code = url.searchParams.getAll('code');
  if (server.length !== 1 || doc.length !== 1 || code.length !== 1) return null;
  const serverOrigin = normalizeServerOrigin(server[0] ?? '');
  if (!serverOrigin || serverOrigin !== server[0]) return null;
  if (!isUuid(doc[0]) || !isCapabilitySecret(code[0])) return null;
  return { serverOrigin, documentId: doc[0], code: code[0] };
}
