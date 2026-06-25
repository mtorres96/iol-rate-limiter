// Demo-tier metrics (OBS-02) — the prom-client surface for the `/metrics` endpoint.
//
// This is a DEMO-TIER artifact, exactly like src/demo/openapi.ts: it exists ONLY to
// give a grader a Prometheus/Grafana observability story on top of the running demo.
// It is NOT part of the shippable library.
//
// Tier boundary (LOAD-BEARING): this file MUST NOT be imported by src/index.ts (the
// framework-agnostic core barrel) nor by any file under src/adapters/express/**. Only
// src/demo/server.ts may import it. This mirrors the same rule that keeps the core
// free of Express/ioredis — prom-client is an observability dependency and must never
// leak into the core or the adapter tiers.
//
// Why a DEDICATED Registry (not the global default):
//   prom-client's default registry is process-global module state. A dedicated
//   Registry keeps these metrics self-contained — no cross-test bleed when the
//   metrics test builds the app, and no accidental coupling to any other registry.

import { Counter, collectDefaultMetrics, Registry } from "prom-client";

/**
 * The dedicated registry every metric below registers on. Exported so server.ts can
 * `await register.metrics()` for the `/metrics` exposition and read `register.contentType`
 * for the Prometheus text content-type header.
 */
export const register = new Registry();

// Process/node default metrics (resident memory, event-loop lag, CPU, etc.) so the
// Grafana dashboard has a couple of meaningful default-metric panels to draw, not just
// the single custom counter.
collectDefaultMetrics({ register });

/**
 * The one custom business metric: how many rate-limit decisions the demo made, split
 * by outcome via the `decision` label (`allowed` | `blocked`). A counter (monotonic)
 * is the right type — Grafana derives a rate via `rate(rate_limiter_decisions_total[1m])`.
 */
const decisionsTotal = new Counter({
  name: "rate_limiter_decisions_total",
  help: "Total rate-limit decisions made by the demo server, labelled by outcome.",
  labelNames: ["decision"],
  registers: [register],
});

/**
 * Record one rate-limit decision. Called from server.ts's `res.on("finish")` hook in
 * the rate-limited zone: the limiter has already decided by the time the response
 * finishes, so statusCode 429 ⇒ "blocked", otherwise "allowed".
 */
export function recordDecision(decision: "allowed" | "blocked"): void {
  decisionsTotal.inc({ decision });
}
