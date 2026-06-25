# Phase 3: Express Middleware & HTTP Semantics - Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 7 (4 new source/test + 3 modified build/config)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/adapters/express/middleware.ts` | adapter / middleware | request-response | `src/store/redis.ts` (tier boundary: ONLY framework-importing file) + `src/limiters/token-bucket.ts` (construction validation) | role-match (the symmetric tier-boundary adapter; no existing middleware) |
| `src/adapters/express/headers.ts` | utility (pure transform) | transform | `src/limiters/token-bucket.ts` (Decision-field mapping at the boundary) | partial (no existing pure header/transform helper) |
| `src/adapters/express/index.ts` | barrel / config | n/a | `src/index.ts` (the core barrel) | exact (same barrel pattern, NEW subpath) |
| `src/adapters/express/*.test.ts` (supertest suite) | test | request-response | `test/token-bucket.test.ts` (deterministic Vitest + FakeClock) + `test/degraded.test.ts` (rejecting-stub injection) | role-match (Vitest template; supertest is new) |
| `tsup.config.ts` (modified) | config | n/a | itself (existing single-entry config) | exact |
| `package.json` (modified) | config | n/a | itself (existing `exports` + devDeps) | exact |
| `tsconfig` / build smoke (optional `test/build-smoke.test.ts` extension) | test | n/a | `test/build-smoke.test.ts` | exact |

## Pattern Assignments

### `src/adapters/express/middleware.ts` (adapter / middleware, request-response)

**Analog:** `src/store/redis.ts` (the tier boundary) + `src/limiters/token-bucket.ts` (construction validation)

This is the **symmetric tier-boundary file**: `redis.ts` is the ONLY file in `src/**` that imports ioredis; `middleware.ts` will be the ONLY file (with its siblings under `src/adapters/express/**`) that imports Express. Mirror its file-header comment that names the tier boundary explicitly.

**Tier-boundary header comment** — `src/store/redis.ts` lines 1-16:
```typescript
// The distributed `Store` backed by atomic Redis Lua + a defensive wrapper ...
//
// This is the ONLY file in `src/**` that imports ioredis — the core
// (`types.ts`, the limiters) stays framework/transport-agnostic (the tier
// boundary). ...
```
Apply the symmetric statement: "This is the ONLY tier that imports Express — the core (`types.ts`, the limiters) imports NOTHING from Express."

**Imports pattern** — `src/store/redis.ts` lines 18-30 (type-only imports of core contracts via `.js` ESM specifiers, then named validators):
```typescript
import Redis from "ioredis";
import type {
  Clock,
  OpTuple,
  RedisStoreConfig,
  Store,
  TBConfig,
  WindowConfig,
} from "../types.js";
import { SystemClock } from "../clock.js";
import { assertPolicy, assertPositiveConfig, assertPrefix } from "../validate.js";
```
For the middleware (from `src/adapters/express/`, two levels deep): `import type { RequestHandler, Request, Response } from "express";` then `import type { Decision, RateLimiter, RateLimitPolicy, DegradedLogger } from "../../types.js";` and `import { assertPolicy } from "../../validate.js";`. REUSE `RateLimitPolicy` + `DegradedLogger` — do NOT define new policy/logger types (D3-07/D3-03/D3-08; types.ts lines 115, 127-130).

**Construction-time validation pattern** — `src/limiters/token-bucket.ts` lines 11-22 (validate in the constructor BEFORE any op can run; reuse shared validators from `validate.ts`):
```typescript
constructor(
  private readonly store: Store,
  private readonly cfg: TBConfig,
  private readonly clock: Clock = SystemClock,
) {
  // Validate config at construction (T-01-06): reject non-positive / NaN /
  // non-finite numerics before any op can run with garbage state.
  assertPositiveConfig("TokenBucketLimiter", "capacity", cfg.capacity);
  ...
}
```
The factory `rateLimit(options)` is the analog of "construction": validate `options` at factory-call time — reject a missing `limiter` (`throw new TypeError`), and call `assertPolicy("rateLimit", policy)` (validate.ts lines 45-51) on the resolved policy. This mirrors `redis.ts` lines 89-94 which call `assertPolicy("RedisStore", this.cfg.policy)` right after merging defaults.

**Defaults-merge pattern** — `src/store/redis.ts` lines 55-61 + 84-88 (a `DEFAULT_CONFIG` const spread over caller-supplied partial options):
```typescript
const DEFAULT_CONFIG: RedisStoreConfig = {
  keyPrefix: "rl",
  commandTimeoutMs: 75,
  policy: "fail-open",   // D2-04: availability over strictness by default
  breaker: { failureThreshold: 5, cooldownMs: 2000 },
};
// ...in constructor:
this.cfg = { ...DEFAULT_CONFIG, ...config, breaker: { ...DEFAULT_CONFIG.breaker, ...config.breaker } };
```
Apply for the middleware option defaults: `policy ?? "fail-open"` (D3-07 mirrors the store's `fail-open` default), `headers ?? "both"` (D3-04), `keyGenerator ?? ((req) => req.ip)` (D3-01).

**Fail-open/closed policy pattern** — `src/store/redis.ts` lines 183-225 (`run()` wraps the op in try/catch; on ANY error resolves through the policy and NEVER rejects; edge-triggered degraded `warn`). The middleware applies the SAME policy semantics but at the HTTP edge:
```typescript
private async run(op): Promise<OpTuple> {
  ...
  try {
    const [...] = await op();
    this.breaker.recordSuccess();
    ...
  } catch {
    this.breaker.recordFailure();
    return this.degraded();   // fail-open → admit; fail-closed → deny. Never throws.
  }
}
```
Middleware version (D3-07/D3-08): `try { decision = await limiter.consume(key) } catch (err) { logger?.warn(...); if (policy === "fail-open") return next(); res.status(429)...; }` — catch in the middleware (do NOT leak to Express's async error handler; D3-09).

**Degraded-logging pattern (REUSE `DegradedLogger.warn`)** — `src/store/redis.ts` lines 228-237: `this.cfg.logger.warn({ event, policy, ... }, "message")`. The middleware reuses the SAME `warn(obj, msg)` sink for D3-03 (empty key admit) and D3-08 (limiter error). The logger is OPTIONAL: guard with `options.logger?.warn(...)` exactly as `redis.ts` guards `!this.cfg.logger`.

---

### `src/adapters/express/headers.ts` (utility / pure transform, transform)

**Analog:** `src/limiters/token-bucket.ts` lines 30-43 (straight `Decision`-field mapping, integer-ms boundary) — there is NO existing pure header helper, so this leans on the Decision-mapping convention + RESEARCH §"Header Mapping Table".

**Decision-field straight-through mapping** — `src/limiters/token-bucket.ts` lines 36-43 (map fields straight through, no re-derivation):
```typescript
return {
  allowed: allowed === 1,
  limit: this.cfg.capacity, // D-12
  remaining,
  resetMs,
  retryAfterMs,
};
```
`headers.ts` is the symmetric mapping `Decision → HTTP headers`. D3-06: map `Decision.limit`/`Decision.remaining` straight to headers with NO re-flooring/re-derivation (`remaining` is already a floored integer per D-04).

**Integer-ms → delta-seconds at the very edge** — the `Decision` carries integer ms (`types.ts` lines 47-50: `resetMs`, `retryAfterMs`). Convert with `ceil` ONLY here at the boundary (D-09 / D3-05). Use a single helper `const toSeconds = (ms: number) => Math.ceil(ms / 1000);` and apply it uniformly to `RateLimit`'s `t`, `X-RateLimit-Reset`, and `Retry-After` — ONE unit (delta-seconds), no epoch (D3-05; RESEARCH Pitfall 2).

**Header strings to emit (RESEARCH §"Header Mapping Table", draft-11 List-of-Items):**
```typescript
// IETF draft-11 (NOT the draft-07 dictionary form):
res.setHeader("RateLimit-Policy", `"default";q=${d.limit}${wPart}`);  // wPart = `;w=${windowSeconds}` if supplied, else ""
res.setHeader("RateLimit",        `"default";r=${d.remaining};t=${resetS}`);
// Legacy (delta-seconds reset, NOT epoch — D3-05):
res.setHeader("X-RateLimit-Limit",     String(d.limit));
res.setHeader("X-RateLimit-Remaining", String(d.remaining));
res.setHeader("X-RateLimit-Reset",     String(resetS));
```
All six set on allowed AND rejected; `Retry-After` set ONLY on 429 (RESEARCH §"Header Mapping Table" note). Set headers BEFORE sending the body / calling a `handler` override (RESEARCH Pitfall 5 — avoid `ERR_HTTP_HEADERS_SENT`).

---

### `src/adapters/express/index.ts` (barrel, n/a)

**Analog:** `src/index.ts` (the core barrel)

**Barrel pattern** — `src/index.ts` lines 1-19 (header comment naming the build-entry role, `export type { ... }` for contracts, named runtime exports):
```typescript
// Public API barrel — the single `tsup` entry and `package.json` `exports` target.
export type { ... } from "./types.js";
export { FakeClock, SystemClock } from "./clock.js";
```
The Express barrel is a SECOND build entry / subpath target. Export `{ rateLimit }` from `./middleware.js` plus the public option types (`export type { RateLimitOptions }`). Do NOT add anything Express-related to the core `src/index.ts` (CONTEXT D3 layout; keeps Express out of the core barrel).

---

### `src/adapters/express/*.test.ts` (test, request-response)

**Analog:** `test/token-bucket.test.ts` (deterministic Vitest + FakeClock + MemoryStore) + `test/degraded.test.ts` (rejecting-stub injection for the error path)

**Vitest deterministic-setup pattern** — `test/token-bucket.test.ts` lines 9-21 (import from the built barrel via `../src/index.js`, a `setup()` helper wiring `FakeClock` + `MemoryStore` + a real limiter; advance time ONLY via `clock.tick`, never real timers/sleep):
```typescript
import { describe, expect, it } from "vitest";
import { FakeClock, MemoryStore, TokenBucketLimiter } from "../src/index.js";
function setup(c = cfg) {
  const clock = new FakeClock(0);
  const store = new MemoryStore();
  const limiter = new TokenBucketLimiter(store, c, clock);
  return { clock, store, limiter };
}
```
The supertest suite builds a real `express()` app + the in-memory `TokenBucketLimiter` (no Redis — CONTEXT boundary), and uses a deterministic `keyGenerator: () => "k1"` so `req.ip` flakiness (RESEARCH Pitfall 3) is avoided. Import middleware from the adapter barrel `./index.js`, core from `../../index.js`.

**Rejecting-stub injection for the error path (HTTP-04)** — `test/degraded.test.ts` lines 29-38 (a minimal stub whose calls reject, driving the catch/policy path WITHOUT real infra):
```typescript
function rejectingClient(): Redis {
  const client = {
    defineCommand(name: string): void {
      (client as Record<string, unknown>)[name] = () =>
        Promise.reject(new Error("stub: Redis unavailable"));
    },
  };
  return client as unknown as Redis;
}
```
For HTTP-04 (D3-08), the analog is a stub `RateLimiter` whose `consume` rejects: `const boom: RateLimiter = { consume: () => Promise.reject(new Error("store down")) };` — assert fail-open → 200/`next()` reached, fail-closed → 429, no unhandled rejection (RESEARCH §"Code Examples" HTTP-04).

**Logger-stub assertion pattern** — `test/degraded.test.ts` lines 66-67 (capture `warn(obj,msg)` calls into an array to assert the degraded/skip log fired):
```typescript
const warnings: { obj: Record<string, unknown>; msg: string }[] = [];
const logger = { warn: (obj, msg) => warnings.push({ obj, msg }) };
```
Reuse to verify D3-03 (empty-key admit logs) and D3-08 (limiter-error logs).

---

### `tsup.config.ts` (modified config)

**Analog:** itself (`tsup.config.ts`, the existing single-entry config)

**Add a second entry** — current `tsup.config.ts` line 13 is `entry: ['src/index.ts'],`. Change to `entry: ['src/index.ts', 'src/adapters/express/index.ts'],` (RESEARCH Pattern 3). Everything else (`format: ['esm']`, `dts: true`, `sourcemap`, `clean`, `target: 'node24'`, the `onSuccess` Lua copy lines 19-21) stays UNCHANGED. tsup preserves directory structure: `src/adapters/express/index.ts` → `dist/adapters/express/index.js`.

---

### `package.json` (modified config)

**Analog:** itself (existing `exports` map + `devDependencies`)

**Add the subpath export** — current `exports` (lines 6-11) has only `"."`. Add a `"./express"` key (RESEARCH Pattern 3):
```jsonc
"exports": {
  ".":        { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./express":{ "types": "./dist/adapters/express/index.d.ts", "import": "./dist/adapters/express/index.js" }
}
```

**Add devDeps** — append to `devDependencies` (lines 22-36), matching the existing alphabetized-ish, caret-pinned style: `express@^5.1`, `@types/express@^5`, `supertest@^7.2`, `@types/supertest@^7.2` (supertest ships NO bundled types — RESEARCH §"Supporting"). RESEARCH recommends also declaring `express` as a `peerDependency` (`"express": ">=5"`); planner's call — devDep-only is acceptable for this challenge. Gate the install behind ONE `checkpoint:human-verify` (RESEARCH §"Package Legitimacy Audit").

---

### `test/build-smoke.test.ts` (optional extension)

**Analog:** `test/build-smoke.test.ts` (existing, lines 19-31)

Existing smoke test runs the real `npm run build` and asserts the Lua assets land in `dist`. If the planner wants to guard the new subpath, extend the same pattern to assert `dist/adapters/express/index.js` and `dist/adapters/express/index.d.ts` exist and are non-empty after build (same `fileURLToPath(new URL(..., import.meta.url))` + `readFileSync` shape).

## Shared Patterns

### Tier Boundary (Express confined to the adapter)
**Source:** `src/store/redis.ts` lines 1-16 (the ioredis-only file) + `src/types.ts` lines 1-6 (the "import nothing" mandate)
**Apply to:** ALL `src/adapters/express/**` files (the only place Express may be imported); NEVER `types.ts`, the limiters, or `src/index.ts`.
```typescript
// types.ts lines 4-5:
// This file MUST import nothing from Express or ioredis (tier boundary — the
// core stays framework/transport-agnostic).
```

### Construction-time Validation (REUSE `assertPolicy`)
**Source:** `src/validate.ts` lines 45-51 (`assertPolicy`) + the constructor-validation usage in `src/limiters/token-bucket.ts` lines 18-21 and `src/store/redis.ts` lines 89-94
**Apply to:** the `rateLimit(options)` factory — validate `limiter` presence + `policy` value at factory-call time, before returning the handler.
```typescript
export function assertPolicy(label: string, value: string): void {
  if (value !== "fail-open" && value !== "fail-closed") {
    throw new RangeError(`${label}: \`policy\` must be "fail-open" or "fail-closed", got ${JSON.stringify(value)}`);
  }
}
```

### Reused Core Contracts (no new types)
**Source:** `src/types.ts` — `RateLimiter` (lines 61-63), `Decision` (lines 40-51), `RateLimitPolicy` (line 115), `DegradedLogger` (lines 127-130)
**Apply to:** `middleware.ts` + `headers.ts` import these as `type`-only from `../../types.js`. The middleware depends on `RateLimiter.consume` (the seam), maps `Decision` → headers, reuses `RateLimitPolicy` for D3-07, reuses `DegradedLogger` for D3-03/D3-08. NO new policy or logger type is introduced.

### Fail-open/closed try/catch that never crashes the caller
**Source:** `src/store/redis.ts` lines 183-225 (`run()` + `degraded()`)
**Apply to:** the middleware's `consume()` wrapper — catch the rejection, log via the optional `DegradedLogger`, then apply the policy (`fail-open` → `next()`, `fail-closed` → `429`). Default `fail-open` mirrors the store default (D2-04 → D3-07).

### Integer-ms → delta-seconds conversion at the edge ONLY
**Source:** `src/types.ts` lines 47-50 (`Decision.resetMs`/`retryAfterMs` are integer ms) + D-09 boundary contract
**Apply to:** `headers.ts` — a single `Math.ceil(ms / 1000)` helper for `t`, `X-RateLimit-Reset`, and `Retry-After`. ONE unit, no `Date.now()` in the header path (RESEARCH Pitfall 2).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every new file maps to an established codebase pattern. `middleware.ts`/`headers.ts` are NEW *kinds* of file (no prior Express adapter or pure HTTP-header helper exists), but each has a strong structural analog (the tier-boundary `redis.ts`, the Decision-mapping limiter, the deterministic test suites). Where the codebase has no prior art (exact IETF draft-11 syntax, supertest harness), follow RESEARCH §"Header Mapping Table", §"Code Examples", and Patterns 1-3. |

## Metadata

**Analog search scope:** `rate-limiter/src/**` (all source), `rate-limiter/test/**` (all suites), `rate-limiter/{tsup.config.ts,package.json}`
**Files scanned:** 13 source files + 13 test files; deep-read 9 (`types.ts`, `validate.ts`, `index.ts`, `store/redis.ts`, `limiters/token-bucket.ts`, `clock.ts`, `tsup.config.ts`, `package.json`, `test/token-bucket.test.ts`, `test/degraded.test.ts`, `test/build-smoke.test.ts`)
**Pattern extraction date:** 2026-06-24
