// Express adapter end-to-end verification (HTTP-01 / HTTP-02 / HTTP-03).
//
// These supertest suites drive a REAL `express()` app through the `rateLimit`
// middleware against the in-memory store (no Redis). The limiter is a
// deterministic `capacity: 1` `TokenBucketLimiter` over a `FakeClock(0)`, so the
// first request is admitted and the second is throttled with NO time advance —
// proving the admit→429 transition and the header contract on BOTH paths.
//
// `keyGenerator: () => "k1"` is explicit (RESEARCH Pitfall 3): supertest connects
// over loopback and `req.ip` can be `undefined`/`::ffff:127.0.0.1`, so a fixed key
// guarantees the over-limit transition is what's exercised, not key flakiness.

import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { FakeClock, MemoryStore, TokenBucketLimiter } from "../../../src/index.js";
import type { DegradedLogger } from "../../../src/index.js";
import { rateLimit } from "../../../src/adapters/express/index.js";

/** A `capacity: 1` bucket: one admit, then throttle — the minimal admit→429 fixture. */
function oneShotLimiter(): TokenBucketLimiter {
  return new TokenBucketLimiter(
    new MemoryStore(),
    { capacity: 1, refillPerInterval: 1, intervalMs: 1000 },
    new FakeClock(0),
  );
}

/** A `DegradedLogger` stub that records every `warn(obj, msg)` call for assertion. */
function captureLogger(): {
  logger: DegradedLogger;
  warnings: { obj: Record<string, unknown>; msg: string }[];
} {
  const warnings: { obj: Record<string, unknown>; msg: string }[] = [];
  const logger: DegradedLogger = {
    warn: (obj, msg) => warnings.push({ obj, msg }),
  };
  return { logger, warnings };
}

describe("rateLimit middleware — admit→429 + headers (HTTP-01/02/03)", () => {
  it("admits the first request (200) with IETF + legacy headers (HTTP-01/03)", async () => {
    const limiter = oneShotLimiter();
    const app = express();
    app.use(rateLimit({ limiter, keyGenerator: () => "k1" }));
    app.get("/", (_req, res) => res.send("ok"));

    const ok = await request(app).get("/");

    expect(ok.status).toBe(200);
    expect(ok.text).toBe("ok");

    // IETF draft-11 List-of-Items form: `RateLimit: "default";r=<remaining>;t=<reset>`.
    expect(ok.headers["ratelimit"]).toMatch(/^"default";r=\d+;t=\d+$/);
    expect(ok.headers["ratelimit-policy"]).toContain('"default";q=1');

    // Legacy `X-RateLimit-*`: integer `remaining` ("0" — the single token is spent).
    expect(ok.headers["x-ratelimit-remaining"]).toBe("0");
    expect(ok.headers["x-ratelimit-limit"]).toBe("1");

    // Reset is delta-seconds (D3-05), NOT an epoch — assert it is a small value.
    const reset = Number(ok.headers["x-ratelimit-reset"]);
    expect(Number.isInteger(reset)).toBe(true);
    expect(reset).toBeLessThan(1e6); // delta-seconds, not wall-clock epoch
  });

  it("throttles the second request (429) with Retry-After AND budget headers (HTTP-02/03)", async () => {
    const limiter = oneShotLimiter();
    const app = express();
    app.use(rateLimit({ limiter, keyGenerator: () => "k1" }));
    app.get("/", (_req, res) => res.send("ok"));

    await request(app).get("/"); // drains the single token
    const blocked = await request(app).get("/");

    expect(blocked.status).toBe(429);
    // Retry-After is the delta-seconds hint set ONLY on the 429 path (D3-10).
    expect(blocked.headers["retry-after"]).toBeDefined();

    // D3-04: the budget headers STILL appear on the rejected response.
    expect(blocked.headers["ratelimit"]).toMatch(/^"default";r=\d+;t=\d+$/);
    expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");

    // Default 429 JSON body carries `error` + machine-readable `retryAfterMs`.
    expect(blocked.body).toMatchObject({ error: expect.any(String) });
    expect(typeof blocked.body.retryAfterMs).toBe("number");
    expect(blocked.body.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("rateLimit middleware — empty key admits + logs (D3-03)", () => {
  it("admits (200) and logs a warn when keyGenerator yields an empty key", async () => {
    const limiter = oneShotLimiter();
    const { logger, warnings } = captureLogger();
    const app = express();
    app.use(rateLimit({ limiter, keyGenerator: () => "", logger }));
    app.get("/", (_req, res) => res.send("ok"));

    // Two requests with an empty key: BOTH admit — no `consume()` is ever called,
    // so the single-token bucket is never drained.
    const r1 = await request(app).get("/");
    const r2 = await request(app).get("/");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // The DegradedLogger captured the empty-key admission (one warn per request).
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.msg).toContain("empty key");
  });
});

describe("rateLimit middleware — headers mode selection (D3-04)", () => {
  it('headers: "legacy" omits the IETF RateLimit header but keeps X-RateLimit-*', async () => {
    const limiter = oneShotLimiter();
    const app = express();
    app.use(rateLimit({ limiter, keyGenerator: () => "k1", headers: "legacy" }));
    app.get("/", (_req, res) => res.send("ok"));

    const ok = await request(app).get("/");

    expect(ok.status).toBe(200);
    expect(ok.headers["ratelimit"]).toBeUndefined();
    expect(ok.headers["ratelimit-policy"]).toBeUndefined();
    expect(ok.headers["x-ratelimit-limit"]).toBe("1");
  });

  it("headers: false omits ALL rate-limit headers", async () => {
    const limiter = oneShotLimiter();
    const app = express();
    app.use(rateLimit({ limiter, keyGenerator: () => "k1", headers: false }));
    app.get("/", (_req, res) => res.send("ok"));

    const ok = await request(app).get("/");

    expect(ok.status).toBe(200);
    expect(ok.headers["ratelimit"]).toBeUndefined();
    expect(ok.headers["ratelimit-policy"]).toBeUndefined();
    expect(ok.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(ok.headers["x-ratelimit-remaining"]).toBeUndefined();
    expect(ok.headers["x-ratelimit-reset"]).toBeUndefined();
  });
});
