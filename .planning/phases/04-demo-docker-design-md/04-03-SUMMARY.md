---
phase: 04-demo-docker-design-md
plan: 03
subsystem: documentation
tags: [docs, design, readme, mermaid, ai-disclosure, deliverable]
requires:
  - "rate-limiter/src/demo/server.ts (plan 04-01)"
  - "rate-limiter/docker-compose.yml (plan 04-02)"
  - "rate-limiter/package.json scripts (verify/dev/start/build)"
  - "rate-limiter/src/adapters/express/{middleware,headers}.ts (phase 03)"
provides:
  - "rate-limiter/DESIGN.md (DELIV-04 — architecture + trade-offs + honest AI-usage)"
  - "rate-limiter/README.md (DELIV-06 — quickstart + 200->429 curl + Mermaid diagrams)"
affects: []
tech-stack:
  added: []
  patterns:
    - "Docs narrate already-locked CONTEXT decisions; no re-design"
    - "Every command/env/header/route claim verified against the real merged code"
key-files:
  created:
    - rate-limiter/DESIGN.md
    - rate-limiter/README.md
  modified: []
decisions:
  - "README shows the REAL emitted header formats (RateLimit-Policy: default;q=5, RateLimit: default;r=4;t=60) and 429 body {error, retryAfterMs} rather than the research shorthand — verified against headers.ts/middleware.ts"
  - "README documents the demo does NOT set windowSeconds, so the IETF policy header is 'default;q=5' with no ';w=' part"
metrics:
  duration_min: 6
  completed: 2026-06-25
  tasks: 2
  files: 2
requirements: [DELIV-04, DELIV-06]
---

# Phase 4 Plan 03: Demo Docker DESIGN.md — Documentation Summary

Authored the two graded, reviewer-facing documents for the rate limiter: **DESIGN.md** (architecture,
the locked Phase 1–3 trade-offs narrated from their canonical CONTEXT sources, plus an honest
AI-usage disclosure) and **README.md** (a one-command `docker compose up` quickstart, a copy-pasteable
200→429 curl walkthrough using the real demo values, the Docker-required-for-verify note, and two
Mermaid diagrams). Both narrate already-locked decisions — no new design — and every concrete claim
(routes, limit, env vars, scripts, header formats, 429 body) was verified against the real merged
code before being written.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DESIGN.md — architecture, trade-offs, honest AI-usage | 02f4b80 | rate-limiter/DESIGN.md |
| 2 | README.md — quickstart, 200→429 curl, Docker note, Mermaid | cbc285d | rate-limiter/README.md |

## What Was Built

**DESIGN.md (274 lines)** covers, in order:
1. Architecture overview + the tier boundary (only `store/redis.ts` imports ioredis, only
   `adapters/express/**` imports Express, the core barrel stays framework-agnostic, the demo is the
   only module importing both).
2. Why atomic Lua — one script per algorithm via `defineCommand` (EVALSHA + NOSCRIPT fallback), `now`
   as ARGV, TTL inside the script, namespaced keys (`rl` prefix), Redis serializes races.
3. Fixed-window boundary burst — worked ~2× example, contrasted with sliding-window's weighted blend
   and token-bucket's continuous refill.
4. Concurrency justification — MemoryStore event-loop atomic RMW (no mutex, Promise.all admits exactly
   `limit`); RedisStore single-Lua-script atomicity gives the same guarantee across clients.
5. Fail-open vs fail-closed — default fail-open (75 ms command timeout + circuit breaker: 5 failures /
   2 s cooldown), plus the "degradation strategies considered" table (per-node MemoryStore, Postgres
   secondary, token leasing, HA Redis+Sentinel — all rejected, with reasons).
6. Delta-seconds reset-header convention — `Retry-After = ceil(ms/1000)` clamped ≥1, both header
   families on allowed AND 429, single conversion point.
7. The `npm run verify` gate (`tsc --noEmit && vitest run`) + Docker-required prerequisite.
8. Honest AI-usage section — Claude Code under the GSD workflow, AI work vs human-directed decisions,
   `.planning/` cited as evidence.
9. Scope note — demo not production-hardened; trust-proxy deployment note; non-root image; Redis not
   host-exposed.

**README.md (164 lines, 2 Mermaid blocks)**: `docker compose up` quickstart → http://localhost:3000,
the real two routes (`/api/ping` limited, `/health` unlimited), a 200→429 curl walkthrough with the
actual emitted headers and `{error, retryAfterMs}` body, the env-vars table (`REDIS_URL`/`RL_ALGO`/
`PORT`), the zero-Docker standalone run (`npm run dev` / `npm run build && npm start`), the
Docker-required verify note, layered-design + request-path Mermaid diagrams, and the trust-proxy
deployment note.

## Verification Against Real Code

Every load-bearing claim was checked against the merged base commit (not the research shorthand):

- Routes/limit/env/shutdown: `rate-limiter/src/demo/server.ts` (`/api/ping`, `/health`, TINY_LIMIT=5,
  WINDOW_MS=60_000, `REDIS_URL`/`RL_ALGO` default `token-bucket`/`PORT` default 3000).
- Scripts: `rate-limiter/package.json` (`verify` = `tsc --noEmit && vitest run`, `dev` = `tsx watch`,
  `start` = `node dist/demo/server.js`, `build` = `tsup`).
- Compose: `rate-limiter/docker-compose.yml` (app port 3000, redis no host port, `RL_ALGO: token-bucket`).
- Header formats + 429 body: `rate-limiter/src/adapters/express/{headers,middleware}.ts`
  (`RateLimit-Policy: default;q=<limit>`, `RateLimit: default;r=<remaining>;t=<reset-s>`, legacy
  `X-RateLimit-*`, `Retry-After` clamped ≥1, body `{error, retryAfterMs}`).
- Defensive defaults: `rate-limiter/src/store/redis.ts` (commandTimeout 75 ms, fail-open default,
  breaker 5/2000 ms, `rl` key prefix, Lua loaded via `defineCommand`).
- Docker-skip behavior: `rate-limiter/test/support/redis.ts` (`dockerAvailable()` / `RL_SKIP_DOCKER=1`).

Both automated verification gates pass:
- DESIGN.md: `fail-open`, `lua`, `seconds`, `AI|Claude`, `npm run verify` all present.
- README.md: `docker compose up`, `429`, `Retry-After`, `npm run verify`, and 2 ```mermaid blocks.

## Deviations from Plan

One accuracy correction (not a code change): the research's curl-comment shorthand showed IETF headers
as `RateLimit: limit=5, remaining=4, reset=...`. The middleware actually emits the draft-11
Structured-Fields List form — `RateLimit-Policy: default;q=5` and `RateLimit: default;r=4;t=60` — and
the demo does not pass `windowSeconds`, so there is no `;w=` part. The README documents the **real**
emitted format. No code was modified; this is the accuracy_note requirement (docs must match the code).

## Known Stubs

None. Both files are complete documents with no placeholders, TODOs, or unwired content.

## Threat Flags

None. This plan adds documentation only; it introduces no new endpoints, auth paths, file access, or
schema. The threat_model dispositions are satisfied: the AI-usage section is honest and cites
`.planning/` (T-04-09); DESIGN.md frames the demo as a demo with no overstated guarantees (T-04-10);
both README and DESIGN.md document the `trust proxy` note for per-IP correctness behind a proxy (T-04-11).

## Self-Check: PASSED

- FOUND: rate-limiter/DESIGN.md
- FOUND: rate-limiter/README.md
- FOUND: .planning/phases/04-demo-docker-design-md/04-03-SUMMARY.md
- FOUND commit: 02f4b80 (DESIGN.md)
- FOUND commit: cbc285d (README.md)
