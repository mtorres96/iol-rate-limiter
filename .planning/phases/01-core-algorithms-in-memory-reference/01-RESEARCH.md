# Phase 1: Core, Algorithms & In-Memory Reference - Research

**Researched:** 2026-06-23
**Domain:** TypeScript pure-algorithm library design (rate-limiting algorithms), deterministic time testing (Vitest), ESM library scaffolding (tsup/tsconfig/ESLint flat)
**Confidence:** HIGH

## Summary

This is a **greenfield, pure-TypeScript, no-runtime-dependency** phase. The repo currently contains only `.planning/`, `CLAUDE.md`, and the challenge PDF — no `/rate-limiter` directory yet, so this phase also bootstraps the package scaffold. There is **zero genuine library-selection uncertainty**: CLAUDE.md pins the entire stack (Node 24, TS ~5.9, Vitest ^4.1, tsup ^8.5, ESLint 10 flat config) and CONTEXT.md (D-01..D-14) locks every algorithm and contract decision. All such decisions were re-verified against the npm registry on 2026-06-23 and match. The research value is therefore concentrated in the **five implementation-shaping questions** the orchestrator flagged: deterministic-time strategy, the JS-single-thread concurrency proof, the tsup/tsconfig gate, float/rounding portability for the Phase-2 Lua port, and the scaffold layout.

The single most consequential recommendation: **inject a `Clock` interface and hand-roll a `FakeClock` — do NOT use `vi.useFakeTimers()` for the algorithm/store tests.** The store is a synchronous pure function of `(state, cfg, cost, now)`; passing `now` explicitly is both the architecture CONTEXT.md mandates (CORE-03, D-09) and strictly more portable to Phase-2 Lua (where `now` arrives as an `ARGV`, never `redis.call('TIME')` per STOR-03). Vitest's global timer mocking is the right tool only if production code reads `Date.now()` implicitly — which, by design here, it never should.

**Primary recommendation:** Build a dependency-injected `Clock` + manual `FakeClock`; keep each algorithm as a single synchronous Store op returning the primitive tuple `[allowed, remaining, resetMs, retryAfterMs]` with all op-boundary durations as `Math.ceil`/`Math.floor`-rounded integer ms; scaffold `/rate-limiter` as an ESM-only tsup package with strict tsconfig gating `tsc --noEmit`.

## Architectural Responsibility Map

All capabilities in Phase 1 live in the **framework-agnostic core library tier** (no HTTP, no Redis, no Express). Internal sub-tiers:

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `RateLimiter.consume(key, cost?)` decision verb | Limiter (thin wrapper) | Store | D-07: limiter holds config, delegates to one named Store op, assembles `Decision` from the tuple |
| Algorithm math (refill/window/estimate) | Store op | — | D-06: each op IS the algorithm; the deep module / reference impl |
| Atomic per-algorithm mutation | Store op | — | D-06/STOR-01: one algorithm-shaped op, atomic via event loop |
| `Decision` assembly (`limit`, floored `remaining`) | Limiter | — | D-08/D-04: limiter knows `limit`; floors `remaining` |
| Time source | Clock (injected) | — | CORE-03/D-09: `now()` integer ms, `FakeClock` for tests |
| Key identity | opaque string passed through | — | CORE-05: core never parses keys; extraction is Phase-3 adapter only |
| Config validation | Limiter/Store constructor | — | CONTEXT "Claude's Discretion": reject non-positive numeric config at construction |

**Tier boundary to protect:** the core package must import **nothing** from Express or ioredis (CONTEXT integration-points note). The `Store` interface + primitive-tuple contract (D-08/D-09) is the seam Phase 2 fills; the `RateLimiter` interface is the seam Phase 3 consumes.

## Standard Stack

This phase is pure TS with **no production runtime dependencies** — the core library ships zero `dependencies`. Everything below is `devDependencies` for build/test/lint. All versions verified against npm on 2026-06-23.

### Core (dev tooling — verified)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| typescript | `~5.9` (pin; latest is 6.0.3) | Type emission + `tsc --noEmit` gate | `[VERIFIED: npm registry]` latest=6.0.3, but CLAUDE.md pins ~5.9 deliberately — `typescript-eslint@8.62` peer range is `>=4.8.4 <6.1.0`, so 5.9 is in-range and conservative `[VERIFIED: npm registry]` peer check |
| vitest | `^4.1` (verified 4.1.9) | Test runner, fake-time, watch, coverage | `[VERIFIED: npm registry]` `dist-tags.latest=4.1.9`. Native ESM+TS; `vi.useFakeTimers` available but see clock recommendation |
| @vitest/coverage-v8 | `4.1.9` (lockstep) | Coverage for core algorithms (grading signal) | `[VERIFIED: npm registry]` peerDependencies pins `vitest: 4.1.9` exactly — must match runner version |
| tsup | `^8.5` (verified 8.5.1) | Bundle ESM + `.d.ts` | `[VERIFIED: npm registry]` 8.5.1. **See flag below — README now recommends tsdown.** CLAUDE.md locks tsup; honor the lock |
| typescript-eslint | `^8.62` (verified 8.62.0) | TS-aware flat-config lint | `[VERIFIED: npm registry]` peer `eslint: ^8.57 || ^9 || ^10`, `typescript: >=4.8.4 <6.1.0` — confirms TS 5.9 + ESLint 10 combo |
| eslint | `^10.5` (verified 10.5.0) | Lint (flat config only) | `[VERIFIED: npm registry]` 10.5.0. ESLint 10 dropped legacy `.eslintrc` — `eslint.config.js` required |
| prettier | `^3.8` (verified 3.8.4) | Formatting | `[VERIFIED: npm registry]` 3.8.4 |
| eslint-config-prettier | `^10.1` (verified 10.1.8) | Disable conflicting ESLint stylistic rules | `[VERIFIED: npm registry]` 10.1.8 |
| @types/node | `^24` (latest is 26.0.0) | Node typings | `[VERIFIED: npm registry]` latest=26.0.0; CLAUDE.md pins `^24` to match the LTS runtime — correct |

### Supporting (optional this phase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | `^4.22` (verified 4.22.4) | Run TS without a build step | `[VERIFIED: npm registry]` 4.22.4. Useful for an ad-hoc `dev` script but **not required** for Phase 1 (no demo server until Phase 4). Defer unless a scratch script is wanted |

### Alternatives Considered (all rejected — locked by CLAUDE.md/CONTEXT)
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Injected `Clock` + `FakeClock` | `vi.useFakeTimers()` / `vi.setSystemTime()` | Global mocking works but is the wrong fit for a pure store that takes `now` as an argument; DI is cleaner and Lua-portable. See Pattern 2 + Pitfall 1 |
| tsup | tsdown (rolldown) | tsup README now recommends migrating to tsdown `[CITED: github.com/egoist/tsup README]`. **Do not switch** — CLAUDE.md locks tsup; flagged for awareness only |
| tsup | raw `tsc` two-config dual build | Acceptable for ESM-only, but tsup's single-config `dts:true` + sourcemaps is less footgun. CLAUDE.md prescribes tsup |
| Vitest | `node:test` / Jest | CLAUDE.md "What NOT to Use" — Vitest's fake-timer + watch/coverage DX wins; locked |
| Hand-written algorithms | `rate-limiter-flexible` / `express-rate-limit` | CLAUDE.md "What NOT to Use" — the challenge *is* to implement them; importing one is disqualifying slop |

**Installation (dev-only; core has no runtime deps):**
```bash
npm install -D typescript@~5.9 vitest@^4.1 @vitest/coverage-v8@^4.1 \
  tsup@^8.5 tsx@^4.22 \
  eslint@^10.5 typescript-eslint@^8.62 prettier@^3.8 eslint-config-prettier@^10.1 \
  @types/node@^24
```
*(Pin `@vitest/coverage-v8` to the exact same resolved version as `vitest` — its peer range is the exact version, not a caret.)*

## Package Legitimacy Audit

All packages are well-established, high-download, official-org tooling. slopcheck was not installed in this session (network-restricted research env); per protocol, registry existence was verified directly via `npm view` and all are mainstream packages with long histories and known source repos. None are obscure or newly-published.

| Package | Registry | Age | Source Repo | npm verify | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| typescript | npm | ~12 yrs | github.com/microsoft/TypeScript | latest 6.0.3, pin 5.9 | Approved |
| vitest | npm | est. ~4 yrs | github.com/vitest-dev/vitest | 4.1.9 ✓ | Approved |
| @vitest/coverage-v8 | npm | ~4 yrs | github.com/vitest-dev/vitest | 4.1.9 ✓ | Approved |
| tsup | npm | ~5 yrs (mod 2025-11-12) | github.com/egoist/tsup | 8.5.1 ✓ | Approved (see tsdown flag) |
| tsx | npm | est. ~3 yrs | github.com/privatenumber/tsx | 4.22.4 ✓ | Approved |
| eslint | npm | ~12 yrs | github.com/eslint/eslint | 10.5.0 ✓ | Approved |
| typescript-eslint | npm | ~6 yrs | github.com/typescript-eslint/typescript-eslint | 8.62.0 ✓ | Approved |
| prettier | npm | ~8 yrs | github.com/prettier/prettier | 3.8.4 ✓ | Approved |
| eslint-config-prettier | npm | ~8 yrs | github.com/prettier/eslint-config-prettier | 10.1.8 ✓ | Approved |
| @types/node | npm | DefinitelyTyped | github.com/DefinitelyTyped/DefinitelyTyped | 26.0.0, pin ^24 | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**No runtime `dependencies`** — the core library ships dep-free, which is itself a grading-positive (zero supply-chain surface in the shipped artifact).

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────┐
   consume(key, cost?)   │            RateLimiter               │
  ───────────────────────▶  (TokenBucket | SlidingWindow |     │
                         │   FixedWindow Limiter)               │
                         │  - holds config {capacity.../limit..}│
                         │  - reads now() from injected Clock ──┼──▶ Clock.now() : int ms
                         └───────────────┬─────────────────────┘     (FakeClock in tests)
                                         │ calls ONE named op
                                         │ store.tokenBucket(key, cfg, cost, now)
                                         ▼
                         ┌─────────────────────────────────────┐
                         │              Store (interface)       │
                         │  MemoryStore (this phase)            │
                         │  ┌─────────────────────────────────┐ │
                         │  │ per-algorithm atomic op:        │ │
                         │  │  1. load state for key (or init)│ │
                         │  │  2. apply algorithm math w/ now │ │
                         │  │  3. decide allow/reject (D-01)  │ │
                         │  │  4. write new state IF allowed  │ │
                         │  │  5. return primitive tuple      │ │
                         │  └─────────────────────────────────┘ │
                         │   state: Map<key, AlgoState>         │
                         └───────────────┬─────────────────────┘
                                         │ returns
                                         ▼
              [ allowed(0|1), remaining(int), resetMs(int), retryAfterMs(int) ]  (D-08)
                                         │
                                         ▼
              Limiter assembles Decision { allowed, limit, remaining, resetMs, retryAfterMs }  (D-12, D-04)
                                         │
                                         ▼
                              Promise<Decision>  (CORE-01)
```

The op (steps 1–5) is the unit that becomes a near line-by-line Lua port in Phase 2 (D-06). It is synchronous internally; `consume` is `async` only to satisfy the `Promise<Decision>` interface (CORE-01) — a memory store resolves immediately.

### Recommended Project Structure
```
/rate-limiter
├── package.json              # "type":"module", exports map, dev deps only
├── tsconfig.json             # strict; noEmit for the gate; bundler resolution
├── tsup.config.ts            # ESM-only, dts:true, sourcemap, clean
├── eslint.config.js          # flat config (tseslint.config(...))
├── .prettierrc               # or prettier in package.json
├── vitest.config.ts          # globals/env node, coverage v8
├── .nvmrc                    # 24
├── src/
│   ├── index.ts              # public barrel: interfaces + 3 limiters + MemoryStore + Clock/FakeClock
│   ├── types.ts              # RateLimiter, Decision, Store, Clock interfaces + config types
│   ├── clock.ts              # SystemClock (Date.now) + FakeClock
│   ├── store/
│   │   └── memory.ts         # MemoryStore: tokenBucket/slidingWindow/fixedWindow ops (D-06)
│   └── limiters/
│       ├── token-bucket.ts   # TokenBucketLimiter
│       ├── sliding-window.ts # SlidingWindowLimiter
│       └── fixed-window.ts   # FixedWindowLimiter
└── test/
    ├── token-bucket.test.ts      # refill, burst, cost, exact-limit, cost>capacity
    ├── sliding-window.test.ts    # Xu Ch.4 worked example (D-14), rollover, estimate floor
    ├── fixed-window.test.ts      # window rollover + documented boundary-burst (ALGO-03)
    └── concurrency.test.ts       # N overlapping Promise.all → exactly limit (TEST-04 memory half)
```
*(`test/` colocated-vs-separate is discretionary; separate `test/` keeps `src` clean. Whichever the planner picks, keep it consistent.)*

### Pattern 1: Algorithm-as-Store-op returning a primitive tuple (D-06, D-08)
**What:** Each algorithm's entire computation — load state, refill/window math, all-or-nothing decision, conditional state write — lives in one synchronous Store method that returns `[allowed, remaining, resetMs, retryAfterMs]`. The limiter wraps it and builds the `Decision`.
**When to use:** Always, for all three algorithms. This is the locked architecture.
**Example (Token Bucket op — reference shape, Lua-portable):**
```typescript
// Source: derived from D-06/D-08/D-10/D-04; Alex Xu Ch.4 token-bucket [ASSUMED algorithm math, CITED structure]
// MemoryStore.tokenBucket(key, cfg, cost, now) — cfg: {capacity, refillPerInterval, intervalMs}
type TBState = { tokens: number; lastRefill: number };
type OpTuple = [allowed: 0 | 1, remaining: number, resetMs: number, retryAfterMs: number];

function tokenBucket(state: TBState | undefined, cfg: TBConfig, cost: number, now: number): { tuple: OpTuple; next: TBState } {
  const s = state ?? { tokens: cfg.capacity, lastRefill: now };
  // lazy refill (D-10): fractional, internal only
  const elapsed = Math.max(0, now - s.lastRefill);
  const refilled = Math.min(cfg.capacity, s.tokens + (elapsed / cfg.intervalMs) * cfg.refillPerInterval);

  const allowed = cost <= refilled ? 1 : 0;                  // all-or-nothing (D-01); cost>capacity → 0, no throw (D-02)
  const tokensAfter = allowed ? refilled - cost : refilled;  // state untouched-in-value on reject (D-01)
  const remaining = Math.floor(tokensAfter);                 // floored int (D-04)

  // resetMs = time until back to capacity (D-05); retryAfterMs = time until `cost` tokens available (D-03)
  const deficitToFull = cfg.capacity - tokensAfter;
  const resetMs = Math.ceil((deficitToFull / cfg.refillPerInterval) * cfg.intervalMs);
  const need = Math.max(0, cost - refilled);
  const retryAfterMs = allowed ? 0 : Math.ceil((need / cfg.refillPerInterval) * cfg.intervalMs);

  // only advance lastRefill to `now` when we actually applied refill/decision (keeps drift bounded)
  const next: TBState = { tokens: tokensAfter, lastRefill: now };
  return { tuple: [allowed, remaining, resetMs, retryAfterMs], next };
}
```
*Note the `Math.ceil` on every outgoing duration and `Math.floor` on `remaining`: those rounding choices are the contract the Phase-2 Lua must reproduce bit-for-bit (see Pitfall 3).*

### Pattern 2: Injected Clock + manual FakeClock (CORE-03, D-09) — the recommended time strategy
**What:** A `Clock` interface `{ now(): number }`. Production `SystemClock` returns `Date.now()`. Tests inject a `FakeClock` whose `now()` returns a controlled integer and which advances only via explicit `tick(ms)` / `setTime(ms)`. No real timers, no `Date` mocking.
**When to use:** All algorithm/store/limiter tests. This is preferred over `vi.useFakeTimers()` for this codebase — see Pitfall 1.
**Example:**
```typescript
// Source: CORE-03 + D-09 (integer-ms now). [CITED: CONTEXT.md D-09]
export interface Clock { now(): number; }                       // ms, integer
export const SystemClock: Clock = { now: () => Date.now() };

export class FakeClock implements Clock {
  constructor(private t = 0) {}
  now() { return this.t; }
  tick(ms: number) { this.t += ms; return this; }               // advance
  setTime(ms: number) { this.t = ms; return this; }
}

// test usage — fully deterministic, no vi.useFakeTimers:
const clock = new FakeClock(0);
const limiter = new TokenBucketLimiter(store, { capacity: 5, refillPerInterval: 1, intervalMs: 1000 }, clock);
await limiter.consume("k");          // now=0
clock.tick(2000);                    // 2s later, 2 tokens refilled
await limiter.consume("k");          // sees now=2000 deterministically
```

### Pattern 3: Thin per-algorithm limiter (D-07)
**What:** One class per algorithm implementing `RateLimiter`, constructed `(store, config, clock)`, delegating to exactly one named Store op and assembling the `Decision` (it owns `limit` = capacity/limit per D-12, and floors `remaining` per D-04). Explicit polymorphism; trivially swappable (ALGO-04).
```typescript
// Source: D-07/D-08/D-12. [CITED: CONTEXT.md]
export class TokenBucketLimiter implements RateLimiter {
  constructor(private store: Store, private cfg: TBConfig, private clock: Clock = SystemClock) {}
  async consume(key: string, cost = 1): Promise<Decision> {
    const [allowed, remaining, resetMs, retryAfterMs] = this.store.tokenBucket(key, this.cfg, cost, this.clock.now());
    return { allowed: allowed === 1, limit: this.cfg.capacity, remaining, resetMs, retryAfterMs };
  }
}
```

### Anti-Patterns to Avoid
- **Generic `get/set` Store + algorithm logic in the limiter.** Violates CORE-04/D-06 — math must live in the op (so the op is the atomic unit and the Lua reference). The store must NOT be a dumb key-value bag.
- **Reading `Date.now()` directly inside the store/algorithm.** Breaks determinism and Lua portability (STOR-03: Lua gets `now` as ARGV, never `redis.call('TIME')`). Always thread `now` in as a parameter.
- **Partial / draining consumption on reject.** Violates D-01 — reject must leave state byte-identical. Partial draining also breaks the exact-limit concurrency guard.
- **Throwing on `cost > capacity`.** Violates D-02 — return `allowed:false` with best-effort `retryAfterMs`. `consume` is a total function.
- **Returning `Decision` from the Store op.** Violates D-08 — the op returns the primitive tuple; the limiter assembles `Decision`. Keeps MemoryStore/RedisStore return shapes identical for TEST-02 conformance.
- **Floating-point ms crossing the op boundary.** Violates D-09 — round to int at the boundary; keep fractional token counts internal only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deterministic time in tests | A `setTimeout`-based sleep harness or real clock with retries | Injected `FakeClock` (the one custom abstraction you *should* write — it's tiny and the architecture demands it) | Real sleeps are flaky, slow, and untestable for sub-ms refill boundaries |
| ESM + `.d.ts` dual emit | Hand-wired two-config `tsc` + manual `exports` map | tsup `dts:true` single config | Dual-build footguns; CLAUDE.md prescribes tsup |
| Flat ESLint + TS rules wiring | Manual parser/plugin object graph | `tseslint.config(...)` helper | typescript-eslint ships the flat-config helper |
| Coverage | Custom instrumentation | `@vitest/coverage-v8` (lockstep with vitest) | Built-in, grading signal |

**Key insight:** The *only* thing you legitimately hand-roll in this phase is the three rate-limiting algorithms (that IS the challenge) and the `FakeClock`. Everything else — build, lint, format, coverage, test runner — is off-the-shelf and locked. Do not invent a connection pool, a mutex, or a generic store abstraction (CLAUDE.md/REQUIREMENTS "Out of Scope" explicitly calls these out as slop traps). Event-loop atomicity is sufficient for the memory store; no locking primitive is needed (see Pitfall 2).

## Common Pitfalls

### Pitfall 1: Using `vi.useFakeTimers()` instead of an injected clock
**What goes wrong:** `vi.useFakeTimers()` globally replaces `Date`, `setTimeout`, `performance.now`, etc. via `@sinonjs/fake-timers`, and `vi.setSystemTime()` then drives `Date.now()`. It *works*, but it couples your tests to a global side effect, requires `beforeEach/afterEach` setup-teardown, and — critically — it only matters if production code reads `Date.now()` *implicitly*. Here, by design (D-09/CORE-03), `now` is an explicit parameter. Mixing global timer mocking with explicit-`now` injection is redundant and obscures which time source is authoritative.
**Why it happens:** CLAUDE.md mentions `vi.useFakeTimers()/setSystemTime()` as available capabilities, which reads as a recommendation. It is a *fallback* for code that can't inject a clock — not the chosen pattern for this clock-injected store.
**How to avoid:** Use the injected `FakeClock` (Pattern 2) for all algorithm/store/limiter tests. Reserve `vi.useFakeTimers()` only if a later phase has a component that genuinely reads wall-clock time it can't receive as a param (e.g. an internal `setInterval`); none exists in Phase 1.
**Warning signs:** `vi.useFakeTimers()` in `beforeEach` of an algorithm test; tests that call `vi.advanceTimersByTime()` instead of `clock.tick()`. `[VERIFIED: vitest.dev/api/vi — useFakeTimers mocks Date by default via @sinonjs/fake-timers]`

### Pitfall 2: Mis-modeling the "concurrency" test as OS-thread parallelism
**What goes wrong:** Node is single-threaded; a synchronous in-memory `consume` runs to completion before the next microtask. If you `await Promise.all([...consume calls])` against a *synchronous* store, they execute **sequentially** — there is no true interleaving, so a naive "fire N, assert exactly `limit`" passes trivially and proves nothing about a real race.
**Why it happens:** Importing the mental model of a multi-threaded limiter. The race in the memory store is *logical* (an interleaving that *would* over-admit if the op were not a single synchronous critical section), not an OS-thread race.
**How to avoid:** Two complementary tactics:
  1. **The honest single-thread proof (TEST-04 memory half):** Fire `N > limit` overlapping `consume` calls via `Promise.all`, and assert that exactly `limit` resolve `allowed:true`. The guarantee you're demonstrating is that *because each op is one synchronous critical section, no two calls observe stale state* — so the count is exactly `limit`, never `limit+k`. State this explicitly in the test name/comment: the op's atomicity (read-modify-write with no `await` inside) is what makes over-admission impossible. This is the correct, defensible claim for the in-memory store and directly justifies why Phase 2 needs Lua (a *real* multi-client race) — call that out in DESIGN.md.
  2. **Optional reinforcement:** A targeted unit test that interleaves manually — call the op twice without writing back between calls (simulating a torn read-modify-write) and assert the *real* op never does that (i.e. there's no `await` between read and write inside the op). This documents *why* the guard holds rather than just that the count happens to be right.
**Warning signs:** A concurrency test with an `await` inside the store op's read-modify-write section; a comment claiming "thread safety"; treating the memory test as equivalent to the Redis race (it is NOT — the memory test proves event-loop atomicity, the Redis test proves Lua atomicity).

### Pitfall 3: TS↔Lua float/rounding drift (Phase-2 conformance landmine)
**What goes wrong:** The MemoryStore op uses JS `number` (IEEE-754 double). The Phase-2 Lua port also uses Lua doubles (Redis Lua numbers are doubles), so the *arithmetic* matches — but drift creeps in at three points: (a) **rounding direction** — if TS uses `Math.ceil` for `retryAfterMs` but the Lua dev writes `math.floor`, conformance (TEST-02) fails; (b) **floor timing** — flooring `remaining` *before* vs *after* subtracting `cost`; (c) **the Sliding Window estimate** — `floor(curr + prev*overlap)` must floor at the exact same step in both. Lua's `math.floor` and JS `Math.floor` agree on finite doubles, and integer ms at the boundary (D-09) eliminates the worst drift — but only if both sides round identically.
**Why it happens:** The two implementations are written at different times by (possibly) different reasoning; rounding is easy to do "the obvious way" differently.
**How to avoid:**
  - **Pin every rounding decision in code comments in the MemoryStore op**, e.g. `// CEIL: matches Lua math.ceil((need/rate)*interval)`. Make the TS op read as the spec (CONTEXT "specific ideas": the op is the reference impl).
  - **Keep all fractional state internal; emit only integers** (D-09). `Math.floor(remaining)`, `Math.ceil(retryAfterMs)`, `Math.ceil(resetMs)` — decide once, document, and Phase 2 copies.
  - **For Sliding Window (D-13/D-14):** floor the *weighted estimate* (`floor(curr + prev*overlapFraction)`) and compare `floor(estimate) + cost <= limit`. Compute `overlapFraction` as `(windowMs - elapsedInCurrent) / windowMs` and verify the Xu example: limit=7, prev=5, curr=3, 50% in → `floor(3 + 5*0.5)=floor(5.5)=5`, `5+1=6 <= 7` → admit. Encode this exact example as a test (D-14).
  - **Avoid `0.1+0.2`-class accumulation:** don't accumulate `lastRefill` by adding fractional ms repeatedly; recompute `elapsed = now - lastRefill` from the integer `now` each call and set `lastRefill = now`. This keeps the float bounded and identical to a Lua port that does the same.
**Warning signs:** Different rounding helpers in TS vs the eventual Lua; flooring at different steps; `remaining` that's fractional; a Sliding Window test that doesn't reproduce the exact Xu numbers.

### Pitfall 4: Fixed Window boundary-burst treated as a bug to fix
**What goes wrong:** Fixed Window admits up to `limit` at the end of window N and up to `limit` again at the start of window N+1 — up to `2*limit` across the boundary. A developer "fixing" this re-implements Sliding Window and defeats the comparison.
**Why it happens:** It looks like a correctness bug.
**How to avoid:** It is **required behavior** (ALGO-03, CONTEXT discretion, Success Criterion 3). Write an explicit FakeClock test that *demonstrates* the 2× burst at the boundary and a DESIGN.md note explaining it as the known Fixed Window tradeoff (the reason Sliding Window exists).
**Warning signs:** A Fixed Window test asserting the burst *doesn't* happen; smoothing logic inside the fixed-window op.

### Pitfall 5: tsup/tsconfig mismatch breaking the `tsc --noEmit` gate
**What goes wrong:** tsup bundles via esbuild (which does NOT type-check), so a build can succeed while `tsc --noEmit` fails — or vice versa if module-resolution settings differ. Success Criterion 1 requires `tsc --noEmit` to pass on a clean checkout, independent of tsup.
**Why it happens:** Treating "tsup build passed" as "types are sound." esbuild strips types without checking them.
**How to avoid:** Run `tsc --noEmit` as a **separate** verify step (this is the gate, per DELIV-03 spirit — even though `npm run verify` lands fully in later phases, wire `typecheck` now). Use `"moduleResolution": "Bundler"` (or `"NodeNext"`) consistently in `tsconfig.json` and let tsup's `dts:true` reuse that tsconfig for declaration emit. Keep `"strict": true`, `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true` for clean ESM. See Code Examples.
**Warning signs:** `dts` emit errors that don't match `tsc` errors; `exports`/`types` map pointing at files tsup didn't emit.

## Code Examples

### `tsconfig.json` (strict, ESM, gate-ready)
```jsonc
// Source: TS handbook + tsup dts requirements. [CITED: typescriptlang.org tsconfig; CLAUDE.md "tsconfig posture"]
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "noEmit": true,            // tsc is the type-gate; tsup does the actual emit
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true
  },
  "include": ["src", "test", "tsup.config.ts", "vitest.config.ts"]
}
```
*(`tsc --noEmit` is the Phase-1 gate. tsup emits `.d.ts` independently via `dts:true`.)*

### `tsup.config.ts` (ESM-only)
```typescript
// Source: tsup options (entry/format/dts/sourcemap/clean). [CITED: tsup.egoist.dev; CLAUDE.md tsup pin]
// NOTE: tsup README now recommends migrating to tsdown — DO NOT switch; CLAUDE.md locks tsup.
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],     // ESM-only acceptable per CONTEXT discretion + CLAUDE.md
  dts: true,           // emit .d.ts (uses tsconfig)
  sourcemap: true,
  clean: true,
  target: "node24",
});
```

### `package.json` (essentials)
```jsonc
// Source: Node ESM package conventions. [CITED: nodejs.org packages docs]
{
  "name": "rate-limiter",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "types": "./dist/index.d.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",   // the Phase-1 gate (Success Criterion 1)
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "build": "tsup",
    "lint": "eslint .",
    "format": "prettier --write ."
  }
}
```

### `eslint.config.js` (flat config)
```javascript
// Source: typescript-eslint flat config helper. [CITED: typescript-eslint.io; CLAUDE.md ESLint 10 flat]
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
export default tseslint.config(
  ...tseslint.configs.recommended,
  prettier,   // last: disables conflicting stylistic rules
);
```

### `vitest.config.ts`
```typescript
// Source: vitest config. [CITED: vitest.dev/config]
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", coverage: { provider: "v8", include: ["src/**"] } },
});
```

### Sliding Window estimate (D-13/D-14 worked example as a test)
```typescript
// Source: D-13/D-14 + Alex Xu Ch.4. [CITED: CONTEXT.md D-14]
// estimate = curr + prev * overlapFraction; admit when floor(estimate)+cost <= limit
test("Xu Ch.4 sliding window example: limit=7, prev=5, curr=3, 50% in → admit", () => {
  // overlapFraction = (windowMs - elapsedInCurrent)/windowMs = 30000/60000 = 0.5
  // estimate = 3 + 5*0.5 = 5.5 → floor 5; 5 + 1 = 6 <= 7 → allowed
  // assert decision.allowed === true and remaining === 7 - 6 = 1
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ESLint `.eslintrc` | Flat `eslint.config.js` only | ESLint 9→10 dropped legacy | Must use flat config; legacy errors out `[VERIFIED: npm registry eslint 10.5.0]` |
| Express 4 | Express 5 `latest` | not this phase (Phase 3) | n/a here |
| tsup | tsdown (rolldown) recommended by tsup maintainer | README note (2025) | **Flagged only** — CLAUDE.md locks tsup; do not migrate `[CITED: github.com/egoist/tsup README]` |
| TS 5.x | TS 6.0 released (6.0.3 latest) | ~2026 | Hold at ~5.9 per CLAUDE.md — typescript-eslint peer caps `<6.1.0`; 6.0 carries tooling-lag risk `[VERIFIED: npm registry]` |

**Deprecated/outdated:**
- ESLint legacy config: unsupported in ESLint 10. Use flat config.
- `ioredis-mock` / off-the-shelf limiters: CLAUDE.md "What NOT to Use" — irrelevant to Phase 1 (no Redis/HTTP yet) but reaffirms hand-written algorithms.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact Token Bucket / Sliding Window / Fixed Window arithmetic in the code examples reflects Alex Xu Ch.4 (book not in repo/session) | Code Examples, Pattern 1 | LOW — the algorithms are standard and the locked decisions (D-10/D-13/D-14) pin the formulas; the worked example (D-14) is the regression anchor. Verify against the book/PDF during planning |
| A2 | `Math.ceil` for `retryAfterMs`/`resetMs` and `Math.floor` for `remaining` is the rounding convention | Pattern 1, Pitfall 3 | LOW-MED — D-04 mandates floored `remaining`; ceil for "time until" durations is the safe (never-under-report) choice and must be mirrored in Phase-2 Lua. Lock it explicitly in the plan so conformance is unambiguous |
| A3 | `node:test`/Jest fully excluded; Vitest is sole runner | Standard Stack | NONE — locked by CLAUDE.md |
| A4 | tsup is not formally `deprecated` on npm (no deprecation string), only README-recommends tsdown | Standard Stack, State of the Art | LOW — `npm view tsup deprecated` returned empty; the recommendation is advisory. CLAUDE.md locks tsup regardless |

**Note:** A1/A2 are the only decisions a planner should surface for confirmation — both are about *exact rounding/formula encoding* that Phase-2 conformance depends on. Everything else is verified or locked.

## Open Questions

1. **Exact rounding direction for `resetMs`/`retryAfterMs` (ceil assumed).**
   - What we know: D-04 floors `remaining`; D-09 mandates integer ms at the boundary.
   - What's unclear: CONTEXT doesn't explicitly state ceil vs round for the two duration fields.
   - Recommendation: Lock `Math.ceil` (never under-report wait time) in the plan, comment it in the op, and make TEST-01 assert exact integer values so Phase-2 Lua has a precise target. (See A2.)

2. **Whether to also write a no-op `SystemClock` test / default-clock path now.**
   - What we know: Production needs `SystemClock` (Date.now); tests use `FakeClock`.
   - What's unclear: Phase 1 has no runtime consumer of `SystemClock` (the demo server is Phase 4).
   - Recommendation: Ship `SystemClock` as the default constructor arg (so limiters are usable without passing a clock) but don't test wall-clock behavior — only the injected `FakeClock` path is asserted. Cheap and forward-compatible.

3. **`test/` separate vs `src` colocated.**
   - Recommendation: Use a separate `test/` dir (cleaner `src`, simpler `tsup` entry); discretionary — let the planner pick and stay consistent.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime + tooling | ✓ | v24.15.0 `[VERIFIED]` | — (matches CLAUDE.md Node 24 LTS) |
| npm | install/scripts | ✓ | 11.12.1 `[VERIFIED]` | — |
| Docker | NOT needed this phase (Phase 2/4) | n/a | — | — |
| Redis | NOT needed this phase (Phase 2) | n/a | — | — |

**Missing dependencies with no fallback:** none — the local Node 24.15.0 environment fully satisfies Phase 1. No external services required (pure code/test phase).
**Missing dependencies with fallback:** none.

*Validation Architecture section omitted: `.planning/config.json` sets `workflow.nyquist_validation: false`.*

## Project Constraints (from CLAUDE.md)

Treat these with the same authority as locked CONTEXT decisions:
- **Stack pins (exact):** Node 24-alpine, TS `~5.9` (NOT 6.0), Vitest `^4.1`, `@vitest/coverage-v8` lockstep, tsup `^8.5`, ESLint `^10.5` flat config + typescript-eslint `^8.62`, Prettier `^3.8` + eslint-config-prettier `^10.1`, tsx `^4.22`, `@types/node ^24`.
- **ESM authoring → dual/ESM build via tsup with `.d.ts`.** ESM-only acceptable (CONTEXT discretion).
- **Core stays framework/transport-agnostic** — no Express/ioredis import in the core package.
- **Clock injection:** inject `now: () => number` (CLAUDE.md "Testing time + concurrency"); manifested here as the `Clock` interface (CORE-03).
- **Concurrency test posture:** "fire N overlapping `Promise.all` requests and assert exactly `limit` are allowed" — implement per Pitfall 2 with the explicit event-loop-atomicity justification.
- **What NOT to Use:** no `ioredis-mock`, no off-the-shelf limiter (`express-rate-limit`/`rate-limiter-flexible`), no ESLint legacy `.eslintrc`, no `ts-node` (use tsx/tsup), no `:latest` tags. Hand-write the three algorithms.
- **Build-green gate:** code must build and tests pass at every milestone; `tsc --noEmit` clean on a fresh checkout (Success Criterion 1).
- **Deliverable layout:** everything under `/rate-limiter` (DELIV-05).
- **APOSD posture:** deep modules, clarity over cleverness — the MemoryStore op is the human-readable reference impl.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | `RateLimiter.consume(key, cost?) -> Promise<Decision>` | Pattern 3 (thin limiter, async wrapper over sync op) |
| CORE-02 | `Decision` reports `allowed, limit, remaining, resetMs, retryAfterMs` | Pattern 3 assembly; D-04/D-05/D-12 rounding rules; Pitfall 3 |
| CORE-03 | Injectable `Clock` + `FakeClock` | Pattern 2 (recommended over `vi.useFakeTimers`, Pitfall 1) |
| CORE-04 | `Store` exposes one atomic op per algorithm (not generic get/set) | Pattern 1 + Anti-Patterns (no generic kv store) |
| CORE-05 | Key opaque to core | Architecture Map (key passed through, no parsing) |
| ALGO-01 | Token Bucket, lazy refill `f(lastRefill, tokens, now)`, cost | Pattern 1 code (lazy refill D-10), Pitfall 3 (float) |
| ALGO-02 | Sliding Window, weighted prev, pinned numeric example | Sliding Window code example, D-13/D-14, Pitfall 3 |
| ALGO-03 | Fixed Window, exhibits + documents boundary burst | Pitfall 4 (required behavior, FakeClock demo + DESIGN.md) |
| ALGO-04 | Three algorithms interchangeable behind `RateLimiter` | Pattern 3 (explicit polymorphism, same interface) |
| STOR-01 | In-memory `Store`, atomic via event loop, readable reference | Pattern 1, Pitfall 2 (event-loop atomicity proof) |
| TEST-01 | Vitest unit tests: refill, burst, rollover, cost, exact-limit, FakeClock, no sleeps | Pattern 2, Code Examples, structure (`test/`) |
| DELIV-05 | Solution under `/rate-limiter` | Recommended Project Structure |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`, 2026-06-23) — verified: vitest 4.1.9, @vitest/coverage-v8 4.1.9 (peer pins vitest exact), tsup 8.5.1 (no deprecation string; modified 2025-11-12), typescript 6.0.3 (pin 5.9), eslint 10.5.0, typescript-eslint 8.62.0 (peer typescript `<6.1.0`, eslint `^10`), prettier 3.8.4, eslint-config-prettier 10.1.8, tsx 4.22.4, @types/node 26.0.0.
- vitest.dev/api/vi.html — `useFakeTimers` mocks `Date`/timers via `@sinonjs/fake-timers`; `setSystemTime` drives `Date.now`; `setTimerTickMode` is 4.1.0+. Confirms why injected clock is the cleaner choice.
- Local env probe — Node v24.15.0, npm 11.12.1 present.
- `.planning/CONTEXT.md` (D-01..D-14), `REQUIREMENTS.md`, `CLAUDE.md` — locked decisions and stack pins.

### Secondary (MEDIUM confidence)
- github.com/egoist/tsup README — tsup maintenance note recommending tsdown (advisory; tsup remains pinned).
- WebSearch (vitest fake timers semantics) cross-referenced with official vitest docs.

### Tertiary (LOW confidence)
- Token Bucket / Fixed Window exact arithmetic in code examples — standard algorithm knowledge `[ASSUMED]`, anchored by locked D-10/D-13/D-14 and the Xu worked example (A1).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified on npm registry 2026-06-23; matches CLAUDE.md pins.
- Architecture: HIGH — fully constrained by CONTEXT D-01..D-14; research clarified *how* to implement portably, not *what*.
- Pitfalls: HIGH — clock strategy and concurrency-proof reasoning verified against vitest docs + JS execution model; float/Lua-drift reasoning is the load-bearing original contribution.

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable tooling; versions locked by CLAUDE.md regardless of registry drift)
