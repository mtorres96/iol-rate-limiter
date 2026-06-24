# Roadmap: IOL Rate Limiter

## Overview

A distributed rate limiter built inside-out: contracts and correctness first, distribution second, transport third, packaging last. Phase 1 establishes the framework-agnostic core — the `RateLimiter`/`Decision`/`Store`/`Clock` interfaces and all three algorithms proven correct against an in-memory store with deterministic `FakeClock` tests (this is the stated Core Value). Phase 2 authors a shared conformance suite that defines the contract Redis must satisfy, then implements the atomic-Lua `RedisStore` plus its defensive timeout + fail-open/closed behavior, proven against a real Redis. Phase 3 wraps the core in an Express middleware with correct HTTP semantics (it only needs the `RateLimiter` interface, so it parallelizes after Phase 1). Phase 4 ties it together with a demo server, one-command Docker deployment, and the graded `DESIGN.md`. The build-green gate (`tsc --noEmit` + full Vitest suite) is mandatory at every phase; all code lives under `/rate-limiter`.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Core, Algorithms & In-Memory Reference** - Narrow interfaces + three correct algorithms proven against an in-memory store with FakeClock (completed 2026-06-23)
- [ ] **Phase 2: Conformance Harness, Redis/Lua Store & Defensive Behavior** - Shared conformance suite + atomic-Lua Redis store with timeouts and fail-open/closed, proven against real Redis
- [ ] **Phase 3: Express Middleware & HTTP Semantics** - Per-key enforcement middleware with standards-correct headers, 429/Retry-After, and async error handling
- [ ] **Phase 4: Demo, Docker & DESIGN.md** - One-command deployable demo + graded architecture/AI-usage documentation behind the final verification gate

## Phase Details

### Phase 1: Core, Algorithms & In-Memory Reference

**Goal**: The framework-agnostic core exists and provably enforces limits — all three algorithms are interchangeable behind one interface and pass exhaustive deterministic tests against an in-memory store.
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, ALGO-01, ALGO-02, ALGO-03, ALGO-04, STOR-01, TEST-01, DELIV-05
**Success Criteria** (what must be TRUE):

  1. All solution code lives under a `/rate-limiter` folder and `tsc --noEmit` passes on a clean checkout.
  2. Each of Token Bucket, Sliding Window Counter, and Fixed Window can be swapped behind the same `RateLimiter.consume(key, cost?)` call and returns a `Decision` with `allowed`, `limit`, `remaining`, `resetMs`, `retryAfterMs`.
  3. With an injected `FakeClock` (no real sleeps), tests demonstrate refill, burst, window rollover, request cost, and exact-limit boundary behavior — including Fixed Window's documented boundary-burst.
  4. A burst of concurrent in-memory `consume` calls admits exactly `limit` (over-admission guard) and the `Store` interface exposes one algorithm-shaped atomic op per algorithm (not generic get/set).

**Plans**: 4 plans

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Bootstrap /rate-limiter ESM package scaffold (configs, locked dev deps, tsc/vitest/eslint gates)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Core contracts (RateLimiter/Decision/Store/Clock/configs/OpTuple) + injectable Clock & FakeClock

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — MemoryStore three algorithm ops + three interchangeable thin limiters + public barrel

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Deterministic FakeClock test suites (TB/SW/FW) + exact-limit concurrency over-admission guard

### Phase 2: Conformance Harness, Redis/Lua Store & Defensive Behavior

**Goal**: A distributed store is correct and resilient — the same conformance suite that pins the contract passes against both the in-memory reference and an atomic-Lua Redis store, which bounds every call and applies an explicit fail-open/closed policy.
**Depends on**: Phase 1
**Requirements**: STOR-02, STOR-03, STOR-04, STOR-05, DEF-01, DEF-02, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):

  1. A single parametrized conformance suite drives identical `(key, cost, now)` sequences against both `MemoryStore` and `RedisStore` and asserts identical `Decision`s — authored before/with the Redis implementation.
  2. Each algorithm's Redis state mutation runs inside one atomic Lua script registered via ioredis `defineCommand` (auto-EVALSHA + NOSCRIPT fallback), receives `now` as an argument (never `redis.call('TIME')`), sets key TTL inside the script, and uses namespaced keys on a single shared client.
  3. Against a real Redis (`@testcontainers/redis`), a concurrent burst admits exactly `limit` (no read-modify-write over-admission).
  4. Every Redis call is bounded by a configurable timeout, and fault-injection tests prove both fail-open and fail-closed policies behave correctly under a down/slow Redis with no unhandled rejection (documented default).

**Plans**: 5 plans (research completed — Lua KEYS/ARGV/TTL, conformance shape, breaker/timeout/policy defaults all locked in 02-RESEARCH.md)

Plans:
**Wave 1**

- [ ] 02-01-PLAN.md — Async Store migration (Promise<OpTuple>) + RedisStore config types + policy/prefix validators
- [ ] 02-02-PLAN.md — Install ioredis/testcontainers + three atomic-Lua ports + tsup lua-copy + shared conformance fixtures

**Wave 2** *(blocked on Wave 1)*

- [ ] 02-03-PLAN.md — RedisStore (defineCommand + commandTimeout + circuit breaker + fail-open/closed policy) + breaker unit tests + barrel exports

**Wave 3** *(blocked on Wave 2)*

- [ ] 02-04-PLAN.md — Parametrized conformance suite (both stores, identical Decisions) + real-Redis integration + concurrency over-admission guard

**Wave 4** *(blocked on Wave 3)*

- [ ] 02-05-PLAN.md — Fault-injection matrix: down/slow × fail-open/fail-closed × breaker (no unhandled rejection)

### Phase 3: Express Middleware & HTTP Semantics

**Goal**: An Express application can enforce a limiter per client key end-to-end with correct, standards-compliant HTTP behavior, developed and tested against the in-memory store (no Redis dependency).
**Depends on**: Phase 1 (parallelizable with Phase 2)
**Requirements**: HTTP-01, HTTP-02, HTTP-03, HTTP-04
**Success Criteria** (what must be TRUE):

  1. Express middleware extracts an opaque client key and enforces the configured limiter, returning `429 Too Many Requests` with a `Retry-After` header when over limit.
  2. Rate-limit headers (IETF `RateLimit`/`RateLimit-Policy` + legacy `X-RateLimit-*`) are emitted on both allowed and rejected responses, with integer `remaining` and a consistent `reset` unit.
  3. A store error or timeout is handled without crashing the request, honoring the configured fail-open/closed policy (verified via supertest).

**Plans**: TBD
**UI hint**: yes

### Phase 4: Demo, Docker & DESIGN.md

**Goal**: The solution is reproducibly deployable with one command and is documented to a graded standard, passing the mandatory final verification gate from a clean checkout.
**Depends on**: Phase 2, Phase 3
**Requirements**: DELIV-01, DELIV-02, DELIV-03, DELIV-04, DELIV-06
**Success Criteria** (what must be TRUE):

  1. A demo HTTP server exercises the middleware end-to-end, and `docker compose up` starts the demo backend AND Redis together (multi-stage `node:24-alpine`, non-root, Redis service + healthcheck) with no manual setup.
  2. `npm run verify` (typecheck + full test suite) passes from a clean checkout.
  3. `DESIGN.md` documents architecture and trade-offs (why Lua, fixed-window boundary, concurrency justification, fail-open/closed rationale, reset-header convention) with an honest AI-usage section.
  4. A README provides a one-command quickstart with example requests, and a Mermaid architecture/data-flow diagram illustrates the layered design and request path.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4
(Phase 3 may begin in parallel once Phase 1 completes; Phase 4 requires Phases 2 and 3.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core, Algorithms & In-Memory Reference | 4/4 | Complete   | 2026-06-23 |
| 2. Conformance, Redis/Lua & Defensive Behavior | 0/5 | Not started | - |
| 3. Express Middleware & HTTP Semantics | 0/TBD | Not started | - |
| 4. Demo, Docker & DESIGN.md | 0/TBD | Not started | - |
