// Fault-injection matrix (TEST-05) — proves the defensive layer under an
// induced Redis failure (the FOURTH Phase-2 success criterion: DEF-01/DEF-02).
//
// What this drives that the other Redis suites do NOT: real FAULTS. We take a
// live `redis:7.4-alpine` and either:
//   - DOWN — `container.stop()`: the TCP socket closes, so the next ioredis
//     command fails fast (the harness client uses `enableOfflineQueue:false` +
//     `maxRetriesPerRequest:1`, so it errors immediately rather than queueing).
//   - SLOW — `pause()` (cgroups freeze, see test/support/docker-pause.ts): the
//     socket stays OPEN but the server never replies, so the client's
//     `commandTimeout` (75ms — Pitfall 4 headroom) fires. This is the path the
//     DOWN case can't reach (a closed socket errors *before* the timeout).
//
// The matrix (02-RESEARCH §"Fault matrix" L368-377):
//
//                | fail-open            | fail-closed
//   -------------+----------------------+--------------------------
//   DOWN (stop)  | resolves allowed=1   | resolves allowed=0
//   SLOW (pause) | resolves allowed=1   | resolves allowed=0
//   BREAKER      | 5 failures → OPEN → short-circuit (no Redis attempt) →
//                |   FakeClock past cooldownMs + unpause → half-open probe → CLOSED
//
// The load-bearing invariant (DEF-02): EVERY cell asserts `expect(...).resolves`.
// `RedisStore` catches every timeout/connection error and resolves through its
// `degraded()` policy — a Redis outage can NEVER reject/crash the caller.
//
// Determinism: the breaker's cooldown is driven by an injected `FakeClock` (NOT
// real timers), so the OPEN→HALF-OPEN→CLOSED recovery is exact. ONE container
// per file (Pitfall 5). Skips cleanly with no Docker daemon (T-02-14), reusing
// the same `dockerAvailable()` liveness probe as the other Redis suites.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { FakeClock, RedisStore } from "../src/index.js";
import type { OpTuple, TBConfig } from "../src/index.js";
import {
  dockerAvailable,
  startRedis,
  stopRedis,
  waitReady,
  type RedisHarness,
} from "./support/redis.js";
import { pause, unpause } from "./support/docker-pause.js";

// A simple token-bucket op config reused across every cell.
const TB: TBConfig = { capacity: 5, refillPerInterval: 1, intervalMs: 1000 };
// The tuple a HEALTHY first cost-1 token-bucket call returns: admitted, 4 left,
// resetMs=1000 (time to refill the 1 consumed token back to full at 1/1000ms —
// the oracle-correct value the conformance suite pins), no retry. Distinct from
// the fail-open degraded() sentinel [1,1,0,0], so asserting it proves Redis was
// actually reached (not short-circuited).
const HEALTHY: OpTuple = [1, 4, 1000, 0];
const COMMAND_TIMEOUT_MS = 75; // DEF-01 band; Pitfall-4 headroom for the SLOW path.
const COOLDOWN_MS = 2000; // breaker default (D2-05) — drives the FakeClock recovery.

describe.skipIf(!dockerAvailable())("RedisStore fault-injection matrix (TEST-05)", () => {
  let harness: RedisHarness;
  // A dedicated client WITH a commandTimeout so the SLOW (pause) path actually
  // times out — the shared harness client sets no commandTimeout. maxRetries/
  // offlineQueue match the harness so the DOWN path errors fast too.
  let timeoutClient: Redis;

  beforeAll(async () => {
    harness = await startRedis(); // ONE container for the whole file (Pitfall 5)
    timeoutClient = new Redis(harness.container.getConnectionUrl(), {
      commandTimeout: COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // enableOfflineQueue:false ⇒ this client must be connected before any cell
    // issues its first (healthy) command, or the sanity call degrades.
    await waitReady(timeoutClient);
  }, 120_000);

  afterAll(async () => {
    if (timeoutClient) await timeoutClient.quit().catch(() => timeoutClient.disconnect());
    if (harness) await stopRedis(harness);
  });

  // Ensure the container is running and Redis is clean between cells so a faulted
  // state never leaks forward. `unpause` is a no-op if not paused; flushall is
  // best-effort (skipped if the cell left the container stopped — that cell is last).
  afterEach(async () => {
    await unpause(harness.container).catch(() => {});
    // A cell may have stopped/restarted/paused the container; both shared clients
    // reconnect asynchronously. Wait for them before the next cell's healthy
    // sanity call (and before flushall) so we never race the reconnect (the
    // source of the intermittent degraded-instead-of-real flakiness).
    await waitReady(harness.client).catch(() => {});
    await waitReady(timeoutClient).catch(() => {});
    await harness.client.flushall().catch(() => {});
  });

  // The DOWN cells use a DEDICATED, disposable container — NOT the shared harness.
  // `container.stop()` removes the container, and a `restart()` remaps the host
  // port (so a long-lived shared client could never reconnect). Isolating the
  // destructive stop to a throwaway container keeps the shared harness alive and
  // on a stable port for the SLOW/BREAKER cells.
  it("DOWN × fail-open → admits (allowed=1) and never rejects", async () => {
    const down = await startRedis();
    try {
      const store = new RedisStore(down.client, { keyPrefix: "fi-down-open", policy: "fail-open" });
      // Sanity: a healthy call admits with real state before we induce the fault.
      await expect(store.tokenBucket("k", TB, 1, 0)).resolves.toEqual(HEALTHY);

      await down.container.stop(); // DOWN: socket closes → command errors fast
      // The store catches the connection error and resolves through fail-open.
      const tuple = await store.tokenBucket("k", TB, 1, 0);
      expect(tuple[0]).toBe(1); // admitted (fail-open degraded() → [1,1,0,0])
    } finally {
      down.client.disconnect();
      await down.container.stop().catch(() => {});
    }
  });

  it("DOWN × fail-closed → denies (allowed=0) and never rejects", async () => {
    const down = await startRedis();
    try {
      const store = new RedisStore(down.client, {
        keyPrefix: "fi-down-closed",
        policy: "fail-closed",
      });
      await expect(store.tokenBucket("k", TB, 1, 0)).resolves.toEqual(HEALTHY);

      await down.container.stop(); // DOWN
      const tuple = await store.tokenBucket("k", TB, 1, 0);
      expect(tuple[0]).toBe(0); // denied (fail-closed degraded() → [0,0,0,cooldown])
      expect(tuple[3]).toBe(COOLDOWN_MS); // retryAfterMs ≈ breaker cooldown backoff
    } finally {
      down.client.disconnect();
      await down.container.stop().catch(() => {});
    }
  });

  it("SLOW × fail-open → commandTimeout fires, admits (allowed=1), never rejects", async () => {
    const store = new RedisStore(timeoutClient, {
      keyPrefix: "fi-slow-open",
      commandTimeoutMs: COMMAND_TIMEOUT_MS,
      policy: "fail-open",
    });
    await expect(store.tokenBucket("k", TB, 1, 0)).resolves.toEqual(HEALTHY);

    await pause(harness.container); // SLOW: frozen → no reply → commandTimeout fires
    const tuple = await store.tokenBucket("k", TB, 1, 0);
    expect(tuple[0]).toBe(1); // admitted via fail-open after the timeout
    await unpause(harness.container);
  });

  it("SLOW × fail-closed → commandTimeout fires, denies (allowed=0), never rejects", async () => {
    const store = new RedisStore(timeoutClient, {
      keyPrefix: "fi-slow-closed",
      commandTimeoutMs: COMMAND_TIMEOUT_MS,
      policy: "fail-closed",
    });
    await expect(store.tokenBucket("k", TB, 1, 0)).resolves.toEqual(HEALTHY);

    await pause(harness.container); // SLOW
    const tuple = await store.tokenBucket("k", TB, 1, 0);
    expect(tuple[0]).toBe(0); // denied via fail-closed after the timeout
    await unpause(harness.container);
  });

  it("BREAKER: 5 failures OPEN it (short-circuit, no Redis attempt) then half-open recovers to CLOSED", async () => {
    // Drive the breaker with a SLOW Redis so every faulted call times out via the
    // dedicated commandTimeout client; a FakeClock makes the cooldown exact.
    const clock = new FakeClock(0);
    const store = new RedisStore(
      timeoutClient,
      { keyPrefix: "fi-breaker", commandTimeoutMs: COMMAND_TIMEOUT_MS, policy: "fail-open" },
      clock,
    );

    await pause(harness.container); // induce the outage

    // Five consecutive timeouts → breaker reaches the failureThreshold and OPENs.
    // Each call still RESOLVES (fail-open) — DEF-02. These actually hit Redis (and
    // time out), so they are slow; the suite's testTimeout (60s) covers 5×75ms.
    for (let i = 0; i < 5; i++) {
      const tuple = await store.tokenBucket("k", TB, 1, 0);
      expect(tuple[0]).toBe(1); // fail-open admits on every fault
    }

    // Breaker now OPEN: the NEXT call must short-circuit WITHOUT touching Redis.
    // We prove "no Redis attempt" by timing it — a real frozen-Redis round-trip
    // would block ~75ms; a short-circuit returns effectively instantly.
    const t0 = Date.now();
    const shortCircuited = await store.tokenBucket("k", TB, 1, 0);
    const elapsed = Date.now() - t0;
    expect(shortCircuited[0]).toBe(1); // still resolves (fail-open degraded())
    expect(elapsed).toBeLessThan(COMMAND_TIMEOUT_MS); // proves no commandTimeout round-trip

    // Recovery: unfreeze Redis and advance the injected clock PAST the cooldown so
    // the breaker goes OPEN → HALF-OPEN and permits a single probe. The probe now
    // hits a healthy Redis → success → CLOSED. (Key state persisted across the 6
    // prior degraded calls is irrelevant — none of those reached Redis after the
    // bucket drained, and degraded() never wrote — so a fresh key proves recovery.)
    await unpause(harness.container);
    await waitReady(timeoutClient); // socket must be live again before the probe
    clock.setTime(COOLDOWN_MS); // cooldown elapsed → canAttempt() half-opens

    const recovered = await store.tokenBucket("recovered-key", TB, 1, 0);
    // A real Redis round-trip succeeded: remaining reflects true state (4 of 5),
    // NOT the degraded() fail-open sentinel [1,0,0,0] — proving the breaker CLOSED.
    expect(recovered).toEqual(HEALTHY);
  });
});
