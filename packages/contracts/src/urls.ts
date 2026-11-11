/**
 * Link safety shared by the editor, the exporters, the server and the desktop
 * main process. Only absolute http(s), mailto and tel links are accepted;
 * `javascript:`, `data:`, `vbscript:`, `file:` and friends never survive.
 *
 * This module has no dependencies, so the desktop main process can use it
 * without bundling the editor.
 */
export const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'] as const;

/**
 * Code point ranges that browsers ignore or strip before resolving a URL
 * scheme (C0 controls and space, DEL and C1 controls, zero-width and
 * directional marks, line/paragraph separators, byte-order mark). Written as
 * numbers so no invisible character ever appears in this source file.
 */
const IGNORED_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0020],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0xfeff, 0xfeff],
];

function stripIgnoredCharacters(input: string): string {
  let output = '';
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0;
    const ignored = IGNORED_CODE_POINT_RANGES.some(
      ([low, high]) => codePoint >= low && codePoint <= high,
    );
    if (!ignored) output += character;
  }
  return output;
}

/** `example.com`, `example.com/page?x#y`. No scheme, credentials, port or backslash. */
const BARE_DOMAIN = /^[^/?#@:\\]+\.[^/?#@:\\]{2,}([/?#].*)?$/;

/**
 * Host names as they come out of the URL parser (lower case, IDNA already
 * applied): DNS labels of letters, digits and hyphens, an IPv4 address, or a
 * bracketed IPv6 address. The URL standard itself also lets characters such
 * as `;`, `'`, `"`, `,` and `*` through, which must never reach a place where
 * a host is interpolated into a header or a policy.
 */
const STRICT_HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])$/;

/**
 * Host names accepted in document links: the strict grammar plus underscores
 * inside labels and one trailing dot, both of which exist on the public web.
 */
const LINK_HOST =
  /^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*\.?|\[[0-9a-f:.]+\])$/;

/** True when `hostname` (as returned by `URL#hostname`) matches the strict host grammar. */
export function isStrictHostname(hostname: string): boolean {
  return hostname.length > 0 && hostname.length <= 253 && STRICT_HOST.test(hostname);
}

function isLinkHostname(hostname: string): boolean {
  return hostname.length > 0 && hostname.length <= 254 && LINK_HOST.test(hostname);
}

/**
 * Returns the normalised href if it is safe to store and render, else null.
 * Bare domains such as `example.com/page` are upgraded to https. Strings that
 * look like a Windows network path (`\\server\share`) are rejected, not upgraded.
 */
export function sanitizeLinkHref(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = stripIgnoredCharacters(input);
  if (!cleaned || cleaned.length > 2048) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(cleaned);
  if (!hasScheme && !BARE_DOMAIN.test(cleaned)) return null;

  let url: URL;
  try {
    url = new URL(hasScheme ? cleaned : `https://${cleaned}`);
  } catch {
    return null;
  }
  if (!(ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(url.protocol)) return null;
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (!isLinkHostname(url.hostname)) return null;
  }
  return url.href;
}

export function isSafeLinkHref(input: unknown): boolean {
  return sanitizeLinkHref(input) !== null;
}

/** Links that may be handed to the operating system by the desktop app. */
export function isSafeExternalUrl(input: unknown): boolean {
  const href = sanitizeLinkHref(input);
  if (!href) return false;
  const { protocol } = new URL(href);
  return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
}
