// Demo docs-surface test (D-07 / D-08).
//
// Drives the composed demo `app` through supertest WITHOUT binding a port to prove
// the docs surface added in plan 05-02:
//   (a) GET /docs/ renders the Swagger UI (200).
//   (b) GET /openapi.json serves a structurally valid OpenAPI 3 document — a few
//       light structural assertions (D-08), NOT a heavy schema validator.
//   (c) the served spec actually DOCUMENTS the rate-limit headers on /api/ping's
//       429 response (the showcase — must_haves.truths[2]).
//
// Both routes are registered OUTSIDE the limiter, so this test never trips a 429.
// Mirrors demo.test.ts (buildApp + supertest + close() in finally).

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/demo/server.js";

afterEach(() => {
  delete process.env.RL_ALGO;
  delete process.env.REDIS_URL;
});

describe("demo docs surface — D-07/D-08 (05-02)", () => {
  it("GET /docs/ renders the Swagger UI (200), outside the limiter", async () => {
    const { app, close } = buildApp();
    try {
      // Request /docs/ directly: app.use("/docs", ...) commonly 301-redirects
      // /docs → /docs/, so hit the trailing-slash form to land on the UI HTML.
      const res = await request(app).get("/docs/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("swagger-ui");
    } finally {
      await close();
    }
  });

  it("GET /openapi.json serves a structurally valid OpenAPI 3 doc documenting the rate-limit headers", async () => {
    const { app, close } = buildApp();
    try {
      const res = await request(app).get("/openapi.json");
      expect(res.status).toBe(200);

      type DocResponse = { headers?: Record<string, unknown> };
      type DocOperation = { responses: Record<string, DocResponse | undefined> };
      const spec = res.body as {
        openapi: string;
        paths: Record<string, Record<string, DocOperation | undefined> | undefined>;
      };

      // D-08: a few structural checks, not a full validator.
      expect(spec.openapi).toMatch(/^3\./);
      expect(spec.paths["/health"]).toBeDefined();
      expect(spec.paths["/api/ping"]).toBeDefined();

      const ping429 = spec.paths["/api/ping"]?.get?.responses["429"];
      expect(ping429).toBeDefined();

      // must_haves.truths[2]: the served spec documents the rate-limit headers on
      // the 429 path — structural property assertion (no schema-validator dep).
      expect(ping429?.headers).toBeDefined();
      const headerNames = Object.keys(ping429?.headers ?? {});
      expect(
        headerNames.includes("Retry-After") || headerNames.includes("RateLimit-Policy"),
      ).toBe(true);
    } finally {
      await close();
    }
  });
});
