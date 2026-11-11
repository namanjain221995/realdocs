import type { IncomingMessage } from 'node:http';

function normalize(address: string | undefined): string {
  if (!address) return 'unknown';
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) and bracketed forms.
  const trimmed = address.trim().replace(/^\[|\]$/g, '');
  return trimmed.startsWith('::ffff:') && trimmed.includes('.') ? trimmed.slice(7) : trimmed;
}

/**
 * Client address of a raw HTTP request (used for WebSocket upgrades, where
 * Fastify's `request.ip` is not available). Mirrors Fastify's `trustProxy`:
 * `false` uses the socket address, `true` the left-most `X-Forwarded-For`
 * entry, and a number `n` skips that many trusted hops from the right.
 */
export function clientIp(request: IncomingMessage, trustProxy: boolean | number): string {
  const remote = normalize(request.socket.remoteAddress);
  if (trustProxy === false) return remote;
  const header = request.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => normalize(part))
    .filter((part) => part !== 'unknown' && part !== '');
  if (forwarded.length === 0) return remote;
  // Nearest hop first: the socket peer, then X-Forwarded-For from right to left.
  const chain = [remote, ...forwarded.reverse()];
  if (trustProxy === true) return chain[chain.length - 1] ?? remote;
  return chain[Math.min(trustProxy, chain.length - 1)] ?? remote;
}
