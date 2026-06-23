// Fixed Window limiter — a THIN wrapper over `store.fixedWindow` (D-07).
//
// Same shape as the other limiters. The known 2×-at-the-boundary burst lives in
// the store op (ALGO-03 / Pitfall 4), NOT here — this class adds no smoothing.
// `limit` = `cfg.limit` (D-12).

import { SystemClock } from "../clock.js";
import type { Clock, Decision, RateLimiter, Store, WindowConfig } from "../types.js";

export class FixedWindowLimiter implements RateLimiter {
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
    const [allowed, remaining, resetMs, retryAfterMs] = this.store.fixedWindow(
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
    throw new RangeError(`FixedWindowLimiter: \`${name}\` must be a positive finite number, got ${value}`);
  }
}
