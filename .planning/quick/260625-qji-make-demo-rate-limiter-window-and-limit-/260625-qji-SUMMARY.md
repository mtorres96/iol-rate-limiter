---
phase: quick-260625-qji
plan: 01
subsystem: demo
tags: [config, env, docker, demo]
requires: []
provides: [env-driven demo limit/window/refill config]
affects: [rate-limiter/src/demo/server.ts, rate-limiter/docker-compose.yml, rate-limiter/README.md]
tech-stack:
  added: []
  patterns: [env-driven config with fail-loud parsing helper]
key-files:
  created: []
  modified:
    - rate-limiter/src/demo/server.ts
    - rate-limiter/docker-compose.yml
    - rate-limiter/README.md
decisions:
  - "envInt is a local composition-root helper, not an exported core type — server.ts stays composition-only"
  - "No range/positivity check in envInt; lean on core limiters' construct-time RangeError (validate.ts)"
  - "RL_REFILL defaults to RL_LIMIT to preserve current token-bucket behavior"
metrics:
  duration: 2 min
  completed: 2026-06-25
---

# Quick Task 260625-qji: Make demo rate-limiter window and limit configurable — Summary

Made the demo limiter's limit, window, and token-bucket refill tunable via `RL_LIMIT` /
`RL_WINDOW_MS` / `RL_REFILL` env vars (mirroring the existing `RL_ALGO`/`PORT`/`REDIS_URL`
pattern), with a fail-loud `envInt` parsing helper, plus docker-compose knobs and README docs.

## What Was Built

- **server.ts:** Renamed `TINY_LIMIT`/`WINDOW_MS` → `DEFAULT_LIMIT`/`DEFAULT_WINDOW_MS` (now
  fallback defaults). Added local `envInt(name, fallback)` helper: unset/empty env → fallback;
  present-but-non-finite → throws an `Error` naming the var + bad value (fail loud at startup,
  matching the `RL_ALGO` convention). No range-check — the core limiters already throw
  `RangeError` on non-positive/NaN/non-finite config. `buildLimiter` now reads
  `RL_LIMIT`/`RL_WINDOW_MS`/`RL_REFILL` (refill defaults to limit) and feeds each algorithm's
  config shape.
- **docker-compose.yml:** Added `RL_LIMIT: "5"`, `RL_WINDOW_MS: "60000"`, `RL_REFILL: "5"` to the
  `app` service `environment:` block with inline tunable comments.
- **README.md:** Added three Configuration-table rows with per-algorithm meaning, a `docker run`
  override example, and a note that the same vars live in compose. Updated the fail-loud note to
  mention non-numeric limit/window/refill.

## Verification

- `npm run verify` exits **0** — `tsc --noEmit` clean, **132 tests pass** (incl. `test/demo.test.ts`
  whose 5-request budget assertion still holds because defaults are unchanged), coverage
  100% stmts / 98.4% branch / 100% funcs / 100% lines (gate not lowered; `src/demo/**` excluded
  from coverage), `eslint .` clean.
- `grep RL_LIMIT` finds the var in `server.ts`, `docker-compose.yml`, and `README.md`.

## Deviations from Plan

None - plan executed exactly as written.

## Commits

- `a308416` feat(quick-260625-qji): env-driven RL_LIMIT/RL_WINDOW_MS/RL_REFILL in demo
- `d48bb9c` docs(quick-260625-qji): surface RL_LIMIT/RL_WINDOW_MS/RL_REFILL in compose + README

## Self-Check: PASSED

- FOUND: rate-limiter/src/demo/server.ts (modified, contains RL_LIMIT)
- FOUND: rate-limiter/docker-compose.yml (modified, contains RL_LIMIT)
- FOUND: rate-limiter/README.md (modified, contains RL_LIMIT)
- FOUND: commit a308416
- FOUND: commit d48bb9c
