# Phase 4: Demo, Docker & DESIGN.md - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 9 (1 code, 1 optional test, 3 infra, 2 docs, 2 config edits)
**Analogs found:** 4 / 9 (the 5 infra/doc artifacts have no in-repo code analog — see "No Analog Found")

This phase is composition + infrastructure + docs. There is exactly ONE real code
file (the demo server) plus optional smoke test; the rest are config edits and new
infra/doc artifacts. Expectations are calibrated accordingly — the planner should
NOT force analog matches onto the Dockerfile / compose / README / DESIGN.md.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `rate-limiter/src/demo/server.ts` | composition-root / server | request-response | `src/adapters/express/middleware.ts` (Express wiring + factory-time validation) + `src/store/redis.ts` `connect()`/`close()` (store factory + shutdown) + `test/adapters/express/middleware.test.ts` (`express()` + `rateLimit({limiter})` composition) | role-match (no existing server, but every piece it composes has a verified analog) |
| `rate-limiter/test/demo.test.ts` (OPTIONAL) | test | request-response | `test/adapters/express/middleware.test.ts` (supertest against a real `express()` app) | exact |
| `rate-limiter/package.json` (EDIT) | config | n/a | itself (current `scripts` + `exports`) | self / in-place |
| `rate-limiter/tsup.config.ts` (EDIT) | config | n/a | itself (current `entry` array) | self / in-place |
| `rate-limiter/Dockerfile` | infra | n/a | none in repo | no analog (RESEARCH Pattern 4) |
| `rate-limiter/.dockerignore` | infra | n/a | `rate-limiter/.gitignore` (loose shape only) | weak / no real analog |
| `rate-limiter/docker-compose.yml` | infra | n/a | none in repo | no analog (RESEARCH Pattern 5) |
| `rate-limiter/DESIGN.md` | doc | n/a | the Phase 1/2/3 CONTEXT files (source of trade-offs) | doc-source, not code |
| `rate-limiter/README.md` | doc | n/a | none in repo (RESEARCH §README+Mermaid) | no analog |

---

## Pattern Assignments

### `rate-limiter/src/demo/server.ts` (composition-root / server, request-response)

This file has NO single analog — it is a new top tier. It composes three verified
patterns, each from a different analog. The planner should assemble it from these.

**Analog A — Express app + `rateLimit({ limiter })` composition**
Source: `test/adapters/express/middleware.test.ts:42-47` (the closest existing
"build an express app and mount the middleware" code).

```typescript
import express from "express";
// ...
const app = express();
app.use(rateLimit({ limiter, keyGenerator: () => "k1" }));
app.get("/", (_req, res) => res.send("ok"));
```

The demo follows the SAME shape but with route-ordering for D4-03 (health OUTSIDE
the limiter, ping INSIDE — RESEARCH Pattern 2):

```typescript
const app = express();
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' })); // unlimited (compose healthcheck)
app.use(rateLimit({ limiter }));                                            // D4-04: defaults (no keyGenerator override → req.ip)
app.get('/api/ping', (_req, res) => res.status(200).json({ pong: true })); // rate-limited
```

> NOTE the divergence from the analog: the test sets `keyGenerator: () => "k1"`
> ONLY because supertest's loopback `req.ip` is flaky. The DEMO must NOT override
> `keyGenerator` (D4-04 leans on the `req.ip` default — see middleware.ts:73).

**Import-tier rule (VERIFIED — the load-bearing constraint).**
The demo is the ONLY file allowed to import BOTH the core barrel AND the express
subpath. Mirror these two existing import sites exactly:
- Core barrel (`src/index.ts:22-34`) exports `RedisStore`, `MemoryStore`,
  `TokenBucketLimiter`, `SlidingWindowLimiter`, `FixedWindowLimiter`, `SystemClock`,
  and the `RateLimiter`/`Store` types.
- Express subpath (`src/adapters/express/index.ts:9`) exports `rateLimit`.

```typescript
// In-source (tsx dev) imports use relative .js paths like the tests do:
import { RedisStore, MemoryStore, TokenBucketLimiter, /* ... */ } from "../index.js";
import { rateLimit } from "../adapters/express/index.js";
// (If the planner prefers package-subpath imports `rate-limiter` / `rate-limiter/express`,
//  those only resolve post-build via the exports map — tsx dev would need the relative form.)
```

DO NOT add any demo/Express import to `src/index.ts` (core barrel stays
framework-agnostic — VERIFIED `src/index.ts` header comment + `redis.ts:5-8` tier note).

**Analog B — store factory (Redis-or-Memory by env, D4-01) + graceful close**
Source: `src/store/redis.ts:116-130` (`RedisStore.connect`) and `:160-175` (`close`).

`RedisStore.connect(connection?, config?, clock?)` is batteries-included — it sets
the defensive ioredis options itself, so the demo passes ONLY the URL:

```typescript
// VERIFIED signature src/store/redis.ts:116
static connect(connection?: string, config = {}, clock = SystemClock): RedisStore
// internally sets: commandTimeout, maxRetriesPerRequest:1, enableOfflineQueue:false, lazyConnect:true
```

Demo store selection (the D4-01 one-line branch — do NOT hand-build an ioredis client):

```typescript
function buildStore(): { store: Store; close: () => Promise<void> } {
  const url = process.env.REDIS_URL;
  if (url) {
    const store = RedisStore.connect(url);       // real distributed path (compose)
    return { store, close: () => store.close() }; // close() = redis.ts:160 (quit w/ 1s race → disconnect)
  }
  return { store: new MemoryStore(), close: async () => {} }; // zero-Docker fallback (D4-01)
}
```

`RedisStore#close` (redis.ts:160) is the EXACT method the SIGTERM handler calls —
it already races `quit()` against a 1s timeout then force-`disconnect()`s, so the
demo's shutdown does not need its own timeout logic for the store.

**Analog C — factory-time / construct-time validation (fail loud on bad env)**
Source: `src/adapters/express/middleware.ts:65-71` and `src/store/redis.ts:89-94`
(both validate config at construction and throw before any request is served).
The codebase convention (`src/validate.ts:15-19`) is: bad config → `RangeError`
with a `label`-prefixed message.

The demo's `RL_ALGO` selector must follow the SAME fail-loud convention — throw on
an unknown algorithm rather than silently defaulting:

```typescript
function buildLimiter(store: Store): RateLimiter {
  const algo = process.env.RL_ALGO ?? 'token-bucket'; // D4-02 default
  switch (algo) {
    case 'token-bucket':
      return new TokenBucketLimiter(store, { capacity: 5, refillPerInterval: 5, intervalMs: 60_000 });
    case 'sliding-window': return new SlidingWindowLimiter(store, { limit: 5, windowMs: 60_000 });
    case 'fixed-window':   return new FixedWindowLimiter(store, { limit: 5, windowMs: 60_000 });
    default:
      throw new RangeError(`RL_ALGO must be token-bucket|sliding-window|fixed-window, got "${algo}"`);
  }
}
```

> CONFIG-FIELD TRAP (VERIFIED `src/types.ts` / RESEARCH:100): Token Bucket takes
> `{ capacity, refillPerInterval, intervalMs }` — the two window algorithms take
> `{ limit, windowMs }`. Do NOT pass `{ limit, windowMs }` to `TokenBucketLimiter`.

**Process lifecycle (SIGTERM) — no in-repo analog; from RESEARCH Pattern 3.**
There is no existing server in the repo, so the listen/SIGTERM block has no code
analog. Use RESEARCH §Pattern 3 (server.close → store close → exit, with an
unref'd safety-net timeout) paired with compose `init: true`.

---

### `rate-limiter/test/demo.test.ts` (test, request-response) — OPTIONAL (Claude's discretion)

**Analog:** `test/adapters/express/middleware.test.ts` (exact — same role, same data flow).

If the planner includes a thin smoke test, copy this structure directly:

**Imports + supertest harness** (`middleware.test.ts:13-19`):
```typescript
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { MemoryStore, TokenBucketLimiter } from "../src/index.js";
import { rateLimit } from "../src/adapters/express/index.js";
```

**Assertion shape** (`middleware.test.ts:49-66`) — drive the real app, assert
status + the header families. For the demo smoke test, the highest-value assertion
is the D4-03 contract: `/health` is 200 and never throttled; `/api/ping` admits
then 429s. A fixed `keyGenerator`/key is needed if asserting the 429 transition
(loopback `req.ip` flakiness — `middleware.test.ts:9-11`), but the demo itself must
keep the `req.ip` default; if the test imports the demo's app it should drive it
with the same client so all requests share an IP.

> Build-asset guard (separate concern): if the planner wants the build to assert
> `dist/demo/server.js` lands (Pitfall 3), the analog is `test/build-smoke.test.ts:22-48`
> — extend the `expressSubpathAssets` array pattern with `demo/server.js`.

---

### `rate-limiter/package.json` (config EDIT) — analog is its own current shape

**Current scripts (VERIFIED, lines 17-25)** — the planner edits THIS block:
```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "coverage": "vitest run --coverage",
  "build": "tsup",
  "lint": "eslint .",
  "format": "prettier --write ."
}
```
Phase 4 adds (D4-06 / Open Q1):
- `"verify": "npm run typecheck && npm run test"` (the mandatory gate — RESEARCH:391)
- `"start": "node dist/demo/server.js"` (runtime entrypoint the Dockerfile CMD mirrors)
- `"dev": "tsx watch src/demo/server.ts"` (optional — requires adding `tsx` devDep; gate on `npm view tsx version` per Package Legitimacy Audit)

**Current `exports` (VERIFIED, lines 6-15)** — the demo is an APP entrypoint, NOT a
library subpath, so it should NOT be added to `exports` (it is reached via the
`start` script / Docker CMD, not `import 'rate-limiter/demo'`). Leave `exports` as-is:
```json
"exports": {
  ".":        { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./express":{ "types": "./dist/adapters/express/index.d.ts", "import": "./dist/adapters/express/index.js" }
}
```

> `tsx` is NOT currently in devDependencies (VERIFIED lines 26-44). `express`,
> `supertest`, `tsup`, `vitest`, `typescript` already are. `ioredis` is the only
> runtime `dependencies` entry — so `npm ci --omit=dev` in the Dockerfile runtime
> stage installs exactly `ioredis` (correct for the Redis path).

### `rate-limiter/tsup.config.ts` (config EDIT) — analog is its own current `entry`

**Current (VERIFIED, line 13):**
```typescript
entry: ['src/index.ts', 'src/adapters/express/index.ts'],
```
Phase 4 adds the third entry (Pitfall 3 — without it the Docker CMD MODULE_NOT_FOUNDs):
```typescript
entry: ['src/index.ts', 'src/adapters/express/index.ts', 'src/demo/server.ts'],
```
The `onSuccess` Lua-copy hook (lines 19-21) is UNAFFECTED and must stay — the demo's
Redis path depends on `dist/store/lua/*.lua` being present (Pitfall 4). Whole-`dist`
copy in the Dockerfile preserves it.

---

## Shared Patterns

### Tier boundary (the single most load-bearing convention)
**Source:** `src/index.ts` header + `src/store/redis.ts:5-8` + `src/adapters/express/middleware.ts:3-8`.
**Apply to:** `src/demo/server.ts` (and any demo test).
Only `store/redis.ts` imports `ioredis`; only `adapters/express/**` imports Express.
The demo is a NEW top tier that may import BOTH (Express via the adapter subpath,
the store via the core barrel) — but it must NOT introduce Express/demo code into
`src/index.ts`. This is why the demo lives at `src/demo/`, not in the barrel.

### Fail-loud config validation
**Source:** `src/validate.ts:15-19` (`RangeError` w/ label prefix), applied at
`src/store/redis.ts:89-94` and `src/adapters/express/middleware.ts:65-71`.
**Apply to:** the demo's env parsing (`RL_ALGO`, and any limit overrides). Throw a
`RangeError` on garbage at startup — never silently coerce. Consistent with the
whole codebase's construct-time-validation posture.

### Lean-on-defaults middleware wiring
**Source:** `src/adapters/express/middleware.ts:65-73` — `rateLimit({ limiter })`
defaults to `req.ip` key, `fail-open`, both header families, JSON 429.
**Apply to:** the demo (D4-04). Pass ONLY `{ limiter }`; do not re-specify the
defaults. The 429 body shape the README documents comes from `sendThrottled`
(middleware.ts:127-146): `{ error, retryAfterMs }` + `Retry-After` clamped to ≥1.

### Batteries-included store construction
**Source:** `src/store/redis.ts:116-130` (`connect`) — sets `commandTimeout`,
`maxRetriesPerRequest:1`, `enableOfflineQueue:false`, `lazyConnect:true`.
**Apply to:** the demo store factory. Use `RedisStore.connect(url)`; do NOT
hand-build a `new Redis(...)` + `new RedisStore(client)` (would risk omitting a
defensive option and reads as redundant — RESEARCH §Don't Hand-Roll).

---

## No Analog Found

These artifacts have NO in-repo code analog (verified: none exist under
`rate-limiter/`). The planner should use the RESEARCH patterns / CONTEXT sources
named below rather than forcing a codebase match.

| File | Role | Use Instead Of An Analog |
|------|------|--------------------------|
| `rate-limiter/Dockerfile` | infra | RESEARCH Pattern 4 (multi-stage `node:24-alpine`, `npm ci`/`npm ci --omit=dev`, `USER node`, `node -e fetch` HEALTHCHECK, exec-form `CMD ["node","dist/demo/server.js"]`). Pins: `.nvmrc` = `24` (VERIFIED), runtime dep = `ioredis` only. **Lockfile present** (`package-lock.json`, 254KB — VERIFIED), so `npm ci` is safe (Pitfall 5 / Open Q2 resolved). |
| `rate-limiter/.dockerignore` | infra | RESEARCH Pattern 4 note (exclude `node_modules`, `dist`, `.git`, `test`, `*.md`). `.gitignore` (30 bytes) is a loose shape reference only, not a real analog. |
| `rate-limiter/docker-compose.yml` | infra | RESEARCH Pattern 5 (two services `app`+`redis:7.4-alpine`, Redis `redis-cli ping` healthcheck, `depends_on: condition: service_healthy`, `init:true`, `REDIS_URL=redis://redis:6379`, NO top-level `version:` key). |
| `rate-limiter/DESIGN.md` | doc | The "analog" is the source CONTEXT files the trade-offs are NARRATED from — RESEARCH §"DESIGN.md content map" maps each section to its VERIFIED source: `01-CONTEXT.md` (concurrency, fixed-window burst), `02-CONTEXT.md` (atomic Lua, fail-open/closed + rejected alternatives), `03-CONTEXT.md` (delta-seconds reset convention), `04-CONTEXT.md` D4-08 (AI-usage). Do NOT re-derive decisions. |
| `rate-limiter/README.md` | doc | RESEARCH §"README + Mermaid" — one-command `docker compose up` quickstart, the 200→429 curl loop, the Docker-required note for `npm run verify` (D4-06), and the two Mermaid diagrams (layered design + request path). |

---

## Metadata

**Analog search scope:** `rate-limiter/src/**`, `rate-limiter/test/**`, `rate-limiter/` root (config + infra + docs).
**Files scanned (read):** `package.json`, `tsup.config.ts`, `src/index.ts`, `src/adapters/express/index.ts`, `src/adapters/express/middleware.ts`, `src/store/redis.ts`, `src/validate.ts` (head), `test/adapters/express/middleware.test.ts` (head), `test/build-smoke.test.ts`; root listing for infra/doc existence.
**Key verifications:** lockfile EXISTS (resolves Pitfall 5); no Dockerfile/compose/README/DESIGN exist yet (all NEW); `tsx` NOT yet a devDep; `ioredis` is the only runtime dependency; `.nvmrc`=24.
**Pattern extraction date:** 2026-06-25
