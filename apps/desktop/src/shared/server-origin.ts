/**
 * Server-origin policy for the desktop companion.
 *
 * - The server is always an explicit, user-set origin (never taken from a link).
 * - `https` is required, except for loopback hosts (`localhost`, `127.0.0.1`),
 *   which is how an SSH tunnel or a local development server appears.
 * - Plain HTTP to a private-network host is refused unless the user turned on
 *   the clearly-labelled development override; plain HTTP to a public host is
 *   never accepted.
 *
 * Pure: shared by the main process, the settings window and the unit tests.
 */
import { isLoopbackOrigin, isStrictHostname, normalizeServerOrigin } from '@realtimedocs/contracts';

export type ServerTransport = 'https' | 'loopback_http' | 'insecure_lan_http';

export type OriginPolicyError =
  'invalid_address' | 'ipv6_literal_unsupported' | 'insecure_lan_disabled' | 'insecure_public_http';

export type OriginPolicyResult =
  | { ok: true; origin: string; transport: ServerTransport }
  | { ok: false; code: OriginPolicyError; origin: string | null };

export const ORIGIN_POLICY_MESSAGES: Record<OriginPolicyError, string> = {
  invalid_address:
    'Enter the address of your RealtimeDocs server, for example https://docs.example.com.',
  ipv6_literal_unsupported:
    'IPv6 literal addresses are not supported here. Use a host name or an IPv4 address.',
  insecure_lan_disabled:
    'This address uses plain HTTP on a private network. Use HTTPS, an SSH tunnel to localhost, or turn on the development override below.',
  insecure_public_http:
    'Plain HTTP is only accepted for localhost and, with the development override, private-network addresses. Use HTTPS for this server.',
};

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.length !== 4 || octets.some((octet) => octet > 255)) return null;
  return octets as [number, number, number, number];
}

const PRIVATE_SUFFIXES = ['.local', '.lan', '.internal', '.home.arpa', '.test', '.localdomain'];

/**
 * True for hosts that can only be on a private network: RFC 1918 ranges,
 * link-local, carrier-grade NAT (used by mesh VPNs), single-label names and
 * reserved private suffixes. Public host names and public IPs are false.
 */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[')) return false;
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (/^[\d.]+$/.test(host)) return false;
  if (!host.includes('.')) return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(host);
  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Normalises what the user typed. Unlike `normalizeServerOrigin`, a bare
 * loopback address (`localhost:4310`) is read as HTTP, because that is what a
 * tunnel or local server speaks; every other bare host is read as HTTPS.
 */
export function normalizeUserServerInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const origin = normalizeServerOrigin(trimmed);
  if (!origin) return null;
  if (!hasScheme && isLoopbackOrigin(origin)) {
    return normalizeServerOrigin(`http://${trimmed}`);
  }
  return origin;
}

/**
 * Host names that may be written into a Content-Security-Policy header.
 *
 * The grammar is the contracts' `isStrictHostname` (letters, digits and
 * hyphens in dot-separated labels, which covers IPv4 and punycode; the URL
 * standard also accepts `;`, `'`, `"`, `,` and `*`, which would end a source
 * list or start a new directive). One host kind is refused on top of it: an
 * IPv6 literal, because a CSP host source cannot express one, so such a server
 * could never be allow-listed for the renderer.
 */
function isPolicyHostname(hostname: string): boolean {
  return isStrictHostname(hostname) && !hostname.startsWith('[');
}

/**
 * An origin string exactly as `URL.origin` prints it: http(s) only, no
 * credentials, a host name that a policy can carry and nothing after the
 * optional port.
 */
export function isCanonicalHttpOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  if (!isPolicyHostname(url.hostname)) return false;
  return url.origin === value;
}

export function evaluateServerOrigin(
  input: string,
  options: { allowInsecureLan: boolean },
): OriginPolicyResult {
  const origin = normalizeUserServerInput(input);
  if (!origin) return { ok: false, code: 'invalid_address', origin: null };
  const url = new URL(origin);
  // CSP host sources cannot express IPv6 literals, so such a server could never
  // be allow-listed for the renderer.
  if (url.hostname.startsWith('[')) {
    return { ok: false, code: 'ipv6_literal_unsupported', origin };
  }
  if (!isCanonicalHttpOrigin(origin)) return { ok: false, code: 'invalid_address', origin: null };
  if (url.protocol === 'https:') return { ok: true, origin, transport: 'https' };
  if (isLoopbackOrigin(origin)) return { ok: true, origin, transport: 'loopback_http' };
  if (isPrivateNetworkHost(url.hostname)) {
    return options.allowInsecureLan
      ? { ok: true, origin, transport: 'insecure_lan_http' }
      : { ok: false, code: 'insecure_lan_disabled', origin };
  }
  return { ok: false, code: 'insecure_public_http', origin };
}

export type LinkOriginMatch = 'match' | 'accepted_alias' | 'mismatch';

export interface LinkOriginContext {
  /** The configured server; every request goes here and nowhere else. */
  serverOrigin: string | null;
  /**
   * An address the user explicitly accepted as another name of the configured
   * server (its self-reported public origin, e.g. when the desktop reaches the
   * server through an SSH tunnel). Links carrying it are still exchanged with
   * `serverOrigin` only.
   */
  acceptedLinkOrigin: string | null;
}

/** Exact origin comparison. Look-alike hosts, other ports and other schemes never match. */
export function classifyLinkOrigin(
  linkOrigin: string,
  context: LinkOriginContext,
): LinkOriginMatch {
  if (!context.serverOrigin) return 'mismatch';
  if (linkOrigin === context.serverOrigin) return 'match';
  if (context.acceptedLinkOrigin && linkOrigin === context.acceptedLinkOrigin) {
    return 'accepted_alias';
  }
  return 'mismatch';
}

/** Host (with port) for messages; never includes a path, query or fragment. */
export function originHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return 'unknown host';
  }
}
