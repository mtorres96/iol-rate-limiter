# Phase 2: Conformance Harness, Redis/Lua Store & Defensive Behavior - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

A distributed store that is **correct and resilient**. The same shared
conformance suite that pins the `Store` contract must pass against BOTH the
in-memory reference (`MemoryStore`) and a new atomic-Lua `RedisStore`. The Redis
store runs each algorithm's state mutation inside a single Lua script (registered
via ioredis `defineCommand`, auto-EVALSHA + NOSCRIPT fallback), receives `now` as
an argument (never `redis.call('TIME')`), sets key TTL inside the script, and
uses namespaced keys on a single shared client. Every Redis call is bounded by a
configurable timeout, wrapped by a **circuit breaker**, and governed by an
explicit, configurable **fail-open / fail-closed** policy. Proven against a real
Redis via `@testcontainers/redis`.

**Requirements covered:** STOR-02, STOR-03, STOR-04, STOR-05, DEF-01, DEF-02,
TEST-02, TEST-03, TEST-04, TEST-05.

**Not this phase:** Express middleware + HTTP semantics (Phase 3); demo server,
Docker, DESIGN.md (Phase 4). The DESIGN.md *content* about fail-open/closed
rationale and the considered-and-rejected degradation alternatives (see Deferred
Ideas) is WRITTEN in Phase 4, but the decisions are locked here.

</domain>

<decisions>
## Implementation Decisions

### Store interface: sync → async migration
- **D2-01: The `Store` interface becomes uniformly async.** All three ops return
  `Promise<OpTuple>` (was synchronous `OpTuple` in Phase 1). `MemoryStore` becomes
  trivially async (computes synchronously, returns a resolved promise) — the
  event-loop-atomicity guarantee from Phase 1 is UNCHANGED (still one synchronous
  read-modify-write per op, no `await` inside the critical section, no mutex). The
  three limiters already expose `async consume(...)`, so they just `await
  store.op(...)`. **One uniform contract, one code path** — the conformance suite
  runs `await store.op(...)` identically against both stores. Rejected the
  "separate `AsyncStore`" option (two contracts → drift risk, branchier suite).

### Numeric parity TS ↔ Lua (conformance correctness)
- **D2-02: Persist fractional Token-Bucket `tokens` as a `%.17g` string; rely on
  native double arithmetic.** Redis Lua (5.1) uses IEEE-754 doubles, same as JS,
  so the refill/decision math matches bit-for-bit GIVEN identical integer inputs
  (`now`, `lastRefill` are integer ms, passed in — never `TIME`). The only float
  is `tokens`; persisting it as a full-precision `%.17g` string makes the
  Redis→Lua→Redis round-trip exact. `MemoryStore` is left intact. Rejected
  "scale tokens to integers everywhere" — would force rewriting MemoryStore's
  refill math and re-anchoring the rounding contract (more invasive, no benefit
  since doubles already match).
- **D2-03: The Lua scripts are a near line-by-line port of the `MemoryStore` ops**
  (per Phase-1 D-06). The PINNED rounding contract MUST be reproduced exactly:
  `remaining`→`math.floor`, `resetMs`→`math.ceil`, `retryAfterMs`→`math.ceil`,
  `0` when allowed. Op return shape is the same `OpTuple`
  `[allowed(0|1), remaining, resetMs, retryAfterMs]` — exactly what `EVAL`
  returns — so both stores produce identical tuples (Phase-1 D-08).

### Defensive behavior (DEF-01 / DEF-02)
- **D2-04: Default policy is FAIL-OPEN, configurable to fail-closed.** On a Redis
  failure or timeout, ADMIT the request (a rate limiter must not take down the
  API when its store is unavailable — industry standard, matches Xu Ch.4). The
  policy is configurable per limiter/middleware; default documented as fail-open.
  No unhandled rejection — store errors are caught and resolved through the policy.
- **D2-05: A circuit breaker around Redis is MANDATORY in this phase, with its
  own tests.** After N consecutive failures the breaker opens for a cooldown and
  applies the configured policy WITHOUT attempting Redis (avoids piling up
  timeouts during an outage); it half-opens/probes to recover. This is part of the
  phase's "defensive behavior" domain and a stated PROJECT.md nice-to-have — not
  scope creep. Breaker thresholds/cooldown are configurable with documented
  defaults (planner picks concrete numbers).
- **D2-06: Configurable per-call Redis timeout, default in the 50–100ms band.**
  Local/same-network Redis answers in <5ms, so tens of ms detect slowness without
  penalizing the happy path and trip the policy/breaker quickly under degradation.
  Implemented via ioredis `commandTimeout` (and/or an explicit race) — configurable.

### Redis store specifics
- **D2-07: Key namespacing = `rl:{algo}:{key}`, prefix configurable.** Include the
  algorithm segment (e.g. `rl:tb:<clientKey>`, `rl:sw:...`, `rl:fw:...`) so the
  same client key under two different limiters never collides. `rl` is the
  configurable default prefix. Legible and debuggable.
- **D2-08: Single shared ioredis client; scripts registered via `defineCommand`**
  (auto-EVALSHA caching + NOSCRIPT→EVAL fallback). `now` is always passed as ARGV
  (never `redis.call('TIME')`) so tests stay deterministic and TS↔Lua parity
  holds. Each script sets the key TTL/expiry INSIDE the script (STOR-03).

### Testing (TEST-02..05)
- **D2-09: Fault injection uses real `@testcontainers/redis`, no client mocks.**
  For "Redis down": stop/pause the container (or disconnect). For "Redis slow":
  drive a `commandTimeout` breach. Both cases must be exercised against BOTH the
  fail-open and fail-closed policies AND the circuit breaker (TEST-05). Rejected
  stubbing the ioredis client — it wouldn't prove real network/timeout behavior.
- **D2-10: The conformance suite (TEST-02) is parametrized over `[MemoryStore,
  RedisStore]`**, drives identical `(key, cost, now)` sequences, and asserts
  identical `Decision`s. Authored before/with the Redis implementation so it
  defines the contract and catches TS↔Lua drift. The concurrency over-admission
  guard (TEST-04) runs against BOTH stores (real Redis burst admits exactly
  `limit`).

### Claude's Discretion
- **TTL sizing inside Lua (STOR-03):** planner/researcher pick concrete TTLs —
  guidance: Token Bucket ≈ time to fully refill from empty; windows ≈ ~2×
  `windowMs` (previous + current buckets must survive). Set inside the script.
- **Circuit-breaker concrete thresholds** (failure count, open duration,
  half-open probe) — sensible documented defaults, planner's call.
- **Timeout exact value** within the 50–100ms band — planner picks per the
  testcontainers setup.
- **Conformance harness exact shape** (sequence fixtures, helper structure) —
  research/planner decide; the contract (identical Decisions across stores) is
  locked.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & scope (this repo)
- `.planning/REQUIREMENTS.md` — STOR-02..05, DEF-01, DEF-02, TEST-02..05 are the
  locked Phase 2 requirements (exact wording of the atomic-Lua, `now`-as-arg,
  TTL-in-script, namespacing, timeout, fail-open/closed, conformance, and
  fault-injection contracts originate here). Also the **Out of Scope** table —
  "Additional storage backends" and "Persistence beyond Redis" — which is the
  basis for NOT building a Postgres/secondary-store fallback.
- `.planning/ROADMAP.md` §"Phase 2" — goal + 4 success criteria (the verification
  contract for this phase). Note the FLAGGED research item: lock per-algorithm Lua
  KEYS/ARGV layout, TTL sizing, return-tuple shape, and conformance-harness shape
  via `--research-phase` before writing scripts.
- `.planning/PROJECT.md` — Core Value (correctness under concurrency) and the
  nice-to-haves list (timeouts, circuit breakers) that justify D2-05.

### Phase 1 contracts the Lua port MUST honor
- `.planning/phases/01-core-algorithms-in-memory-reference/01-CONTEXT.md` —
  D-06 (algorithm math lives inside each Store op → Lua is a line-by-line port),
  D-08 (`OpTuple` shape), D-09 (integer ms at the boundary, fractional state
  internal), D-13/D-14 (sliding-window estimate + pinned Xu worked example).
- `rate-limiter/src/store/memory.ts` — the human-readable reference the Lua
  scripts port; the PINNED rounding contract (floor/ceil) is in its header
  comment and on every outgoing duration. Reproduce bit-for-bit.
- `rate-limiter/src/types.ts` — `Store`, `OpTuple`, `TBConfig`, `WindowConfig`,
  `Decision`. The `Store` interface is what D2-01 migrates to async.
- `rate-limiter/src/limiters/{token-bucket,sliding-window,fixed-window}.ts` —
  already `async consume(...)`; will `await` the async store ops.

### External tooling docs (consult during research)
- ioredis `defineCommand` (auto-EVALSHA + NOSCRIPT fallback), `commandTimeout` —
  per CLAUDE.md stack notes; fetch current docs via Context7 `/redis/ioredis`.
- `@testcontainers/redis` ^12 lifecycle (start/stop/pause) for TEST-03/04/05.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `rate-limiter/src/store/memory.ts` (`MemoryStore`): the reference impl whose
  three ops (`tokenBucket`/`slidingWindow`/`fixedWindow`) the Lua scripts port
  near line-by-line. Its rounding/refill math is the parity oracle.
- `rate-limiter/src/clock.ts` (`Clock`/`FakeClock`): `now` is injected and passed
  into ops; Redis scripts receive the same `now` as ARGV (deterministic, parity).
- Phase-1 test suites (`test/*.test.ts`) and the concurrency over-admission guard
  (`test/concurrency.test.ts`) are the template for the parametrized conformance
  and dual-store concurrency tests.

### Established Patterns
- **Event-loop atomicity, no mutex** (Phase 1): MemoryStore ops are one
  synchronous read-modify-write. The async migration (D2-01) must NOT introduce
  an `await` inside that critical section. Redis achieves the equivalent atomicity
  via single-Lua-script execution.
- **`OpTuple` numeric boundary** (D-08/D-09): integer ms cross the boundary;
  fractional token state stays internal. Lua returns the same tuple shape.
- **Config validated at construction** (`rate-limiter/src/validate.ts`): the
  Redis store / its config (prefix, timeout, policy, breaker thresholds) should
  validate the same way (throw on garbage).

### Integration Points
- The async `Store` migration touches `src/types.ts` (interface), `src/store/
  memory.ts` (return resolved promises), and the three limiters (`await`). The new
  `RedisStore` implements the same async interface. The timeout + policy + breaker
  layer lives in/around `RedisStore` (per the roadmap decision that defensive
  behavior lives inside RedisStore), not in the limiters.

</code_context>

<specifics>
## Specific Ideas

- **Parity is bit-for-bit, not approximate.** The whole point of TEST-02 is to
  catch TS↔Lua drift; `%.17g` persistence (D2-02) and the line-by-line port with
  identical floor/ceil (D2-03) are the mechanism.
- **Fail-open is the *default*, not the only mode** — the policy is a configurable
  knob (D2-04). The DESIGN.md (Phase 4) must explain the rationale.
- **DESIGN.md must include a "degradation strategies considered" section** (Phase
  4) covering fail-open / fail-closed / local-degraded / secondary distributed
  store (Postgres) / HA Redis, and why only the configurable policy + breaker were
  built. This is a graded judgment signal — see Deferred Ideas.

</specifics>

<deferred>
## Deferred Ideas

- **Postgres (or any) secondary-store fallback on Redis failure** — explicitly NOT
  built. Out of scope per REQUIREMENTS.md ("Additional storage backends",
  "Persistence beyond Redis — intentionally ephemeral") and an overengineering/
  AI-slop risk that the rubric penalizes. A correct secondary store would require
  re-implementing the 3 atomic algorithms in SQL and would diverge from Redis
  counts during failover (breaks the distributed-correctness Core Value). →
  **Document in DESIGN.md (Phase 4)** as an evaluated-and-rejected alternative.
- **Local in-memory degraded fallback (per-node `MemoryStore`)** — rejected as a
  default: per-node counts → over-admission (effective limit × node count), breaks
  the Core Value. → Mention in the DESIGN.md degradation section as best-effort
  soft-limiting only.
- **Token leasing / local budget reservation** — resilient but a complex,
  approximate lease protocol = overengineering for this challenge. → DESIGN.md note.
- **HA Redis (replica + Sentinel/Cluster)** — the real production answer to "Redis
  down", but it is infrastructure, not application code. → DESIGN.md note, not built.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.

</deferred>

---

*Phase: 2-Conformance Harness, Redis/Lua Store & Defensive Behavior*
*Context gathered: 2026-06-24*
