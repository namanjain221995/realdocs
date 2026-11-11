/** Small in-memory limiters for the collaboration endpoint (per process). */

/** Classic token bucket: `capacity` burst, refilled continuously. */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.tokens = capacity;
    this.updatedAt = this.now();
  }

  /** Takes `amount` tokens. Returns false (and takes nothing) when not enough are left. */
  take(amount = 1): boolean {
    const current = this.now();
    const elapsedSeconds = Math.max(0, current - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.updatedAt = current;
    if (this.tokens < amount) return false;
    this.tokens -= amount;
    return true;
  }
}

/**
 * Runs `run` at most once per interval. An item offered too early is not
 * dropped: it replaces the one already waiting and runs when the interval has
 * elapsed (trailing edge). The latest item therefore always gets its turn and
 * at most one item is ever held.
 */
export class TrailingThrottle<T> {
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private held: { item: T } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly run: (item: T) => void,
    private readonly intervalMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Returns true when the item ran immediately, false when it was deferred. */
  offer(item: T): boolean {
    const elapsed = this.now() - this.lastRunAt;
    if (elapsed >= this.intervalMs && this.held === null) {
      this.lastRunAt = this.now();
      this.run(item);
      return true;
    }
    this.held = { item };
    this.timer ??= setTimeout(() => this.flush(), Math.max(0, this.intervalMs - elapsed));
    return false;
  }

  /** True while an item is waiting for its turn. */
  get pending(): boolean {
    return this.held !== null;
  }

  private flush(): void {
    this.timer = null;
    const held = this.held;
    this.held = null;
    if (!held) return;
    this.lastRunAt = this.now();
    this.run(held.item);
  }

  /** Forgets a waiting item and stops the timer. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.held = null;
  }
}

/** Fixed-window counter per key with a bounded number of tracked keys. */
export class WindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one event for `key`. Returns false when the key is over its limit. */
  take(key: string): boolean {
    const current = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= current) {
      if (!window && this.windows.size >= this.maxKeys) this.sweep(current);
      window = { count: 0, resetAt: current + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count <= this.max;
  }

  private sweep(current: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= current) this.windows.delete(key);
    }
    // Still full of live windows: drop the oldest entries rather than grow without bound.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
  }
}

/** Runs `worker` over `items` with at most `concurrency` in flight. */
export async function mapLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
