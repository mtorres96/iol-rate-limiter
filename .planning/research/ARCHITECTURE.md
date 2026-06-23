# Architecture Research

**Domain:** Distributed rate limiter (TypeScript/Node.js, pluggable storage, Express adapter)
**Researched:** 2026-06-23
**Confidence:** HIGH (core design follows APOSD + verified Redis/ioredis behavior; algorithm-in-Lua resolution backed by established libraries and Redis docs)

## Standard Architecture

### System Overview

The system is a set of concentric layers. The **core** (algorithms + interfaces) knows nothing about HTTP or Redis. Adapters and stores plug in at the edges. Dependencies point inward only.

```
┌──────────────────────────────────────────────────────────────────┐
│                       TRANSPORT / DEPLOY                           │
│  ┌────────────────┐   ┌────────────────┐   ┌──────────────────┐    │
│  │  Demo Server   │   │ Express adapter│   │ Docker / compose │    │
│  │  (app.ts)      │──▶│  middleware    │   │ (app + redis)    │    │
│  └────────────────┘   └───────┬────────┘   └──────────────────┘    │
│                               │ key extraction, headers, 429       │
├───────────────────────────────┼────────────────────────────────────┤
│                          CORE  ▼  (framework- & transport-agnostic) │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  RateLimiter (strategy interface)                            │  │
│  │    consume(key, cost?) -> Promise<Decision>                  │  │
│  │  ┌─────────────┐ ┌──────────────────┐ ┌──────────────────┐   │  │
│  │  │ TokenBucket │ │ SlidingWindowCtr │ │ FixedWindowCtr   │   │  │
│  │  └──────┬──────┘ └────────┬─────────┘ └────────┬─────────┘   │  │
│  │         │ uses Store + Clock + config           │            │  │
│  └─────────┼────────────────────────────────────────┼──────────┘  │
│            │              Clock (now: () => number)  │             │
├────────────┼──────────────────────────────────────────────────────┤
│            ▼                       STORE  (pluggable persistence)   │
│  ┌──────────────────┐                    ┌───────────────────────┐ │
│  │ MemoryStore      │                    │ RedisStore            │ │
│  │ (Map, in-process)│                    │ (ioredis + Lua/EVALSHA)│ │
│  └──────────────────┘                    └───────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `RateLimiter` (interface) | The strategy contract. One method: `consume(key, cost?) -> Promise<Decision>`. Narrow interface, deep meaning. | TypeScript interface in `core/` |
| Algorithm classes | Encode the *policy* (refill math, window math, limit checks). Hold config (capacity, refillRate, windowMs). | `TokenBucket`, `SlidingWindowCounter`, `FixedWindowCounter` |
| `Store` (interface) | The *mechanism* contract: atomically apply one algorithm step to persisted state and return the result. Narrow, algorithm-aware operations (not generic get/set). | TypeScript interface in `store/` |
| `MemoryStore` | Single-process state in a `Map`. Atomic by virtue of the Node event loop. Runs algorithm math in TS. | `store/memory.ts` |
| `RedisStore` | Cross-process state in Redis. Runs algorithm math **inside Lua** for atomicity. Manages EVALSHA/script loading, timeouts, fail-open/closed. | `store/redis.ts` + `*.lua` |
| `Clock` | Single source of "now" (ms). Injectable for deterministic tests. | `core/clock.ts` |
| Express middleware adapter | Translate HTTP↔core: extract client key, call `consume`, set headers, return 429 or `next()`. Owns all HTTP knowledge. | `express/middleware.ts` |
| Demo server | Wire a real algorithm + store + middleware to an Express app to exercise the system. | `demo/server.ts` |
| Config | Validate + normalize limiter options; build the wired limiter. | `core/config.ts` |

## Recommended Project Structure

```
rate-limiter/
├── src/
│   ├── core/
│   │   ├── rate-limiter.ts      # RateLimiter interface + Decision type
│   │   ├── clock.ts             # Clock interface + systemClock + fakeClock
│   │   ├── config.ts            # options validation + limiter factory
│   │   └── errors.ts            # StoreUnavailableError, etc.
│   ├── algorithms/
│   │   ├── token-bucket.ts      # TokenBucket (TS math + Lua name + arg mapping)
│   │   ├── sliding-window.ts    # SlidingWindowCounter
│   │   ├── fixed-window.ts      # FixedWindowCounter
│   │   └── lua/                 # one .lua per algorithm (loaded as strings)
│   │       ├── token-bucket.lua
│   │       ├── sliding-window.lua
│   │       └── fixed-window.lua
│   ├── store/
│   │   ├── store.ts             # Store interface
│   │   ├── memory.ts            # MemoryStore
│   │   └── redis.ts             # RedisStore (ioredis, EVALSHA, timeouts)
│   ├── express/
│   │   └── middleware.ts        # rateLimit(limiter, { keyGenerator, ... })
│   └── index.ts                 # public exports (the package surface)
├── demo/
│   └── server.ts
├── test/                        # Vitest: algorithm, store, middleware, integration
├── Dockerfile
├── docker-compose.yml
└── DESIGN.md
```

### Structure Rationale

- **`core/` vs `algorithms/` vs `store/`:** separates the *contract* (core) from *policy* (algorithms) from *mechanism* (store). This is the APOSD "deep module" boundary: the interfaces are tiny; the implementations behind them are substantial.
- **`algorithms/lua/`:** Lua scripts live next to the TS algorithm that owns them, not inside the store. The store executes scripts; it does not author them. This keeps "what the algorithm does" in one place even when the execution substrate differs (see the central tension below).
- **`express/` isolated:** the only folder that imports Express. Deleting it must not break `core/`, `algorithms/`, or `store/`. This is the litmus test for "framework-agnostic core."

## The Two Key Interfaces

### Interface 1: `RateLimiter` (the strategy contract)

```typescript
export interface Decision {
  allowed: boolean;
  limit: number;        // X-RateLimit-Limit
  remaining: number;    // X-RateLimit-Remaining
  resetAfterMs: number; // -> X-RateLimit-Reset (epoch or delta, pick one and document)
  retryAfterMs?: number;// Retry-After, set when !allowed
}

export interface RateLimiter {
  consume(key: string, cost?: number): Promise<Decision>;
}
```

This is a deep, narrow interface: one verb, a rich return value. Every algorithm and the middleware depend only on this. `cost` defaults to 1 (token bucket can charge variable weight). `Decision` carries everything the middleware needs to build headers — the middleware never recomputes limit math.

### Interface 2: `Store` (the state-mechanism contract)

The hard design decision. A naive `Store` exposes `get/set/incr/expire`. **Reject this.** Generic primitives force the read-modify-write cycle into TypeScript, which is racy across processes and forces the Redis store to do multiple round-trips. Instead, the `Store` interface is *algorithm-shaped*: it exposes one atomic operation per algorithm step, and the store guarantees atomicity however it can.

```typescript
export interface Store {
  // Atomically run one token-bucket step against the stored state for `key`.
  // Returns the post-step state the algorithm needs to build a Decision.
  tokenBucket(key: string, args: TokenBucketArgs): Promise<TokenBucketResult>;

  slidingWindow(key: string, args: SlidingWindowArgs): Promise<SlidingWindowResult>;
  fixedWindow(key: string, args: FixedWindowArgs): Promise<FixedWindowResult>;
}
```

Args carry config + `now` + `cost` (all the dynamic inputs); results carry the new counts/timestamps. The algorithm class is thin: it owns config + `Decision` construction; the *atomic mutation* lives in the store.

## The Central Tension: Algorithm-in-Lua vs Algorithm-in-TS

**The problem.** For Redis correctness, the entire read-decide-write cycle (refill tokens, check capacity, deduct) MUST execute atomically inside a single Lua script — otherwise concurrent processes race and over-admit (verified: Redis runs Lua atomically, no other command interleaves). But for the in-memory store, the same logic is naturally written in TypeScript and is atomic for free because Node's event loop never preempts synchronous code mid-function. So the *same algorithm* must exist in two languages/runtimes. Naive solutions duplicate the math and let the two implementations drift — a correctness and review hazard.

**Resolution: "one algorithm, two execution substrates; the algorithm owns both."**

Treat each algorithm as a module that owns *two equivalent encodings of the same step function*: a TS function and a Lua script. The `Store` is a dumb executor that does not know rate-limiting math.

1. **MemoryStore** receives the algorithm's TS step function (or the algorithm calls the store's plain `get/setState` and runs math itself in-process — safe because single-threaded). Math runs in TS.
2. **RedisStore** receives the algorithm's Lua script name + the argument vector, and `EVAL`s it. Math runs in Lua. The store only marshals args and parses the reply.

Concretely, an algorithm exports a descriptor:

```typescript
// token-bucket.ts
class TokenBucket implements RateLimiter {
  constructor(private store: Store, private clock: Clock, private cfg: TokenBucketConfig) {}

  async consume(key: string, cost = 1): Promise<Decision> {
    const now = this.clock.now();
    // Store decides HOW to run the step atomically (TS math vs Lua);
    // the algorithm supplies config + now + cost and interprets the result.
    const r = await this.store.tokenBucket(key, { ...this.cfg, now, cost });
    return toDecision(r, this.cfg);
  }
}
```

- `MemoryStore.tokenBucket` runs the refill/deduct math in TS inside one synchronous critical section.
- `RedisStore.tokenBucket` calls the `token-bucket.lua` script with the same numbers as `ARGV`.

**Keep the two encodings honest.** The single most important defense against drift: a **shared conformance test suite** that runs the *identical* sequence of `(key, cost, now)` calls against both `MemoryStore` and `RedisStore` and asserts byte-identical `Decision` results. The TS implementation is the readable reference; the Lua is the distributed implementation; the test proves they agree. This is cheaper and more robust than trying to transpile or share code across the runtime boundary (don't — transpiling JS→Lua is "AI slop" overengineering for three small scripts).

**Where the line sits, explicitly:**

| Concern | Lives in | Why |
|---------|----------|-----|
| Config (capacity, refillRate, windowMs) | Algorithm class | Policy belongs with the strategy |
| `now`, `cost`, key | Passed as args | Dynamic inputs, injectable for tests |
| Refill/window math (TS) | MemoryStore step | Atomic via event loop |
| Refill/window math (Lua) | `algorithms/lua/*.lua` | Atomic via Redis script execution |
| `Decision` construction | Algorithm class | Single place builds headers' data |
| EVALSHA caching, timeouts, fail-open/closed | RedisStore | Mechanism/infra concern, not policy |

## Data Flow

### Single request: middleware → limiter → store → decision → headers

```
HTTP request
   │
   ▼
Express middleware
   │  1. keyGenerator(req) -> "ip:1.2.3.4" (or apiKey, userId)
   │  2. await limiter.consume(key, cost=1)
   ▼
RateLimiter (e.g. TokenBucket)
   │  3. now = clock.now()
   │  4. await store.tokenBucket(key, { capacity, refillRate, now, cost })
   ▼
Store
   │  MemoryStore: read Map, run TS math, write Map      (atomic: event loop)
   │  RedisStore:  EVALSHA token-bucket.lua key ARGV...  (atomic: Redis)
   │               on NOSCRIPT -> SCRIPT LOAD -> retry
   │               on timeout/error -> fail-open or fail-closed per config
   │  -> returns { allowed, remaining, resetAfterMs, ... }
   ▼
RateLimiter -> toDecision() -> Decision
   ▼
Express middleware
   │  5. set X-RateLimit-Limit / -Remaining / -Reset
   │  6. if !allowed: set Retry-After, res.status(429).end()
   │  7. else: next()
   ▼
downstream handler / 429 response
```

Direction is strictly inward on the way down (HTTP → core → store) and the `Decision` value object flows back out. The middleware is the *only* component that touches `req`/`res`.

## Concurrency Model

This is the heart of the challenge and must be addressed precisely.

**In-memory store — Node single-threaded event loop.** JavaScript runs one synchronous call stack. A function that reads the bucket from a `Map`, computes refill, and writes back — *with no `await` in the critical section* — cannot be interrupted by another request. There is no true concurrency to guard against in a single process. **Therefore the MemoryStore needs no locks, no mutexes, no atomics** — provided the read-modify-write is synchronous (do not `await` between read and write). This is the elegant, correct, non-overengineered answer; adding a mutex here would be AI slop. Caveat to document: this guarantee is *per-process* and evaporates the moment you run two Node processes — which is exactly why Redis exists.

**Redis store — true cross-process races.** Multiple app instances (or PM2 cluster workers) hit one Redis. A read-then-write split across two round-trips (GET, then SET) interleaves between processes and over-admits. The fix is atomicity *inside Redis*: one Lua script does read+decide+write as an indivisible server-side operation (verified: Redis executes Lua atomically). This is the only place real concurrency control is needed, and it's handled by the substrate, not by application locking.

**Net:** concurrency control appears in exactly one place (the Lua script), justified by a real cross-process race. The in-memory path relies on a documented language guarantee. This matches the brief's "concurrency only where needed."

## Time Handling

**Single source of now, injected everywhere.** Define a `Clock`:

```typescript
export interface Clock { now(): number; } // epoch ms
export const systemClock: Clock = { now: () => Date.now() };
export class FakeClock implements Clock {
  constructor(private t = 0) {}
  now() { return this.t; }
  advance(ms: number) { this.t += ms; }
}
```

The algorithm reads `now` from the clock and **passes it down into the store as an argument** — including into Redis as a Lua `ARGV`. Critically: **do NOT call `redis.call('TIME')` inside the Lua script.** Verified rationale: `TIME` is non-deterministic; historically Redis refused write commands after it, and even with modern effects-replication the deterministic, testable choice is to compute `now` in Node and pass it in. This unifies the time story: *both* stores get time from the same injected `Clock`, so the conformance test (above) can drive both with a `FakeClock` and assert identical behavior at controlled timestamps. This makes time-edge tests (refill boundaries, window rollover) deterministic and fast.

One caveat to document: passing client time means clock skew across app servers can slightly affect Redis decisions. For this prototype that's an accepted, documented tradeoff; the alternative (server `TIME`) trades testability and determinism for skew-immunity. Note it in DESIGN.md.

## Suggested Build Order

Dependencies point inward, so build inside-out. Each step is independently testable.

1. **`core/` contracts + `Clock`** — `RateLimiter`, `Decision`, `Store` interfaces, `Clock`/`FakeClock`. No logic, but unblocks everything. (Foundation.)
2. **`MemoryStore` + algorithms (TS math)** — implement the three algorithms against `MemoryStore`. Test exhaustively with `FakeClock`: refill, burst, window rollover, `cost`. This is the *reference correctness*. **This is the core-value deliverable — do it first and thoroughly.**
3. **Conformance test harness** — a parametrized Vitest suite that runs a fixed call sequence against any `Store`. Initially only MemoryStore passes. Authoring it now defines the contract Redis must meet.
4. **`RedisStore` + Lua scripts** — write the three `.lua` scripts, EVALSHA/load handling via ioredis `defineCommand` (auto-EVALSHA with NOSCRIPT→EVAL fallback, verified). Make it pass the *same* conformance suite. Then add timeouts + fail-open/closed.
5. **Express middleware adapter** — key extraction, header building, 429. Test with `MemoryStore` (fast, no Redis needed).
6. **Demo server + Docker/compose** — wire it together; compose app + Redis; smoke/integration test.
7. **DESIGN.md** — written last, capturing the decisions above.

### What can be built in parallel

- After step 1, **algorithms (step 2)** and the **Express adapter (step 5)** can be developed in parallel — the adapter only needs the `RateLimiter` interface and can be tested against a trivial stub or `MemoryStore`.
- The **three algorithms** are independent of each other; parallelizable.
- **Docker/compose** scaffolding can be prepared anytime after step 1.
- **`RedisStore` (step 4)** depends on the conformance harness (step 3) and the Lua-equivalent math (which is derived from the step-2 TS reference) — so it should follow, not lead.

## Logging / Metrics — Without Polluting the Core

Keep the core free of `console`/logger/metrics imports. Two clean hooks:

1. **Decision is observable by construction.** The middleware already has the `Decision` and the key. Emit metrics (allowed/denied counts, remaining) and logs *in the adapter*, where the request context lives. The core stays pure.
2. **Optional injected hooks for store internals.** If you must observe inside (e.g. Redis fail-open events, EVALSHA cache misses, latency), inject an optional callback/event-emitter into `RedisStore` (`onStoreError?`, `onLatency?`). Default no-op. This keeps observability opt-in and dependency-free in the core. Prefer a tiny interface over importing a logging framework.

Avoid: sprinkling `logger.info` through algorithms, or making the `Store` depend on a metrics client. Both couple policy to infrastructure and are classic overengineering smells for a challenge of this size.

## Architectural Patterns

### Pattern 1: Strategy + narrow interface (RateLimiter)
**What:** all algorithms hide behind one `consume()`. **When:** swapping algorithms without touching callers. **Trade-off:** the `Decision` must be rich enough for every algorithm — design it once, carefully.

### Pattern 2: Algorithm-aware Store (not generic KV)
**What:** the store exposes per-algorithm atomic ops, not get/set. **When:** correctness requires atomic read-modify-write across processes. **Trade-off:** adding an algorithm touches the `Store` interface — acceptable for a fixed small set; would not scale to dozens of algorithms (not a goal here).

### Pattern 3: Ports & adapters (hexagonal-lite)
**What:** core defines ports (`Store`, `Clock`, `RateLimiter`); Redis/Express/system-clock are adapters. **When:** keeping core testable and framework-free. **Trade-off:** a little extra indirection; pays for itself in test speed and APOSD clarity.

## Anti-Patterns

### Anti-Pattern 1: Generic get/set/incr Store
**What people do:** model the store as a generic cache and run rate-limit math in TS for both backends. **Why wrong:** the Redis path becomes multi-round-trip and racy. **Instead:** algorithm-shaped atomic store ops; math in Lua for Redis.

### Anti-Pattern 2: `redis.call('TIME')` inside the Lua script
**What people do:** read time server-side for "accuracy." **Why wrong:** non-deterministic, untestable, historically replication-unsafe. **Instead:** inject `now` from the `Clock` and pass as `ARGV`.

### Anti-Pattern 3: Mutex/lock around the in-memory store
**What people do:** add async-mutex to "be safe." **Why wrong:** Node is single-threaded; a synchronous critical section is already atomic. It's complexity with zero benefit (AI slop). **Instead:** keep read-modify-write synchronous (no `await` mid-section) and document the per-process guarantee.

### Anti-Pattern 4: Express types leaking into core
**What people do:** import `Request` in an algorithm to read an IP. **Why wrong:** breaks framework-agnosticism. **Instead:** middleware extracts the key and passes a `string` to `consume`.

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| 1 process (dev/tests) | MemoryStore is sufficient and fastest. |
| N app instances, 1 Redis | RedisStore + Lua atomicity. Connection pool sized to instances; per-call timeout + fail-open/closed. This is the target architecture. |
| Redis as bottleneck | Out of scope per PROJECT.md (no clustering/sharding). Note as a documented limit, not a build target. |

**First bottleneck:** Redis round-trip latency on the hot path — mitigated by single-round-trip Lua (already in the design) and a connection pool. **Second:** Redis as SPOF — mitigated only by the fail-open/closed policy (availability vs correctness tradeoff), which the brief explicitly wants documented.

## Integration Points

| Boundary | Communication | Notes |
|----------|---------------|-------|
| middleware ↔ RateLimiter | direct call, `consume()` | only interface the adapter knows |
| RateLimiter ↔ Store | direct call, per-algorithm op | store atomicity is the contract |
| RedisStore ↔ Redis | ioredis `defineCommand` (EVALSHA, NOSCRIPT→EVAL) | timeouts + fail policy here |
| app ↔ Redis (deploy) | docker-compose service link | compose wires app + redis |

## Sources

- Redis rate limiter use-case + Lua atomicity — https://redis.io/docs/latest/develop/use-cases/rate-limiter/ (HIGH)
- Redis scripting (EVAL/EVALSHA, atomic execution, determinism) — https://redis.io/docs/latest/develop/programmability/eval-intro/ (HIGH)
- Single-script rate limiting (read-decide-write atomicity) — https://oneuptime.com/blog/post/2026-03-31-redis-how-to-implement-rate-limiting-in-a-single-redis-lua-script/view (MEDIUM)
- ioredis Lua scripting / defineCommand auto-EVALSHA — https://ioredis.com/does-ioredis-support-lua-scripting/ (MEDIUM)
- Pass timestamp as arg, avoid TIME in scripts — https://groups.google.com/g/redis-db/c/vYJhKhVu3Lc (MEDIUM) and https://oneuptime.com/blog/post/2026-03-31-redis-handle-time-and-randomness-in-redis-lua-scripts/view (MEDIUM)
- APOSD (deep modules / narrow interfaces) — Ousterhout, *A Philosophy of Software Design* (HIGH, foundational)

---
*Architecture research for: distributed rate limiter (TS/Node, pluggable store, Express adapter)*
*Researched: 2026-06-23*
