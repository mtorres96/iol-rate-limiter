---
phase: 05-quality-swagger-compliance
plan: 02
subsystem: api
tags: [openapi, swagger-ui-express, express, supertest, docs]

# Dependency graph
requires:
  - phase: 03-express-middleware-http-semantics
    provides: rateLimit middleware + RateLimit/X-RateLimit-* + 429/Retry-After header contract
  - phase: 05-quality-swagger-compliance (plan 01)
    provides: four-metric coverage gate wired into `npm run verify`
provides:
  - Hand-written typed OpenAPI 3 spec (src/demo/openapi.ts) documenting /health and /api/ping incl. 429 + rate-limit headers
  - Swagger UI at /docs and raw spec at /openapi.json on the demo server (unlimited zone)
  - supertest (test/docs.test.ts) keeping the docs surface inside the green coverage gate
affects: [docker-smoke, design-doc, deliverable-compliance]

# Tech tracking
tech-stack:
  added: [swagger-ui-express ^5.0.1 (runtime dep), "@types/swagger-ui-express ^4.1.8 (dev)", openapi-types ^12.1.3 (dev, types-only)]
  patterns: ["Hand-authored typed OpenAPIV3.Document (compile-time structural validation, no codegen)", "Docs routes registered in the unlimited zone before app.use(rateLimit())"]

key-files:
  created: [rate-limiter/src/demo/openapi.ts, rate-limiter/test/docs.test.ts]
  modified: [rate-limiter/package.json, rate-limiter/src/demo/server.ts]

key-decisions:
  - "OpenAPI source = hand-written typed TS object (OpenAPIV3.Document from openapi-types) not YAML/codegen — zero runtime weight, tsc enforces structural validity (D-06)"
  - "swagger-ui-express in dependencies (Docker npm ci --omit=dev), types + openapi-types in devDependencies"
  - "/docs + /openapi.json registered BEFORE the rateLimit mount so Swagger UI static assets are never throttled (D-07)"

patterns-established:
  - "Pattern: demo-tier docs artifact (openapi.ts) excluded from core/adapters import graph — same tier boundary as server.ts"
  - "Pattern: docs supertest does light structural assertions (no schema-validator dep) per D-08"

requirements-completed: [D-05, D-06, D-07, D-08, HTTP-02, HTTP-03, DELIV-06]

# Metrics
duration: 12min
completed: 2026-06-25
---

# Phase 5 Plan 02: Swagger / OpenAPI Demo Docs Summary

**Hand-written typed OpenAPI 3 spec served via Swagger UI at /docs (and raw at /openapi.json) on the demo server, documenting the /health and /api/ping endpoints including the 429 + RateLimit-* / Retry-After headers, with a supertest inside the green coverage gate.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-25
- **Tasks:** 3 (1 checkpoint-gated install + 2 auto)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- swagger-ui-express added as a runtime dependency (Docker-safe under `npm ci --omit=dev`); types as devDependencies; registry-verified (v5.0.1, no postinstall) at the blocking checkpoint.
- Authored `src/demo/openapi.ts` — a typed `OpenAPIV3.Document` documenting `/health` (200) and `/api/ping` (200 + 429), with the 200 and 429 paths both carrying `RateLimit-Policy`, `RateLimit`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and the 429 adding `Retry-After`.
- Mounted `/docs` (Swagger UI) and `/openapi.json` in the demo server's unlimited zone, before `app.use(rateLimit(...))`, so the UI's many static-asset requests are never throttled.
- Added `test/docs.test.ts`: `GET /docs/` 200, `/openapi.json` structural validity (openapi `^3.`, both paths present, `/api/ping` 429), and a structural assertion that the served spec documents the rate-limit headers on the 429 response.

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify + install swagger-ui-express** - `b5f298b` (chore) — checkpoint was pre-approved by the user; this agent ran the install and confirmed dep placement
2. **Task 2: Author hand-written OpenAPI 3 spec** - `41ed8b5` (feat)
3. **Task 3: Mount /docs + /openapi.json and test the surface** - `c41b7ee` (feat)

**Plan metadata:** committed separately (docs: complete plan)

## Files Created/Modified
- `rate-limiter/src/demo/openapi.ts` (created) - Typed hand-written `OpenAPIV3.Document` for the two demo endpoints; demo-tier only (not imported by core/adapters).
- `rate-limiter/test/docs.test.ts` (created) - supertest for `/docs` 200 + `/openapi.json` structural validity incl. the 429 rate-limit-header documentation check.
- `rate-limiter/package.json` (modified) - swagger-ui-express in dependencies; @types/swagger-ui-express + openapi-types in devDependencies.
- `rate-limiter/src/demo/server.ts` (modified) - imports + `/openapi.json` and `/docs` mounts in the unlimited zone.

## Decisions Made
- **OpenAPI source format:** hand-written typed TS object (`OpenAPIV3.Document` from `openapi-types`) over YAML or a decorator/codegen toolchain. Rationale: `openapi-types` is types-only (zero runtime weight, nothing ships to Docker), `tsc` gives compile-time structural validation, and it satisfies D-06's "no codegen" intent while keeping every line hand-authored and interview-defensible.
- **Exact header set documented:** `RateLimit-Policy`, `RateLimit`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on both 200 and 429; plus `Retry-After` on the 429 only — copied verbatim from `src/adapters/express/headers.ts` L53-62 and `middleware.ts`.
- **swagger-ui-express placement:** `dependencies` (not devDependencies) so `/docs` works under `npm ci --omit=dev` in the Docker image; types/openapi-types in `devDependencies`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Strict-undefined narrowing in docs.test.ts**
- **Found during:** Task 3 (docs test)
- **Issue:** `npm run typecheck` failed (TS2532/TS18048) because the supertest `res.body` cast indexed into possibly-undefined nested response/path objects under strict mode.
- **Fix:** Tightened the local cast types (`DocResponse`/`DocOperation` with optional members) and used optional chaining (`?.`) on the `/api/ping` → `get` → `responses["429"]` access path. Test still asserts the same behavior; tests passed before and after the fix.
- **Files modified:** rate-limiter/test/docs.test.ts
- **Verification:** `npm run typecheck` exits 0; `npx vitest run test/docs.test.ts` 2/2 pass.
- **Committed in:** `c41b7ee` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep the type-gate green (project mandates tsc passes at every milestone). No scope creep.

## Issues Encountered
None beyond the strict-undefined fix above. The full coverage gate (`npm run verify`) stayed green: 132 tests pass, 100% statements/functions/lines, 98.4% branches — demo-tier additions (openapi.ts, server.ts) are excluded from the coverage gate by D-01.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03 (Docker smoke / DESIGN.md) can now confirm `docker compose up` reaches `/docs` 200 under `npm ci --omit=dev`, and should note in DESIGN.md that the docs surface is demo-scoped (T-05-04 accepted).
- No blockers.

## Self-Check: PASSED

---
*Phase: 05-quality-swagger-compliance*
*Completed: 2026-06-25*
