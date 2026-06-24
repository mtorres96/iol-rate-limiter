---
phase: 02-conformance-harness-redis-lua-store-defensive-behavior
plan: 02
subsystem: redis-store-and-conformance-contract
tags: [lua, redis, ioredis, testcontainers, conformance, tsup, atomic-ops]
requires:
  - "MemoryStore parity oracle (src/store/memory.ts, Phase 1)"
  - "Core contracts (src/types.ts: Store/OpTuple/Decision/Clock, Phase 1)"
  - "The three limiters + FakeClock (src/index.ts barrel, Phase 1)"
provides:
  - "src/store/lua/{token-bucket,sliding-window,fixed-window}.lua — atomic rl_tb/rl_sw/rl_fw ops"
  - "tsup asset-copy: dist/store/lua/*.lua ships with the built package"
  - "test/conformance/sequences.ts — tbCases/swCases/fwCases parity fixtures"
  - "ioredis ^5.11 (runtime) + @testcontainers/redis ^12 + testcontainers ^12 (dev)"
affects:
  - "Plan 02-03 (RedisStore: defineCommand loads these .lua via dist/store/lua)"
  - "Plan 02-04 (conformance suite drives sequences.ts across Memory + Redis stores)"
tech-stack:
  added:
    - "ioredis@5.11.1 (runtime dependency)"
    - "@testcontainers/redis@12.0.3 (devDependency)"
    - "testcontainers@12.0.3 (devDependency)"
  patterns:
    - "Atomic Lua port: line-by-line transcription of MemoryStore ops; numberOfKeys:1, now via ARGV"
    - "In-script TTL via PEXPIRE (token-bucket: ceil(cap/refill*interval)+1; windows: 2*windowMs+1)"
    - "Lossless float persistence: tokens stored as string.format('%.17g', ...) hash field"
    - "tsup onSuccess cpSync to ship non-.ts assets into dist"
    - "Shared fixture file (data + make closures) decoupled from the running test"
key-files:
  created:
    - "rate-limiter/src/store/lua/token-bucket.lua"
    - "rate-limiter/src/store/lua/sliding-window.lua"
    - "rate-limiter/src/store/lua/fixed-window.lua"
    - "rate-limiter/test/build-smoke.test.ts"
    - "rate-limiter/test/conformance/sequences.ts"
  modified:
    - "rate-limiter/tsup.config.ts"
    - "rate-limiter/package.json"
    - "rate-limiter/package-lock.json"
decisions:
  - "Asset copy via tsup `onSuccess` + node:fs cpSync (recursive) — minimal, no extra dep, resolves relative to built module"
  - "Build-smoke test runs the real `npm run build` in beforeAll, then asserts all three dist/store/lua/*.lua are non-empty — self-contained under `npm test`"
  - "sequences.ts `make` typed as (store: Store, clock: Clock) — keeps fixtures decoupled from the concrete FakeClock"
metrics:
  duration: "~12 min"
  completed: 2026-06-24
  tasks: 2
  files_created: 5
  files_modified: 3
---

# Phase 2 Plan 02: Atomic-Lua Algorithm Ports + Conformance Contract Summary

Ported the three MemoryStore ops to atomic Redis Lua scripts (identical floor/ceil, in-script PEXPIRE TTL, `%.17g` token persistence), wired tsup to ship those `.lua` assets into `dist`, installed the ioredis/testcontainers deps, and authored the shared `sequences.ts` parity fixtures (incl. the Xu sliding-window anchor and the fixed-window boundary burst).

## What Was Built

### Task 1 — Deps + three Lua scripts + tsup asset copy + build smoke test (`8ab9a7e`)
- Installed `ioredis@^5.11` as a runtime dependency; `@testcontainers/redis@^12` and `testcontainers@^12` as devDependencies (versions resolved to 5.11.1 / 12.0.3 — matching the CLAUDE.md lock; the supply-chain human-verify checkpoint was pre-approved by the orchestrator).
- Authored `src/store/lua/token-bucket.lua` (`rl_tb`), `sliding-window.lua` (`rl_sw`), `fixed-window.lua` (`rl_fw`) as line-by-line ports of the matching `memory.ts` ops. Each: `numberOfKeys:1`, `KEYS[1]` = the namespaced key, `now` injected via ARGV (never `redis.call('TIME')`), every `math.floor`/`math.ceil` at the identical point as the oracle, and a 4-element integer return `{allowed, remaining, resetMs, retryAfterMs}` (floored/ceiled BEFORE return — Pitfall 1).
- Token-bucket persists `tokens` as `string.format("%.17g", tokensAfter)` (lossless IEEE-754 round-trip), never as a bare Lua number.
- Sliding-window reproduces the 3-way `retryAfterMs` branch (memory.ts L148-165) verbatim: allowed→0; `curr+cost>limit`→`ceil(msToBoundary)`; else `min(ceil(overshoot*msToDecayOne), ceil(msToBoundary))` with `msToDecayOne = prev>0 ? windowMs/prev : msToBoundary`.
- In-script TTL via `PEXPIRE` in all three: token-bucket `ceil(capacity/refillPerInterval*intervalMs)+1`; both windows `2*windowMs+1`.
- `tsup.config.ts` gains an `onSuccess` hook (`cpSync('src/store/lua','dist/store/lua',{recursive:true})`) so the `.lua` assets ship into the built package (`format:['esm']`, `target:'node24'` unchanged).
- `test/build-smoke.test.ts` runs the real `npm run build` then asserts all three `dist/store/lua/*.lua` are non-empty (RESEARCH A4).

### Task 2 — Shared conformance fixtures `sequences.ts` (`fad2e89`)
- `test/conformance/sequences.ts` exports `tbCases`, `swCases`, `fwCases` as `AlgoCase[]`. Each case has a `name`, a `make(store, clock)` that builds the matching limiter (config baked in), and ordered `steps: { now, cost, key }[]` driven by absolute `now`.
- `tbCases`: drain-to-empty, lazy N-interval refill, fractional-refill floor, cost>capacity reject, exact-limit admit/reject.
- `swCases`: the **Xu Ch.4 anchor** (build prev=5 in bucket 0, move 50% into bucket 1, log curr=3, final cost-1 → `floor(3+5*0.5)=5`; `5+1=6<=7` → admit, remaining 1), plus rollover-then-full-decay and the exact-edge sequence.
- `fwCases`: fill-to-limit, rollover reset, and the **2× boundary burst** (5 admits at t=999 + 5 more at t=1000).
- Pure data + `make` closures; imports only from `../../src/index.js`. No ioredis import (the running conformance test lands in plan 04).

## Verification

| Check | Result |
|-------|--------|
| `node -e "require.resolve('ioredis')"` | resolvable |
| three `.lua` files exist, non-empty | yes (57 / 89 / 45 lines) |
| token-bucket.lua contains `string.format`; all three contain `PEXPIRE` | yes |
| `npm run build` exit 0 + `dist/store/lua/*.lua` non-empty | yes (2872 / 3697 / 2028 bytes) |
| build-smoke test | 3/3 pass |
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| `sequences.ts` exports tbCases/swCases/fwCases | yes |
| `grep -c ioredis sequences.ts` | 0 |
| full `npm test` | 49/49 pass (6 files) |

## Deviations from Plan

None — plan executed exactly as written. The first task (T-02-SC supply-chain human-verify checkpoint) was pre-resolved as "approved" by the orchestrator, so the install proceeded directly.

## Notes for Downstream Plans

- **Plan 02-03 (RedisStore):** load each script via `readFileSync(new URL('./lua/<algo>.lua', import.meta.url), 'utf8')` + `client.defineCommand('rl_xx', { numberOfKeys: 1, lua })`. The loader resolves against the built module, and the assets are now in `dist/store/lua/`.
- **Plan 02-04 (conformance suite):** consume `tbCases`/`swCases`/`fwCases` from `sequences.ts`; compute the expected `Decision` once per step and assert the SAME value against both `MemoryStore` and `RedisStore` with `toEqual`.
- **Async migration (Plan 02-01, same wave):** `sequences.ts` types `make` against the current synchronous `Store` interface; once `Store` ops return `Promise<OpTuple>`, the fixtures still typecheck unchanged (the `make` closures return `RateLimiter`, whose `consume` is already async).

## Self-Check: PASSED
- FOUND: rate-limiter/src/store/lua/token-bucket.lua
- FOUND: rate-limiter/src/store/lua/sliding-window.lua
- FOUND: rate-limiter/src/store/lua/fixed-window.lua
- FOUND: rate-limiter/test/build-smoke.test.ts
- FOUND: rate-limiter/test/conformance/sequences.ts
- FOUND commit: 8ab9a7e
- FOUND commit: fad2e89
