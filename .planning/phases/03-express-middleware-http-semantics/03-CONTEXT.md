# Phase 3: Express Middleware & HTTP Semantics - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

An Express middleware that wraps the existing framework-agnostic `RateLimiter`
(from Phase 1) and enforces it **per extracted client key** with standards-correct
HTTP behavior. The middleware extracts an opaque client key, calls
`limiter.consume(key)`, emits rate-limit headers on BOTH allowed and rejected
responses, returns `429 Too Many Requests` + `Retry-After` when over limit, and
handles a `consume()` error/rejection without crashing the request — honoring its
own configurable fail-open/closed policy. Developed and tested entirely against
the **in-memory store** (no Redis dependency), verified via `supertest`.

The core stays transport-agnostic: the adapter lives behind its own subpath entry
and imports Express; `src/types.ts` and the limiters import NOTHING from Express.

**Requirements covered:** HTTP-01, HTTP-02, HTTP-03, HTTP-04.

**Not this phase:** the Redis store / defensive store policy (Phase 2, already
complete — the store resolves its own fail-open/closed and never throws); the demo
HTTP server, Docker, and DESIGN.md (Phase 4). The DESIGN.md *content* about the
reset-header convention is WRITTEN in Phase 4, but the convention is locked here.

</domain>

<decisions>
## Implementation Decisions

### Client key extraction (HTTP-01 / CORE-05)
- **D3-01: Default key source is `req.ip`, with an optional `keyGenerator(req) =>
  string` override.** The middleware ships a sensible default (IP) so the demo
  works out of the box, but accepts a `keyGenerator` to derive the key from an
  API key, user id, header, etc. The key remains OPAQUE to the core (CORE-05) —
  extraction is exclusively the adapter's job; the limiter never parses it.
- **D3-02: Proxy / `X-Forwarded-For` handling is the app's responsibility,
  documented, not re-implemented.** The middleware relies on Express's own
  `trust proxy` setting to populate `req.ip` correctly behind a proxy. We do NOT
  parse `X-Forwarded-For` ourselves (avoids a well-known IP-spoofing footgun and
  duplicating Express). Documented as a deployment note.
- **D3-03: When `keyGenerator` returns `null`/`undefined`/empty, the request is
  ADMITTED (limiting skipped) and a warning is logged** via the optional
  `DegradedLogger` (the same `warn(obj,msg)` sink already in `RedisStoreConfig`).
  Rationale: a missing key is an extraction gap, not a client offense — failing
  the request on an infra detail is worse than admitting it; the log restores
  operator visibility. (Symmetric with the fail-open default, D3-07.)

### Header mapping & reset unit (HTTP-03)
- **D3-04: Emit BOTH the IETF `RateLimit` family AND the legacy `X-RateLimit-*`
  headers, on allowed AND rejected responses.** IETF: the current draft's
  structured-field `RateLimit` header plus `RateLimit-Policy`. Legacy:
  `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. (Exact IETF
  draft version / field syntax is a research item — see Claude's Discretion.)
- **D3-05: One consistent unit across all reset/retry headers: delta-seconds.**
  `reset`/`Retry-After` express **seconds until reset**, computed from the
  `Decision`: `Retry-After = ceil(retryAfterMs/1000)`, `reset = ceil(resetMs/1000)`.
  `X-RateLimit-Reset` is ALSO delta-seconds (NOT epoch) so the unit is consistent
  with the IETF header (HTTP-03's "consistent reset unit" requirement). Rejected
  the GitHub-style epoch-seconds convention precisely because it would split units.
- **D3-06: `remaining` is emitted as the integer already floored by the core**
  (D-04). `limit` comes from `Decision.limit` (D-12: capacity for Token Bucket,
  `limit` for windows). The middleware does no re-derivation — it maps the
  `Decision` fields straight to headers.

### Error handling & fail-open/closed (HTTP-04)
- **D3-07: The middleware owns its OWN configurable fail-open/closed policy,
  independent of the store, default `fail-open`.** It wraps `limiter.consume()`
  in try/catch: on a rejection it applies its policy — fail-open ADMITS (calls
  `next()`), fail-closed returns `429`. Default `fail-open` mirrors the store
  default (D2-04). Rationale: although `RedisStore` already resolves its policy
  internally and never throws, (a) a custom/alternative limiter COULD throw, and
  (b) Phase 3 runs against the in-memory store with no Redis, so a middleware-level
  policy is the ONLY way to exercise and `supertest`-verify HTTP-04 in this phase.
- **D3-08: HTTP-04 is verified by injecting a stub `RateLimiter` whose `consume`
  rejects**, then asserting fail-open admits (e.g. 200/`next()` reached) and
  fail-closed returns 429 — no unhandled rejection, request never crashes. The
  catch path also logs via the optional `DegradedLogger`.

### Middleware API & 429 response (HTTP-02)
- **D3-09: A factory `rateLimit(options) => RequestHandler`.** Options:
  `{ limiter, keyGenerator?, policy?, headers?, handler?, message?, logger? }`.
  `limiter` is required; everything else has a default. Returns a standard Express
  middleware. (Express 5 propagates async rejections to the error handler, but the
  middleware still catches `consume()` itself to apply D3-07 rather than leaking
  to the error handler.)
- **D3-10: 429 default body is JSON** (`{ error: "Too Many Requests",
  retryAfterMs }`) with `Content-Type: application/json`, plus `Retry-After` and
  all rate-limit headers. A `handler(req, res, decision)` override or a custom
  `message` lets the caller change the body. Headers are set on the response in
  ALL paths (allowed, 429, and policy-driven admit/deny).

### Claude's Discretion
- **Exact IETF draft version + structured-field syntax** for `RateLimit` /
  `RateLimit-Policy` (e.g. `RateLimit: limit=10, remaining=1, reset=5` and
  `RateLimit-Policy: 10;w=60`, vs. the older split `RateLimit-Limit/Remaining/Reset`
  headers) — researcher confirms against the current
  `draft-ietf-httpapi-ratelimit-headers` and picks the form to emit.
- **Adapter file layout & build wiring:** new `src/adapters/express/` directory
  with its own barrel; exported as a package subpath (e.g. `rate-limiter/express`)
  via a second `tsup` entry + `package.json` `exports` map — keeping Express out
  of the main core entry. Add `express`, `@types/express`, `supertest` as devDeps.
- **`headers` option shape** (e.g. `"both" | "ietf" | "legacy" | false`) and
  whether to expose it at all — planner's call; default emits both (D3-04).
- **Where the `reset`/`Retry-After` rounding helper lives** and how headers are
  serialized (structured-field helper vs. manual string) — implementation detail.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & scope (this repo)
- `.planning/REQUIREMENTS.md` — HTTP-01..04 are the locked Phase 3 requirements
  (per-key enforcement, 429 + Retry-After, IETF + legacy headers with integer
  `remaining` and a consistent `reset` unit, async/store-error handling honoring
  the fail-open/closed policy). Also CORE-05 (key is opaque to the core,
  extraction lives only in the adapter) and the **v2/Out of Scope** tables —
  variable `cost` through the middleware (EXT-01) and metrics/logging (OBS-*) are
  v2, NOT this phase.
- `.planning/ROADMAP.md` §"Phase 3" — goal + 3 success criteria (the verification
  contract: 429+Retry-After, IETF/legacy headers on allowed+rejected, store-error
  handling verified via supertest).
- `.planning/PROJECT.md` — APOSD / anti-slop grading posture; CLAUDE.md stack pins
  (Express ^5.1, `@types/express` ^5, supertest ^7.2, Vitest ^4.1) and the
  Express 5 migration notes (native async error propagation, `req.query` getter).

### Phase 1/2 contracts the middleware consumes
- `rate-limiter/src/types.ts` — `RateLimiter` (the seam the middleware depends on),
  `Decision` (`allowed/limit/remaining/resetMs/retryAfterMs` → header mapping),
  `RateLimitPolicy` (`"fail-open" | "fail-closed"` — REUSE this type for D3-07),
  and `DegradedLogger` (`warn(obj,msg)` — REUSE for D3-03/D3-08 logging).
- `rate-limiter/src/index.ts` — current public barrel; the Express adapter is a
  NEW subpath export, not added to this core barrel (keeps Express out of core).
- `.planning/phases/01-core-algorithms-in-memory-reference/01-CONTEXT.md` — D-03
  (`retryAfterMs` semantics), D-04 (integer floored `remaining`), D-05 (`resetMs`
  = time to full replenishment), D-12 (`Decision.limit` per algorithm). These pin
  exactly what the headers carry.
- `.planning/phases/02-conformance-harness-redis-lua-store-defensive-behavior/02-CONTEXT.md`
  — D2-04 (fail-open default rationale — the middleware policy default mirrors it).

### External tooling / standards (consult during research)
- `draft-ietf-httpapi-ratelimit-headers` (IETF) — current `RateLimit` /
  `RateLimit-Policy` structured-field syntax (D3-04, Claude's-discretion item).
- RFC 9110 §10.2.3 `Retry-After` — delta-seconds vs HTTP-date (D3-05 uses
  delta-seconds).
- Express 5 + supertest ^7.2 docs (per CLAUDE.md) — middleware signature, async
  error propagation, `req.ip` / `trust proxy`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `rate-limiter/src/types.ts`: `RateLimiter`, `Decision`, `RateLimitPolicy`, and
  `DegradedLogger` are all reused directly by the middleware — no new policy or
  logger types needed (D3-07 reuses `RateLimitPolicy`; D3-03/D3-08 reuse
  `DegradedLogger`).
- `rate-limiter/src/store/memory.ts` + the three limiters
  (`TokenBucketLimiter` etc.): the middleware is exercised against these in
  supertest — no Redis required for Phase 3.
- Phase 1/2 test suites are the template for the supertest suite (deterministic;
  inject a `FakeClock` into the limiter if time-based assertions are needed).

### Established Patterns
- **Tier boundary (core stays framework-agnostic):** only `src/store/redis.ts`
  imports ioredis today; analogously, ONLY the new `src/adapters/express/**` may
  import Express. `types.ts` and the limiters must stay import-clean (D3 adapter
  layout, Claude's discretion).
- **Config validated at construction** (`rate-limiter/src/validate.ts`): the
  middleware factory should validate its options the same way (reject a missing
  `limiter`, an invalid `policy`, etc.) — reuse `assertPolicy` for `policy`.
- **Integer ms at the boundary** (D-09): `Decision` carries integer ms; the
  middleware converts to delta-seconds with `ceil` at the very edge (D3-05).

### Integration Points
- The middleware sits between Express and the `RateLimiter`. It is the seam Phase
  4's demo server wires up (`app.use(rateLimit({ limiter }))`). New code:
  `src/adapters/express/` + a second build entry + `package.json` subpath export
  + `express`/`@types/express`/`supertest` devDeps.

</code_context>

<specifics>
## Specific Ideas

- **Unit consistency is the graded subtlety in HTTP-03** — all reset/retry headers
  in delta-seconds (D3-05), no epoch. The DESIGN.md (Phase 4) explains this
  "reset-header convention" choice (already an explicit DELIV-04 talking point).
- **HTTP-04 must be provable without Redis** — the middleware-level policy (D3-07)
  + a throwing stub limiter (D3-08) is the mechanism; this is why the policy is NOT
  delegated entirely to the store.
- **Out-of-the-box ergonomics:** `rateLimit({ limiter })` with no other options
  should Just Work (IP key, both header families, fail-open, JSON 429) — the demo
  in Phase 4 leans on these defaults.

</specifics>

<deferred>
## Deferred Ideas

- **Variable request `cost` exposed through the middleware** — EXT-01, tracked as
  v2 in REQUIREMENTS.md. The core already supports `consume(key, cost)`; surfacing
  it as a per-route middleware option is a future enhancement, not Phase 3.
- **Allowlist / skip rules (e.g. skip rate-limiting for certain IPs/paths)** — a
  new capability beyond "enforce a limiter per key"; would be its own phase if
  ever wanted. Not built.
- **Metrics / structured decision logging (allowed/denied counters)** — OBS-01/02,
  v2. The optional `DegradedLogger` only logs degraded/skip events, not every
  decision.
- **A non-Express adapter (Fastify, etc.)** — EXT-02, v2. Phase 3 ships Express
  only; the clean tier boundary keeps a second adapter cheap later.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.

</deferred>

---

*Phase: 3-Express Middleware & HTTP Semantics*
*Context gathered: 2026-06-24*
