// Demo metrics-surface test (OBS-02, demo-tier).
//
// Drives the composed demo `app` through supertest WITHOUT binding a port to prove
// the /metrics surface added in quick task 260625-s2j:
//   (a) GET /metrics → 200, Prometheus text content-type, body exposes the custom
//       counter `rate_limiter_decisions_total`.
//   (b) /metrics is OUTSIDE the limiter — firing MORE requests than the configured
//       limit (demo default is 5) never trips a 429 (the unlimited-zone property).
//
// Mirrors test/docs.test.ts (buildApp + supertest + afterEach env cleanup + close()
// in a finally). Lives in src/demo's coverage-excluded tier but runs in the suite.

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/demo/server.js";

afterEach(() => {
  delete process.env.RL_ALGO;
  delete process.env.REDIS_URL;
  delete process.env.RL_LIMIT;
});

describe("demo metrics surface — OBS-02 (260625-s2j)", () => {
  it("GET /metrics → 200, Prometheus text content-type, exposes rate_limiter_decisions_total", async () => {
    const { app, close } = buildApp();
    try {
      const res = await request(app).get("/metrics");
      expect(res.status).toBe(200);
      // prom-client's register.contentType is the Prometheus text exposition type
      // (text/plain; version=0.0.4; charset=utf-8). Assert the stable substrings.
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.headers["content-type"]).toContain("version=0.0.4");
      expect(res.text).toContain("rate_limiter_decisions_total");
    } finally {
      await close();
    }
  });

  it("GET /metrics is outside the limiter — never 429 past the configured limit", async () => {
    const { app, close } = buildApp();
    try {
      // The demo default limit is 5; fire well past it. Every status must be 200,
      // proving /metrics sits in the unlimited zone (no budget consumed, no 429).
      const REQUESTS = 12;
      for (let i = 0; i < REQUESTS; i++) {
        const res = await request(app).get("/metrics");
        expect(res.status).toBe(200);
      }
    } finally {
      await close();
    }
  });

  it("counts blocked decisions — over-limit /api/ping requests increment decision=blocked", async () => {
    // Regression guard: the decision hook MUST be registered before the limiter, or a
    // 429-short-circuited request never reaches it and "blocked" is silently never
    // counted. Drive past a tiny limit and assert the blocked series is non-zero.
    process.env.RL_LIMIT = "2";
    const { app, close } = buildApp();
    try {
      for (let i = 0; i < 6; i++) {
        await request(app).get("/api/ping"); // 2 allowed, then 429s
      }
      // res.on("finish") fires just after each response flushes; yield a macrotask so
      // all finish handlers have recorded before we scrape /metrics.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const res = await request(app).get("/metrics");
      expect(res.status).toBe(200);
      expect(res.text).toMatch(
        /rate_limiter_decisions_total\{decision="blocked"\}\s+[1-9]/,
      );
    } finally {
      await close();
    }
  });
});
