// Public API barrel — the single `tsup` entry and `package.json` `exports` target.
//
// Re-exports the full core surface: the framework-agnostic contracts, the three
// interchangeable limiters, the in-memory reference store, and the clocks.

// Contracts (the seam Phase 2's RedisStore + Phase 3's Express adapter depend on).
export type {
  BreakerConfig,
  Clock,
  Decision,
  DegradedLogger,
  OpTuple,
  RateLimiter,
  RateLimitPolicy,
  RedisStoreConfig,
  Store,
  TBConfig,
  WindowConfig,
} from "./types.js";

// Clocks (SystemClock = default; FakeClock = deterministic test source).
export { FakeClock, SystemClock } from "./clock.js";

// In-memory reference store (the three algorithm ops).
export { MemoryStore } from "./store/memory.js";

// Distributed Redis store (atomic Lua) + its circuit breaker (Phase 2).
export { RedisStore } from "./store/redis.js";
export { CircuitBreaker } from "./store/breaker.js";

// The three interchangeable limiters.
export { TokenBucketLimiter } from "./limiters/token-bucket.js";
export { SlidingWindowLimiter } from "./limiters/sliding-window.js";
export { FixedWindowLimiter } from "./limiters/fixed-window.js";
