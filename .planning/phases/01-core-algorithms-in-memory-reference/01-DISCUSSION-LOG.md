# Phase 1: Core, Algorithms & In-Memory Reference - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 1-Core, Algorithms & In-Memory Reference
**Areas discussed:** Reject & cost semantics, Store shape & where math lives, Config surface / API, Sliding Window precision

---

## Reject & cost semantics

### Q1 — Consumption contract on rejection
| Option | Description | Selected |
|--------|-------------|----------|
| All-or-nothing | If full cost can't be admitted, consume nothing; state untouched; clean concurrency guard | ✓ |
| Partial consume allowed | Admit what you can, drain to 0, still reject; leaks state, muddies guarantee | |

### Q2 — cost > capacity (can never succeed)
| Option | Description | Selected |
|--------|-------------|----------|
| Reject, retryAfterMs as if reset | allowed:false, no consume, retryAfterMs=full reset, never throws | ✓ |
| Throw / validation error | Treat as programming error; makes consume() non-total | |
| Clamp cost to capacity | Silently min(cost, capacity); hides bugs | |

### Q3 — `remaining` reporting (fractional tokens)
| Option | Description | Selected |
|--------|-------------|----------|
| Floor to integer | remaining = Math.floor(tokens); satisfies HTTP-03; fractional stays internal | ✓ |
| Expose raw fractional | Report tokens as-is; violates integer requirement | |

### Q4 — `resetMs` meaning on allowed responses
| Option | Description | Selected |
|--------|-------------|----------|
| Time until full replenish | Bucket back to capacity / window fully elapsed; maps to X-RateLimit-Reset | ✓ |
| Time until +1 unit available | ms until one more slot frees; less standard for Reset header | |

**User's choice:** All recommended options.
**Notes:** Establishes the full observable Decision contract for allowed and rejected paths.

---

## Store shape & where math lives

### Q1 — Where the algorithm math lives
| Option | Description | Selected |
|--------|-------------|----------|
| Inside the Store op | Op IS the algorithm; atomic; Lua becomes a port; conformance guards parity (APOSD deep module) | ✓ |
| Limiter owns math, store persists state | Breaks "one atomic op per algorithm"; reintroduces read-modify-write race | |

### Q2 — How algorithms are exposed
| Option | Description | Selected |
|--------|-------------|----------|
| One class per algorithm | TokenBucketLimiter / SlidingWindowLimiter / FixedWindowLimiter; explicit polymorphism | ✓ |
| Single limiter + strategy enum | One class with switch; shallower, muddies per-algorithm config typing | |
| Factory function | createLimiter(...); ergonomic but hides types; can be added later | |

### Q3 — Store op return shape
| Option | Description | Selected |
|--------|-------------|----------|
| Primitive numeric tuple | [allowed, remaining, resetMs, retryAfterMs]; exactly what Lua returns; identical across stores | ✓ |
| Full Decision object | Op returns whole Decision; RedisStore must rebuild from Lua array → divergent contracts | |

### Q4 — Units at the boundary
| Option | Description | Selected |
|--------|-------------|----------|
| Integer ms, fractional state internal | No floats cross EVAL; deterministic conformance | ✓ |
| Allow floats across boundary | Simpler TS, invites TS↔Lua rounding divergence | |

**User's choice:** All recommended options.
**Notes:** Most consequential structural area — designed specifically so Phase 2's
Lua scripts are a faithful port of the MemoryStore ops and TEST-02 conformance is exact.

---

## Config surface / API

### Q1 — Token Bucket config shape
| Option | Description | Selected |
|--------|-------------|----------|
| {capacity, refillPerInterval, intervalMs} | Explicit; separates burst from rate; obvious lazy-refill math | ✓ |
| {capacity, refillRatePerSec} | Compact; awkward for per-minute/hour limits | |
| {capacity, refillRatePerMs} | Most fundamental but least human-readable | |

### Q2 — Window algorithms config shape
| Option | Description | Selected |
|--------|-------------|----------|
| {limit, windowMs} | Symmetric for Fixed & Sliding; apples-to-apples DESIGN.md comparison | ✓ |
| {limit, windowSec} | Friendlier but inconsistent with ms-everywhere boundary | |

**User's choice:** All recommended options.
**Notes:** Decision.limit derived as capacity (TB) / limit (windows) — recorded, not asked.

---

## Sliding Window precision

### Q1 — Admit test
| Option | Description | Selected |
|--------|-------------|----------|
| floor(estimate) + cost <= limit | Conventional, slightly permissive; integer-consistent with floored remaining | ✓ |
| estimate + cost <= limit (no floor) | Stricter; mixes float into admit decision | |
| floor(estimate) + cost < limit | Strict-less-than → off-by-one under-admission | |

### Q2 — Pinned worked example
| Option | Description | Selected |
|--------|-------------|----------|
| Xu's book example (7/min, 5 prev + 3 curr, 50% in → 5.5→5→admit) | Traceable to the source the challenge is based on | ✓ |
| Custom boundary-stress example | Targeted at rounding edge but less recognizable | |
| Both | Book example + extra boundary case; most thorough | |

**User's choice:** All recommended options.
**Notes:** Pins the weighting formula unambiguously for tests and DESIGN.md.

---

## Claude's Discretion
- Build output: ESM-only acceptable (skip CJS half of tsup) per CLAUDE.md.
- Config validation at construction time (reject non-positive numeric config).
- Fixed Window boundary-burst: REQUIRED behavior to demonstrate + document (not a bug).
- FakeClock mechanics: integer ms, manual advance, injected via Clock interface.

## Deferred Ideas
None — discussion stayed within Phase 1 scope. (Variable cost via middleware and
logging/metrics remain tracked as v2 in REQUIREMENTS.md.)
