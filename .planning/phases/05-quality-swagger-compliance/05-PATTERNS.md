# Phase 5: Quality, Swagger & Exercise Compliance - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 11 (4 new, 7 modified)
**Analogs found:** 9 / 11 (2 new artifacts have partial-analog only)

> Hardening phase over an existing, feature-complete `rate-limiter/`. Nearly every
> change either modifies an existing file or adds a file that should mirror an
> existing sibling. Below, every new/modified file is classified, paired with its
> closest in-repo analog, and given concrete excerpts to copy from.

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/demo/openapi.ts` | NEW | config (static spec object) | transform (none) | — (no spec exists; typed-object form is novel) | no-analog |
| `src/demo/server.ts` | MOD | composition root / route mount | request-response | itself (existing `/health`, `app.use(rateLimit)` mounts) | exact (self) |
| `test/docs.test.ts` | NEW | test (http) | request-response | `test/demo.test.ts` + `test/build-smoke.test.ts` | exact |
| `test/validate.test.ts` (or fold-in) | NEW | test (unit) | transform | `test/breaker.test.ts` (construction tests) + RESEARCH Pattern 2 | exact |
| `test/redis-connect.test.ts` (or fold-in) | NEW | test (unit, no-Docker) | transform | `test/degraded.test.ts` (no-Docker stub harness) | role-match |
| `test/adapters/express/middleware.test.ts` | MOD | test (http unit) | request-response | itself (existing supertest cases) | exact (self) |
| `vitest.config.ts` | MOD | config | n/a | itself (existing `coverage` block) | exact (self) |
| `package.json` | MOD | config | n/a | itself (existing `scripts` block) | exact (self) |
| `COMPLIANCE.md` | NEW | doc | n/a | `rate-limiter/DESIGN.md` (voice/structure) | role-match |
| `README.md` / `DESIGN.md` | MOD | doc | n/a | themselves (existing sections) | exact (self) |
| Targeted doc-comments (D-11) | MOD | source comments | n/a | `src/store/lua/token-bucket.lua` + `src/validate.ts` (comment style) | exact |

---

## Pattern Assignments

### `src/demo/openapi.ts` (NEW — config, static OpenAPI 3 object)

**Analog:** No existing spec. RESEARCH recommends a typed TS object (`const openapiSpec: OpenAPIV3.Document = {…}`) over YAML (no runtime dep, no `dist` path concern — see RESEARCH §"Recommendation within D-06's discretion"). Treat this as demo-tier-only; it MUST NOT be imported by `src/index.ts` or `src/adapters/express/**`.

**What to document** — drive it from the existing demo contract (`server.ts` L104-114) and the ACTUAL emitted headers (README L40-65 shows the literal response shapes):
- `GET /health` → 200 `{ status: "ok" }` (never throttled).
- `GET /api/ping` → 200 `{ pong: true }` with `RateLimit-Policy`, `RateLimit`, `X-RateLimit-*` headers; AND the 429 path with `Retry-After` + body `{ error: "Too Many Requests", retryAfterMs: <ms> }`.

**Header names to document** — copy the exact set from `src/adapters/express/headers.ts` L53-62 and `middleware.ts` (Retry-After):
```
RateLimit-Policy: default;q=<limit>[;w=<windowSeconds>]
RateLimit: default;r=<remaining>;t=<resetSeconds>
X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset
Retry-After (429 only)
```

**Comment-style to mirror** — `src/demo/server.ts` header block (L1-23): a top-of-file block stating WHY the artifact exists and the tier rule. Keep the spec hand-authored and line-by-line legible (D-06); no codegen/JSDoc decorators.

---

### `src/demo/server.ts` (MOD — composition root, mount `/docs` + `/openapi.json`)

**Analog:** the file itself — mirror exactly how it already registers routes and orders the limiter.

**Import-block convention** (L25-35) — ESM `.js` extensions, peer/runtime imports first:
```typescript
import express from "express";

import {
  FixedWindowLimiter, MemoryStore, RedisStore,
  SlidingWindowLimiter, TokenBucketLimiter,
} from "../index.js";
import type { RateLimiter, Store } from "../index.js";
import { rateLimit } from "../adapters/express/index.js";
```
New imports for this phase (add alongside):
```typescript
import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./openapi.js"; // demo-tier typed OpenAPIV3.Document
```

**Route-ordering pattern (LOAD-BEARING)** (L100-117) — `/health` is registered BEFORE `app.use(rateLimit(...))` so it is never throttled; `/api/ping` is registered AFTER:
```typescript
const app = express();

// registered BEFORE the limiter → unlimited
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(rateLimit({ limiter }));   // ← everything below is rate-limited

app.get("/api/ping", (_req, res) => {
  res.status(200).json({ pong: true });
});
```

**Where the new routes go:** mount `/docs` and `/openapi.json` in the UNLIMITED zone — alongside `/health`, BEFORE `app.use(rateLimit(...))` — so the Swagger UI's many static-asset requests are not throttled (RESEARCH Pitfall §"Rate-limiting the /docs UI", Pattern 1 note). Prefix mount only — no bare `*` wildcard (Express 5 / path-to-regexp@8 safe):
```typescript
app.get("/openapi.json", (_req, res) => { res.json(openapiSpec); });
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
```

**Comment convention to honor:** existing inline comments cite decision IDs (`D4-01`, `T-04-01`). Add a one-line `// D-07: docs registered outside the limiter (like /health) …` so intent stays traceable.

---

### `test/docs.test.ts` (NEW — test, http surface; D-08)

**Analog:** `test/demo.test.ts` (supertest against the composed `buildApp()`) + `test/build-smoke.test.ts` (structural assertions on a built artifact). Mirror demo.test.ts's drive-the-app-without-a-port style.

**Setup + import pattern** (`demo.test.ts` L17-29) — supertest against `buildApp()`, env cleanup in `afterEach`:
```typescript
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/demo/server.js";

afterEach(() => {
  delete process.env.RL_ALGO;
  delete process.env.REDIS_URL;
});
```

**Drive-the-app pattern** (`demo.test.ts` L33-49) — build, use, close in `finally`:
```typescript
const { app, close } = buildApp();
try {
  const res = await request(app).get("/docs/");   // 200, HTML (UI redirect lands at /docs/)
  expect(res.status).toBe(200);

  const spec = await request(app).get("/openapi.json");
  expect(spec.status).toBe(200);
  // D-08 structural-validity: a few hand assertions, NO heavy validator dep.
  expect(spec.body.openapi).toMatch(/^3\./);
  expect(spec.body.paths["/api/ping"]).toBeDefined();
  expect(spec.body.paths["/health"]).toBeDefined();
} finally {
  await close();
}
```
Notes: `/docs` (no trailing slash) commonly 301-redirects to `/docs/`; assert against `/docs/` or follow the redirect. Keep the structural check small per D-08 ("without a heavy validator dep").

---

### `test/validate.test.ts` (NEW or fold into existing — unit; QUAL-COV)

**Analog:** `test/breaker.test.ts` (pure construction/state tests, FakeClock, no Docker) + RESEARCH §Pattern 2. The three uncovered throw arms are `src/validate.ts` L16 (`assertPositiveConfig`), L46 (`assertPolicy`), L60 (`assertPrefix`).

**Construction-test pattern** (RESEARCH Pattern 2, validated against `src/store/redis.ts` L116-130 `lazyConnect:true`):
```typescript
import { describe, expect, it } from "vitest";
import { RedisStore, MemoryStore, TokenBucketLimiter } from "../src/index.js";

// assertPositiveConfig throw arm (validate.ts:16)
expect(() => new TokenBucketLimiter(new MemoryStore(),
  { capacity: 0, refillPerInterval: 1, intervalMs: 1 })).toThrow(RangeError);

// assertPolicy throw arm (validate.ts:46) — lazyConnect:true → no network
expect(() => RedisStore.connect("redis://x", { policy: "nope" as never })).toThrow(RangeError);

// assertPrefix throw arm (validate.ts:60)
expect(() => RedisStore.connect("redis://x", { keyPrefix: "" })).toThrow(RangeError);
```
`assertCost`'s throw is ALREADY tested in `test/cost-validation.test.ts` — do not duplicate.

---

### `test/redis-connect.test.ts` (NEW or fold-in — unit, no-Docker; QUAL-COV)

**Analog:** `test/degraded.test.ts` (no-Docker, constructs `RedisStore` with a stub/lazy client). Covers `src/store/redis.ts` L116-130 (`RedisStore.connect()` static factory — currently 63.63% branch).

**No-network construction pattern:** `connect()` uses `lazyConnect: true` (redis.ts L126), so constructing touches no socket:
```typescript
import { describe, expect, it } from "vitest";
import { RedisStore } from "../src/index.js";

it("RedisStore.connect builds a store without connecting (lazyConnect)", async () => {
  const store = RedisStore.connect("redis://127.0.0.1:6379");
  expect(store).toBeInstanceOf(RedisStore);
  await store.close();      // release the lazily-built client (degraded.test.ts mirrors close())
});
// Hit the no-arg branch too (connection ? new Redis(connection) : new Redis(options) — redis.ts:128):
it("RedisStore.connect with no URL uses default options", async () => {
  const store = RedisStore.connect();
  expect(store).toBeInstanceOf(RedisStore);
  await store.close();
});
```
Stub-client style if you prefer not to instantiate ioredis — copy `rejectingClient()` from `degraded.test.ts` L29-38.

---

### `test/adapters/express/middleware.test.ts` (MOD — extend; QUAL-COV)

**Analog:** the file itself. Two gaps to close (RESEARCH Coverage table):
- `headers.ts` L46-54 — the `mode === 'ietf'`-only branch and the `windowSeconds != null ? … : ''` ternary (L49). Add one supertest with `rateLimit({ limiter, headers: 'ietf' })` and one passing `windowSeconds`.
- `middleware.ts` L67-69 — the `if (options.limiter == null) throw new TypeError(...)` arm. Add:
```typescript
expect(() => rateLimit({} as never)).toThrow(TypeError);
```
Reuse the existing single-agent supertest pattern already in this file (mirrors `demo.test.ts` L55 keep-alive-agent → stable `req.ip`).

---

### `vitest.config.ts` (MOD — coverage gate; D-01/D-02)

**Analog:** the file itself. Current block (L21-24):
```typescript
coverage: {
  provider: 'v8',
  include: ['src/**'],
},
```
**Replace with** (RESEARCH §"Recommended vitest.config.ts shape" — the `.lua` exclude is MANDATORY: rolldown throws PARSE_ERROR on Lua, and demo/barrels would crater the global gate):
```typescript
coverage: {
  provider: 'v8',
  include: ['src/**'],
  exclude: [
    'src/demo/**',                    // D-01: demo server excluded
    'src/index.ts',                   // D-01: core barrel
    'src/adapters/express/index.ts',  // D-01: adapter barrel
    'src/store/lua/**',               // D-01: .lua via Redis integration; unparseable by rolldown
  ],
  thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 }, // D-02
},
```
Keep the existing `fileParallelism: false` + bumped timeouts UNTOUCHED (the Docker-backed suites run under coverage too).

---

### `package.json` (MOD — `verify` gate + swagger dep; D-03/D-07)

**Analog:** the file itself. Current scripts (L17-28) — relevant lines:
```json
"test": "vitest run",
"coverage": "vitest run --coverage",
"verify": "npm run typecheck && npm run test",
```
**Change for D-03** (single green gate = typecheck + coverage). Either:
```json
"verify": "npm run typecheck && vitest run --coverage"   // Option A (minimal)
// — or — make coverage the default test gate (Option B): "test": "vitest run --coverage"
```
**Dependency placement (D-07 / RESEARCH Pitfall 2 — CRITICAL):** the Docker runtime stage runs `npm ci --omit=dev` (`Dockerfile` L21). `swagger-ui-express` MUST go in `"dependencies"` alongside `express`/`ioredis` (L48-51), NOT devDependencies, or `/docs` MODULE_NOT_FOUNDs in the container. `@types/swagger-ui-express` (+ optional `openapi-types`) go in `"devDependencies"`.
**Open question (record the decision):** `lint` is NOT in `verify` today and `eslint .` currently exits 1 (AF-1). D-03 names only typecheck+coverage; adding lint is discretionary and requires fixing AF-1/AF-2 first.

---

### `rate-limiter/COMPLIANCE.md` (NEW — doc; D-10)

**Analog:** `rate-limiter/DESIGN.md` — match its voice (numbered `## N. Title` sections, honest/non-overstated tone, evidence-anchored) and its location (repo `rate-limiter/` alongside DESIGN.md/README.md).

**DESIGN.md section pattern to mirror** (its headers): `## 1. Architecture overview`, `## 8. How AI was used (honest disclosure)`, `## 9. Scope note (this is a demo, honestly scoped)`. The "honest scope" voice is the model for COMPLIANCE.md's deferred-items rows.

**Structure** (RESEARCH §"COMPLIANCE.md Target Map" gives the full brief→evidence rows): a scannable table per brief section — **Rules (MUST)**, **Focus on**, **Nice to haves** — each row `brief item → evidence (file/test/§) → status`. Plus an **Audit dispositions** table seeded from RESEARCH AF-1/AF-2/AF-3.
**Honesty rule:** logging/metrics are v2-deferred (OBS-01/02) — map them as "deferred (rationale: …)", never as delivered.

---

### `README.md` / `DESIGN.md` (MOD — docs; D-12)

**Analog:** themselves.
- README: add a coverage statement and a `/docs` link near the existing `## Try it: a 200, then a 429` (L35) and `## Verify` (L104) sections — those are where a grader looks first.
- DESIGN.md: add a short note (a new numbered `##` section, matching its style) on the Swagger decision (D-06 hand-written choice) and the audit's material fixes — slot it near `## 7. The npm run verify gate` (L200) and `## 9. Scope note` (L261).

---

### Targeted doc-comments (D-11 — MOD, source comments only)

**Comment-style analogs (the bar to match — already dense and intent-first, do NOT add slop):**
- `src/store/lua/token-bucket.lua` L1-15 — top-of-file "Parity contract" + numbered Pitfall callouts: the model for Lua-atomicity / parity comments.
- `src/validate.ts` L9-14, L21-32 — "why extracted here / what corruption this prevents" intent comments: the model for guard-arm comments.
- `src/store/memory.ts` L150-172 — sliding-window `retryAfterMs` math already heavily commented (the `prev > 0 ? … : msToBoundary` branch at L167 is the only coverage gap; comment its reachability if it gets a `/* v8 ignore */`).

**D-11 targets (per CONTEXT D-11):** Lua atomicity contracts, sliding-window math, fixed-window boundary-burst, breaker fail-open-vs-closed policy, OpTuple rounding parity. **Leave trivial getters/barrels alone** — the brief penalizes comment-slop. This is a targeted top-up, not a rewrite.

**If a `/* v8 ignore */` pragma is needed** (last resort, D-04 — likely only `memory.ts:167`): the `-- @preserve` suffix is REQUIRED or tsup/esbuild strips it:
```typescript
/* v8 ignore next -- <one-line justification: genuinely unreachable> @preserve */
```

---

## Shared Patterns

### Construction-time fail-loud validation
**Source:** `src/validate.ts` (`assertPositiveConfig`/`assertPolicy`/`assertPrefix` throw `RangeError`); mirrored at `src/adapters/express/middleware.ts` L67-71 (`TypeError` for missing limiter, `assertPolicy` for bad policy) and `src/demo/server.ts` L83-87 (RangeError on bad `RL_ALGO`).
**Apply to:** the branch-coverage tests — every uncovered branch this phase closes is a fail-loud throw arm; the test pattern is uniformly "construct with bad config, assert `.toThrow(<ErrorType>)`".

### Supertest-against-`buildApp()` (no port bind)
**Source:** `test/demo.test.ts` L33-49 (build → `request(app)` / `request.agent(app)` → `await close()` in `finally`); single keep-alive agent → stable `req.ip` → stable limiter key (L55).
**Apply to:** `test/docs.test.ts` and the `middleware.test.ts` extensions.

### No-Docker stub/lazy client for Redis paths
**Source:** `test/degraded.test.ts` L29-38 `rejectingClient()` (stub ioredis accepting the three `defineCommand` registrations) and `src/store/redis.ts` L126 `lazyConnect: true` (constructing `RedisStore.connect()` touches no socket).
**Apply to:** `RedisStore.connect()` coverage and `validate.ts` policy/prefix arms — all run without Docker.

### Decision-ID-traceable inline comments
**Source:** throughout `src/demo/server.ts` (`D4-01`, `T-04-01`) and `headers.ts` (`D3-04`, `D3-05`).
**Apply to:** every new comment/route added this phase — tag with the governing decision ID (`D-07`, `D-01`, etc.) so intent stays auditable.

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner guidance |
|------|------|-----------|--------|------------------|
| `src/demo/openapi.ts` | config (OpenAPI 3 object) | none | No OpenAPI spec exists anywhere in the repo. | Use RESEARCH §Pattern 1 + §"Recommendation within D-06" (typed `OpenAPIV3.Document`); document the EXACT headers from `headers.ts` L53-62 and the response shapes from `README.md` L40-65. Comment-style: copy the WHY-block from `server.ts` L1-23. |
| `COMPLIANCE.md` (structure only) | doc | n/a | No prior compliance artifact; only a *voice/structure* analog (`DESIGN.md`) exists, not a content analog. | Use RESEARCH §"COMPLIANCE.md Target Map" for the brief→evidence rows; match DESIGN.md's honest, evidence-anchored voice and `rate-limiter/` location. |

## Metadata

**Analog search scope:** `rate-limiter/src/**` (demo, store, adapters, validate, clock), `rate-limiter/test/**`, root config (`vitest.config.ts`, `package.json`, `Dockerfile`), `rate-limiter/{DESIGN,README}.md`.
**Files scanned:** ~14 (server.ts, vitest.config.ts, package.json, validate.ts, demo.test.ts, build-smoke.test.ts, fault-injection.test.ts, breaker.test.ts, degraded.test.ts, redis.ts, headers.ts, middleware.ts, memory.ts, token-bucket.lua, DESIGN.md, README.md, Dockerfile).
**Pattern extraction date:** 2026-06-25
