# Feature Research

**Domain:** Distributed rate limiter (library + Express middleware), coding-challenge deliverable
**Researched:** 2026-06-23
**Confidence:** HIGH

> Grading reality check: this challenge rewards *correct, tested, elegant* and explicitly
> PENALIZES overengineering / "AI slop". Every feature below is tagged not just by user value
> but by whether building it strengthens or weakens the submission. The bar for "table stakes"
> is "a reviewer would consider the limiter broken/incomplete without it." The bar for
> "differentiator" is "a senior reviewer nods approvingly and it's defensible in interview."
> The bar for "anti-feature" is "building it makes the submission worse."

## Feature Landscape

### Table Stakes (Reviewers Expect These)

Missing any of these makes the limiter feel incomplete or incorrect. No credit for having them;
penalty for missing.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Correct Token Bucket** | The canonical "burst-tolerant" algorithm; the headline of the chapter | MEDIUM | Lazy/deferred refill (see exact behavior below). Must handle fractional tokens via timestamp, capacity clamp, and `cost`-token requests. |
| **Correct Sliding Window Counter** | The "production sweet spot" algorithm; smooths the fixed-window boundary burst | MEDIUM | Weighted prev+current formula (see below). Memory-cheap (two counters), more accurate than fixed window. |
| **Correct Fixed Window Counter** | Baseline for comparison/discussion; demonstrates the boundary-burst problem | LOW | Simplest; intentionally included to *show* the 2x-burst flaw it has and that sliding window fixes. |
| **Single `RateLimiter` strategy interface** | All three algorithms must be interchangeable behind one contract | LOW | `consume(key, cost=1): Promise<Decision>`. Algorithm selection is config, not branching at call sites. |
| **Decision result contract** | Consumers (middleware, tests) need a structured verdict, not just a boolean | LOW | `{ allowed, limit, remaining, resetMs / resetAt, retryAfterMs }`. See contract section below. |
| **Key-agnostic core** | A limiter that hardcodes "IP" is not reusable; the core must not know what a key *means* | LOW | Core accepts an opaque string `key`. Key *extraction* (IP / API key / user id) lives in the adapter, not the algorithm. |
| **Pluggable `Store` interface** | In-memory for tests, Redis for distributed; algorithm must not depend on storage | MEDIUM | Store is the seam. Algorithm logic ideally lives in the store as an atomic op (Lua) for Redis — see architecture note. |
| **In-memory store** | Fast, dependency-free unit tests of algorithm correctness | LOW | Single-node `Map`. Should still be concurrency-correct within Node's single-threaded event loop (no awaited read-modify-write gaps). |
| **Redis store with atomic ops** | Distributed correctness — the whole point of "distributed" rate limiter | HIGH | Lua script does read-modify-write server-side in one round trip → no TOCTOU race across nodes. This is the technical centerpiece. |
| **Express middleware adapter** | The demonstrable HTTP integration | LOW | Extracts key, calls limiter, sets headers, returns `429` or `next()`. |
| **`429 Too Many Requests`** | The universally expected reject status | LOW | RFC 6585. Non-negotiable. |
| **`Retry-After` header on 429** | Standard, widely-honored signal of when to retry | LOW | Seconds (integer) or HTTP-date. Derive from reset time. |
| **Rate-limit headers** | Clients expect to see limit/remaining/reset | LOW–MEDIUM | See HTTP semantics section — emit current-draft `RateLimit` + `RateLimit-Policy` and/or legacy `X-RateLimit-*`. |
| **Config surface** | limit, window, algorithm must be configurable, not hardcoded | LOW | `{ algorithm, limit, windowMs, ... }`. Sensible defaults. |
| **Comprehensive tests incl. time + concurrency edges** | Explicit grading criterion; the Core Value | MEDIUM | Fake/controlled clock for refill & window-boundary tests; concurrent `consume` calls must not over-admit. Vitest. |

### Differentiators (Earn Senior-Engineer Credit)

These are where this submission stands out *without* tipping into overengineering. They map
directly to the challenge's "nice-to-haves: defensive design" and APOSD "deep modules".

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Configurable fail-open vs fail-closed** | Names the availability-vs-correctness tradeoff explicitly; senior signal | LOW | On store error/timeout, fail-open = allow (availability), fail-closed = deny (protect backend). Make it a config flag, document the default and why. |
| **Redis call timeouts** | An unbounded Redis call can hang every request → cascading outage | LOW | Per-command timeout on the limiter call; on timeout apply fail-open/closed policy. This is the single most credible "defensive design" point. |
| **Atomic Lua script (vs MULTI/WATCH)** | Eliminates read-modify-write races in one round trip; correct *and* fast | MEDIUM | Already table stakes for *correctness*, but doing it via a single well-commented Lua script (not a chatty client-side transaction) is the differentiator. Return decision values from the script. |
| **Injectable clock / time source** | Makes time-based behavior deterministically testable; also clean design | LOW | Algorithms take `now()` from a clock abstraction. Turns flaky timing tests into deterministic ones. High ROI for "comprehensive tests" grade. |
| **Right-sized ioredis connection config** | Shows production awareness without overbuilding | LOW | Single shared client, sane `connectTimeout`/`maxRetriesPerRequest`, `enableReadyCheck`. Don't build a pool manager — ioredis multiplexes one connection. |
| **Standards-correct headers (current IETF draft)** | Emitting `RateLimit` + `RateLimit-Policy` (draft-ietf-httpapi-ratelimit-headers) shows currency | LOW–MEDIUM | See HTTP section. Defensible: "I followed the IETF draft, kept legacy `X-RateLimit-*` for compatibility." |
| **Variable request cost** | `consume(key, cost)` lets one request weigh more than one token | LOW | Cheap to support in token bucket / counters; signals you understand quota semantics. Keep it optional (default 1). |
| **DESIGN.md trade-off narrative** | Explicitly required; the place to demonstrate understanding & defensibility | LOW | Algorithm tradeoffs, why Lua, fail-open/closed default, what was deliberately *not* built. This *is* graded. |
| **Lightweight structured logging on store failures** | Observability of the failure path without a metrics stack | LOW | Log Redis timeout/error + policy applied. Keep it to a thin logger interface, no log framework lock-in. |

### Anti-Features (Seem Good, Make This Submission Worse)

These are the "AI slop" / overengineering traps. Documenting them prevents scope creep AND
gives you defensible "I deliberately did not build X because Y" answers in interview.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Admin UI / dashboard** | "Operators need visibility" | Massive surface, zero relevance to limiter correctness; pure slop | Logs + headers + DESIGN.md. None needed for a library. |
| **Dynamic per-tenant rule engine** | "Real systems have different limits per customer" | A config/DSL evaluator is a whole project; balloons complexity | Per-key config can be supplied by the caller via a simple options resolver if ever needed — not a rule engine. |
| **Multiple coordination backends** (Memcached, DynamoDB, gossip, etc.) | "Be storage-agnostic" | The `Store` interface already proves pluggability; more backends = more untested code | One in-memory + one Redis store. The *interface* is the demonstration. |
| **Leaking bucket + sliding-window-log** | "Cover all the algorithms" | Already deferred in PROJECT.md; three algorithms span the tradeoff space; more = noise | Discuss them in DESIGN.md as "considered, deferred because the chosen three already show the tradeoffs." |
| **Distributed consensus / cluster coordination** (Raft, gossip, leader election) | "Distributed means consensus" | Redis already provides the shared atomic state; consensus is wildly out of scope for a prototype | Redis as the single source of truth. Note approximate-counting tradeoffs in DESIGN.md. |
| **Persistence / durability of counters** | "Don't lose state on restart" | Rate-limit state is intentionally ephemeral; persistence adds complexity for ~zero value (windows are seconds) | Counters live in Redis (with TTL) or memory; on loss, worst case is one window of leniency. State this explicitly. |
| **Auth / API-gateway features** (JWT, routing, quotas-as-billing) | "Limiters live in gateways" | Scope explosion; not rate limiting | Keep the surface to limiting. Key extraction is the only auth-adjacent concern, and it's pluggable. |
| **Self-tuning / ML "adaptive" limits** | "Smart limits" | Textbook AI-slop red flag; unverifiable, untestable, indefensible | Static configured limits. Predictability is a feature. |
| **Custom connection pool manager** | "Production needs pooling" | ioredis already multiplexes a single connection; a hand-rolled pool is wrong *and* overengineered | Configure one ioredis client correctly. |
| **Per-algorithm bespoke public APIs** | "Each algorithm is different" | Breaks the single-interface elegance the challenge rewards | One `RateLimiter` interface; differences hidden inside the implementation (deep module). |

## Exact Algorithm Behavior (write tests against these)

### Token Bucket — lazy (deferred) refill
State per key: `{ tokens: number, lastRefillMs: number }`. Config: `capacity` (max tokens =
max burst), `refillRatePerSec` (sustained throughput).

On `consume(key, cost=1)` at time `now`:
1. `elapsedSec = (now - lastRefillMs) / 1000`
2. `tokens = min(capacity, tokens + elapsedSec * refillRatePerSec)` — fractional tokens allowed; do not round here
3. `lastRefillMs = now`
4. If `tokens >= cost`: `tokens -= cost`, `allowed = true`
5. Else: `allowed = false` (do not subtract)
6. `remaining = floor(tokens)`; `retryAfter` for a denied request = `ceil((cost - tokens) / refillRatePerSec)` seconds

Testable invariants:
- Fresh bucket starts full (`capacity` tokens) → allows a burst of `capacity` immediately.
- After draining, exactly `refillRatePerSec` tokens regenerate per second (lazy, no background timer).
- Tokens never exceed `capacity` (clamp on refill).
- Fractional time is not lost (timestamp preserves the remainder).
- N concurrent `consume` calls when only K tokens remain admit exactly K (atomicity).

### Sliding Window Counter — weighted approximation
State per key: counters for the current and previous fixed windows of length `windowMs`.
Config: `limit`, `windowMs`.

On `consume` at `now`:
1. `windowStart = floor(now / windowMs) * windowMs`; `elapsedInWindow = now - windowStart`
2. `weight = (windowMs - elapsedInWindow) / windowMs` (fraction of previous window still "in view"; ranges 1→0 across the window)
3. `estimated = previousCount * weight + currentCount`
4. If `estimated + cost <= limit`: increment `currentCount`, `allowed = true`; else `allowed = false`
5. `remaining = max(0, floor(limit - (estimated + (allowed ? cost : 0))))`

Testable invariants (worked example): `windowMs=60_000`, `limit=100`, `previousCount=80`,
45s into the new window with `currentCount=50` → `weight=(60000-45000)/60000=0.25` →
`estimated = 80*0.25 + 50 = 70`; a request is allowed (70 < 100). At window rollover the
current count becomes the previous count and the new current resets to 0. No abrupt 2x burst
at the boundary (this is the property that distinguishes it from fixed window).

### Fixed Window Counter — and its known flaw
State per key: `{ count, windowStart }`. Config: `limit`, `windowMs`.

On `consume` at `now`:
1. If `now >= windowStart + windowMs`: reset `count = 0`, `windowStart = floor(now/windowMs)*windowMs`
2. If `count + cost <= limit`: `count += cost`, `allowed = true`; else `allowed = false`
3. `remaining = max(0, limit - count)`; `resetAt = windowStart + windowMs`

Testable invariant (the deliberate flaw to demonstrate): up to `limit` requests in the last
instant of one window and `limit` more in the first instant of the next → up to `2 * limit`
requests in a sub-window straddling the boundary. Tests should assert this boundary burst is
*possible* with fixed window and *not* possible with sliding window counter — that contrast is
the pedagogical point of including fixed window at all.

## Decision / Limiter Contract

The limiter returns a structured decision, not a bare boolean. Standard shape consumers expect
(aligns with `express-rate-limit`'s `RateLimitInfo` and the IETF fields):

```
interface RateLimitDecision {
  allowed: boolean;     // pass or reject
  limit: number;        // the configured quota for this key/window
  remaining: number;    // whole units left (floor); 0 when denied at the cap
  resetMs: number;      // ms until the window/bucket replenishes enough to allow again
  // derived for HTTP:   retryAfterSec = ceil(resetMs / 1000) when !allowed
}
```

Keeping `resetMs` relative (not an absolute Date) inside the core keeps it transport- and
clock-agnostic; the adapter converts to `Retry-After` seconds and reset epoch as needed.

## HTTP Semantics (what the middleware emits)

- **Reject:** `429 Too Many Requests` (RFC 6585) + `Retry-After: <seconds>` derived from the decision.
- **Current IETF draft headers** (`draft-ietf-httpapi-ratelimit-headers`, v11 as of 2026, Standards Track, not yet an RFC): the spec consolidated from three separate `RateLimit-*` headers into a single structured **`RateLimit`** field plus a **`RateLimit-Policy`** field. `express-rate-limit` exposes this via `standardHeaders: 'draft-6' | 'draft-7' | 'draft-8'`.
  - Recommended: emit the current-draft `RateLimit` + `RateLimit-Policy` (target draft-8 shape) **and** keep legacy `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` for broad client compatibility. This is a clean, defensible "I tracked the standard but didn't break legacy clients" decision for DESIGN.md.
- **Headers belong on success responses too** (not only 429) so clients can self-throttle — the draft explicitly allows `RateLimit` fields on successful responses.
- Keep header *formatting* in the adapter; the core returns numbers, not header strings.

## Feature Dependencies

```
RateLimiter interface
    └──requires──> Decision contract (return shape)
    └──requires──> Store interface
                       ├──implemented by──> In-memory store ──enables──> fast algorithm unit tests
                       └──implemented by──> Redis store ──requires──> Atomic Lua script ──enables──> distributed correctness

Express middleware adapter
    └──requires──> RateLimiter interface
    └──requires──> Key extraction (IP / API key / user)  [adapter-only, NOT in core]
    └──requires──> HTTP header + 429 mapping
    └──enhanced-by──> Retry-After (from Decision.resetMs)
    └──enhanced-by──> RateLimit / RateLimit-Policy headers

Redis store
    └──enhanced-by──> Redis call timeout ──enables──> fail-open/fail-closed policy
    └──enhanced-by──> Injectable clock (also enhances all 3 algorithms' tests)

Fail-open/closed policy ──depends-on──> store error/timeout signal
Injectable clock ──enhances──> Token Bucket, Sliding Window, Fixed Window (deterministic time tests)
```

### Dependency Notes
- **Algorithms require the Store interface, not Redis directly:** keeps the core testable in-memory and lets the Redis-specific atomicity (Lua) live behind the seam.
- **Distributed correctness requires the atomic Lua script:** a client-side read-then-write across nodes races; the script collapses it to one server-side operation.
- **Fail-open/closed depends on a timeout/error signal:** you can only choose a policy if the Redis call is bounded; timeout is the prerequisite, the policy is the response.
- **Injectable clock enhances every algorithm's tests:** all three are time-driven; a controllable clock converts flaky timing tests into deterministic assertions and is the highest-ROI testability investment.
- **Key extraction enhances the adapter, never the core:** the core stays key-agnostic so the same limiter serves IP, API-key, and user-id limiting unchanged.

## MVP Definition

### Launch With (v1 — the submission)
- [ ] `RateLimiter` interface + `Decision` contract — the elegant single-seam design being graded
- [ ] Token Bucket, Sliding Window Counter, Fixed Window — the three required algorithms, correct per the behaviors above
- [ ] `Store` interface + in-memory store — testability
- [ ] Redis store with atomic Lua script — distributed correctness (the centerpiece)
- [ ] Redis call timeout + configurable fail-open/closed — the defensive-design differentiator
- [ ] Injectable clock — deterministic time tests
- [ ] Express middleware: key extraction, `429`, `Retry-After`, rate-limit headers
- [ ] Comprehensive Vitest suite incl. refill, window-boundary, and concurrency over-admission tests
- [ ] Demo HTTP server + Docker + docker-compose (app + Redis)
- [ ] DESIGN.md: tradeoffs, why Lua, fail-open/closed default, what was deliberately not built

### Add After Validation (would only matter beyond the challenge)
- [ ] Variable request `cost` weighting — add if a consumer needs non-uniform quota
- [ ] Per-key/per-route config resolver (simple function, NOT a rule engine) — if real multi-limit need appears
- [ ] Metrics counters (allowed/denied/store-errors) — if observability is requested

### Future Consideration (out of scope, name in DESIGN.md only)
- [ ] Sliding window log / leaking bucket — only if exact accuracy is required; deferred deliberately
- [ ] Alternate stores — only if Redis is genuinely unavailable in the target env

## Feature Prioritization Matrix

| Feature | User/Grader Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Three correct algorithms | HIGH | MEDIUM | P1 |
| `RateLimiter` + `Store` interfaces | HIGH | LOW | P1 |
| Decision contract | HIGH | LOW | P1 |
| In-memory store | HIGH | LOW | P1 |
| Redis store + atomic Lua | HIGH | HIGH | P1 |
| Concurrency + time tests | HIGH | MEDIUM | P1 |
| Express middleware + 429 + Retry-After | HIGH | LOW | P1 |
| Rate-limit headers (IETF + legacy) | MEDIUM | LOW | P1 |
| Redis timeout + fail-open/closed | HIGH | LOW | P1 |
| Injectable clock | MEDIUM | LOW | P1 |
| Docker + compose + demo server | MEDIUM | LOW | P1 |
| DESIGN.md tradeoff narrative | HIGH | LOW | P1 |
| Variable request cost | LOW | LOW | P2 |
| Structured logging on failures | MEDIUM | LOW | P2 |
| Admin UI / rule engine / extra backends | NEGATIVE | HIGH | P3 (do not build) |

## Competitor Feature Analysis

| Feature | express-rate-limit | rate-limiter-flexible | Our Approach |
|---------|--------------------|-----------------------|--------------|
| Algorithms | Fixed window (single) | Token-bucket-ish + variants, many stores | Three algorithms (token bucket, sliding window counter, fixed window) behind one interface — explicit tradeoff demonstration |
| Stores | Pluggable store API, many community stores | Redis/Memcached/Mongo/process/cluster | In-memory + Redis only; interface proves pluggability without backend sprawl |
| Headers | `standardHeaders: draft-6/7/8` + legacy | Exposes limit/remaining/reset for caller to map | Emit current IETF `RateLimit`/`RateLimit-Policy` + legacy `X-RateLimit-*` |
| Atomicity | Delegated to store | Atomic increments / Lua per store | Hand-written, well-commented Lua script — the centerpiece, defensible line-by-line |
| Failure policy | Store-dependent | `insuranceLimiter` / block strategies | Explicit, simple, configurable fail-open vs fail-closed with a documented default |
| Surface | Middleware-first | Large, feature-rich library | Deliberately small, deep modules (APOSD); breadth lives in DESIGN.md discussion, not code |

## Sources

- [IETF: draft-ietf-httpapi-ratelimit-headers (RateLimit + RateLimit-Policy, v11, Standards Track)](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) — HIGH
- [express-rate-limit configuration (standardHeaders draft-6/7/8, RateLimitInfo shape)](https://express-rate-limit.mintlify.app/reference/configuration) — HIGH
- [express-rate-limit (npm / GitHub)](https://github.com/express-rate-limit/express-rate-limit) — HIGH
- [Token bucket lazy/interval refill semantics (RD Blog)](https://rdiachenko.com/posts/arch/rate-limiting/token-bucket-algorithm/) — MEDIUM
- [Sliding window counter weighted formula (RD Blog)](https://rdiachenko.com/posts/arch/rate-limiting/sliding-window-algorithm/) — MEDIUM
- [Sliding window counter weighted-formula worked example (Medium)](https://medium.com/@avocadi/rate-limiter-sliding-window-counter-7ec08dbe21d6) — MEDIUM
- [Rate limiting algorithms overview (AlgoMaster)](https://blog.algomaster.io/p/rate-limiting-algorithms-explained-with-code) — MEDIUM
- *System Design Interview Vol 1*, Ch. 4 (Alex Xu) — the source design this challenge is based on (per PROJECT.md) — HIGH (project-authoritative)
- RFC 6585 (429 Too Many Requests) — HIGH

---
*Feature research for: distributed rate limiter (coding-challenge deliverable)*
*Researched: 2026-06-23*
