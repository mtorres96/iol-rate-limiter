---
phase: 01-core-algorithms-in-memory-reference
verified: 2026-06-23T20:45:00Z
status: passed
score: 12/12
overrides_applied: 0
re_verification: false
---

# Phase 1: Core Algorithms — In-Memory Reference Verification Report

**Phase Goal:** The framework-agnostic core exists and provably enforces limits — all three algorithms (Token Bucket, Sliding Window Counter, Fixed Window Counter) are interchangeable behind one `RateLimiter` interface and pass exhaustive deterministic tests against an in-memory store.
**Verified:** 2026-06-23T20:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All solution code lives under `/rate-limiter` and `tsc --noEmit` exits 0 | VERIFIED | `npx tsc --noEmit` exits 0; all source under `rate-limiter/src/` and `rate-limiter/test/` |
| 2 | Each algorithm is swappable behind `RateLimiter.consume(key, cost?)` returning a `Decision` with `allowed, limit, remaining, resetMs, retryAfterMs` | VERIFIED | `TokenBucketLimiter`, `SlidingWindowLimiter`, `FixedWindowLimiter` all implement `RateLimiter`; all assemble `Decision` from `OpTuple`; confirmed in source |
| 3 | FakeClock-driven tests (no real sleeps) demonstrate refill, burst, window rollover, request cost, and exact-limit boundary — including Fixed Window's documented boundary-burst | VERIFIED | 5 test files, 46 tests passing; `token-bucket.test.ts` covers refill/burst/cost/boundary; `fixed-window.test.ts` explicitly asserts `admitted === 2 * cfg.limit` across boundary; no `vi.useFakeTimers` or `setTimeout` found anywhere |
| 4 | A burst of concurrent in-memory `consume` calls admits exactly `limit`; the `Store` interface exposes one algorithm-shaped atomic op per algorithm (not generic get/set) | VERIFIED | `concurrency.test.ts` fires 50–100 overlapping calls via `Promise.all`, asserts exactly `LIMIT` allowed for both Token Bucket and Fixed Window; `Store` interface has only `tokenBucket/slidingWindow/fixedWindow`, no `get/set` |
| 5 | CORE-01/02: `RateLimiter.consume(key, cost?)` returns `Promise<Decision>` with all five fields | VERIFIED | `types.ts` lines 61–63 and 40–51; all three limiters return `Decision` with `allowed, limit, remaining, resetMs, retryAfterMs` |
| 6 | CORE-03: Injectable `Clock` with `FakeClock` (tick/setTime, integer ms, no real timers) | VERIFIED | `clock.ts` exports `SystemClock` and `FakeClock implements Clock`; `FakeClock` has `tick(ms)` and `setTime(ms)`; no `setTimeout` or `useFakeTimers` |
| 7 | CORE-04/05: `Store` exposes one algorithm-shaped op per algorithm; `key` is opaque to core | VERIFIED | `types.ts` Store interface has exactly `tokenBucket/slidingWindow/fixedWindow`; no generic get/set; CORE-05 documented in comment on `RateLimiter` |
| 8 | ALGO-01/02/03: All three algorithm ops implement correct math (refill/weighted-estimate/fixed-window-burst) with rounding contract pinned in comments | VERIFIED | `memory.ts` has `Math.floor` for `remaining`, `Math.ceil` for all durations, each with "matches Lua math.ceil/floor" comments; no `await` inside any op body |
| 9 | ALGO-04: All three algorithms are interchangeable behind `RateLimiter` | VERIFIED | All three limiters implement `RateLimiter`; barrel re-exports all three; concurrency test uses `RateLimiter` interface type |
| 10 | STOR-01: In-memory Store is event-loop-atomic (single synchronous read-modify-write, no `await` in op body) | VERIFIED | Grep for `await` in `memory.ts` finds only comment text (line 10), not executable `await` statements; all ops are synchronous critical sections |
| 11 | TEST-01: Comprehensive FakeClock tests including Xu Ch.4 pinned example, cost-validation guard, and concurrency guard | VERIFIED | 5 test files, 46 tests, all passing. Xu Ch.4 in `sliding-window.test.ts` (limit=7, prev=5, curr=3, 50% in → remaining=1). Cost-validation in `cost-validation.test.ts` covering 6 illegal cost types × 3 limiters |
| 12 | DELIV-05: Solution lives under `/rate-limiter` folder | VERIFIED | All source under `/rate-limiter/src/`, tests under `/rate-limiter/test/`, no algorithm code outside |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `rate-limiter/package.json` | ESM manifest, zero runtime deps, scripts wired | VERIFIED | `"type": "module"`, no `dependencies` key, all 7 required devDependencies present |
| `rate-limiter/tsconfig.json` | Strict ESM tsconfig, `noEmit: true` | VERIFIED | `"noEmit": true`, `"strict": true`, `"moduleResolution": "Bundler"` |
| `rate-limiter/tsup.config.ts` | ESM-only build with dts | VERIFIED | `format: ['esm']`, `dts: true`, `entry: ['src/index.ts']` |
| `rate-limiter/vitest.config.ts` | Node env, v8 coverage | VERIFIED | `environment: 'node'`, `coverage.provider: 'v8'` |
| `rate-limiter/eslint.config.js` | Flat config, typescript-eslint + prettier last | VERIFIED | Imports `tseslint` and `prettier`; prettier listed last; `npx eslint .` exits 0 |
| `rate-limiter/src/types.ts` | All 7 contract exports, no generic get/set in Store | VERIFIED | Exports `Clock, OpTuple, Decision, RateLimiter, TBConfig, WindowConfig, Store`; Store has only 3 algo ops |
| `rate-limiter/src/clock.ts` | `SystemClock` + `FakeClock implements Clock` | VERIFIED | Both exported; `FakeClock` has `tick/setTime`; no real timers |
| `rate-limiter/src/store/memory.ts` | MemoryStore with 3 sync atomic ops, rounding contract | VERIFIED | All 3 ops present; no `await` in op bodies; `Math.floor`/`Math.ceil` with Lua-parity comments |
| `rate-limiter/src/validate.ts` | `assertCost` + `assertPositiveConfig` shared helpers | VERIFIED | Both functions present; `assertCost` rejects `!Number.isInteger(cost) \|\| cost < 1`; fixes CR-01/CR-02 from REVIEW |
| `rate-limiter/src/limiters/token-bucket.ts` | Thin wrapper, delegates to `store.tokenBucket`, `limit = capacity` | VERIFIED | Delegates via `store.tokenBucket`; `limit: this.cfg.capacity`; calls `assertCost(cost)` |
| `rate-limiter/src/limiters/sliding-window.ts` | Thin wrapper, delegates to `store.slidingWindow` | VERIFIED | Delegates via `store.slidingWindow`; `limit: this.cfg.limit`; calls `assertCost(cost)` |
| `rate-limiter/src/limiters/fixed-window.ts` | Thin wrapper, delegates to `store.fixedWindow` | VERIFIED | Delegates via `store.fixedWindow`; `limit: this.cfg.limit`; calls `assertCost(cost)` |
| `rate-limiter/src/index.ts` | Barrel re-exporting all 7 contracts + MemoryStore + 3 limiters + 2 clocks | VERIFIED | Re-exports all 13 named items |
| `rate-limiter/test/token-bucket.test.ts` | Refill, burst, cost, boundary, rounding assertions | VERIFIED | 7 tests covering all specified behaviors |
| `rate-limiter/test/sliding-window.test.ts` | Xu Ch.4 example + rollover + D-01 reject unchanged | VERIFIED | 5 tests; pinned Xu example present and asserted verbatim |
| `rate-limiter/test/fixed-window.test.ts` | Rollover + explicit 2x boundary-burst | VERIFIED | 4 tests; boundary-burst test asserts `admitted === 2 * cfg.limit` |
| `rate-limiter/test/concurrency.test.ts` | N > limit overlapping calls, exactly `limit` admitted, event-loop comment | VERIFIED | 3 tests; `Promise.all`; burst for TB (N=50) and FW (N=100); event-loop comment at lines 4–23 |
| `rate-limiter/test/cost-validation.test.ts` | assertCost guard tested: negative/zero/fractional/NaN/Infinity all throw RangeError; state untouched | VERIFIED | 18+ tests; 6 bad-cost types × 3 limiters; state-mutation tests for each class of bad cost |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `package.json` | `tsconfig.json` | `typecheck` script runs `tsc --noEmit` | VERIFIED | Script present; `tsc --noEmit` exits 0 |
| `tsup.config.ts` | `src/index.ts` | entry points at the public barrel | VERIFIED | `entry: ['src/index.ts']` |
| `src/types.ts` | Store op contract | `Store.tokenBucket/slidingWindow/fixedWindow` return `OpTuple` | VERIFIED | All three return `OpTuple` type in interface |
| `src/clock.ts` | `src/types.ts` | `FakeClock implements Clock` | VERIFIED | `export class FakeClock implements Clock` at line 18 |
| `src/limiters/token-bucket.ts` | `src/store/memory.ts` | `store.tokenBucket(...)` | VERIFIED | Line 30: `this.store.tokenBucket(key, this.cfg, cost, this.clock.now())` |
| `src/limiters/sliding-window.ts` | `src/store/memory.ts` | `store.slidingWindow(...)` | VERIFIED | `this.store.slidingWindow(...)` present |
| `src/limiters/fixed-window.ts` | `src/store/memory.ts` | `store.fixedWindow(...)` | VERIFIED | `this.store.fixedWindow(...)` present |
| `src/index.ts` | all core modules | barrel re-export | VERIFIED | Re-exports types, clocks, MemoryStore, all 3 limiters |
| `test/sliding-window.test.ts` | D-14 pinned numbers | `limit: 7, prev: 5, curr: 3, 50% in → remaining: 1` | VERIFIED | Test name matches; assertions at lines 49–55 |
| `test/concurrency.test.ts` | `RateLimiter.consume` | `Promise.all` burst | VERIFIED | `burst()` helper at line 38; two algorithm guards at lines 45–73 |

---

### Data-Flow Trace (Level 4)

Not applicable. This phase produces a library, not a UI or server rendering dynamic data.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `tsc --noEmit` exits 0 | `npx tsc --noEmit` | exit 0 | PASS |
| ESLint exits 0 | `npx eslint .` | exit 0 | PASS |
| Full test suite (46 tests) passes | `npx vitest run` | 5 files, 46 tests passed, exit 0 | PASS |
| No express/ioredis imports in src | `grep -rE "from ['\"](express\|ioredis)" src/` | no matches | PASS |
| No `await` inside any store op body | `grep -n "await" src/store/memory.ts` (non-comment) | no matches | PASS |
| `assertCost` guard exists in validate.ts | code inspection | `!Number.isInteger(cost) \|\| cost < 1` throws `RangeError` | PASS |
| No real timers in tests | `grep -rE "vi\.useFakeTimers\|setTimeout" test/` | no matches | PASS |
| No unresolved debt markers | `grep -rE "TBD\|FIXME\|XXX" src/ test/` | no matches | PASS |

---

### Probe Execution

No probes declared for this phase. Step 7c: SKIPPED (no probe scripts).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CORE-01 | 01-02 | `RateLimiter.consume(key, cost?)` | SATISFIED | `types.ts` interface + all 3 limiter `consume()` impls |
| CORE-02 | 01-02 | `Decision` with `allowed, limit, remaining, resetMs, retryAfterMs` | SATISFIED | `types.ts` lines 40–51; all fields present in all three limiters |
| CORE-03 | 01-02 | Injectable `Clock` + `FakeClock` | SATISFIED | `clock.ts`: `SystemClock` + `FakeClock implements Clock` with `tick/setTime` |
| CORE-04 | 01-02 | `Store` with one algorithm-shaped op per algorithm | SATISFIED | `types.ts` Store: `tokenBucket/slidingWindow/fixedWindow` only |
| CORE-05 | 01-02 | `key` is opaque to core | SATISFIED | Documented in `types.ts` comment; no key parsing anywhere in core |
| ALGO-01 | 01-03 | Token Bucket — lazy refill, cost, capacity | SATISFIED | `memory.ts` `tokenBucket` op; `token-bucket.test.ts` 7 tests |
| ALGO-02 | 01-03 | Sliding Window Counter — weighted estimate formula | SATISFIED | `memory.ts` `slidingWindow` with D-14 pinned example; Xu Ch.4 test asserts exact numbers |
| ALGO-03 | 01-03 | Fixed Window Counter — documents boundary burst | SATISFIED | `memory.ts` `fixedWindow`; boundary-burst test asserts `2*limit` |
| ALGO-04 | 01-03 | All three interchangeable behind `RateLimiter` | SATISFIED | All three implement `RateLimiter`; concurrency test uses `RateLimiter` type |
| STOR-01 | 01-03 | In-memory Store, event-loop-atomic | SATISFIED | No `await` in op bodies; synchronous critical sections |
| TEST-01 | 01-04 | Comprehensive Vitest tests: refill, burst, rollover, cost, boundary, FakeClock, no sleeps | SATISFIED | 46 tests in 5 files passing; all required behaviors covered |
| DELIV-05 | 01-01 | Solution under `/rate-limiter` folder | SATISFIED | All code under `rate-limiter/` |

All 12 requirements assigned to Phase 1 are SATISFIED.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | Clean |

No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, or `PLACEHOLDER` markers found in any source or test file. No stub implementations, no empty returns, no hardcoded-empty data that flows to callers.

---

### Human Verification Required

None. All phase behaviors are mechanically verifiable:
- Algorithms are pure functions of injected time and in-memory state
- Tests use FakeClock with deterministic tick sequences
- No UI, no network, no external service

---

### Gaps Summary

No gaps. All 12 must-haves verified, all 12 requirements satisfied, full test suite passes, tooling exits 0.

**Notable post-execution fix confirmed:** The code review (01-REVIEW.md) identified CR-01/CR-02 (no `cost` validation allowing state corruption and NaN leakage). These were remediated before this verification:
- `src/validate.ts` was created with `assertCost` (rejects `!isInteger(cost) || cost < 1`) and `assertPositiveConfig`
- All three limiter `consume()` methods call `assertCost(cost)` before delegating to the store
- A dedicated `test/cost-validation.test.ts` proves all 6 illegal cost classes throw `RangeError` and do not mutate state

The CR-01/CR-02 fixes are present, working, and tested. The REVIEW warnings WR-01 (triplicated validator) was also resolved by extracting the shared `validate.ts`. WR-03 (sliding window `remaining` dual-source-of-truth) has a regression test in `sliding-window.test.ts` at the "WR-03 regression" test. WR-04 (non-enforced integer `now`) is acceptable per-phase scope.

---

_Verified: 2026-06-23T20:45:00Z_
_Verifier: Claude (gsd-verifier)_
