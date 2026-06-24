# Phase 2: Conformance Harness, Redis/Lua Store & Defensive Behavior - Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 14 (8 new, 6 modified)
**Analogs found:** 12 / 14 (2 new file types — `.lua` scripts and `breaker.ts` — have a partial/no direct analog)

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/store/redis.ts` | new | store (adapter) | request-response (network) | `src/store/memory.ts` | role-match (sync→async, in-mem→network) |
| `src/store/breaker.ts` | new | utility (state machine) | event-driven | `src/clock.ts` (injected-clock pattern) | partial (deep module, injectable Clock) |
| `src/store/lua/token-bucket.lua` | new | store-op (Lua port) | transform | `src/store/memory.ts` `tokenBucket()` L56-93 | exact (line-by-line port oracle) |
| `src/store/lua/sliding-window.lua` | new | store-op (Lua port) | transform | `src/store/memory.ts` `slidingWindow()` L104-170 | exact (line-by-line port oracle) |
| `src/store/lua/fixed-window.lua` | new | store-op (Lua port) | transform | `src/store/memory.ts` `fixedWindow()` L180-204 | exact (line-by-line port oracle) |
| `src/types.ts` | mod | contract | — | self (Store interface L87-91) | exact (return type → Promise) |
| `src/store/memory.ts` | mod | store (reference) | CRUD (in-mem) | self | exact (wrap returns in Promise) |
| `src/limiters/token-bucket.ts` | mod | limiter (wrapper) | request-response | self L26-43 | exact (add `await`) |
| `src/limiters/sliding-window.ts` | mod | limiter (wrapper) | request-response | self L22-39 | exact (add `await`) |
| `src/limiters/fixed-window.ts` | mod | limiter (wrapper) | request-response | self L22-39 | exact (add `await`) |
| `src/validate.ts` | mod | utility (validation) | — | self L15-19 (`assertPositiveConfig`) | exact (add prefix/timeout/policy/breaker asserts) |
| `src/index.ts` | mod | barrel | — | self | exact (add RedisStore/CircuitBreaker exports) |
| `test/conformance/sequences.ts` | new | test (fixtures) | — | `test/token-bucket.test.ts` `cfg`/`setup` L13-21 | role-match (fixture extraction) |
| `test/conformance/store-conformance.test.ts` | new | test (parametrized) | — | `test/concurrency.test.ts` (`burst` + dual-store) | role-match |
| `test/redis-integration.test.ts` | new | test (integration) | — | `test/token-bucket.test.ts` | role-match (new: container lifecycle) |
| `test/redis-concurrency.test.ts` | new | test (integration) | — | `test/concurrency.test.ts` (`burst` helper) | exact (reuse `burst` against RedisStore) |
| `test/fault-injection.test.ts` | new | test (fault) | event-driven | `test/concurrency.test.ts` | partial (new: container stop/pause) |
| `tsup.config.ts` | mod | config (build) | — | self | exact (add `.lua` asset copy) |

## Pattern Assignments

### `src/store/redis.ts` (store adapter, request-response)

**Analog:** `src/store/memory.ts` — same `Store` interface, same `OpTuple` boundary, same per-op shape. The difference is async network calls + the defensive wrapper. Keep the public method signatures identical to `MemoryStore` (after the async migration).

**Interface to implement** (from `src/types.ts` L87-91, AFTER the D2-01 async migration — all three return `Promise<OpTuple>`):
```typescript
tokenBucket(key: string, cfg: TBConfig, cost: number, now: number): Promise<OpTuple>;
slidingWindow(key: string, cfg: WindowConfig, cost: number, now: number): Promise<OpTuple>;
fixedWindow(key: string, cfg: WindowConfig, cost: number, now: number): Promise<OpTuple>;
```

**Import convention** (mirror `src/store/memory.ts` L25 — `type`-only import of contracts, `.js` ESM extension):
```typescript
import type { OpTuple, Store, TBConfig, WindowConfig } from "../types.js";
```
The ioredis import lives ONLY in this file (CLAUDE.md tier boundary: core stays ioredis-free). `src/types.ts` must remain ioredis-free.

**Lua loading + defineCommand registration** (RESEARCH §"Loading a Lua file" / Pattern 1 — no codebase analog; this is the new mechanism):
```typescript
import { readFileSync } from "node:fs";
const TB_LUA = readFileSync(new URL("./lua/token-bucket.lua", import.meta.url), "utf8");
const SW_LUA = readFileSync(new URL("./lua/sliding-window.lua", import.meta.url), "utf8");
const FW_LUA = readFileSync(new URL("./lua/fixed-window.lua", import.meta.url), "utf8");
// one shared client (D2-08)
const client = new Redis(url, { commandTimeout: 75, maxRetriesPerRequest: 1, enableOfflineQueue: false });
client.defineCommand("rl_tb", { numberOfKeys: 1, lua: TB_LUA });
client.defineCommand("rl_sw", { numberOfKeys: 1, lua: SW_LUA });
client.defineCommand("rl_fw", { numberOfKeys: 1, lua: FW_LUA });
```

**Key namespacing** (D2-07): `rl:{algo}:{key}` — `rl:tb:<key>`, `rl:sw:<key>`, `rl:fw:<key>`; `rl` prefix configurable.

**Core per-op pattern** — each op: build namespaced key → breaker `canAttempt()` gate → call `rl_*` (KEYS=[key], ARGV=[now, ...cfg, cost]) → on success `recordSuccess()` and return the JS-array tuple as `OpTuple` → on error/timeout `recordFailure()` and resolve through the policy (`degraded(...)`). NEVER reject (DEF-02 — no unhandled rejection; catch all).

**Construction-time validation** — mirror the limiters' constructor pattern (`src/limiters/token-bucket.ts` L17-21): validate prefix/timeout/policy/breaker config in the constructor via the extended `src/validate.ts` helpers, before any op runs.

---

### `src/store/breaker.ts` (utility, event-driven state machine)

**Analog:** `src/clock.ts` — the injected-`Clock` pattern is the load-bearing reuse. The breaker takes a `Clock` in its constructor so cooldown timing is driven by `FakeClock` in tests (no real `setTimeout`).

**Pattern source** (RESEARCH §"Circuit breaker (injectable clock)" L481-505) — copy this skeleton; defaults locked at `failureThreshold=5, cooldownMs=2000, halfOpenMaxProbes=1` (D2-05 / A6):
```typescript
import type { Clock } from "../types.js";
export class CircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed";
  private failures = 0;
  private openedAt = 0;
  constructor(
    private readonly clock: Clock,
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 2000,
  ) {}
  canAttempt(): boolean { /* open + cooldown elapsed → half-open; return state !== "open" */ }
  recordSuccess(): void { this.state = "closed"; this.failures = 0; }
  recordFailure(): void { /* half-open or failures>=threshold → open, openedAt = clock.now() */ }
}
```

**Test-driver pattern** — reuse `FakeClock` (`src/clock.ts` L18-37) exactly as the algorithm tests do: `new FakeClock(0)`, advance with `.tick(ms)`/`.setTime(ms)` to step across the cooldown deterministically. No real timers (CLAUDE.md: use `FakeClock`, NOT vi fake timers).

---

### `src/store/lua/token-bucket.lua` (store-op, transform)

**Analog (parity oracle):** `src/store/memory.ts` `tokenBucket()` **L56-93**. This is a LINE-BY-LINE port (D2-03). Reproduce every `Math.floor`/`Math.ceil` at the identical point.

**The exact TS math to port** (memory.ts L65-86):
```typescript
const elapsed = Math.max(0, now - s.lastRefill);
const refilled = Math.min(cfg.capacity, s.tokens + (elapsed / cfg.intervalMs) * cfg.refillPerInterval);
const allowed = cost <= refilled ? 1 : 0;
const tokensAfter = allowed === 1 ? refilled - cost : refilled;
const remaining = Math.floor(tokensAfter);                                          // FLOOR (D-04)
const deficitToFull = cfg.capacity - tokensAfter;
const resetMs = Math.ceil((deficitToFull / cfg.refillPerInterval) * cfg.intervalMs); // CEIL (D-05)
const need = Math.max(0, cost - refilled);
const retryAfterMs = allowed === 1 ? 0 : Math.ceil((need / cfg.refillPerInterval) * cfg.intervalMs); // CEIL (D-03)
```

**Lua port target** (RESEARCH L446-477) — KEYS[1]=`rl:tb:<key>`; ARGV `[1]=now [2]=capacity [3]=refillPerInterval [4]=intervalMs [5]=cost`. Init `tokens=capacity, lastRefill=now` on missing key. Persist `tokens` as `string.format('%.17g', tokensAfter)` (D2-02 — lossless double round-trip; NEVER a bare Lua number). `PEXPIRE key ceil(capacity/refillPerInterval*intervalMs)+1`. Return `{allowed, remaining, resetMs, retryAfterMs}` — all integers (Pitfall 1: floor/ceil BEFORE return).

---

### `src/store/lua/sliding-window.lua` (store-op, transform) — HIGHEST drift risk

**Analog (parity oracle):** `src/store/memory.ts` `slidingWindow()` **L104-170**. Port verbatim, ESPECIALLY the 3-way `retryAfterMs` branch at **L148-165**.

**The roll logic to port** (memory.ts L109-124): missing → `curr=0,prev=0`; `bucket===bucket` → keep; `bucket-1` → `prev=stored.curr, curr=0`; gap≥2 → `prev=0,curr=0`.

**The estimate + retryAfter branch to port verbatim** (memory.ts L128-165):
```typescript
const elapsedInCurrent = now - bucket * cfg.windowMs;
const overlapFraction = (cfg.windowMs - elapsedInCurrent) / cfg.windowMs;
const flooredEstimate = Math.floor(curr + prev * overlapFraction);   // FLOOR (D-13)
const allowed = flooredEstimate + cost <= cfg.limit ? 1 : 0;
const msToBoundary = (bucket + 1) * cfg.windowMs - now;
const resetMs = Math.ceil(msToBoundary);                             // CEIL (D-05)
// retryAfterMs — reproduce ALL THREE branches:
if (allowed === 1) retryAfterMs = 0;
else if (curr + cost > cfg.limit) retryAfterMs = Math.ceil(msToBoundary);   // CEIL (D-03)
else {
  const overshoot = flooredEstimate + cost - cfg.limit;
  const msToDecayOne = prev > 0 ? cfg.windowMs / prev : msToBoundary;
  retryAfterMs = Math.min(Math.ceil(overshoot * msToDecayOne), Math.ceil(msToBoundary));
}
```

**Lua port** (RESEARCH L224-244) — KEYS[1]=`rl:sw:<key>`; ARGV `[1]=now [2]=limit [3]=windowMs [4]=cost`; HSET `bucket/curr/prev`; `PEXPIRE 2*windowMs+1`. Pin with the Xu fixture (limit=7, prev=5, curr=3, 50% in → admit, remaining=1) — see `test/sliding-window.test.ts` L29-40.

---

### `src/store/lua/fixed-window.lua` (store-op, transform)

**Analog (parity oracle):** `src/store/memory.ts` `fixedWindow()` **L180-204**.

**The math to port** (memory.ts L181-198):
```typescript
const bucket = Math.floor(now / cfg.windowMs);
const count = (prevState && prevState.bucket === bucket) ? prevState.curr : 0;
const allowed = count + cost <= cfg.limit ? 1 : 0;
const countAfter = allowed === 1 ? count + cost : count;
const remaining = Math.max(0, cfg.limit - countAfter);
const msToBoundary = (bucket + 1) * cfg.windowMs - now;
const resetMs = Math.ceil(msToBoundary);                              // CEIL (D-05)
const retryAfterMs = allowed === 1 ? 0 : Math.ceil(msToBoundary);     // CEIL (D-03)
```

**Lua port** (RESEARCH L246-260) — KEYS[1]=`rl:fw:<key>`; ARGV `[1]=now [2]=limit [3]=windowMs [4]=cost`; HSET `bucket/curr` (omit `prev`); `PEXPIRE 2*windowMs+1`. Preserve the 2×-boundary-burst (no smoothing).

---

### `src/types.ts` (contract, MODIFY)

**Change (D2-01):** `Store` interface L87-91 — the three op return types `OpTuple` → `Promise<OpTuple>`. Add new config types for RedisStore (prefix, timeout, `policy: 'fail-open' | 'fail-closed'`, breaker thresholds). KEEP ioredis-free (RESEARCH constraint). `RateLimiter.consume` (L62) is already `Promise<Decision>` — no change. `Clock`/`OpTuple`/`Decision`/`TBConfig`/`WindowConfig` unchanged.

---

### `src/store/memory.ts` (store reference, MODIFY)

**Change (D2-01):** the three ops return `Promise.resolve([...])` instead of `[...]` (or mark `async`). **CRITICAL (Pitfall 2):** do NOT introduce any `await` inside the synchronous read-modify-write critical section (L56-93, L104-170, L180-204). Only the RETURN becomes a resolved promise — the event-loop-atomicity guarantee (header L8-14) stays unchanged. `test/concurrency.test.ts` must still pass unchanged.

Note: `test/concurrency.test.ts` L85/L93 call `store.tokenBucket(...)` directly and index `[0]` synchronously — those direct store calls become `await`/`.then` or the test indexes a Promise. Flag for planner: those two direct-op assertions (L85-94) need updating to `await`.

---

### `src/limiters/{token-bucket,sliding-window,fixed-window}.ts` (limiter wrappers, MODIFY)

**Change (D2-01 / RESEARCH L407):** add `await` before the store op. Current code destructures synchronously:
```typescript
// token-bucket.ts L30-35 (currently NO await — MUST add):
const [allowed, remaining, resetMs, retryAfterMs] = this.store.tokenBucket(key, this.cfg, cost, this.clock.now());
// becomes:
const [allowed, remaining, resetMs, retryAfterMs] = await this.store.tokenBucket(key, this.cfg, cost, this.clock.now());
```
Same one-line edit in all three (`sliding-window.ts` L26, `fixed-window.ts` L26). Constructors, validation, and `Decision` assembly are unchanged. This is a REQUIRED edit in all three.

---

### `src/validate.ts` (validation utility, MODIFY)

**Analog:** self — `assertPositiveConfig` L15-19 and `assertCost` L33-37 are the template. Add new asserts for RedisStore config (prefix non-empty string, timeout in band, policy enum, breaker thresholds positive) in the same throw-on-garbage style:
```typescript
export function assertPositiveConfig(label: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label}: \`${name}\` must be a positive finite number, got ${value}`);
  }
}
```
Reuse `assertPositiveConfig` for numeric breaker/timeout fields; add a small `assertPolicy`/`assertPrefix` for the enum/string fields.

---

### `src/index.ts` (barrel, MODIFY)

Add `export { RedisStore } from "./store/redis.js";` and `export { CircuitBreaker } from "./store/breaker.js";` plus the new config `type` exports, following the existing grouping/comment style (L20-26).

---

### `test/conformance/sequences.ts` + `store-conformance.test.ts` (parametrized tests, NEW)

**Analog:** `test/token-bucket.test.ts` (the `cfg`/`setup` fixture pattern L13-21) + `test/concurrency.test.ts` (dual-store, `burst` helper). Use vitest `describe.each` over `[MemoryStore, RedisStore]` (RESEARCH L289-331). Drive `now` via `FakeClock.setTime` (NOT vi fake timers) — same path as Phase-1 suites. One Redis container per file in `beforeAll`/`afterAll`; isolate cases with `flushall` or unique keys. Assert the whole `Decision` with `toEqual` against a SHARED expected value (catches any TS↔Lua drift). Import from `../src/index.js` (test import convention, see token-bucket.test.ts L10).

---

### `test/redis-concurrency.test.ts` (integration, NEW)

**Analog (exact reuse):** `test/concurrency.test.ts` `burst()` helper L36-42 — fire N≫limit overlapping `consume(sameKey)` with fixed `now`, assert exactly `limit` admitted. Run against `RedisStore` on a real container. The header comment block L1-24 already anticipates this "distributed half" — mirror its framing. Atomicity here comes from single-Lua-script execution, not the event loop.

---

### `test/redis-integration.test.ts` + `test/fault-injection.test.ts` (NEW)

**Analog:** `test/token-bucket.test.ts` structure (describe/it, fresh setup per test). NEW mechanism (no codebase analog — from RESEARCH §Testcontainers): `new RedisContainer("redis:7.4-alpine").start()`, `getConnectionUrl()`, `stop()` (= down), dockerode `getContainer(id).pause()/unpause()` (= slow). Fault matrix (RESEARCH L371-377): down/slow × fail-open/fail-closed × breaker. Assert `expect(...).resolves` everywhere (no unhandled rejection, DEF-02). Inject a `FakeClock` into the breaker for deterministic half-open transitions. Guard with `describe.skipIf(!dockerAvailable)`.

---

### `tsup.config.ts` (build config, MODIFY)

**Analog:** self L6-13. Add a copy step so `src/store/lua/*.lua` lands in `dist/store/lua/` (the `readFileSync(new URL(...))` loader resolves relative to the built module). Options: tsup `onSuccess` cp, a `publicDir`/loader, or a `copy` step (RESEARCH A4). Add a build smoke test that the built package loads the scripts. Keep `format: ['esm']`, `target: 'node24'` unchanged.

---

## Shared Patterns

### Injected Clock (deterministic time)
**Source:** `src/clock.ts` L18-37 (`FakeClock`), `src/types.ts` L15-17 (`Clock`)
**Apply to:** `CircuitBreaker` (cooldown timing), every store op (`now` as a param → Lua ARGV), all time-driven tests.
```typescript
export class FakeClock implements Clock {
  constructor(private t = 0) {}
  now(): number { return this.t; }
  tick(ms: number): this { this.t += ms; return this; }
  setTime(ms: number): this { this.t = ms; return this; }
}
```
Rule: `now` is ALWAYS injected/passed (never `Date.now()` in an op, never `redis.call('TIME')` in Lua). This is what makes TS↔Lua parity hold.

### Construction-time config validation (throw on garbage)
**Source:** `src/validate.ts` L15-19, applied in `src/limiters/token-bucket.ts` L17-21
**Apply to:** `RedisStore` constructor, `CircuitBreaker` (if it validates), extended `validate.ts`.
```typescript
assertPositiveConfig("TokenBucketLimiter", "capacity", cfg.capacity);
```

### OpTuple boundary (integer-ms, identical shape both stores)
**Source:** `src/types.ts` L32 — `[allowed, remaining, resetMs, retryAfterMs]`
**Apply to:** both store ops + all three Lua returns. Fractional state stays internal; only integers cross the boundary. ioredis maps the Lua-integer table → JS number array = `OpTuple` exactly.

### Pinned rounding contract (floor/ceil — bit-for-bit)
**Source:** `src/store/memory.ts` header L16-23 + every outgoing duration
**Apply to:** all three `.lua` scripts.
- `remaining` → `Math.floor` / `math.floor`
- `resetMs` → `Math.ceil` / `math.ceil`
- `retryAfterMs` → `Math.ceil` / `math.ceil` (`0` when allowed)

### Test setup + import convention
**Source:** `test/token-bucket.test.ts` L9-21
**Apply to:** all new test files. Import from `../src/index.js`; fresh `FakeClock(0)` + store + limiter per test via a local `setup()`; advance via `clock.tick`/`clock.setTime`; assert EXACT integers (`expect(...).toBe(...)` / `Number.isInteger`).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/store/lua/*.lua` | store-op | transform | First `.lua` files in the repo. BUT the algorithm logic has an exact line-by-line oracle in `memory.ts` (use that). No analog only for the Lua *syntax* (HMGET/HSET/PEXPIRE/`string.format`) — see RESEARCH §Lua Scripts for the literal target. |
| `test/fault-injection.test.ts` (container control) | test (fault) | event-driven | No existing container/dockerode usage in the repo. Mechanism is wholly new (RESEARCH §Fault Injection: `stop()`=down, dockerode `pause()`=slow). Test *structure* still follows `token-bucket.test.ts`. |

## Metadata

**Analog search scope:** `rate-limiter/src/**` (store, limiters, types, validate, clock, index), `rate-limiter/test/**`, build config (`tsup.config.ts`, `package.json`).
**Files scanned:** 12 source/test/config files read in full or in part.
**Pattern extraction date:** 2026-06-24
