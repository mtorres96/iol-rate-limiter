---
phase: 01-core-algorithms-in-memory-reference
plan: 04
subsystem: core-tests
tags: [testing, vitest, fakeclock, concurrency, algorithms]
requires:
  - rate-limiter/src/index.ts (limiters, MemoryStore, FakeClock barrel)
  - rate-limiter/src/store/memory.ts (the three algorithm ops under test)
provides:
  - Deterministic FakeClock unit coverage for all three algorithms
  - Xu Ch.4 pinned sliding-window regression anchor (Phase-2 TS<->Lua target)
  - Event-loop over-admission guard (memory half of the Core Value)
affects:
  - Phase 2 conformance suite (uses the pinned exact integer values as the Lua target)
tech-stack:
  added: []
  patterns:
    - FakeClock injection (no vi.useFakeTimers / no real sleeps)
    - Promise.all overlapping burst -> assert exactly `limit` admitted
key-files:
  created:
    - rate-limiter/test/token-bucket.test.ts
    - rate-limiter/test/sliding-window.test.ts
    - rate-limiter/test/fixed-window.test.ts
    - rate-limiter/test/concurrency.test.ts
  modified: []
decisions:
  - "Logged the 3 'current window' requests at the 50% mark (overlap 0.5) so curr accumulates to exactly 3 under the same weighting Xu measures — the only setup that reproduces prev=5/curr=3/floor(5.5)=5/remaining=1 verbatim"
  - "Reworded a token-bucket comment to avoid the literal tokens `vi.useFakeTimers`/`setTimeout` so the no-real-timer verify gate (a substring guard) does not false-positive on prose"
metrics:
  duration: 6 min
  tasks: 2
  files: 4
  tests: 19
  completed: 2026-06-23
---

# Phase 1 Plan 04: Algorithm & Concurrency Tests Summary

Deterministic FakeClock unit tests prove all three rate-limiting algorithms (refill, burst, rollover, cost, exact-limit boundary, cost>capacity graceful reject) with exact integer `resetMs`/`retryAfterMs`/`remaining` assertions, pin Xu Ch.4's sliding-window worked example verbatim, demonstrate Fixed Window's 2x boundary burst as required behavior, and prove the in-memory over-admission guard admits exactly `limit` under an overlapping `Promise.all` burst — the executable proof of the deliverable's Core Value.

## What Was Built

Four test files under `rate-limiter/test/`, 19 tests total, all green; `vitest run`, `tsc --noEmit`, and `eslint test/` all exit 0.

### Task 1 — Algorithm determinism (`ad3521c`)
- **`token-bucket.test.ts`** (9 tests): burst-to-capacity then reject; lazy refill of exactly N tokens after N `clock.tick` intervals; fractional refill floored into `remaining` (D-04); `cost>1` consumes the right count with all-or-nothing reject; exact-limit boundary; `cost>capacity` graceful reject leaving state intact (D-02) with best-effort `retryAfterMs=5000`; EXACT `resetMs=5000` / `retryAfterMs=1000` from the `Math.ceil` contract; ceil-rounding of a fractional 500ms deficit.
- **`sliding-window.test.ts`** (4 tests): the **Xu Ch.4 pinned example** — limit=7, prev=5, curr=3, 50% into the window → `floor(3 + 5*0.5)=floor(5.5)=5`, `5+1=6<=7` → admit, `remaining=1`, `resetMs=30000`; full-window rollover (curr→prev) and ≥2-window decay (prev→0); estimate-floor boundary (admit at the exact `floor(estimate)+cost==limit` edge, reject just past); unchanged-current-count on reject (D-01).
- **`fixed-window.test.ts`** (4 tests): within-window admit/reject; bucket-index rollover reset; EXACT `resetMs`/`retryAfterMs=800` to the boundary; the **explicit 2x boundary burst** — `limit` admitted at `t=999` and `limit` more at `t=1000`, asserting `2*limit` within a ~1ms real-time span, commented as the known REQUIRED tradeoff (not a bug).

### Task 2 — Over-admission guard (`9e836e5`)
- **`concurrency.test.ts`** (3 tests): fires `N>limit` overlapping `consume(sameKey)` calls via `Promise.all` against Token Bucket (N=50, cap=5) and Fixed Window (N=100, limit=7), asserting EXACTLY `limit` resolve `allowed:true`. A fixed `FakeClock` ensures refill cannot mask the guard. A detailed comment block justifies the guarantee as **event-loop atomicity** — each op is a single synchronous read-modify-write with no `await` inside, so no interleaving observes stale state; no mutex/lock — and explicitly distinguishes it from the Phase-2 Lua/Redis multi-client atomicity. A reinforcement test calls the store op directly to document the torn-read-modify-write failure mode the event loop prevents.

## Deviations from Plan

None — plan executed as written. Two within-task implementation refinements (no rules triggered, no scope change):
- The sliding-window setup logs the 3 current-window requests at the 50% mark (overlap 0.5) rather than at window start (overlap 1.0); only this ordering accumulates `curr=3` under Xu's exact weighting and reproduces `remaining=1`. Caught and fixed during the first `vitest run`.
- One token-bucket header comment was reworded to avoid the literal strings the no-real-timer verify gate greps for (`vi.useFakeTimers`/`setTimeout`), which had false-positived on the explanatory prose. No test logic changed.

## Verification

- `cd rate-limiter && npx vitest run` → 4 files, 19 tests, all pass (exit 0).
- `cd rate-limiter && npx tsc --noEmit` → exit 0 (type gate green with tests included).
- `cd rate-limiter && npx eslint test/` → exit 0.
- Both plan verify-gate node checks (SW pinned-example presence, no real timers, FW boundary-burst presence; concurrency `Promise.all`/`allowed`/event-loop-comment presence, no real timers) → `ok`.

## Self-Check: PASSED

- All four created test files exist on disk.
- Both task commits (`ad3521c`, `9e836e5`) present in git history.
