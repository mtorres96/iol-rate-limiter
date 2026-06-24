// Degraded-policy tuple-shape tests (DEF-02 / D2-04 — WR-02 / WR-03).
//
// These exercise RedisStore.degraded() WITHOUT Docker: a stub ioredis client
// whose custom commands always reject drives RedisStore.run() straight into its
// catch block, so the fail-open / fail-closed sentinel tuple is returned. We
// assert the tuple SHAPE here (the semantic contract the Phase-3 adapter relies
// on) — distinct from fault-injection.test.ts, which proves the same paths
// against a real frozen/stopped container.
//
// The breaker is driven by an injected FakeClock (NO real timers): the first op
// fails (failures=1, still closed), so each op below actually reaches the stub
// and routes through degraded() rather than being short-circuited by an open
// breaker — making the tuple assertion deterministic.

import { describe, expect, it } from "vitest";
import type Redis from "ioredis";
import { FakeClock, RedisStore } from "../src/index.js";
import type { OpTuple, TBConfig } from "../src/index.js";

const TB: TBConfig = { capacity: 5, refillPerInterval: 1, intervalMs: 1000 };
const COOLDOWN_MS = 2000; // breaker default (D2-05)

/**
 * A minimal ioredis stand-in: it accepts the three `defineCommand` registrations
 * the RedisStore makes in its constructor, then makes every custom command
 * REJECT — simulating a down/erroring Redis so every op falls through to
 * degraded(). No network, no Docker.
 */
function rejectingClient(): Redis {
  const client = {
    // RedisStore registers rl_tb/rl_sw/rl_fw; each must exist and reject.
    defineCommand(name: string): void {
      (client as Record<string, unknown>)[name] = () =>
        Promise.reject(new Error("stub: Redis unavailable"));
    },
  };
  return client as unknown as Redis;
}

describe("RedisStore.degraded() tuple shape (WR-02 / WR-03)", () => {
  it("fail-closed: denies with resetMs=0 (unknown) and retryAfterMs=cooldownMs (WR-03)", async () => {
    const store = new RedisStore(
      rejectingClient(),
      { keyPrefix: "deg-closed", policy: "fail-closed" },
      new FakeClock(0),
    );
    const tuple = (await store.tokenBucket("k", TB, 1, 0)) as OpTuple;
    // [allowed=0, remaining=0, resetMs=0 (unknown — NOT the breaker cooldown), retryAfterMs=cooldown]
    expect(tuple).toEqual([0, 0, 0, COOLDOWN_MS]);
    expect(tuple[2]).toBe(0); // resetMs is unknown while Redis is down — not conflated with cooldown
    expect(tuple[3]).toBe(COOLDOWN_MS); // retryAfterMs is the backoff hint
  });

  it("fail-open: admits with remaining=1 (not the self-contradictory remaining=0 — WR-02)", async () => {
    const store = new RedisStore(
      rejectingClient(),
      { keyPrefix: "deg-open", policy: "fail-open" },
      new FakeClock(0),
    );
    const tuple = (await store.tokenBucket("k", TB, 1, 0)) as OpTuple;
    // [allowed=1, remaining=1 (the admitted request "fits" — no longer 0), resetMs=0, retryAfterMs=0]
    expect(tuple).toEqual([1, 1, 0, 0]);
  });

  it("logs ONCE on the healthy→degraded edge when a logger is wired (WR-02)", async () => {
    const warnings: { obj: Record<string, unknown>; msg: string }[] = [];
    const logger = { warn: (obj: Record<string, unknown>, msg: string) => warnings.push({ obj, msg }) };
    const store = new RedisStore(
      rejectingClient(),
      { keyPrefix: "deg-log", policy: "fail-open", logger },
      new FakeClock(0),
    );
    // Several faulted ops in a row, but the warn fires only ONCE (edge-triggered).
    await store.tokenBucket("k", TB, 1, 0);
    await store.tokenBucket("k", TB, 1, 0);
    await store.tokenBucket("k", TB, 1, 0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.obj).toMatchObject({ event: "rate_limiter_degraded", policy: "fail-open" });
  });

  it("is silent with no logger wired (logger is optional — WR-02)", async () => {
    // No `logger` in config → no throw, no output; just resolves through the policy.
    const store = new RedisStore(
      rejectingClient(),
      { keyPrefix: "deg-nolog", policy: "fail-open" },
      new FakeClock(0),
    );
    await expect(store.tokenBucket("k", TB, 1, 0)).resolves.toEqual([1, 1, 0, 0]);
  });

  it("never rejects on a Redis fault (DEF-02) — resolves through the policy", async () => {
    const store = new RedisStore(
      rejectingClient(),
      { keyPrefix: "deg-noreject", policy: "fail-closed" },
      new FakeClock(0),
    );
    await expect(store.slidingWindow("k", { limit: 7, windowMs: 60_000 }, 1, 0)).resolves.toBeDefined();
    await expect(store.fixedWindow("k", { limit: 5, windowMs: 1000 }, 1, 0)).resolves.toBeDefined();
  });
});
