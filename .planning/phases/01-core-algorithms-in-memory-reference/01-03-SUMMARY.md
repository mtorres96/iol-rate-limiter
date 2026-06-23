---
phase: 01-core-algorithms-in-memory-reference
plan: 03
subsystem: core-algorithms
tags: [rate-limiter, token-bucket, sliding-window, fixed-window, memory-store, reference-impl]
requires:
  - rate-limiter/src/types.ts (Store, OpTuple, TBConfig, WindowConfig, RateLimiter, Decision, Clock)
  - rate-limiter/src/clock.ts (SystemClock, FakeClock)
provides:
  - MemoryStore (3 algorithm-shaped atomic ops, the human-readable reference impl)
  - TokenBucketLimiter / SlidingWindowLimiter / FixedWindowLimiter (interchangeable RateLimiter wrappers)
  - public barrel (src/index.ts) exposing the full core API surface
affects:
  - Phase 2 RedisStore + conformance suite (ports MemoryStore ops to Lua; compares OpTuples)
  - Phase 3 Express middleware (consumes the RateLimiter interface)
  - plan 01-04 test suites (exercise these limiters + MemoryStore via FakeClock)
tech-stack:
  added: []
  patterns:
    - "Algorithm-as-store-op: the algorithm math lives inside each Store op (D-06); the limiter only assembles Decision (D-07)"
    - "Event-loop atomicity: each op is one synchronous read-modify-write, no await inside (no mutex/lock)"
    - "Rounding contract pinned in comments: floor remaining, ceil resetMs/retryAfterMs (Lua parity for TEST-02)"
    - "All-or-nothing consumption: reject leaves state byte-identical (D-01); cost>capacity rejects without throwing (D-02)"
    - "Construction-time config validation throwing RangeError on non-positive/NaN/non-finite (T-01-06)"
key-files:
  created:
    - rate-limiter/src/store/memory.ts
    - rate-limiter/src/limiters/token-bucket.ts
    - rate-limiter/src/limiters/sliding-window.ts
    - rate-limiter/src/limiters/fixed-window.ts
  modified:
    - rate-limiter/src/index.ts
decisions:
  - "Sliding-window retryAfterMs is best-effort: when curr alone exceeds the limit, soonest relief is the next bucket boundary; otherwise estimated from previous-window linear decay, clamped to the boundary"
  - "Shared WindowState shape ({bucket, curr, prev}) for both window algorithms; fixed window leaves prev=0 (unused)"
  - "Config validation lives in each limiter constructor (not MemoryStore) so the store stays a pure reference op; RangeError chosen for a clear message"
metrics:
  duration: 3 min
  completed: 2026-06-23
  tasks: 2
  files: 5
---

# Phase 1 Plan 03: MemoryStore Algorithms & Thin Limiters Summary

The three rate-limiting algorithms (Token Bucket, Sliding Window Counter, Fixed Window Counter) implemented as event-loop-atomic `MemoryStore` ops returning integer-ms `OpTuple`s, wrapped by three interchangeable thin limiters and exposed through the public barrel — the hand-written, human-readable reference impl the Phase-2 Lua ports line-by-line.

## What Was Built

**Task 1 — `MemoryStore` (rate-limiter/src/store/memory.ts):** three algorithm-shaped ops over a `Map<string, AlgoState>`, each a single synchronous 5-step read-modify-write critical section with no `await` inside (event-loop atomicity, no mutex):
- `tokenBucket` — lazy refill `min(capacity, tokens + (elapsed/intervalMs)*refillPerInterval)` recomputed from integer `now` each call (no fractional-ms drift); all-or-nothing admit; `cost>capacity` rejects gracefully (D-02).
- `slidingWindow` — weighted estimate `curr + prev*overlapFraction`; admit when `floor(estimate)+cost <= limit` (D-13). The Xu Ch.4 anchor (limit=7, prev=5, curr=3, 50%-in → floor(5.5)=5, 5+1=6<=7 → admit, remaining=1, D-14) was verified at runtime.
- `fixedWindow` — per-bucket counter reset on bucket change; the required 2× boundary burst is preserved (no smoothing, ALGO-03), verified at runtime (6 admits across the boundary for limit=3).
- Rounding contract pinned in code comments on every outgoing duration and on `remaining` (floor remaining; ceil resetMs/retryAfterMs), each tagged with its Lua equivalent for TEST-02 conformance.

**Task 2 — three thin limiters + barrel:** `TokenBucketLimiter`, `SlidingWindowLimiter`, `FixedWindowLimiter` each implement `RateLimiter`, take `(store, cfg, clock = SystemClock)`, delegate to their matching `store.*` op, and assemble `Decision` (`limit` = capacity / limit per D-12). Each constructor validates config (throws `RangeError` on non-positive/NaN/non-finite). `consume` defaults `cost = 1` and is `async` only to satisfy `Promise<Decision>`. `src/index.ts` re-exports the seven contracts + `MemoryStore` + the three limiters + `SystemClock`/`FakeClock`.

## Verification Results

- `npx tsc --noEmit` — exits 0.
- `npx eslint .` — exits 0.
- Task 1 op-structure gate — passed (MemoryStore + three ops + floor/ceil/Map present; no `await` in any op body; no express/ioredis import).
- Task 2 wiring gate — passed (each limiter delegates to its op; barrel exposes all six runtime names).
- Runtime smoke (node --experimental-strip-types): Token Bucket drain/reject/refill/`cost>capacity`, Fixed Window 2× boundary burst, and the D-14 sliding-window worked example all produced the expected tuples.

## Deviations from Plan

None — plan executed exactly as written. Rules 1–4 not triggered; no auth gates; no architectural changes.

(Note: an initial ad-hoc smoke harness mis-set up the sliding-window state by firing requests at the exact bucket boundary where overlap=1.0; re-running with the textbook prev=5/curr=3/50%-in state confirmed the algorithm itself is correct — `remaining=1`. This was a test-scaffold misread, not an implementation issue, and the scaffold was scratch-only.)

## Threat Model Compliance

- **T-01-06 (mitigate):** each limiter constructor validates config and throws `RangeError` before any op runs.
- **T-01-07 (mitigate):** every op is one synchronous critical section with no `await`; verify gate enforces this.
- **T-01-09 (mitigate):** `cost > capacity`/`limit` returns `allowed:0` without throwing or partial drain; reject leaves state byte-identical.
- **T-01-08 (accept):** MemoryStore `Map` key-space is unbounded by design — documented in code comment, deferred to Redis TTL (Phase 2) / DESIGN.md (Phase 4).

## Known Stubs

None. All ops compute real algorithm output; the limiters wire real config to real store ops. `SystemClock` default is intentional (wall-clock path, untested by design per RESEARCH Pattern 2).

## Self-Check: PASSED

- Files exist: rate-limiter/src/store/memory.ts, limiters/{token-bucket,sliding-window,fixed-window}.ts, src/index.ts — all FOUND.
- Commits exist: 3d8bbd3 (Task 1), 9f5d80d (Task 2) — both FOUND in git log.
