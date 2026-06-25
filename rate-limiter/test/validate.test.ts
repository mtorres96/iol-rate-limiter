// validate.ts throw-arm coverage (T-01-06 / T-02-01 — D-01/D-04).
//
// The three construction-time `RangeError` throw arms in src/validate.ts are
// exercised here through their real call sites, with NO Docker and NO network:
//   - assertPositiveConfig: a TokenBucketLimiter built with `capacity: 0`.
//   - assertPolicy:         RedisStore.connect(url, { policy: <garbage> }).
//   - assertPrefix:         RedisStore.connect(url, { keyPrefix: "" }).
//
// RedisStore.connect uses `lazyConnect: true`, so constructing the store touches
// no socket — validation runs in the constructor BEFORE any op, so these throw
// synchronously without a running Redis (D-04: a real covering test, not a
// pragma). `assertCost` is deliberately NOT retested here — it is already fully
// covered by test/cost-validation.test.ts; duplicating it would be redundant.

import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  RedisStore,
  TokenBucketLimiter,
} from "../src/index.js";
import type { RateLimitPolicy } from "../src/index.js";

describe("validate.ts construction-time throw arms", () => {
  it("assertPositiveConfig throws RangeError on a non-positive config value (capacity: 0)", () => {
    expect(
      () =>
        new TokenBucketLimiter(new MemoryStore(), {
          capacity: 0,
          refillPerInterval: 1,
          intervalMs: 1,
        }),
    ).toThrow(RangeError);
  });

  it("assertPolicy throws RangeError on a garbage policy literal", () => {
    expect(() =>
      RedisStore.connect("redis://127.0.0.1:6379", {
        policy: "nope" as unknown as RateLimitPolicy,
      }),
    ).toThrow(RangeError);
  });

  it("assertPrefix throws RangeError on an empty keyPrefix", () => {
    expect(() =>
      RedisStore.connect("redis://127.0.0.1:6379", { keyPrefix: "" }),
    ).toThrow(RangeError);
  });
});
