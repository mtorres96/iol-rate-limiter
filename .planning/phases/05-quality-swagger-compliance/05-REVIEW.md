---
phase: 05-quality-swagger-compliance
reviewed: 2026-06-25T18:45:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - rate-limiter/src/demo/openapi.ts
  - rate-limiter/src/demo/server.ts
  - rate-limiter/src/store/memory.ts
  - rate-limiter/vitest.config.ts
  - rate-limiter/package.json
  - rate-limiter/eslint.config.js
  - rate-limiter/test/validate.test.ts
  - rate-limiter/test/redis-connect.test.ts
  - rate-limiter/test/docs.test.ts
  - rate-limiter/test/adapters/express/middleware.test.ts
  - rate-limiter/COMPLIANCE.md
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: clean
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-25T18:45:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** clean

## Summary

Reviewed the phase-05 changes for the IOL Rate Limiter: the hand-written OpenAPI spec
(`openapi.ts`), the demo server's new `/docs` + `/openapi.json` mounts, the
`memory.ts:167` coverage pragma, the four-metric coverage gate (`vitest.config.ts`),
the `verify` script and lint config, and the four new/extended coverage test files.

No Critical or Warning findings. The four named focus areas all hold up under
adversarial inspection:

1. **`memory.ts:167` unreachability is SOUND.** The `prev === 0` fallback in the
   sliding-window reject path is provably dead. I traced it: the final `else`
   (memory.ts:162) runs only when `allowed === 0` **and** `curr + cost <= limit`.
   When `prev === 0`, `estimate = curr + 0*overlapFraction = curr`, and since `curr`
   is always a non-negative integer count, `flooredEstimate === curr`. The admit
   decision (memory.ts:141) was therefore `curr + cost <= limit ? 1 : 0` — but we are
   on the branch where `curr + cost <= limit` is true, which forces `allowed === 1`,
   contradicting `allowed === 0`. So `prev === 0` can never be observed here.
   `cost` is guaranteed a positive integer by `assertCost` (validate.ts:33-37) at the
   limiter boundary, so the integer-arithmetic premise holds. The `/* v8 ignore next
   ... @preserve */` pragma is correctly placed (it precedes the exact `prev > 0 ? ...
   : msToBoundary` line) and correctly scoped to one line.

2. **`/docs` and `/openapi.json` ARE registered outside the rate limiter.** Both are
   mounted at server.ts:113-116, strictly *before* `app.use(rateLimit({ limiter }))`
   at server.ts:120. `/health` (server.ts:106) is likewise pre-limiter. Confirmed
   end-to-end: `docs.test.ts` drives the composed app and gets `/docs/` → 200 and
   `/openapi.json` → 200 with no 429.

3. **The coverage exclude/threshold list meaningfully gates the real algorithm code.**
   The `exclude` (vitest.config.ts:29-34) covers only `src/demo/**`, `src/index.ts`,
   `src/adapters/express/index.ts`, and `src/store/lua/**`. I verified `src/index.ts`
   and `src/adapters/express/index.ts` are pure re-export barrels (zero logic lines),
   and the `.lua` files are Redis-side scripts v8 cannot instrument. None of the
   graded algorithm surface (`store/memory.ts`, `store/redis.ts`, the breaker, the
   limiters, `adapters/express/headers.ts`/`middleware.ts`, `validate.ts`) is excluded.
   The hard four-metric ≥95 gate applies to all of it. The gate is real, not hollowed.

4. **No test asserts nothing or passes vacuously.** I ran the four in-scope test
   files (no Docker): 16/16 pass. `validate.test.ts` exercises the three real
   `RangeError` throw arms via real call sites; `redis-connect.test.ts` covers both
   `connect()` branches (redis.ts:128) with `lazyConnect` and releases each client;
   `middleware.test.ts` asserts concrete status/header/body values; `docs.test.ts`
   asserts `200` + spec structure + the 429 header documentation. One assertion in
   `docs.test.ts` is weaker than ideal (see IN-01) but is not vacuous.

`npm run typecheck` and `npm run lint` both exit 0. Doc claims in COMPLIANCE.md /
README / DESIGN (verify formula, ≥95 gate, exclude rationale) match the actual config.

All reviewed files meet quality standards. The Info items below are advisory only.

## Info

### IN-01: `docs.test.ts` 429-header assertion is weaker than the spec it guards

**File:** `rate-limiter/test/docs.test.ts:62-65`
**Issue:** The header check uses an `||` and a `?? {}` fallback:
```ts
const headerNames = Object.keys(ping429?.headers ?? {});
expect(
  headerNames.includes("Retry-After") || headerNames.includes("RateLimit-Policy"),
).toBe(true);
```
The preceding `expect(ping429?.headers).toBeDefined()` (line 61) prevents a fully
vacuous pass, but the `||` means the test still passes if `openapi.ts` ever drops
*one* of the two documented headers — exactly the kind of drift the test exists to
catch (the spec documents `RateLimit-Policy`, `RateLimit`, `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on the 429 path).
**Fix:** Assert the full documented set so a dropped header fails the test:
```ts
const headerNames = Object.keys(ping429?.headers ?? {});
for (const h of [
  "RateLimit-Policy", "RateLimit", "X-RateLimit-Limit",
  "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After",
]) {
  expect(headerNames).toContain(h);
}
```

### IN-02: `swaggerUi.setup()` relies on shared module state across `buildApp()` calls

**File:** `rate-limiter/src/demo/server.ts:116`
**Issue:** `swagger-ui-express` stores the spec on a shared module-level variable that
`swaggerUi.serve` reads at request time. When multiple apps are built in the same
process (as the test suite does — `docs.test.ts` builds a fresh app per `it`), a
later `setup(spec)` can win for earlier-mounted UIs. Here it is benign because every
`buildApp()` passes the identical `openapiSpec` object, so there is no functional bug
in the demo or tests. Flagged so a future change (e.g. per-instance specs, or serving
two different docs in one process) does not silently cross-wire.
**Fix:** No change required now. If multiple distinct specs are ever served in one
process, pass `{ explorer: true }`-style per-instance options via
`swaggerUi.setup(spec, options)` and verify isolation, or serve the raw
`/openapi.json` only and drop the bundled UI.

### IN-03: `openapi.json` 429 example `retryAfterMs: 60000` is illustrative, not derived

**File:** `rate-limiter/src/demo/openapi.ts:144`
**Issue:** The 429 example body `{ error: "Too Many Requests", retryAfterMs: 60000 }`
hardcodes a 60000 ms value. The demo's actual window is `WINDOW_MS = 60_000`
(server.ts:50), so this happens to be representative for the window algorithms, but
under `token-bucket` (the default `RL_ALGO`) the runtime `retryAfterMs` is computed
from the deficit and will usually differ. This is documentation, not behavior — no
correctness impact — but a grader interacting with `/docs` under the default algorithm
will see a different number than the example.
**Fix:** Optionally soften the description to note the value is illustrative and the
real value depends on the configured algorithm/limit, or drop the concrete example
number. Cosmetic only.

---

_Reviewed: 2026-06-25T18:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
