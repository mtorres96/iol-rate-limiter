// Sliding Window limiter — a THIN wrapper over `store.slidingWindow` (D-07).
//
// Same shape as the Token Bucket limiter: holds config, delegates to the store
// op (which owns the weighted-estimate admit math, D-13/D-14), and assembles the
// public `Decision`. `limit` = `cfg.limit` (D-12).

import { SystemClock } from "../clock.js";
import type { Clock, Decision, RateLimiter, Store, WindowConfig } from "../types.js";

export class SlidingWindowLimiter implements RateLimiter {
  constructor(
    private readonly store: Store,
    private readonly cfg: WindowConfig,
    private readonly clock: Clock = SystemClock,
  ) {
    // Validate config at construction (T-01-06).
    assertPositive("limit", cfg.limit);
    assertPositive("windowMs", cfg.windowMs);
  }

  async consume(key: string, cost = 1): Promise<Decision> {
    const [allowed, remaining, resetMs, retryAfterMs] = this.store.slidingWindow(
      key,
      this.cfg,
      cost,
      this.clock.now(),
    );
    return {
      allowed: allowed === 1,
      limit: this.cfg.limit, // D-12: limit for the window algorithms
      remaining,
      resetMs,
      retryAfterMs,
    };
  }
}

/** Throw a clear `RangeError` for any non-positive / NaN / non-finite config value. */
function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`SlidingWindowLimiter: \`${name}\` must be a positive finite number, got ${value}`);
  }
}
