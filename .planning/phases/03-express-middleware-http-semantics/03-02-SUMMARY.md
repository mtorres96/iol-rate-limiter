---
phase: 03-express-middleware-http-semantics
plan: 02
subsystem: express-adapter
tags: [express, middleware, http-headers, rate-limit, fail-open, ietf-draft-11]
requires:
  - "rate-limiter/src/types.ts (RateLimiter, Decision, RateLimitPolicy, DegradedLogger)"
  - "rate-limiter/src/validate.ts (assertPolicy)"
  - "03-01 (express peerDependency + rate-limiter/express subpath wiring)"
provides:
  - "rateLimit(options) => RequestHandler — the Express middleware factory"
  - "RateLimitOptions — the public adapter options interface"
  - "setRateLimitHeaders + toSeconds — pure Decision->HTTP-header transform"
  - "rate-limiter/express subpath public surface"
affects:
  - "03-03 (build-smoke + supertest tests target this surface)"
tech-stack:
  added: []
  patterns:
    - "Tier-boundary file: Express imported ONLY under src/adapters/express/** (symmetric to redis.ts/ioredis)"
    - "Factory-time validation (TypeError on missing limiter, assertPolicy/RangeError on bad policy)"
    - "Middleware-owned try/catch that never rethrows — fail-open/closed at the HTTP edge (mirrors redis.ts degraded())"
    - "Single ms->delta-seconds edge helper (Math.ceil), no epoch"
    - "OpTuple/Decision straight-through mapping convention reused for Decision->headers"
key-files:
  created:
    - "rate-limiter/src/adapters/express/headers.ts"
    - "rate-limiter/src/adapters/express/middleware.ts"
    - "rate-limiter/src/adapters/express/index.ts"
  modified: []
decisions:
  - "headers.ts is the SINGLE place ms->delta-seconds conversion happens (toSeconds = Math.ceil(ms/1000)); Retry-After is set in middleware.ts (429-only path), not headers.ts"
  - "Emit BOTH IETF draft-11 List-of-Items form and legacy X-RateLimit-* by default; headers mode (both|ietf|legacy|false) selects"
  - "Default policy fail-open mirrors the RedisStore default (D2-04 -> D3-07); empty key admits AND logs (D3-03)"
  - "No new policy/logger type — reuse core RateLimitPolicy + DegradedLogger"
metrics:
  duration_min: 2
  tasks_completed: 3
  files_touched: 3
  completed: 2026-06-25
---

# Phase 3 Plan 2: Express Adapter Source Summary

Authored the entire HTTP-semantics surface of the phase: a pure `Decision -> HTTP-header`
transform, the `rateLimit(options) => RequestHandler` factory with `req.ip` key extraction,
IETF draft-11 + legacy header emission, a 429 + `Retry-After` sender, and a middleware-owned
fail-open/closed `try/catch` that never leaks to Express's error handler — confined to the
`src/adapters/express/**` tier so the core stays Express-free.

## What Was Built

### Task 1 — `headers.ts` (pure transform)
`setRateLimitHeaders(res, d, opts)` maps a `Decision` straight to two header families:
- **IETF draft-11 List-of-Items**: `RateLimit-Policy: "default";q=<limit>[;w=<windowSeconds>]`
  and `RateLimit: "default";r=<remaining>;t=<ceil(resetMs/1000)>`.
- **Legacy**: `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` (delta-seconds).

A single exported `toSeconds = (ms) => Math.ceil(ms / 1000)` edge helper is the ONLY place
ms is converted to HTTP delta-seconds (D-09 / D3-05) — no `Date.now()` / epoch anywhere.
`headers` mode (`both` default | `ietf` | `legacy` | `false`) selects the family; `false`
early-returns. `limit`/`remaining` are emitted as-is (already floored, D3-06). `Retry-After`
is intentionally NOT set here.

### Task 2 — `middleware.ts` (factory + policy + 429 sender)
`rateLimit(options)` validates `limiter` presence (`TypeError`) and the resolved `policy`
(`assertPolicy` -> `RangeError`) at factory-call time, then returns an `async (req, res, next)`
handler that:
- extracts `key = (keyGenerator ?? req.ip)(req)`; empty/absent key -> `logger?.warn` + `next()` (D3-03);
- wraps `await limiter.consume(key)` in a `try/catch`: on rejection -> `logger?.warn`, then
  `fail-open` -> `next()` / `fail-closed` -> bare `429` JSON. Never rethrows (HTTP-04 / D3-09);
- on success sets headers BEFORE the body (Pitfall 5); `allowed` -> `next()`, else `sendThrottled`
  sets `Retry-After: ceil(retryAfterMs/1000)` and sends the default JSON body
  `{ error, retryAfterMs }` or invokes the `handler` override.

Reuses the core `RateLimiter`/`Decision`/`RateLimitPolicy`/`DegradedLogger` — defines no new
policy or logger type.

### Task 3 — `index.ts` (adapter barrel)
Re-exports `{ rateLimit }` (value) and `RateLimitOptions` (type) — the `rate-limiter/express`
subpath public surface. The core barrel `src/index.ts` was untouched and stays Express-free.

## Requirements Satisfied

- **HTTP-01**: per-key enforcement via `keyGenerator ?? req.ip` feeding `limiter.consume(key)`.
- **HTTP-02**: over-limit -> `429` + `Retry-After` (delta-seconds) + JSON body.
- **HTTP-03**: IETF draft-11 + legacy headers on allowed AND rejected paths; integer `remaining`;
  consistent delta-seconds reset unit (single `toSeconds` helper).
- **HTTP-04**: `consume()` rejection handled by the middleware-owned fail-open/closed policy; no crash.

## Verification

- `npx tsc --noEmit` passes with all three files present.
- All per-task grep gates pass (draft-11 `"default";q=`/`"default";r=`/`;t=`; no `Date.now`;
  no draft-07 `limit=`; `assertPolicy`/`limiter.consume`/`setRateLimitHeaders`/`Retry-After`
  present; barrel exports `rateLimit`+`RateLimitOptions`).
- `grep -rL express src/index.ts src/types.ts` confirms the core barrel and types stay Express-free.
- `eslint src/adapters/express/` clean; `prettier --write` applied (single-quote house style).
- No tests run here — the adapter build + supertest harness are deferred to plan 03-03 per the
  plan objective.

## Threat Surface

The plan's threat register (T-03-02..T-03-05) is satisfied by construction:
- **T-03-02 (spoofing)**: middleware never parses `X-Forwarded-For`; relies on Express `trust proxy`
  to populate `req.ip`. No XFF parsing code exists.
- **T-03-03 (forged/empty key)**: empty key admits AND logs; key is opaque, never interpolated.
- **T-03-04 (DoS via unhandled rejection)**: `try/catch` never rethrows; resolves through policy.
- **T-03-05 (header injection)**: header values derive only from numeric `Decision` fields and the
  fixed `"default"` policy name; no user-controlled string is interpolated.

No new security-relevant surface beyond the threat model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded doc comments to satisfy negative grep gates**
- **Found during:** Task 1 verification.
- **Issue:** The acceptance gates `! grep -q 'Date.now'` and `! grep -q 'limit='` over the whole
  `headers.ts` file tripped on documentation comments that *mentioned* `Date.now()` and the
  draft-07 `limit=` form (to explain what the code deliberately avoids), not on actual code.
- **Fix:** Reworded those comments ("no wall-clock read", "dictionary `key=value` form") so the
  literal strings no longer appear; emitted header syntax and behavior are unchanged.
- **Files modified:** rate-limiter/src/adapters/express/headers.ts
- **Commit:** 57b0846

### Note on `tdd="true"` tasks

Tasks 1 and 2 carry `tdd="true"`, but this plan's artifacts and `<verify>` blocks are
source-only (`npx tsc --noEmit` + grep) and the objective explicitly states "Tested in plan
03-03." The phase deferred the adapter build AND the supertest/behavior tests to plan 03-03;
no test files are part of this plan's deliverables. Source authored here; RED/GREEN behavior
tests land in 03-03.

## Commits

- 57b0846: feat(03-02): add pure Decision->HTTP-header mapping (headers.ts)
- 87f5e30: feat(03-02): add rateLimit factory + fail-open/closed middleware
- 78b7fce: feat(03-02): add Express adapter barrel (rate-limiter/express subpath)

## Self-Check: PASSED
- FOUND: rate-limiter/src/adapters/express/headers.ts
- FOUND: rate-limiter/src/adapters/express/middleware.ts
- FOUND: rate-limiter/src/adapters/express/index.ts
- FOUND: commit 57b0846
- FOUND: commit 87f5e30
- FOUND: commit 78b7fce
