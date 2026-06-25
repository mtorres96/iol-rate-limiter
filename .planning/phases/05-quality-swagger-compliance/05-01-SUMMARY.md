---
phase: 05-quality-swagger-compliance
plan: 01
subsystem: quality-coverage-gate
tags: [coverage, vitest, eslint, testing, quality-gate]
requires:
  - "Phase 01-04 source (limiters, RedisStore, Express adapter, demo server)"
provides:
  - "Hard four-metric (lines/statements/functions/branches >= 95) coverage gate"
  - "npm run verify wired to coverage (typecheck && vitest run --coverage)"
  - "Clean eslint . (exit 0) — AF-1/AF-2 resolved + generated-output ignores"
affects:
  - "rate-limiter/vitest.config.ts"
  - "rate-limiter/package.json"
  - "rate-limiter/eslint.config.js"
tech-stack:
  added: []
  patterns:
    - "No-Docker construction tests for defensive throw arms (lazyConnect ioredis)"
    - "Justified /* v8 ignore … @preserve */ for a provably-unreachable else-branch"
    - "ESLint flat-config ignores for gitignored generated output (coverage/, dist/)"
key-files:
  created:
    - "rate-limiter/test/validate.test.ts"
    - "rate-limiter/test/redis-connect.test.ts"
  modified:
    - "rate-limiter/src/store/memory.ts"
    - "rate-limiter/test/adapters/express/middleware.test.ts"
    - "rate-limiter/src/demo/server.ts"
    - "rate-limiter/eslint.config.js"
    - "rate-limiter/vitest.config.ts"
    - "rate-limiter/package.json"
decisions:
  - "memory.ts:167 prev===0 else-branch is UNREACHABLE on the reject path → justified @preserve pragma (not a test)"
  - "AF-1 fixed by dropping the unused trailing handler param (config does not ignore bare `_`)"
  - "Added eslint ignores for coverage/ and dist/ (Rule 3: required for `eslint .` exit 0; flat config ignores .gitignore)"
metrics:
  duration: "~5 min"
  completed: "2026-06-25T19:05:06Z"
  tasks: 3
  files: 8
---

# Phase 05 Plan 01: Coverage Gate + Lint Fixes Summary

Closed every reachable uncovered defensive branch with focused no-Docker tests, fixed the two confirmed lint findings, and enabled a hard four-metric (>= 95%) Vitest coverage gate wired into `npm run verify` — in dependency order so the threshold gate was never enabled before the branches it gates were covered.

## What Was Built

- **validate.ts throw arms covered** (`test/validate.test.ts`): `assertPositiveConfig` (via `TokenBucketLimiter` capacity:0), `assertPolicy` and `assertPrefix` (via `RedisStore.connect` with bad policy / empty keyPrefix). All `toThrow(RangeError)`, no Docker (`lazyConnect:true`). `assertCost` deliberately not re-tested (already in `cost-validation.test.ts`).
- **RedisStore.connect() both branches covered** (`test/redis-connect.test.ts`): with a `redis://` URL and with no argument (default options). Each `instanceof RedisStore` then `await store.close()` to release the lazily-built client.
- **headers.ts ietf-only + windowSeconds ternary covered** (`middleware.test.ts`): an `headers: 'ietf'` supertest case (asserts `RateLimit` present, `X-RateLimit-*` absent) and a `windowSeconds: 60` case asserting `RateLimit-Policy: default;q=1;w=60`.
- **middleware.ts TypeError arm covered**: `expect(() => rateLimit({} as never)).toThrow(TypeError)`.
- **Four-metric coverage gate live** (`vitest.config.ts`): `thresholds` lines/statements/functions/branches = 95; `exclude` of `src/demo/**`, `src/index.ts`, `src/adapters/express/index.ts`, `src/store/lua/**`.
- **verify wired to coverage** (`package.json`): `verify` = `npm run typecheck && vitest run --coverage`.

## Final Coverage Numbers (D-01 scope)

| Metric | Result | Threshold |
|--------|--------|-----------|
| Statements | 100% (216/216) | >= 95 |
| Branches | 98.4% (123/125) | >= 95 |
| Functions | 100% (42/42) | >= 95 |
| Lines | 100% (206/206) | >= 95 |

`npm run verify` exits 0. No `.lua` PARSE_ERROR appears in the coverage output (confirmed: 0 matches). The only sub-100% branch metric is `redis.ts` (90.9%, lines 173/233) — the `close()` `clearTimeout` guard and a degraded-log branch — both well within the >= 95 global gate and not in this plan's enumerated scope.

## memory.ts:167 Disposition

**Justified `/* v8 ignore … @preserve */` pragma** (NOT a covering test). The `prev > 0 ? cfg.windowMs / prev : msToBoundary` else-branch (`prev === 0` fallback) is **provably unreachable on the reject path**: that final `else` runs only when `curr + cost <= cfg.limit` (the `else if (curr + cost > cfg.limit)` above is false); with `prev === 0`, `flooredEstimate === curr`, so `curr + cost <= limit` makes the request an ADMIT (`allowed === 1`) — and the retryAfter arithmetic only runs when `allowed === 0`. Therefore the reject path can never observe `prev === 0`. The branch is kept as a defensive guard for Lua-parity arithmetic and excluded from coverage with the mandatory `@preserve` marker (esbuild strips unmarked comments). This is the only ignore-pragma in the phase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] AF-1 fix: dropped the unused trailing handler param instead of renaming to `_`**
- **Found during:** Task 2
- **Issue:** The plan prescribed renaming `_d` → `_`, but the repo's `typescript-eslint` recommended config does not set `argsIgnorePattern`, so a bare `_` trailing arg still triggers `no-unused-vars` (rule default `args: 'after-used'` checks args after the last used one).
- **Fix:** Dropped the unused third parameter entirely (`handler: (_req, res) => …`) — valid in TS, and `eslint .` exits 0.
- **Files modified:** `rate-limiter/test/adapters/express/middleware.test.ts`
- **Commit:** 66a842a

**2. [Rule 3 - Blocking] Added eslint ignores for generated coverage/ and dist/ output**
- **Found during:** Task 2
- **Issue:** `npx eslint .` flagged `coverage/block-navigation.js` (an "Unused eslint-disable directive" warning) — Task 2's acceptance criteria require `eslint .` to exit 0. ESLint flat config does NOT read `.gitignore`, so gitignored generated output is still linted.
- **Fix:** Added `{ ignores: ['coverage/**', 'dist/**'] }` to `eslint.config.js`.
- **Files modified:** `rate-limiter/eslint.config.js`
- **Commit:** 66a842a

## Self-Check: PASSED

- rate-limiter/test/validate.test.ts — FOUND
- rate-limiter/test/redis-connect.test.ts — FOUND
- Commit 72f246c (Task 1) — FOUND
- Commit 66a842a (Task 2) — FOUND
- Commit 9260399 (Task 3) — FOUND
