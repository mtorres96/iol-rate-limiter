// Shared input validation — the single auditable place for construction-time
// config checks AND per-request `cost` checks across all three limiters.
//
// Extracting these here (rather than copy-pasting into each limiter) keeps
// validation in lockstep: the per-request `cost` guard the algorithms depend on
// for correctness (CR-01/CR-02/WR-02) lives in ONE place, so it can never drift
// between the Token Bucket, Sliding Window, and Fixed Window wrappers.

/**
 * Throw a clear `RangeError` for any non-positive / NaN / non-finite config
 * value. Used at limiter construction time (T-01-06) to reject garbage config
 * before any op can run with it. `label` is the limiter class name for a precise
 * error message (e.g. "TokenBucketLimiter").
 */
export function assertPositiveConfig(label: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label}: \`${name}\` must be a positive finite number, got ${value}`);
  }
}

/**
 * Throw a clear `RangeError` for any `cost` that is not a finite positive
 * integer. Rejects NaN, Infinity, negative, zero, and fractional values.
 *
 * This guards the per-request `cost` surface BEFORE it reaches a store op, where
 * an unvalidated `cost` would corrupt limiter state (negative cost inflates a
 * Token Bucket above capacity / frees window allowance), bypass the limit
 * (`cost: 0` is admitted against an exhausted limiter), or leak `NaN` into the
 * public `Decision.retryAfterMs` (violating the integer-ms boundary contract,
 * D-09, the Phase-2 Lua conformance suite compares against). `cost` is
 * integers-only for Lua parity (the Lua port mirrors integer-count arithmetic).
 */
export function assertCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < 1) {
    throw new RangeError(`consume: \`cost\` must be a positive integer, got ${cost}`);
  }
}
