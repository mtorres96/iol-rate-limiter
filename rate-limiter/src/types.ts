// Core contracts for the rate limiter — the framework-agnostic seam.
//
// Phase 2 (RedisStore + conformance suite) and Phase 3 (Express middleware) both
// depend on these EXACT shapes. This file MUST import nothing from Express or
// ioredis (tier boundary — the core stays framework/transport-agnostic).

/**
 * Injectable time source (CORE-03 / D-09).
 *
 * `now()` returns INTEGER milliseconds. Limiters take a `Clock` so tests can
 * inject a deterministic `FakeClock` (no real timers / no `Date.now()` inside
 * store ops). The store op always receives `now` as a parameter so the Phase-2
 * Lua port can take it via ARGV.
 */
export interface Clock {
  now(): number;
}

/**
 * The primitive numeric tuple every Store op returns (D-08).
 *
 * This is deliberately NOT a `Decision`: it is exactly what a Lua `EVAL` can
 * return, so the in-memory `MemoryStore` and the future `RedisStore` produce
 * IDENTICAL tuples and the Phase-2 conformance suite (TEST-02) compares them
 * with zero TS↔Lua representation mismatch.
 *
 * All durations are integer milliseconds at this boundary (D-09); fractional
 * state (e.g. token counts) lives only inside the store and never crosses here.
 *
 *   [allowed, remaining, resetMs, retryAfterMs]
 */
export type OpTuple = [allowed: 0 | 1, remaining: number, resetMs: number, retryAfterMs: number];

/**
 * The public decision a limiter returns (CORE-02 / D-03 / D-04 / D-05 / D-12).
 *
 * The limiter assembles this from an `OpTuple` plus the `limit` it knows from
 * its own config.
 */
export interface Decision {
  /** Whether the request was admitted (D-01: all-or-nothing). */
  allowed: boolean;
  /** D-12: `capacity` for Token Bucket, `limit` for the window algorithms. */
  limit: number;
  /** D-04: floored integer of remaining allowance. */
  remaining: number;
  /** D-05: ms until full replenishment (bucket back to capacity / window fully elapsed). */
  resetMs: number;
  /** D-03: ms until the request could be retried; `0` when `allowed`. */
  retryAfterMs: number;
}

/**
 * The single decision verb of the core (CORE-01).
 *
 * `async` so a future Redis-backed store can resolve over the network; the
 * in-memory store resolves immediately. `key` is OPAQUE to the core (CORE-05) —
 * the core never parses, logs, or derives identity from it; IP / API-key
 * extraction is a Phase-3 adapter concern. `cost` defaults to 1 in the limiter.
 */
export interface RateLimiter {
  consume(key: string, cost?: number): Promise<Decision>;
}

/** Token Bucket configuration (D-10): `refillPerInterval` tokens added every `intervalMs`. */
export interface TBConfig {
  capacity: number;
  refillPerInterval: number;
  intervalMs: number;
}

/** Window configuration (D-11) — shared by Fixed and Sliding Window. */
export interface WindowConfig {
  limit: number;
  windowMs: number;
}

/**
 * The storage seam (CORE-04 / D-06).
 *
 * Deliberately exposes exactly ONE algorithm-shaped atomic op per algorithm —
 * each op IS the algorithm and the single atomic unit. There is intentionally
 * NO generic key-value `get`/`set`: that would push the algorithm math into the
 * limiter and break the atomicity contract the Lua port relies on (D-06/D-08).
 * Every op returns an `OpTuple`, never a `Decision`.
 */
export interface Store {
  tokenBucket(key: string, cfg: TBConfig, cost: number, now: number): OpTuple;
  slidingWindow(key: string, cfg: WindowConfig, cost: number, now: number): OpTuple;
  fixedWindow(key: string, cfg: WindowConfig, cost: number, now: number): OpTuple;
}
