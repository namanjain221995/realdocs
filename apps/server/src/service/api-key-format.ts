/**
 * API key format and the checks that need no database: parsing, scopes and
 * the CIDR allow-list.
 *
 * `rdk_<8 character id>_<43 character base64url secret>`. The id part is
 * public (it is shown in lists); the secret is 256 bits of randomness.
 */
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { SERVICE_SCOPES, type ServiceScope } from '@realtimedocs/contracts';
import { randomToken, safeEqual, sha256 } from '../auth/tokens';

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY_RE = /^rdk_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  /** The complete key. Shown once. */
  key: string;
  prefix: string;
  hash: Buffer;
}

export function generateApiKey(): GeneratedApiKey {
  const bytes = randomBytes(8);
  let id = '';
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  const key = `rdk_${id}_${randomToken()}`;
  return { key, prefix: `rdk_${id}`, hash: sha256(key) };
}

export interface ParsedApiKey {
  prefix: string;
  hash: Buffer;
}

/** Null when the token does not have the shape of an API key. */
export function parseApiKey(token: string): ParsedApiKey | null {
  const match = KEY_RE.exec(token);
  if (!match) return null;
  return { prefix: `rdk_${match[1]}`, hash: sha256(token) };
}

/** True for anything that is *meant* to be an API key (it is never treated as another bearer token). */
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith('rdk_');
}

/** Constant-time comparison of the stored hash with the presented key's hash. */
export function keyMatches(stored: Uint8Array | null, presented: Uint8Array): boolean {
  return safeEqual(stored ?? sha256(''), presented);
}

export function hasScope(granted: readonly string[], required: ServiceScope): boolean {
  return granted.includes(required);
}

export function isKnownScope(value: string): value is ServiceScope {
  return (SERVICE_SCOPES as readonly string[]).includes(value);
}

// ── CIDR ────────────────────────────────────────────────────────────────────

function ipv4ToBigInt(address: string): bigint | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function ipv6ToBigInt(address: string): bigint | null {
  let text = address;
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  // Embedded IPv4 tail (::ffff:1.2.3.4).
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = ipv4ToBigInt(tail[1] as string);
    if (v4 === null) return null;
    const high = (v4 >> 16n).toString(16);
    const low = (v4 & 0xffffn).toString(16);
    text = `${text.slice(0, text.length - (tail[1] as string).length)}${high}:${low}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves[1] !== undefined && halves[1] !== '' ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...rest];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

interface Network {
  family: 4 | 6;
  base: bigint;
  bits: number;
}

/** Parses `203.0.113.0/24`, `2001:db8::/32` or a single address. Null when invalid. */
export function parseCidr(text: string): Network | null {
  const [address, prefix, ...extra] = text.trim().split('/');
  if (!address || extra.length > 0) return null;
  const family = isIP(address);
  if (family === 0) return null;
  const max = family === 4 ? 32 : 128;
  let bits = max;
  if (prefix !== undefined) {
    if (!/^\d{1,3}$/.test(prefix)) return null;
    bits = Number(prefix);
    if (bits > max) return null;
  }
  const value = family === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  if (value === null) return null;
  const shift = BigInt(max - bits);
  return { family: family as 4 | 6, base: (value >> shift) << shift, bits };
}

/** True when `ip` is inside at least one of the CIDR blocks. Invalid blocks never match. */
export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  let address = ip.trim();
  if (address.startsWith('::ffff:') && address.includes('.')) address = address.slice(7);
  const family = isIP(address);
  if (family === 0) return false;
  const value = family === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  if (value === null) return false;
  const max = family === 4 ? 32 : 128;
  return cidrs.some((text) => {
    const network = parseCidr(text);
    if (!network || network.family !== family) return false;
    const shift = BigInt(max - network.bits);
    return (value >> shift) << shift === network.base;
  });
}
