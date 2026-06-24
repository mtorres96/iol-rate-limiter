// Shared conformance fixtures (TEST-02 / D2-10) — the PARITY CONTRACT.
//
// This file is PURE DATA + `make` closures. It defines the identical
// (key, cost, now) sequences that the plan-04 conformance suite
// (`store-conformance.test.ts`) drives across BOTH the MemoryStore and the
// RedisStore, asserting they produce identical `Decision`s. The Lua scripts ARE
// the Redis algorithm; these fixtures ARE the contract those scripts must honor.
//
// Each `AlgoCase` carries:
//   - `name`  : a human label (also the vitest sub-test title),
//   - `make`  : builds the matching limiter for this algorithm over the supplied
//               `store` + `clock` (config is baked in so the fixture is
//               self-describing),
//   - `steps` : an ordered list of { now, cost, key } driven by ABSOLUTE `now`.
//
// The runner (plan 04) replays each step by `clock.setTime(step.now)` then
// `await limiter.consume(step.key, step.cost)`. Time is ALWAYS driven via the
// injected `FakeClock` (never `Date.now()` / never Redis `TIME`) so the Lua
// store receives the SAME `now` via ARGV and parity holds (Pitfall 3 / D2-08).
//
// Scenarios mirror the Phase-1 per-algorithm suites so any TS↔Lua drift surfaces
// against an already-trusted reference: token-bucket
// drain/refill/fractional/cost>capacity/exact-limit; sliding-window the Xu Ch.4
// anchor (limit=7, prev=5, curr=3, 50% in → admit, remaining=1); fixed-window the
// 2×-boundary-burst. The expected `Decision`s are NOT encoded here — the runner
// computes them once and asserts the SAME value for both stores (that shared
// expectation is what makes this a true conformance test).

import {
  FixedWindowLimiter,
  SlidingWindowLimiter,
  TokenBucketLimiter,
} from "../../src/index.js";
import type { Clock, RateLimiter, Store, TBConfig, WindowConfig } from "../../src/index.js";

/** One replayed call: set the clock to `now`, then `consume(key, cost)`. */
export type Step = { now: number; cost: number; key: string };

/**
 * A single parametrized conformance case for one algorithm.
 *
 * `make` builds the limiter for this algo over the given store/clock. The clock
 * is typed as the core `Clock` (the runner injects a `FakeClock`, which is a
 * `Clock`); keeping the param as `Clock` avoids coupling the fixtures to the
 * concrete test clock.
 */
export type AlgoCase = {
  name: string;
  make: (store: Store, clock: Clock) => RateLimiter;
  steps: Step[];
};

// --- Token Bucket ----------------------------------------------------------
// 5-token bucket, refilling 1 token every 1000ms (matches token-bucket.test.ts).
const tbCfg: TBConfig = { capacity: 5, refillPerInterval: 1, intervalMs: 1000 };
const tb = (store: Store, clock: Clock): RateLimiter =>
  new TokenBucketLimiter(store, tbCfg, clock);

export const tbCases: AlgoCase[] = [
  {
    // Drain the full capacity at t=0, then the 6th call rejects (empty, no refill).
    name: "token-bucket: drain to empty then reject",
    make: tb,
    steps: [
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" }, // empty → reject
    ],
  },
  {
    // Drain at t=0, advance 3 full intervals → exactly 3 tokens refilled, then empty again.
    name: "token-bucket: lazy refill of N tokens after N intervals",
    make: tb,
    steps: [
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" }, // empty at t=0
      { now: 3000, cost: 1, key: "k" }, // +3 tokens refilled → admit
      { now: 3000, cost: 1, key: "k" },
      { now: 3000, cost: 1, key: "k" },
      { now: 3000, cost: 1, key: "k" }, // 4th this window → reject
    ],
  },
  {
    // Fractional refill: 1500ms → 1.5 tokens; one consume leaves 0.5, remaining floors to 0.
    name: "token-bucket: fractional refill floors remaining to 0",
    make: tb,
    steps: [
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" }, // empty at t=0
      { now: 1500, cost: 1, key: "k" }, // 1.5 refilled → admit, remaining floor(0.5)=0
    ],
  },
  {
    // cost > capacity (10 > 5): reject gracefully, state untouched, then a normal call succeeds.
    name: "token-bucket: cost > capacity rejects without consuming",
    make: tb,
    steps: [
      { now: 0, cost: 10, key: "k" }, // reject, retryAfterMs = ceil(5/1*1000) = 5000
      { now: 0, cost: 1, key: "k" }, // full bucket intact → admit, remaining 4
    ],
  },
  {
    // Exact-limit: cost == capacity empties exactly (admit), next call rejects.
    name: "token-bucket: exact-limit admit then reject",
    make: tb,
    steps: [
      { now: 0, cost: 5, key: "k" }, // empties exactly → admit, remaining 0, retryAfter 0
      { now: 0, cost: 1, key: "k" }, // empty → reject
    ],
  },
];

// --- Sliding Window --------------------------------------------------------
// Xu's example: 60s window, limit 7 (matches sliding-window.test.ts).
const WINDOW_SW = 60_000;
const swCfg: WindowConfig = { limit: 7, windowMs: WINDOW_SW };
const sw = (store: Store, clock: Clock): RateLimiter =>
  new SlidingWindowLimiter(store, swCfg, clock);

export const swCases: AlgoCase[] = [
  {
    // THE Xu Ch.4 anchor: build prev=5 in bucket 0, move 50% into bucket 1, log
    // curr=3, then a cost-1 request: floor(3 + 5*0.5) = floor(5.5) = 5; 5+1=6 <= 7
    // → ADMIT with remaining = 1. resetMs = 120_000 - 90_000 = 30_000.
    name: "sliding-window: Xu Ch.4 anchor (limit=7, prev=5, curr=3, 50% in → admit, remaining=1)",
    make: sw,
    steps: [
      { now: 0, cost: 1, key: "user" }, // bucket 0 → prev becomes 5
      { now: 0, cost: 1, key: "user" },
      { now: 0, cost: 1, key: "user" },
      { now: 0, cost: 1, key: "user" },
      { now: 0, cost: 1, key: "user" }, // prev = 5
      { now: 90_000, cost: 1, key: "user" }, // 50% into bucket 1, curr → 1
      { now: 90_000, cost: 1, key: "user" }, // curr → 2
      { now: 90_000, cost: 1, key: "user" }, // curr → 3
      { now: 90_000, cost: 1, key: "user" }, // floor(3 + 2.5)=5; 5+1=6<=7 → admit, remaining 1
    ],
  },
  {
    // Rollover: fill bucket 0 to the limit, reject the 8th; at the 0%-in boundary
    // of bucket 1 the full prev weight still rejects; after ≥2 windows prev decays
    // to 0 and a fresh request admits.
    name: "sliding-window: rollover shifts curr→prev then full decay",
    make: sw,
    steps: [
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" }, // 7 admitted → full
      { now: 0, cost: 1, key: "k" }, // 8th → reject
      { now: 60_000, cost: 1, key: "k" }, // bucket 1, 0% in → estimate 0+7*1=7; 7+1>7 → reject
      { now: 180_000, cost: 1, key: "k" }, // ≥2 windows later → prev 0 → admit, remaining 6
    ],
  },
  {
    // Exact floor(estimate)+cost == limit edge: prev=5, 50% in, curr climbs 3→5;
    // the request at the exact edge admits (remaining 0), the next just past rejects.
    name: "sliding-window: admit at the exact floor(estimate)+cost == limit edge",
    make: sw,
    steps: [
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" }, // prev = 5
      { now: 90_000, cost: 1, key: "k" }, // curr → 1
      { now: 90_000, cost: 1, key: "k" }, // curr → 2
      { now: 90_000, cost: 1, key: "k" }, // curr → 3
      { now: 90_000, cost: 1, key: "k" }, // floor(3+2.5)=5; 6<=7 admit, remaining 1, curr→4
      { now: 90_000, cost: 1, key: "k" }, // floor(4+2.5)=6; 7<=7 admit (edge), remaining 0, curr→5
      { now: 90_000, cost: 1, key: "k" }, // floor(5+2.5)=7; 8>7 → reject, remaining 0
    ],
  },
];

// --- Fixed Window ----------------------------------------------------------
// 1s window, limit 5 (matches fixed-window.test.ts).
const WINDOW_FW = 1000;
const fwCfg: WindowConfig = { limit: 5, windowMs: WINDOW_FW };
const fw = (store: Store, clock: Clock): RateLimiter =>
  new FixedWindowLimiter(store, fwCfg, clock);

export const fwCases: AlgoCase[] = [
  {
    // Fill within a window, then reject at the boundary.
    name: "fixed-window: fill to limit then reject",
    make: fw,
    steps: [
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" }, // 5 admitted → full
      { now: 0, cost: 1, key: "k" }, // reject
    ],
  },
  {
    // Reset on bucket index change: full in window 0, fresh count in window 1.
    name: "fixed-window: count resets on window rollover",
    make: fw,
    steps: [
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" },
      { now: 0, cost: 1, key: "k" }, // full at window 0
      { now: 0, cost: 1, key: "k" }, // reject
      { now: 1000, cost: 1, key: "k" }, // window 1 → count reset → admit, remaining 4
    ],
  },
  {
    // THE 2×-boundary burst (Pitfall 4): admit `limit` at the END of window 0
    // (t=999) and `limit` MORE at the START of window 1 (t=1000) — 2*limit
    // admitted across a ~1ms real-time span straddling the boundary. NO smoothing.
    name: "fixed-window: 2x boundary burst (required tradeoff)",
    make: fw,
    steps: [
      { now: 999, cost: 1, key: "burst" }, // window 0, end
      { now: 999, cost: 1, key: "burst" },
      { now: 999, cost: 1, key: "burst" },
      { now: 999, cost: 1, key: "burst" },
      { now: 999, cost: 1, key: "burst" }, // 5 admitted → window 0 full
      { now: 999, cost: 1, key: "burst" }, // reject (window 0 full)
      { now: 1000, cost: 1, key: "burst" }, // window 1 → counter reset → admit
      { now: 1000, cost: 1, key: "burst" },
      { now: 1000, cost: 1, key: "burst" },
      { now: 1000, cost: 1, key: "burst" },
      { now: 1000, cost: 1, key: "burst" }, // 5 MORE admitted → 2x across ~1ms
    ],
  },
];
