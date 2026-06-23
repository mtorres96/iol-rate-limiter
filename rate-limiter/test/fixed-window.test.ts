// Fixed Window Counter (ALGO-03; D-11 + Pitfall 4).
//
// The headline test EXPLICITLY demonstrates the 2x-at-the-boundary burst. That
// burst is the KNOWN, REQUIRED tradeoff of fixed-window counting (it is exactly
// why Sliding Window exists) — NOT a bug to smooth away. All time is driven by an
// injected FakeClock (no real sleeps).

import { describe, expect, it } from "vitest";
import { FakeClock, FixedWindowLimiter, MemoryStore } from "../src/index.js";
import type { WindowConfig } from "../src/index.js";

const WINDOW = 1000;
const cfg: WindowConfig = { limit: 5, windowMs: WINDOW };

function setup(c: WindowConfig = cfg) {
  const clock = new FakeClock(0);
  const store = new MemoryStore();
  const limiter = new FixedWindowLimiter(store, c, clock);
  return { clock, limiter };
}

describe("FixedWindowLimiter", () => {
  it("admits while count + cost <= limit and rejects at the boundary within a window", async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) {
      const d = await limiter.consume("k");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(5 - (i + 1)); // 4,3,2,1,0
    }
    const blocked = await limiter.consume("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(5);
  });

  it("resets the count when the window bucket index changes (rollover)", async () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 5; i++) await limiter.consume("k"); // fill window 0
    expect((await limiter.consume("k")).allowed).toBe(false);

    clock.tick(WINDOW); // advance into window 1 -> count resets to 0
    const fresh = await limiter.consume("k");
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(4);
  });

  it("asserts EXACT integer resetMs / retryAfterMs to the window boundary", async () => {
    const { clock, limiter } = setup();
    clock.setTime(200); // 200ms into window 0 (bucket spans 0..1000)
    const d = await limiter.consume("k");
    // resetMs = ceil((bucket+1)*windowMs - now) = ceil(1000 - 200) = 800.
    expect(d.resetMs).toBe(800);
    expect(Number.isInteger(d.resetMs)).toBe(true);
    expect(d.retryAfterMs).toBe(0); // allowed -> 0

    // Fill to the limit, then a reject reports retryAfterMs to the same boundary.
    for (let i = 0; i < 4; i++) await limiter.consume("k"); // total 5 -> full
    const blocked = await limiter.consume("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(800); // ceil(1000 - 200)
    expect(Number.isInteger(blocked.retryAfterMs)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // THE 2x BOUNDARY BURST — REQUIRED, DOCUMENTED BEHAVIOR (Pitfall 4 / ALGO-03).
  //
  // Admit `limit` requests at the very END of window N, then `limit` MORE at the
  // very START of window N+1. Because the counter resets on the bucket boundary,
  // 2*limit requests are admitted within an arbitrarily short REAL-TIME span that
  // straddles the boundary. This is the known fixed-window weakness — the reason
  // Sliding Window exists — and we assert it here as correct, NOT a bug to fix.
  // No smoothing is added anywhere.
  // ---------------------------------------------------------------------------
  it("permits a 2x burst straddling the window boundary (known required tradeoff)", async () => {
    const { clock, limiter } = setup();
    let admitted = 0;

    // End of window 0: t = 999 (1ms before the boundary). Admit `limit` requests.
    clock.setTime(WINDOW - 1); // 999
    for (let i = 0; i < cfg.limit; i++) {
      if ((await limiter.consume("burst")).allowed) admitted++;
    }
    expect((await limiter.consume("burst")).allowed).toBe(false); // window 0 now full

    // Cross the boundary by just 1ms into window 1: t = 1000. Counter resets.
    clock.setTime(WINDOW); // 1000 -> bucket index 1
    for (let i = 0; i < cfg.limit; i++) {
      if ((await limiter.consume("burst")).allowed) admitted++;
    }

    // 2*limit admitted across a real-time span of only ~1ms (999 -> 1000).
    expect(admitted).toBe(2 * cfg.limit); // 10 requests in ~1ms — the boundary burst
  });
});
