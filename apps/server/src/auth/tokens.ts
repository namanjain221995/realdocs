import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** 32 random bytes as base64url without padding (43 characters). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newId(): string {
  return randomUUID();
}

export function sha256(value: string | Uint8Array): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time comparison of two byte strings of any length. */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    // Compare against itself so the work does not depend on where they differ.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function safeEqualString(a: string, b: string): boolean {
  return safeEqual(sha256(a), sha256(b));
}

/**
 * Per-session CSRF token: an HMAC of the session id. It is returned by
 * `GET /api/auth/session` and must be echoed in `X-RD-CSRF` on mutations.
 */
export function csrfTokenFor(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:v1:${sessionId}`).digest('base64url');
}
