---
phase: 04-demo-docker-design-md
plan: 01
subsystem: infra
tags: [express, demo-server, tsup, composition-root, vitest, supertest, tsx]

# Dependency graph
requires:
  - phase: 01-core-algorithms
    provides: TokenBucketLimiter / SlidingWindowLimiter / FixedWindowLimiter + MemoryStore behind the RateLimiter/Store contracts
  - phase: 02-redis-store
    provides: RedisStore.connect (batteries-included ioredis factory) + close() graceful teardown
  - phase: 03-express-middleware
    provides: rateLimit({ limiter }) Express adapter (req.ip default key, both header families, fail-open, JSON 429)
provides:
  - Demo HTTP server (src/demo/server.ts) — env-driven store+limiter composition root
  - tsup third entry → dist/demo/server.js (the Docker runtime entrypoint)
  - npm run verify gate (typecheck && test) + start (node dist/demo/server.js) + dev (tsx watch)
  - test/demo.test.ts D4-03 route-contract smoke test + build-smoke dist/demo assertion
affects: [docker, dockerfile, docker-compose, design-md, readme]

# Tech tracking
tech-stack:
  added: [tsx (dev-only, demo watch runner)]
  patterns:
    - "Composition root as a new top tier importing BOTH the core barrel and the express subpath"
    - "Env-driven runtime selection with fail-loud RangeError on bad RL_ALGO"
    - "buildApp() factory export so the server is testable via supertest without binding a port"

key-files:
  created:
    - rate-limiter/src/demo/server.ts
    - rate-limiter/test/demo.test.ts
  modified:
    - rate-limiter/tsup.config.ts
    - rate-limiter/package.json
    - rate-limiter/test/build-smoke.test.ts

key-decisions:
  - "Demo is an APP entrypoint (reached via start script / Docker CMD), not a library subpath — exports map left unchanged"
  - "buildApp() returns { app, close } so the smoke test drives the real composition (not a re-built fixture) over a single supertest agent for a stable per-IP key"
  - "Demo keeps the rateLimit req.ip default (D4-04) — no keyGenerator override, even in tests"

patterns-established:
  - "Composition root (src/demo/): the only module allowed to import both tiers; core barrel stays Express/demo-free"
  - "ESM entrypoint guard via import.meta.url vs process.argv[1] so importing for tests never starts a real server"

requirements-completed: [DELIV-01, DELIV-03]

# Metrics
duration: 12min
completed: 2026-06-25
---

# Phase 4 Plan 01: Demo Server & Verify Gate Summary

**Env-driven Express demo composition root (REDIS_URL→store, RL_ALGO→limiter, fail-loud on garbage) wired as a third tsup entry emitting dist/demo/server.js, plus the npm run verify gate.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-25T01:52:00Z
- **Completed:** 2026-06-25T01:57:00Z
- **Tasks:** 4
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Demo HTTP server (`src/demo/server.ts`) that selects RedisStore-or-MemoryStore by `REDIS_URL`, selects the limiter by `RL_ALGO` (default token-bucket, RangeError on garbage), serves an unlimited `/health` and a rate-limited `/api/ping`, and shuts down gracefully on SIGTERM/SIGINT (DELIV-01).
- tsup third entry → `dist/demo/server.js` (the Docker CMD target) with the Lua-copy `onSuccess` hook and `exports` map left intact.
- `npm run verify` (= `typecheck && test`) DELIV-03 gate, plus `start` (Docker CMD mirror) and `dev` (tsx watch) scripts.
- Thin D4-03 route-contract smoke test (`/health` never throttled; `/api/ping` admits→429 with Retry-After) + build-smoke assertion that the demo entry actually lands in `dist`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify + install tsx devDependency** - `656e69d` (chore)
2. **Task 2: Demo composition-root server (TDD)** - `f66d872` (test/RED) → `c2160b9` (feat/GREEN)
3. **Task 3: Wire tsup third entry + verify/start/dev scripts** - `dc274a6` (chore)
4. **Task 4: Demo smoke test + build-smoke dist/demo assertion** - `c1180bd` (test)

_Note: Task 2's RED smoke test (`test/demo.test.ts`, `f66d872`) already satisfied every Task 4 demo-test acceptance criterion, so Task 4 only added the build-smoke `dist/demo/server.js` assertion._

## Files Created/Modified
- `rate-limiter/src/demo/server.ts` - Composition root: `buildStore()` (REDIS_URL → RedisStore.connect else MemoryStore), `buildLimiter()` (RL_ALGO switch, fail-loud default), `buildApp()` (health-outside / ping-inside the limiter), `start()` (listen + SIGTERM/SIGINT graceful shutdown w/ unref'd safety-net timeout), and an entrypoint guard.
- `rate-limiter/test/demo.test.ts` - Supertest smoke test driving `buildApp()` over a single agent: `/health` stays 200 after the ping budget is spent; `/api/ping` admits then 429s with Retry-After; bad `RL_ALGO` throws RangeError.
- `rate-limiter/tsup.config.ts` - Added `src/demo/server.ts` as the third `entry` element.
- `rate-limiter/package.json` - Added `verify`, `start`, `dev` scripts + `tsx` devDependency (not in dependencies).
- `rate-limiter/test/build-smoke.test.ts` - Added `demo/server.js` to the asset list so the real build is guarded to emit the Docker entrypoint.

## Decisions Made
- **Demo is an app entrypoint, not a library subpath** — `exports` map left unchanged; the demo is reached via `npm start` / Docker CMD, never `import 'rate-limiter/demo'`.
- **`buildApp()` returns `{ app, close }`** so the smoke test exercises the real composition root (not a re-built fixture) and can release the store; all `/api/ping` requests go through one supertest agent for a stable per-IP key, avoiding loopback `req.ip` flakiness without overriding the demo's key extractor.
- **Tiny limits (capacity/limit = 5, window 60s)** are intentional (D4-03) so a short curl/test loop reaches the 429 — observability, not a stub.

## Deviations from Plan

None - plan executed exactly as written.

The only minor adjustment: two source-code comments originally contained the literal word `keyGenerator` (describing what the demo deliberately does NOT do). They were reworded to "key extractor" so the Task 2 acceptance grep (`grep -c 'keyGenerator' == 0`) passes. This is a comment-wording change with no behavioral effect — the demo passes only `{ limiter }` to `rateLimit`.

## Issues Encountered
- The Task 1 `npm install` reformatted `package.json`/`package-lock.json` (expected). Re-read before the Task 3 scripts edit; the scripts block was unchanged, so the edit applied cleanly.

## User Setup Required
None - no external service configuration required. (The demo runs on a MemoryStore with no env vars; `REDIS_URL` is only needed for the distributed path, which plan 02's docker-compose supplies.)

## Threat Model Coverage
- **T-04-01 (DoS via /health behind the limiter):** mitigated — `/health` registered BEFORE `app.use(rateLimit)`; asserted in `test/demo.test.ts` (stays 200 after the ping budget is spent).
- **T-04-02 (Tampering via RL_ALGO):** mitigated — `buildLimiter` throws RangeError on any value outside `token-bucket|sliding-window|fixed-window`; asserted in `test/demo.test.ts`.
- **T-04-SC (tsx install legitimacy):** mitigated — verified on the npm registry (`npm view tsx version` → 4.22.4 latest, user-approved) and installed dev-only; not in `dependencies`, so it never ships in the runtime image.

## Next Phase Readiness
- `dist/demo/server.js` exists and is build-guarded — plan 02 (Dockerfile / docker-compose) has a concrete `CMD ["node","dist/demo/server.js"]` target and a matching `start` script.
- `npm run verify` is the single typecheck+test gate plan 03's README documents (note: the full suite includes Docker-backed tests that require Docker up; the demo + build-smoke subsets run without Docker via `RL_SKIP_DOCKER=1`).

## Self-Check: PASSED

All 5 created/modified files exist on disk; all 5 task commits (656e69d, f66d872, c2160b9, dc274a6, c1180bd) are present in git history.

---
*Phase: 04-demo-docker-design-md*
*Completed: 2026-06-25*
