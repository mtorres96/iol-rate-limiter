// Token Bucket limiter — a THIN wrapper over `store.tokenBucket` (D-07).
//
// The algorithm math lives entirely in the store op (D-06); this class only
// holds config, calls the op with `clock.now()`, and assembles the public
// `Decision` from the returned `OpTuple` (D-07). `limit` = `capacity` (D-12).

import { SystemClock } from "../clock.js";
import type { Clock, Decision, RateLimiter, Store, TBConfig } from "../types.js";
import { assertCost, assertPositiveConfig } from "../validate.js";

export class TokenBucketLimiter implements RateLimiter {
  constructor(
    private readonly store: Store,
    private readonly cfg: TBConfig,
    private readonly clock: Clock = SystemClock,
  ) {
    // Validate config at construction (T-01-06): reject non-positive / NaN /
    // non-finite numerics before any op can run with garbage state.
    assertPositiveConfig("TokenBucketLimiter", "capacity", cfg.capacity);
    assertPositiveConfig("TokenBucketLimiter", "refillPerInterval", cfg.refillPerInterval);
    assertPositiveConfig("TokenBucketLimiter", "intervalMs", cfg.intervalMs);
  }

  // `async` only to satisfy `Promise<Decision>` (CORE-01); the memory store
  // resolves synchronously. `cost` defaults to 1.
  async consume(key: string, cost = 1): Promise<Decision> {
    // Reject non-positive-integer / non-finite `cost` BEFORE any store op runs
    // (CR-01/CR-02/WR-02): an unvalidated cost corrupts bucket state or leaks NaN.
    assertCost(cost);
    const [allowed, remaining, resetMs, retryAfterMs] = this.store.tokenBucket(
      key,
      this.cfg,
      cost,
      this.clock.now(),
    );
    return {
      allowed: allowed === 1,
      limit: this.cfg.capacity, // D-12: capacity for Token Bucket
      remaining,
      resetMs,
      retryAfterMs,
    };
  }
}
