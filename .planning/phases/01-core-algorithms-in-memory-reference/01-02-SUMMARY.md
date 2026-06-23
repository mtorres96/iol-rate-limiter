---
phase: 01-core-algorithms-in-memory-reference
plan: 02
subsystem: api
tags: [typescript, esm, contracts, clock, rate-limiter]

# Dependency graph
requires:
  - phase: 01-core-algorithms-in-memory-reference (plan 01-01)
    provides: scaffolded ESM /rate-limiter package (locked dev deps, green tsc/eslint/vitest gates)
provides:
  - Core contract types (RateLimiter, Decision, Store, Clock, OpTuple, TBConfig, WindowConfig) in src/types.ts
  - Injectable SystemClock + deterministic FakeClock in src/clock.ts
affects: [01-03 memory store + limiters, 01-04 barrel/tests, phase-02 RedisStore + conformance, phase-03 express adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Interface-first seam: contracts authored before implementations so downstream plans/phases import exact shapes"
    - "Primitive OpTuple at the Store boundary (not Decision) for zero TS↔Lua representation mismatch"
    - "Injected Clock with hand-rolled FakeClock (no vi.useFakeTimers, no real timers)"

key-files:
  created:
    - rate-limiter/src/types.ts
    - rate-limiter/src/clock.ts
  modified: []

key-decisions:
  - "Store exposes exactly 3 algorithm-shaped ops (tokenBucket/slidingWindow/fixedWindow) returning OpTuple — no generic get/set (D-06/D-08)"
  - "OpTuple is the integer-ms boundary; fractional state stays inside the store (D-09)"
  - "FakeClock tick/setTime return `this` for chaining; SystemClock is the default limiter clock arg"

patterns-established:
  - "Contracts-only file imports nothing from Express/ioredis (tier boundary)"
  - "Clock type imported via ESM `./types.js` specifier under verbatimModuleSyntax"

requirements-completed: [CORE-01, CORE-02, CORE-03, CORE-04, CORE-05]

# Metrics
duration: 1min
completed: 2026-06-23
---

# Phase 1 Plan 02: Core Contracts & Clock Summary

**Framework-agnostic core seam: RateLimiter/Decision/Store/Clock interfaces, OpTuple op-boundary type, TB/Window configs, plus an injectable SystemClock and a deterministic timer-free FakeClock.**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-06-23T23:11:14Z
- **Completed:** 2026-06-23T23:12:19Z
- **Tasks:** 2
- **Files modified:** 2 (created)

## Accomplishments
- Defined all seven core contracts in `src/types.ts` — the exact shapes Phase 2 (RedisStore + conformance) and Phase 3 (Express adapter) depend on.
- `Store` exposes one atomic algorithm-shaped op per algorithm, each returning the primitive `OpTuple` (no generic get/set, no Decision-returning op) — preserving the Lua-port atomicity contract.
- Implemented an injectable `Clock` with `SystemClock` (default) and a deterministic `FakeClock` (`tick`/`setTime`, no real timers) for sleep-free time tests.
- Core stays framework/transport-agnostic: zero Express/ioredis imports; `tsc --noEmit` green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define the core contract types** - `6b0773a` (feat)
2. **Task 2: Implement the injectable Clock and deterministic FakeClock** - `50abcb6` (feat)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `rate-limiter/src/types.ts` - Clock, OpTuple, Decision, RateLimiter, Store, TBConfig, WindowConfig contracts (documented with D-01..D-12 rationale)
- `rate-limiter/src/clock.ts` - SystemClock (Date.now) + FakeClock (manual tick/setTime, implements Clock)

## Decisions Made
None beyond the locked plan decisions (D-01..D-14). The contract shapes were authored verbatim from 01-PATTERNS.md / 01-CONTEXT.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded clock.ts doc comment to satisfy the verifier regex**
- **Found during:** Task 2 (FakeClock implementation)
- **Issue:** The task's automated check `/setTimeout|useFakeTimers/` matched the literal substrings inside an explanatory JSDoc comment ("no `setTimeout`, no `vi.useFakeTimers()`"), producing a false-positive "real timer leaked" failure. No real timer was ever used.
- **Fix:** Reworded the comment to "no real timers and no fake-timer runner hooks" — preserving intent without tripping the substring check. Implementation code was unchanged.
- **Files modified:** rate-limiter/src/clock.ts
- **Verification:** Re-ran the Task 2 automated check → `ok`; `tsc --noEmit` exits 0.
- **Committed in:** 50abcb6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 verifier false-positive in comment text)
**Impact on plan:** Cosmetic comment wording only; no behavior, API, or scope change.

## Issues Encountered
- The plan's stub `src/index.ts` (`export {}`) remains the placeholder barrel — replacing it with the real barrel is plan 01-03's job (per prior-wave context), intentionally not done here.

## Known Stubs
None introduced by this plan. (`rate-limiter/src/index.ts` remains the pre-existing `export {}` placeholder from plan 01-01, owned by plan 01-03 — not a stub created here.)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Contracts and clock are in place; plan 01-03 can implement `MemoryStore` (3 ops returning `OpTuple`) and the three thin limiter wrappers against these exact types.
- Plan 01-04 / the barrel (01-03) will re-export these symbols from `src/index.ts`.
- No blockers.

## Self-Check: PASSED

- FOUND: rate-limiter/src/types.ts
- FOUND: rate-limiter/src/clock.ts
- FOUND: .planning/phases/01-core-algorithms-in-memory-reference/01-02-SUMMARY.md
- FOUND commit: 6b0773a (Task 1)
- FOUND commit: 50abcb6 (Task 2)

---
*Phase: 01-core-algorithms-in-memory-reference*
*Completed: 2026-06-23*
