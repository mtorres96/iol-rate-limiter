// THE PARITY CONTRACT (TEST-02 / D2-10 / threat T-02-13).
//
// One parametrized suite drives the SAME `(key, cost, now)` sequences from
// `sequences.ts` across BOTH stores — the in-memory reference (`MemoryStore`,
// the Phase-1 trusted oracle) and the distributed `RedisStore` (atomic Lua) —
// and asserts they produce IDENTICAL `Decision`s, field for field.
//
// Why this is the contract: the Lua scripts are a hand port of the MemoryStore
// ops. Any TS↔Lua drift — a wrong `floor`/`ceil`, a lost fraction, an off-by-one
// boundary, a mis-ordered ARGV — would make a Decision diverge for at least one
// fixture step and fail here immediately. We assert the WHOLE Decision with
// `toEqual` against a SINGLE shared expected value (computed once from the
// fixtures), NOT per-store expectations — so the test cannot "pass" by encoding
// the Redis bug into a second expectation.
//
// Time is driven ONLY via the injected `FakeClock.setTime(step.now)` (never
// `Date.now()`, never Redis `TIME`, never vi fake timers): the limiter passes
// that `now` to the store op, and the Lua receives the SAME value via ARGV, so
// parity is meaningful.
//
// Docker (T-02-14, `accept`): the suite is one `describe.each` over the two store
// parameters; the RedisStore parameter is skipped cleanly (via `dockerAvailable()`
// at collection time) when no daemon is reachable, while the MemoryStore
// parameter always runs so `npm test` still gates the core.
// ONE container per file (Pitfall 5): started in `beforeAll`, stopped in
// `afterAll`; cases are isolated by `flushall` + per-case key prefixes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock, MemoryStore } from "../../src/index.js";
import type { Decision, RateLimiter, Store } from "../../src/index.js";
import { fwCases, swCases, tbCases, type AlgoCase, type Step } from "./sequences.js";
import {
  dockerAvailable,
  makeRedisStore,
  startRedis,
  stopRedis,
  type RedisHarness,
} from "../support/redis.js";

const allCases: AlgoCase[] = [...tbCases, ...swCases, ...fwCases];

/** Replay a case's steps against a freshly-built limiter, collecting Decisions. */
async function replay(
  make: (store: Store, clock: FakeClock) => RateLimiter,
  store: Store,
  clock: FakeClock,
  steps: Step[],
): Promise<Decision[]> {
  const limiter = make(store, clock);
  const decisions: Decision[] = [];
  for (const step of steps) {
    clock.setTime(step.now);
    decisions.push(await limiter.consume(step.key, step.cost));
  }
  return decisions;
}

// The SHARED expectation: replay every case against the trusted in-memory oracle
// ONCE and freeze the resulting Decision sequence. Both store parameters below
// assert their output `toEqual` THIS value — a single source of truth, so a
// RedisStore divergence cannot be masked by a second hand-written expectation.
const EXPECTED: Map<string, Decision[]> = new Map();

beforeAll(async () => {
  for (const c of allCases) {
    const decisions = await replay(c.make, new MemoryStore(), new FakeClock(0), c.steps);
    EXPECTED.set(c.name, decisions);
  }
});

// A lazily-started, file-scoped Redis harness shared by the RedisStore parameter
// (ONE container per file — Pitfall 5). It is only started if the RedisStore
// parameter actually runs (i.e. Docker is live); the MemoryStore parameter never
// touches it.
let harness: RedisHarness | undefined;
const HAS_DOCKER = dockerAvailable();

/**
 * Each store parameter supplies: a label, a `skip` flag (RedisStore skips with
 * no Docker — T-02-14), an optional per-file `setup`/`teardown`, and a
 * `buildStore(clock, idx)` that yields a fresh, isolated store for one case.
 */
interface StoreParam {
  label: string;
  skip: boolean;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  buildStore: (clock: FakeClock, idx: number) => Promise<Store>;
}

const storeParams: StoreParam[] = [
  {
    label: "MemoryStore",
    skip: false,
    buildStore: async () => new MemoryStore(),
  },
  {
    label: "RedisStore",
    skip: !HAS_DOCKER,
    setup: async () => {
      harness = await startRedis(); // ONE container for the whole file (Pitfall 5)
    },
    teardown: async () => {
      if (harness) await stopRedis(harness);
      harness = undefined;
    },
    buildStore: async (clock, idx) => {
      // Flush + a per-case key prefix: total isolation between cases even though
      // they share the one container/client.
      await harness!.client.flushall();
      return makeRedisStore(harness!, clock, { keyPrefix: `conf${idx}` });
    },
  },
];

describe("store conformance — MemoryStore vs RedisStore parity (TEST-02)", () => {
  describe.each(storeParams)("$label", (param) => {
    // The RedisStore parameter is skipped cleanly when no Docker daemon is
    // reachable; the MemoryStore parameter always runs so `npm test` still gates.
    const maybe = param.skip ? describe.skip : describe;
    maybe(param.label, () => {
      if (param.setup) beforeAll(param.setup, 120_000);
      if (param.teardown) afterAll(param.teardown);

      allCases.forEach((c, idx) => {
        it(c.name, async () => {
          const clock = new FakeClock(0);
          const store = await param.buildStore(clock, idx);
          const actual = await replay(c.make, store, clock, c.steps);
          // Bit-for-bit parity with the in-memory oracle — the WHOLE Decision,
          // asserted against the single shared expectation (not a per-store one).
          expect(actual).toEqual(EXPECTED.get(c.name));
        });
      });
    });
  });
});
