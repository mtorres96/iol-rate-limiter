---
phase: 02-conformance-harness-redis-lua-store-defensive-behavior
plan: 05
subsystem: fault-injection-defensive-proof
tags: [fault-injection, testcontainers, dockerode, circuit-breaker, fail-open, fail-closed, command-timeout, defensive, vitest]

# Dependency graph
requires:
  - phase: 02-03
    provides: "RedisStore (DI client constructor) + degraded() fail-open/closed policy + injectable-Clock CircuitBreaker (5 failures / 2000ms cooldown); never-rejecting run() seam"
  - phase: 02-04
    provides: "test/support/redis.ts — dockerAvailable() daemon-liveness probe + startRedis()/stopRedis() one-container-per-file lifecycle + getConnectionUrl access"
provides:
  - "test/support/docker-pause.ts — pause()/unpause() a started testcontainers container (native-then-dockerode) for the SLOW-Redis (cgroups freeze → commandTimeout) simulation"
  - "test/fault-injection.test.ts — down/slow × fail-open/fail-closed × breaker matrix (TEST-05): every cell asserts expect(...).resolves (RedisStore never rejects — DEF-02)"
affects:
  - "Phase 2 fourth success criterion (defensive layer proven under induced Redis failure) — the matrix is authored to spec; live-failure PASS pending a Docker host"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SLOW vs DOWN are DISTINCT faults: container.stop() closes the socket → fast connection error (DOWN); dockerode pause() (cgroups freeze) keeps TCP OPEN with no reply → the client's commandTimeout fires (SLOW). The DOWN path errors BEFORE the timeout, so a separate timeoutClient (commandTimeout 75ms) is needed to exercise the SLOW path."
    - "Native-then-dockerode pause helper: testcontainers 12.0.3 StartedTestContainer exposes NO pause()/unpause() (verified against its .d.ts), so the helper tries a native pause if present (future-proofing) then falls back to new Docker().getContainer(id).pause() — dockerode + @types/dockerode are already installed transitive deps"
    - "Breaker short-circuit proven by TIMING: after the breaker OPENs, the next call returns in < commandTimeout (no frozen-Redis round-trip) — a positive proof of 'no Redis attempt within cooldown', not just an output check"
    - "Recovery proven by VALUE: after unpause + FakeClock past cooldownMs, the half-open probe hits healthy Redis and returns the real tuple [1,4,0,0] — distinct from the fail-open degraded() sentinel [1,0,0,0], so a degraded call could not fake a CLOSED breaker"

key-files:
  created:
    - "rate-limiter/test/support/docker-pause.ts"
    - "rate-limiter/test/fault-injection.test.ts"
  modified: []

key-decisions:
  - "Dedicated timeoutClient with commandTimeout:75ms (Pitfall-4 headroom) built in beforeAll from harness.container.getConnectionUrl() — the shared harness client sets NO commandTimeout, so the SLOW (pause) cells need a client whose commandTimeout actually fires; the DOWN cells reuse harness.client (fast connection error)"
  - "Drive RedisStore DIRECTLY (not via a Limiter) so each cell asserts the raw OpTuple and exercises degraded()/breaker precisely; fail-open and fail-closed stores are separate RedisStore instances over the same client/container"
  - "afterEach unpauses + flushall (both best-effort .catch) so a faulted cell never leaks container/key state forward; DOWN cells container.restart() inline so subsequent cells have a live Redis"
  - "Breaker recovery uses a fresh key (recovered-key) for the half-open probe — the prior 6 degraded calls never wrote to Redis, so a fresh key cleanly proves the probe reached real Redis"

patterns-established:
  - "Fault-cell shape: assert HEALTHY tuple first (Redis reachable) → induce fault (stop/pause) → assert degraded resolution → restore (restart/unpause). Every assertion is .resolves — DEF-02 invariant is structural, not incidental."

requirements-completed: [DEF-01, DEF-02, TEST-05]

# Metrics
duration: ~9min
completed: 2026-06-24
tasks: 2
files_created: 2
files_modified: 0
---

# Phase 2 Plan 05: Fault-Injection Matrix (Defensive Layer Proof) Summary

**Authored the TEST-05 fault-injection matrix — a real `redis:7.4-alpine` driven DOWN (`container.stop()`) and SLOW (dockerode `pause()` → `commandTimeout` breach) under BOTH the fail-open and fail-closed policies, plus the circuit-breaker open→half-open→CLOSED recovery cycle — with EVERY cell asserting `expect(...).resolves` so a Redis outage can never reject/crash the caller (DEF-01/DEF-02). Added a thin native-then-dockerode `pause`/`unpause` helper for the cgroups-freeze SLOW simulation. The suite skips cleanly with no Docker daemon; `npm test` stays green (67 passed / 22 skipped).**

## Performance
- **Duration:** ~9 min
- **Tasks:** 2 completed
- **Files created:** 2 / modified: 0

## What Was Built

### Task 1 — docker-pause helper (`6446cb0`, test)
- `test/support/docker-pause.ts`: `pause(container)` / `unpause(container)` freeze/unfreeze a started testcontainers container so an in-flight ioredis command HANGS (socket stays open, no reply) and the client's `commandTimeout` fires — the SLOW-Redis simulation distinct from a closed-socket DOWN.
- Path choice (02-RESEARCH A3 / Q1): verified against the installed `testcontainers` 12.0.3 typings that `StartedTestContainer` exposes NO `pause()/unpause()` (it has stop/restart/exec/… only), so the helper tries a native `pause` first (future-proofing) then falls back to dockerode — `new Docker().getContainer(container.getId()).pause()`. dockerode + `@types/dockerode` are already-installed transitive deps; the dockerode client is built lazily and reused. Thin, typed wrapper — no `as any` Docker plumbing leaks into the test file.

### Task 2 — Fault-injection matrix (`3dbf1ad`, test)
- `test/fault-injection.test.ts` (`describe.skipIf(!dockerAvailable())`, ONE container in `beforeAll`/`afterAll` per Pitfall 5, an injected `FakeClock` for the breaker cell). Five cells covering the full 02-RESEARCH matrix:
  - **DOWN × fail-open** → after `container.stop()` the store resolves `allowed=1` (fail-open `degraded()` admits); `restart()` for the next cells.
  - **DOWN × fail-closed** → resolves `allowed=0` with `retryAfterMs === cooldownMs` (fail-closed `degraded()` backoff).
  - **SLOW × fail-open** → via the dedicated `commandTimeout:75ms` client + `pause()`, the timeout fires and the store resolves `allowed=1`.
  - **SLOW × fail-closed** → same timeout breach, resolves `allowed=0`.
  - **BREAKER** → 5 consecutive SLOW timeouts OPEN the breaker (each still resolves via fail-open); the next call SHORT-CIRCUITS (proven by timing: returns in `< commandTimeout`, i.e. no frozen-Redis round-trip); then `unpause()` + `FakeClock.setTime(cooldownMs)` half-opens and a fresh-key probe hits healthy Redis returning the REAL tuple `[1,4,0,0]` (distinct from the fail-open sentinel `[1,0,0,0]`) → CLOSED.
- Every fault assertion uses `expect(...).resolves` / a resolved `OpTuple` check — the structural DEF-02 invariant (RedisStore never rejects). `afterEach` unpauses + `flushall` (best-effort) so no faulted state leaks between cells.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| `npx eslint test/fault-injection.test.ts` + `test/support/docker-pause.ts` | clean |
| `npx vitest run test/fault-injection.test.ts` (no Docker) | exit 0 — 5 SKIPPED, 0 failed |
| `grep -q "fail-closed" test/fault-injection.test.ts` | yes |
| `grep -q "resolves" test/fault-injection.test.ts` | yes |
| `grep -q "pause" test/support/docker-pause.ts` | yes |
| full `npm test` (incl. build-smoke `tsup`) | 8 files passed (67), 3 files skipped (22) — green (skip count rose by 5 = the new fault cells) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored declared dependencies in the fresh worktree**
- **Found during:** start (node_modules absent — gitignored in a fresh worktree).
- **Fix:** `npm ci` to restore lockfile-pinned, already-vetted deps (a restore, not a new install — confirmed dockerode + @types/dockerode present at top level). No tracked files changed.

**2. [Rule 1 - Bug] `.resolves.toEqual<OpTuple>(...)` generic rejected by Vitest 4.1's async matcher**
- **Found during:** Task 2 typecheck (`error TS2558: Expected 0 type arguments, but got 1` on the four `.resolves.toEqual<OpTuple>` calls; the sync `expect(recovered).toEqual<OpTuple>` typed fine).
- **Issue:** Vitest 4.1's `.resolves` matcher proxy does not surface the generic type parameter that the sync matcher does.
- **Fix:** Introduced a typed `const HEALTHY: OpTuple = [1, 4, 0, 0]` and asserted `.resolves.toEqual(HEALTHY)` — keeps the value type-checked against `OpTuple` (the annotation moved to the const) and reads more intentionally (HEALTHY is explicitly contrasted with the fail-open sentinel). Re-typecheck + lint clean.
- **Files modified:** `test/fault-injection.test.ts` — **Commit:** `3dbf1ad`.

## BLOCKING DEVIATION — Fault matrix authored but UNVERIFIED LOCALLY (no Docker)

**Per the executor prompt's explicit instruction: Docker is NOT available in this worktree (`docker info` fails — the daemon is not running). The fault-injection suite drives a real Redis DOWN (container stop) and SLOW (dockerode pause), both of which require a live Docker daemon, so its PASS against real Redis has NOT been observed on this machine.** This is flagged as a Rule-3 blocking deviation, NOT a silent skip.

**What WAS verified locally (no Docker required):**
- `tsc --noEmit` clean; `eslint` clean on both new files.
- The suite PROVABLY skips cleanly via the existing `dockerAvailable()` daemon-liveness probe (NOT a socket-existence check) — `vitest run test/fault-injection.test.ts` → 5 skipped / 0 failed; full `npm test` stays green (67 passed / 22 skipped, the skip count up exactly 5 from plan 02-04's 17).

**What MUST be run on a host with a live Docker daemon to confirm TEST-05:**
```bash
cd rate-limiter
npm ci                 # if node_modules absent
docker info            # confirm a LIVE daemon (not just an installed CLI / stale socket)
npx vitest run test/fault-injection.test.ts
# Expected with Docker live: all 5 cells PASS — DOWN/SLOW under both policies degrade
# to the correct allowed value, the breaker OPENs after 5 timeouts and short-circuits
# (< commandTimeout), and the half-open probe recovers to CLOSED — no unhandled rejection.
```
On a Docker-enabled host these flip from "skipped" to "passed" with NO code change (the skip is purely the `dockerAvailable()` gate). Note: the BREAKER cell makes 5 real ~75ms timeout round-trips while frozen, well within the suite's 60s `testTimeout`.

## Threat Model Coverage
- **T-02-15 (Elevation/Bypass, fail-open under outage):** accept — fail-open admitting under a down/slow Redis is the INTENDED configurable default (D2-04). The matrix PROVES the trade-off is bounded: the fail-closed cells verify the strict alternative is available and denies correctly. *Authored; observe-pass pending a Docker host. DESIGN.md (Phase 4) documents the rationale.*
- **T-02-16 (DoS, unhandled rejection on store failure):** mitigate — every fault cell asserts `expect(...).resolves` / a resolved `OpTuple`; `RedisStore` catches all errors/timeouts and resolves through `degraded()` (DEF-02), so a Redis outage can never crash the caller. *Structural in the test shape; observe-pass pending Docker.*
- **T-02-17 (DoS, timeout pile-up during outage):** mitigate — the breaker cell proves that after 5 failures the breaker OPENs and the next call short-circuits in `< commandTimeout` (no further Redis attempt within cooldown), so timeouts cannot pile up (D2-05). *Authored; observe-pass pending Docker.*

## No Known Stubs
No placeholder/empty-data stubs. The skipped suite is gated by the real `dockerAvailable()` daemon-liveness probe (intentional, T-02-14), not stubbed. The `pause` helper's native-first branch is a real future-proofing path, not dead code (the dockerode fallback is the active path on testcontainers 12.0.3).

## Notes for Downstream
- The fault matrix is designed to PASS unchanged on any Docker-enabled host — run the command block above to confirm TEST-05 before grading. Combined with plan 02-04's Redis suites, a single Docker-enabled `npx vitest run` confirms TEST-02/03/04/05 together.
- DESIGN.md (Phase 4) should cite this suite as the executable proof of the fail-open/closed trade-off and the breaker's anti-pile-up behavior.

## Self-Check: PASSED
- FOUND: rate-limiter/test/support/docker-pause.ts
- FOUND: rate-limiter/test/fault-injection.test.ts
- FOUND commit: 6446cb0 (Task 1)
- FOUND commit: 3dbf1ad (Task 2)
