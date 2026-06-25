---
phase: quick-260625-qz8
plan: 01
subsystem: deploy/docs
tags: [docker-compose, env-vars, readme, demo-config]
requires: []
provides:
  - "Shell-overridable RL_* tunables in docker-compose.yml (Compose ${VAR:-default} interpolation)"
  - "README: three documented docker config-override run paths (Redis vs in-memory)"
affects:
  - rate-limiter/docker-compose.yml
  - rate-limiter/README.md
tech-stack:
  added: []
  patterns:
    - "Compose ${VAR:-default} interpolation for shell-overridable env with preserved defaults"
key-files:
  created: []
  modified:
    - rate-limiter/docker-compose.yml
    - rate-limiter/README.md
decisions:
  - "Only the four RL_* tunables interpolated; REDIS_URL and PORT kept literal (compose-network address / ports mapping)."
  - "Defaults preserved byte-for-byte: token-bucket / 5 / 60000 / 5 — unset behavior unchanged."
metrics:
  duration: ~3 min
  completed: 2026-06-25
  tasks: 2
  files: 2
requirements: [QZ8-01, QZ8-02]
---

# Quick Task 260625-qz8: Make docker-compose RL env vars shell-overridable Summary

Switched the four demo rate-limiter tunables in `docker-compose.yml` from literals to Compose
`${VAR:-default}` interpolation so a shell `RL_LIMIT=2 docker compose up` now actually overrides
the limiter config (previously silently ignored), with unset behavior byte-for-byte unchanged; and
expanded the README to document three distinct config-override run paths with the Redis-vs-in-memory
distinction made explicit.

## What Was Built

**Task 1 — Interpolate RL tunables (`docker-compose.yml`):** Replaced the four literal
`app.environment` values with `${RL_ALGO:-token-bucket}`, `${RL_LIMIT:-5}`,
`${RL_WINDOW_MS:-60000}`, `${RL_REFILL:-5}`. `REDIS_URL` and `PORT` deliberately left literal.
Trailing comments updated to note each value is now shell-overridable with its default.
Commit: `80338ef`

**Task 2 — Document three run paths (`README.md`):** Replaced the single
`docker run -e RL_LIMIT=10 ...` example with three labeled paths near the env-var table:
(a) compose + shell interpolation `RL_LIMIT=2 RL_WINDOW_MS=4000 docker compose up`,
(b) one-off `docker compose run --rm --service-ports -e RL_LIMIT=2 -e RL_WINDOW_MS=4000 app`,
(c) standalone `docker run --rm -p 3000:3000 -e RL_LIMIT=2 rate-limiter-app`. States (a)/(b) use the
real distributed Redis path and (c) uses the in-memory store. Env-var table preserved; DESIGN.md
untouched. Commit: `173397b`

## Verification

- `docker compose config --quiet` exits 0 (interpolated file still valid).
- With no env set, the four tunables resolve to `token-bucket` / `5` / `60000` / `5` (count = 4).
- `RL_LIMIT=2 docker compose config` resolves `RL_LIMIT: "2"`; `REDIS_URL` and `PORT` stay literal.
- README contains all three labeled run commands and the "in-memory store" distinction.
- `npm run verify` green: 100% statements / 98.4% branches, eslint clean, exit 0 (no TS source touched).

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- FOUND: rate-limiter/docker-compose.yml (modified)
- FOUND: rate-limiter/README.md (modified)
- FOUND commit: 80338ef
- FOUND commit: 173397b
