# Pitfalls Research

**Domain:** Distributed rate limiter (TypeScript/Node.js) — graded coding challenge
**Researched:** 2026-06-23
**Confidence:** HIGH (Redis Lua determinism, ioredis NOSCRIPT handling, Vitest fake timers all verified against current official sources; algorithm math and challenge-grading traps from established domain knowledge)

> Scope note: This challenge is graded on correctness, comprehensive tests, elegant design
> (APOSD), correct error handling, justified concurrency, and AVOIDING overengineering / "AI
> slop". The pitfalls below are weighted accordingly — algorithm-correctness and AI-slop traps
> are the highest-leverage failures. Phase names assume a roadmap like:
> **P1 Core algorithms + Clock + in-memory store**, **P2 Conformance test suite + concurrency tests**,
> **P3 Redis store (Lua)**, **P4 Express middleware + headers + error policy**, **P5 Docker + DESIGN.md**.

## Critical Pitfalls

### Pitfall 1: Token bucket refill drift / float accumulation

**What goes wrong:**
Tokens are refilled by mutating a stored float on every request (`tokens += elapsed * rate`)
and storing the new `tokens` + `lastRefill = now`. Over thousands of small requests this
accumulates floating-point error, and rounding `lastRefill` to "now" on every call silently
discards sub-tick elapsed time, so the effective rate drifts below the configured rate.

**Why it happens:**
Developers compute refill incrementally instead of as a pure function of elapsed time, and
they advance `lastRefill` to `now` even when fewer than one token's worth of time has passed.

**How to avoid:**
Make the bucket a **pure function of `(lastRefill, storedTokens, now)`**:
`refilled = min(capacity, storedTokens + (now - lastRefill) * rate)`. Compute `allowed =
refilled >= cost`. Crucially, advance `lastRefill` by the time actually consumed (or store the
fractional token count and keep `lastRefill = now` consistently with the same formula) — pick
ONE convention and prove it conserves rate over a long horizon. Decide deliberately whether
`remaining` returned to the client is a floored integer while internal state stays fractional
(it should be: floor for the header, keep float internally).

**Warning signs:**
A 10,000-request "steady drip at exactly the limit" test slowly diverges; `remaining` headers
show fractional values; `lastRefill` always equals `now`.

**Phase to address:** P1 (core algorithm), verified by long-horizon property test in P2.

---

### Pitfall 2: Fixed-window boundary burst demonstrated accidentally, not knowingly

**What goes wrong:**
Fixed window allows up to **2x the limit** across a window boundary (limit requests at
00:00:59 + limit more at 00:01:00). In a graded challenge this is a *known* property of the
algorithm — but if your tests don't demonstrate that you understand it, a grader assumes you
shipped a bug. Worse: a candidate "fixes" it and breaks fixed-window semantics, or claims
sliding-window-counter has the same flaw.

**Why it happens:**
The boundary burst looks like a bug, so people either patch it (wrong — it's the defining
tradeoff of fixed window) or never write a test that surfaces it.

**How to avoid:**
Write an explicit test named like `fixed_window allows up to 2x limit across boundary (known
tradeoff)` that asserts the burst happens. Document this tradeoff in DESIGN.md as the *reason*
sliding-window-counter exists. This converts a "bug" into evidence of understanding.

**Warning signs:**
No test references the boundary; DESIGN.md compares algorithms without mentioning the burst.

**Phase to address:** P1 (implement), P2 (the demonstrating test), DESIGN.md in P5.

---

### Pitfall 3: Sliding-window-counter weighting math errors

**What goes wrong:**
The estimate `prevWindowCount * (1 - elapsedFractionIntoCurrentWindow) + currentWindowCount`
is implemented with the fraction inverted, the wrong window labelled "previous", or the weight
applied to the current window instead of the previous. Result: limits enforced too loosely or
too strictly, and off-by-one at the exact window edge.

**Why it happens:**
The weighting direction is genuinely easy to flip; many blog snippets get it subtly wrong.

**How to avoid:**
Pin the formula in a comment with a worked numeric example. Weight the **previous** window by
the **remaining** fraction of the current window: if we are 25% into the current window, the
previous window contributes 75%. Test with hand-computed expected values at 0%, 50%, 99% into
the window, plus the exact boundary.

**Warning signs:**
Estimate jumps discontinuously at the boundary; weight uses `elapsed` rather than `1 - elapsed`;
no numeric example in the code.

**Phase to address:** P1 (implement), P2 (table-driven numeric tests).

---

### Pitfall 4: Read-modify-write race — putting limiter logic in TypeScript instead of Lua

**What goes wrong:**
The Redis store does `GET tokens` → compute in Node → `SET tokens`. Two concurrent requests
both read the same value and both decide "allowed", over-admitting beyond the limit. This is
the central correctness failure the whole "Redis + Lua" requirement exists to prevent.

**Why it happens:**
It's the obvious first implementation and works fine single-threaded in tests, so it ships.

**How to avoid:**
ALL decision logic (read state, refill/weight, compare, write new state, set TTL) runs inside
**one atomic Lua script**. The TS store only marshals `KEYS`/`ARGV` and interprets the result.
The in-memory store achieves the same atomicity trivially because Node is single-threaded per
event-loop turn — but the Redis path must be Lua. Use a shared conformance suite so the
in-memory and Redis stores are proven to behave identically.

**Warning signs:**
The Redis store calls `.get()` then `.set()`/`.incr()` separately; concurrency test passes
in-memory but over-admits against real Redis; logic branches live in `.ts`, not `.lua`.

**Phase to address:** P3 (Redis store). Concurrency verification in P2/P3.

---

### Pitfall 5: Fail-open vs fail-closed is unhandled, not decided

**What goes wrong:**
When Redis is down or a call times out, the middleware throws an unhandled rejection — the
request 500s (or the process crashes), instead of the limiter making a *deliberate* choice to
allow (fail-open, prioritize availability) or block (fail-closed, prioritize protection).

**Why it happens:**
The happy path is built first; the store error path is never exercised because tests use a
healthy store.

**How to avoid:**
Make the policy an explicit config (`onStoreError: 'fail-open' | 'fail-closed'`, default
documented). Wrap every Redis call in a **timeout** (e.g. `Promise.race` with a configurable
deadline, or ioredis `commandTimeout`). Catch store errors in the store/middleware boundary
and apply the policy. Write tests that inject a throwing/timing-out store and assert the chosen
behavior for BOTH policies. Discuss the availability-vs-correctness tradeoff in DESIGN.md.

**Warning signs:**
No test simulates Redis failure; no timeout on Redis calls; grep for `catch` near the store
returns nothing; an `UnhandledPromiseRejection` appears when Redis is stopped.

**Phase to address:** P4 (error policy + middleware), with a fault-injection test in P4.

---

### Pitfall 6: AI slop — over-commented obvious code, speculative abstraction, unused config

**What goes wrong:**
Submission reads as machine-generated: comments restating the code (`// increment counter`),
`AbstractRateLimiterFactoryProvider` indirection nobody uses, config options that aren't wired
to anything, dead `interface`s, defensive null checks for impossible states. This is an
explicit grading penalty and a credibility hit in the interview ("explain this line" → can't).

**Why it happens:**
LLM output trends verbose and speculative; pasting it wholesale produces plausible-looking
bloat that the author never pruned.

**How to avoid:**
Apply APOSD ruthlessly: deep modules, small interfaces, comments explain **why** not **what**.
Every config field must be consumed somewhere. Every abstraction must have ≥1 real use today
(two algorithms behind one interface = justified; a plugin registry for stores you'll never add
= slop). Self-review pass: "Can I defend every line in an interview? Delete anything I can't."
Document AI usage honestly in DESIGN.md (which parts were AI-assisted and how they were
verified) — this is required and turns a liability into a strength.

**Warning signs:**
Comment-to-code ratio is high and comments paraphrase code; interfaces with one implementation
and no near-term second; config keys never referenced; abstractions named with
Factory/Manager/Provider/Strategy stacked together.

**Phase to address:** Every phase (continuous), with a dedicated prune/self-review gate before P5.

---

### Pitfall 7: Overengineering — pluggable everything, premature optimization

**What goes wrong:**
Building generic plugin systems, configurable serialization layers, metrics/telemetry
frameworks, or micro-optimizing the Lua before correctness is proven. Out-of-scope algorithms
(leaky bucket, sliding window log) get added "for completeness", expanding surface area the
author must defend.

**Why it happens:**
Conflating "production-grade" with "more features"; the challenge actually rewards *right-sized*
design.

**How to avoid:**
Honor the PROJECT.md Out-of-Scope list (exactly 3 algorithms, Redis-only distribution, no admin
UI). Two store implementations and three algorithms is the *complete* justified set of
abstractions — stop there. Optimize only with a measured reason. "Concurrency only where needed"
is a stated grading criterion: do not add locks/mutexes/worker pools.

**Warning signs:**
New abstractions appear that aren't in the requirements; performance work before the conformance
suite is green; "while I'm here" features.

**Phase to address:** Roadmap scoping + every-phase discipline; guard at phase-transition reviews.

---

### Pitfall 8: Relying on real wall-clock in tests (flaky) instead of an injected clock

**What goes wrong:**
Tests use `await sleep(1000)` then assert refill. They're slow, flaky on loaded CI, and pass or
fail by coincidence depending on scheduling jitter — directly undermining the "comprehensive,
deterministic tests" grading criterion.

**Why it happens:**
It's the path of least resistance and works on the author's fast machine.

**How to avoid:**
Inject a **`Clock` abstraction** (`{ now(): number }`) into the algorithm core and pass `now`
explicitly into the Lua script as an `ARGV`. Tests use a `FakeClock` you advance synchronously —
no real time passes, fully deterministic. This is strictly better than Vitest `vi.useFakeTimers`
for the algorithm core because the algorithm never touches global timers; reserve Vitest fake
timers (`vi.useFakeTimers` / `vi.advanceTimersByTime` / `vi.setSystemTime`) for any code that
genuinely calls `setTimeout`/`Date.now` you don't control (e.g. timeout wrappers).

**Warning signs:**
`sleep`/`setTimeout` inside tests; tests tagged "occasionally fails"; the algorithm calls
`Date.now()` directly instead of receiving `now`.

**Phase to address:** P1 (Clock injection is a core design decision), P2 (FakeClock-based tests).

---

### Pitfall 9: Redis key TTL/expiry missing or wrong → key leak

**What goes wrong:**
The Lua script writes limiter state but never sets (or sets incorrectly) a TTL. Every unique
client key (per-IP, per-user) becomes a permanent key — unbounded memory growth in Redis. Or
TTL is reset on every call so keys for *active* clients never expire even when they should reset.

**Why it happens:**
TTL feels like an afterthought once the allow/deny logic works.

**How to avoid:**
Set `PEXPIRE`/`EXPIRE` **inside the same Lua script** that writes state, sized to the window
(plus a margin for token bucket: time to fully refill). Test that a key disappears after its
window when idle. Decide deliberately whether each request refreshes the TTL (sliding) — for
fixed/sliding-window counters the TTL should align with window boundaries; for token bucket the
TTL covers the max idle-to-full-refill duration.

**Warning signs:**
`TTL key` returns `-1` (no expiry) in manual testing; Redis memory grows monotonically under a
high-cardinality key test; no `EXPIRE`/`PEXPIRE` in the `.lua` file.

**Phase to address:** P3 (Redis store / Lua).

---

### Pitfall 10: Non-compiling or test-failing submission (instant disqualifier)

**What goes wrong:**
"Non-compiling or test-failing code will not be reviewed." A stray `tsc` error, a test that
fails only in Docker/CI, or a flaky concurrency test sinks the entire submission regardless of
design quality.

**Why it happens:**
Final cleanup edits introduced without re-running the full gate; environment differences
(local Redis up, Docker Redis not wired); flaky time-based tests.

**How to avoid:**
Treat "build green + all tests pass" as a hard gate at **every** phase (it's a stated
constraint). Run `tsc --noEmit` + full test suite + a clean `docker-compose up` smoke before
declaring done. Eliminate flakiness at the source (FakeClock, deterministic concurrency tests).
A CI workflow or a single `npm run verify` script that does typecheck + test makes this
enforceable.

**Warning signs:**
Tests only ever run via the editor, never a clean CLI run; "works on my machine"; any skipped
or `.only` test left in.

**Phase to address:** Every phase (mandatory gate); final verification in P5.

---

### Pitfall 11: Missing/weak DESIGN.md (tradeoffs + AI usage)

**What goes wrong:**
DESIGN.md is a README clone listing features instead of explaining *decisions*: why three
algorithms, the fixed-window boundary tradeoff, why Lua for atomicity, the fail-open/closed
choice, and an honest account of how AI was used and verified. Undocumented AI code is
explicitly penalized.

**Why it happens:**
Docs are written last under time pressure and default to "what" not "why".

**How to avoid:**
Draft DESIGN.md sections as decisions are made (capture rationale live, not retroactively).
Required content: architecture overview, the algorithm-comparison/tradeoff table (including the
2x boundary burst), concurrency justification (Lua atomicity, single-threaded Node), error-policy
tradeoff, and an explicit "How AI was used" section. Cross-check it maps to PROJECT.md Key
Decisions.

**Warning signs:**
DESIGN.md describes features but not tradeoffs; no "AI usage" section; decisions in code have no
written rationale.

**Phase to address:** P5 (finalize), but accumulate notes from P1 onward.

---

### Pitfall 12: Connection-per-request / assuming multi-threading (Node-specific)

**What goes wrong:**
Creating a new ioredis client per request (socket churn, exhausted connections) or adding
mutexes/locks "for thread safety" that do nothing in single-threaded Node — classic signs of a
mental model imported from Java/Go. Or doing heavy synchronous work in the request path and
blocking the event loop.

**Why it happens:**
Misapplied concurrency intuition; "rate limiter must be thread-safe so add a lock."

**How to avoid:**
One shared ioredis client for the process, created at startup, injected into the store. No
mutexes in the in-memory store — atomicity comes from the single-threaded event loop within one
synchronous turn; the Redis store gets atomicity from Lua. Keep the hot path allocation-light
and synchronous-fast. Document in DESIGN.md *why* no application-level locks are needed (this
directly satisfies "concurrency only where needed").

**Warning signs:**
`new Redis(...)` inside a handler; imports of a mutex/async-lock library; comments about
"thread safety"; event-loop lag under load.

**Phase to address:** P3 (shared client), P4 (middleware), addressed in concurrency narrative.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Logic in TS, not Lua, for Redis store | Faster to write, easier to debug | Read-modify-write races; defeats the challenge's core requirement | Never for the Redis path |
| Real `sleep()` in time tests | No clock abstraction needed | Flaky, slow, coincidental passes | Never — use FakeClock |
| Skip TTL on Redis keys | Less Lua to write | Unbounded key growth / memory leak | Never |
| Default fail-open without a test | Demo "just works" when Redis down | Undefended security/availability decision in interview | Only if policy is documented AND tested |
| Inline `Date.now()` in algorithm | One fewer parameter | Untestable, non-deterministic, can't pass `now` to Lua consistently | Never in core |
| Single combined store+algorithm class | Fewer files | Can't reuse conformance suite; couples transport to logic | Never (Store interface is required) |
| Leave `console.log` / ad-hoc logging | Quick debugging | Reads as unfinished; noise in graded output | Only behind a real logger, off by default |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Redis (time) | Calling `redis.call('TIME')` inside the script | Pass `now` (ms) as `ARGV` from Node. Modern Redis 5.0+ uses effects-replication so TIME is *technically* allowed, but passing `now` keeps the script deterministic, replication-safe across all versions, AND testable — it's the correct choice regardless. |
| Redis (scripting) | Hand-rolling EVALSHA + NOSCRIPT fallback | Use ioredis `defineCommand` — it caches the script, uses EVALSHA, and auto-falls-back to EVAL on NOSCRIPT. (Caveat: the auto-retry does NOT apply inside a `.pipeline()`/`.multi()` — avoid pipelining the limiter script, or handle NOSCRIPT manually there.) |
| Redis (keys) | Unprefixed keys colliding with other app data | Namespace every key, e.g. `rl:{algo}:{clientKey}`. Pass the client key via `KEYS[1]` (not interpolated into the script body) so it's hash-tag/cluster-safe and injection-safe. |
| Redis (atomicity) | Multiple round-trips per decision | One EVALSHA call returns `{allowed, remaining, resetMs, retryAfterMs}` — a single atomic round-trip. |
| Redis (timeouts) | No deadline on calls; hang when Redis is slow | Set a `commandTimeout` / wrap in `Promise.race`; on timeout apply the fail-open/closed policy. |
| ioredis (lifecycle) | Client per request | One client per process, injected; close on shutdown. |
| Express (async) | `async` middleware that throws → unhandled rejection | `await` the store inside try/catch (or wrap with an async error handler) and `next(err)` / apply policy; never let the limiter reject unhandled. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Hot key (single shared limit key) | One Redis shard/key saturated; latency spike | Acceptable for per-client keys; only a concern for a global limit — note it in DESIGN.md, don't pre-solve | High global QPS on one key |
| Unbounded in-memory store growth | Process RSS climbs; never evicts idle clients | Add lazy expiry/eviction (drop entries past their window) in the in-memory store; document it | Many unique client keys over time |
| Key cardinality in Redis without TTL | Redis memory grows forever | TTL inside Lua (Pitfall 9) | Sustained unique clients |
| Multiple Redis round-trips per request | Latency = N × RTT | Single atomic Lua call | Always — avoid from the start |
| Blocking event loop with sync work | Throughput plateaus, latency tail grows | Keep hot path async/light; no heavy sync compute | Under concurrent load |

Note: this is a prototype/challenge — do NOT build for hypothetical 1M-user scale. Document the
hot-key and cardinality awareness in DESIGN.md rather than engineering around them (avoids the
overengineering penalty).

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting raw `req.ip` / `X-Forwarded-For` for the client key | Trivial limit bypass by spoofing the header | Derive the key from a trusted source; if using XFF, document the trusted-proxy assumption and `app.set('trust proxy', ...)` |
| Interpolating client key into Lua body | Script/key injection, cache fragmentation | Always pass via `KEYS[]`/`ARGV[]`, never string-concatenate into the script |
| Fail-open silently under attack | Limiter disabled exactly when Redis is stressed by the attack | Make policy explicit and tested; consider fail-closed for security-critical limits; log store failures |
| Returning internal error/state in 429 body | Information leak | Return minimal `429` + standard headers only |
| Unbounded distinct keys from attacker-controlled input | Memory exhaustion (in-memory or Redis) | TTL + eviction; cap or hash keys |

## UX Pitfalls

Common user experience mistakes in this domain (API consumer = "user").

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Missing `Retry-After` on 429 | Clients hammer-retry immediately; thundering herd | Always set `Retry-After` (seconds) and `X-RateLimit-Reset` on a 429 |
| Headers only on 429, not on 200 | Clients can't self-pace before being blocked | Set `X-RateLimit-Limit/Remaining/Reset` on every response |
| `Remaining` as a float | Confusing/invalid header value | Floor `remaining` to a non-negative integer for the header (keep float internal) |
| `Reset` in inconsistent units | Clients miscompute backoff | Pick a convention (epoch seconds OR delta-seconds), document it, be consistent |
| Off-by-one so the limit-th request is rejected | Clients get fewer requests than advertised | Decide `<=` vs `<` deliberately; test the exact limit boundary (request N allowed, N+1 denied) |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Redis store:** Often missing TTL inside Lua — verify `TTL <key>` is positive and keys expire when idle.
- [ ] **Concurrency correctness:** Often only tested in-memory — verify the conformance suite runs against real Redis and the parallel-burst test does NOT over-admit.
- [ ] **Fixed window:** Often missing the boundary-burst demonstration — verify a test asserts the 2x edge behavior knowingly.
- [ ] **Error policy:** Often missing the failure path — verify a test stops/breaks Redis and asserts both fail-open and fail-closed behavior; no unhandled rejection.
- [ ] **Headers:** Often missing `Retry-After` and headers-on-200 — verify all four headers on both 200 and 429.
- [ ] **Clock:** Often `Date.now()` is hard-coded — verify a `Clock` is injected and tests use a FakeClock (no real sleeps).
- [ ] **Token bucket rate:** Often drifts — verify a long-horizon steady-drip test holds the configured rate.
- [ ] **Build/test gate:** Often passes only in-editor — verify `tsc --noEmit` + full suite + clean `docker-compose up` all green from CLI.
- [ ] **DESIGN.md:** Often a feature list — verify it has tradeoffs, concurrency justification, error-policy rationale, and an AI-usage section.
- [ ] **NOSCRIPT:** Often untested — verify behavior after `SCRIPT FLUSH` (defineCommand should recover automatically outside pipelines).
- [ ] **AI slop:** Often un-pruned — verify no comment merely restates code, every config field is used, every abstraction has a real consumer.

## Concurrency Test Strategy (how to test concurrent consumption deterministically)

This is a stated grading focus, so call it out explicitly:

- **In-memory store:** Node is single-threaded, so fire N requests with `Promise.all([...])`
  WITHOUT awaiting between them, all at the same FakeClock `now`. Assert exactly `limit` are
  allowed and the rest denied. Because the algorithm is synchronous per turn, this deterministically
  exercises "simultaneous" arrivals.
- **Redis store:** Run the same conformance test against a real Redis (Docker). Fire N concurrent
  EVALSHA calls; the Lua atomicity guarantees exactly `limit` succeed. A non-atomic (TS-logic)
  implementation will over-admit here — this test is what *proves* the Lua approach is necessary.
- **Determinism:** Drive ALL time via the injected Clock / `now` argument so concurrency tests
  never depend on wall-clock ordering. No `sleep`, no real timers in these tests.
- **Anti-pattern:** Do NOT add application locks to "make the test pass" — that's the overengineering
  trap. The correct fix is atomicity (Lua) + single-threaded event loop, not mutexes.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Logic in TS not Lua (race) | MEDIUM | Move the read-compare-write into one `.lua`; return a result tuple; re-run Redis conformance test |
| No clock injection (flaky tests) | MEDIUM | Introduce `Clock`/`now` param through the algorithm + Lua ARGV; replace sleeps with FakeClock; ripples through call sites |
| Missing TTL (key leak) | LOW | Add `PEXPIRE` to the Lua script; add an expiry test |
| Unhandled Redis-down | LOW | Wrap store call in try/catch + timeout; apply policy; add fault-injection test |
| AI slop accumulated | LOW–MEDIUM | Dedicated prune pass: delete restating comments, unused config, single-use abstractions; re-justify each line |
| Overengineered abstractions | MEDIUM | Collapse to the required set (3 algorithms, 2 stores); delete plugin/factory layers; re-check against PROJECT.md Out-of-Scope |
| Non-compiling submission | HIGH (if found by grader) / LOW (if found by gate) | Enforce `npm run verify` gate every phase so it's never the grader who finds it |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Token bucket drift / float | P1 | Long-horizon steady-drip property test (P2) holds configured rate |
| Fixed-window 2x boundary (knowing) | P1 + P2 | Named test asserts the burst; DESIGN.md explains it |
| Sliding-window weighting math | P1 + P2 | Table-driven numeric tests at 0/50/99%/boundary |
| Read-modify-write race (Lua) | P3 | Concurrent EVALSHA burst against real Redis admits exactly `limit` |
| Fail-open/closed unhandled | P4 | Fault-injection test for both policies; no unhandled rejection |
| AI slop | Every phase + pre-P5 prune | Self-review: no code-restating comments, no unused config/abstractions |
| Overengineering | Roadmap scoping + transitions | Surface matches PROJECT.md exactly (3 algos, 2 stores, no extras) |
| Real-clock flaky tests | P1 (Clock) + P2 | Tests use FakeClock; zero `sleep`/real timers; deterministic reruns |
| Redis TTL / key leak | P3 | `TTL` positive; idle keys expire; memory flat under cardinality test |
| Non-compiling / test-failing | Every phase (gate) | `tsc --noEmit` + full suite + clean `docker-compose up` green from CLI |
| Weak DESIGN.md | P5 (notes from P1) | Has tradeoffs + concurrency justification + AI-usage section |
| Connection-per-request / fake locks | P3 + P4 | One shared client; no mutex imports; DESIGN.md justifies no app locks |

## Sources

- [Redis — Scripting with Lua (EVAL/EVALSHA, determinism, effects replication)](https://redis.io/docs/latest/develop/programmability/eval-intro/) — HIGH
- [Redis dev group — calling TIME inside EVAL (non-determinism, pass-as-arg workaround)](https://groups.google.com/g/redis-db/c/vYJhKhVu3Lc) — MEDIUM
- [Redis — rate limiter use case](https://redis.io/docs/latest/develop/use-cases/rate-limiter/) — HIGH
- [ioredis README — defineCommand (EVALSHA + auto NOSCRIPT fallback)](https://github.com/redis/ioredis) — HIGH
- [ioredis #1438 — reloading Lua on NOSCRIPT](https://github.com/redis/ioredis/issues/1438) — MEDIUM
- [Vitest — Timers guide (useFakeTimers, advanceTimersByTime, setSystemTime)](https://vitest.dev/guide/mocking/timers) — HIGH
- [Vitest — fakeTimers config](https://vitest.dev/config/faketimers) — HIGH
- Algorithm correctness (token bucket / fixed window 2x boundary / sliding-window-counter weighting) and challenge AI-slop/APOSD grading traps — established domain knowledge (Alex Xu System Design Interview Ch. 4; *A Philosophy of Software Design*) — MEDIUM/HIGH

---
*Pitfalls research for: distributed rate limiter (TypeScript/Node.js) graded coding challenge*
*Researched: 2026-06-23*
