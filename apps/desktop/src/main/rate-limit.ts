/**
 * A small limiter for actions that a page can ask for but that have an effect
 * outside the app, such as handing a link to the operating system. A person
 * clicking links never reaches it; a script calling in a loop does.
 */
export interface RateLimitOptions {
  /** Minimum time between two accepted actions. */
  minIntervalMs: number;
  /** At most this many accepted actions … */
  max: number;
  /** … in any period of this length. */
  windowMs: number;
}

export class RateLimiter {
  private readonly accepted: number[] = [];

  constructor(
    private readonly options: RateLimitOptions,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if the action may happen now (and counts it), false if it must be refused. */
  take(): boolean {
    const now = this.now();
    while (this.accepted.length > 0 && now - (this.accepted[0] ?? 0) >= this.options.windowMs) {
      this.accepted.shift();
    }
    const last = this.accepted.at(-1);
    if (last !== undefined && now - last < this.options.minIntervalMs) return false;
    if (this.accepted.length >= this.options.max) return false;
    this.accepted.push(now);
    return true;
  }
}
