---
phase: 01-core-algorithms-in-memory-reference
reviewed: 2026-06-23T20:30:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - rate-limiter/src/types.ts
  - rate-limiter/src/clock.ts
  - rate-limiter/src/store/memory.ts
  - rate-limiter/src/limiters/token-bucket.ts
  - rate-limiter/src/limiters/sliding-window.ts
  - rate-limiter/src/limiters/fixed-window.ts
  - rate-limiter/src/index.ts
  - rate-limiter/test/token-bucket.test.ts
  - rate-limiter/test/sliding-window.test.ts
  - rate-limiter/test/fixed-window.test.ts
  - rate-limiter/test/concurrency.test.ts
  - rate-limiter/package.json
  - rate-limiter/tsconfig.json
  - rate-limiter/tsup.config.ts
  - rate-limiter/vitest.config.ts
  - rate-limiter/eslint.config.js
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-23T20:30:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Reviewed the in-memory reference implementation of the three rate-limiting algorithms (Token Bucket, Sliding Window Counter, Fixed Window Counter), their thin limiter wrappers, the clock abstraction, shared contracts, the test suite, and build/lint/test config.

The algorithm math, rounding contract (`Math.floor` for `remaining`, `Math.ceil` for durations), event-loop atomicity (no `await` in any op critical section), all-or-nothing consumption (D-01), and graceful `cost > capacity` handling (D-02) are all implemented correctly and verified by the existing 19 passing tests. `tsc --noEmit` is clean and the core imports nothing from Express/ioredis.

The dominant defect is a **complete absence of `cost` parameter validation**. While config is rigorously validated at construction, the per-request `cost` argument is trusted blindly across all three algorithms. This is a correctness-and-abuse hole, not a style nit: I built and ran repro tests against the real source confirming that a **negative cost inflates the Token Bucket above capacity** (`consume("k", -3)` on a capacity-5 bucket yields `remaining: 8`), **decrements the window counters** (freeing allowance an attacker never earned), a **`NaN` cost leaks `NaN` into the public `Decision.retryAfterMs`** (violating the integer-ms boundary contract Phase-2 Lua conformance depends on), and a **`cost: 0` request is always admitted even against a fully exhausted limit**. Because `cost` is caller-supplied and the core treats `key`/`cost` as the request surface, this is reachable from the Phase-3 adapter.

Secondary findings: the `assertPositive` validator is triplicated verbatim across the three limiter files, and there is no shared validation seam to fix the `cost` hole in one place.

Per domain context, the intentional Fixed-Window 2x boundary burst and the unbounded `MemoryStore` keyspace are NOT flagged.

## Critical Issues

### CR-01: No `cost` validation — negative/zero cost corrupts limiter state and bypasses the limit

**File:** `rate-limiter/src/store/memory.ts:56`, `:104`, `:180` (all three ops); reachable via `rate-limiter/src/limiters/token-bucket.ts:25`, `sliding-window.ts:21`, `fixed-window.ts:21`

**Issue:** `consume(key, cost = 1)` passes `cost` straight into the store ops with no validation. The ops assume `cost` is a positive integer but never enforce it. Confirmed by repro tests run against the real source:

- **Token Bucket, negative cost:** `tokenBucket` computes `tokensAfter = refilled - cost`. With `cost = -3` on a full capacity-5 bucket, `tokensAfter = 5 - (-3) = 8`, which is **never re-clamped to `capacity`**. The persisted state is `{ tokens: 8 }` and the returned `remaining` is `8` — a bucket holding more than its capacity. An attacker (or a buggy caller) can mint unlimited future allowance.
- **Sliding / Fixed Window, negative cost:** `currAfter = curr + cost` (or `count + cost`) with negative `cost` **decrements** the window counter, freeing slots. Against a full `limit=3` sliding window, `consume("k", -1)` is admitted and lowers the stored count, so a subsequent normal request that should reject is admitted.
- **`cost = 0`:** `0 <= refilled` / `count + 0 <= limit` is always true even when the limiter is fully exhausted, so a `cost: 0` request always returns `allowed: true`. Against a drained `limit=5` fixed window, `consume("k", 0)` returns `allowed: true, remaining: 0`.

This corrupts the core invariant the whole project is graded on ("the algorithms must provably enforce their limits") and is byte-state-corrupting, so it also breaks the D-01 all-or-nothing guarantee for any subsequent legitimate request.

**Fix:** Validate `cost` at the top of `consume()` (or, better, once in a shared helper) before delegating to the store. Reject non-integer, non-finite, or non-positive `cost`:
```ts
function assertCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < 1) {
    throw new RangeError(
      `consume: \`cost\` must be a positive integer, got ${cost}`,
    );
  }
}
// in each consume():
async consume(key: string, cost = 1): Promise<Decision> {
  assertCost(cost);
  // ...delegate to store
}
```
(If `cost: 0` should be a legal no-op probe by design, special-case it explicitly and document it — but it must not silently report `allowed: true` while the limiter is exhausted.)

### CR-02: `NaN` / `Infinity` `cost` leaks `NaN` into the public `Decision`, violating the integer-ms boundary contract

**File:** `rate-limiter/src/store/memory.ts:82-86` (token bucket `need`/`retryAfterMs`); same class of issue in the window ops

**Issue:** With `cost = NaN`, the Token Bucket op evaluates `cost <= refilled` as `false` (correctly rejects, state preserved), but then computes `need = Math.max(0, NaN - refilled) = NaN` and `retryAfterMs = Math.ceil(NaN / ...) = NaN`. The returned `OpTuple` therefore carries `NaN`, and the limiter copies it straight into `Decision.retryAfterMs`. Confirmed by repro: `consume("k", NaN)` produces a `Decision` with `retryAfterMs: NaN`.

This breaks the LOCKED rounding/integer-ms contract ("integer ms cross the op boundary, D-09") that the Phase-2 Lua conformance suite (TEST-02) compares against, and a Phase-3 adapter would emit a malformed `Retry-After: NaN` header. `Infinity` cost rejects without throwing (acceptable) but would similarly poison duration arithmetic in other paths.

**Fix:** The `assertCost` guard in CR-01 (rejecting non-finite `cost`) eliminates this entirely — `NaN`/`Infinity` never reach the arithmetic. Add it as part of the same fix.

## Warnings

### WR-01: `assertPositive` validator triplicated verbatim across all three limiters

**File:** `rate-limiter/src/limiters/token-bucket.ts:43-47`, `sliding-window.ts:39-43`, `fixed-window.ts:39-43`

**Issue:** The identical `assertPositive(name, value)` function is copy-pasted into all three limiter files (only the class-name prefix in the message differs). This is duplicated logic that must stay in lockstep; the `cost`-validation fix (CR-01/CR-02) would otherwise have to be pasted three more times, compounding drift risk.

**Fix:** Extract a shared `validate.ts` (e.g. `assertPositiveConfig(label, name, value)` and `assertCost(cost)`) and import it into all three limiters. Keeps construction-time and per-request validation in one auditable place.

### WR-02: Fractional `cost` is silently accepted and produces a misleading `remaining`

**File:** `rate-limiter/src/store/memory.ts:73-79` (and window ops)

**Issue:** Even setting aside negative/NaN, a fractional positive `cost` (e.g. `0.5`, `2.5`) is accepted. In Token Bucket, `cost = 2.5` consumes 2.5 tokens and `remaining` floors the residual, so the public allowance accounting drifts from caller intent. The `OpTuple` contract states durations are integer-ms and counts are integers; a fractional `cost` quietly violates the integer-count assumption the Lua port will mirror.

**Fix:** Covered by the `Number.isInteger(cost)` check in CR-01. Decide and document whether `cost` is integers-only (recommended for Lua parity) and enforce it.

### WR-03: `remaining` derived from `usedAfter` rather than internal state — divergence is latent

**File:** `rate-limiter/src/store/memory.ts:137,140-141`

**Issue:** Sliding Window persists `curr: currAfter` (`= curr + cost`) but computes the returned `remaining` from a separate quantity `usedAfter = flooredEstimate + cost`. These two numbers are not the same variable, and their agreement relies on `flooredEstimate` always incorporating the weighted prev contribution consistently. I traced the Xu example forward (8 consecutive calls) and `remaining` stayed monotone and consistent with admit/reject in that path, so this is not a confirmed live bug — but the dual-source-of-truth is fragile and easy to break in Phase-2 porting. Flagging as a maintainability/correctness-risk warning, not a blocker.

**Fix:** Add a regression test that asserts, for every call in a long same-window sequence, `remaining > 0` implies the immediately-following same-`now` probe is admitted (and `remaining === 0` implies it rejects). This pins the invariant the Lua port must preserve.

### WR-04: `now` is assumed integer but never enforced at the op boundary

**File:** `rate-limiter/src/store/memory.ts:56,104,180`; contract in `rate-limiter/src/types.ts:15-17`

**Issue:** The contract states `now()` returns INTEGER ms, and `SystemClock` (via `Date.now()`) and `FakeClock` honor it. But nothing enforces it at the store boundary. A custom `Clock` returning a fractional `now` would feed fractional time into `Math.floor(now / windowMs)` bucket math and the weighted-overlap fraction, producing off-by-one window boundaries that diverge from the integer-only Lua port. Low likelihood given the provided clocks, hence Warning not Blocker.

**Fix:** Either document `now` as integer-only and trust the seam, or defensively `now = Math.floor(now)` at the op entry (matching what Lua `ARGV` integer coercion will do). Prefer the latter for Lua parity.

## Info

### IN-01: Sliding Window `retryAfterMs` is a best-effort linear-decay estimate

**File:** `rate-limiter/src/store/memory.ts:148-165`

**Issue:** The `retryAfterMs` for a rejected sliding-window request models `prev` decaying linearly (`windowMs / prev` ms per unit weight) and clamps to the boundary. This is an approximation (the comment acknowledges "best-effort"), and the floored-estimate re-evaluation at the predicted retry time may not exactly admit. It is internally consistent and clamped to a safe upper bound (the boundary), so it never under-reports — acceptable for v1. Noted for DESIGN.md so the approximation is disclosed rather than presented as exact.

**Fix:** None required for Phase 1. Document the approximation in DESIGN.md and ensure the Phase-2 Lua reproduces the same formula bit-for-bit (it is part of the conformance surface).

### IN-02: `key` is unvalidated (empty string / very long keys accepted)

**File:** `rate-limiter/src/store/memory.ts:56,104,180`

**Issue:** `key` is opaque to the core by design (CORE-05), so this is intentional. Noting only that an empty-string key is a valid distinct `Map` bucket; this is harmless for the in-memory store but worth a one-line note in DESIGN.md given the keyspace is unbounded by design.

**Fix:** None — documented Phase-1 limitation. No action.

---

_Reviewed: 2026-06-23T20:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
