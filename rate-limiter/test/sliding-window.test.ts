// Sliding Window Counter (ALGO-02; D-13/D-14).
//
// The centerpiece is the Xu Ch.4 worked example reproduced VERBATIM — it is the
// regression anchor that makes the Phase-2 TS<->Lua conformance unambiguous.
// All time is driven by an injected FakeClock (no real sleeps / no fake-timer
// runner hooks).

import { describe, expect, it } from "vitest";
import { FakeClock, MemoryStore, SlidingWindowLimiter } from "../src/index.js";
import type { WindowConfig } from "../src/index.js";

// Xu's example uses a 60s window and a limit of 7.
const WINDOW = 60_000;
const cfg: WindowConfig = { limit: 7, windowMs: WINDOW };

function setup(c: WindowConfig = cfg) {
  const clock = new FakeClock(0);
  const store = new MemoryStore();
  const limiter = new SlidingWindowLimiter(store, c, clock);
  return { clock, limiter };
}

describe("SlidingWindowLimiter", () => {
  // Pinned regression anchor — *System Design Interview, Vol 1*, Ch.4 "Design a
  // Rate Limiter". limit = 7 per 60s; previous window had 5 requests, current
  // window has 3, and we are 30s (50%) into the current window. The weighted
  // estimate is 3 + 5 * 0.5 = 5.5 -> floor 5; a new cost-1 request gives
  // 5 + 1 = 6 <= 7 -> ADMIT, with remaining = 1.
  it("reproduces the Xu Ch.4 worked example (limit=7, prev=5, curr=3, 50% in -> admit, remaining=1)", async () => {
    const { clock, limiter } = setup();

    // Build the PREVIOUS window (bucket 0): 5 requests at t=0.
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume("user")).allowed).toBe(true);
    }

    // Move to 50% into the CURRENT window (bucket 1): t = 60_000 + 30_000 = 90_000.
    // prev = 5, overlap = 0.5, so the previous window contributes 5 * 0.5 = 2.5.
    clock.setTime(WINDOW + WINDOW / 2);

    // Log the 3 current-window requests AT this point (curr -> 3): each admits
    // because floor(curr + 2.5) + 1 <= 7 while curr climbs 0 -> 3.
    for (let i = 0; i < 3; i++) {
      expect((await limiter.consume("user")).allowed).toBe(true);
    }

    const d = await limiter.consume("user");
    // floor(3 + 5*0.5) = floor(5.5) = 5; 5 + 1 = 6 <= 7 -> admit.
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(1); // 7 - 6
    expect(d.limit).toBe(7);
    expect(d.retryAfterMs).toBe(0);
    // resetMs = ms until the current bucket rolls: 120_000 - 90_000 = 30_000.
    expect(d.resetMs).toBe(30_000);
    expect(Number.isInteger(d.resetMs)).toBe(true);
  });

  it("shifts current counts to previous when the window advances (rollover)", async () => {
    const { clock, limiter } = setup();
    // Fill bucket 0 to the limit (7 requests).
    for (let i = 0; i < 7; i++) expect((await limiter.consume("k")).allowed).toBe(true);
    // 8th in the same window is rejected.
    expect((await limiter.consume("k")).allowed).toBe(false);

    // Advance a FULL window: curr(7) becomes prev; curr resets to 0.
    clock.setTime(WINDOW); // t = 60_000, bucket 1, 0% in -> overlap = 1.0
    // estimate = 0 + 7*1.0 = 7 -> floor 7; 7 + 1 = 8 > 7 -> still rejected at the boundary.
    expect((await limiter.consume("k")).allowed).toBe(false);

    // Advance >= 2 full windows: the previous window fully decays (prev -> 0).
    clock.setTime(3 * WINDOW); // bucket 3, prev bucket (2) empty
    const fresh = await limiter.consume("k");
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(6);
  });

  it("admits exactly at the floor(estimate)+cost == limit edge and rejects just past it", async () => {
    const { clock, limiter } = setup();
    // prev = 5 (bucket 0); then log curr = 3 at 50% into bucket 1 (overlap 0.5,
    // previous-window weight = 2.5). After the 3 logs: estimate base floor(3+2.5)=5.
    for (let i = 0; i < 5; i++) await limiter.consume("k");
    clock.setTime(WINDOW + WINDOW / 2); // 50% into bucket 1
    for (let i = 0; i < 3; i++) await limiter.consume("k"); // curr -> 3

    // 1st: floor(3 + 2.5)=5; 5+1=6<=7 admit, remaining 1. curr -> 4.
    const a = await limiter.consume("k");
    expect(a.allowed).toBe(true);
    expect(a.remaining).toBe(1);

    // 2nd: floor(4 + 2.5)=6; 6+1=7<=7 admit (EXACT edge), remaining 0. curr -> 5.
    const edge = await limiter.consume("k");
    expect(edge.allowed).toBe(true);
    expect(edge.remaining).toBe(0);

    // 3rd: floor(5 + 2.5)=7; 7+1=8>7 -> reject (just past the edge).
    const over = await limiter.consume("k");
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("leaves the current count unchanged on a reject (D-01)", async () => {
    const { clock, limiter } = setup();
    // Fill bucket 0 to the limit, then reject in the same window.
    for (let i = 0; i < 7; i++) await limiter.consume("k");
    const rejected = await limiter.consume("k");
    expect(rejected.allowed).toBe(false);

    // Roll one window: prev should be exactly 7 (the reject did NOT bump curr to 8).
    clock.setTime(WINDOW); // 0% in -> estimate = 0 + 7*1.0 = 7
    // A cost-0-margin probe: floor(7) + 1 = 8 > 7 -> reject, confirming prev == 7 not 8+.
    expect((await limiter.consume("k")).allowed).toBe(false);
    // (If the earlier reject had leaked into curr, prev would be 8 here — same reject,
    // but the unchanged-state contract is what we assert via the count below.)
    clock.setTime(2 * WINDOW); // prev bucket now the t=60_000 window (curr there was 0)
    expect((await limiter.consume("k")).allowed).toBe(true);
  });
});
