/**
 * Rate limits (docs/architecture.md §3), built on `@fastify/rate-limit`'s
 * in-memory store through `createRateLimit`. Limits are per process.
 *
 * Two flavours:
 * - "attempt" limits count every request (`consume`);
 * - "failure" limits count only failed attempts (`assertAllowed` before the
 *   check, `recordFailure` after a failure), so legitimate users behind one
 *   address do not lock each other out by signing in successfully.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RateLimitConfig } from '../config';
import { errors } from '../errors';

declare module 'fastify' {
  interface FastifyRequest {
    /** Key the next rate-limit check uses (set by the helpers in this file). */
    rdRateKey: string;
  }
}

export interface Limiter {
  /** Counts one event and throws `rate_limited` when the key is over its limit. */
  consume(request: FastifyRequest, key: string): Promise<void>;
  /** Throws `rate_limited` when the key has no attempts left. Does not count. */
  assertAllowed(request: FastifyRequest, key: string): Promise<void>;
  /** Counts one failed attempt. Never throws. */
  recordFailure(request: FastifyRequest, key: string): Promise<void>;
}

export interface Limiters {
  api: Limiter;
  loginIp: Limiter;
  loginEmail: Limiter;
  shareExchangeIp: Limiter;
  shareExchangeGrant: Limiter;
  inviteIp: Limiter;
  signupIp: Limiter;
  signupEmail: Limiter;
  desktopRedeemIp: Limiter;
  collabTicket: Limiter;
  upload: Limiter;
}

const MINUTE = 60_000;

export function createLimiters(app: FastifyInstance, config: RateLimitConfig): Limiters {
  const make = (max: number, windowMs: number): Limiter => {
    const check = app.createRateLimit({
      max,
      timeWindow: windowMs,
      keyGenerator: (request) => request.rdRateKey,
    });
    return {
      async consume(request, key) {
        request.rdRateKey = key;
        const result = await check(request);
        if (!result.isAllowed && result.isExceeded) {
          throw errors.rateLimited(result.ttlInSeconds);
        }
      },
      async assertAllowed(request, key) {
        request.rdRateKey = key;
        const result = await check(request, { increment: false });
        if (!result.isAllowed && result.remaining <= 0) {
          throw errors.rateLimited(result.ttlInSeconds);
        }
      },
      async recordFailure(request, key) {
        request.rdRateKey = key;
        await check(request);
      },
    };
  };

  return {
    api: make(config.apiPerMinute, MINUTE),
    loginIp: make(config.loginPerIp, 5 * MINUTE),
    loginEmail: make(config.loginPerEmail, 15 * MINUTE),
    shareExchangeIp: make(config.shareExchangePerIp, 5 * MINUTE),
    shareExchangeGrant: make(config.shareExchangePerGrant, 5 * MINUTE),
    inviteIp: make(config.invitePerIp, 10 * MINUTE),
    signupIp: make(config.signupPerIp, 10 * MINUTE),
    signupEmail: make(config.signupPerEmail, 60 * MINUTE),
    desktopRedeemIp: make(config.desktopRedeemPerIp, 5 * MINUTE),
    collabTicket: make(config.collabTicketPerMinute, MINUTE),
    upload: make(config.uploadPerMinute, MINUTE),
  };
}
