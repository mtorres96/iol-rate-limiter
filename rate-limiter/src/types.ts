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
 * Every op returns a `Promise<OpTuple>`, never a `Decision`.
 *
 * Async contract (D2-01): the ops are uniformly `Promise<OpTuple>` so the
 * in-memory `MemoryStore` (which resolves immediately, no network) and the
 * future `RedisStore` (which resolves over the wire) implement ONE async
 * contract the conformance suite drives identically.
 */
export interface Store {
  tokenBucket(key: string, cfg: TBConfig, cost: number, now: number): Promise<OpTuple>;
  slidingWindow(key: string, cfg: WindowConfig, cost: number, now: number): Promise<OpTuple>;
  fixedWindow(key: string, cfg: WindowConfig, cost: number, now: number): Promise<OpTuple>;
}

// ---------------------------------------------------------------------------
// RedisStore configuration surface (Phase 2 / D2-04..D2-07).
//
// These are TYPE-ONLY shapes the future `RedisStore` (plan 03) is built against.
// They live here, in the framework-agnostic core, and import NOTHING from
// ioredis — the Redis adapter consumes these contracts but the core stays
// transport-agnostic. Construction-time validation lives in `validate.ts`
// (`assertPolicy` / `assertPrefix` + the existing `assertPositiveConfig`).
// ---------------------------------------------------------------------------

/**
 * How the RedisStore behaves when Redis is unreachable / the op errors or times
 * out (D2-04).
 *
 * - `"fail-open"`  (DEFAULT): admit the request — availability over strictness.
 * - `"fail-closed"`: reject the request — strictness over availability.
 */
export type RateLimitPolicy = "fail-open" | "fail-closed";

/**
 * Circuit-breaker tuning for the RedisStore (D2-05).
 *
 * After `failureThreshold` consecutive failures the breaker opens and the
 * configured `RateLimitPolicy` is applied directly (no Redis round-trip) until
 * `cooldownMs` elapses, then a trial request probes recovery.
 *
 * Recommended defaults (D2-05): `failureThreshold` 5, `cooldownMs` 2000.
 */
export interface BreakerConfig {
  /** Consecutive failures before the breaker opens. Default: 5. */
  failureThreshold: number;
  /** Milliseconds the breaker stays open before a trial probe. Default: 2000. */
  cooldownMs: number;
}

/**
 * Full RedisStore construction config (D2-04..D2-07). Validated at construction
 * by the validators in `validate.ts` before any op runs.
 */
export interface RedisStoreConfig {
  /**
   * Key namespace prefix applied to every Redis key (D2-07). Non-empty string.
   * Default: `"rl"`.
   */
  keyPrefix: string;
  /**
   * Per-command timeout in ms (D2-06). Recommended band: 50–100ms. Must be a
   * positive finite number. Default: lives in the 50–100 band (e.g. 50).
   */
  commandTimeoutMs: number;
  /**
   * Behavior on Redis failure/timeout (D2-04). Default: `"fail-open"`.
   */
  policy: RateLimitPolicy;
  /**
   * Circuit-breaker thresholds (D2-05). Defaults: see {@link BreakerConfig}.
   */
  breaker: BreakerConfig;
}
