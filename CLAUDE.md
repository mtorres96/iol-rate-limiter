<!-- GSD:project-start source:PROJECT.md -->
## Project

**IOL Rate Limiter**

A distributed **rate limiter** implemented in TypeScript/Node.js, built as the practical
deliverable for IOL's System Design Implementation Challenge (based on the rate limiter
chapter of *System Design Interview — An Insider's Guide, Vol 1* by Alex Xu). It is a
framework-agnostic core library (multiple rate-limiting algorithms behind one interface,
backed by pluggable storage) plus an Express middleware adapter and a demo HTTP server,
deployable via Docker.

**Core Value:** The core rate-limiting algorithms must be **correct under concurrency** and **comprehensively
tested** — including time-based and race-condition edge cases. If everything else fails, the
algorithms must provably enforce their limits.

### Constraints

- **Tech stack**: TypeScript on Node.js — chosen to match the IOL backend role and the book's
  distributed design.
- **Tech stack**: Redis for the distributed store (atomic Lua scripts) — correctness under
  concurrent access without round-trip race conditions.
- **Tech stack**: Express middleware, Vitest test runner, `ioredis` client — sensible,
  widely-understood defaults; core kept framework/transport-agnostic.
- **Quality**: Code must build and all tests must pass at every milestone (mandatory gate).
- **Design**: Favor clarity and deep modules (APOSD) over feature breadth; avoid overengineering.
- **Deliverable**: Solution lives under a `/rate-limiter` folder with a `DESIGN.md`.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| tsup | Build / bundle to clean dual ESM+CJS + `.d.ts` | `^8.5` (verified 8.5.1). One config, zero ceremony: `entry`, `format: ['esm','cjs']`, `dts: true`, `sourcemap: true`, `clean: true`. Far less footgun than hand-rolling `tsc` dual builds + `package.json` exports. |
| ESLint | Lint (flat config `eslint.config.js`) | `^10.5` (verified 10.5.0). Flat config is the only supported format now. Pair with `typescript-eslint@^8.62`. |
| typescript-eslint | TS-aware lint rules + parser | `^8.62` (verified). Provides `tseslint.config()` helper for the flat config. Validated against TS 5.x — another reason to hold TS at 5.9. |
| Prettier | Formatting | `^3.8` (verified 3.8.4). Add `eslint-config-prettier@^10.1` to disable conflicting ESLint stylistic rules. Do NOT run Prettier *as* an ESLint plugin — keep them separate. |
| tsx | Run TS demo server / scripts without a build step | `^4.22` (verified 4.22.4). For `dev` script and ad-hoc scripts. Don't ship it in the runtime image. |
## tsconfig posture (prescriptive)
## Installation
# Runtime (library + adapter)
# Nice-to-haves
# Dev — types
# Dev — test
# Dev — lint / format / build / run
## Express 5 migration notes (v4 → v5)
- Path-matching uses `path-to-regexp@8`: bare `*` wildcards and unnamed regex groups behave
- `req.query` is now a getter (read-only) — fine for a limiter that only reads.
- Rejected promises in middleware now propagate to the error handler automatically, so the
- Removed long-deprecated signatures (`res.send(status)`, `app.del`, etc.) — not used here.
## Redis client: ioredis vs node-redis (why ioredis)
| Concern | ioredis ^5.11 | node-redis ^6 |
|---------|---------------|---------------|
| Custom Lua command | `defineCommand(name, { numberOfKeys, lua })` — auto EVALSHA + NOSCRIPT fallback, callable like a native typed command | `defineScript` / `client.eval`; workable but ergonomics are less seamless |
| Command timeout | `commandTimeout` per client (defensive design req) | Supported but less batteries-included |
| Constraint fit | **Explicitly required by PROJECT.md** | Would violate the stated constraint |
## Testing time + concurrency (prescriptive)
- **Algorithm unit tests (in-memory store):** inject a clock (`now: () => number`) into the limiter
- **Concurrency:** fire N overlapping `Promise.all` requests and assert exactly `limit` are allowed —
- **Redis integration tests:** use `@testcontainers/redis` to start a real `redis:7.4` per run; the
## Docker (prescriptive)
- **Base image:** `node:24-alpine` for the build/runtime image. Alpine keeps it small and is the
- **Multi-stage:** build stage runs `tsup`; runtime stage copies `dist` + production deps only,
- **docker-compose:** two services — `app` (the demo server) and `redis` (`redis:7.4-alpine`) on a
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
- Author ESM, build dual ESM+CJS + `.d.ts` via tsup, set `package.json` `exports`/`types`.
- Keep core algorithm package free of any Express/ioredis import — adapters live in separate entry points.
- ESM-only output is acceptable; you can skip the CJS half of tsup. Still keep the `Store`/adapter
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
