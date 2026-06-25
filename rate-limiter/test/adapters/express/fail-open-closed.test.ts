// HTTP-04 — fail-open / fail-closed verification WITHOUT Redis (D3-07 / D3-08).
//
// The middleware owns its OWN configurable fail-open/closed policy (independent of
// any store), so HTTP-04 is provable with a throwing-stub `RateLimiter` whose
// `consume()` always rejects — no Redis, no Docker. supertest drives a real
// `express()` app and asserts the rejection is RESOLVED through the policy (200
// fail-open / 429 fail-closed) and NEVER leaks to Express's error handler or
// surfaces as an unhandled rejection (T-03-06).
//
// `keyGenerator: () => "k"` is deterministic so the path under test is the
// `consume()` rejection — not key extraction.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DegradedLogger, RateLimiter } from "../../../src/index.js";
import { rateLimit } from "../../../src/adapters/express/index.js";

/** A limiter whose `consume()` always rejects — simulates a down/throwing store. */
const boom: RateLimiter = {
  consume: () => Promise.reject(new Error("store down")),
};

/** A `DegradedLogger` stub that records every `warn(obj, msg)` call. */
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

describe("rateLimit middleware — fail-open/closed on limiter error (HTTP-04)", () => {
  // Suite-level guard: a `consume()` rejection that escaped the middleware's
  // try/catch would surface here as an unhandled rejection. Asserting none fired
  // proves the policy fully absorbs the error (T-03-06 / D3-09).
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  beforeAll(() => process.on("unhandledRejection", onUnhandled));
  afterAll(() => process.off("unhandledRejection", onUnhandled));

  it("default policy (fail-open) ADMITS (200) on a limiter rejection", async () => {
    const app = express();
    app.use(rateLimit({ limiter: boom, keyGenerator: () => "k" }));
    app.get("/", (_req, res) => res.send("ok"));

    const r = await request(app).get("/");

    expect(r.status).toBe(200); // availability over strictness — admitted, no crash
    expect(r.text).toBe("ok");
  });

  it('explicit policy: "fail-open" ADMITS (200)', async () => {
    const app = express();
    app.use(rateLimit({ limiter: boom, keyGenerator: () => "k", policy: "fail-open" }));
    app.get("/", (_req, res) => res.send("ok"));

    const r = await request(app).get("/");

    expect(r.status).toBe(200);
  });

  it('policy: "fail-closed" DENIES (429) on a limiter rejection', async () => {
    const app = express();
    app.use(rateLimit({ limiter: boom, keyGenerator: () => "k", policy: "fail-closed" }));
    app.get("/", (_req, res) => res.send("ok"));

    const r = await request(app).get("/");

    expect(r.status).toBe(429); // strictness over availability — denied, no crash
  });

  it("the catch path logs a warn via the DegradedLogger stub (D3-08)", async () => {
    const { logger, warnings } = captureLogger();
    const app = express();
    app.use(rateLimit({ limiter: boom, keyGenerator: () => "k", policy: "fail-open", logger }));
    app.get("/", (_req, res) => res.send("ok"));

    const r = await request(app).get("/");

    expect(r.status).toBe(200);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toContain("limiter error");
    expect(warnings[0]?.obj).toHaveProperty("err");
  });

  it("never produced an unhandled rejection across the suite (T-03-06)", () => {
    // The error paths above all ran; the policy absorbed every rejection.
    expect(unhandled).toHaveLength(0);
  });
});
