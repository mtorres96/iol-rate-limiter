---
phase: quick-260625-tce
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - rate-limiter/docs/request-flow.png
  - rate-limiter/DESIGN.md
  - rate-limiter/README.md
autonomous: true
requirements: [DOCS-DIAGRAM, DOCS-QUICKSTART]

must_haves:
  truths:
    - "The author's hand-drawn sequence diagram is committed in the repo and renders in DESIGN.md via a relative path"
    - "DESIGN.md explains the diagram in English (client GET → backend increments Redis per-window counter → 200 while counter ≤ limit → 429/Retry-After once counter exceeds limit) and notes it is hand-drawn with Spanish labels"
    - "README points readers to the request-flow diagram"
    - "README Quickstart makes explicit that one command (docker compose up --build) brings up the whole stack: app (:3000, /docs, /metrics), Redis, Prometheus (:9090), Grafana (:3001) on the pre-provisioned dashboard, with no extra setup"
    - "npm run verify still passes (no source/compose changes)"
  artifacts:
    - path: "rate-limiter/docs/request-flow.png"
      provides: "Committed copy of the author's hand-drawn sequence diagram"
    - path: "rate-limiter/DESIGN.md"
      provides: "Embedded diagram with English alt text + caption in the Request-path area"
    - path: "rate-limiter/README.md"
      provides: "Diagram pointer + explicit one-command full-stack Quickstart"
  key_links:
    - from: "rate-limiter/DESIGN.md"
      to: "rate-limiter/docs/request-flow.png"
      via: "relative markdown image"
      pattern: "\\./docs/request-flow\\.png"
---

<objective>
Add the author's own hand-drawn request-flow sequence diagram (Cliente → Backend (Typescript) → Redis) to the rate-limiter docs, and make the one-command full-stack Docker startup explicit in the README Quickstart.

Purpose: The repo's architecture docs already describe the request path in Mermaid; the author's hand-drawn diagram is the human-authored artifact that makes the per-window counter / 200→429 story tangible and shows authorship. The Quickstart should make crystal-clear that a single `docker compose up --build` brings the entire stack up working out of the box.
Output: a committed image asset at `rate-limiter/docs/request-flow.png`, a referenced + captioned embed in DESIGN.md, and a tightened README (diagram pointer + explicit one-command stack).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@rate-limiter/DESIGN.md
@rate-limiter/README.md

<notes>
- Source image (DO NOT move/delete): `/Users/manulocal/Desktop/diagrama.png` (~115 KB PNG).
- The diagram is a sequence diagram: Cliente → "Backend (Typescript)" → Redis. GET /ping increments a per-window counter in Redis (contador=0,1,2,…,n); backend returns OK/200 while `0 <= contador <= n`; when `contador = n+1 ⇒ contador > n` it returns an error for the rest of the window ("Devuelvo error por X tiempo", the red dashed 429 / Retry-After arrow). Labels are Spanish, hand-made by the author.
- DESIGN.md §1 "Architecture overview" and the README "### Request path" Mermaid block (README lines ~229–240) are the existing request-path discussions. DESIGN.md has no dedicated request-path subsection yet — add a short "## Request flow (sequence diagram)" near the architecture/request-path material (after §1 reads naturally, or as a new numbered/short subsection — keep DESIGN.md's existing numbered-section tone).
- README request-path area = the "### Request path" Mermaid block (~line 229) and the "Try it: a 200, then a 429" section (~line 36). Either is a fine anchor for the one-line pointer; keep README changes minimal.
- README Quickstart currently shows `docker compose up` (line 17). The whole-stack facts to surface are already documented piecemeal: app on :3000 with /docs + /metrics, Prometheus :9090, Grafana :3001 opening on the pre-provisioned "Rate Limiter — Allowed vs Blocked" dashboard (README "Observability / Metrics" section, lines ~83–104).
</notes>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Commit the hand-drawn diagram and embed it in DESIGN.md + point to it from README</name>
  <files>rate-limiter/docs/request-flow.png, rate-limiter/DESIGN.md, rate-limiter/README.md</files>
  <action>
    Copy the author's diagram into the repo WITHOUT touching the Desktop original:
    `mkdir -p rate-limiter/docs && cp "/Users/manulocal/Desktop/diagrama.png" rate-limiter/docs/request-flow.png`. Do NOT move or delete `/Users/manulocal/Desktop/diagrama.png`.

    In `rate-limiter/DESIGN.md`, add a short request-flow subsection that embeds the diagram via a RELATIVE markdown image pointing at `./docs/request-flow.png` (per key_links pattern — relative path, not absolute, not a `docs/`-less path). Place it in the architecture / request-path area: either immediately after §1 "Architecture overview" or as a short new "## Request flow (sequence diagram)" heading near the request-path discussion — pick the spot that reads most naturally and matches DESIGN.md's existing numbered-section tone. Give the image English alt text (e.g. "Hand-drawn sequence diagram of the rate-limiter request flow: client → backend → Redis per-window counter"). Add a 2–4 line English caption that explains: client issues GET /ping → the backend increments a per-window counter in Redis → the backend returns 200/OK while the counter is within the limit → once the counter exceeds the limit the backend returns 429 with Retry-After for the rest of the window. Note in the caption that this is the author's own hand-drawn sequence diagram and that the labels are in Spanish. Match DESIGN.md's measured, explanatory tone (no marketing).

    In `rate-limiter/README.md`, add ONE minimal pointer in the architecture / "Request path" / 200→429 area linking to the request-flow diagram — either a one-line "see the request-flow sequence diagram in [DESIGN.md](./DESIGN.md)" link, or a small re-embed of `./docs/request-flow.png` (planner's discretion; prefer the link to keep README lean). Keep README changes here to a single line/embed; do not restructure surrounding prose.

    Docs + image asset only. Do NOT edit any TS/source, docker-compose, or config files.
  </action>
  <verify>
    <automated>test -f rate-limiter/docs/request-flow.png && test -f /Users/manulocal/Desktop/diagrama.png && grep -q '\./docs/request-flow\.png' rate-limiter/DESIGN.md && grep -qi 'request[- ]flow' rate-limiter/README.md</automated>
  </verify>
  <done>`rate-limiter/docs/request-flow.png` exists; the Desktop original still exists; DESIGN.md embeds the diagram via the relative `./docs/request-flow.png` path with English alt text + a 2–4 line English caption (counter / 200→429 / Spanish-labels / author's hand-drawn note); README has a single minimal pointer to the diagram. No source/compose files changed.</done>
</task>

<task type="auto">
  <name>Task 2: Make the one-command full-stack startup explicit in the README Quickstart</name>
  <files>rate-limiter/README.md</files>
  <action>
    In the `rate-limiter/README.md` "## Quickstart — one command" section (around lines 12–32), make it explicit that a SINGLE command brings the WHOLE stack up working out of the box. Update the command to `docker compose up --build` (it builds the app image, per the existing prose) and add a concise statement that this one command starts and wires together: the demo app on http://localhost:3000 (with Swagger UI at `/docs` and Prometheus metrics at `/metrics`), Redis, Prometheus on http://localhost:9090, and Grafana on http://localhost:3001 opening DIRECTLY on the pre-provisioned "Rate Limiter — Allowed vs Blocked" dashboard — with NO extra setup, import, or manual configuration. Keep it tight (a short sentence or a 4–5 item bullet list of the access points); do not duplicate the full detail already in the "Observability / Metrics" section — a brief summary that cross-references it is enough.

    Preserve the existing Quickstart facts (two routes `GET /api/ping` rate-limited / `GET /health` not; the tiny 5-req/60s default for an easy 429). Match the README's tone. This is the "verified live already; just document it clearly" change — no behavioral claims beyond what's already true.

    README prose only. Do NOT edit any TS/source, docker-compose, or config files.
  </action>
  <verify>
    <automated>grep -q 'docker compose up --build' rate-limiter/README.md && grep -q '9090' rate-limiter/README.md && grep -q '3001' rate-limiter/README.md && grep -qi 'swagger\|/docs' rate-limiter/README.md</automated>
  </verify>
  <done>The README Quickstart explicitly states that `docker compose up --build` brings up the whole stack (app :3000 with /docs + /metrics, Redis, Prometheus :9090, Grafana :3001 on the pre-provisioned dashboard) out of the box with no extra setup. Existing route/limit facts preserved. No source/compose files changed.</done>
</task>

</tasks>

<verification>
After both tasks, confirm the docs-only constraint held and the gate is green:

```bash
cd rate-limiter && npm run verify   # tsc --noEmit && vitest run --coverage && eslint .  — must stay green (Docker daemon required)
git status --porcelain               # only rate-limiter/docs/request-flow.png, DESIGN.md, README.md should appear
```

No `.ts`, `docker-compose.yml`, or config file should appear in `git status`.
</verification>

<success_criteria>
- `rate-limiter/docs/request-flow.png` is committed; `/Users/manulocal/Desktop/diagrama.png` is untouched.
- DESIGN.md embeds the diagram via the relative `./docs/request-flow.png` path with English alt text and a 2–4 line English caption covering the per-window counter and 200→429/Retry-After behavior, noting it is the author's hand-drawn (Spanish-labeled) diagram.
- README points to the diagram and its Quickstart explicitly documents the one-command (`docker compose up --build`) full stack: app :3000 (/docs, /metrics), Redis, Prometheus :9090, Grafana :3001 on the pre-provisioned dashboard, no extra setup.
- `cd rate-limiter && npm run verify` passes; only the three target files changed.
</success_criteria>

<output>
Create `.planning/quick/260625-tce-add-author-sequence-diagram-to-docs-and-/260625-tce-SUMMARY.md` when done.
</output>
