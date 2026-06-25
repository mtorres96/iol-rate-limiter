---
phase: 04-demo-docker-design-md
plan: 02
subsystem: infra
tags: [docker, docker-compose, node24-alpine, redis, multi-stage, healthcheck, ioredis, express]

# Dependency graph
requires:
  - phase: 04-demo-docker-design-md (plan 01)
    provides: demo server (src/demo/server.ts) + tsup third entry emitting dist/demo/server.js + start script
  - phase: 02 (redis store)
    provides: RedisStore + Lua scripts (the real distributed path exercised under compose)
provides:
  - Multi-stage non-root node:24-alpine Dockerfile building dist/demo/server.js with a Node-fetch HEALTHCHECK
  - .dockerignore for a lean build context
  - Compose v2 file (app + redis:7.4-alpine) with a Redis healthcheck and depends_on condition service_healthy
  - One-command `docker compose up` deployment exercising the real Redis Lua path with Redis off the host
affects: [04-03 README/DESIGN.md quickstart, deployment, future ops]

# Tech tracking
tech-stack:
  added: [Dockerfile (node:24-alpine multi-stage), docker-compose.yml (Compose v2)]
  patterns:
    - "Multi-stage build: build stage runs tsup, runtime stage installs prod deps only and runs as USER node"
    - "HEALTHCHECK via Node global fetch (no curl/wget in Alpine)"
    - "Compose depends_on condition service_healthy gates app start on Redis health; init:true for SIGTERM"
    - "Redis reachable only on the internal compose network (no host port mapping)"

key-files:
  created:
    - rate-limiter/Dockerfile
    - rate-limiter/.dockerignore
    - rate-limiter/docker-compose.yml
  modified:
    - rate-limiter/package.json
    - rate-limiter/package-lock.json
    - rate-limiter/tsup.config.ts
    - rate-limiter/test/build-smoke.test.ts

key-decisions:
  - "Express promoted from dev/peer-only to a runtime dependency: the demo server is a runtime top tier that imports express, so npm ci --omit=dev must install it; the core barrel stays express-free so the tier boundary holds"
  - "tsup copies Lua to dist/lua/ (not dist/store/lua/): the store code is hoisted into a top-level dist/ chunk, so import.meta.url resolves ./lua/ to dist/lua/"
  - "HEALTHCHECK uses Node global fetch against /health; redis healthcheck uses redis-cli ping"
  - "Redis has no host port mapping (internal-only); only the app publishes 3000"

patterns-established:
  - "Container hardening: pinned base images (node:24-alpine, redis:7.4-alpine), non-root USER node, prod-only deps, no :latest"
  - "Compose v2 with no obsolete version key; healthcheck-gated startup ordering"

requirements-completed: [DELIV-02]

# Metrics
duration: 20min
completed: 2026-06-25
---

# Phase 4 Plan 02: One-Command Docker Deployment Summary

**Multi-stage non-root node:24-alpine Dockerfile + Compose v2 (app + redis:7.4-alpine, healthcheck-gated) that boots the demo against the real Redis Lua path with `docker compose up` and zero manual steps.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-25T04:48:00Z
- **Completed:** 2026-06-25T05:07:46Z
- **Tasks:** 2 (plus 2 auto-fix deviations surfaced by an end-to-end compose smoke test)
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- Multi-stage `node:24-alpine` Dockerfile: build stage runs `tsup`, runtime stage installs prod deps only (`npm ci --omit=dev`), copies the whole `dist`, runs as the built-in non-root `node` user, exposes 3000, and HEALTHCHECKs `/health` via Node global `fetch` (no curl/wget). Exec-form CMD runs `dist/demo/server.js`.
- `.dockerignore` excludes `node_modules`, `dist`, `.git`, `test`, `*.md`, `.planning`, etc. for a lean build context.
- Compose v2 `docker-compose.yml`: `redis:7.4-alpine` with a `redis-cli ping` healthcheck and NO host port; `app` builds the Dockerfile, sets `init: true`, injects `REDIS_URL=redis://redis:6379` (the real distributed path) and `PORT=3000`, and waits on `depends_on: redis: { condition: service_healthy }`.
- Proven end-to-end in-environment: `docker compose up --wait` reaches both-healthy; `/health` → 200 (unlimited); `/api/ping` → `200 200 200 200 200 200 429` through the **real Redis Lua path**; the 429 carries `Retry-After`, IETF `RateLimit`/`RateLimit-Policy`, and legacy `X-RateLimit-*` headers. Redis port 6379 is connection-refused from the host. `compose down` completes in ~1s (graceful SIGTERM, no 10s force-kill).

## Task Commits

1. **Task 1: Multi-stage Dockerfile + .dockerignore** - `5c8b30c` (feat)
2. **Task 2: docker-compose.yml (app + redis, healthcheck, depends_on)** - `d104a68` (feat)
3. **Deviation fix: express as runtime dependency** - `d657892` (fix)
4. **Deviation fix: copy Lua to dist/lua so the built Redis path works** - `cadc930` (fix)

## Files Created/Modified

- `rate-limiter/Dockerfile` - Multi-stage node:24-alpine build → non-root runtime running dist/demo/server.js with a Node-fetch HEALTHCHECK
- `rate-limiter/.dockerignore` - Lean build context (excludes node_modules, dist, .git, test, *.md, .planning)
- `rate-limiter/docker-compose.yml` - app + redis:7.4-alpine, Redis healthcheck, depends_on service_healthy, REDIS_URL, init:true, Redis unexposed
- `rate-limiter/package.json` - express promoted to a runtime dependency (removed redundant devDep entry)
- `rate-limiter/package-lock.json` - regenerated so the prod dependency tree includes express (express dev flag false)
- `rate-limiter/tsup.config.ts` - onSuccess copies Lua to dist/lua/ (the path the bundled chunk resolves)
- `rate-limiter/test/build-smoke.test.ts` - asserts Lua at dist/lua/ (the path the runtime actually reads)

## Decisions Made

- **Express as a runtime dependency.** The demo server is a runtime top tier that `import`s express; with express only dev/peer, `npm ci --omit=dev` omitted it and the container crashed. Promoting it to a runtime dependency is correct and does NOT violate the tier boundary — the core barrel `src/index.ts` remains express-free; express stays a `peerDependency` for library consumers.
- **Copy Lua to `dist/lua/`.** tsup hoists the store code into a shared top-level `dist/` chunk, so `new URL('./lua/<algo>.lua', import.meta.url)` resolves to `dist/lua/`, not `dist/store/lua/`. Fixing the copy target (and the build-smoke assertion) is the minimal correct fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Express missing from the runtime image**
- **Found during:** Task 2 (compose smoke test)
- **Issue:** `docker compose up` brought the app container to `exited (1)` with `ERR_MODULE_NOT_FOUND: Cannot find package 'express'`. The demo server imports express at runtime, but express was only a dev/peer dependency, so `npm ci --omit=dev` did not install it. The plan's runtime stage assumed ioredis was the only runtime dep.
- **Fix:** Promoted `express` to `dependencies` in package.json (removed the now-redundant devDependencies entry), regenerated package-lock.json from a clean tree so express is recorded as a non-dev dependency. Verified `npm ci --omit=dev` installs express in an isolated temp dir.
- **Files modified:** rate-limiter/package.json, rate-limiter/package-lock.json
- **Verification:** `npm run typecheck` clean; isolated `npm ci --omit=dev` installs express; container progressed past the import error.
- **Committed in:** `d657892`

**2. [Rule 1 - Bug] Lua scripts copied to the wrong dist path (Pitfall 4)**
- **Found during:** Task 2 (compose smoke test, after fix 1)
- **Issue:** After express resolved, the app crashed with `ENOENT: .../dist/lua/token-bucket.lua`. tsup bundles the store code into a top-level `dist/` chunk, so `new URL('./lua/...', import.meta.url)` resolves to `dist/lua/`, but the plan-01 tsup `onSuccess` copied the `.lua` files to `dist/store/lua/`. The mismatch only surfaces on the real-Redis path inside the built image (local dev defaults to MemoryStore), exactly Pitfall 4 from the research.
- **Fix:** Changed tsup `onSuccess` to copy `src/store/lua` → `dist/lua`, and updated `test/build-smoke.test.ts` to assert the runtime-correct `dist/lua/` path (the test's purpose is to guard the path the runtime reads).
- **Files modified:** rate-limiter/tsup.config.ts, rate-limiter/test/build-smoke.test.ts
- **Verification:** Rebuilt image; `docker compose up --wait` reaches both-healthy; `/api/ping` returns 200×6 then 429 via the real Redis Lua path; build-smoke (6 tests) and redis-integration (4 tests) green; typecheck clean.
- **Committed in:** `cadc930`

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs). Both were pre-existing latent defects in plan 01's wiring that only manifest on the real-Redis path inside the built container — exactly the path this plan's deliverable exists to exercise.
**Impact on plan:** Both fixes were necessary for the plan's core "one-command up against the real Redis path" goal to actually work. No scope creep; no architectural change (Express was already a declared peer dep; the Lua copy target was simply mis-pointed).

## Issues Encountered

- Regenerating package-lock.json so express was recorded as a non-dev dependency required a clean `rm -rf node_modules package-lock.json && npm install` AND removing the duplicate `devDependencies.express` entry — `npm install --package-lock-only` over the existing tree kept the stale `dev: true` flag.

## User Setup Required

None - no external service configuration required. Docker is a documented prerequisite for `docker compose up` and for `npm run verify` (the testcontainers Redis tests), per D4-06; that documentation lands in plan 03's README/DESIGN.md.

## Next Phase Readiness

- `docker compose up` is a real one-command experience verified end-to-end — plan 03 (README/DESIGN.md) can document the quickstart and curl examples against it with confidence.
- The Dockerfile and compose file are the canonical artifacts for the DELIV-06 README quickstart and the DELIV-04 DESIGN.md container-hardening narrative.
- No blockers.

---
*Phase: 04-demo-docker-design-md*
*Completed: 2026-06-25*
