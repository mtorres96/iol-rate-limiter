# Phase 4: Demo, Docker & DESIGN.md - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The final packaging-and-documentation phase. Everything functional is already
built and proven: the framework-agnostic core + three limiters (Phase 1), the
atomic-Lua `RedisStore` with defensive timeout / fail-open-closed behavior
(Phase 2), and the Express `rateLimit()` middleware with standards-correct HTTP
semantics (Phase 3). This phase makes the solution **reproducibly deployable with
one command and documented to a graded standard**:

1. A **demo HTTP server** that wires the Express middleware to a store and
   exercises the limiter end-to-end (DELIV-01).
2. **One-command Docker deploy** — a multi-stage `node:24-alpine` (non-root)
   Dockerfile + `docker compose up` starting the demo app AND Redis together,
   with a Redis service + healthcheck and no manual setup (DELIV-02).
3. **`npm run verify`** (typecheck + full test suite) as the mandatory final gate
   (DELIV-03).
4. **`DESIGN.md`** — architecture, the locked trade-offs (why Lua, fixed-window
   boundary, concurrency justification, fail-open/closed rationale, delta-seconds
   reset-header convention) and an honest AI-usage section (DELIV-04).
5. **Score-boosting docs** — a `README` with a one-command quickstart + example
   requests, and a Mermaid architecture/data-flow diagram (DELIV-06).

All new files live under `/rate-limiter` (DELIV-05, already satisfied for the
library).

**Requirements covered:** DELIV-01, DELIV-02, DELIV-03, DELIV-04, DELIV-06.

**Not this phase (no scope creep):** new middleware capabilities (variable cost
EXT-01, allowlists, metrics/OBS-*, a non-Express adapter EXT-02) are all v2. This
phase writes NO new algorithm or store logic — it consumes the existing public
API and documents it. The conventions DESIGN.md explains were *locked* in Phases
1–3; Phase 4 only narrates them.

</domain>

<decisions>
## Implementation Decisions

### Demo server — store strategy & algorithm (DELIV-01)
- **D4-01: Store is Redis-with-in-memory-fallback, selected at runtime by
  `REDIS_URL`.** When `REDIS_URL` is set (docker-compose sets it), the demo wires
  the `RedisStore` against that Redis — exercising the real distributed path under
  `docker compose up`. When `REDIS_URL` is absent, the demo falls back to
  `MemoryStore` so a bare `node`/`npm run dev` run works with **zero Docker**.
  Rationale: showcases the distributed design (the whole point) under compose,
  while staying trivially runnable standalone for a quick local poke or a reviewer
  without Docker.
- **D4-02: The demo defaults to the Token Bucket limiter, switchable via an env
  var across all three algorithms** (token-bucket | sliding-window | fixed-window).
  Token bucket is the most representative default; env-switchability lets a
  reviewer see any algorithm without code changes. Concrete env name + small
  default config (capacity/interval) is Claude's discretion, kept tiny so a 429 is
  easy to trigger.

### Demo server — endpoints & limits (DELIV-01 / DELIV-06)
- **D4-03: Two routes.** (a) A single **rate-limited** route — `GET /api/ping`
  (exact path Claude's discretion) — at a **tiny limit** (e.g. ~5 requests/min) so
  a `429 Too Many Requests` + `Retry-After` + the rate-limit headers are trivial
  to reproduce with a short curl loop in the README. (b) An **unlimited**
  `GET /health` returning `200` for the compose **app** healthcheck (NOT behind the
  limiter, so a healthcheck never consumes budget or gets throttled).
- **D4-04: The demo relies on the middleware's out-of-the-box defaults** —
  `rateLimit({ limiter })` → IP key, both header families, fail-open, JSON 429
  (locked Phase 3, D3-09/D3-10). The demo wires the limiter + store and otherwise
  leans on defaults; it is intentionally minimal, not a feature showcase.

### Docker & verify gate (DELIV-02 / DELIV-03)
- **D4-05: `docker compose up` is the one-command path** — two services: `app`
  (multi-stage `node:24-alpine`, **non-root**, runs the demo server) and `redis`
  (`redis:7.4-alpine`) on a shared network. Redis has a healthcheck; the `app`
  waits for Redis to be healthy (`depends_on: condition: service_healthy`) and
  receives `REDIS_URL` pointing at the `redis` service. Multi-stage: build stage
  runs `tsup`; runtime stage copies `dist` + production deps only. (Per CLAUDE.md
  Docker posture.)
- **D4-06: `npm run verify` = typecheck + the FULL test suite, with Docker as a
  documented prerequisite (Docker REQUIRED, no auto-skip).** The suite's
  testcontainers Redis integration tests run unconditionally; verify does NOT skip
  them when Docker is absent. Rationale: the user's deployment story is
  Docker-first ("todo con Docker"), and the strongest gate is one that always
  exercises the real Redis path. **README/DESIGN.md MUST document that a running
  Docker daemon is a prerequisite for `npm run verify`** so a clean-checkout
  reviewer knows to start Docker first. (Chosen over auto-skip after an explicit
  trade-off discussion — see DISCUSSION-LOG.)
  - **Planner note:** confirm/define a `verify` script in `rate-limiter/package.json`
    (`typecheck` + `test` exist today; `verify` does not yet). DELIV-03's
    "from a clean checkout" is satisfied **with Docker running** under this choice.

### Documentation split (DELIV-04 / DELIV-06)
- **D4-07: README = reader-facing quickstart; DESIGN.md = grader-facing depth.**
  - **README:** one-command quickstart (`docker compose up`), example curl
    requests that demonstrate a successful call AND a `429` with `Retry-After` /
    rate-limit headers, the Docker-required note for `npm run verify`, and the
    **Mermaid architecture/data-flow diagram** (layered design + request path).
  - **DESIGN.md:** architecture overview, the locked trade-offs (why atomic Lua,
    the fixed-window boundary behavior, concurrency justification, fail-open vs
    fail-closed rationale, the delta-seconds reset-header convention from D3-05),
    and an **honest AI-usage section**.
- **D4-08: The AI-usage section is honest and specific** — it discloses that the
  project was built with AI assistance (Claude Code / GSD workflow), what the AI
  did vs what was human-directed, and where AI output was reviewed/corrected. It
  is a candid disclosure, not marketing. (DELIV-04 explicitly grades this.)

### Claude's Discretion
- Exact demo route path(s) (`/api/ping` vs other), the precise demo limit numbers
  and window, the env var names (algorithm selector, limit overrides), and the
  small demo limiter config — keep numbers tiny so a 429 is easy to show.
- Demo server file location and shape under `rate-limiter/` (e.g.
  `src/demo/server.ts` or a top-level `demo/`), and whether it gets its own tsx
  `dev` script + a thin supertest smoke test. Keep Express usage inside the
  adapter/demo tier — do NOT pull Express into the core barrel.
- Dockerfile layering details (cache mounts, prune strategy), compose file name,
  healthcheck commands/intervals, and exposed port — standard Docker craft per the
  CLAUDE.md Docker posture.
- Whether a thin root-level `README` pointer is added in addition to
  `rate-limiter/README.md` — the canonical docs live under `/rate-limiter`
  (DELIV-05), a root pointer is optional polish.
- DESIGN.md section ordering and the exact Mermaid diagram(s) — as long as the
  layered design (core → store/adapter → demo) and the request path
  (client → middleware → limiter → store → decision → headers/429) are legible.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & scope (this repo)
- `.planning/REQUIREMENTS.md` — DELIV-01..06 are the locked Phase 4 deliverables
  (demo server, one-command Docker, `npm run verify` gate, DESIGN.md with
  trade-offs + honest AI-usage, `/rate-limiter` location, README + Mermaid). The
  **v2 / Out of Scope** tables (EXT-01 variable cost, EXT-02 second adapter,
  OBS-* metrics/logging) are NOT this phase.
- `.planning/ROADMAP.md` §"Phase 4: Demo, Docker & DESIGN.md" — goal + the 4
  success criteria (compose up starts app+Redis with healthcheck; verify passes;
  DESIGN.md trade-offs + AI-usage; README quickstart + Mermaid). This is the
  verification contract.
- `.planning/PROJECT.md` + `CLAUDE.md` — APOSD / anti-slop grading posture; the
  **Docker (prescriptive)** section (`node:24-alpine` multi-stage non-root,
  `redis:7.4-alpine`, compose two services + healthcheck) and the stack pins
  (`tsup` build, `tsx` for the dev/demo server, Node 24, `.nvmrc`).

### Conventions DESIGN.md must narrate (locked upstream — DO NOT re-decide)
- `.planning/phases/03-express-middleware-http-semantics/03-CONTEXT.md` — D3-05
  (delta-seconds reset/Retry-After convention — the "reset-header convention"
  DESIGN.md must explain), D3-07 (middleware fail-open default + rationale),
  D3-09/D3-10 (the `rateLimit({ limiter })` defaults the demo leans on).
- `.planning/phases/02-conformance-harness-redis-lua-store-defensive-behavior/02-CONTEXT.md`
  — atomic-Lua rationale (why `EVAL`/`EVALSHA`, no round-trip races), the
  fail-open/closed store policy + timeout/circuit-breaker design, fixed-window
  boundary behavior. Primary source for DESIGN.md's trade-off section.
- `.planning/phases/01-core-algorithms-in-memory-reference/01-CONTEXT.md` — the
  algorithm correctness/concurrency justification and `Decision` semantics that
  DESIGN.md's concurrency section draws on.

### Code the demo + docs consume
- `rate-limiter/src/index.ts` — public core barrel: `RedisStore`, `MemoryStore`,
  the three limiters, `SystemClock`. The demo imports from here (D4-01/D4-02).
- `rate-limiter/src/adapters/express/index.ts` — the `rateLimit()` middleware
  subpath export the demo wires (`rate-limiter/express`).
- `rate-limiter/package.json` — current scripts (`typecheck`, `test`, `build`,
  `lint`) + dual `exports` map; Phase 4 adds the `verify` script and likely a
  `dev`/`start` script for the demo server.
- `rate-limiter/tsup.config.ts`, `rate-limiter/.nvmrc` (Node 24) — build + runtime
  pins the Dockerfile must match.

### External standards (only if needed for the diagram/prose)
- Mermaid `graph`/`flowchart` syntax — for the README architecture + request-path
  diagram (DELIV-06).
- Docker multi-stage + compose `depends_on: condition: service_healthy` + Redis
  `redis:7.4-alpine` healthcheck patterns (per CLAUDE.md Docker posture).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `rate-limiter/src/index.ts`: exports `RedisStore`, `MemoryStore`, the three
  limiters, and `SystemClock` — the demo composes these directly (D4-01/D4-02).
  No new core code needed.
- `rate-limiter/src/adapters/express/index.ts`: `rateLimit()` factory with
  out-of-the-box defaults (D3-09/D3-10) — the demo wires it with minimal config.
- The existing test suites (esp. `test/redis-integration.test.ts`,
  `test/support/redis.ts` testcontainers helper) define the Docker-backed tests
  that `npm run verify` runs unconditionally under D4-06.

### Established Patterns
- **Tier boundary:** only `src/store/redis.ts` imports `ioredis` and only
  `src/adapters/express/**` imports Express. The demo server is a NEW top tier
  that may import both Express (via the adapter subpath) and the store — but the
  **core barrel stays framework-agnostic** (do not add Express/demo code to
  `src/index.ts`).
- **Config validated at construction** (`src/validate.ts`) — the demo should read
  env (`REDIS_URL`, algorithm selector, limits) and fail loudly on bad config,
  consistent with the rest of the codebase.
- **Build via `tsup`, run via `tsx`** (CLAUDE.md) — the Dockerfile build stage
  runs `tsup`; the demo `dev` script uses `tsx`; the runtime image runs the built
  `dist` output, not `tsx`.

### Integration Points
- The demo server is the seam that ties all three phases together:
  `app.use(rateLimit({ limiter }))` where `limiter` wraps a store chosen by
  `REDIS_URL` (D4-01). docker-compose connects `app` → `redis` and injects
  `REDIS_URL`. This is the end-to-end path the README curl examples and the
  Mermaid diagram illustrate.

</code_context>

<specifics>
## Specific Ideas

- **`docker compose up` must be the literal one-command experience** — app + Redis
  + healthcheck, no manual steps (DELIV-02 grades exactly this). The README
  quickstart leads with it.
- **The 429 must be trivial to reproduce** — tiny demo limit + a copy-pasteable
  curl loop in the README that shows a `200` then a `429` with `Retry-After`.
- **`npm run verify` requires a running Docker daemon (D4-06)** — this MUST be
  stated up front in the README/DESIGN.md so a clean-checkout reviewer starts
  Docker before running the gate; otherwise the testcontainers Redis tests fail.
- **DESIGN.md trade-offs are a narration of already-locked decisions**, not new
  design — pull from the Phase 1–3 CONTEXT files (canonical refs above) rather
  than re-deriving.
- **AI-usage section is honest and specific** (D4-08) — it is explicitly graded
  (DELIV-04); disclose the Claude Code / GSD workflow usage candidly.

</specifics>

<deferred>
## Deferred Ideas

- **Metrics / `/metrics` Prometheus endpoint** (prom-client) and structured
  decision logging — OBS-01/02, v2. CLAUDE.md lists prom-client/pino as
  nice-to-haves; the demo does NOT build a metrics dashboard. If wanted, a tiny
  `/metrics` could be a future polish, but it is out of Phase 4 scope.
- **Variable request `cost` through the demo / middleware** — EXT-01, v2.
- **A second framework adapter (Fastify, etc.)** — EXT-02, v2.
- **A richer multi-route demo** (per-key vs per-IP, multiple limiters side by
  side) — considered for the "Endpoints" decision and rejected in favor of the
  minimal two-route demo (D4-03); could be expanded later but is not scoped here.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.

</deferred>

---

*Phase: 4-Demo, Docker & DESIGN.md*
*Context gathered: 2026-06-25*
