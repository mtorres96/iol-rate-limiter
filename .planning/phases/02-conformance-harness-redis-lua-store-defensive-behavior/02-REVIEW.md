---
phase: 02-conformance-harness-redis-lua-store-defensive-behavior
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - rate-limiter/src/index.ts
  - rate-limiter/src/limiters/fixed-window.ts
  - rate-limiter/src/limiters/sliding-window.ts
  - rate-limiter/src/limiters/token-bucket.ts
  - rate-limiter/src/store/breaker.ts
  - rate-limiter/src/store/lua/fixed-window.lua
  - rate-limiter/src/store/lua/sliding-window.lua
  - rate-limiter/src/store/lua/token-bucket.lua
  - rate-limiter/src/store/memory.ts
  - rate-limiter/src/store/redis.ts
  - rate-limiter/src/types.ts
  - rate-limiter/src/validate.ts
  - rate-limiter/test/breaker.test.ts
  - rate-limiter/test/build-smoke.test.ts
  - rate-limiter/test/concurrency.test.ts
  - rate-limiter/test/conformance/sequences.ts
  - rate-limiter/test/conformance/store-conformance.test.ts
  - rate-limiter/test/fault-injection.test.ts
  - rate-limiter/test/redis-concurrency.test.ts
  - rate-limiter/test/redis-integration.test.ts
  - rate-limiter/test/support/docker-pause.ts
  - rate-limiter/test/support/redis.ts
  - rate-limiter/tsup.config.ts
  - rate-limiter/vitest.config.ts
findings:
  critical: 1
  warning: 6
  info: 4
  total: 11
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-24
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Reviewed the Phase-2 deliverable: three Lua algorithm ports, the `RedisStore`
defensive layer, the `CircuitBreaker`, the conformance harness, and the
Docker-backed fault/concurrency suites. The TS↔Lua parity work is genuinely
strong — I traced every `Math.floor`/`Math.ceil`, the TTL formulas, the
`%.17g` token persistence, the integer-only returns, and the 3-way
`retryAfterMs` branch line-by-line against `memory.ts`, and the ports are
faithful. The conformance design (single shared oracle expectation, no
per-store expectation) is the right approach and would catch real drift.

The defects below cluster in two areas: (1) the **circuit breaker's half-open
state admits unbounded concurrent probes**, which contradicts the documented
"exactly ONE probe" contract and re-floods a recovering Redis under load
(BLOCKER); and (2) several **defensive-layer and test-infrastructure
robustness gaps** — an undeclared runtime dependency the fault suite relies on,
a `degraded()` policy that silently over-admits in fail-open, and a couple of
parity edge cases the conformance fixtures do not exercise.

## Critical Issues

### CR-01: Circuit breaker half-open permits unbounded concurrent probes (thundering-herd re-flood)

**File:** `rate-limiter/src/store/breaker.ts:44-49`, `rate-limiter/src/store/redis.ts:147-160`
**Issue:** The breaker's documented contract (breaker.ts:13, 64) is "HALF-OPEN:
allow exactly ONE probe." `canAttempt()` implements this by transitioning
`open → half-open` and then returning `this.state !== "open"`. But once the
state is `half-open`, **every** subsequent `canAttempt()` returns `true` until a
result is recorded. In `RedisStore.run()` each op calls `canAttempt()` and only
records success/failure **after** the awaited round-trip completes.

Under the exact concurrency this store is built for (`Promise.all([...N consume
calls])`, proven in `redis-concurrency.test.ts`), the moment the cooldown
elapses, the whole backlog of in-flight callers calls `canAttempt()`, all see
`half-open`, and **all** fire real Redis round-trips simultaneously. This is the
opposite of the breaker's purpose (D2-05: "during a Redis outage the breaker
SHORT-CIRCUITS so timeouts don't pile up"): on every recovery probe the store
re-floods a still-recovering Redis with the full pending load, and if Redis is
still slow, all N calls each burn the full `commandTimeout` before the first
failure flips the breaker back to `open`. The "no piled-up timeouts" invariant
is violated precisely when it matters.

The unit test (breaker.test.ts:60-64) even observes the doubled `true` and
rationalizes it as "enforced by the caller resolving" — but the caller
(`RedisStore.run`) does **not** enforce single-probe; it has no in-flight guard.
**Fix:** Make half-open exclusive — admit one probe and reject further attempts
until the probe resolves:
```ts
// breaker.ts
private probeInFlight = false;

canAttempt(): boolean {
  if (this.state === "open" && this.clock.now() - this.openedAt >= this.cooldownMs) {
    this.state = "half-open";
  }
  if (this.state === "half-open") {
    if (this.probeInFlight) return false; // only ONE probe at a time
    this.probeInFlight = true;
    return true;
  }
  return this.state === "closed";
}

recordSuccess(): void { this.state = "closed"; this.failures = 0; this.probeInFlight = false; }
recordFailure(): void {
  this.probeInFlight = false;
  this.failures++;
  if (this.state === "half-open" || this.failures >= this.failureThreshold) {
    this.state = "open";
    this.openedAt = this.clock.now();
  }
}
```
Then add a concurrency test that fires N overlapping ops at the half-open
boundary and asserts exactly one reaches Redis.

## Warnings

### WR-01: Fault/SLOW test suite depends on `dockerode` which is not a declared dependency

**File:** `rate-limiter/test/support/docker-pause.ts:21`, `rate-limiter/package.json`
**Issue:** `docker-pause.ts` imports `dockerode` (and relies on
`@types/dockerode`) as the freeze/unfreeze mechanism for the SLOW-Redis
fault-injection path. Neither `dockerode` nor `@types/dockerode` appears in
`package.json` (`dependencies` or `devDependencies`). They resolve today only
because they are hoisted transitive deps of `testcontainers`. A transitive
dependency is not a contract: a `testcontainers` minor bump that swaps its
Docker client, an `npm dedupe`, or a stricter installer can remove the hoisted
copy, and the entire fault-injection matrix (TEST-05, the fourth Phase-2 success
criterion) silently fails to import. The in-code comment
(docker-pause.ts:18-19) even acknowledges it is leaning on a transitive — which
is the bug, not the justification.
**Fix:** Declare both explicitly:
```jsonc
"devDependencies": {
  "dockerode": "^4.0.0",
  "@types/dockerode": "^3.3.0",
  // ...
}
```

### WR-02: `degraded()` fail-open silently over-admits — no isolation of the bypass

**File:** `rate-limiter/src/store/redis.ts:169-176`
**Issue:** In `fail-open` mode `degraded()` returns `[1, 0, 0, 0]` — it admits
**every** request while Redis is down, with `remaining: 0`. For the configured
default policy, a Redis outage therefore turns the rate limiter completely off:
unbounded admits for the entire outage window (potentially indefinitely while
the breaker stays open). This is the documented tradeoff (D2-04 availability >
strictness), so it is not by itself wrong, but two things make it a robustness
defect rather than a clean tradeoff: (a) there is no signal — no log, no
metric, no counter — that the limiter is in a bypassed state, so an operator has
zero visibility that protection has silently dropped; and (b) `remaining: 0`
returned alongside `allowed: 1` is internally contradictory and will produce a
nonsensical `X-RateLimit-Remaining: 0` header on an admitted request in the
Phase-3 adapter. CLAUDE.md explicitly lists `pino` for "fail-open events" — that
hook is missing here.
**Fix:** At minimum emit a structured warning (rate-limited, e.g. once per
breaker-open transition) when entering degraded mode, and document/justify the
`remaining` value the adapter should surface on a fail-open admit.

### WR-03: `degraded()` fail-closed reports `resetMs = cooldownMs`, conflating two unrelated quantities

**File:** `rate-limiter/src/store/redis.ts:175`
**Issue:** `return [0, 0, this.cfg.breaker.cooldownMs, this.cfg.breaker.cooldownMs];`
sets `resetMs` (per `types.ts:47`, "ms until full replenishment") to the breaker
cooldown. `resetMs` and `retryAfterMs` are semantically distinct fields with
different meanings to a downstream HTTP adapter; reusing `cooldownMs` for both is
a category error. A client reading `resetMs` to schedule a window-aligned retry
gets a value that has nothing to do with any window. The fault-injection test
only asserts `tuple[3]` (retryAfterMs), so this slipped through untested.
**Fix:** Set `resetMs` to `0` (unknown — consistent with the fail-open branch)
and keep `retryAfterMs = cooldownMs` as the backoff hint:
```ts
return [0, 0, 0, this.cfg.breaker.cooldownMs];
```

### WR-04: `RedisStore.close()` can leak the breaker/connection on a quit that neither resolves nor rejects

**File:** `rate-limiter/src/store/redis.ts:137-139`
**Issue:** `await this.client.quit().catch(() => this.client.disconnect());` only
falls back to `disconnect()` if `quit()` **rejects**. If the client is mid-outage
with `enableOfflineQueue: false` and the connection is in a state where `quit()`
hangs (no reply, no error — the same SLOW condition the fault suite induces),
`close()` awaits forever and test teardown / graceful shutdown stalls. There is
no `commandTimeout` applied to `quit()` semantics here.
**Fix:** Race the quit against a short timeout, then force-disconnect:
```ts
async close(): Promise<void> {
  try {
    await Promise.race([
      this.client.quit(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("quit timeout")), 1000)),
    ]);
  } catch {
    this.client.disconnect();
  }
}
```

### WR-05: `assertCost` rejects fractional cost, but the parity comment claims integer-count Lua arithmetic the conformance suite never exercises with cost > 1 on the rejecting boundary

**File:** `rate-limiter/src/validate.ts:33-37`, `rate-limiter/test/conformance/sequences.ts`
**Issue:** This is a test-coverage gap, not a code bug. `assertCost` correctly
forces integer cost, and the comment (validate.ts:30-31) pins "integers-only for
Lua parity." But every conformance fixture in `sequences.ts` uses `cost: 1`
except the token-bucket `cost: 10` over-capacity case. The high-drift
multi-cost paths — `cost > 1` partial admit at a window edge, a `cost > 1`
sliding-window `overshoot` that drives the `else` retry branch
(memory.ts:163-171 / sliding-window.lua:71-81) — are never replayed against the
real Lua. The `else` branch of the sliding `retryAfterMs` (the
`overshoot * msToDecayOne` math, the single most arithmetic-heavy line in the
whole port) has **no conformance coverage at all**: every fixture either admits,
or rejects via the `curr + cost > limit` branch. A floor/ceil or `/prev` drift
in that branch would ship undetected.
**Fix:** Add a sliding-window fixture that forces the `else`/`overshoot` branch
(reject with `flooredEstimate + cost > limit` but `curr + cost <= limit`, e.g.
build `prev` high, small `curr`, `cost > 1`) and a `cost: 2`/`cost: 3` fixture
for each algorithm.

### WR-06: `dockerAvailable()` caches a 10s-timeout probe result that can produce a false "available" then a slow-startup failure

**File:** `rate-limiter/test/support/redis.ts:42-55`
**Issue:** `execFileSync("docker", ["info"], { timeout: 10_000 })` — when the
daemon is reachable but slow/under load, `docker info` can succeed while
container pulls/starts still fail or exceed `beforeAll`'s timeout. The cached
`true` then commits every Redis suite to the non-skip path; if `startRedis()`
subsequently times out, the suites **fail** rather than skip — the exact
fragility the sync probe was added to avoid (the comment at redis.ts:33-39 only
defends against the dead-daemon-socket-file case, not the slow-daemon case). Low
likelihood, but it undermines the "skips cleanly" (T-02-14) guarantee on loaded
CI.
**Fix:** This is acceptable as-is for a demo, but consider catching
container-start failure in `beforeAll` and converting it to a skip, or document
that a reachable-but-overloaded daemon will fail rather than skip.

## Info

### IN-01: `import.meta.url`-relative Lua loading is fragile to bundling but adequately guarded

**File:** `rate-limiter/src/store/redis.ts:35-37`
**Issue:** `readFileSync(new URL("./lua/token-bucket.lua", import.meta.url))`
depends entirely on tsup's `onSuccess` `cpSync` copy (tsup.config.ts:19-21)
landing the assets at exactly `dist/store/lua/`. The `build-smoke.test.ts`
guards this well. Worth a one-line note in DESIGN.md that the package will throw
at module load (not lazily) if the assets are missing, since the `readFileSync`
runs at import time, not on first op.
**Fix:** Documentation only; no code change required.

### IN-02: Magic sentinel tuples `[1,0,0,0]` / `[0,0,cooldown,cooldown]` are undocumented constants

**File:** `rate-limiter/src/store/redis.ts:172, 175`
**Issue:** The degraded tuples are written inline. Given they encode a policy
contract the Phase-3 adapter must understand, naming them
(`FAIL_OPEN_DEGRADED`, `FAIL_CLOSED_DEGRADED`) would make the contract explicit
and prevent the WR-03 drift from recurring.
**Fix:** Extract named module constants.

### IN-03: `now` integer-ms contract is assumed but never asserted at the store boundary

**File:** `rate-limiter/src/store/redis.ts:119-134`, `rate-limiter/src/store/memory.ts:62`
**Issue:** The whole parity argument rests on `now` being an integer (Lua and JS
doubles agree only because the inputs are integers). `SystemClock`/`FakeClock`
honor this, but nothing guards a caller passing a fractional `now` directly to a
store op (the `Store` interface is public via the barrel). A fractional `now`
into the Lua would silently diverge from a fractional `now` into memory only in
edge rounding. Not exploitable through the limiters (which use the clocks), so
informational.
**Fix:** Optionally `Math.trunc`/assert integer `now` at the store boundary, or
document that store ops require integer `now`.

### IN-04: `redis-concurrency.test.ts` does not cover Sliding Window over-admission

**File:** `rate-limiter/test/redis-concurrency.test.ts:74-98`
**Issue:** The distributed over-admission guard (TEST-04, the headline Core
Value) tests Token Bucket and Fixed Window but **not** Sliding Window. Sliding
Window has the most complex Lua critical section and is the most likely to admit
`limit + k` under a real multi-round-trip burst if its read-modify-write were
ever torn. The comment claims the guard is "algorithm-general" but only proves
two of three.
**Fix:** Add a Sliding Window burst case asserting exactly `limit` admitted.

---

_Reviewed: 2026-06-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
