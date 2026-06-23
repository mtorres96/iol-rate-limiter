# Requirements: IOL Rate Limiter

**Defined:** 2026-06-23
**Core Value:** The core rate-limiting algorithms must be correct under concurrency and comprehensively tested, including time-based and race-condition edge cases.

## v1 Requirements

Requirements for the challenge deliverable. Each maps to roadmap phases.

### Core Contracts

- [ ] **CORE-01**: A `RateLimiter` interface exposes `consume(key, cost?) -> Promise<Decision>` as the single decision verb
- [ ] **CORE-02**: A structured `Decision` type reports `allowed`, `limit`, `remaining`, `resetMs`, and `retryAfterMs`
- [ ] **CORE-03**: An injectable `Clock` provides `now()`, with a `FakeClock` for deterministic time-based tests
- [ ] **CORE-04**: A `Store` interface exposes one atomic operation per algorithm (algorithm-shaped, not generic get/set)
- [ ] **CORE-05**: Request identity (key) is opaque to the core — IP/API-key/user extraction lives only in the adapter

### Algorithms

- [ ] **ALGO-01**: Token Bucket limiter — capacity + refill rate, lazy refill computed as a pure function of `(lastRefill, tokens, now)`, supports request cost
- [ ] **ALGO-02**: Sliding Window Counter limiter — weights the previous window by its remaining fraction (formula pinned with a worked numeric example)
- [ ] **ALGO-03**: Fixed Window Counter limiter — baseline implementation that knowingly exhibits and documents the window-boundary burst
- [ ] **ALGO-04**: All three algorithms are interchangeable behind the `RateLimiter` interface

### Storage

- [ ] **STOR-01**: In-memory `Store` implementation (single-node, atomic via the Node event loop) used as the readable reference and by unit tests
- [ ] **STOR-02**: Redis `Store` implementation executing each algorithm's state mutation inside a single atomic Lua script
- [ ] **STOR-03**: Redis scripts receive `now` as an argument (never `redis.call('TIME')`) and set key TTL/expiry inside the script
- [ ] **STOR-04**: Lua scripts are registered via ioredis `defineCommand` (auto-EVALSHA with NOSCRIPT fallback), using a shared single ioredis client
- [ ] **STOR-05**: Redis keys are namespaced/prefixed to avoid collisions

### Defensive Behavior

- [ ] **DEF-01**: Every Redis call is bounded by a configurable timeout
- [ ] **DEF-02**: Store errors/timeouts are handled by an explicit, configurable fail-open vs fail-closed policy with a documented default (no unhandled rejection)

### HTTP Integration

- [ ] **HTTP-01**: An Express middleware enforces a limiter per extracted client key
- [ ] **HTTP-02**: Over-limit requests receive `429 Too Many Requests` with a `Retry-After` header
- [ ] **HTTP-03**: Rate-limit headers are emitted on both allowed and rejected responses (IETF `RateLimit`/`RateLimit-Policy` + legacy `X-RateLimit-*`), with `remaining` as an integer and a consistent `reset` unit
- [ ] **HTTP-04**: Middleware handles async/store errors without crashing the request (honors the fail-open/closed policy)

### Testing

- [ ] **TEST-01**: Comprehensive Vitest unit tests for all three algorithms (refill, burst, window rollover, cost, exact-limit boundary) using `FakeClock`, no real sleeps
- [ ] **TEST-02**: A shared conformance test suite runs identical `(key, cost, now)` sequences against both stores and asserts identical `Decision`s
- [ ] **TEST-03**: Integration tests run the Redis store against a real Redis via `@testcontainers/redis`
- [ ] **TEST-04**: A concurrency test proves a burst of concurrent requests admits exactly `limit` (over-admission guard), against both memory and real Redis
- [ ] **TEST-05**: Fault-injection tests cover Redis-down/slow under both fail-open and fail-closed policies

### Delivery & Docs

- [ ] **DELIV-01**: A demo HTTP server exercises the middleware end-to-end
- [ ] **DELIV-02**: A single command (`docker compose up`) starts the demo backend AND Redis together — multi-stage Dockerfile (`node:24-alpine`, non-root) + docker-compose with a Redis service and healthcheck, no manual setup steps
- [ ] **DELIV-03**: `npm run verify` (typecheck + full test suite) passes from a clean checkout — enforced as a gate every phase
- [ ] **DELIV-04**: `DESIGN.md` documents architecture, trade-offs (why Lua, fixed-window boundary, concurrency justification, fail-open/closed rationale, reset-header convention) and an honest AI-usage section
- [ ] **DELIV-05**: Solution lives under a `/rate-limiter` folder per the submission rules
- [ ] **DELIV-06**: Score-boosting documentation — a README with a quickstart (one-command run, example requests) and architecture/data-flow diagrams (Mermaid) embedded in DESIGN.md/README illustrating the layered design and request path

## v2 Requirements

Deferred to future iterations. Tracked but not in current roadmap.

### Observability

- **OBS-01**: Structured logging (pino) for limiter decisions and store errors
- **OBS-02**: Prometheus metrics (prom-client) for allowed/denied counts and store latency

### Extended Integration

- **EXT-01**: Variable request `cost` exposed through the Express middleware config
- **EXT-02**: Framework adapter beyond Express (e.g. Fastify) reusing the same core

## Out of Scope

Explicitly excluded. Documented to prevent scope creep and AI slop.

| Feature | Reason |
|---------|--------|
| Leaking Bucket & Sliding Window Log algorithms | Three algorithms already demonstrate the tradeoff space; more is overengineering |
| Admin UI / dynamic per-tenant rule engine | Not core logic; pure scope creep for a focused challenge |
| Additional storage backends (Memcached, DynamoDB, etc.) | Two stores prove the abstraction; more adds slop without insight |
| Distributed consensus / clustering beyond Redis atomicity | Out of scope for a prototype; Redis Lua provides the needed atomicity |
| Persistence/durability of counters beyond Redis | Limiter state is intentionally ephemeral |
| Auth / API-gateway features beyond rate limiting | Keeps the surface focused on the chosen problem |
| Custom connection-pool manager / mutexes in Node | AI-slop / overengineering traps; single shared client + event-loop atomicity suffice |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (to be filled by roadmapper) | | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 28 ⚠️

---
*Requirements defined: 2026-06-23*
*Last updated: 2026-06-23 after initial definition*
