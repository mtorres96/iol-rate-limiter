// Over-admission guard — the executable proof of the Core Value (memory half).
//
// ============================================================================
// EVENT-LOOP ATOMICITY, NOT OS-THREAD PARALLELISM (Pitfall 2 / STOR-01).
//
// Each MemoryStore op is a SINGLE synchronous read-modify-write critical section
// with NO `await` anywhere inside it. Node runs on one thread with a single event
// loop, so once an op begins it runs to completion before any other `consume()`
// can observe or mutate the state — no two interleaved calls ever read a stale
// token count. That is the entire guarantee: there is NO mutex/lock here (the
// event loop IS the lock).
//
// `Promise.all([...consume calls])` does NOT create OS-thread parallelism: it
// schedules the calls and the loop drains them sequentially. The honest claim
// this proves is therefore EVENT-LOOP atomicity for the in-memory store. It is
// DISTINCT from the Lua atomicity Phase 2 proves — there a real multi-CLIENT
// Redis race (separate connections/processes) is serialized by Redis running the
// EVAL script atomically. Both guarantee "exactly `limit` admitted"; the mechanism
// differs, and this test pins the memory half.
//
// A failure here (e.g. `limit + k` admitted) would mean the op leaked an `await`
// into its critical section or otherwise tore its read-modify-write — the single
// highest-severity rate-limiter bug (threat T-01-10).
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  FakeClock,
  FixedWindowLimiter,
  MemoryStore,
  TokenBucketLimiter,
} from "../src/index.js";
import type { Decision, RateLimiter } from "../src/index.js";

/** Fire N overlapping consume(key) calls and count how many were admitted. */
async function burst(limiter: RateLimiter, key: string, n: number): Promise<number> {
  // All N promises are created before any awaits — maximally overlapping.
  const results: Decision[] = await Promise.all(
    Array.from({ length: n }, () => limiter.consume(key)),
  );
  return results.filter((d) => d.allowed).length;
}

describe("over-admission guard (event-loop atomicity)", () => {
  it("Token Bucket: a burst of N > capacity admits EXACTLY capacity", async () => {
    const LIMIT = 5;
    const N = 50; // far more than the limit
    // Fixed clock: time never advances during the burst, so lazy refill cannot
    // mask the guard by quietly handing out extra tokens.
    const clock = new FakeClock(0);
    const limiter = new TokenBucketLimiter(
      new MemoryStore(),
      { capacity: LIMIT, refillPerInterval: 1, intervalMs: 1000 },
      clock,
    );

    const admitted = await burst(limiter, "same-key", N);
    expect(admitted).toBe(LIMIT); // exactly 5 — never 5 + k
  });

  it("Fixed Window: a burst of N > limit admits EXACTLY limit (guard is algorithm-general)", async () => {
    const LIMIT = 7;
    const N = 100;
    const clock = new FakeClock(0); // fixed within a single window
    const limiter = new FixedWindowLimiter(
      new MemoryStore(),
      { limit: LIMIT, windowMs: 1000 },
      clock,
    );

    const admitted = await burst(limiter, "same-key", N);
    expect(admitted).toBe(LIMIT); // exactly 7 across the overlapping burst
  });

  it("documents WHY a torn read-modify-write would over-admit (reinforcement)", async () => {
    // This reads the SAME `now` twice against a fresh store WITHOUT an intervening
    // write — i.e. it simulates two callers that both observed the full bucket
    // before either wrote back. The store op is atomic, so in real concurrent use
    // this interleaving never happens; here we call the op DIRECTLY to document the
    // failure mode the event loop prevents.
    const store = new MemoryStore();
    const cfg = { capacity: 1, refillPerInterval: 1, intervalMs: 1000 };

    // First op writes its result (tokens -> 0): admitted.
    const first = store.tokenBucket("k", cfg, 1, 0);
    expect(first[0]).toBe(1); // allowed

    // Second op AFTER the first wrote: sees the drained state -> rejected. Because
    // the real op completes its write before the next begins (no await inside),
    // this is the only ordering the event loop can produce — hence exactly 1
    // admitted, never 2. A "torn" implementation that read both before either
    // wrote would have admitted 2 (the over-admission bug this guard rules out).
    const second = store.tokenBucket("k", cfg, 1, 0);
    expect(second[0]).toBe(0); // rejected
  });
});
