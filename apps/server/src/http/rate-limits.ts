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
  /** Requests per API key per minute. */
  apiKey: Limiter;
  /** Failed API key authentications per address per 5 minutes. */
  apiKeyFailures: Limiter;
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
  download: Limiter;
  /** Failed sign-ins for one account from all addresses together. */
  loginEmailAnywhere: Limiter;
}

const MINUTE = 60_000;

export function createLimiters(app: FastifyInstance, config: RateLimitConfig): Limiters {
  let limiterIndex = 0;
  const make = (max: number, windowMs: number): Limiter => {
    // With the shared (Redis) store every limiter counts in the same key space,
    // so each one prefixes its keys. The order of the limiters below is therefore
    // part of the key format: add new limiters at the end.
    limiterIndex += 1;
    const prefix = `l${limiterIndex}:`;
    const counted = app.createRateLimit({
      max,
      timeWindow: windowMs,
      keyGenerator: (request) => `${prefix}${request.rdRateKey}`,
    });
    // The shared store can be unreachable. A limiter that cannot count lets the
    // request through: refusing every sign-in and upload while Redis restarts
    // would turn a brief outage of a helper into an outage of the product.
    const check: typeof counted = (async (...args: Parameters<typeof counted>) => {
      try {
        return await counted(...args);
      } catch (err) {
        app.log.warn({ err }, 'rate limit could not be counted; request allowed');
        return { isAllowed: true, isExceeded: false, remaining: max, ttlInSeconds: 0 };
      }
    }) as typeof counted;
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
    apiKey: make(config.apiKeyPerMinute, MINUTE),
    apiKeyFailures: make(60, 5 * MINUTE),
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
    download: make(config.downloadPerIp, 10 * MINUTE),
    loginEmailAnywhere: make(config.loginPerEmail * 10, 15 * MINUTE),
  };
}
