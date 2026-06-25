// Hand-written OpenAPI 3 spec for the demo server (D-06 / D-07).
//
// This is a DEMO-TIER artifact: it documents ONLY the two public demo endpoints
// (/health and /api/ping) so a grader can interactively see the 200 → 429 +
// RateLimit-* behavior at /docs. It is the showcase surface, not part of the
// shippable library.
//
// Tier boundary (LOAD-BEARING): this file MUST NOT be imported by src/index.ts
// (the framework-agnostic core barrel) nor by any file under
// src/adapters/express/**. Only src/demo/server.ts may import it. Mirrors the
// same rule that keeps the core free of Express/ioredis.
//
// D-06 discretion → hand-authored typed object (NOT codegen / JSDoc decorators):
// `OpenAPIV3.Document` from `openapi-types` is types-only (zero runtime weight)
// and gives compile-time structural validation — `tsc` rejects a malformed spec.
// Every line below is hand-written; no decorator or generator toolchain is used.
//
// The exact header names documented here are copied verbatim from the adapter's
// emitter (src/adapters/express/headers.ts L53-62 + middleware.ts Retry-After):
//   RateLimit-Policy, RateLimit, X-RateLimit-Limit, X-RateLimit-Remaining,
//   X-RateLimit-Reset, and (429 only) Retry-After.

import type { OpenAPIV3 } from "openapi-types";

/**
 * The four rate-limit headers emitted on BOTH the 200 and 429 /api/ping paths
 * (the IETF draft-11 pair plus the legacy triple). Factored out so the 200 and
 * 429 responses document the identical header set without drift. `Retry-After`
 * is added separately on the 429 path only.
 */
const rateLimitHeaders: Record<string, OpenAPIV3.HeaderObject> = {
  "RateLimit-Policy": {
    description:
      'IETF draft-11 policy advertisement, e.g. `default;q=5;w=60` (q = limit, w = window seconds).',
    schema: { type: "string" },
  },
  RateLimit: {
    description:
      "IETF draft-11 current quota, e.g. `default;r=4;t=60` (r = remaining, t = reset seconds).",
    schema: { type: "string" },
  },
  "X-RateLimit-Limit": {
    description: "Legacy: the per-window request limit.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Remaining": {
    description: "Legacy: requests remaining in the current window.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Reset": {
    description: "Legacy: delta-seconds until the limit resets (NOT an epoch).",
    schema: { type: "integer" },
  },
};

/** Hand-authored, typed OpenAPI 3 document for the demo endpoints. */
export const openapiSpec: OpenAPIV3.Document = {
  openapi: "3.0.3",
  info: {
    title: "IOL Rate Limiter — Demo API",
    version: "1.0.0",
    description:
      "The two demo endpoints exposed by the rate-limiter demo server. " +
      "/api/ping is rate-limited and showcases the IETF `RateLimit*` + legacy " +
      "`X-RateLimit-*` headers and the 429 Too Many Requests response; /health " +
      "is registered outside the limiter and is never throttled.",
  },
  paths: {
    "/health": {
      get: {
        summary: "Liveness check (never rate-limited)",
        description:
          "Registered BEFORE the limiter middleware, so it is never throttled and " +
          "never consumes limiter budget.",
        responses: {
          "200": {
            description: "Service is up.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: {
                    status: { type: "string", enum: ["ok"] },
                  },
                },
                example: { status: "ok" },
              },
            },
          },
        },
      },
    },
    "/api/ping": {
      get: {
        summary: "Rate-limited demo endpoint",
        description:
          "Registered AFTER the limiter middleware. Admits up to the configured " +
          "limit, then returns 429. Emits the IETF `RateLimit`/`RateLimit-Policy` " +
          "headers and the legacy `X-RateLimit-*` triple on BOTH responses; the " +
          "429 adds `Retry-After`.",
        responses: {
          "200": {
            description: "Request admitted under the limit.",
            headers: rateLimitHeaders,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["pong"],
                  properties: {
                    pong: { type: "boolean", enum: [true] },
                  },
                },
                example: { pong: true },
              },
            },
          },
          "429": {
            description:
              "Request rejected — over the rate limit. The same RateLimit-* " +
              "headers are present, plus `Retry-After`.",
            headers: {
              ...rateLimitHeaders,
              "Retry-After": {
                description:
                  "Delta-seconds the client should wait before retrying (RFC 9110 §10.2.3); always ≥ 1.",
                schema: { type: "integer" },
              },
            },
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["error", "retryAfterMs"],
                  properties: {
                    error: { type: "string", enum: ["Too Many Requests"] },
                    retryAfterMs: {
                      type: "integer",
                      description: "Milliseconds until the limit resets.",
                    },
                  },
                },
                example: { error: "Too Many Requests", retryAfterMs: 60000 },
              },
            },
          },
        },
      },
    },
  },
};
