---
phase: quick-260625-skt
plan: 01
subsystem: infra
tags: [grafana, docker-compose, observability, dashboard]

requires:
  - phase: 260625-s2j
    provides: provisioned "Allowed vs Blocked" Grafana dashboard + Prometheus/Grafana compose stack
provides:
  - "GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH on the grafana compose service so localhost:3001 lands directly on the dashboard"
affects: [demo, observability, README]

tech-stack:
  added: []
  patterns: ["Grafana default-home-dashboard via env var pointing at the already-mounted provisioned JSON (no new volume, no new file)"]

key-files:
  created: []
  modified:
    - rate-limiter/docker-compose.yml
    - rate-limiter/README.md

key-decisions:
  - "Reused the existing read-only dashboard mount path (/var/lib/grafana/dashboards/rate-limiter.json) — set home dashboard via one env var instead of provisioning config, keeping the change compose-only"

patterns-established:
  - "Single GF_* env var on the grafana service sets the landing page; volume mounts untouched"

requirements-completed: [OBS-02]

duration: 3min
completed: 2026-06-25
---

# Quick Task 260625-skt: Provisioned Grafana Dashboard as Default Home Summary

**Opening http://localhost:3001 now lands directly on the "Rate Limiter — Allowed vs Blocked" dashboard via one `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH` env var pointing at the already-mounted JSON — no app/TS change, verify gate stays green.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-25T20:35:00Z
- **Completed:** 2026-06-25T20:38:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /var/lib/grafana/dashboards/rate-limiter.json` to the `grafana` service `environment:` block in `rate-limiter/docker-compose.yml`, with an inline comment explaining it makes the provisioned dashboard the landing page.
- The two existing `GF_AUTH_ANONYMOUS_*` env vars and all Grafana volume mounts are unchanged — the path reuses the existing `./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro` read-only mount (verified the mounted JSON is named `rate-limiter.json`).
- Reworded the README "Observability / Metrics" Grafana bullet to note Grafana opens **directly** on the "Rate Limiter — Allowed vs Blocked" dashboard as its home page, with no manual navigation.

## Verification

- `cd rate-limiter && docker compose config --quiet` → exit 0 (CONFIG_OK)
- `docker compose config | grep GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH.*rate-limiter.json` → resolves (ENV_RESOLVED_OK)
- README landing-page wording present (README_OK)
- `cd rate-limiter && npm run verify` → green: 20 test files / 135 tests pass, 100% statements, lint clean (no app/TS regression)

## Deviations from Plan

None - plan executed exactly as written.

## Commits

- `014aabc`: feat(quick-260625-skt): set provisioned dashboard as Grafana home

## Self-Check: PASSED

- FOUND: rate-limiter/docker-compose.yml (modified, GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH present)
- FOUND: rate-limiter/README.md (modified, direct-landing wording present)
- FOUND: commit 014aabc
