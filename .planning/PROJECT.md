# IOL Rate Limiter

## What This Is

A distributed **rate limiter** implemented in TypeScript/Node.js, built as the practical
deliverable for IOL's System Design Implementation Challenge (based on the rate limiter
chapter of *System Design Interview — An Insider's Guide, Vol 1* by Alex Xu). It is a
framework-agnostic core library (multiple rate-limiting algorithms behind one interface,
backed by pluggable storage) plus an Express middleware adapter and a demo HTTP server,
deployable via Docker.

## Core Value

The core rate-limiting algorithms must be **correct under concurrency** and **comprehensively
tested** — including time-based and race-condition edge cases. If everything else fails, the
algorithms must provably enforce their limits.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] **Express middleware** adapter that enforces limits per client key — *Validated in Phase 3: express-middleware-http-semantics*
- [x] Standard rate-limit response headers (IETF `RateLimit`/`RateLimit-Policy` + legacy
      `X-RateLimit-*`) and `429 Too Many Requests` with `Retry-After` — *Validated in Phase 3*
- [x] Comprehensive unit tests for core algorithms (Vitest), including concurrency/time edges,
      behind a hard four-metric ≥95% coverage gate — *Validated in Phase 5: quality-swagger-compliance*
- [x] Swagger/OpenAPI documentation on the demo server (`/docs` + `/openapi.json`) plus a
      `COMPLIANCE.md` brief→evidence map — *Validated in Phase 5*

### Active

<!-- Current scope. Building toward these. -->

- [ ] Common `RateLimiter` strategy interface that all algorithms implement
- [ ] **Token Bucket** algorithm
- [ ] **Sliding Window Counter** algorithm
- [ ] **Fixed Window Counter** algorithm (baseline for comparison/discussion)
- [ ] Pluggable `Store` interface for limiter state
- [ ] **In-memory** store implementation (single-node, used by tests)
- [ ] **Redis** store implementation using atomic Lua scripts (distributed correctness)
- [x] Defensive design: Redis call timeouts + configurable fail-open / fail-closed policy
      (Redis-side validated in Phase 2; HTTP-edge fail-open/closed validated in Phase 3)
- [ ] Demo HTTP server exercising the middleware
- [ ] Docker + docker-compose for app + Redis (ease of deployment)
- [ ] `DESIGN.md` documenting architecture, trade-offs, and how AI was used

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Leaking bucket and sliding window **log** algorithms — deferred; three algorithms already
  demonstrate the tradeoff space without tipping into overengineering / "AI slop"
- Multi-tenant config UI / admin dashboard — not part of the challenge's core logic
- Distributed coordination beyond Redis (e.g. gossip, consensus) — out of scope for a prototype
- Persistence/durability of counters beyond Redis — limiter state is intentionally ephemeral
- Auth / API gateway features beyond rate limiting — keep the surface focused

## Context

- **Challenge rules:** Must deliver a working, correct, well-designed, **tested** solution.
  Non-compiling or test-failing code will not be reviewed. Every line must be understood and
  defensible in interview; undocumented AI-generated code is penalized.
- **Grading focus:** correct builds + passing tests, comprehensive tests for core logic,
  elegant design (APOSD — *A Philosophy of Software Design*), correct error handling,
  concurrency only where needed, avoiding overengineering and AI slop.
- **Nice-to-haves:** logging, metrics, ease of deployment, defensive design (timeouts,
  right-sized connection pools, circuit breakers), good hand-written comments/docs.
- **Stack rationale:** TypeScript/Node.js + Redis + Docker chosen to mirror the IOL backend
  developer role's stack (Node.js/TypeScript, Redis, MongoDB/DynamoDB, AWS, Docker, Terraform),
  making the solution both on-message for the role and aligned with the book's Redis-backed
  distributed rate limiter design.
- **Submission shape:** new repository, a folder named after the problem (`/rate-limiter`),
  containing the solution and a `DESIGN.md`.

## Constraints

- **Tech stack**: TypeScript on Node.js — chosen to match the IOL backend role and the book's
  distributed design.
- **Tech stack**: Redis for the distributed store (atomic Lua scripts) — correctness under
  concurrent access without round-trip race conditions.
- **Tech stack**: Express middleware, Vitest test runner, `ioredis` client — sensible,
  widely-understood defaults; core kept framework/transport-agnostic.
- **Quality**: Code must build and all tests must pass at every milestone (mandatory gate).
- **Design**: Favor clarity and deep modules (APOSD) over feature breadth; avoid overengineering.
- **Deliverable**: Solution lives under a `/rate-limiter` folder with a `DESIGN.md`.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Implement Rate Limiter (Ch. 4) | Rich, testable core logic with real concurrency; matches challenge's own `/rate-limiter` example | — Pending |
| TypeScript/Node.js | Mirrors the IOL backend developer stack | — Pending |
| Token Bucket + Sliding Window Counter + Fixed Window | Covers the production-relevant tradeoff space without overengineering | — Pending |
| In-memory + Redis stores behind a `Store` interface | Fast tests + distributed correctness; showcases the book's race-condition handling | — Pending |
| Atomic Redis Lua scripts | Eliminate read-modify-write races across distributed nodes | — Pending |
| Framework-agnostic core + Express adapter | Elegant separation; core is testable without HTTP | — Pending |
| Configurable fail-open / fail-closed on store errors | Defensive design — explicit availability-vs-correctness tradeoff | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-25 — Phase 5 complete (quality hardening: ≥95% four-metric coverage gate, Swagger/OpenAPI docs, COMPLIANCE.md audit). Milestone v1.0 complete.*
