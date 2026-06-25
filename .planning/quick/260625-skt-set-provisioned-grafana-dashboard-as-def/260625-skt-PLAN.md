---
phase: quick-260625-skt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - rate-limiter/docker-compose.yml
  - rate-limiter/README.md
autonomous: true
requirements: [OBS-02]
must_haves:
  truths:
    - "Opening http://localhost:3001 lands directly on the 'Rate Limiter — Allowed vs Blocked' dashboard instead of Grafana's generic home page"
    - "docker compose config resolves the grafana service cleanly (exit 0)"
    - "npm run verify still passes (no app/TS regression)"
  artifacts:
    - path: "rate-limiter/docker-compose.yml"
      provides: "GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH env var on the grafana service"
      contains: "GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH"
    - path: "rate-limiter/README.md"
      provides: "Updated Grafana bullet noting the dashboard is now the landing page"
  key_links:
    - from: "rate-limiter/docker-compose.yml grafana env"
      to: "/var/lib/grafana/dashboards/rate-limiter.json"
      via: "GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH pointing at the already-mounted JSON"
      pattern: "GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH:.*rate-limiter.json"
---

<objective>
Make the provisioned Grafana dashboard the default home dashboard, so opening
http://localhost:3001 lands directly on "Rate Limiter — Allowed vs Blocked"
instead of Grafana's generic home page.

Purpose: Removes a manual-navigation step in the demo — reviewers see the
allowed/blocked panel immediately on first load, reinforcing the OBS-02 metrics
deliverable.

Output: One new env var on the grafana compose service + a concise README tweak.
Compose + docs only — no app/TS changes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# The grafana service already mounts the dashboard JSON read-only at the path
# referenced below. Do NOT touch the volume mounts.
@rate-limiter/docker-compose.yml
@rate-limiter/README.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Set provisioned dashboard as Grafana default home + document it</name>
  <files>rate-limiter/docker-compose.yml, rate-limiter/README.md</files>
  <action>
    In rate-limiter/docker-compose.yml, add ONE env var to the `grafana` service's
    existing `environment:` block (keep `GF_AUTH_ANONYMOUS_ENABLED` and
    `GF_AUTH_ANONYMOUS_ORG_ROLE` exactly as-is):

      GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /var/lib/grafana/dashboards/rate-limiter.json

    Add a short trailing inline comment explaining it makes the provisioned dashboard
    the landing page (e.g. "Open the provisioned dashboard as the home page instead of
    Grafana's generic home"). That path is ALREADY where the JSON is mounted inside the
    container via the existing `./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro`
    volume — do NOT change, add, or rename any volume mount.

    In rate-limiter/README.md, in the existing "Observability / Metrics" section
    (around line 96), tweak the **Grafana** bullet to note it now opens DIRECTLY on the
    "Rate Limiter — Allowed vs Blocked" dashboard at http://localhost:3001 with no manual
    navigation. Keep it concise — adjust the existing bullet wording only; do not add new
    bullets or touch COMPLIANCE/DESIGN (those already cover metrics).
  </action>
  <verify>
    <automated>cd rate-limiter && docker compose config --quiet && docker compose config | grep -q 'GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH.*rate-limiter.json' && grep -qi 'directly\|landing\|home dashboard\|opens' README.md && npm run verify</automated>
  </verify>
  <done>
    docker compose config exits 0 and resolves GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH
    pointing at /var/lib/grafana/dashboards/rate-limiter.json on the grafana service;
    README Grafana bullet states the dashboard is the direct landing page; volume mounts
    unchanged; npm run verify passes (no regression).
  </done>
</task>

</tasks>

<verification>
- `cd rate-limiter && docker compose config --quiet` exits 0
- The grafana service resolves `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /var/lib/grafana/dashboards/rate-limiter.json`
- The two `GF_AUTH_ANONYMOUS_*` env vars and all volume mounts are unchanged
- `cd rate-limiter && npm run verify` passes (typecheck + coverage + lint green)
- README "Observability / Metrics" Grafana bullet notes the direct landing on the dashboard
</verification>

<success_criteria>
- Opening http://localhost:3001 lands directly on "Rate Limiter — Allowed vs Blocked"
- No app/TS code changed; verify gate stays green
- Docs reflect the new behavior concisely
</success_criteria>

<output>
Create `.planning/quick/260625-skt-set-provisioned-grafana-dashboard-as-def/260625-skt-SUMMARY.md` when done
</output>
