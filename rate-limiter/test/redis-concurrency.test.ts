// Over-admission guard — the executable proof of the Core Value (DISTRIBUTED half).
//
// ============================================================================
// SINGLE-LUA-SCRIPT ATOMICITY, NOT EVENT-LOOP SERIALIZATION (TEST-04 / T-02-12).
//
// concurrency.test.ts pins the in-memory half: the Node event loop serializes
// each MemoryStore op, so a burst admits exactly `limit`. THIS file pins the
// distributed half, where that guarantee does NOT come for free: a burst here is
// fired through ONE shared ioredis client over a real network connection to a
// real Redis, and a naive read-modify-write (GET count; if < limit then INCR)
// would interleave across overlapping round-trips and OVER-ADMIT (`limit + k`) —
// the single highest-severity rate-limiter bug.
//
// The guarantee instead comes from Redis executing each algorithm's Lua script
// ATOMICALLY: Redis runs one EVAL to completion before the next begins (no other
// command — from this client or ANY other client/process — interleaves), so the
// read-decrement-write is one indivisible critical section SERVER-SIDE. That is
// the distributed analogue of the event-loop lock, and it holds across separate
// clients/connections (which the event-loop lock does NOT).
//
// `Promise.all([...consume calls])` schedules N overlapping round-trips on the
// shared client. If the Lua weren't atomic this is exactly the race that would
// admit more than `limit`. We assert EXACTLY `limit` for Token Bucket and Fixed
// Window, with a FIXED `now` (no time advance, so lazy refill / window rollover
// can't mask the guard by quietly handing out extra capacity).
//
// ONE container per file (Pitfall 5); skips cleanly with no Docker (T-02-14).
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeClock, FixedWindowLimiter, TokenBucketLimiter } from "../src/index.js";
import type { Decision, RateLimiter } from "../src/index.js";
import {
  dockerAvailable,
  makeRedisStore,
  startRedis,
  stopRedis,
  type RedisHarness,
} from "./support/redis.js";

/**
 * Fire N overlapping `consume(key)` calls on the SHARED client and count admits.
 * All N promises are created before any awaits — maximally overlapping round-trips
 * (the worst case for a non-atomic read-modify-write). Mirrors the burst() in
 * concurrency.test.ts; here the atomicity under test is single-Lua-script, not
 * the event loop.
 */
async function burst(limiter: RateLimiter, key: string, n: number): Promise<number> {
  const results: Decision[] = await Promise.all(
    Array.from({ length: n }, () => limiter.consume(key)),
  );
  return results.filter((d) => d.allowed).length;
}

describe.skipIf(!dockerAvailable())(
  "over-admission guard over real Redis (single-Lua-script atomicity, TEST-04)",
  () => {
    let harness: RedisHarness;
    let clock: FakeClock;

    beforeAll(async () => {
      harness = await startRedis(); // ONE container for the whole file (Pitfall 5)
    }, 120_000);

    afterAll(async () => {
      if (harness) await stopRedis(harness);
    });

    beforeEach(async () => {
      await harness.client.flushall();
      clock = new FakeClock(0); // FIXED now: refill/rollover cannot mask the guard
    });

    it("Token Bucket: a burst of N > capacity admits EXACTLY capacity", async () => {
      const LIMIT = 5;
      const N = 50; // far more than the limit
      const store = makeRedisStore(harness, clock, { keyPrefix: "cc-tb" });
      const limiter = new TokenBucketLimiter(
        store,
        { capacity: LIMIT, refillPerInterval: 1, intervalMs: 1000 },
        clock,
      );

      const admitted = await burst(limiter, "same-key", N);
      // EXACTLY 5 — never 5 + k. A non-atomic interleave would over-admit.
      expect(admitted).toBe(LIMIT);
    });

    it("Fixed Window: a burst of N > limit admits EXACTLY limit", async () => {
      const LIMIT = 7;
      const N = 100;
      const store = makeRedisStore(harness, clock, { keyPrefix: "cc-fw" });
      const limiter = new FixedWindowLimiter(store, { limit: LIMIT, windowMs: 1000 }, clock);

      const admitted = await burst(limiter, "same-key", N);
      // EXACTLY 7 across the overlapping burst — the distributed over-admission guard.
      expect(admitted).toBe(LIMIT);
    });
  },
);
