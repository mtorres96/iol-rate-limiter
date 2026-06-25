---
phase: 03-express-middleware-http-semantics
plan: 03
subsystem: adapters/express (verification)
tags: [express, supertest, http-semantics, fail-open-closed, build-smoke, verification]
requires:
  - "rate-limiter/express subpath (source: plan 03-02; build wiring: plan 03-01)"
  - "core barrel rate-limiter/src/index.ts (FakeClock, MemoryStore, TokenBucketLimiter)"
provides:
  - "HTTP-01/02/03 supertest proof: admit→429 with IETF + legacy headers on both paths"
  - "HTTP-04 supertest proof: fail-open admits / fail-closed denies via a throwing-stub RateLimiter, no crash"
  - "build-smoke guard that the rate-limiter/express subpath emits non-empty dist artifacts"
  - "build-green gate satisfied at the phase boundary (tsc --noEmit + 117-test vitest suite green)"
affects:
  - "rate-limiter/test/adapters/express/ (new test tier)"
  - "rate-limiter/test/build-smoke.test.ts (extended)"
tech-stack:
  added: []   # express/supertest installed in plan 03-01; this plan added no deps
  patterns:
    - "supertest drives a real express() app in-process — asserts status/headers/body with no bound port"
    - "deterministic capacity:1 TokenBucketLimiter + FakeClock(0) gives a one-admit→429 fixture with no time advance"
    - "throwing-stub RateLimiter ({ consume: () => Promise.reject(...) }) proves the middleware policy without Redis"
    - "suite-level process.on('unhandledRejection') guard proves the catch absorbs every limiter rejection (T-03-06)"
    - "build-smoke it.each over built-artifact paths, reusing one real `npm run build` beforeAll"
key-files:
  created:
    - "rate-limiter/test/adapters/express/middleware.test.ts"
    - "rate-limiter/test/adapters/express/fail-open-closed.test.ts"
  modified:
    - "rate-limiter/test/build-smoke.test.ts"
decisions:
  - "HTTP-04 proven WITHOUT Redis via a throwing-stub RateLimiter (D3-08) — the middleware owns its own fail-open/closed policy, so the error path is testable in-process."
  - "Explicit keyGenerator (() => fixed) in every supertest case (RESEARCH Pitfall 3) so the admit→429 / error path is exercised, never req.ip loopback flakiness."
  - "Empty-key suite issues two requests and asserts the bucket is never drained (no consume() call) + two captured warns — proving D3-03 admit-and-log skips the limiter entirely."
metrics:
  duration_min: 2
  tasks: 3
  files: 3
  tests_added: 10
  suite_total: 117
  completed: "2026-06-25"
---

# Phase 3 Plan 3: Express Adapter Verification (HTTP-01..04 + Build-Green Gate) Summary

The verification wave for the Express middleware: two supertest suites prove all four phase requirements end-to-end against the in-memory store with zero Redis dependency, and an extended build-smoke guards the `rate-limiter/express` subpath emit — all under the mandatory `tsc --noEmit` + full-suite build-green gate (117 tests green).

## What Was Built

**Task 1 — `middleware.test.ts` (HTTP-01/02/03, 5 tests):** A real `express()` app behind `rateLimit({ limiter, keyGenerator: () => "k1" })` over a deterministic `capacity:1` `TokenBucketLimiter` + `FakeClock(0)`. Asserts: first `GET /` → 200 with IETF `RateLimit`/`RateLimit-Policy` (draft-11 List-of-Items form) AND legacy `X-RateLimit-*` (integer `remaining="0"`, delta-seconds `reset` asserted `< 1e6`, never epoch); second `GET /` → 429 with `Retry-After` AND the budget headers still present (D3-04) and a JSON body carrying `error` + numeric `retryAfterMs`; an empty-key app (`keyGenerator: () => ""`) admits both requests without draining the bucket and the `DegradedLogger` stub captures the warn (D3-03); `headers: "legacy"` omits the IETF header but keeps `X-RateLimit-*`; `headers: false` omits all.

**Task 2 — `fail-open-closed.test.ts` (HTTP-04, 5 tests):** A throwing-stub `RateLimiter` (`{ consume: () => Promise.reject(new Error("store down")) }`) drives the middleware's catch/policy branch. Asserts: default (fail-open) and explicit `policy: "fail-open"` → 200 (admitted, no crash); `policy: "fail-closed"` → 429 (denied, no crash); the catch path logs one `warn` via the `DegradedLogger` stub (D3-08); and a suite-level `unhandledRejection` guard confirms NO rejection escaped the middleware across the whole suite (T-03-06).

**Task 3 — extended `build-smoke.test.ts`:** Reusing the same single real `npm run build` in `beforeAll`, added an `it.each` asserting `dist/adapters/express/index.js` and `dist/adapters/express/index.d.ts` exist and are non-empty (the Lua-asset assertions are untouched). This guards plan 03-01's second tsup entry + the `./express` export against a broken/empty subpath emit (T-03-07).

## Build-Green Gate

- `npm run typecheck` (`tsc --noEmit`) — PASS, no errors.
- `npm test` (`vitest run`) — PASS: **15 test files, 117 tests** (10 new across the three files; the build emitted `dist/adapters/express/index.js` 2.17 KB + `index.d.ts` 2.13 KB during the build-smoke `beforeAll`).

## Requirements Closed

| Req | Proven by |
|-----|-----------|
| HTTP-01 | first GET 200 with IETF + legacy budget headers |
| HTTP-02 | second GET 429 with `Retry-After` + JSON body |
| HTTP-03 | budget headers present on BOTH allowed and 429 paths; integer remaining; delta-seconds reset |
| HTTP-04 | throwing-stub limiter: fail-open admits (200), fail-closed denies (429), logged, no unhandled rejection |

## Threat Mitigations Verified

- **T-03-06 (DoS via unhandled rejection):** Task 2's suite-level `unhandledRejection` guard + the 200/429 assertions prove the throwing limiter's rejection is fully absorbed by the policy — the request always gets a response, the process never crashes.
- **T-03-07 (stale/empty subpath ships):** Task 3 runs the real build and asserts the subpath JS + d.ts are non-empty, catching broken second-entry wiring before ship.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria met on the first run; no Rule 1–4 deviations, no auth gates.

## Notes

- The repository root (git + `.planning`) is `/Users/manulocal/Desktop/iol`; the code package lives at `/Users/manulocal/Desktop/iol/rate-limiter`. Test files use the `../../../src/...` relative imports the plan's `<interfaces>` prescribe (the source barrel, not the built package), so the suites run without depending on a prior build.

## Self-Check: PASSED

All three created/modified files exist on disk; all three task commits (7868324, 734d12c, abe7345) are present in git history.
