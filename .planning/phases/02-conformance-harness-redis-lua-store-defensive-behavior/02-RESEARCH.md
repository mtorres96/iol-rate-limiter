# Phase 2: Conformance Harness, Redis/Lua Store & Defensive Behavior - Research

**Researched:** 2026-06-24
**Domain:** Atomic-Lua Redis store (ioredis `defineCommand`), TS↔Lua numeric parity, parametrized conformance testing, defensive resilience (timeout + circuit breaker + fail-open/closed), `@testcontainers/redis` fault injection
**Confidence:** HIGH

## Summary

This phase ports the three `MemoryStore` algorithm ops (`rate-limiter/src/store/memory.ts`) to atomic Lua scripts behind a new `RedisStore`, proves both stores produce bit-for-bit-identical `OpTuple`s via one parametrized conformance suite, and wraps every Redis call in a configurable timeout + circuit breaker + fail-open/closed policy — all proven against a real Redis via `@testcontainers/redis`. The hard correctness problem is **numeric parity**: the Lua scripts must reproduce the PINNED `floor`/`ceil` rounding contract exactly, and Token Bucket's fractional `tokens` must round-trip through Redis losslessly. The locked mechanism (CONTEXT D2-02/D2-03) is sound — Redis Lua 5.1 and JS both use IEEE-754 doubles, so given identical integer-ms inputs (`now`, `lastRefill` passed as ARGV, never `redis.call('TIME')`) the refill math matches; persisting `tokens` as a `%.17g` string makes the round-trip exact. The one Lua gotcha that bites here: **a Lua number returned to Redis is truncated to its integer part** — so every value in the returned tuple MUST already be an integer (it is, after in-script floor/ceil), and `tokens` must be persisted as a *string*, not returned/stored as a Lua number.

The resilience layer is a thin, well-bounded wrapper. ioredis `commandTimeout` (set in the 50–100ms band) throws a "Command timed out" error on a hung/slow call; a small hand-rolled circuit breaker (this is exactly the kind of small, deep state machine APOSD favors — no library) counts consecutive failures, opens for a cooldown, and half-opens with a single probe. The policy decides admit (fail-open, default) vs deny (fail-closed) whenever Redis is unavailable or the breaker is open. Fault injection uses real container control: **`stop()`** the container for "Redis down" (connection refused) and **`pause()`** (Docker cgroups freezer, via the dockerode handle) for "Redis slow" (TCP stays open → `commandTimeout` fires) — pause is a strictly better slowness simulation than stop because the socket stays open.

**Primary recommendation:** Author the conformance suite FIRST (it is the contract). Port each `MemoryStore` op to Lua line-by-line, applying `math.floor`/`math.ceil` at the identical points, returning `{allowed, remaining, resetMs, retryAfterMs}` as integers and persisting fractional `tokens` via `string.format("%.17g", tokens)`. Pass `now` and all config as ARGV. Register via `defineCommand` on one shared client with `commandTimeout: 75`. Wrap calls in a `RedisStore` that owns a 5-failure / 2000ms-cooldown / single-probe breaker and a `policy: 'fail-open' | 'fail-closed'` (default `'fail-open'`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Atomic algorithm state mutation | Redis (Lua script) | — | Single-script execution is the distributed atomicity primitive; replaces event-loop atomicity. |
| Algorithm math (refill / window / rounding) | Redis (Lua) ported from core (`MemoryStore`) | — | D2-03: Lua is a line-by-line port; `MemoryStore` remains the readable reference + parity oracle. |
| `OpTuple` assembly + boundary rounding | Redis (Lua) and `MemoryStore` (identical) | — | Both stores own rounding so tuples match bit-for-bit (TEST-02). |
| Timeout, breaker, fail-open/closed policy | `RedisStore` (core lib, around the client) | — | CONTEXT integration note: defensive behavior lives in/around `RedisStore`, NOT in the limiters or the Express adapter. |
| Connection lifecycle | Single shared ioredis client | — | D2-08; no pool, no per-op connect. |
| `now` provision | Limiter (`clock.now()`) → ARGV | — | D2-08/STOR-03: deterministic, parity-safe; never `redis.call('TIME')`. |
| Fault injection (down/slow) | Test harness (`@testcontainers/redis`) | dockerode (pause/unpause) | D2-09: real container control, no client mocks. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | ^5.11 (5.11.1) | Redis client; `defineCommand` custom Lua, `commandTimeout` | Locked in CLAUDE.md/D2-08. `defineCommand` = auto-EVALSHA + NOSCRIPT→EVAL fallback. `[CITED: github.com/redis/ioredis README]` |
| Redis server | 7.4 (`redis:7.4-alpine`) | Distributed store, `EVAL`/`EVALSHA`, Lua 5.1 | Locked in CLAUDE.md. |

### Supporting (test-only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testcontainers/redis | ^12 (12.0.3) | Ephemeral real Redis per integration run | TEST-03/04/05 — the Redis-store integration + fault-injection tests. `[VERIFIED: npm registry]` 12.0.3 |
| testcontainers | ^12 (12.0.3) | Core engine (peer); exposes dockerode handle for pause/unpause | Pin alongside the redis module. `[VERIFIED: npm registry]` 12.0.3 |

`supertest` is NOT needed in Phase 2 (no HTTP yet — that is Phase 3). Do not add it here.

### Alternatives Considered (all already rejected in CLAUDE.md / CONTEXT — do not re-litigate)
| Instead of | Rejected alternative | Why rejected |
|------------|---------|----------|
| ioredis `defineCommand` | `client.eval` / raw EVALSHA management | Loses auto-EVALSHA caching + NOSCRIPT fallback ergonomics. |
| Plain `EVAL`/`EVALSHA` | Redis `FUNCTION` API | More ceremony, less reviewer-familiar (CLAUDE.md "What NOT to Use"). |
| Real Redis via testcontainers | `ioredis-mock` | Tests the mock's Lua emulation, not real atomicity — false confidence on the graded thing. |
| Hand-rolled breaker (small, in-tree) | `opossum` / cockatiel circuit-breaker libs | Overengineering for a ~40-line state machine; adds a dep for a deep, easily-tested module (APOSD). Note inline below. |

**Installation:**
```bash
npm install ioredis@^5.11
npm install -D @testcontainers/redis@^12 testcontainers@^12
```

**Version verification (run 2026-06-24):** `npm view ioredis version` → 5.11.1; `npm view @testcontainers/redis version` → 12.0.3; `npm view testcontainers version` → 12.0.3. All match the versions locked in CLAUDE.md (verified there 2026-06-23). `[VERIFIED: npm registry]`

## Package Legitimacy Audit

> slopcheck was UNAVAILABLE in this session (could not pip-install). Per the graceful-degradation protocol, packages are tagged `[ASSUMED]` below. However, all are mainstream, long-established packages already locked + version-verified in CLAUDE.md (npm view 2026-06-23), with no postinstall scripts (verified this session). Risk is minimal; the planner may proceed without a per-install human-verify checkpoint given the CLAUDE.md lock, at its discretion.

| Package | Registry | Age / standing | Source Repo | postinstall | slopcheck | Disposition |
|---------|----------|-----|-------------|-------------|-----------|-------------|
| ioredis | npm | ~10 yrs, ~5M+/wk, industry standard | github.com/redis/ioredis | none | unavailable | Approved (CLAUDE.md locked) `[ASSUMED]` |
| @testcontainers/redis | npm | testcontainers org, mainstream | github.com/testcontainers/testcontainers-node | none | unavailable | Approved (CLAUDE.md locked) `[ASSUMED]` |
| testcontainers | npm | testcontainers org, mainstream | github.com/testcontainers/testcontainers-node | none | unavailable | Approved (CLAUDE.md locked) `[ASSUMED]` |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**postinstall script audit:** all four candidate packages report no postinstall script (`npm view <pkg> scripts.postinstall` empty).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STOR-02 | Redis store runs each algorithm mutation inside one atomic Lua script | Lua KEYS/ARGV layouts + ported scripts below (§Lua Scripts). Single-script execution = atomicity. |
| STOR-03 | Scripts receive `now` as ARGV (never `TIME`) and set key TTL inside the script | ARGV ordering + per-algo TTL formulas below (§TTL Sizing). |
| STOR-04 | Scripts registered via `defineCommand` (auto-EVALSHA + NOSCRIPT fallback), shared single client | §ioredis Integration. `defineCommand` confirmed to do auto-EVALSHA. |
| STOR-05 | Keys namespaced/prefixed to avoid collisions | `rl:{algo}:{key}` scheme (D2-07), §Key Namespacing. |
| DEF-01 | Every Redis call bounded by a configurable timeout | `commandTimeout` 50–100ms band (recommend 75ms), §Defensive Behavior. |
| DEF-02 | Errors/timeouts handled by configurable fail-open/closed policy, documented default, no unhandled rejection | Policy wiring + default fail-open (D2-04), §Defensive Behavior. |
| TEST-02 | Shared conformance suite drives identical `(key,cost,now)` over both stores, asserts identical Decisions | §Conformance Harness Shape. |
| TEST-03 | Integration tests run the Redis store against real Redis via `@testcontainers/redis` | §Testcontainers Integration. |
| TEST-04 | Concurrency burst admits exactly `limit` against both memory AND real Redis | §Concurrency over real Redis. |
| TEST-05 | Fault-injection: Redis down/slow under both fail-open and fail-closed policies | §Fault Injection (stop = down, pause = slow). |
</phase_requirements>

## Architecture Patterns

### System Architecture Diagram

```
limiter.consume(key, cost)
        │  clock.now()  ──────────────► now (integer ms)
        ▼
  RedisStore.<algoOp>(key, cfg, cost, now)   [async; same Store interface as MemoryStore]
        │
        ▼
  ┌─────────── Circuit Breaker ───────────┐
  │  state == OPEN?  ──── yes ──┐          │
  │  (cooldown not elapsed)     │          │
  │       │ no / half-open      ▼          │
  │       ▼               apply POLICY ────┼──► fail-open  → OpTuple "admit"  (allowed=1)
  │  ioredis call                          │    fail-closed → OpTuple "deny"   (allowed=0)
  │  (commandTimeout=75ms)                 │
  │   defineCommand: rl_tb / rl_sw / rl_fw │
  │      KEYS=[rl:tb:<key>] ARGV=[now,...] │
  │       │            │                   │
  │   success      error/timeout ──────────┘ (record failure → maybe OPEN, then POLICY)
  │       │ record success (reset/close)
  │       ▼
  └──► Redis runs Lua ATOMICALLY:
         read state → refill/roll → decide → floor/ceil → PEXPIRE(ttl) → return {a,rem,reset,retry}
        │
        ▼
   OpTuple [allowed, remaining, resetMs, retryAfterMs]  ── identical shape to MemoryStore ──►
        ▼
   limiter assembles Decision (adds `limit` from cfg)
```

The breaker + policy + timeout are the only new control flow. The Lua box is a transcription of the existing `MemoryStore` op. The OpTuple boundary is unchanged.

### Recommended Project Structure
```
rate-limiter/
├── src/
│   ├── store/
│   │   ├── memory.ts              # unchanged math; ops now return Promise<OpTuple> (D2-01)
│   │   ├── redis.ts               # RedisStore: defineCommand + breaker + policy + timeout
│   │   ├── breaker.ts             # small CircuitBreaker state machine (deep module)
│   │   └── lua/
│   │       ├── token-bucket.lua   # ports memory.ts tokenBucket()
│   │       ├── sliding-window.lua # ports memory.ts slidingWindow()
│   │       └── fixed-window.lua   # ports memory.ts fixedWindow()
│   ├── types.ts                  # Store ops → Promise<OpTuple>; add RedisStore config types
│   └── validate.ts               # add assertions for prefix/timeout/breaker/policy config
└── test/
    ├── conformance/
    │   ├── sequences.ts          # shared (key,cost,now) fixtures per algorithm
    │   └── store-conformance.test.ts  # parametrized over [MemoryStore, RedisStore]
    ├── redis-integration.test.ts # TEST-03 happy-path against real Redis
    ├── redis-concurrency.test.ts # TEST-04 burst over real Redis
    └── fault-injection.test.ts   # TEST-05 down/slow × fail-open/closed × breaker
```

**Lua loading:** Load `.lua` files at module load with `readFileSync(new URL('./lua/token-bucket.lua', import.meta.url), 'utf8')`. Keeps scripts as first-class, reviewable files (and lets you diff them against `memory.ts`). ESM `import.meta.url` resolves correctly; ensure `tsup` copies the `lua/` dir into `dist` (add a copy step or `loader`/`onSuccess` cp — flag for the planner). `[ASSUMED]` (tsup asset copying is a known build-config detail).

### Pattern 1: defineCommand registration (one shared client)
```ts
// Source: github.com/redis/ioredis README (defineCommand) [CITED]
const client = new Redis(connectionUrl, {
  commandTimeout: 75,        // DEF-01 — 50–100ms band
  maxRetriesPerRequest: 1,   // fail fast into the breaker rather than queueing
  enableOfflineQueue: false, // when down, error immediately (don't buffer) → policy fires
});

client.defineCommand("rl_tb", { numberOfKeys: 1, lua: TB_LUA });
client.defineCommand("rl_sw", { numberOfKeys: 1, lua: SW_LUA });
client.defineCommand("rl_fw", { numberOfKeys: 1, lua: FW_LUA });

// Call: KEYS = the 1 namespaced key; ARGV = now + config + cost.
// ioredis returns the Lua table as a JS array of numbers.
const tuple = await (client as any).rl_tb(
  `rl:tb:${key}`,                                   // KEYS[1]
  now, cfg.capacity, cfg.refillPerInterval, cfg.intervalMs, cost,  // ARGV[1..5]
);  // → [allowed, remaining, resetMs, retryAfterMs]
```
`commandTimeout` throws `Error: Command timed out` if no reply in 75ms `[CITED: redis.github.io/ioredis CommonRedisOptions]`. `enableOfflineQueue: false` makes a down server error immediately rather than queue `[CITED: same]`.

### Pattern 2: Circuit Breaker (small in-tree state machine — do NOT add a library)
```ts
// CLOSED → (N consecutive failures) → OPEN → (cooldown elapses) → HALF_OPEN
//   HALF_OPEN: allow ONE probe. probe success → CLOSED; probe failure → OPEN (reset cooldown).
type BreakerState = "closed" | "open" | "half-open";
// Defaults (Claude's discretion, resolved): failureThreshold=5, cooldownMs=2000, halfOpenMaxProbes=1
```
When OPEN (and cooldown not elapsed), the breaker SHORT-CIRCUITS: it does not call Redis at all and applies the policy directly — this is the whole point (D2-05: "avoids piling up timeouts during an outage"). A successful op resets the failure count and closes. The breaker is pure/synchronous around the async call and is trivially unit-testable with a `FakeClock` (reuse `src/clock.ts`) for the cooldown timing — no real timers.

### Pattern 3: Policy application
```ts
// On ANY caught Redis error/timeout OR an open breaker:
function degraded(policy, key, cfg, cost, now): OpTuple {
  // fail-open: admit. remaining/reset/retry are best-effort (admit with limit-ish numbers).
  // fail-closed: deny. allowed=0, retryAfterMs = a small backoff (e.g. the breaker cooldown).
}
```
Default `policy: "fail-open"` (D2-04). MUST catch all errors so there is **no unhandled rejection** (DEF-02). Resolve the promise through the policy; never reject out of `RedisStore`.

### Anti-Patterns to Avoid
- **Calling `redis.call('TIME')` in Lua** — breaks determinism + TS↔Lua parity (D2-08/STOR-03). `now` is ARGV only.
- **Returning a Lua float in the tuple** — Redis truncates Lua numbers to integer on return (see Pitfall 1); floor/ceil in-script so every returned value is already an integer.
- **Storing `tokens` as a Lua number / via plain `tostring`** — use `string.format("%.17g", tokens)` for lossless persistence (D2-02).
- **An `await` inside `MemoryStore`'s critical section** — D2-01 migrates the *return type* to `Promise`, NOT the internals; the synchronous read-modify-write (event-loop atomicity) must be preserved exactly.
- **A connection pool / mutex** — explicitly out of scope (REQUIREMENTS "Custom connection-pool manager / mutexes"). One shared client.
- **A secondary/Postgres fallback store** — out of scope (deferred; DESIGN.md Phase 4 only).

## Lua Scripts — Exact KEYS / ARGV / Return Layout (STOR-02/03)

All three: `numberOfKeys: 1`. `KEYS[1]` = the namespaced key. All ARGV are passed as **integers** (strings on the wire; `tonumber()` in-script). Return is a 4-element Lua table `{allowed, remaining, resetMs, retryAfterMs}` — all integers.

### Token Bucket (`rl_tb`) — ports `memory.ts` `tokenBucket()`
- **KEYS[1]** = `rl:tb:<key>`
- **ARGV:** `[1]=now  [2]=capacity  [3]=refillPerInterval  [4]=intervalMs  [5]=cost`
- **Reads:** hash fields `tokens` (a `%.17g` string), `lastRefill` (integer ms). Missing key → init `tokens=capacity, lastRefill=now`.
- **Math (line-by-line port, doubles):**
  ```lua
  local tokens = tonumber(stored_tokens or ARGV[2])      -- capacity if new
  local lastRefill = tonumber(stored_lastRefill or ARGV[1])
  local elapsed = math.max(0, now - lastRefill)
  local refilled = math.min(capacity, tokens + (elapsed / intervalMs) * refillPerInterval)
  local allowed = (cost <= refilled) and 1 or 0
  local tokensAfter = (allowed == 1) and (refilled - cost) or refilled
  local remaining = math.floor(tokensAfter)                          -- FLOOR (D-04)
  local resetMs = math.ceil(((capacity - tokensAfter)/refillPerInterval)*intervalMs)  -- CEIL (D-05)
  local need = math.max(0, cost - refilled)
  local retryAfterMs = (allowed == 1) and 0
        or math.ceil((need/refillPerInterval)*intervalMs)            -- CEIL (D-03)
  ```
- **Writes:** `HSET key tokens string.format("%.17g", tokensAfter) lastRefill now`; then **PEXPIRE** (see TTL below).
- **Returns:** `{allowed, remaining, resetMs, retryAfterMs}`.

### Sliding Window (`rl_sw`) — ports `memory.ts` `slidingWindow()`
- **KEYS[1]** = `rl:sw:<key>`
- **ARGV:** `[1]=now  [2]=limit  [3]=windowMs  [4]=cost`
- **Reads:** hash fields `bucket`, `curr`, `prev` (all integers). `bucket = floor(now/windowMs)`. Roll: same bucket → keep; `bucket-1` → `prev=stored.curr, curr=0`; gap ≥2 → `prev=0, curr=0`; missing → both 0.
- **Math (port, identical floor points and the retryAfter branch logic from `memory.ts` lines 126–165):**
  ```lua
  local elapsedInCurrent = now - bucket * windowMs
  local overlapFraction = (windowMs - elapsedInCurrent) / windowMs
  local flooredEstimate = math.floor(curr + prev * overlapFraction)     -- FLOOR (D-13)
  local allowed = (flooredEstimate + cost <= limit) and 1 or 0
  local currAfter = (allowed == 1) and (curr + cost) or curr
  local usedAfter = flooredEstimate + ((allowed==1) and cost or 0)
  local remaining = math.max(0, limit - usedAfter)
  local msToBoundary = (bucket + 1) * windowMs - now
  local resetMs = math.ceil(msToBoundary)                               -- CEIL (D-05)
  -- retryAfterMs: reproduce memory.ts 3-way branch EXACTLY (allowed / curr-alone-over / decay)
  ```
- **Writes:** `HSET key bucket <bucket> curr <currAfter> prev <prev>`; **PEXPIRE**.
- **Returns:** `{allowed, remaining, resetMs, retryAfterMs}`.

> Reproduce the `retryAfterMs` branch in `memory.ts` (lines 148–165) verbatim: allowed→0; else if `curr+cost > limit`→`ceil(msToBoundary)`; else `min(ceil(overshoot*msToDecayOne), ceil(msToBoundary))` with `msToDecayOne = prev>0 ? windowMs/prev : msToBoundary`. This is the highest-drift-risk script — pin it with a conformance fixture built from the Xu worked example (limit=7, prev=5, curr=3, 50% in → admit, remaining=1).

### Fixed Window (`rl_fw`) — ports `memory.ts` `fixedWindow()`
- **KEYS[1]** = `rl:fw:<key>`
- **ARGV:** `[1]=now  [2]=limit  [3]=windowMs  [4]=cost`
- **Reads:** hash fields `bucket`, `curr`. `bucket = floor(now/windowMs)`; if stored bucket ≠ current → `count=0`, else `count=stored.curr`.
- **Math:**
  ```lua
  local allowed = (count + cost <= limit) and 1 or 0
  local countAfter = (allowed == 1) and (count + cost) or count
  local remaining = math.max(0, limit - countAfter)
  local msToBoundary = (bucket + 1) * windowMs - now
  local resetMs = math.ceil(msToBoundary)                               -- CEIL
  local retryAfterMs = (allowed == 1) and 0 or math.ceil(msToBoundary)  -- CEIL
  ```
- **Writes:** `HSET key bucket <bucket> curr <countAfter>` (omit `prev` — not used; matches store's `prev:0`); **PEXPIRE**.
- **Returns:** `{allowed, remaining, resetMs, retryAfterMs}`. (Boundary 2× burst is preserved — no smoothing.)

**Return integer guarantee:** every returned value passes through `math.floor`/`math.ceil`/`math.max` and is integral. Do not wrap returns in `tostring` — ioredis maps a Lua-integer table to a JS number array, matching `OpTuple` exactly (Pitfall 1). `[CITED: redis.io/docs/.../lua-api]`

## TTL Sizing Inside Lua (STOR-03) — concrete values (Claude's discretion, resolved)

Use `PEXPIRE key <ttlMs>` (millisecond precision, matches integer-ms domain) at the end of every script. The TTL only needs to outlive the state's relevance — a too-short TTL drops live state (correctness bug); too-long just wastes memory. CONTEXT guidance pins the shape:

| Algorithm | TTL formula (ms) | Concrete (example cfg) | Rationale |
|-----------|------------------|------------------------|-----------|
| Token Bucket | `ceil(capacity / refillPerInterval * intervalMs) + 1` | cap=5, 1/1000ms → 5001ms | Time to refill from empty to full; after that an absent key re-inits to a full bucket — identical observable result, so expiry is safe. `+1` guards the ceil boundary. |
| Sliding Window | `2 * windowMs + 1` | windowMs=1000 → 2001ms | Both `prev` and `curr` buckets must survive; the previous window stays relevant for up to `2×windowMs`. After that `prev` would be 0 anyway. |
| Fixed Window | `2 * windowMs + 1` | windowMs=1000 → 2001ms | Only `curr` matters, but using the same `2×windowMs` is simpler and safe (a 1×windowMs TTL also works; uniform value avoids an off-by-one at the boundary). |

Compute the TTL inside the script from the same ARGV (no extra args). Recommendation: `local ttl = math.ceil(...)+1; redis.call('PEXPIRE', KEYS[1], ttl)`. `[ASSUMED]` (formulas are reasoned from the algorithms + CONTEXT guidance, not from an external source).

## Numeric Parity TS ↔ Lua (D2-02) — why doubles match

- Redis Lua is **Lua 5.1**, whose `number` type is an IEEE-754 **double** — the same representation as JavaScript's `number`. `[CITED: redis.io/docs/.../eval-intro]`
- All inputs that drive the math (`now`, `lastRefill`, `capacity`, `refillPerInterval`, `intervalMs`, `limit`, `windowMs`, `cost`) are **integers** passed as ARGV and `tonumber()`'d. Identical integer inputs + identical double operations (`/`, `*`, `+`, `min`, `max`, `floor`, `ceil`) ⇒ identical doubles ⇒ identical floored/ceiled integers. This is the entire parity argument and it holds because `now` is injected, never read from `TIME` (D2-08).
- The ONLY persisted float is Token Bucket `tokens`. Persist it as `string.format("%.17g", tokensAfter)`. `%.17g` is the minimal precision that round-trips an IEEE-754 double losslessly, so the next script's `tonumber()` recovers the exact same double. `[CITED: IEEE-754 round-trip / printf %g — widely documented]` `[ASSUMED: that %.17g specifically is the chosen format — locked by D2-02]`
- `MemoryStore` keeps `tokens` as a JS number in its `Map` — no serialization, no precision loss. Both stores therefore carry the same fractional state across calls.

**Gotcha — Redis truncates returned Lua numbers:** When a Lua script *returns* a number, Redis converts it to an integer reply by **truncating toward zero** (the fraction is lost). This is why the scripts must `floor`/`ceil` BEFORE returning, and why `tokens` is *stored in a hash field as a string*, never returned or stored as a bare Lua number. `[CITED: redis.io/docs/.../lua-api — Lua-number→Redis-integer conversion]`

## Conformance Harness Shape (TEST-02 / D2-10) — concrete design (Claude's discretion, resolved)

A single parametrized suite drives identical `(key, cost, now)` sequences against both stores and asserts identical `Decision`s (or identical `OpTuple`s — assert the tuple for tightest parity).

```ts
// test/conformance/sequences.ts — shared fixtures, one array per algorithm.
// Each step is an absolute `now` (ms), a cost, and a stable key.
type Step = { now: number; cost: number; key: string };
type AlgoCase = {
  name: string;
  make: (store: Store, clock: FakeClock) => RateLimiter; // builds the limiter for this algo
  steps: Step[];
};
export const tbCases: AlgoCase[];  // drain/refill/fractional/cost>cap/exact-limit (mirror token-bucket.test.ts)
export const swCases: AlgoCase[];  // include the Xu anchor (limit7/prev5/curr3/50%)
export const fwCases: AlgoCase[];  // include the 2×-boundary-burst sequence
```

```ts
// test/conformance/store-conformance.test.ts
const stores: Array<[name: string, make: () => Promise<{store: Store; teardown: () => Promise<void>}>]> = [
  ["MemoryStore", async () => ({ store: new MemoryStore(), teardown: async () => {} })],
  ["RedisStore",  async () => { /* start container, build RedisStore, teardown stops it */ }],
];

describe.each(stores)("%s conformance", (storeName, makeStore) => {
  describe.each([...tbCases, ...swCases, ...fwCases])("$name", (c) => {
    it("produces the contract Decisions", async () => {
      const { store, teardown } = await makeStore();
      const clock = new FakeClock(0);
      const limiter = c.make(store, clock);
      for (const step of c.steps) {
        clock.setTime(step.now);                 // drive `now` deterministically
        const d = await limiter.consume(step.key, step.cost);
        expect(d).toEqual(expectedFor(c, step)); // SAME expected for both stores
      }
      await teardown();
    });
  });
});
```

Key points:
- **`vitest`'s `describe.each` / `it.each`** is the parametrization mechanism (no new dep). `[CITED: vitest docs — describe.each]` `[ASSUMED: exact API surface — verify against installed vitest ^4.1]`
- Drive `now` via the existing **`FakeClock.setTime`** (not Vitest fake timers) — same path the Phase-1 suites use; the Lua store gets the same `now` via ARGV. Determinism holds across both stores.
- **One Redis container for the whole conformance file** (start in `beforeAll`, stop in `afterAll`), `flushall` (or use unique keys) between cases to isolate state. Starting a container per `it` is too slow.
- Assert the **whole `Decision`** with `toEqual` — any TS↔Lua drift (a floor that should be a ceil, a lost fraction) fails immediately. The expected values are computed once and shared by both store params, which is what makes this a true conformance/parity test.

## Testcontainers Integration & Fault Injection (TEST-03/04/05 / D2-09)

### Lifecycle
```ts
// Source: node.testcontainers.org/modules/redis  [CITED]
import { RedisContainer } from "@testcontainers/redis";
const container = await new RedisContainer("redis:7.4-alpine").start();
const url = container.getConnectionUrl();      // redis://host:port
const client = new Redis(url, { commandTimeout: 75, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
// ... tests ...
await container.stop();
```
- `start()` / `stop()` / `getConnectionUrl()` / `getHost()` / `getPort()` / `getId()` are the confirmed API. `[CITED: node.testcontainers.org]`
- Pin the image tag `redis:7.4-alpine` (matches CLAUDE.md, reproducible).

### "Redis down" (connection refused)
`await container.stop()` (or `restart()` to bring back). With `enableOfflineQueue:false` + `maxRetriesPerRequest:1`, a command against a stopped server errors quickly → breaker records a failure → policy applies. `[VERIFIED: testcontainers stop() semantics]`

### "Redis slow" (commandTimeout breach) — use `pause`, not `stop`
`StartedTestContainer` does NOT expose `pause()/unpause()` directly, but testcontainers runs on **dockerode**, and `docker pause` (Linux cgroups freezer) freezes the container processes **while keeping the TCP socket open** — so an in-flight command hangs and `commandTimeout` (75ms) fires, exactly modeling a slow Redis (a `stop()` would give connection-refused instead, the wrong failure mode). `[CITED: node.testcontainers.org/features/containers + Docker pause docs]`

Concrete mechanism (flag for planner to finalize against installed `testcontainers` 12.0.3 typings):
```ts
// Option A — dockerode directly (most robust):
import Docker from "dockerode";
const docker = new Docker();
await docker.getContainer(container.getId()).pause();    // freeze → commands time out
// ... assert commandTimeout-driven degradation ...
await docker.getContainer(container.getId()).unpause();  // recover → breaker half-opens/closes
```
`dockerode` is a transitive dep of `testcontainers` (already installed); `getContainer().pause()/unpause()` are confirmed dockerode methods. `[CITED: dockerode]` `[ASSUMED: that testcontainers 12 does not add a first-class pause() wrapper — verify; if it does, prefer it.]`

### Concurrency over real Redis (TEST-04)
Reuse the Phase-1 `burst()` helper shape (`test/concurrency.test.ts`) but against `RedisStore` on a real container: fire N >> limit overlapping `consume(sameKey)` with a fixed `now`, assert exactly `limit` admitted. Here the atomicity comes from **single-script Redis execution** (each `rl_*` EVAL runs to completion atomically), not the event loop — this is the distributed half of the Core Value the comment in `concurrency.test.ts` anticipates. Multiple concurrent `Promise.all` ioredis calls on the shared client pipeline to Redis, which serializes the scripts.

### Fault-injection matrix (TEST-05)
Exercise every cell:

| Fault | Mechanism | Policy = fail-open | Policy = fail-closed | Breaker assertion |
|-------|-----------|--------------------|-----------------------|-------------------|
| Down | `container.stop()` | `consume` resolves `allowed:true` | `consume` resolves `allowed:false` | After 5 failures, breaker OPEN → subsequent calls short-circuit (no Redis attempt) within cooldown |
| Slow | `dockerode pause()` | timeout → `allowed:true` | timeout → `allowed:false` | repeated timeouts open the breaker; `unpause()` → half-open probe succeeds → CLOSED |
| Recovery | `unpause()`/`restart()` | back to normal Redis decisions | back to normal | half-open single probe transitions to CLOSED on success |

Assert **no unhandled rejection** in every cell (DEF-02): wrap in `expect(...).resolves` — `RedisStore` must never reject. Use a short breaker `cooldownMs` (e.g. 2000) and `FakeClock`-free real elapsed time, OR inject the breaker's clock so the half-open transition is deterministic (recommended: inject `Clock` into the breaker, advance a `FakeClock` — no `setTimeout` waits in tests).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EVALSHA caching + NOSCRIPT fallback | Manual SHA tracking + retry-on-NOSCRIPT | ioredis `defineCommand` | Auto-handled; the locked reason for ioredis. |
| Per-call timeout | Manual `Promise.race` + `setTimeout` | ioredis `commandTimeout` (75ms) | First-class, throws a clean "Command timed out". A race is the fallback if needed (D2-06). |
| Real-Redis test fixture | docker-compose precondition / scripts | `@testcontainers/redis` | Self-contained `npm test`, no port conflicts. |
| "Redis slow" simulation | tc/netem network shaping, client stub | dockerode `pause()`/`unpause()` | cgroups freeze keeps the socket open → real timeout path; no mocks (D2-09). |
| Fractional-token serialization | custom scaling/bignum | `string.format("%.17g")` + native doubles | Doubles already match JS; scaling would force rewriting `MemoryStore` (D2-02). |

**Build in-tree (small, deep, no library):**
- **Circuit breaker** — ~40-line state machine; adding `opossum`/cockatiel is overengineering for a graded challenge and contradicts the APOSD "deep module" posture in CLAUDE.md. Make its clock injectable (reuse `src/clock.ts`) for deterministic tests.
- **FakeClock** — already exists; reuse for breaker cooldown tests.

**Key insight:** Everything hard here (atomicity, EVALSHA, timeouts, container control, double arithmetic) is provided by ioredis/Redis/testcontainers. The only bespoke code is the line-by-line Lua port (which has a verbatim reference in `memory.ts`) and a tiny breaker.

## Runtime State Inventory

> Phase 2 is greenfield-additive (new `RedisStore` + new tests) plus one interface migration (`Store` ops → async). It is NOT a rename/migration of stored data. Brief inventory for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None at rest — Redis is started fresh per test container; production keys are ephemeral by design (REQUIREMENTS "intentionally ephemeral"). | None |
| Live service config | None — no running services to reconfigure; container is created per test run. | None |
| OS-registered state | None. | None |
| Secrets/env vars | None new required — testcontainers manages the connection URL dynamically; no committed Redis URL/secret. | None |
| Build artifacts | `dist/` will gain `store/redis.*` + the `lua/` assets must be copied into `dist` by tsup. | Add a tsup asset-copy step for `src/store/lua/*.lua` (planner task). |

**Interface migration note (D2-01):** `Store.tokenBucket/slidingWindow/fixedWindow` change return type from `OpTuple` to `Promise<OpTuple>`. This touches `src/types.ts`, `src/store/memory.ts` (wrap returns — or mark methods `async`, but PREFER returning `Promise.resolve(tuple)` / `async` WITHOUT any internal `await` to preserve the synchronous critical section), and the three limiters already `await store.op(...)` so they need no change beyond the type flowing through. Verified: limiters at `src/limiters/*.ts` call `this.store.xxx(...)` and currently destructure synchronously — they must add `await` (currently they do NOT await; line 30 of token-bucket.ts destructures directly). **This is a required edit in all three limiters.**

## Common Pitfalls

### Pitfall 1: Returning a Lua float loses its fraction
**What goes wrong:** A script returns `resetMs = 4999.7` expecting `5000`; Redis truncates to `4999`, breaking parity with `MemoryStore`'s `Math.ceil`.
**Why:** Lua-number → Redis-integer reply truncates toward zero. `[CITED: redis.io lua-api]`
**How to avoid:** Apply `math.floor`/`math.ceil` to every returned value IN the script (the port already does). Persist `tokens` as a `%.17g` string in a hash field — never return it, never store it as a bare number.
**Warning sign:** Off-by-one `resetMs`/`retryAfterMs` diffs in the conformance suite.

### Pitfall 2: `await` leaking into MemoryStore's critical section during the async migration
**What goes wrong:** Refactoring `MemoryStore` ops to `async` and accidentally `await`ing inside re-introduces an interleaving window → over-admission, failing the memory concurrency guard.
**How to avoid:** Keep the body synchronous; only the *return* becomes a resolved promise. The concurrency test (`test/concurrency.test.ts`) must still pass unchanged.
**Warning sign:** `over-admission guard` test admits `limit + k`.

### Pitfall 3: Using `redis.call('TIME')` or `now` drift
**What goes wrong:** Reading server time in Lua makes tests non-deterministic and diverges from the injected `FakeClock` the memory store uses → conformance fails intermittently.
**How to avoid:** `now` is ARGV only (D2-08). Pass `clock.now()` from the limiter; the conformance suite sets it via `FakeClock.setTime`.

### Pitfall 4: `commandTimeout` too tight → false positives in CI
**What goes wrong:** A 50ms timeout trips under CI event-loop lag / cold container, opening the breaker spuriously.
**How to avoid:** Use 75ms (mid-band). Local/same-network Redis answers <5ms (D2-06), so 75ms gives generous headroom while still detecting real slowness. The "slow" fault test uses `pause()` (full hang), which trips any timeout in the band regardless.
**Warning sign:** Flaky happy-path integration tests that intermittently fail-open.

### Pitfall 5: Testcontainers per-test container = slow / flaky suite
**What goes wrong:** Starting a container in each `it` adds seconds and can exhaust Docker.
**How to avoid:** One container per file in `beforeAll`/`afterAll`; isolate state with `flushall` or unique keys per case. Set Vitest `testTimeout` generously (e.g. 30–60s) for the integration files only.

## Code Examples

### Loading a Lua file in ESM and registering it
```ts
// Source: Node ESM import.meta.url + ioredis defineCommand [CITED: ioredis README]
import { readFileSync } from "node:fs";
const TB_LUA = readFileSync(new URL("./lua/token-bucket.lua", import.meta.url), "utf8");
client.defineCommand("rl_tb", { numberOfKeys: 1, lua: TB_LUA });
```

### Token-bucket Lua skeleton (full port target)
```lua
-- Source: line-by-line port of rate-limiter/src/store/memory.ts tokenBucket()
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerInterval = tonumber(ARGV[3])
local intervalMs = tonumber(ARGV[4])
local cost = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1]) or capacity
local lastRefill = tonumber(data[2]) or now

local elapsed = math.max(0, now - lastRefill)
local refilled = math.min(capacity, tokens + (elapsed / intervalMs) * refillPerInterval)
local allowed = (cost <= refilled) and 1 or 0
local tokensAfter = (allowed == 1) and (refilled - cost) or refilled

local remaining = math.floor(tokensAfter)
local resetMs = math.ceil(((capacity - tokensAfter) / refillPerInterval) * intervalMs)
local retryAfterMs = 0
if allowed == 0 then
  local need = math.max(0, cost - refilled)
  retryAfterMs = math.ceil((need / refillPerInterval) * intervalMs)
end

redis.call('HSET', key, 'tokens', string.format('%.17g', tokensAfter), 'lastRefill', now)
local ttl = math.ceil((capacity / refillPerInterval) * intervalMs) + 1
redis.call('PEXPIRE', key, ttl)

return { allowed, remaining, resetMs, retryAfterMs }
```

### Circuit breaker (injectable clock, deterministic test)
```ts
import type { Clock } from "../clock.js";
export class CircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed";
  private failures = 0;
  private openedAt = 0;
  constructor(
    private readonly clock: Clock,
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 2000,
  ) {}
  canAttempt(): boolean {
    if (this.state === "open" && this.clock.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open"; // allow a single probe
    }
    return this.state !== "open";
  }
  recordSuccess(): void { this.state = "closed"; this.failures = 0; }
  recordFailure(): void {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state = "open"; this.openedAt = this.clock.now();
    }
  }
}
```

## State of the Art

| Old / naive Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `INCR` + `EXPIRE` round-trips (read-modify-write race) | Single atomic Lua script per op | No over-admission across concurrent clients (TEST-04). |
| `redis.call('TIME')` for window math | `now` injected as ARGV | Deterministic, testable, TS↔Lua parity. |
| Manual EVALSHA/NOSCRIPT handling | ioredis `defineCommand` | Auto-cached, auto-fallback. |
| `Promise.race`-based timeouts | ioredis `commandTimeout` | First-class, less code. |
| docker-compose Redis for tests | `@testcontainers/redis` | Self-contained `npm test`. |

**Deprecated/outdated for this phase:** none — the locked stack is current (verified 2026-06-24).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TTL formulas (TB = refill-from-empty +1; windows = 2×windowMs +1) | TTL Sizing | Too short drops live state (correctness); reasoned not externally sourced. Low risk — generous bounds. |
| A2 | `%.17g` is the exact persistence format (mechanism locked by D2-02; only the literal format is assumed) | Numeric Parity | If a different format loses precision, parity fails — but `%.17g` is the standard lossless double format. Low risk. |
| A3 | testcontainers 12 has no first-class `pause()` wrapper; use dockerode `getContainer(id).pause()` | Fault Injection | If a wrapper exists, prefer it; pattern still works either way. Verify against installed typings. |
| A4 | tsup must be configured to copy `src/store/lua/*.lua` into `dist` | Project Structure / Runtime State | If missed, the built package can't load scripts. Medium — planner must add the copy step + a build smoke test. |
| A5 | vitest `describe.each`/`it.each` API exact surface | Conformance Harness | Standard vitest feature; verify signature against ^4.1. Low risk. |
| A6 | Breaker defaults: 5 failures / 2000ms cooldown / 1 probe | Circuit Breaker | Tunable; documented defaults are the deliverable, exact numbers are judgment. Low risk. |
| A7 | `commandTimeout: 75` (mid 50–100 band) | Defensive Behavior | Too tight → CI flakiness; 75ms chosen with headroom. Low risk. |

## Open Questions

1. **Does installed `testcontainers` 12.0.3 expose a typed pause/unpause, or must we reach for dockerode?**
   - What we know: `StartedTestContainer` exposes `stop`, `restart`, `getId`; dockerode (transitive) has `pause/unpause`.
   - Recommendation: planner adds a quick spike — try `(container as any).pause` first; fall back to `new Docker().getContainer(container.getId()).pause()`. Either satisfies TEST-05.

2. **Assert `Decision` or raw `OpTuple` in conformance?**
   - Recommendation: assert the full `Decision` (it includes `limit` and is what users see), but ALSO add a direct store-level `OpTuple` parity assertion for the tightest TS↔Lua diff. Both share one expected-value source.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker daemon | testcontainers (TEST-03/04/05) | Must verify on dev/CI machine | — | None — integration/fault tests cannot run without Docker. Conformance vs MemoryStore + unit tests still run. |
| Node.js | runtime/tests | ✓ (project pinned 24.x) | 24.x | — |
| ioredis | RedisStore | ✗ (not yet installed) | install ^5.11 | — |
| @testcontainers/redis | integration tests | ✗ (not yet installed) | install ^12 | — |

**Missing dependencies with no fallback:**
- **Docker daemon** must be running for TEST-03/04/05. If absent in an environment, those suites should be skippable (e.g. a `describe.skipIf(!dockerAvailable)` guard) so `npm run verify` can still gate the rest — but the phase's success criteria require they pass where Docker is present. Flag for planner: add a Docker-availability preflight.

**Missing dependencies with fallback:**
- ioredis / testcontainers — install per the Installation block (expected, not blocking).

## Project Constraints (from CLAUDE.md)

- TypeScript ~5.9 (do NOT jump to 6.0); Node 24; ESM author, dual-build via tsup.
- Core package stays free of Express/ioredis imports — but `RedisStore` is an adapter entry; keep `src/types.ts` free of ioredis (it already is). The ioredis import lives only in `src/store/redis.ts`.
- ioredis ^5.11 via `defineCommand`; `commandTimeout` for the per-call bound.
- Redis 7.4 server, image `redis:7.4-alpine` (pin the tag in testcontainers).
- Vitest ^4.1; use `FakeClock` (NOT vi fake timers) for time-driven store tests, per the established Phase-1 pattern.
- `@testcontainers/redis` ^12 for real Redis; do NOT use `ioredis-mock`, node-redis, off-the-shelf limiters, or a secondary/Postgres store.
- Build-green gate mandatory: `tsc --noEmit` + full Vitest suite pass at the milestone (`npm run verify` posture).
- APOSD deep modules / avoid overengineering — justifies the in-tree breaker over a library.
- Config validated at construction (`src/validate.ts`) — extend for prefix/timeout/policy/breaker config (throw on garbage).

## Sources

### Primary (HIGH confidence)
- `rate-limiter/src/store/memory.ts`, `src/types.ts`, `src/clock.ts`, `src/limiters/*.ts`, `src/validate.ts`, `test/*.test.ts` — the reference implementation, OpTuple/Store contract, rounding contract, and test patterns this phase ports/extends. (codebase, read this session)
- github.com/redis/ioredis README — `defineCommand` auto-EVALSHA + NOSCRIPT fallback, KEYS/ARGV passing, Lua-table→JS-array mapping. `[CITED]`
- redis.github.io/ioredis CommonRedisOptions — `commandTimeout` ("Command timed out"), `connectTimeout` (10000 default), `enableOfflineQueue` (true default), `maxRetriesPerRequest` (20 default). `[CITED]`
- node.testcontainers.org/modules/redis — `RedisContainer` `start/stop/getConnectionUrl/getHost/getPort/getId`. `[CITED]`
- redis.io/docs latest — Lua 5.1 = IEEE-754 doubles; Lua-number→Redis-integer reply truncates; one-to-one type conversion. `[CITED]`
- npm registry (`npm view`, 2026-06-24) — ioredis 5.11.1, @testcontainers/redis 12.0.3, testcontainers 12.0.3. `[VERIFIED: npm registry]`

### Secondary (MEDIUM confidence)
- node.testcontainers.org/features/containers — stop/restart; no first-class pause documented (→ dockerode). `[CITED]`
- WebSearch (cross-verified): dockerode `getContainer(id).pause()/unpause()`; Docker pause = cgroups freezer keeps TCP open (correct "slow" simulation); ioredis `commandTimeout` throws after N ms. `[VERIFIED via multiple sources]`

### Tertiary (LOW confidence — flagged)
- TTL formulas, breaker default numbers, `%.17g` literal, tsup lua-copy requirement — reasoned/judgment, logged in Assumptions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked in CLAUDE.md, versions re-verified 2026-06-24.
- Lua KEYS/ARGV/return layout: HIGH — direct port of read source + confirmed ioredis mapping.
- Numeric parity mechanism: HIGH — Lua-double + ARGV-integers argument is sound and CITED; `%.17g` literal ASSUMED but locked by D2-02.
- TTL values: MEDIUM — reasoned from algorithms + CONTEXT guidance, not externally sourced.
- Conformance harness shape: HIGH — standard vitest `describe.each` over the existing FakeClock pattern.
- Fault injection (down=stop / slow=pause): HIGH for mechanism, MEDIUM for the exact testcontainers-12 pause API surface (A3).
- Breaker design: HIGH for the state machine, defaults are documented judgment (A6).

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable stack; re-verify testcontainers pause API and vitest each-signature against installed versions at plan time)
