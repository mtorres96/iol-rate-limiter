---
phase: 02-conformance-harness-redis-lua-store-defensive-behavior
plan: 03
subsystem: redis-store-defensive-layer
tags: [ioredis, redis, lua, circuit-breaker, defensive, fail-open, fail-closed, atomic]

# Dependency graph
requires:
  - phase: 02-01
    provides: "Async Store contract (Promise<OpTuple>); RedisStoreConfig/RateLimitPolicy/BreakerConfig type-only shapes; assertPolicy/assertPrefix validators"
  - phase: 02-02
    provides: "rl_tb/rl_sw/rl_fw Lua scripts in src/store/lua/ + tsup asset copy into dist/store/lua/"
provides:
  - "CircuitBreaker — deterministic injectable-Clock state machine (closed/open/half-open; 5 failures / 2000ms cooldown / 1 probe defaults)"
  - "RedisStore implements the async Store via one shared ioredis client; rl_tb/rl_sw/rl_fw registered via defineCommand"
  - "Bounded commandTimeout (default 75ms) + breaker gate + fail-open/closed policy that NEVER rejects (DEF-01/DEF-02)"
  - "Barrel exports RedisStore + CircuitBreaker"
affects:
  - "Plan 02-04 (conformance suite drives RedisStore + MemoryStore through one async contract)"
  - "Plan 02-05 (fault-injection: down/slow Redis × fail-open/closed × breaker)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single shared ioredis client + defineCommand (D2-08): auto-EVALSHA + NOSCRIPT fallback; the three Lua scripts loaded once at module load via readFileSync(new URL('./lua/<algo>.lua', import.meta.url))"
    - "Defensive op seam (DEF-01/DEF-02): every op flows through one private run() — breaker gate → bounded call → recordSuccess; catch-all → recordFailure → degraded(policy). No throw/reject on the op path."
    - "ioredis isolated to src/store/redis.ts ONLY — the core (types.ts, limiters) stays transport-agnostic (tier boundary)"
    - "CircuitBreaker reuses the same injectable Clock the limiters use, so every cooldown transition is FakeClock-deterministic (no real timers)"

key-files:
  created:
    - "rate-limiter/src/store/breaker.ts"
    - "rate-limiter/src/store/redis.ts"
    - "rate-limiter/test/breaker.test.ts"
  modified:
    - "rate-limiter/src/index.ts"

key-decisions:
  - "RedisStore takes a pre-built ioredis client (DI for testcontainers in plans 04/05) AND offers a static connect() that builds the client with the defensive options (commandTimeout from config, maxRetriesPerRequest:1, enableOfflineQueue:false, lazyConnect:true)"
  - "Config is a Partial<RedisStoreConfig> merged over D2-04..D2-07 defaults (keyPrefix 'rl', commandTimeoutMs 75, policy 'fail-open', breaker 5/2000), then validated at construction (assertPrefix/assertPolicy/assertPositiveConfig)"
  - "degraded() is time-independent: fail-open → [1,0,0,0] (admit; remaining/reset unknown→0); fail-closed → [0,0,cooldownMs,cooldownMs] (deny with a cooldown-sized backoff). The speculative `now` param was dropped (it was unused — lint-clean)."
  - "rl_* custom commands are declared via a ScriptClient intersection type (they are not on ioredis's published types) — avoids `as any` casts at every call site"

patterns-established:
  - "Defensive store wrapper: a single private run() centralizes the breaker-gate + bounded-call + policy-degrade so all three algorithm ops share ONE never-rejecting error path"

requirements-completed: [STOR-02, STOR-04, STOR-05, DEF-01, DEF-02]

# Metrics
duration: ~12min
completed: 2026-06-24
tasks: 2
files_created: 3
files_modified: 1
---

# Phase 2 Plan 03: RedisStore + Defensive Layer Summary

**Implemented the distributed `RedisStore` (async `Store` backed by atomic Lua via one shared ioredis `defineCommand` client) and its full defensive wrapper — a bounded `commandTimeout`, an in-tree deterministic `CircuitBreaker`, and a fail-open/closed policy that NEVER rejects — plus FakeClock breaker unit tests and the barrel exports.**

## Performance
- **Duration:** ~12 min
- **Tasks:** 2 completed
- **Files created:** 3 / modified: 1

## What Was Built

### Task 1 — CircuitBreaker + deterministic FakeClock tests (`54dd180`, feat)
- `src/store/breaker.ts`: `CircuitBreaker(clock, failureThreshold=5, cooldownMs=2000)` — a `"closed"|"open"|"half-open"` machine. `canAttempt()` transitions OPEN→HALF-OPEN once `clock.now() - openedAt >= cooldownMs` and returns `state !== "open"`. `recordSuccess()` closes + resets; `recordFailure()` opens (or re-opens from half-open) and stamps `openedAt = clock.now()` so the cooldown restarts. Type-only `Clock` import — no real timers, no `Date.now()`.
- `test/breaker.test.ts`: 7 tests covering every transition — closed start, success-resets-failures, 5-failures-opens (asserts still-closed before the 5th), stays-open-1ms-short, cooldown→single-probe, probe-success→closed, probe-failure→re-open-with-restarted-cooldown. All driven by `FakeClock.tick/setTime`, zero `setTimeout`.

### Task 2 — RedisStore (defineCommand + timeout + breaker + policy) + barrel (`d6a4e20`, feat)
- `src/store/redis.ts`: `RedisStore implements Store`. Loads the three plan-02-02 Lua scripts once via `readFileSync(new URL("./lua/<algo>.lua", import.meta.url), "utf8")` and registers them on a single shared client with `defineCommand("rl_tb"|"rl_sw"|"rl_fw", { numberOfKeys: 1, lua })` (D2-08).
- Each op builds the namespaced key `${keyPrefix}:{tb|sw|fw}:${key}` (D2-07) and calls the script with ARGV in the EXACT script order (`rl_tb`: now,capacity,refillPerInterval,intervalMs,cost; `rl_sw`/`rl_fw`: now,limit,windowMs,cost).
- A single private `run()` is the defensive seam (DEF-01/DEF-02): `if (!breaker.canAttempt()) return degraded()`; else `try` the call → `recordSuccess()` → return the integer tuple; `catch` (timeout/error) → `recordFailure()` → `degraded()`. There is NO `throw`/reject on the op path.
- `degraded()`: fail-open (default, D2-04) → `[1,0,0,0]` (admit); fail-closed → `[0,0,cooldownMs,cooldownMs]` (deny with cooldown backoff).
- Static `connect(connection?, config?, clock?)` builds the client with `commandTimeout` (from config, default 75ms — DEF-01), `maxRetriesPerRequest: 1`, `enableOfflineQueue: false`, `lazyConnect: true` (fail fast into the breaker). `close()` for test teardown.
- Construction validates the merged config via `assertPrefix`/`assertPolicy`/`assertPositiveConfig` (T-02-01). ioredis is imported ONLY here.
- `src/index.ts`: export `RedisStore` + `CircuitBreaker` (config types already exported by 02-01).

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| `npx vitest run test/breaker.test.ts` | 7/7 pass |
| `npm run lint` (`eslint .`) | exit 0 (clean) |
| `src/store/redis.ts` contains `defineCommand` + `rl:tb:`/`rl:sw:`/`rl:fw:` keys | yes |
| ioredis imported in exactly one src file | `src/store/redis.ts` only |
| `src/types.ts` ioredis IMPORT statements | 0 (the 2 grep hits are documentation prose; `grep -nE '^\s*import\b.*ioredis'` → none) |
| `src/index.ts` exports `RedisStore` + `CircuitBreaker` | yes |
| no `throw`/reject on the op path | confirmed — every catch resolves through `degraded()` |
| full `npm test` (incl. build-smoke that builds dist) | 56/56 pass (7 files) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored declared dependencies in the worktree**
- **Found during:** start (node_modules absent in a fresh worktree — gitignored).
- **Fix:** Ran `npm ci` to restore lockfile-pinned, already-vetted deps (a restore, not a new install). No tracked files changed (`node_modules` is gitignored).

**2. [Rule 1 - Lint/correctness] Dropped the unused `now` parameter from `degraded()`/`run()`**
- **Found during:** Task 2 lint (`'_now' is defined but never used`).
- **Issue:** The plan's suggested `degraded(policy, cfg, cost, now)` signature carried a `now` that the time-independent policy values never use; `eslint` (a mandatory gate per CLAUDE.md) failed on the unused param.
- **Fix:** Removed `now` from `degraded()` and from the private `run()` seam (the ops still pass `now` into the Lua ARGV — that path is unchanged). Policy output is best-effort and time-independent by design.
- **Files modified:** `src/store/redis.ts` — **Commit:** `d6a4e20`.

## Design Notes (within plan intent)
- **DI-first constructor:** `RedisStore(client, config?, clock?)` accepts a pre-built ioredis client so plans 04/05 can inject a testcontainers client and a `FakeClock`; the `static connect()` is the batteries-included path that wires the defensive connection options. The plan said "single shared client" — both paths use exactly one client.
- **`ScriptClient` intersection type** declares the three `rl_*` custom commands instead of `as any` casts, keeping the call sites typed.

## Threat Model Coverage
- **T-02-08 (Injection, namespaced key):** mitigated — the client key passes ONLY as `KEYS[1]` to the `numberOfKeys:1` defineCommand'd script; the prefix is `assertPrefix`-validated and never client-controlled; no key is concatenated into the Lua body.
- **T-02-09 (DoS, hung/slow Redis):** mitigated — `commandTimeout` (default 75ms) bounds every call; the breaker short-circuits during an outage so timeouts don't pile up.
- **T-02-10 (Elevation/Bypass, fail-open):** accept — fail-open is the intended, configurable default (D2-04); fail-closed is available; rationale deferred to DESIGN.md (Phase 4).
- **T-02-11 (DoS, unhandled rejection):** mitigated — every op `catch`es all errors and resolves through `degraded()`; `RedisStore` never rejects (verified: no `throw`/reject on the op path).
- **T-02-SC (Tampering, installs):** mitigated — deps were the lockfile-pinned set restored via `npm ci`; no new packages installed (the supply-chain checkpoint was resolved in plan 02-02).

## No Known Stubs
No placeholder/empty-data stubs. `degraded()`'s `[1,0,0,0]`/`[0,0,cooldownMs,cooldownMs]` are the intentional fail-open/closed policy outputs (DEF-02), not stubs.

## Notes for Downstream Plans
- **Plan 02-04 (conformance):** construct `new RedisStore(testcontainerClient, { keyPrefix }, fakeClock)` and drive `tbCases`/`swCases`/`fwCases` from `sequences.ts`; flush Redis or use unique keys per case. The success tuple is the raw script tuple (integers), identical to MemoryStore.
- **Plan 02-05 (fault injection):** to exercise the policy path, inject a client whose calls reject/time out (or stop the container) and assert `degraded()` output + breaker transitions; pass a `FakeClock` to drive the cooldown deterministically.

## Self-Check: PASSED
- FOUND: rate-limiter/src/store/breaker.ts
- FOUND: rate-limiter/src/store/redis.ts
- FOUND: rate-limiter/test/breaker.test.ts
- FOUND commit: 54dd180 (Task 1)
- FOUND commit: d6a4e20 (Task 2)
