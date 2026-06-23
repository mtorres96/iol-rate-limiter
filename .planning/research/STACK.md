# Stack Research

**Domain:** Distributed rate-limiter library + Express middleware (TypeScript/Node.js, Redis backend)
**Researched:** 2026-06-23
**Confidence:** HIGH (all versions verified against npm registry + Node.js release schedule on research date)

> Scope note: The high-level stack (TypeScript on Node.js, Redis, Docker, Express, Vitest, ioredis)
> is **fixed** by the challenge framing. This document makes those choices *prescriptive and
> version-pinned*, and explains what to deliberately leave out to avoid overengineering / "AI slop".

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | **24.x (Active LTS, "Krypton")** | Runtime | v24 is the current Active LTS as of 2026-06; v20 is EOL (Mar 2026), v22 is Maintenance, v26 is "Current" (not LTS). Pin to LTS for a reviewable, reproducible deliverable. Use `node:24` in Docker and an `.nvmrc`. |
| TypeScript | **~5.9** (pin `~5.9.x`; do NOT jump to 6.0 yet) | Language + type emission | TS 5.x is the mature, well-documented baseline reviewers expect. TS 6.0 is brand-new (released ~2026) and carries breaking-change/tooling-lag risk for a graded deliverable. `typescript-eslint` peer support and most tooling are validated against 5.x. Conservative pin = fewer surprises. |
| Redis | **7.4 server** (image `redis:7.4-alpine`) | Distributed store, atomic Lua | 7.x is the stable production line with `EVAL`/`EVALSHA` and `FUNCTION` support. Pin the server image, not `:latest`, so test behavior is reproducible. Redis 8 exists but 7.4 is the conservative, universally-supported choice for Lua-scripted counters. |
| ioredis | **^5.11** (verified latest 5.11.1) | Redis client | The constraint specifies ioredis, and it is the right call: `defineCommand()` gives first-class custom Lua commands with **automatic EVALSHA caching + fallback to EVAL on NOSCRIPT**, plus typed `commandTimeout`, `connectTimeout`, `maxRetriesPerRequest`, and a built-in connection. This maps directly to the "atomic Lua + timeouts + fail-open/closed" requirements. |
| Express | **^5.1** (verified 5.2.1; tag `latest`) | Middleware adapter + demo server | Express 5 is now the default `latest` line and is stable. It has native `async` error propagation (rejected promises reach the error handler) — relevant because the limiter awaits Redis. Use `@types/express@^5`. See migration note below for the v4→v5 gotchas. |
| Vitest | **^4.1** (verified 4.1.9) | Test runner | Native ESM + TS, fast, Jest-compatible API, and crucially **`vi.useFakeTimers()` / `vi.setSystemTime()` / `vi.advanceTimersByTime()`** for deterministic token-bucket refill and sliding-window expiry tests without `sleep()`. First-class watch + coverage. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testcontainers/redis | **^12.0** (verified 12.0.3) | Spin up a real ephemeral Redis per integration test run | Use for the Redis-store integration tests. Programmatic lifecycle (start container, get mapped port, point ioredis at it, teardown) — no external `docker-compose up` precondition, so `npm test` is self-contained on any machine with Docker. |
| testcontainers | **^12.0** (peer of the above) | Core testcontainers engine | Transitive; pin alongside the Redis module to keep versions aligned. |
| supertest | **^7.2** (verified 7.2.2) | HTTP assertions against the Express middleware/demo server | Use to assert `429`, `Retry-After`, and `X-RateLimit-*` headers end-to-end without binding a real port. |
| @vitest/coverage-v8 | **match Vitest (^4.1)** | Coverage for the core algorithms | Keep version locked to Vitest. Core algorithm coverage is a grading signal. |
| pino | **^10.3** (verified 10.3.1) | Structured logging (nice-to-have) | Use in the demo server + store for structured logs (e.g. fail-open events). Low overhead, no `console.log` slop. Add `pino-pretty` as a dev-only transport for readable local output. |
| prom-client | **^15.1** (verified 15.1.3) | Prometheus metrics (nice-to-have) | Expose `allowed`/`blocked` counters and Redis-latency histograms on `/metrics`. Demonstrates the "metrics" nice-to-have without building a dashboard. Keep it to a handful of metrics. |

> Deliberately **not** in the supporting list: `ioredis-mock`. The project already specifies an
> **in-memory `Store` implementation** behind the `Store` interface — that is the correct way to
> unit-test algorithms without Redis. Adding `ioredis-mock` would duplicate that and risk testing a
> mock's behavior instead of real Redis. See "What NOT to Use".

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsup | Build / bundle to clean dual ESM+CJS + `.d.ts` | `^8.5` (verified 8.5.1). One config, zero ceremony: `entry`, `format: ['esm','cjs']`, `dts: true`, `sourcemap: true`, `clean: true`. Far less footgun than hand-rolling `tsc` dual builds + `package.json` exports. |
| ESLint | Lint (flat config `eslint.config.js`) | `^10.5` (verified 10.5.0). Flat config is the only supported format now. Pair with `typescript-eslint@^8.62`. |
| typescript-eslint | TS-aware lint rules + parser | `^8.62` (verified). Provides `tseslint.config()` helper for the flat config. Validated against TS 5.x — another reason to hold TS at 5.9. |
| Prettier | Formatting | `^3.8` (verified 3.8.4). Add `eslint-config-prettier@^10.1` to disable conflicting ESLint stylistic rules. Do NOT run Prettier *as* an ESLint plugin — keep them separate. |
| tsx | Run TS demo server / scripts without a build step | `^4.22` (verified 4.22.4). For `dev` script and ad-hoc scripts. Don't ship it in the runtime image. |

## tsconfig posture (prescriptive)

A library that ships clean types for a graded review:

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",            // safe for Node 24
    "module": "NodeNext",          // modern, honors package.json "type"
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,                // non-negotiable for a "well-designed" deliverable
    "noUncheckedIndexedAccess": true,  // catches off-by-one on window/bucket arrays
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,  // forces explicit `import type`, clean emit
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,       // required by tsup/esbuild transpilation
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**ESM vs CJS:** Author the source as **ESM** (`"type": "module"`). Ship **dual output via tsup** so the
library is consumable from both `import` and `require`, with `package.json` `exports` pointing at
both plus `types`. For a single self-contained challenge repo you could ship ESM-only — but dual
output via tsup is one config line and signals library-grade polish without overengineering.

## Installation

```bash
# Runtime (library + adapter)
npm install ioredis express

# Nice-to-haves
npm install pino prom-client

# Dev — types
npm install -D typescript @types/node@^24 @types/express

# Dev — test
npm install -D vitest @vitest/coverage-v8 supertest testcontainers @testcontainers/redis

# Dev — lint / format / build / run
npm install -D eslint typescript-eslint prettier eslint-config-prettier tsup tsx pino-pretty
```

## Express 5 migration notes (v4 → v5)

Relevant if any reviewer or copied snippet assumes v4:
- Path-matching uses `path-to-regexp@8`: bare `*` wildcards and unnamed regex groups behave
  differently. Use named wildcards (`/*splat`) if you need catch-alls.
- `req.query` is now a getter (read-only) — fine for a limiter that only reads.
- Rejected promises in middleware now propagate to the error handler automatically, so the
  limiter middleware can be `async` and `throw`/reject on a fail-closed store error without a
  manual `try/catch → next(err)` wrapper.
- Removed long-deprecated signatures (`res.send(status)`, `app.del`, etc.) — not used here.

## Redis client: ioredis vs node-redis (why ioredis)

| Concern | ioredis ^5.11 | node-redis ^6 |
|---------|---------------|---------------|
| Custom Lua command | `defineCommand(name, { numberOfKeys, lua })` — auto EVALSHA + NOSCRIPT fallback, callable like a native typed command | `defineScript` / `client.eval`; workable but ergonomics are less seamless |
| Command timeout | `commandTimeout` per client (defensive design req) | Supported but less batteries-included |
| Constraint fit | **Explicitly required by PROJECT.md** | Would violate the stated constraint |

`defineCommand` is the decisive feature: it gives **atomic, server-side, cached Lua execution**
(eliminating read-modify-write races across nodes — the core correctness requirement) while exposing
the script as a typed method. Confidence: **HIGH** (verified via Context7 `/redis/ioredis` docs).

## Testing time + concurrency (prescriptive)

- **Algorithm unit tests (in-memory store):** inject a clock (`now: () => number`) into the limiter
  so tests control time. Use `vi.useFakeTimers()` + `vi.setSystemTime()` / `vi.advanceTimersByTime()`
  to assert token-bucket refill boundaries and sliding-window edges deterministically. Never `sleep`.
- **Concurrency:** fire N overlapping `Promise.all` requests and assert exactly `limit` are allowed —
  this is the race-condition proof the challenge cares about.
- **Redis integration tests:** use `@testcontainers/redis` to start a real `redis:7.4` per run; the
  Lua atomicity guarantee can only be validated against a real server, not a mock. Gate these behind
  a separate `test:integration` script (require Docker) so the fast unit suite stays Docker-free.

## Docker (prescriptive)

- **Base image:** `node:24-alpine` for the build/runtime image. Alpine keeps it small and is the
  conventional, reviewable choice. (Distroless is smaller still but harder to debug and shell into
  during an interview demo — not worth it here.)
- **Multi-stage:** build stage runs `tsup`; runtime stage copies `dist` + production deps only,
  runs as non-root `node` user.
- **docker-compose:** two services — `app` (the demo server) and `redis` (`redis:7.4-alpine`) on a
  shared network, with a healthcheck on Redis and `depends_on`. This satisfies the "ease of
  deployment" + "docker-compose for app+redis" requirements directly.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| ioredis | node-redis v6 | If the project did not mandate ioredis and you preferred the official client's RESP3/typing direction. Not applicable here — constraint fixes ioredis. |
| Vitest | Node built-in `node:test` | If you wanted zero test deps. But fake-timer ergonomics + watch/coverage DX make Vitest clearly better for time-sensitive algorithm tests. |
| Vitest | Jest | Jest works but is slower with ESM/TS and adds ts-jest/babel config friction. No upside here. |
| tsup | raw `tsc` (two configs) | If you want zero bundler and ESM-only output. Acceptable, but tsup's dual output + dts in one config is less error-prone. |
| @testcontainers/redis | docker-compose-managed Redis for tests | If CI already guarantees a running Redis. Testcontainers is preferred because `npm test` becomes self-contained and port-conflict-free. |
| TypeScript ~5.9 | TypeScript 6.0 | After 6.0 tooling (typescript-eslint, tsup/esbuild) has clearly stabilized and you're starting fresh post-deadline. Avoid for this graded deliverable. |
| node:24-alpine | distroless (`gcr.io/distroless/nodejs24`) | Hardened production deploys where image attack surface matters more than debuggability. Overkill for a challenge demo. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ioredis-mock` | Duplicates the project's own in-memory `Store`; tests the mock's Lua emulation, not real Redis atomicity — false confidence on the exact thing being graded | In-memory `Store` for unit tests + real Redis via testcontainers for integration |
| An off-the-shelf limiter (`express-rate-limit`, `rate-limiter-flexible`) | The challenge *is* to implement the algorithms; importing one defeats the purpose and reads as AI slop | Hand-written Token Bucket / Sliding Window / Fixed Window behind the `Store` interface |
| `node-redis` | Violates the stated ioredis constraint; loses `defineCommand` ergonomics | ioredis `defineCommand` |
| Redis `FUNCTION`/Functions API for the scripts | Newer, more powerful, but more ceremony than needed and less universally familiar to reviewers | Plain `EVAL`/`EVALSHA` via ioredis `defineCommand` |
| ESLint legacy `.eslintrc` | Unsupported in ESLint 10; flat config only | `eslint.config.js` flat config + `typescript-eslint` |
| `ts-node` | Slower, ESM config friction vs esbuild-based runner | `tsx` for dev, `tsup` for build |
| Express 4 | Maintenance line; v5 is `latest` with native async error handling that suits the awaiting limiter | Express 5 |
| Winston / heavy logging frameworks | Heavier than needed; pino covers the nice-to-have cleanly | pino (+ pino-pretty dev only) |
| Node 20/22 base image, or `:latest` tags anywhere | v20 EOL, v22 maintenance; `:latest` breaks reproducibility | Pinned `node:24-alpine`, `redis:7.4-alpine` |

## Stack Patterns by Variant

**If shipping as a reusable library (recommended framing):**
- Author ESM, build dual ESM+CJS + `.d.ts` via tsup, set `package.json` `exports`/`types`.
- Keep core algorithm package free of any Express/ioredis import — adapters live in separate entry points.

**If shipping as a single self-contained challenge app only:**
- ESM-only output is acceptable; you can skip the CJS half of tsup. Still keep the `Store`/adapter
  separation for testability and APOSD-style deep modules.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| typescript ~5.9 | typescript-eslint ^8.62 | tseslint 8.x validates against TS 5.x; holding TS at 5.9 avoids peer-range warnings |
| @types/node ^24 | Node.js 24 runtime | Match the LTS line you run in Docker |
| @types/express ^5 | express ^5.1 | Use the v5 types, not v4 |
| @vitest/coverage-v8 ^4.1 | vitest ^4.1 | Keep coverage version locked to the runner version |
| eslint-config-prettier ^10.1 | eslint ^10.5 + prettier ^3.8 | Disables conflicting stylistic rules; no overlap |
| ioredis ^5.11 | redis 7.4 server | EVAL/EVALSHA + defineCommand fully supported |

## Sources

- npm registry (`npm view`) — exact latest versions verified on 2026-06-23: typescript 6.0.3 (holding at 5.9 by recommendation), ioredis 5.11.1, redis 6.0.0, express 5.2.1, vitest 4.1.9, tsup 8.5.1, eslint 10.5.0, prettier 3.8.4, pino 10.3.1, prom-client 15.1.3, testcontainers/@testcontainers/redis 12.0.3, supertest 7.2.2, typescript-eslint 8.62.0, tsx 4.22.4, eslint-config-prettier 10.1.8, @types/express 5.0.6, @types/node 26.0.0 (recommend ^24 to match LTS). — HIGH
- nodejs.org previous-releases — Node 24 "Krypton" Active LTS, 22 "Jod" Maintenance, 20 "Iron" EOL (Mar 2026), 26 Current. — HIGH
- Context7 `/redis/ioredis` — `defineCommand` automatic EVALSHA caching + EVAL fallback, evalsha API, command/connection timeouts. — HIGH

---
*Stack research for: distributed rate-limiter library + Express middleware (TS/Node + Redis)*
*Researched: 2026-06-23*
