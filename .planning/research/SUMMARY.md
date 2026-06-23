# Project Research Summary

**Project:** IOL Rate Limiter
**Domain:** Distributed rate-limiter library + Express middleware (TypeScript/Node.js, Redis backend) — graded coding-challenge deliverable
**Researched:** 2026-06-23
**Confidence:** HIGH

## Executive Summary

This is a distributed rate limiter built as a graded System Design Implementation Challenge (Alex Xu, Ch. 4). Experts build this kind of system as a set of concentric layers — a framework- and transport-agnostic **core** (algorithm strategies + narrow interfaces) surrounded by pluggable **store** adapters (in-memory, Redis) and **transport** adapters (Express middleware, demo server) with dependencies pointing strictly inward. The whole stack (TypeScript on Node, Redis, ioredis, Express, Vitest, Docker) is fixed by the challenge framing; the research makes those choices prescriptive and version-pinned (Node 24 LTS, TypeScript ~5.9, Redis 7.4, ioredis ^5.11, Express ^5.1, Vitest ^4.1) for a reproducible, reviewable submission.

The recommended approach centers on two deep, narrow interfaces — `RateLimiter` (`consume(key, cost?) -> Promise<Decision>`) and an **algorithm-shaped `Store`** (one atomic op per algorithm, NOT generic get/set). The central technical decision is "one algorithm, two execution substrates": the TS implementation in `MemoryStore` is the readable reference (atomic for free via Node's single-threaded event loop), while `RedisStore` executes the equivalent math inside a single atomic **Lua script** (atomic via Redis script execution). A shared **conformance test suite** drives both stores with an injected `FakeClock` and asserts identical `Decision` results — this is the highest-leverage design move, proving correctness while preventing drift between the two encodings. Build order is inside-out: core contracts -> memory store + algorithms -> conformance harness -> Redis/Lua -> Express adapter -> Docker + DESIGN.md.

The biggest risks are not technical complexity but **graded judgment**: (1) correctness bugs in the algorithm math (token-bucket float drift, sliding-window weighting inversion, read-modify-write races if Redis logic leaks into TS instead of Lua); (2) **AI slop / overengineering** — speculative abstractions, restating comments, unused config, mutexes in single-threaded Node — which is an explicit grading penalty; and (3) the hard gate that non-compiling or test-failing code is not reviewed. Mitigation: inject a `Clock` for deterministic time tests (no `sleep`), keep concurrency control in exactly one justified place (Lua), honor the Out-of-Scope list exactly (3 algorithms, 2 stores, no extras), and run `tsc --noEmit` + full suite + clean `docker-compose up` as a hard gate every phase.

## Key Findings

### Recommended Stack

The stack is fixed by the challenge but pinned conservatively for a reproducible graded deliverable (see STACK.md). Author source as ESM, ship dual ESM+CJS via tsup, hold TypeScript at ~5.9 (not 6.0) for tooling stability, and pin Docker base images (`node:24-alpine`, `redis:7.4-alpine`) rather than `:latest`. Deliberately avoid `ioredis-mock`, off-the-shelf limiters, connection-pool managers, and heavy logging frameworks — all are slop traps.

**Core technologies:**
- Node.js **24.x LTS**: runtime — current Active LTS; v20 EOL, pin to LTS for reproducibility
- TypeScript **~5.9** (`strict`, `noUncheckedIndexedAccess`): language — mature baseline; hold off 6.0
- Redis **7.4** + **ioredis ^5.11**: distributed store — `defineCommand` gives auto-EVALSHA + NOSCRIPT fallback + command timeouts, mapping directly to atomic-Lua + fail-open/closed requirements
- Express **^5.1**: middleware adapter — native async error propagation suits the awaiting limiter
- Vitest **^4.1**: test runner — fake timers for deterministic refill/window tests; pair with `@testcontainers/redis ^12` for real-Redis integration tests and `supertest ^7.2` for HTTP assertions

### Expected Features

The grading reality (FEATURES.md): rewards correct, tested, elegant; penalizes overengineering. Every feature is weighted by whether it strengthens the submission.

**Must have (table stakes):**
- Three correct algorithms behind one `RateLimiter` interface (Token Bucket, Sliding Window Counter, Fixed Window) — exact behaviors specified in FEATURES.md
- Structured `Decision` contract (`allowed, limit, remaining, resetMs, retryAfterMs`)
- Pluggable `Store` interface + in-memory store + Redis store with atomic Lua
- Express middleware: key extraction, `429`, `Retry-After`, rate-limit headers
- Comprehensive Vitest tests including concurrency over-admission + time-boundary edges

**Should have (competitive / senior signal):**
- Configurable fail-open vs fail-closed on store error/timeout — the single most credible defensive-design point
- Redis call timeouts + right-sized single shared ioredis client (no pool manager)
- Injectable clock for deterministic time tests; standards-correct headers (IETF `RateLimit`/`RateLimit-Policy` + legacy `X-RateLimit-*`)
- DESIGN.md trade-off narrative (explicitly graded, including an honest AI-usage section)

**Defer (out of scope — name in DESIGN.md only):**
- Leaky bucket / sliding-window-log, admin UI / rule engine, extra storage backends, consensus/clustering, persistence — all explicitly out of scope; building them makes the submission worse

### Architecture Approach

Ports-and-adapters (hexagonal-lite) with dependencies pointing inward (ARCHITECTURE.md). The core (`core/`, `algorithms/`) knows nothing about HTTP or Redis; `store/` and `express/` are the only edges that import infrastructure. The defining decision is the **algorithm-aware Store** (atomic per-algorithm ops, not generic KV) plus the "one algorithm, two execution substrates" resolution (TS reference + Lua for Redis) kept honest by a shared conformance suite. Time flows from a single injected `Clock` into both stores (passed as Lua `ARGV` — never `redis.call('TIME')`).

**Major components:**
1. `RateLimiter` interface + algorithm classes (`TokenBucket`, `SlidingWindowCounter`, `FixedWindowCounter`) — encode policy + build `Decision`
2. `Store` interface + `MemoryStore` (TS math, event-loop atomic) + `RedisStore` (Lua/EVALSHA, timeouts, fail-open/closed)
3. `Clock` (injectable `now()`) — single source of time, deterministic tests
4. Express middleware adapter + demo server — the only components touching `req`/`res` and HTTP knowledge

### Critical Pitfalls

Top failures, weighted toward algorithm-correctness and AI-slop traps (PITFALLS.md):

1. **Read-modify-write race (logic in TS, not Lua)** — the central correctness failure Redis+Lua exists to prevent. Put ALL decision logic in one atomic Lua script; prove it with a concurrent EVALSHA burst against real Redis admitting exactly `limit`.
2. **Token-bucket float drift / sliding-window weighting inversion** — make the bucket a pure function of `(lastRefill, tokens, now)`; weight the *previous* window by the *remaining* fraction. Verify with long-horizon steady-drip and table-driven numeric tests (0/50/99%/boundary).
3. **Fail-open/closed unhandled (not decided)** — make policy explicit config, wrap every Redis call in a timeout, fault-inject a down/slow Redis and test both policies; no unhandled rejection.
4. **AI slop / overengineering** — explicit grading penalty. No restating comments, every config field consumed, every abstraction has a real consumer today, no mutexes in single-threaded Node. Honor Out-of-Scope exactly.
5. **Flaky real-clock tests + missing Redis TTL + non-compiling submission** — inject `FakeClock` (no `sleep`); set `PEXPIRE` inside the Lua script; enforce `tsc --noEmit` + full suite + clean `docker-compose up` as a hard gate every phase.

## Implications for Roadmap

Based on research, the inside-out build order maps cleanly to phases. All four research files converge on this sequence.

### Phase 1: Core Contracts + Algorithms + In-Memory Store
**Rationale:** Dependencies point inward; contracts unblock everything and the in-memory algorithm correctness IS the stated Core Value — do it first and thoroughly.
**Delivers:** `RateLimiter`/`Decision`/`Store` interfaces, `Clock`/`FakeClock`, three algorithms against `MemoryStore` with exhaustive FakeClock tests (refill, burst, window rollover, cost, exact-limit boundary).
**Addresses:** All three algorithms, interfaces, Decision contract, in-memory store, injectable clock, concurrency over-admission tests (in-memory).
**Avoids:** Token-bucket drift, sliding-window weighting errors, fixed-window boundary-burst-shown-knowingly, flaky real-clock tests, mutex-in-single-threaded-Node.

### Phase 2: Conformance Harness + Redis Store (Lua)
**Rationale:** The conformance suite defines the contract Redis must meet; the Redis/Lua implementation derives from the Phase 1 TS reference and must pass the *same* suite. Distributed correctness is the technical centerpiece.
**Delivers:** Parametrized conformance suite (any `Store`), three `.lua` scripts via ioredis `defineCommand` (auto-EVALSHA + NOSCRIPT fallback), TTL inside Lua, real-Redis integration tests via `@testcontainers/redis`, concurrent-burst over-admission proof.
**Uses:** ioredis `defineCommand`, redis 7.4, testcontainers.
**Implements:** `RedisStore` + `algorithms/lua/*.lua`.
**Avoids:** Read-modify-write race, missing TTL/key leak, `redis.call('TIME')`, unprefixed/interpolated keys.

### Phase 3: Defensive Store Behavior (Timeouts + Fail-Open/Closed)
**Rationale:** Fail-open/closed depends on a bounded (timeout) Redis call; this is the highest-credibility defensive-design differentiator and needs explicit fault-injection tests.
**Delivers:** Per-call timeout (`commandTimeout`/`Promise.race`), configurable `onStoreError` policy with documented default, single shared ioredis client, fault-injection tests for both policies.
**Implements:** Timeout + policy layer in `RedisStore`.
**Avoids:** Unhandled rejection on Redis-down, connection-per-request, silent fail-open under attack.

### Phase 4: Express Middleware + HTTP Semantics
**Rationale:** The adapter only needs the `RateLimiter` interface (can be developed/tested against `MemoryStore`, no Redis), so it parallelizes after Phase 1; finalize it once the limiter is solid.
**Delivers:** Key extraction, header building (IETF `RateLimit`/`RateLimit-Policy` + legacy `X-RateLimit-*` on 200 and 429), `Retry-After`, `429`, async error handling.
**Addresses:** Middleware, headers, 429/Retry-After table stakes.
**Avoids:** Headers-only-on-429, float `Remaining`, inconsistent reset units, trusting raw `X-Forwarded-For`, async-middleware unhandled rejection.

### Phase 5: Demo Server + Docker + DESIGN.md + Final Gate
**Rationale:** Integration and documentation come last but draw on notes captured from Phase 1 onward; the final verification gate is mandatory.
**Delivers:** Demo HTTP server, multi-stage Dockerfile (`node:24-alpine`, non-root), docker-compose (app + redis with healthcheck), DESIGN.md (tradeoffs, fixed-window boundary, why Lua, concurrency justification, fail-open/closed rationale, AI-usage section), AI-slop prune pass, `npm run verify` green from clean CLI + `docker-compose up` smoke.
**Uses:** tsup, Docker, docker-compose.
**Avoids:** Weak DESIGN.md, AI slop, non-compiling/test-failing submission.

### Phase Ordering Rationale

- **Inside-out dependency order** is unanimous across STACK/FEATURES/ARCHITECTURE/PITFALLS: contracts -> reference (memory) -> conformance -> distributed (Redis) -> transport -> deploy. Each layer is independently testable.
- **The conformance suite is the hinge:** authored before Redis (Phase 2) so it defines the contract; the TS reference (Phase 1) is the source of truth the Lua must match. This grouping is what prevents the two-encoding drift hazard.
- **Parallelizable work:** the Express adapter (Phase 4) and Docker scaffolding can begin right after Phase 1 contracts; the three algorithms are independent of each other.
- **Continuous concerns** (AI-slop discipline, build-green gate) run every phase, with a dedicated prune + final verification gate in Phase 5.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Redis/Lua):** MEDIUM — Lua atomicity and ioredis `defineCommand`/NOSCRIPT behavior are well-documented (HIGH sources), but the exact per-algorithm Lua + TTL semantics and the conformance harness shape warrant a focused `--research-phase` to lock the script contracts and KEYS/ARGV layout.

Phases with standard patterns (skip research-phase):
- **Phase 1 (algorithms):** Exact math and testable invariants are fully specified in FEATURES.md/PITFALLS.md.
- **Phase 3 (timeouts/policy):** Pattern is documented and low-complexity.
- **Phase 4 (Express middleware):** Well-trodden; header semantics specified in FEATURES.md.
- **Phase 5 (Docker/compose/DESIGN.md):** Conventional; prescriptive guidance already in STACK.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry + Node release schedule on 2026-06-23; ioredis `defineCommand` verified via Context7 |
| Features | HIGH | Algorithm behaviors from authoritative source (Alex Xu Ch. 4) + IETF draft + RFC 6585; competitor analysis grounded |
| Architecture | HIGH | APOSD-grounded; Redis/Lua atomicity and ioredis behavior verified against official docs |
| Pitfalls | HIGH | Redis Lua determinism, ioredis NOSCRIPT, Vitest fake timers all verified against current official sources |

**Overall confidence:** HIGH

### Gaps to Address

- **Sliding-window-counter weighting direction:** genuinely easy to invert; secondary blog sources (MEDIUM). Handle during Phase 1 planning by pinning the formula with a worked numeric example in a code comment and table-driven tests at 0/50/99%/boundary.
- **Exact Lua script contracts (KEYS/ARGV layout, TTL sizing per algorithm, return tuple shape):** the *approach* is HIGH-confidence but the per-algorithm specifics are not yet fixed. Resolve in the Phase 2 research-phase before writing scripts.
- **TS<->Lua equivalence enforcement:** mitigated by design (conformance suite), but the suite must be authored before Redis to be effective — sequence it as the first task of Phase 2.
- **Header convention (epoch vs delta seconds for Reset):** pick one, document in DESIGN.md, and apply consistently across adapter + tests during Phase 4.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`, 2026-06-23) — exact latest versions for all pinned dependencies
- nodejs.org release schedule — Node 24 Active LTS confirmation
- Context7 `/redis/ioredis` — `defineCommand` auto-EVALSHA + NOSCRIPT fallback, timeouts
- Redis docs — scripting (EVAL/EVALSHA atomicity, determinism), rate-limiter use case
- IETF draft-ietf-httpapi-ratelimit-headers (v11) + RFC 6585 (429)
- Vitest timers/fakeTimers guide
- System Design Interview Vol 1, Ch. 4 (Alex Xu) — project-authoritative
- A Philosophy of Software Design (Ousterhout) — deep modules / narrow interfaces

### Secondary (MEDIUM confidence)
- express-rate-limit docs/GitHub — `standardHeaders` draft-6/7/8, `RateLimitInfo` shape
- oneuptime / Redis dev group — single-script atomicity, pass-`now`-as-arg vs `TIME`
- ioredis blog + issue #1438 — Lua scripting / NOSCRIPT reload
- RD Blog / Medium / AlgoMaster — token-bucket and sliding-window-counter formulas

### Tertiary (LOW confidence)
- (none — all findings corroborated by at least one HIGH or multiple MEDIUM sources)

---
*Research completed: 2026-06-23*
*Ready for roadmap: yes*
