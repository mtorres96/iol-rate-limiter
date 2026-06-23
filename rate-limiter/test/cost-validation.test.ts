// `cost` validation guard (CR-01 / CR-02 / WR-02).
//
// The per-request `cost` is caller-supplied and reaches the core through the
// Phase-3 adapter, so it MUST be validated before any store op runs. An
// unvalidated cost is byte-state-corrupting: a negative cost inflates a Token
// Bucket above capacity / frees window allowance, a `cost: 0` is admitted
// against an exhausted limiter, and a NaN/Infinity cost leaks NaN into the
// public `Decision.retryAfterMs` (violating the integer-ms boundary contract,
// D-09, the Phase-2 Lua conformance suite compares against).
//
// Every test injects a fresh FakeClock + MemoryStore (no real timers, Pitfall 1)
// and asserts BOTH that the bad cost throws a RangeError AND — critically — that
// it does NOT mutate store state (the limiter behaves identically afterward).

import { describe, expect, it } from "vitest";
import {
  FakeClock,
  FixedWindowLimiter,
  MemoryStore,
  SlidingWindowLimiter,
  TokenBucketLimiter,
} from "../src/index.js";
import type { TBConfig, WindowConfig } from "../src/index.js";

const tbCfg: TBConfig = { capacity: 5, refillPerInterval: 1, intervalMs: 1000 };
const winCfg: WindowConfig = { limit: 5, windowMs: 1000 };

// The full set of illegal costs: negative, zero, fractional, NaN, Infinity,
// -Infinity. Each must be rejected with a RangeError.
const BAD_COSTS: Array<[label: string, cost: number]> = [
  ["negative", -3],
  ["zero", 0],
  ["fractional", 2.5],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
];

// Build a fresh instance of each limiter sharing one store + clock, so a test
// can drain a key and then probe it with a bad cost on the SAME state.
function makeLimiters() {
  const clock = new FakeClock(0);
  const store = new MemoryStore();
  return {
    clock,
    store,
    tokenBucket: new TokenBucketLimiter(store, tbCfg, clock),
    slidingWindow: new SlidingWindowLimiter(store, winCfg, clock),
    fixedWindow: new FixedWindowLimiter(store, winCfg, clock),
  };
}

describe("cost validation guard", () => {
  describe("rejects every illegal cost with a RangeError (all three limiters)", () => {
    for (const [label, cost] of BAD_COSTS) {
      it(`token bucket rejects ${label} cost (${cost})`, async () => {
        const { tokenBucket } = makeLimiters();
        await expect(tokenBucket.consume("k", cost)).rejects.toBeInstanceOf(RangeError);
      });

      it(`sliding window rejects ${label} cost (${cost})`, async () => {
        const { slidingWindow } = makeLimiters();
        await expect(slidingWindow.consume("k", cost)).rejects.toBeInstanceOf(RangeError);
      });

      it(`fixed window rejects ${label} cost (${cost})`, async () => {
        const { fixedWindow } = makeLimiters();
        await expect(fixedWindow.consume("k", cost)).rejects.toBeInstanceOf(RangeError);
      });
    }
  });

  describe("a rejected illegal cost does NOT mutate store state", () => {
    it("token bucket: a full bucket stays at capacity after every bad cost throws", async () => {
      const { tokenBucket } = makeLimiters();
      // Fire every illegal cost against a fresh, full bucket.
      for (const [, cost] of BAD_COSTS) {
        await expect(tokenBucket.consume("k", cost)).rejects.toThrow(RangeError);
      }
      // The bucket must be untouched: a legal cost-1 request sees the FULL 5.
      const d = await tokenBucket.consume("k");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(4); // 5 - 1, proving state was never inflated/decremented
    });

    it("token bucket: negative cost cannot inflate an exhausted bucket above capacity", async () => {
      const { tokenBucket } = makeLimiters();
      // Drain the bucket fully at t=0.
      for (let i = 0; i < 5; i++) await tokenBucket.consume("k");
      // A negative cost must NOT mint allowance — it throws and leaves the bucket empty.
      await expect(tokenBucket.consume("k", -3)).rejects.toThrow(RangeError);
      const blocked = await tokenBucket.consume("k");
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0); // still empty, NOT inflated to 8
    });

    it("token bucket: cost=0 is not silently admitted against an exhausted bucket", async () => {
      const { tokenBucket } = makeLimiters();
      for (let i = 0; i < 5; i++) await tokenBucket.consume("k"); // drain
      // cost=0 must throw, not return allowed:true against a drained limiter.
      await expect(tokenBucket.consume("k", 0)).rejects.toThrow(RangeError);
    });

    it("token bucket: NaN cost never leaks NaN into Decision.retryAfterMs", async () => {
      const { tokenBucket } = makeLimiters();
      // The guard rejects before any duration arithmetic runs — no Decision is
      // produced at all, so NaN can never reach retryAfterMs.
      await expect(tokenBucket.consume("k", NaN)).rejects.toThrow(RangeError);
      // A subsequent legal request returns a clean integer retryAfterMs.
      for (let i = 0; i < 5; i++) await tokenBucket.consume("k"); // drain
      const blocked = await tokenBucket.consume("k");
      expect(blocked.allowed).toBe(false);
      expect(Number.isInteger(blocked.retryAfterMs)).toBe(true);
      expect(Number.isNaN(blocked.retryAfterMs)).toBe(false);
    });

    it("sliding window: negative cost cannot free allowance in a full window", async () => {
      const { slidingWindow } = makeLimiters();
      for (let i = 0; i < 5; i++) await slidingWindow.consume("k"); // fill to limit
      // A negative cost must NOT decrement the counter and free a slot.
      await expect(slidingWindow.consume("k", -1)).rejects.toThrow(RangeError);
      // The window is still full: a normal request rejects.
      const d = await slidingWindow.consume("k");
      expect(d.allowed).toBe(false);
      expect(d.remaining).toBe(0);
    });

    it("fixed window: cost=0 is not admitted against an exhausted window", async () => {
      const { fixedWindow } = makeLimiters();
      for (let i = 0; i < 5; i++) await fixedWindow.consume("k"); // drain
      await expect(fixedWindow.consume("k", 0)).rejects.toThrow(RangeError);
      // State intact: still exhausted.
      const d = await fixedWindow.consume("k");
      expect(d.allowed).toBe(false);
      expect(d.remaining).toBe(0);
    });

    it("fixed window: fractional cost cannot partially consume the counter", async () => {
      const { fixedWindow } = makeLimiters();
      await expect(fixedWindow.consume("k", 2.5)).rejects.toThrow(RangeError);
      // The counter is untouched: a fresh cost-1 request sees the full window.
      const d = await fixedWindow.consume("k");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(4);
    });
  });

  it("the default cost (no arg) remains a legal cost=1", async () => {
    const { tokenBucket } = makeLimiters();
    const d = await tokenBucket.consume("k"); // no cost arg
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(4);
  });
});
