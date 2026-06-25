---
phase: quick-260625-s2j
plan: 01
subsystem: demo-observability
tags: [metrics, prom-client, prometheus, grafana, docker-compose, demo-tier, OBS-02]
requires:
  - rate-limiter/src/demo/server.ts (composition root)
  - rate-limiter/docker-compose.yml (app + redis services)
provides:
  - GET /metrics endpoint (Prometheus text exposition, unlimited zone)
  - rate_limiter_decisions_total{decision} counter
  - Prometheus + Grafana observability stack via compose
affects:
  - rate-limiter/src/demo/server.ts
  - rate-limiter/docker-compose.yml
  - rate-limiter/COMPLIANCE.md (Metrics row: Deferred → Delivered)
tech-stack:
  added:
    - prom-client@^15.1.3 (runtime dependency, demo-tier)
    - prom/prometheus:v2.55.1 (compose image)
    - grafana/grafana:11.3.0 (compose image)
  patterns:
    - Demo-tier-only observability: prom-client confined to src/demo/** (mirrors the
      ioredis/Express tier boundary that keeps the core framework-agnostic)
    - Dedicated prom-client Registry (not the global default) to avoid cross-test bleed
    - res.on("finish") decision hook records allowed/blocked outside the response hot path
key-files:
  created:
    - rate-limiter/src/demo/metrics.ts
    - rate-limiter/monitoring/prometheus.yml
    - rate-limiter/monitoring/grafana/provisioning/datasources/prometheus.yml
    - rate-limiter/monitoring/grafana/provisioning/dashboards/dashboards.yml
    - rate-limiter/monitoring/grafana/dashboards/rate-limiter.json
    - rate-limiter/test/metrics.test.ts
  modified:
    - rate-limiter/package.json
    - rate-limiter/package-lock.json
    - rate-limiter/src/demo/server.ts
    - rate-limiter/docker-compose.yml
    - rate-limiter/README.md
    - rate-limiter/COMPLIANCE.md
    - rate-limiter/DESIGN.md
decisions:
  - "prom-client in dependencies (not devDependencies) — Docker runtime runs npm ci --omit=dev"
  - "Grafana host port 3001 (container 3000) because the app owns host port 3000"
  - "Dedicated Registry over global default registry to prevent cross-test state bleed"
  - "Pinned all new compose image tags (prometheus v2.55.1, grafana 11.3.0) for reproducibility"
metrics:
  duration: 4 min
  completed: 2026-06-25
---

# Quick Task 260625-s2j: Add prom-client Metrics Endpoint + Prometheus/Grafana Stack Summary

Delivered OBS-02 at the demo tier: a prom-client `/metrics` endpoint counting allowed-vs-blocked
rate-limit decisions, plus a Prometheus + Grafana observability stack via docker-compose with a
pre-provisioned dashboard — all confined to `src/demo/**` so the framework-agnostic core stays
prom-client-free.

## What Was Built

**Task 1 — App metrics (demo tier).** Installed `prom-client@^15.1.3` into runtime `dependencies`.
Created `src/demo/metrics.ts`: a dedicated `Registry`, `collectDefaultMetrics` (process/node
defaults), a `rate_limiter_decisions_total` counter labelled by `decision`, and a `recordDecision`
helper. Wired `server.ts` — imported `{ register, recordDecision }`, added `GET /metrics` in the
**unlimited zone** (alongside `/health` and `/docs`, before `app.use(rateLimit(...))`) serving
`register.metrics()` with `register.contentType`, and added a `res.on("finish")` decision hook in
the rate-limited zone (statusCode `429` ⇒ `blocked`, else `allowed`).

**Task 2 — Observability stack + test.** Extended `docker-compose.yml` with pinned `prometheus`
(`v2.55.1`, host `:9090`) and `grafana` (`11.3.0`, host `:3001` → container 3000, anonymous Viewer)
services. Created the `monitoring/` provisioning tree: `prometheus.yml` (scrapes `app:3000/metrics`
every 5s), a Grafana Prometheus datasource, a file dashboard provider, and a valid
`rate-limiter.json` dashboard ("Allowed vs Blocked" via `rate(rate_limiter_decisions_total[1m])`
by `{{decision}}`, plus resident-memory and event-loop-lag default-metric panels). Added
`test/metrics.test.ts` asserting 200 + Prometheus content-type + counter name + the never-429
unlimited-zone property.

**Task 3 — Docs.** README gained an "Observability / Metrics" subsection listing all three access
points and the demo-tier caveat. COMPLIANCE §3 Metrics row flipped from "⏸️ Deferred (v2)" to
"✅ Delivered" with real artifact evidence; the Honesty note now scopes deferral to logging only;
Logging stays deferred. DESIGN §8 notes demo-tier metrics without core leakage; the §9 scope line
updated for consistency.

## Verification

- `cd rate-limiter && npm run verify` → green: typecheck clean, **134 tests pass** (20 files,
  including the 2 new metrics tests), coverage gate held (100% stmts / 98.4% branches / 100% funcs
  / 100% lines), `eslint .` exits 0.
- Tier boundary: `grep -rl "prom-client" src/index.ts src/store src/adapters` → nothing.
- `docker compose config --quiet` → exit 0 with prometheus (:9090) + grafana (host :3001).
- Dashboard JSON parses; `monitoring/prometheus.yml` targets `app:3000`; compose maps `3001:3000`.

## Commits

- `0b42f74` feat(quick-260625-s2j): add demo-tier prom-client /metrics endpoint
- `4ecb1be` feat(quick-260625-s2j): add prometheus+grafana stack and metrics test
- `fb1efce` docs(quick-260625-s2j): document demo-tier metrics access points

## Deviations from Plan

None — plan executed exactly as written. prom-client is pre-vetted (CLAUDE.md recommended stack),
so no package-legitimacy checkpoint was raised, per the plan's explicit instruction.

## Self-Check: PASSED

- FOUND: rate-limiter/src/demo/metrics.ts
- FOUND: rate-limiter/monitoring/prometheus.yml
- FOUND: rate-limiter/monitoring/grafana/provisioning/datasources/prometheus.yml
- FOUND: rate-limiter/monitoring/grafana/provisioning/dashboards/dashboards.yml
- FOUND: rate-limiter/monitoring/grafana/dashboards/rate-limiter.json
- FOUND: rate-limiter/test/metrics.test.ts
- FOUND commit: 0b42f74
- FOUND commit: 4ecb1be
- FOUND commit: fb1efce
