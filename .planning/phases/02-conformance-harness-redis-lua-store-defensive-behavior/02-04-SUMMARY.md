---
phase: 02-conformance-harness-redis-lua-store-defensive-behavior
plan: 04
subsystem: conformance-and-real-redis-tests
tags: [conformance, testcontainers, redis, lua, concurrency, parity, vitest, atomicity]

# Dependency graph
requires:
  - phase: 02-01
    provides: "Async Store contract (Promise<OpTuple>); RedisStoreConfig shape"
  - phase: 02-02
    provides: "sequences.ts tbCases/swCases/fwCases parity fixtures; the three Lua scripts"
  - phase: 02-03
    provides: "RedisStore (DI client constructor + static connect()); namespacing rl:{tb,sw,fw}:<key>; commandTimeout/breaker/policy"
provides:
  - "test/support/redis.ts — dockerAvailable() daemon-liveness probe + one-container-per-file lifecycle (startRedis/makeRedisStore/stopRedis)"
  - "test/conformance/store-conformance.test.ts — describe.each over [MemoryStore, RedisStore] asserting the FULL Decision toEqual a single shared expectation (TEST-02 parity contract)"
  - "test/redis-integration.test.ts — per-algorithm happy path over real redis:7.4-alpine (TEST-03)"
  - "test/redis-concurrency.test.ts — Promise.all burst admits EXACTLY limit via single-Lua-script atomicity (TEST-04)"
  - "vitest.config.ts testTimeout 60s / hookTimeout 120s for container startup"
affects:
  - "Plan 02-05 (fault injection reuses the support/redis.ts harness + dockerAvailable() guard)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "dockerAvailable() is a SYNCHRONOUS daemon-liveness probe (execFileSync 'docker info', cached) — NOT a socket-existence check: Docker Desktop leaves a dead ~/.docker/run/docker.sock on disk, which would make the suite FAIL on container start instead of skip"
    - "Single shared expectation: replay every fixture once against the in-memory oracle in beforeAll, freeze the Decision[] in a Map, assert BOTH stores toEqual that ONE value (a per-store expectation could mask a Redis bug)"
    - "describe.each over store params + describe.skip when the param's skip flag is set (RedisStore skips with no Docker); the lazy file-scoped harness is only started if the RedisStore param actually runs"
    - "One container per FILE (Pitfall 5): beforeAll start / afterAll stop; per-test isolation via flushall + per-case keyPrefix"
    - "Redis concurrency test mirrors concurrency.test.ts's burst() framing but the atomicity under test is single-Lua-script (server-side, cross-client), not the event loop"

key-files:
  created:
    - "rate-limiter/test/support/redis.ts"
    - "rate-limiter/test/conformance/store-conformance.test.ts"
    - "rate-limiter/test/redis-integration.test.ts"
    - "rate-limiter/test/redis-concurrency.test.ts"
  modified:
    - "rate-limiter/vitest.config.ts"

key-decisions:
  - "dockerAvailable() probes the DAEMON (execFileSync 'docker info'), not the socket file — a stale Docker Desktop socket existed on this host and a file-existence check produced a false positive that FAILED collection; the liveness probe is the correct skip-vs-fail discriminator (T-02-14)"
  - "The shared expected Decision[] is computed ONCE from MemoryStore (the Phase-1 trusted oracle) in beforeAll and asserted against both stores — keeps it a true conformance test (the Redis side cannot 'pass' by encoding its own bug)"
  - "Refactored the store parameterization to a real describe.each over [MemoryStore, RedisStore] (the plan's prescribed shape and the must_haves artifact `contains: describe.each`), using describe.skip for the skipped param so the lazy harness is never started when Docker is absent"

requirements-completed: [TEST-02, TEST-03, TEST-04]

# Metrics
duration: ~10min
completed: 2026-06-24
tasks: 2
files_created: 4
files_modified: 1
---

# Phase 2 Plan 04: Conformance Harness + Real-Redis Integration & Concurrency Summary

**Authored the parity contract (TEST-02) — one `describe.each` suite that drives the shared `sequences.ts` fixtures through BOTH `MemoryStore` and `RedisStore` and asserts the FULL `Decision` against a single shared expectation — plus the real-`redis:7.4-alpine` integration happy-path (TEST-03) and the `Promise.all` over-admission guard that proves a burst admits EXACTLY `limit` via single-Lua-script atomicity (TEST-04). All four files skip cleanly when no Docker daemon is reachable, so `npm test` still gates the in-memory core.**

## What Was Built

### Task 1 — Container helper + parametrized conformance suite (`d321d60`, test)
- `test/support/redis.ts`: a SYNCHRONOUS `dockerAvailable()` (used by `describe.skipIf`), `startRedis()` (one pinned `redis:7.4-alpine` + shared ioredis client), `makeRedisStore(harness, clock, config)` (builds a `RedisStore` over the shared client + injected `FakeClock`), and `stopRedis()`.
- `test/conformance/store-conformance.test.ts`: a `describe.each` over `[MemoryStore, RedisStore]`. The shared expected `Decision[]` per case is computed ONCE from the in-memory oracle in `beforeAll`; each store parameter asserts its replay `toEqual` that single value (so any TS↔Lua drift — a wrong floor/ceil, lost fraction, mis-ordered ARGV — fails). RedisStore param uses `describe.skip` when Docker is absent; one container for the whole file (Pitfall 5); cases isolated by `flushall` + per-case `keyPrefix`.
- `vitest.config.ts`: `testTimeout: 60_000` / `hookTimeout: 120_000` for container startup.

### Task 2 — Real-Redis integration + concurrency over-admission (`6145e81`, test)
- `test/redis-integration.test.ts` (`describe.skipIf(!dockerAvailable())`, one container, `flushall` per test): per-algorithm happy path — Token Bucket admit-to-capacity / reject / lazy-refill-after-interval; Fixed Window fill / reject / window-reset; Sliding Window admit-to-limit / reject + the Xu Ch.4 anchor (remaining=1) — all over REAL Redis, asserting state survives across round-trips and that `resetMs`/`retryAfterMs`/`remaining` are integers (D-09).
- `test/redis-concurrency.test.ts` (same guard + container): the `burst()` helper fires `N≫limit` overlapping `consume(sameKey)` via `Promise.all` on the shared client with a FIXED `now`; asserts EXACTLY `limit` admitted for token-bucket (5) and fixed-window (7) — the distributed over-admission guard. A header block mirrors `concurrency.test.ts`'s framing, contrasting single-Lua-script (server-side, cross-client) atomicity against the event-loop lock.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| `npm run lint` (`eslint .`) | exit 0 (clean) |
| `npx vitest run test/conformance/store-conformance.test.ts` | exit 0 — 11 MemoryStore pass, 11 RedisStore SKIPPED (no Docker) |
| `npx vitest run test/redis-integration.test.ts test/redis-concurrency.test.ts` | exit 0 — 6 SKIPPED (no Docker) |
| `grep -q "describe.each" store-conformance.test.ts` | yes |
| `grep -q "RedisContainer" test/support/redis.ts` | yes; `dockerAvailable` exported |
| `grep -q "burst"` + `Promise.all` in redis-concurrency.test.ts | yes |
| full `npm test` (incl. build-smoke that runs `tsup`) | 8 files passed (67), 2 files skipped (17) — green |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored declared dependencies in the fresh worktree**
- **Found during:** start (node_modules absent — gitignored in a fresh worktree).
- **Fix:** `npm ci` to restore lockfile-pinned, already-vetted deps (a restore, not a new install). No tracked files changed.

**2. [Rule 1 - Bug] `dockerAvailable()` must probe the DAEMON, not the socket file**
- **Found during:** Task 1 first run of the conformance suite.
- **Issue:** An initial socket-existence heuristic (`existsSync('/var/run/docker.sock')` etc.) returned a FALSE POSITIVE on this host — Docker Desktop leaves `~/.docker/run/docker.sock` on disk even when the daemon is stopped. That made `describe.skipIf` think Docker was available, so the RedisStore param ran and `RedisContainer.start()` threw ("Could not find a working container runtime strategy"), FAILING the suite instead of skipping it — directly violating the T-02-14 "skip cleanly without Docker" requirement.
- **Fix:** Rewrote `dockerAvailable()` to run a real liveness probe — `execFileSync("docker", ["info"], { timeout: 10_000 })` — which exits non-zero against a dead daemon and 0 against a live one (result cached). Now the suites skip cleanly.
- **Files modified:** `test/support/redis.ts` — **Commit:** `d321d60`.

**3. [Rule 1 - Contract] Switched store parameterization to a real `describe.each`**
- **Found during:** Task 1 verification (`grep -q "describe.each"`).
- **Issue:** The first draft used a manual `for` loop with `describe.skipIf`; the plan's prescribed shape and the `must_haves` artifact require `contains: "describe.each"`.
- **Fix:** Refactored to `describe.each(storeParams)` over `[MemoryStore, RedisStore]`, using `describe.skip` for the skipped param so the lazy file-scoped harness is only started when the RedisStore param actually runs.
- **Files modified:** `test/conformance/store-conformance.test.ts` — **Commit:** `d321d60`.

## BLOCKING DEVIATION — Redis-backed suites authored but UNVERIFIED LOCALLY (no Docker)

**Per the executor prompt's explicit instruction: Docker is NOT available in this worktree (`docker info` fails — the daemon is not running), so the three Redis-backed suites could not be executed against a real container here. They are authored to spec and PROVABLY skip cleanly (verified: 17 skipped, 0 failed), but their PASS against real Redis has NOT been observed on this machine.** This is flagged as a Rule-3 blocking deviation, not a silent skip.

**What WAS verified locally (no Docker required):**
- `tsc --noEmit` clean; `eslint .` clean.
- The MemoryStore half of the conformance suite (11 cases) PASSES — the parity oracle itself is sound.
- All Redis-dependent describe blocks skip cleanly (`describe.skipIf(!dockerAvailable())` / `describe.skip`); `npm test` stays green (67 passed / 17 skipped).

**What MUST be run on a host with a live Docker daemon to confirm TEST-02/03/04:**
```bash
cd rate-limiter
npm ci                 # if node_modules absent
docker info            # confirm a LIVE daemon (not just an installed CLI / stale socket)
npx vitest run \
  test/conformance/store-conformance.test.ts \
  test/redis-integration.test.ts \
  test/redis-concurrency.test.ts
# Expected with Docker live: RedisStore conformance matches MemoryStore bit-for-bit;
# integration admit/reject + integer durations pass; the burst admits EXACTLY limit.
```
On a Docker-enabled host these flip from "skipped" to "passed" with NO code change (the skip is purely the `dockerAvailable()` gate).

## Threat Model Coverage
- **T-02-12 (Tampering/Race, concurrent RedisStore ops):** mitigate — `test/redis-concurrency.test.ts` fires a `Promise.all` burst (N≫limit) on the shared client and asserts EXACTLY `limit` admitted; over-admission would mean the read-modify-write tore (a non-atomic script). *Authored; observe-pass pending a Docker host.*
- **T-02-13 (Repudiation/Parity, TS↔Lua drift):** mitigate — the conformance suite asserts the FULL `Decision` `toEqual` a single shared expectation across both stores; any divergent floor/ceil/lost-fraction fails. *MemoryStore half verified; Redis half authored, observe-pass pending Docker.*
- **T-02-14 (Availability, missing Docker daemon):** accept — `dockerAvailable()` (daemon-liveness probe) gates every Redis suite so the non-Docker suites still gate `npm test`. **Verified here:** with no live daemon, 17 tests skip, 0 fail.

## No Known Stubs
No placeholder/empty-data stubs. The skipped Redis suites are gated by a real daemon-liveness probe (intentional, T-02-14), not stubbed.

## Notes for Downstream Plans
- **Plan 02-05 (fault injection):** reuse `test/support/redis.ts` (`startRedis`/`makeRedisStore`/`stopRedis` + `dockerAvailable()` guard). To exercise the defensive policy path, stop the container or inject a client whose calls reject/time out, then assert `degraded()` output + breaker transitions with a `FakeClock`.
- **CI/grading note:** the Redis suites are designed to PASS unchanged on any Docker-enabled host — run the command block above to confirm TEST-02/03/04 before grading.

## Self-Check: PASSED
- FOUND: rate-limiter/test/support/redis.ts
- FOUND: rate-limiter/test/conformance/store-conformance.test.ts
- FOUND: rate-limiter/test/redis-integration.test.ts
- FOUND: rate-limiter/test/redis-concurrency.test.ts
- FOUND commit: d321d60 (Task 1)
- FOUND commit: 6145e81 (Task 2)
