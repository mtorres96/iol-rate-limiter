# Phase 1: Core, Algorithms & In-Memory Reference - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 17 files to be created (greenfield bootstrap)
**Analogs found:** 0 / 17 in-repo code analogs — **all analogs are CONVENTION-BASED**

> **GREENFIELD NOTICE.** The repo contains only `.planning/`, `CLAUDE.md`, and the
> challenge PDF. There is **no existing source code**, so there are **no in-repo code
> analogs** to copy from. Every "analog" below is a **convention source** — a specific
> section of `CLAUDE.md` (locked stack/pins) or `01-RESEARCH.md` (locked decisions
> D-01..D-14 and implementation patterns). The planner should treat the cited
> CLAUDE.md section / RESEARCH.md Pattern as the file's authoritative pattern, exactly
> as it would treat an existing-code analog in a brownfield repo. Code excerpts below
> are drawn from `01-RESEARCH.md` "Code Examples" / "Architecture Patterns" — they are
> the **reference shapes to copy**, not pre-existing repo code.

All paths are relative to the `/rate-limiter` package root (DELIV-05): the entire
deliverable lives under `/rate-limiter/`.

---

## File Classification

| New File | Role | Data Flow | Convention Source (analog) | Match Quality |
|----------|------|-----------|----------------------------|---------------|
| `rate-limiter/package.json` | config (package manifest) | n/a | RESEARCH "Code Examples → package.json"; CLAUDE.md "Installation" + stack pins | convention-exact |
| `rate-limiter/tsconfig.json` | config (TS compiler / gate) | n/a | RESEARCH "Code Examples → tsconfig.json"; CLAUDE.md "tsconfig posture" | convention-exact |
| `rate-limiter/tsup.config.ts` | config (build) | n/a | RESEARCH "Code Examples → tsup.config.ts"; CLAUDE.md tsup pin | convention-exact |
| `rate-limiter/vitest.config.ts` | config (test runner) | n/a | RESEARCH "Code Examples → vitest.config.ts"; CLAUDE.md Vitest pin | convention-exact |
| `rate-limiter/eslint.config.js` | config (lint, flat) | n/a | RESEARCH "Code Examples → eslint.config.js"; CLAUDE.md ESLint 10 flat | convention-exact |
| `rate-limiter/.prettierrc` | config (format) | n/a | CLAUDE.md Prettier `^3.8` + eslint-config-prettier | convention-exact |
| `rate-limiter/.nvmrc` | config (node version) | n/a | CLAUDE.md "Node 24 LTS / `.nvmrc`" | convention-exact |
| `rate-limiter/src/index.ts` | barrel / public API surface | re-export | RESEARCH "Recommended Project Structure" (index = public barrel) | convention-exact |
| `rate-limiter/src/types.ts` | interface/type defs | n/a (contracts) | RESEARCH Pattern 1/2/3 + CONTEXT D-01..D-12 (Decision, Store, RateLimiter, Clock, configs) | convention-exact |
| `rate-limiter/src/clock.ts` | utility (time source) | request-response (`now(): int ms`) | RESEARCH Pattern 2 (Clock + FakeClock); CONTEXT D-09, CORE-03 | convention-exact |
| `rate-limiter/src/store/memory.ts` | store op (3 algorithm ops) | transform (state→tuple, atomic) | RESEARCH Pattern 1; CONTEXT D-06/D-08/D-09/D-10/D-13 | convention-exact |
| `rate-limiter/src/limiters/token-bucket.ts` | limiter (thin wrapper) | request-response | RESEARCH Pattern 3; CONTEXT D-07/D-10/D-12 | convention-exact |
| `rate-limiter/src/limiters/sliding-window.ts` | limiter (thin wrapper) | request-response | RESEARCH Pattern 3; CONTEXT D-07/D-11/D-13/D-14 | convention-exact |
| `rate-limiter/src/limiters/fixed-window.ts` | limiter (thin wrapper) | request-response | RESEARCH Pattern 3; CONTEXT D-07/D-11; Pitfall 4 (boundary burst) | convention-exact |
| `rate-limiter/test/token-bucket.test.ts` | test | n/a | RESEARCH Pattern 2 + Pitfall 3; CONTEXT D-01/D-02/D-10; TEST-01 | convention-exact |
| `rate-limiter/test/sliding-window.test.ts` | test | n/a | RESEARCH "Sliding Window worked example as a test"; CONTEXT D-13/D-14 | convention-exact |
| `rate-limiter/test/fixed-window.test.ts` | test | n/a | RESEARCH Pitfall 4 (demonstrate 2× boundary burst); CONTEXT discretion / ALGO-03 | convention-exact |
| `rate-limiter/test/concurrency.test.ts` | test (event-loop atomicity proof) | event-driven (N overlapping `Promise.all`) | RESEARCH Pitfall 2; CLAUDE.md "Testing time + concurrency"; TEST-04 (memory half) | convention-exact |

> The `test/` directory is **separate from `src/`** (RESEARCH Open Question 3 recommendation:
> cleaner `src`, simpler tsup entry). Planner picks final layout but must stay consistent.

---

## Pattern Assignments

### `rate-limiter/src/types.ts` (interface/type defs)

**Convention source:** RESEARCH Patterns 1–3 + CONTEXT D-01..D-12. This is the seam file —
Phase 2 (RedisStore + conformance) and Phase 3 (Express middleware) both depend on these
exact shapes. Keep it import-free (no Express/ioredis — RESEARCH "Tier boundary to protect").

**Core contract shapes to define** (assembled from RESEARCH Pattern 1/3 excerpts):
```typescript
// Clock — CORE-03 / D-09 (integer ms)
export interface Clock { now(): number; }

// Op tuple — D-08: Store ops return a primitive numeric tuple, NOT a Decision.
// Identical shape to a Lua EVAL return → zero TS↔Lua representation mismatch (TEST-02).
export type OpTuple = [allowed: 0 | 1, remaining: number, resetMs: number, retryAfterMs: number];

// Public Decision — CORE-02 / D-04 / D-05 / D-12 (limiter assembles this from the tuple)
export interface Decision {
  allowed: boolean;
  limit: number;        // D-12: capacity (TB) or limit (windows)
  remaining: number;    // D-04: floored integer
  resetMs: number;      // D-05: time until full replenishment
  retryAfterMs: number; // D-03: 0 when allowed
}

// RateLimiter — CORE-01 (async wrapper; cost optional, default 1)
export interface RateLimiter { consume(key: string, cost?: number): Promise<Decision>; }

// Store — CORE-04 / D-06: ONE atomic op per algorithm, NOT generic get/set.
// Each op IS the algorithm; returns OpTuple.
export interface Store {
  tokenBucket(key: string, cfg: TBConfig, cost: number, now: number): OpTuple;
  slidingWindow(key: string, cfg: WindowConfig, cost: number, now: number): OpTuple;
  fixedWindow(key: string, cfg: WindowConfig, cost: number, now: number): OpTuple;
}

// Config shapes — D-10 / D-11
export interface TBConfig { capacity: number; refillPerInterval: number; intervalMs: number; }
export interface WindowConfig { limit: number; windowMs: number; }
```

**Anti-patterns to reject** (RESEARCH "Anti-Patterns to Avoid"):
- Generic `get/set` Store with math in the limiter (violates CORE-04/D-06).
- Returning `Decision` from a Store op (violates D-08 — op returns the tuple).

---

### `rate-limiter/src/clock.ts` (utility, time source)

**Convention source:** RESEARCH Pattern 2 (the recommended time strategy — chosen OVER
`vi.useFakeTimers()`, see Pitfall 1). CONTEXT D-09 (integer ms), CORE-03.

**Reference shape to copy** (RESEARCH Pattern 2):
```typescript
export interface Clock { now(): number; }                 // ms, integer (re-export or import from types.ts)
export const SystemClock: Clock = { now: () => Date.now() };

export class FakeClock implements Clock {
  constructor(private t = 0) {}
  now() { return this.t; }
  tick(ms: number) { this.t += ms; return this; }          // advance manually — no real timers
  setTime(ms: number) { this.t = ms; return this; }
}
```
**Notes:** `SystemClock` is shipped as the default limiter constructor arg (RESEARCH Open
Question 2) so limiters work without passing a clock; wall-clock behavior is **not** tested,
only the injected `FakeClock` path. `FakeClock` is the **one custom abstraction this phase
should hand-roll** (RESEARCH "Don't Hand-Roll").

---

### `rate-limiter/src/store/memory.ts` (store op — the reference implementation)

**Convention source:** RESEARCH Pattern 1; CONTEXT D-06/D-08/D-09/D-10/D-13/D-14.
This is the human-readable **reference impl** that the Phase-2 Lua script is a near
line-by-line port of (CONTEXT "specific ideas"). Optimize for clarity over cleverness
(APOSD deep module). State lives in a `Map<key, AlgoState>`.

**Op structure to copy — the 5-step atomic critical section** (RESEARCH diagram):
1. load state for key (or init defaults)
2. apply algorithm math with `now`
3. decide allow/reject (D-01 all-or-nothing)
4. write new state IF allowed (reject leaves state byte-identical — D-01)
5. return primitive tuple `[allowed, remaining, resetMs, retryAfterMs]`

**Token Bucket op — reference shape** (RESEARCH Pattern 1):
```typescript
type TBState = { tokens: number; lastRefill: number };

function tokenBucket(state: TBState | undefined, cfg: TBConfig, cost: number, now: number) {
  const s = state ?? { tokens: cfg.capacity, lastRefill: now };
  const elapsed = Math.max(0, now - s.lastRefill);                                  // recompute from integer now (no drift accumulation — Pitfall 3)
  const refilled = Math.min(cfg.capacity, s.tokens + (elapsed / cfg.intervalMs) * cfg.refillPerInterval); // lazy refill D-10
  const allowed = cost <= refilled ? 1 : 0;                                          // all-or-nothing D-01; cost>capacity → 0, no throw D-02
  const tokensAfter = allowed ? refilled - cost : refilled;                          // reject leaves value unchanged D-01
  const remaining = Math.floor(tokensAfter);                                         // D-04: FLOOR remaining
  const deficitToFull = cfg.capacity - tokensAfter;
  const resetMs = Math.ceil((deficitToFull / cfg.refillPerInterval) * cfg.intervalMs);  // D-05: CEIL (never under-report)
  const need = Math.max(0, cost - refilled);
  const retryAfterMs = allowed ? 0 : Math.ceil((need / cfg.refillPerInterval) * cfg.intervalMs); // D-03: CEIL
  const next: TBState = { tokens: tokensAfter, lastRefill: now };
  return { tuple: [allowed, remaining, resetMs, retryAfterMs] as OpTuple, next };
}
```

**Sliding Window op — pinned math** (CONTEXT D-13/D-14; RESEARCH Sliding Window example):
- `overlapFraction = (windowMs - elapsedInCurrent) / windowMs`
- `estimate = curr + prev * overlapFraction`
- Admit when `Math.floor(estimate) + cost <= limit` (D-13: floor the weighted estimate, compare `<=`).
- **Pinned regression anchor (D-14, must be a test):** `limit=7, prev=5, curr=3, 50% in`
  → `floor(3 + 5*0.5) = floor(5.5) = 5`; `5 + 1 = 6 <= 7` → **admit**, `remaining = 1`.

**Fixed Window op:** counter per `windowMs` bucket; admit while `count + cost <= limit`.
The 2×-at-boundary burst is **required behavior** to exhibit (Pitfall 4 / ALGO-03) — do NOT
add smoothing.

**Rounding contract — PIN IN CODE COMMENTS** (RESEARCH Pitfall 3 + Assumption A2 + Open
Question 1): `Math.floor(remaining)`, `Math.ceil(resetMs)`, `Math.ceil(retryAfterMs)`.
Decide once, comment each (e.g. `// CEIL: matches Lua math.ceil(...)`), because Phase-2
Lua must reproduce these bit-for-bit for TEST-02 conformance. **Never** let fractional ms
cross the op boundary (D-09); fractional token counts stay inside `TBState` only.

---

### `rate-limiter/src/limiters/token-bucket.ts` (limiter, thin wrapper)

**Convention source:** RESEARCH Pattern 3; CONTEXT D-07/D-10/D-12.

**Reference shape to copy** (RESEARCH Pattern 3):
```typescript
export class TokenBucketLimiter implements RateLimiter {
  constructor(private store: Store, private cfg: TBConfig, private clock: Clock = SystemClock) {}
  async consume(key: string, cost = 1): Promise<Decision> {
    const [allowed, remaining, resetMs, retryAfterMs] =
      this.store.tokenBucket(key, this.cfg, cost, this.clock.now());
    return { allowed: allowed === 1, limit: this.cfg.capacity, remaining, resetMs, retryAfterMs };
  }
}
```
**Notes:** `async` only to satisfy `Promise<Decision>` (CORE-01) — the memory store resolves
immediately. Limiter owns `limit` (= `capacity` here, D-12) and assembles the `Decision`
from the tuple. Validate config at construction (reject non-positive `capacity` /
`refillPerInterval` / `intervalMs` — CONTEXT "Claude's Discretion"; throw-vs-assert is impl
detail). `createLimiter(...)` factory is NOT the primary surface (D-07).

### `rate-limiter/src/limiters/sliding-window.ts` (limiter, thin wrapper)

**Convention source:** RESEARCH Pattern 3; CONTEXT D-07/D-11/D-12/D-13. Identical wrapper
shape to Token Bucket but delegates to `store.slidingWindow`, `WindowConfig`, and `limit =
cfg.limit` (D-12). Validate non-positive `limit` / `windowMs`.

### `rate-limiter/src/limiters/fixed-window.ts` (limiter, thin wrapper)

**Convention source:** RESEARCH Pattern 3; CONTEXT D-07/D-11/D-12. Same shape; delegates to
`store.fixedWindow`. `limit = cfg.limit`. Same config validation as sliding window. The
boundary-burst behavior is in the store op, not here.

---

### `rate-limiter/src/index.ts` (barrel / public API)

**Convention source:** RESEARCH "Recommended Project Structure" (index = public barrel).
Re-export: the interfaces/types (`RateLimiter`, `Decision`, `Store`, `Clock`, configs), the
three limiters, `MemoryStore`, and `SystemClock` / `FakeClock`. This single entry is the
tsup `entry` (`src/index.ts`) and the `package.json` `exports` target.

---

### `rate-limiter/test/*.test.ts` (tests)

**Convention source:** RESEARCH Pattern 2 (FakeClock, NO `vi.useFakeTimers` — Pitfall 1),
CLAUDE.md "Testing time + concurrency", TEST-01. **No real sleeps** anywhere.

| Test file | What to assert | Source |
|-----------|----------------|--------|
| `token-bucket.test.ts` | lazy refill over `clock.tick`, burst to capacity, `cost`, exact-limit, `cost>capacity` graceful reject (D-02), floored `remaining` + exact integer `resetMs`/`retryAfterMs` | D-01/D-02/D-04/D-10; Pitfall 3 |
| `sliding-window.test.ts` | **Xu Ch.4 worked example verbatim** (D-14: limit=7, prev=5, curr=3, 50% → admit, remaining=1), window rollover, estimate-floor boundary | D-13/D-14; RESEARCH SW example |
| `fixed-window.test.ts` | window rollover + **explicit demonstration of the 2× boundary burst** (admit `limit` at end of window N and `limit` again at start of N+1) | ALGO-03; Pitfall 4 |
| `concurrency.test.ts` | fire `N > limit` overlapping `consume` via `Promise.all`; assert **exactly `limit`** resolve `allowed:true`; comment the event-loop-atomicity justification (no `await` inside the op's read-modify-write) | CLAUDE.md "concurrency"; Pitfall 2; TEST-04 memory half |

**FakeClock test usage to copy** (RESEARCH Pattern 2):
```typescript
const clock = new FakeClock(0);
const store = new MemoryStore();
const limiter = new TokenBucketLimiter(store, { capacity: 5, refillPerInterval: 1, intervalMs: 1000 }, clock);
await limiter.consume("k");   // now = 0
clock.tick(2000);             // 2s later → 2 tokens refilled, deterministically
await limiter.consume("k");   // sees now = 2000
```

---

## Build/Config File Patterns (copy verbatim from RESEARCH "Code Examples")

### `rate-limiter/tsconfig.json` (strict, ESM, gate-ready)
```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2023"], "types": ["node"],
    "strict": true, "noUncheckedIndexedAccess": true, "verbatimModuleSyntax": true,
    "declaration": true,
    "noEmit": true,            // tsc is the type-GATE (Success Criterion 1); tsup does the emit
    "skipLibCheck": true, "forceConsistentCasingInFileNames": true, "esModuleInterop": true
  },
  "include": ["src", "test", "tsup.config.ts", "vitest.config.ts"]
}
```

### `rate-limiter/tsup.config.ts` (ESM-only)
```typescript
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],     // ESM-only acceptable (CONTEXT discretion + CLAUDE.md)
  dts: true,           // emit .d.ts via tsconfig
  sourcemap: true, clean: true, target: "node24",
});
```
> DO NOT migrate to tsdown despite tsup's README note — CLAUDE.md locks tsup (RESEARCH State of the Art).

### `rate-limiter/package.json` (essentials)
```jsonc
{
  "name": "rate-limiter",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "types": "./dist/index.d.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",       // Phase-1 GATE
    "test": "vitest run", "test:watch": "vitest", "coverage": "vitest run --coverage",
    "build": "tsup", "lint": "eslint .", "format": "prettier --write ."
  }
}
```
> **No runtime `dependencies`** — the core ships dep-free (RESEARCH: grading-positive). Dev
> deps only, exact pins from CLAUDE.md / RESEARCH "Installation":
> `typescript@~5.9 vitest@^4.1 @vitest/coverage-v8@^4.1 tsup@^8.5 eslint@^10.5
> typescript-eslint@^8.62 prettier@^3.8 eslint-config-prettier@^10.1 @types/node@^24`
> (`@vitest/coverage-v8` pinned to the EXACT resolved vitest version, not a caret.)

### `rate-limiter/eslint.config.js` (flat config)
```javascript
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
export default tseslint.config(
  ...tseslint.configs.recommended,
  prettier,   // LAST: disables conflicting stylistic rules
);
```
> Flat config only — ESLint 10 dropped legacy `.eslintrc` (CLAUDE.md "What NOT to Use").

### `rate-limiter/vitest.config.ts`
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", coverage: { provider: "v8", include: ["src/**"] } },
});
```

### `rate-limiter/.nvmrc`
```
24
```

---

## Shared Patterns

### Rounding contract (cross-cutting — applies to ALL store ops AND their tests)
**Source:** RESEARCH Pitfall 3 + Assumption A2 + Open Question 1; CONTEXT D-04/D-09.
**Apply to:** `src/store/memory.ts` (all 3 ops) and every `test/*.test.ts` integer assertion.
- `remaining` → `Math.floor` (D-04)
- `resetMs` → `Math.ceil` (never under-report)
- `retryAfterMs` → `Math.ceil` (never under-report; `0` when allowed)
- **Pin each in a code comment** referencing the Lua equivalent — Phase-2 conformance (TEST-02)
  copies these bit-for-bit. Tests assert exact integer values so Lua has a precise target.

### Integer-ms op boundary (cross-cutting)
**Source:** CONTEXT D-09; RESEARCH Pitfall 3.
**Apply to:** every Store op return tuple. Durations crossing the op boundary are integer ms.
Fractional token counts live ONLY inside `TBState` (recompute `elapsed = now - lastRefill`
from the integer `now` each call; never accumulate fractional ms — avoids `0.1+0.2` drift).

### Clock injection (cross-cutting)
**Source:** RESEARCH Pattern 2; CLAUDE.md "Testing time + concurrency"; CORE-03/D-09.
**Apply to:** all 3 limiters (constructor arg, default `SystemClock`) and all tests
(inject `FakeClock`). Never read `Date.now()` inside a store op — `now` is always a
parameter (Lua portability: STOR-03, `now` arrives as ARGV).

### Framework/transport agnosticism (cross-cutting)
**Source:** CLAUDE.md "Core stays framework/transport-agnostic"; RESEARCH "Tier boundary".
**Apply to:** ALL `src/**` files. Zero imports from Express or ioredis in the core package.

### Event-loop atomicity, not locks (cross-cutting)
**Source:** RESEARCH Pitfall 2 + "Don't Hand-Roll"; STOR-01.
**Apply to:** `src/store/memory.ts` + `test/concurrency.test.ts`. The op is one synchronous
read-modify-write critical section — NO `await` inside it. Do NOT build a mutex/lock; the
single-threaded event loop is the guarantee. The concurrency test proves event-loop atomicity
(memory), which is distinct from the Lua atomicity Phase 2 proves (real multi-client race).

### Config validation at construction (cross-cutting)
**Source:** CONTEXT "Claude's Discretion".
**Apply to:** all 3 limiter constructors (and/or `MemoryStore`). Reject non-positive
`capacity`/`limit`/`windowMs`/`intervalMs`/`refillPerInterval`. Throw-vs-assert is impl detail.

---

## No Analog Found

**Every file in this phase has no in-repo code analog — the repo is greenfield.** This is
expected, not a gap. Each file's pattern is supplied by the cited CLAUDE.md section or
RESEARCH.md decision/pattern above. The planner should reference those convention sources in
each PLAN.md action exactly as it would reference an existing-code analog.

| File | Role | Data Flow | Reason no code analog exists |
|------|------|-----------|------------------------------|
| (all 17 files) | various | various | Greenfield — no `/rate-limiter` source exists yet; this phase bootstraps it. Conventions come from CLAUDE.md (locked stack/pins) + RESEARCH D-01..D-14. |

The genuinely **novel, hand-written** logic (no off-the-shelf substitute — CLAUDE.md "What
NOT to Use" forbids `express-rate-limit`/`rate-limiter-flexible`/`ioredis-mock`):
- The three algorithm ops in `src/store/memory.ts` (the challenge itself).
- The `FakeClock` in `src/clock.ts` (the one abstraction RESEARCH says to hand-roll).
Everything else (build/lint/format/test-runner/coverage configs) is off-the-shelf and locked.

---

## Metadata

**Analog search scope:** entire repo root + (nonexistent) `/rate-limiter/` + recursive `*.ts` scan.
**Files scanned:** 0 source files (greenfield confirmed via `ls` / `find`).
**Convention sources mapped:** `CLAUDE.md` (stack pins, tsconfig posture, testing/concurrency
guidance, "What NOT to Use"), `01-RESEARCH.md` (Patterns 1–3, Pitfalls 1–5, Code Examples,
Architecture Map), `01-CONTEXT.md` (D-01..D-14).
**Pattern extraction date:** 2026-06-23
