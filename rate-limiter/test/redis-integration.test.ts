// Real-Redis integration happy-path (TEST-03).
//
// Drives each algorithm's `RedisStore` against a REAL `redis:7.4-alpine` started
// by testcontainers — the executable proof that the atomic-Lua ports behave end
// to end over the wire, not just in the in-memory oracle. The conformance suite
// (store-conformance.test.ts) already proves bit-for-bit PARITY; this suite
// proves the distributed store actually round-trips through Redis: admit up to
// the limit, reject past it, state survives across calls within a window, and
// every duration that crosses the boundary is an INTEGER (D-09 — the Lua returns
// floored/ceiled integers, never a float).
//
// Time is driven by an injected `FakeClock` (the limiter passes `now` to the Lua
// ARGV) so admit/reject boundaries are deterministic without real sleeps. ONE
// container per file (Pitfall 5): started in `beforeAll`, stopped in `afterAll`,
// per-test isolation via `flushall`. Skips cleanly with no Docker (T-02-14).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FakeClock,
  FixedWindowLimiter,
  SlidingWindowLimiter,
  TokenBucketLimiter,
} from "../src/index.js";
import type { Decision } from "../src/index.js";
import {
  dockerAvailable,
  makeRedisStore,
  startRedis,
  stopRedis,
  type RedisHarness,
} from "./support/redis.js";

/** Every `resetMs`/`retryAfterMs` that crosses the store boundary must be an integer (D-09). */
function expectIntegerDurations(d: Decision): void {
  expect(Number.isInteger(d.resetMs)).toBe(true);
  expect(Number.isInteger(d.retryAfterMs)).toBe(true);
  expect(Number.isInteger(d.remaining)).toBe(true);
}

describe.skipIf(!dockerAvailable())("RedisStore integration over real Redis (TEST-03)", () => {
  let harness: RedisHarness;
  let clock: FakeClock;

  beforeAll(async () => {
    harness = await startRedis(); // ONE container for the whole file (Pitfall 5)
  }, 120_000);

  afterAll(async () => {
    if (harness) await stopRedis(harness);
  });

  beforeEach(async () => {
    await harness.client.flushall(); // fresh Redis state per test
    clock = new FakeClock(0);
  });

  it("Token Bucket: admits up to capacity, rejects past it, state survives across calls", async () => {
    const store = makeRedisStore(harness, clock, { keyPrefix: "it-tb" });
    const limiter = new TokenBucketLimiter(
      store,
      { capacity: 5, refillPerInterval: 1, intervalMs: 1000 },
      clock,
    );

    // Five admits drain the bucket — each call READS the state the previous WROTE
    // to Redis (state survival across round-trips), so remaining counts down.
    for (let i = 0; i < 5; i++) {
      const d = await limiter.consume("k");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(5 - (i + 1)); // 4,3,2,1,0
      expect(d.limit).toBe(5);
      expectIntegerDurations(d);
    }

    // Sixth call: persisted bucket is empty, no refill at the same `now` → reject.
    const blocked = await limiter.consume("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(1000); // ceil(1 token / 1 per 1000ms)
    expectIntegerDurations(blocked);

    // Advance one interval → exactly one token refills (lazy refill persisted in Redis).
    clock.setTime(1000);
    const refilled = await limiter.consume("k");
    expect(refilled.allowed).toBe(true);
    expect(refilled.remaining).toBe(0);
  });

  it("Fixed Window: fills to limit, rejects, resets on the next window", async () => {
    const store = makeRedisStore(harness, clock, { keyPrefix: "it-fw" });
    const limiter = new FixedWindowLimiter(store, { limit: 5, windowMs: 1000 }, clock);

    for (let i = 0; i < 5; i++) {
      const d = await limiter.consume("k");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(5 - (i + 1));
      expectIntegerDurations(d);
    }
    const blocked = await limiter.consume("k"); // window 0 full
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expectIntegerDurations(blocked);

    // Next window → the persisted counter resets, a fresh request admits.
    clock.setTime(1000);
    const next = await limiter.consume("k");
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBe(4);
    expectIntegerDurations(next);
  });

  it("Sliding Window: admits up to limit then rejects within the window", async () => {
    const store = makeRedisStore(harness, clock, { keyPrefix: "it-sw" });
    const limiter = new SlidingWindowLimiter(store, { limit: 7, windowMs: 60_000 }, clock);

    for (let i = 0; i < 7; i++) {
      const d = await limiter.consume("k");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(7 - (i + 1)); // 6..0
      expect(d.limit).toBe(7);
      expectIntegerDurations(d);
    }
    const blocked = await limiter.consume("k"); // 8th in the same window → reject
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expectIntegerDurations(blocked);
  });

  it("Sliding Window: reproduces the Xu Ch.4 anchor over real Redis (remaining=1)", async () => {
    // The same anchor the conformance fixtures pin: prev=5 in bucket 0, move 50%
    // into bucket 1, log curr=3, then a cost-1 request → floor(3 + 5*0.5)=5;
    // 5+1=6 <= 7 → ADMIT with remaining 1. Proven here against real Redis state.
    const store = makeRedisStore(harness, clock, { keyPrefix: "it-sw-xu" });
    const limiter = new SlidingWindowLimiter(store, { limit: 7, windowMs: 60_000 }, clock);

    for (let i = 0; i < 5; i++) await limiter.consume("user"); // prev = 5 (bucket 0)
    clock.setTime(90_000); // 50% into bucket 1
    await limiter.consume("user"); // curr → 1
    await limiter.consume("user"); // curr → 2
    await limiter.consume("user"); // curr → 3
    const anchor = await limiter.consume("user"); // floor(3 + 2.5)=5; 6<=7 → admit
    expect(anchor.allowed).toBe(true);
    expect(anchor.remaining).toBe(1);
    expectIntegerDurations(anchor);
  });
});
