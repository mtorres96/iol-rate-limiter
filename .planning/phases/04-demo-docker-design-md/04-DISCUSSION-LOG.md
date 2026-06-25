# Phase 4: Demo, Docker & DESIGN.md - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 4-Demo, Docker & DESIGN.md
**Areas discussed:** Demo store & algorithm, verify + Redis tests, Demo server surface, DESIGN.md vs README split

---

## Demo store & algorithm

| Option | Description | Selected |
|--------|-------------|----------|
| Redis + memory fallback | RedisStore when `REDIS_URL` set (compose sets it); auto-fallback to MemoryStore when absent, so `npm run dev` works with no Docker | ✓ |
| Redis only | Demo always wires RedisStore; can't run without a reachable Redis | |
| In-memory only | Demo wires MemoryStore; compose Redis unused by app | |

**User's choice:** Redis + memory fallback (recommended)
**Notes:** Algorithm defaults to Token Bucket, switchable via env across all three
algorithms (Claude's discretion on env names + tiny demo config). → D4-01, D4-02

---

## verify + Redis tests

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-skip without Docker | Redis/integration tests skip-with-notice when no Docker daemon; verify always green from a clean checkout | |
| Docker required for verify | verify runs the entire suite incl. Redis tests; Docker is a documented prerequisite | ✓ |
| Split unit vs integration | verify = typecheck + unit only; separate `test:integration` for Docker | |

**User's choice:** Docker required for verify
**Notes:** Initial free-text answer was "la idea es levantar con docker"; clarified
in plain text (and again in Spanish on request) that the `verify` gate is separate
from the deploy story. User then explicitly chose **Docker obligatorio para verify**
over the recommended auto-skip. Consequence captured as a hard requirement: the
README/DESIGN.md MUST document that a running Docker daemon is a prerequisite for
`npm run verify`. → D4-06

---

## Demo server surface

| Option | Description | Selected |
|--------|-------------|----------|
| Rate-limited route + /health | One rate-limited route (e.g. `GET /api/ping`) at a tiny limit + unlimited `GET /health` for the compose healthcheck | ✓ |
| Multiple limited routes | Several routes showing different limiters/keys | |
| Single root route only | Just one rate-limited `GET /`, no dedicated health endpoint | |

**User's choice:** Rate-limited route + /health (recommended)
**Notes:** Tiny limit so a 429 + Retry-After is trivial to reproduce in README curl
examples; /health stays outside the limiter so the healthcheck never consumes
budget. → D4-03, D4-04

---

## DESIGN.md vs README split

| Option | Description | Selected |
|--------|-------------|----------|
| README quickstart + DESIGN.md deep | README = quickstart + curl examples + Mermaid diagram; DESIGN.md = architecture + trade-offs + honest AI-usage | ✓ |
| Single combined DESIGN.md | Everything in DESIGN.md; README a minimal pointer | |
| Diagram in DESIGN.md | Same split but Mermaid diagram lives in DESIGN.md | |

**User's choice:** README quickstart + DESIGN.md deep (recommended)
**Notes:** Follow-up instruction during discussion — "documentar lo de docker en la
doc del proyecto": the Docker-required-for-verify prerequisite (D4-06) must be
documented in the project docs (README + DESIGN.md). Captured as a hard
requirement in D4-06 / D4-07 and the Specific Ideas section. → D4-07, D4-08

---

## Claude's Discretion

- Exact demo route path(s), precise limit numbers/window, env var names (algorithm
  selector, limit overrides), and the small demo limiter config.
- Demo server file location/shape under `rate-limiter/`, its `dev`/`start` script,
  and an optional thin supertest smoke test.
- Dockerfile layering details, compose file name, healthcheck commands/intervals,
  exposed port.
- Optional thin root-level README pointer in addition to `rate-limiter/README.md`.
- DESIGN.md section ordering and the exact Mermaid diagram(s).

## Deferred Ideas

- Metrics / `/metrics` Prometheus endpoint + structured decision logging (OBS-01/02, v2).
- Variable request `cost` through the demo/middleware (EXT-01, v2).
- A second framework adapter, e.g. Fastify (EXT-02, v2).
- A richer multi-route demo (per-key vs per-IP, multiple limiters) — rejected in
  favor of the minimal two-route demo (D4-03).
