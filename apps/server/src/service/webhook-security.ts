/**
 * Webhook signing and the checks that keep the delivery worker from being
 * used to reach internal services (SSRF). Pure functions plus one DNS lookup
 * wrapper.
 */
import { createHmac } from 'node:crypto';
import dns from 'node:dns';
import { isIP } from 'node:net';
import { safeEqual } from '../auth/tokens';
import { ipInCidrs } from './api-key-format';

/** `v1=<hex hmac-sha256(secret, "<timestamp>.<raw body>")>` */
export function signWebhook(secret: string, timestamp: number | string, rawBody: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

/** Receiver-side check (documented in docs/webhooks.md; used by the tests). */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  header: string,
  toleranceSeconds = 300,
  now = Date.now(),
): boolean {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody));
  return safeEqual(expected, Buffer.from(header));
}

const NON_PUBLIC_BLOCKS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/3',
  '::/128',
  '::1/128',
  // IPv4-mapped and 6to4 addresses that did not decode to an IPv4 address below.
  '::ffff:0:0/96',
  '2002::/16',
  '64:ff9b::/96',
  '100::/64',
  '2001:db8::/32',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

/** True for loopback, private, link-local, multicast, reserved and documentation addresses. */
export function isNonPublicAddress(address: string): boolean {
  let ip = address.trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1] as string;
  // The URL parser writes a mapped address in hexadecimal: `::ffff:7f00:1` is 127.0.0.1.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const high = Number.parseInt(hex[1] as string, 16);
    const low = Number.parseInt(hex[2] as string, 16);
    ip = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  if (isIP(ip) === 0) return true; // not an address: refuse
  return ipInCidrs(ip, NON_PUBLIC_BLOCKS);
}

export type UrlProblem = string | null;

/** Syntax and policy checks that need no network. Returns a message, or null when acceptable. */
export function webhookUrlProblem(url: string, production: boolean): UrlProblem {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Enter a complete URL such as https://example.com/hooks/realtimedocs.';
  }
  if (parsed.username || parsed.password) return 'The URL must not contain credentials.';
  if (parsed.hash) return 'The URL must not contain a fragment.';
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol === 'https:') {
    // fall through to the address check
  } else if (parsed.protocol === 'http:') {
    if (production) return 'Only https:// URLs are accepted.';
    if (!loopback) return 'Plain http:// is only accepted for localhost and 127.0.0.1.';
  } else {
    return 'Only https:// URLs are accepted.';
  }
  if (production) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return 'The URL must point to a public host.';
    }
    if (isIP(host) !== 0 && isNonPublicAddress(host)) {
      return 'The URL must point to a public address.';
    }
  }
  return null;
}

/**
 * `lookup` for http(s).request: resolves the name and refuses to connect to a
 * non-public address, at connect time, so a name that changes its answer
 * between registration and delivery (DNS rebinding) is caught too.
 */
export function publicOnlyLookup(production: boolean): typeof dns.lookup {
  const lookup = ((
    hostname: string,
    options: dns.LookupOptions | number | undefined,
    callback: unknown,
  ) => {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address?: string | dns.LookupAddress[],
      family?: number,
    ) => void;
    const opts = (
      typeof options === 'object' && options !== null ? options : {}
    ) as dns.LookupOptions;
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return cb(error);
      const allowed = production
        ? addresses.filter((entry) => !isNonPublicAddress(entry.address))
        : addresses;
      if (allowed.length === 0) {
        const refused = new Error(
          'The target resolves to a non-public address.',
        ) as NodeJS.ErrnoException;
        refused.code = 'EBLOCKED';
        return cb(refused);
      }
      if (opts.all) return cb(null, allowed);
      const first = allowed[0] as dns.LookupAddress;
      return cb(null, first.address, first.family);
    });
  }) as unknown as typeof dns.lookup;
  return lookup;
}

/** At registration: resolves the host and refuses non-public answers (production only). */
export async function assertPublicHost(url: string): Promise<UrlProblem> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0)
    return isNonPublicAddress(host) ? 'The URL must point to a public address.' : null;
  try {
    const addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => isNonPublicAddress(entry.address))) {
      return 'The host resolves to a non-public address.';
    }
    return null;
  } catch {
    return 'The host name could not be resolved.';
  }
}
