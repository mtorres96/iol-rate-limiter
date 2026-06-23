# Phase 1: Core, Algorithms & In-Memory Reference - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

The framework-agnostic core of the rate limiter: the `RateLimiter` / `Decision`
/ `Store` / `Clock` interfaces and three interchangeable algorithms (Token
Bucket, Sliding Window Counter, Fixed Window Counter) proven correct against an
**in-memory** store using a deterministic `FakeClock` (no real sleeps). All code
lives under `/rate-limiter` and `tsc --noEmit` passes on a clean checkout.

**Not this phase:** Redis/Lua store and defensive timeout/fail-open-closed
behavior (Phase 2), Express middleware + HTTP semantics (Phase 3), demo
server/Docker/DESIGN.md (Phase 4). The conformance suite (TEST-02) is authored
in Phase 2 — but Phase 1's design decisions below are made specifically so that
suite can later assert TS↔Lua parity.

</domain>

<decisions>
## Implementation Decisions

### Reject & cost semantics (the observable `Decision` contract)
- **D-01: All-or-nothing consumption.** If the full `cost` can't be admitted,
  `consume` consumes **nothing** and returns `allowed: false`. State is untouched
  on rejection. Keeps algorithms pure and makes the exact-limit concurrency guard
  clean (exactly `limit` admitted, no partial draining).
- **D-02: `cost > capacity` rejects gracefully — never throws.** A call that can
  never be satisfied (e.g. `cost=10`, `capacity=5`) returns `allowed: false`
  without consuming, with `retryAfterMs` reported as the full refill/window-reset
  time (best-effort) and `remaining` = current remaining. `consume` stays total
  (no exceptions, no clamping). Caller's responsibility to fix the cost.
- **D-03: `retryAfterMs` (rejections).** Token Bucket = ms until enough tokens
  refill to cover `cost`; windows = ms until the window resets enough to admit.
- **D-04: `remaining` is floored to an integer.** `remaining = Math.floor(tokens)`
  for Token Bucket (windows are already integer-counted). Satisfies HTTP-03's
  integer-remaining requirement; the precise fractional token count stays internal
  to the store and never appears in the public `Decision`.
- **D-05: `resetMs` (allowed responses) = time until full replenishment.** Bucket
  back to `capacity` (tokens-needed / refill-rate), or the current window /
  sliding-window fully elapsed. Maps cleanly to `X-RateLimit-Reset` in Phase 3.

### Store shape & where the algorithm math lives
- **D-06: The algorithm math lives INSIDE each Store op.** Each op IS the
  algorithm — e.g. `MemoryStore.tokenBucket(key, cfg, cost, now)` computes
  refill + decision + new-state **atomically** and returns the result. This is
  the single atomic unit per algorithm (satisfies CORE-04) and the deep module
  (APOSD). Phase 2's Lua script becomes a near line-by-line port of the
  MemoryStore op, and TEST-02 conformance guards the TS↔Lua parity.
- **D-07: `RateLimiter` is a thin wrapper per algorithm.** One class per
  algorithm — `TokenBucketLimiter`, `SlidingWindowLimiter`, `FixedWindowLimiter`
  — each implementing `RateLimiter`, constructed with `(store, config)`, holding
  config and delegating to exactly one named Store op. Explicit polymorphism,
  trivially interchangeable (ALGO-04). A `createLimiter(...)` factory may be
  added later as thin convenience but is NOT the primary surface.
- **D-08: Store ops return a primitive numeric tuple, not a `Decision`.** Shape:
  `[allowed (0|1), remaining, resetMs, retryAfterMs]`. The limiter (which knows
  `limit` from its own config) assembles the public `Decision`. This is exactly
  what a Lua `EVAL` can return, so MemoryStore and RedisStore return **identical**
  tuples and the conformance suite compares them with zero representation
  mismatch.
- **D-09: Integer milliseconds at the op boundary; fractional state stays
  internal.** All durations crossing the Store boundary are integer ms (Lua-safe,
  no float drift across EVAL). Fractional token counts live only inside the
  store's persisted state (a float in memory; a string/scaled-int in Redis later)
  and never appear in the returned tuple.

### Configuration surface (public API)
- **D-10: Token Bucket config = `{ capacity, refillPerInterval, intervalMs }`.**
  "`refillPerInterval` tokens added every `intervalMs`." Capacity = burst size,
  kept distinct from steady rate. Lazy refill = `tokens += (elapsed / intervalMs)
  * refillPerInterval`, clamped to `capacity`.
- **D-11: Both window algorithms config = `{ limit, windowMs }`.** Symmetric
  shape for Fixed and Sliding Window — same config, different boundary behavior —
  making the DESIGN.md comparison apples-to-apples.
- **D-12: `Decision.limit` field** = `capacity` for Token Bucket, `limit` for the
  two windows. (Derived, recorded to avoid ambiguity.)

### Sliding Window Counter precision
- **D-13: Admit when `floor(estimate) + cost <= limit`.** Estimate = `curr +
  prev * (overlap fraction of previous window)`. Floor the weighted estimate
  before comparing (conventional, slightly permissive; the prev-window term is an
  approximation anyway) and compare with `<=` so the limiter admits exactly up to
  `limit`. Keeps integer accounting consistent with the floored `remaining`.
- **D-14: Pinned worked example (tests + DESIGN.md): Xu's book example.**
  `limit = 7` per `60s`; previous window had 5 requests, current window has 3,
  and we are 30s (50%) into the current window. Estimate = `3 + 5*0.5 = 5.5` →
  floor 5; a new request (`cost 1`) gives `6 <= 7` → **admit**. Directly
  traceable to *System Design Interview, Vol 1* Ch. 4, which the challenge is
  based on.

### Claude's Discretion
- **Build output:** ESM-only is acceptable per CLAUDE.md (skip the CJS half of
  tsup) unless a downstream need for CJS appears. Planner/executor may decide.
- **Config validation:** validate config at limiter/store construction time
  (e.g. reject non-positive `capacity`/`limit`/`windowMs`/`intervalMs`). Strategy
  (throw vs. assert) is implementation detail.
- **Fixed Window boundary-burst:** the known 2×-at-the-boundary burst is REQUIRED
  behavior to exhibit and document (ALGO-03, Success Criterion 3), not a bug —
  demonstrate it explicitly in a FakeClock test and explain it in DESIGN.md.
- **FakeClock mechanics:** `now()` returns integer ms; advancing is manual
  (`tick(ms)` / `setTime(ms)`), no real timers. Exact API is implementation
  detail as long as it injects via the `Clock` interface (CORE-03).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & scope (this repo)
- `.planning/REQUIREMENTS.md` — CORE-01..05, ALGO-01..04, STOR-01, TEST-01,
  DELIV-05 are the locked Phase 1 requirements. The `Decision` field list and the
  "one algorithm-shaped atomic op per algorithm" rule originate here.
- `.planning/ROADMAP.md` §"Phase 1" — goal + 4 success criteria (the verification
  contract for this phase).
- `.planning/PROJECT.md` — Core Value (correct under concurrency + comprehensively
  tested), APOSD / anti-slop grading posture, Key Decisions table.

### Stack & conventions (this repo)
- `CLAUDE.md` — pinned stack (Node 24, TS ~5.9, Vitest ^4.1, tsup, ESLint flat
  config), the "Testing time + concurrency (prescriptive)" guidance (inject a
  `now: () => number` clock; fire N overlapping `Promise.all` and assert exactly
  `limit` admitted), and the "What NOT to Use" list (no `ioredis-mock`, no
  off-the-shelf limiter, ESM authoring → tsup dual/`.d.ts`).

### Source material
- `iol-challenge-actualizado (1).pdf` (repo root) — the challenge brief.
- *System Design Interview — An Insider's Guide, Vol 1* (Alex Xu), Ch. 4 "Design
  a Rate Limiter" — source for the algorithms and the pinned Sliding Window worked
  example (D-14). External book, not in repo.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield. No source code exists yet; repo contains only `.planning/`,
  `CLAUDE.md`, and the challenge PDF. Phase 1 also bootstraps the `/rate-limiter`
  package scaffolding (package.json, tsconfig, tsup, Vitest, ESLint) needed for
  the build-green gate.

### Established Patterns
- None established in code yet. Conventions are prescribed by `CLAUDE.md` (stack
  pins, ESM authoring, prescriptive testing posture) — treat that as the pattern
  source until code exists.

### Integration Points
- The `RateLimiter` interface is the seam Phase 3's Express middleware depends on
  (parallelizable after Phase 1). The `Store` interface + primitive-tuple op
  contract (D-08/D-09) is the seam Phase 2's RedisStore + conformance suite
  depends on. Keep the core free of any Express/ioredis import.

</code_context>

<specifics>
## Specific Ideas

- Mirror Alex Xu's Ch. 4 Sliding Window numbers exactly in a test and in
  DESIGN.md (D-14) for reviewer recognizability.
- The MemoryStore op is intended to read as the "reference implementation" — the
  human-readable spec that the Phase 2 Lua script is a port of. Optimize it for
  clarity over cleverness (APOSD deep module).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 1 scope. (Redis/Lua, defensive
timeout/fail-open-closed, Express/HTTP headers, demo/Docker/DESIGN.md remain in
their roadmap phases. Variable `cost` exposed through middleware and
logging/metrics are tracked as v2 in REQUIREMENTS.md.)

</deferred>

---

*Phase: 1-Core, Algorithms & In-Memory Reference*
*Context gathered: 2026-06-23*
