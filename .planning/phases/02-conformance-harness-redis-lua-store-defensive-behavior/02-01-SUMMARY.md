---
phase: 02-conformance-harness-redis-lua-store-defensive-behavior
plan: 01
subsystem: api
tags: [typescript, async, store-interface, redis-config, validation]

# Dependency graph
requires:
  - phase: 01
    provides: "Store interface, MemoryStore reference impl, three limiters, validate.ts (assertPositiveConfig/assertCost)"
provides:
  - "Uniform async Store contract: all three ops return Promise<OpTuple>"
  - "MemoryStore implements the async contract with its synchronous critical section intact (event-loop atomicity preserved)"
  - "RedisStoreConfig / RateLimitPolicy / BreakerConfig type-only shapes (ioredis-free) with documented D2-04..D2-07 defaults"
  - "assertPolicy + assertPrefix construction-time validators"
affects: ["plan 02-03 RedisStore (consumes RedisStoreConfig + async contract)", "plan 02-04 conformance suite (drives both stores via one async Store contract)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Uniform async Store contract (D2-01): both stores implement Promise<OpTuple>; MemoryStore wraps an unchanged synchronous body in Promise.resolve (no await in the critical section)"
    - "Type-only Redis config surface lives in the framework-agnostic core (types.ts), validated at construction by validate.ts; the core imports nothing from ioredis"

key-files:
  created: []
  modified:
    - "rate-limiter/src/types.ts"
    - "rate-limiter/src/store/memory.ts"
    - "rate-limiter/src/limiters/token-bucket.ts"
    - "rate-limiter/src/limiters/sliding-window.ts"
    - "rate-limiter/src/limiters/fixed-window.ts"
    - "rate-limiter/src/validate.ts"
    - "rate-limiter/src/index.ts"
    - "rate-limiter/test/concurrency.test.ts"

key-decisions:
  - "MemoryStore ops keep their exact synchronous read-modify-write body and only wrap the final tuple in Promise.resolve — preserves event-loop atomicity (no await inside the critical section)"
  - "Redis config types are type-only and ioredis-free; they live in the core and are re-exported from the public barrel so plan 03's RedisStore consumes contracts in-hand"
  - "assertPolicy/assertPrefix follow the existing throw-on-garbage RangeError template; numeric breaker/timeout fields reuse the existing assertPositiveConfig"

patterns-established:
  - "Async Store seam: limiters await the store op; both stores share one Promise<OpTuple> contract for identical conformance-suite driving"
  - "Construction-time config validation: policy/prefix validators in validate.ts reject garbage before any op runs (T-02-01 mitigation)"

requirements-completed: [STOR-05, DEF-01, DEF-02]

# Metrics
duration: ~10min
completed: 2026-06-24
---

# Phase 2 Plan 01: Async Store Contract + RedisStore Config Surface Summary

**Migrated the `Store` seam to a uniform `Promise<OpTuple>` async contract and added the ioredis-free `RedisStoreConfig` type surface plus `assertPolicy`/`assertPrefix` validators — the interface-first foundation plan 03's RedisStore is built against.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 2 completed
- **Files modified:** 8

## Accomplishments
- All three `Store` ops are now typed `Promise<OpTuple>`; MemoryStore implements them by wrapping its unchanged synchronous critical section in `Promise.resolve(...)` (no `await` introduced inside any op body — event-loop atomicity preserved, over-admission guard still admits exactly `limit`).
- The three limiters now `await` their store op.
- Added the Redis config surface to the framework-agnostic core: `RateLimitPolicy` (`"fail-open" | "fail-closed"`, default fail-open per D2-04), `BreakerConfig` (failureThreshold/cooldownMs, D2-05), and `RedisStoreConfig` (keyPrefix default `"rl"` D2-07, commandTimeoutMs 50–100 band D2-06, policy, breaker) — all type-only and ioredis-free, re-exported from the public barrel.
- Added `assertPolicy` and `assertPrefix` validators (throw `RangeError` on garbage) following the existing `validate.ts` template; numeric Redis fields reuse `assertPositiveConfig`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate Store interface + MemoryStore + three limiters to async** - `8e83566` (refactor)
2. **Task 2: Update concurrency test for async + add RedisStore config types and validators** - `37f6ec1` (feat)

## Files Created/Modified
- `rate-limiter/src/types.ts` - Store ops changed to `Promise<OpTuple>`; added `RateLimitPolicy`, `BreakerConfig`, `RedisStoreConfig` type-only shapes with documented defaults.
- `rate-limiter/src/store/memory.ts` - Three ops now return `Promise<OpTuple>` via `Promise.resolve(...)`; critical sections unchanged; header comment documents the async contract and atomicity preservation.
- `rate-limiter/src/limiters/token-bucket.ts` / `sliding-window.ts` / `fixed-window.ts` - Added `await` before the store op call.
- `rate-limiter/src/validate.ts` - Added `assertPolicy` and `assertPrefix`.
- `rate-limiter/src/index.ts` - Re-export `BreakerConfig`, `RateLimitPolicy`, `RedisStoreConfig`.
- `rate-limiter/test/concurrency.test.ts` - `await` the two direct `store.tokenBucket(...)` calls before indexing `[0]`.

## Verification
- `npm run typecheck` (`tsc --noEmit`) exits 0.
- `npx vitest run test/concurrency.test.ts` — 3/3 passed; over-admission guard still admits EXACTLY `limit` (proves the async migration did not tear MemoryStore's critical section).
- Full suite `npm test` — 5 files, 46/46 tests passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed declared dependencies in the worktree**
- **Found during:** Task 1 verification (`tsc: command not found`).
- **Issue:** The worktree had no `node_modules` (gitignored, not carried into the worktree), so `npm run typecheck`/`vitest` could not run.
- **Fix:** Ran `npm ci` to restore already-vetted, lockfile-pinned dependencies. This is a restore of declared deps from `package-lock.json`, not the introduction of a new/unknown package.
- **Files modified:** None tracked (`node_modules` is gitignored).

### Out-of-scope addition (within plan intent)
- Re-exported the three new config types from `src/index.ts` so plan 03 receives the contracts via the public barrel (the plan's stated purpose: "plan 03 receives the contracts in-hand"). The new validators (`assertPolicy`/`assertPrefix`) were intentionally left as internal `validate.ts` exports, matching the existing internal-validator convention.

## Acceptance Criteria Note
- Acceptance criterion `grep -c ioredis src/types.ts == 0` measures literal occurrences; the file has 2 occurrences, both in documentation prose asserting the core is ioredis-free. There are zero `import` statements of any kind in `types.ts` (verified via `grep -nE "^\s*import\b"` → no matches), so the substantive criterion ("remains free of any ioredis import") is satisfied.

## Threat Model Coverage
- **T-02-01 (Tampering, RedisStoreConfig):** mitigated — `assertPolicy`/`assertPrefix` added; numeric fields reuse `assertPositiveConfig` (validators ready for plan 03 to wire at construction).
- **T-02-02 (DoS, MemoryStore async migration):** mitigated — no `await` introduced inside any op critical section; concurrency over-admission guard re-run and still admits exactly `limit`.
- **T-02-03 (Info Disclosure, opaque key):** accept — no key parsing/logging added.

## No Known Stubs
No placeholder/empty-data stubs introduced; the config types are type-only contracts consumed by plan 03.

## Self-Check: PASSED
- `02-01-SUMMARY.md` exists.
- Commits `8e83566` (Task 1), `37f6ec1` (Task 2), `0c793e9` (docs) all present in git log.
