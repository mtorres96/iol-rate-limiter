---
phase: 02-conformance-harness-redis-lua-store-defensive-behavior
verified: 2026-06-24T12:10:00Z
status: gaps_found
score: 6/10 requirements verified (4 PARTIAL — Docker-gated; CR-01 BLOCKER on DEF-01/DEF-02)
overrides_applied: 0
gaps:
  - truth: "Against a real Redis, a concurrent burst admits exactly limit (no read-modify-write over-admission)"
    status: partial
    reason: "Test authored and correct, but all Redis-backed tests skip (Docker not available in this environment). redis-concurrency.test.ts has NOT been observed passing against a real redis:7.4-alpine container. Sliding Window is also missing from the concurrency guard (IN-04)."
    artifacts:
      - path: "rate-limiter/test/redis-concurrency.test.ts"
        issue: "All 2 tests skipped — require live Docker daemon; Sliding Window burst not covered"
    missing:
      - "Observed PASS against a real Redis container for Token Bucket and Fixed Window"
      - "Sliding Window burst case (IN-04) to complete algorithm-general proof"
  - truth: "Fault-injection tests prove both fail-open and fail-closed policies under a down/slow Redis with no unhandled rejection"
    status: partial
    reason: "Test authored and correct, but all 5 cells skip (Docker not available). The suite has NOT been observed passing against a real container."
    artifacts:
      - path: "rate-limiter/test/fault-injection.test.ts"
        issue: "All 5 cells skipped — require live Docker daemon"
    missing:
      - "Observed PASS of all 5 fault-injection cells on a Docker-enabled host"
  - truth: "Every Redis call is bounded by a configurable timeout (DEF-01) and fail-open/closed policy NEVER rejects (DEF-02)"
    status: partial
    reason: "Circuit breaker half-open state admits unbounded concurrent probes (CR-01 BLOCKER from 02-REVIEW.md). The 'exactly one probe' contract documented in breaker.ts:11 is violated: canAttempt() returns true for ALL callers once state==half-open, with no in-flight guard. Under the concurrent load this store is designed for, the full pending backlog fires Redis round-trips simultaneously on recovery — the anti-pile-up invariant (D2-05) is violated precisely when it matters. No probeInFlight guard exists in the current code."
    artifacts:
      - path: "rate-limiter/src/store/breaker.ts"
        issue: "canAttempt() at line 44-49: transitions to half-open but returns state !== 'open', permitting every concurrent caller to probe. No probeInFlight flag."
      - path: "rate-limiter/src/store/redis.ts"
        issue: "run() at line 147-160: no in-flight guard. Multiple concurrent callers in half-open all proceed to await op() simultaneously."
    missing:
      - "Add probeInFlight boolean to CircuitBreaker; set true when admitting probe, clear in recordSuccess/recordFailure"
      - "Add concurrency test asserting exactly one probe reaches Redis at the half-open boundary"
  - truth: "RedisStore parity contract: conformance suite drives identical Decisions against both MemoryStore and RedisStore"
    status: partial
    reason: "MemoryStore half (11/11) PASSES. RedisStore half (11/11) SKIPPED — Docker not available. Additionally, WR-05: the sliding-window overshoot/else branch (memory.ts L163-171) has zero conformance coverage. Every fixture uses cost:1; the most arithmetic-heavy retryAfterMs branch is never exercised against real Lua."
    artifacts:
      - path: "rate-limiter/test/conformance/store-conformance.test.ts"
        issue: "RedisStore parameter skipped (11 tests skipped)"
      - path: "rate-limiter/test/conformance/sequences.ts"
        issue: "No cost>1 fixture for sliding-window overshoot/else branch (WR-05)"
    missing:
      - "Observed RedisStore conformance PASS on Docker-enabled host"
      - "Sliding-window fixture with cost>1 that forces the overshoot/else retryAfterMs branch"
human_verification:
  - test: "Run full Redis-backed test suites on a Docker-enabled host"
    expected: "npx vitest run test/conformance/store-conformance.test.ts test/redis-integration.test.ts test/redis-concurrency.test.ts test/fault-injection.test.ts all PASS (22 tests currently skipped flip to passed)"
    why_human: "Requires a live Docker daemon to start redis:7.4-alpine containers. The current environment has no running Docker daemon."
  - test: "Verify CR-01 fix (probeInFlight guard) before re-checking concurrency correctness"
    expected: "After implementing probeInFlight in CircuitBreaker, a Promise.all burst at the half-open boundary shows exactly one Redis round-trip (remaining N-1 callers get the degraded() sentinel), then the probe result closes the breaker"
    why_human: "Requires code change plus a concurrent test — not provable by static grep"
---

# Phase 2: Conformance Harness, Redis/Lua Store & Defensive Behavior — Verification Report

**Phase Goal:** A distributed store is correct and resilient — the same conformance suite that pins the contract passes against both the in-memory reference and an atomic-Lua Redis store, which bounds every call and applies an explicit fail-open/closed policy.
**Verified:** 2026-06-24T12:10:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Parametrized conformance suite drives identical sequences against both stores, asserts identical Decisions | PARTIAL | MemoryStore half: 11/11 PASS. RedisStore half: 11/11 SKIPPED (no Docker). Lua source faithfulness verified by inspection (line-by-line port, floor/ceil/ARGV/PEXPIRE all correct). |
| SC-2 | Each algorithm's Redis mutation runs in one atomic Lua script via ioredis defineCommand, receives `now` via ARGV, sets TTL in-script, uses namespaced keys on a shared client | VERIFIED | All three scripts: numberOfKeys:1, ARGV-injected now (no redis.call('TIME')), PEXPIRE in each script, namespaced rl:tb:/rl:sw:/rl:fw: keys. defineCommand used for all three in redis.ts:86-88. |
| SC-3 | Against real Redis, concurrent burst admits exactly limit | PARTIAL | Test authored correctly (redis-concurrency.test.ts). All 2 cases SKIPPED — Docker unavailable. Also: Sliding Window burst missing (IN-04). |
| SC-4 | Every Redis call bounded by configurable timeout; fault-injection proves fail-open/closed; no unhandled rejection | PARTIAL + BLOCKER (CR-01) | commandTimeout:75ms wired. fail-open/closed policy code correct. Fault-injection suite authored but all 5 cells SKIPPED (no Docker). CircuitBreaker half-open admits unbounded concurrent probes — "exactly one probe" contract violated in code. |

**Score:** 1 fully VERIFIED / 3 PARTIAL out of 4 success criteria

### Per-Requirement Status

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| STOR-02 | Atomic Lua scripts via ioredis defineCommand | VERIFIED | redis.ts:86-88 — rl_tb/rl_sw/rl_fw defined; auto-EVALSHA + NOSCRIPT fallback per ioredis contract |
| STOR-03 | Key TTL set inside each Lua script | VERIFIED | All three .lua files end with PEXPIRE call. TB: ceil(capacity/refill*interval)+1. Windows: 2*windowMs+1 |
| STOR-04 | `now` passed via ARGV (never redis.call('TIME')) | VERIFIED | No redis.call('TIME') in any .lua file. All three parse ARGV[1] as `now` |
| STOR-05 | Namespaced keys on a single shared client | VERIFIED | redis.ts:120/126/131 — rl:tb:, rl:sw:, rl:fw: prefixes. Single client DI |
| DEF-01 | Every Redis call bounded by configurable commandTimeout | PARTIAL | commandTimeout:75ms in RedisStore.connect() defaults and fault-injection test. Fault tests SKIPPED. CR-01: half-open allows unbounded concurrent calls — pile-up invariant violated |
| DEF-02 | Fail-open/closed policy; RedisStore never rejects | PARTIAL | Policy code correct (degraded() covers both). Fault tests authored with .resolves assertions. All 5 fault cells SKIPPED. CR-01 means half-open can flood Redis with simultaneous timeouts |
| TEST-02 | Parametrized conformance suite: MemoryStore + RedisStore same Decisions | PARTIAL | MemoryStore: 11/11 PASS. RedisStore: 11/11 SKIPPED. WR-05: no cost>1 fixture for sliding-window overshoot branch |
| TEST-03 | Real Redis happy-path integration (per-algorithm) | PARTIAL | 4 integration tests authored. All 4 SKIPPED (no Docker). Not observed passing |
| TEST-04 | Concurrent burst admits exactly limit over real Redis | PARTIAL | 2 concurrency tests authored. Both SKIPPED. Sliding Window burst missing (IN-04) |
| TEST-05 | Fault-injection matrix: down/slow × fail-open/closed × breaker | PARTIAL | 5 fault cells authored correctly. All 5 SKIPPED. Not observed passing |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `rate-limiter/src/store/lua/token-bucket.lua` | Atomic Lua TB port | VERIFIED | 58 lines, HSET/HMGET/PEXPIRE, %.17g token persistence, ARGV-injected now |
| `rate-limiter/src/store/lua/sliding-window.lua` | Atomic Lua SW port | VERIFIED | 90 lines, 3-way retryAfterMs branch reproduced verbatim from memory.ts |
| `rate-limiter/src/store/lua/fixed-window.lua` | Atomic Lua FW port | VERIFIED | 46 lines, PEXPIRE with 2*windowMs+1 TTL |
| `rate-limiter/src/store/redis.ts` | RedisStore with defensive layer | VERIFIED | defineCommand, run() seam, commandTimeout, CircuitBreaker, degraded() policy |
| `rate-limiter/src/store/breaker.ts` | CircuitBreaker state machine | PARTIAL | State machine correct for closed/open transitions. Half-open single-probe contract VIOLATED (CR-01) |
| `rate-limiter/test/conformance/sequences.ts` | Shared parity fixtures | VERIFIED | tbCases(5)/swCases(3)/fwCases(3) exported. Xu Ch.4 anchor and 2x boundary burst included |
| `rate-limiter/test/conformance/store-conformance.test.ts` | Parametrized conformance suite | PARTIAL | describe.each over both stores. MemoryStore: PASS. RedisStore: SKIPPED |
| `rate-limiter/test/support/redis.ts` | Docker container helper | VERIFIED | dockerAvailable() daemon-liveness probe (not socket check), startRedis/stopRedis/makeRedisStore |
| `rate-limiter/test/redis-integration.test.ts` | Real-Redis integration tests | PARTIAL | Authored correctly, all 4 tests SKIPPED |
| `rate-limiter/test/redis-concurrency.test.ts` | Distributed over-admission guard | PARTIAL | TB+FW burst authored, SKIPPED. SW burst missing (IN-04) |
| `rate-limiter/test/fault-injection.test.ts` | Fault-injection matrix | PARTIAL | All 5 cells authored, all SKIPPED |
| `rate-limiter/test/support/docker-pause.ts` | Container freeze helper | WARNING | Authored correctly; uses `dockerode` which is NOT a declared devDependency (WR-01 — brittle transitive dep) |
| `rate-limiter/dist/store/lua/*.lua` | Built Lua assets in dist | VERIFIED | All three .lua files present in dist/store/lua/, non-empty (2028/3697/2872 bytes). tsup onSuccess cpSync wired |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `types.ts` | (no ioredis import) | Type-only | VERIFIED | grep -nE '^\s*import.*ioredis' types.ts → 0 matches |
| `redis.ts` | Lua scripts | readFileSync(import.meta.url) | VERIFIED | TB_LUA/SW_LUA/FW_LUA loaded at module load; guarded by build-smoke test |
| `redis.ts` | ioredis | Single import | VERIFIED | Only src file with `import Redis from "ioredis"` |
| `RedisStore.run()` | `CircuitBreaker.canAttempt()` | Gate check | PARTIAL | Wired but half-open concurrency not guarded (CR-01) |
| `RedisStore.run()` | `degraded()` | catch block | VERIFIED | All errors route to degraded(); no throw/reject on op path |
| `conformance suite` | Both stores via async Store | describe.each | PARTIAL | MemoryStore: WIRED and PASSING. RedisStore: WIRED but SKIPPED |
| `fault-injection` | `dockerAvailable()` | skipIf guard | VERIFIED | Daemon-liveness probe correctly skips when Docker absent |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces library/store code and test suites, not UI components rendering dynamic data.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean | `npm run typecheck` | exit 0 | PASS |
| ESLint clean | `npm run lint` | exit 0, no warnings | PASS |
| Full test suite green | `npm test` | 67 passed / 22 skipped / 0 failed | PASS (within no-Docker constraint) |
| Circuit breaker unit tests | `npx vitest run test/breaker.test.ts` | 7/7 passed | PASS |
| MemoryStore conformance half | `npx vitest run test/conformance/store-conformance.test.ts` | 11/11 pass, 11 skipped | PASS |
| In-memory concurrency guard | `npx vitest run test/concurrency.test.ts` | 3/3 passed | PASS |
| Lua assets in dist | `ls dist/store/lua/` | 3 files, non-empty | PASS |
| ioredis resolvable | `node -e "require.resolve('ioredis')"` | exit 0 | PASS |
| Docker-gated tests skip clean | Redis suites with no daemon | 22 skipped, 0 failed | PASS |
| CR-01 probeInFlight guard | `grep -n "probeInFlight" src/store/breaker.ts` | no match | FAIL — not implemented |

### Probe Execution

Step 7c: SKIPPED — no probe scripts defined for this phase (`scripts/*/tests/probe-*.sh` absent).

### Requirements Coverage

All 10 requirement IDs claimed in phase plans are assessed above. No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/store/breaker.ts` | 44-49 | Half-open admits all concurrent callers (no probeInFlight guard) | BLOCKER (CR-01) | Under concurrent load, ALL pending callers probe Redis simultaneously on recovery — violates "exactly one probe" contract D2-05 and causes timeout pile-up on a still-slow Redis |
| `test/support/docker-pause.ts` | 21 | `import Docker from "dockerode"` — not in package.json devDependencies | WARNING (WR-01) | Brittle transitive dep; a testcontainers minor bump or npm dedupe can break TEST-05 silently |
| `src/store/redis.ts` | 175 | `return [0, 0, this.cfg.breaker.cooldownMs, this.cfg.breaker.cooldownMs]` — `resetMs` set to `cooldownMs` | WARNING (WR-03) | Category error: `resetMs` (window replenishment) conflated with breaker cooldown. Fault-injection only asserts `tuple[3]` so this slipped through |
| `src/store/redis.ts` | 137-139 | `close()` awaits `quit()` with no timeout race | WARNING (WR-04) | Under SLOW-Redis conditions (paused container), `quit()` may hang indefinitely — test teardown stalls |
| `test/conformance/sequences.ts` | All SW fixtures | All sliding-window fixtures use `cost:1`; overshoot/else branch of retryAfterMs never exercised | WARNING (WR-05) | The most arithmetic-heavy Lua branch (memory.ts:163-171 / sliding-window.lua:71-81) has zero conformance coverage against real Redis |
| `test/redis-concurrency.test.ts` | All cases | Sliding Window burst case absent | INFO (IN-04) | Concurrency guard only proven for 2 of 3 algorithms |

No `TBD`, `FIXME`, or `XXX` debt markers found in any phase-modified file.

### Human Verification Required

#### 1. Redis-Backed Test Suites (Docker Required)

**Test:** On a machine with a live Docker daemon, run:
```bash
cd rate-limiter
npm ci
docker info  # confirm live daemon
npx vitest run \
  test/conformance/store-conformance.test.ts \
  test/redis-integration.test.ts \
  test/redis-concurrency.test.ts \
  test/fault-injection.test.ts
```
**Expected:** All 22 currently-skipped tests PASS — RedisStore conformance matches MemoryStore bit-for-bit; integration happy paths pass; burst admits exactly limit; fault cells all resolve (never reject).
**Why human:** Docker daemon not available in this verification environment.

#### 2. CR-01 Circuit Breaker Half-Open Single-Probe Fix

**Test:** Implement the `probeInFlight` guard in `src/store/breaker.ts` as described in 02-REVIEW.md CR-01. Then add a concurrency test that fires N>1 overlapping `consume()` calls exactly at the half-open boundary and asserts exactly one reaches Redis.
**Expected:** Only 1 of N concurrent callers makes a Redis round-trip; remaining N-1 return the `degraded()` sentinel immediately.
**Why human:** Requires a code change plus concurrent-behavior verification — not provable by static inspection.

### Gaps Summary

Four of ten requirements are PARTIAL, clustering around two root causes:

**Root Cause A — Docker unavailability (environment constraint, not code defect):** TEST-02 (RedisStore half), TEST-03, TEST-04, and TEST-05 are authored correctly and skip cleanly, but have not been observed passing against a real `redis:7.4-alpine` container. This affects DEF-01/DEF-02 observable proof as well (the fault-injection evidence is authored but unrun). All four suites are designed to flip from skipped to passing with no code change on any Docker-enabled host. This is the stated environment constraint, not a code gap.

**Root Cause B — CR-01 BLOCKER (code defect requiring a fix):** The CircuitBreaker half-open state admits unbounded concurrent probes. The "exactly one probe" invariant documented in `breaker.ts:11` and D2-05 is not enforced in code. Under the concurrent workload this store targets, the breaker's anti-pile-up purpose is defeated on every recovery attempt. This is a correctness defect in the defensive layer that affects DEF-01 and DEF-02 and the project's stated Core Value ("correct under concurrency"). A `probeInFlight` guard plus a concurrency test is the fix.

**Secondary gaps (warnings, not blockers):** `dockerode` undeclared in package.json (WR-01); `resetMs` semantically wrong in fail-closed degraded() (WR-03); `close()` can hang under SLOW fault (WR-04); sliding-window overshoot branch has zero Lua conformance coverage (WR-05); Sliding Window missing from concurrency over-admission guard (IN-04).

---

_Verified: 2026-06-24T12:10:00Z_
_Verifier: Claude (gsd-verifier)_
