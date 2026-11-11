/**
 * Capped exponential backoff with jitter, shared by the reconnect loop and
 * the bounded `resync` retries.
 */
export interface BackoffOptions {
  /** Delay of the first retry before jitter. */
  baseMs: number;
  /** Upper bound of the un-jittered delay. */
  maxMs: number;
  /** Growth factor per attempt. */
  factor: number;
  /** Fraction (0–1) of the delay that is randomised ("equal jitter" at 0.5). */
  jitter: number;
}

export const RECONNECT_BACKOFF: BackoffOptions = {
  baseMs: 400,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.5,
};

/**
 * Delay before retry number `attempt` (1-based). With `jitter = 0.5` the
 * result lies in `[d / 2, d]` where `d = min(maxMs, baseMs * factor^(attempt-1))`,
 * so clients that lost the same server do not reconnect in lockstep.
 */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions = RECONNECT_BACKOFF,
  random: () => number = Math.random,
): number {
  const step = Math.max(0, Math.floor(attempt) - 1);
  const exponential = Math.min(
    options.maxMs,
    options.baseMs * options.factor ** Math.min(step, 30),
  );
  const jitter = Math.min(1, Math.max(0, options.jitter));
  return Math.round(exponential * (1 - jitter) + exponential * jitter * random());
}
