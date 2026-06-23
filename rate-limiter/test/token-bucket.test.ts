// Token Bucket determinism (ALGO-01; D-01/D-02/D-04/D-05/D-10).
//
// Every test injects a fresh FakeClock + MemoryStore and advances time ONLY via
// `clock.tick` / `clock.setTime` — never fake-timer runner hooks and never a real
// timer/sleep of any kind (Pitfall 1). Integer `resetMs`/`retryAfterMs` and a floored integer
// `remaining` are asserted EXACTLY so the Phase-2 Lua port has a precise target
// (Pitfall 3 / TEST-02 conformance).

import { describe, expect, it } from "vitest";
import { FakeClock, MemoryStore, TokenBucketLimiter } from "../src/index.js";
import type { TBConfig } from "../src/index.js";

// 5-token bucket, refilling 1 token every 1000ms.
const cfg: TBConfig = { capacity: 5, refillPerInterval: 1, intervalMs: 1000 };

function setup(c: TBConfig = cfg) {
  const clock = new FakeClock(0);
  const store = new MemoryStore();
  const limiter = new TokenBucketLimiter(store, c, clock);
  return { clock, store, limiter };
}

describe("TokenBucketLimiter", () => {
  it("admits a burst up to capacity at t=0, then rejects", async () => {
    const { limiter } = setup();
    // Five consume() calls drain the full capacity with no time advance.
    for (let i = 0; i < 5; i++) {
      const d = await limiter.consume("k");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(5 - (i + 1)); // 4,3,2,1,0 — floored integer (D-04)
    }
    // Sixth call: bucket empty, no refill yet → reject.
    const blocked = await limiter.consume("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(5); // D-12: limit = capacity for Token Bucket
  });

  it("lazily refills exactly N tokens after N intervals of `clock.tick`", async () => {
    const { clock, limiter } = setup();
    // Drain to empty at t=0.
    for (let i = 0; i < 5; i++) await limiter.consume("k");
    expect((await limiter.consume("k")).allowed).toBe(false);

    // Advance 3 full intervals → exactly 3 tokens refilled (lazy refill, D-10).
    clock.tick(3000);
    for (let i = 0; i < 3; i++) {
      const d = await limiter.consume("k");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(2 - i); // 2,1,0 remaining after each consume
    }
    // The 4th consume in this window has no token left.
    expect((await limiter.consume("k")).allowed).toBe(false);
  });

  it("floors a fractional refill into `remaining`", async () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 5; i++) await limiter.consume("k"); // empty at t=0

    // 1500ms → 1.5 tokens refilled. One consume leaves 0.5 internally; remaining floors to 0.
    clock.tick(1500);
    const d = await limiter.consume("k");
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(0); // Math.floor(0.5) — D-04: fractional token stays internal
  });

  it("consumes the right number for a `cost > 1` request", async () => {
    const { limiter } = setup();
    const d = await limiter.consume("k", 3); // 5 - 3 = 2 remaining
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(2);

    // Only 2 tokens left; a cost-3 request cannot be admitted (all-or-nothing, D-01).
    const blocked = await limiter.consume("k", 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(2); // state untouched on reject (D-01)
  });

  it("admits the exact-limit call and rejects the next (boundary)", async () => {
    const { limiter } = setup();
    const exact = await limiter.consume("k", 5); // cost == capacity → exactly empties
    expect(exact.allowed).toBe(true);
    expect(exact.remaining).toBe(0);
    expect(exact.retryAfterMs).toBe(0);

    const next = await limiter.consume("k"); // bucket empty
    expect(next.allowed).toBe(false);
  });

  it("rejects `cost > capacity` gracefully without consuming (D-02)", async () => {
    const { limiter } = setup();
    // cost 10 can NEVER fit in a capacity-5 bucket: reject, no throw, no clamp.
    const d = await limiter.consume("k", 10);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(5); // state unchanged — full bucket still available

    // Best-effort retryAfterMs: ms to refill the deficit (10 - 5 = 5 tokens) at
    // 1 token / 1000ms → ceil(5/1 * 1000) = 5000.
    expect(d.retryAfterMs).toBe(5000);

    // The full bucket is intact: a normal request still succeeds afterward.
    const ok = await limiter.consume("k");
    expect(ok.allowed).toBe(true);
    expect(ok.remaining).toBe(4);
  });

  it("asserts EXACT integer resetMs / retryAfterMs from the Math.ceil rounding contract", async () => {
    const { limiter } = setup();
    // Drain fully: deficitToFull = 5 tokens → resetMs = ceil(5/1 * 1000) = 5000.
    const drained = await limiter.consume("k", 5);
    expect(drained.resetMs).toBe(5000);
    expect(Number.isInteger(drained.resetMs)).toBe(true);

    // Now empty: a cost-1 reject needs 1 token → retryAfterMs = ceil(1/1 * 1000) = 1000.
    const blocked = await limiter.consume("k", 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
    expect(Number.isInteger(blocked.retryAfterMs)).toBe(true);
    // resetMs while empty is still the full 5000ms back to capacity.
    expect(blocked.resetMs).toBe(5000);
  });

  it("rounds resetMs UP (ceil) for a fractional deficit so it never under-reports", async () => {
    // capacity 3, refill 2 tokens / 1000ms (500ms per token).
    const { limiter } = setup({ capacity: 3, refillPerInterval: 2, intervalMs: 1000 });
    // Consume 1 → 2 tokens left, deficitToFull = 1 token → resetMs = ceil(1/2 * 1000) = 500.
    const d = await limiter.consume("k", 1);
    expect(d.remaining).toBe(2);
    expect(d.resetMs).toBe(500);
    expect(Number.isInteger(d.resetMs)).toBe(true);
  });
});
