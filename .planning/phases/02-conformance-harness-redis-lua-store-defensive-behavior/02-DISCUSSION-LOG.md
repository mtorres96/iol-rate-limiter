# Phase 2: Conformance Harness, Redis/Lua Store & Defensive Behavior - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 2-Conformance Harness, Redis/Lua Store & Defensive Behavior
**Areas discussed:** Failure policy, Async Store interface, TS↔Lua numeric parity, Timeout + fault injection, Circuit breaker, Key namespacing
**Language:** Discussion conducted in Spanish at user's request.

---

## Failure policy (fail-open vs fail-closed) + Postgres fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Default fail-open | Admit on Redis failure/timeout; availability > strict enforcement; industry standard | ✓ |
| Default fail-closed | Deny (429/503) on failure; strict enforcement, couples availability to Redis | |
| Fallback to MemoryStore | Per-node local counting on outage — rejected (over-admission breaks Core Value) | |
| Implement Postgres fallback | Build a secondary SQL store — rejected (out of scope, overengineering/AI-slop) | |

**User's choice:** Default **fail-open**, configurable. Circuit breaker added as mandatory (separate question below).
**Notes:** User initially proposed a Postgres fallback ("put the DB inside the same postgres") and asked whether it was out of scope and whether it would earn points. Extended thinking-partner discussion: per the *original Xu brief* it's not explicitly forbidden, but per the project's OWN locked scope (REQUIREMENTS.md "Additional storage backends" / "Persistence beyond Redis") it IS out of scope, and the grading rubric explicitly penalizes overengineering/AI-slop — so a Postgres fallback would most likely COST points. A correct secondary store would require re-implementing the 3 atomic algorithms in SQL and would diverge from Redis counts during failover. Resolution: do NOT build it; document it (plus local-degraded, token-leasing, HA Redis) in DESIGN.md as evaluated-and-rejected degradation strategies — that captures the judgment signal the rubric rewards. User explicitly asked that the alternatives be marked in the final documentation as failure fallbacks.

---

## Circuit breaker

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, if it stays simple | Minimal breaker; planner decides if cost is low | |
| No, only timeout + policy | Keep phase focused; breaker as future doc note | |
| Yes, mandatory | Include breaker with its own tests as part of the deliverable | ✓ |

**User's choice:** **Mandatory** in Phase 2, with its own tests.
**Notes:** Justified as part of the "defensive behavior" phase domain and a stated PROJECT.md nice-to-have ("circuit breakers") — not scope creep. Concrete thresholds left to planner.

---

## Async Store interface

| Option | Description | Selected |
|--------|-------------|----------|
| Uniform async Store | All ops return `Promise<OpTuple>`; MemoryStore trivially async; limiters already async; one code path | ✓ |
| Separate async interface | Keep sync `Store` + separate `AsyncStore`; two contracts, branchier conformance suite | |

**User's choice:** **Uniform async Store.**
**Notes:** Event-loop atomicity from Phase 1 is preserved (no `await` inside the MemoryStore critical section).

---

## TS↔Lua numeric parity

| Option | Description | Selected |
|--------|-------------|----------|
| Float as `%.17g` string | Lua uses doubles like JS; full-precision string round-trip is exact; MemoryStore untouched | ✓ |
| Scale tokens to integers | Store tokens*FACTOR as int in both stores; eliminates floats but rewrites MemoryStore refill math | |
| Let research/planner decide | Capture parity requirement only, leave mechanism to research-phase | |

**User's choice:** **Float as `%.17g` string** (native double arithmetic, exact round-trip).
**Notes:** The Lua scripts are a near line-by-line port of MemoryStore; the pinned floor/ceil rounding contract must be reproduced bit-for-bit.

---

## Timeout default

| Option | Description | Selected |
|--------|-------------|----------|
| 50–100ms | Local Redis <5ms; tens of ms detect slowness without penalizing happy path; trips policy/breaker fast | ✓ |
| ~200ms+ | More tolerant of slow/remote Redis but adds perceptible latency under degradation | |
| Let research/planner decide | Fix requirement only, leave value to planner | |

**User's choice:** Default **50–100ms**, configurable (via ioredis `commandTimeout`).

---

## Key namespacing

| Option | Description | Selected |
|--------|-------------|----------|
| `rl:{algo}:{key}` | Configurable `rl` prefix + algorithm segment + key; avoids cross-algorithm collisions; debuggable | ✓ |
| `{prefix}:{key}` | No algorithm segment; shorter; assumes a key never crosses algorithms | |
| Let planner decide | Fix requirement only | |

**User's choice:** **`rl:{algo}:{key}`**, prefix configurable.

---

## Fault injection (TEST-05)

| Option | Description | Selected |
|--------|-------------|----------|
| testcontainers stop/pause | Stop/pause container for "down"; `commandTimeout` breach for "slow"; real, no mocks | ✓ |
| Mock/stub the client | Faster/deterministic stub but doesn't test real network/timeout behavior | |
| Let research/planner decide | Leave mechanism to research; fix only that down+slow × both policies + breaker must be covered | |

**User's choice:** **testcontainers stop/pause** (+ `commandTimeout` for slow), no client mocks.

---

## Claude's Discretion

- TTL sizing inside Lua scripts (guidance: TB ≈ full-refill time; windows ≈ ~2× windowMs).
- Concrete circuit-breaker thresholds (failure count, open duration, half-open probe).
- Exact timeout value within the 50–100ms band.
- Exact conformance-harness shape (sequence fixtures, helper structure) — contract is locked, mechanics are flexible.

## Deferred Ideas

- Postgres / secondary distributed-store fallback — NOT built; document in DESIGN.md as evaluated-and-rejected.
- Local in-memory degraded fallback (per-node) — rejected as default (over-admission); DESIGN.md note.
- Token leasing / local budget reservation — overengineering; DESIGN.md note.
- HA Redis (replica + Sentinel/Cluster) — infrastructure, not app code; DESIGN.md note.
