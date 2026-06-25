// Demo server smoke test (DELIV-01 / D4-03 route contract).
//
// Drives the composed demo `app` (the composition root from src/demo/server.ts)
// through supertest WITHOUT binding a real port. The demo keeps the `req.ip`
// default key (D4-04), so to exercise the admit→429 transition deterministically
// all `/api/ping` requests are sent through ONE supertest agent (a single
// keep-alive client → a stable source IP → a stable per-IP limiter key). Loopback
// `req.ip` flakiness (see middleware.test.ts:9-11) is avoided this way rather than
// by overriding the demo's keyGenerator (which it must NOT do).
//
// This is intentionally thin: the heavy HTTP-semantics coverage (header families,
// custom handlers, empty-key admission) already lives in the Phase-3 middleware
// tests. Here we only prove the demo's own contract:
//   (a) /health is registered OUTSIDE the limiter → 200 and NEVER 429 (T-04-01).
//   (b) /api/ping is registered INSIDE the limiter → admits then 429s w/ Retry-After.

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

// The demo composition root. RL_ALGO defaults to token-bucket with a tiny limit
// (capacity 5) so a 429 is reachable in a short loop. No REDIS_URL → MemoryStore.
import { buildApp } from "../src/demo/server.js";

const PING_LIMIT = 5; // mirrors the demo's tiny token-bucket capacity (D4-03).

afterEach(() => {
  delete process.env.RL_ALGO;
  delete process.env.REDIS_URL;
});

describe("demo server — D4-03 route contract (DELIV-01)", () => {
  it("GET /health returns 200 and is never throttled, even after the ping budget is spent", async () => {
    const { app, close } = buildApp();
    try {
      const agent = request.agent(app);

      // Exhaust the /api/ping budget (and then some) on a single shared client.
      for (let i = 0; i < PING_LIMIT + 2; i++) {
        await agent.get("/api/ping");
      }

      // /health is registered BEFORE app.use(rateLimit) → outside the limiter.
      // It must still be 200 and must NEVER be 429 (T-04-01: healthcheck DoS).
      const health = await agent.get("/health");
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({ status: "ok" });
    } finally {
      await close();
    }
  });

  it("GET /api/ping admits up to the tiny limit (200) then 429s with Retry-After", async () => {
    const { app, close } = buildApp();
    try {
      const agent = request.agent(app); // one client → stable req.ip → stable key.

      // The first PING_LIMIT requests are admitted (200).
      for (let i = 0; i < PING_LIMIT; i++) {
        const ok = await agent.get("/api/ping");
        expect(ok.status).toBe(200);
        expect(ok.body).toMatchObject({ pong: true });
      }

      // The next request is over budget → 429 with a Retry-After hint.
      const blocked = await agent.get("/api/ping");
      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBeDefined();
    } finally {
      await close();
    }
  });
});

describe("demo server — fail-loud on bad RL_ALGO (T-04-02)", () => {
  it("throws a RangeError at startup for an unknown RL_ALGO", () => {
    process.env.RL_ALGO = "not-a-real-algo";
    expect(() => buildApp()).toThrow(RangeError);
  });
});
