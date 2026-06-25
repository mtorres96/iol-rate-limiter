# Phase 5: Quality, Swagger & Exercise Compliance - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

A grading-hardening pass over a feature-complete deliverable (Phases 1–4 done: core
algorithms, Redis/Lua store, Express adapter, demo + Docker + DESIGN.md). This phase delivers:

1. **A coverage gate** — raise core/store/adapter coverage to ≥95% and enforce it in the green gate.
2. **API documentation** — a hand-written OpenAPI 3 spec served via Swagger UI on the demo server.
3. **A skill-assisted re-audit** — code quality / design-pattern / Docker review, with material
   fixes applied and the rest logged.
4. **A targeted documentation pass** — ensure non-obvious code is hand-commented and interview-defensible.
5. **A compliance artifact** — `COMPLIANCE.md` mapping every challenge-brief item to repo evidence.

**In scope:** test-health verification, coverage threshold + remediation, OpenAPI/Swagger on the
demo, audit + material fixes, targeted doc comments, COMPLIANCE.md, README/DESIGN.md updates.

**Not in scope (defer / out):** new demo endpoints or features; logging/metrics (OBS-01/02 are v2);
new algorithms or stores; any change that adds capability rather than hardening what exists.

**Key finding — gap audit is confirmatory:** The "updated" brief PDF (`iol-challenge-actualizado (1).pdf`,
`Version: 89f729a`) is **identical** to the brief already captured in PROJECT.md (same Rules,
Focus-on, Nice-to-haves, submission shape). No new requirements were introduced. The gap audit
confirms compliance; it does not add scope.

</domain>

<decisions>
## Implementation Decisions

### Coverage Target & Gate
- **D-01:** The ≥95% target is measured over **testable logic only**: `src/limiters/*`,
  `src/store/*` (memory, redis, breaker), `src/validate.ts`, `src/clock.ts`, and
  `src/adapters/express/*`. **Exclude** the demo server (`src/demo/**`), barrels (`src/index.ts`,
  adapter `index.ts`), and `.lua` files (exercised indirectly via Redis integration tests).
- **D-02:** Enforce the target as a **hard gate** via `coverage.thresholds` in `vitest.config.ts`
  on **all four metrics** — lines, statements, functions, and branches ≥ 95.
- **D-03:** Wire it as a **single green gate**: `npm run verify` = typecheck + coverage run (the
  Redis suites already run under `test`, so instrumentation adds little beyond the existing cost).
  No separate coverage command needed.
- **D-04:** **Branch-coverage policy:** prefer covering defensive paths with a **real test**
  (fault-injection / throwing stub) first. Only when a branch is genuinely unreachable, allow a
  `/* v8 ignore */` pragma **with a one-line justification comment**. Ignore pragmas are the last
  resort, not the default.

### Swagger / OpenAPI
- **D-05:** **Include** API docs — it strengthens a rate-limiter demo by making the 200→429 +
  `RateLimit-*` header semantics interactively visible.
- **D-06:** **Hand-write a static OpenAPI 3 spec** (YAML or a typed TS object) as the
  version-controlled, line-by-line-understood source of truth — **no decorator/codegen toolchain**
  (avoid machinery + un-owned JSDoc for ~2 endpoints).
- **D-07:** Serve it with **`swagger-ui-express` at `/docs`** on the demo server; add as a
  **demo-only dependency**. Document the existing endpoints (`/health`, `/api/ping`) including the
  200/429 responses and rate-limit headers. Do **not** add new endpoints.
- **D-08:** **Test the new surface:** a supertest asserting `GET /docs` (and the served spec JSON)
  returns 200, **plus** a structural-validity check of the OpenAPI document. Keeps `/docs` inside
  the green gate so a broken spec can't ship in the graded demo.

### Audit Disposition & Artifacts
- **D-09:** **Fix material findings only** — correctness, security, and clear APOSD/readability
  wins. Everything else (stylistic, speculative, "could refactor") is **recorded with a rationale
  for not acting**. Avoids over-refactoring working, tested code right before submission.
- **D-10:** Produce **`rate-limiter/COMPLIANCE.md`** (alongside DESIGN.md, inside the submission
  folder): a mapping table from every brief item — each "Focus on" MUST and each "Nice to have" —
  to concrete repo evidence (file / test / doc section), plus the audit findings and their
  disposition.

### Documentation Pass
- **D-11:** **Targeted** doc-comment pass — audit every source file but only add/upgrade comments
  where intent is **non-obvious**: Lua atomicity contracts, sliding-window math, fixed-window
  boundary-burst, breaker / fail-open-vs-closed policy, OpTuple rounding parity. Leave trivial
  getters / barrels / self-evident code clean (the brief itself warns against comment-slop).

### Docs Surface
- **D-12:** Update **both** README and DESIGN.md: add a coverage statement/badge + `/docs` link to
  README; add a short DESIGN.md note covering the Swagger decision and the audit's material fixes —
  so the docs a grader opens first reflect the hardened state.

### Claude's Discretion
- Exact choice of which Claude skills to install/apply for the audit (code-quality, design-patterns,
  docker-expert, documentation-writer) and the order of the audit lenses.
- File format of the OpenAPI source (YAML file vs typed TS object) within D-06's hand-written constraint.
- Whether `COMPLIANCE.md` is generated before or after the audit fixes (must reflect final state).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Challenge brief (compliance target)
- `iol-challenge-actualizado (1).pdf` (repo root) — the updated brief, `Version: 89f729a`.
  Confirmed identical to the brief in PROJECT.md. Source of the "Focus on" MUSTs and "Nice to have"
  items that `COMPLIANCE.md` must map to evidence.

### Project decisions & requirements
- `.planning/PROJECT.md` — Core Value, grading focus (APOSD, avoid overengineering/AI-slop),
  nice-to-haves, out-of-scope boundaries.
- `.planning/REQUIREMENTS.md` — v1 requirement IDs (CORE/ALGO/STOR/DEF/HTTP/TEST/DELIV) and the
  v2-deferred OBS-01/02 (logging/metrics — NOT this phase).
- `.planning/ROADMAP.md` §"Phase 5" — phase goal and the four work components.

### Existing deliverable docs (to update)
- `rate-limiter/DESIGN.md` — Phase-4 architecture/trade-offs/AI-usage doc; add Swagger + audit note (D-12).
- `rate-limiter/README.md` — add coverage statement + `/docs` link (D-12).

### Code anchors for coverage & doc-comment work
- `rate-limiter/vitest.config.ts` — where `coverage.thresholds` get added (D-02).
- `rate-limiter/package.json` — `verify` script wiring (D-03).
- `rate-limiter/src/demo/server.ts` — where the `/docs` route + OpenAPI spec mount (D-05..D-08).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/demo/server.ts` — env-driven demo (store + limiter chosen by env), exposes `/health` and
  `/api/ping`; the mount point for Swagger UI and the endpoints the OpenAPI spec documents.
- `test/demo.test.ts` + `test/build-smoke.test.ts` — existing supertest/smoke patterns to extend
  for the `/docs` + spec-validity test (D-08).
- `test/fault-injection.test.ts`, `test/breaker.test.ts`, `test/degraded.test.ts` — existing
  throwing-stub / down-slow-Redis harnesses to reuse for covering defensive branches (D-04).
- `vitest.config.ts` — already v8 coverage with `include: ['src/**']`; needs `thresholds` + the
  exclude list from D-01.

### Established Patterns
- Express adapter treats `express` as a peer; the **demo** uses express (and now swagger-ui-express)
  at runtime — keep new docs deps demo-scoped, out of the core/adapter tiers.
- `fileParallelism: false` + bumped timeouts already accommodate Docker-backed suites; coverage
  instrumentation must not break that.
- APOSD / anti-slop is the dominant grading lens — every added dep, comment, and test must earn
  its place (drives D-06, D-09, D-11).

### Integration Points
- Swagger UI mounts on the existing Express demo app; OpenAPI spec is a new static artifact under
  the demo.
- Coverage thresholds integrate into the existing `verify` green gate (mandatory at every milestone).
- The Docker image (Phase 4, multi-stage `node:24-alpine`) must still build/run with the `/docs`
  route present — verify the demo-only dep is in the runtime stage as needed.

</code_context>

<specifics>
## Specific Ideas

- The OpenAPI spec should make the **rate-limiting behavior itself** legible — i.e. document the
  `429` response and the `RateLimit` / `RateLimit-Policy` / legacy `X-RateLimit-*` headers, not just
  happy-path 200s. That's the part that showcases the project.
- COMPLIANCE.md should be scannable as a **table**: brief item → evidence (path/test/section) →
  status, so a grader confirms coverage at a glance.

</specifics>

<deferred>
## Deferred Ideas

- **Logging (pino) / metrics (prom-client)** — OBS-01/02, explicitly v2. A grader-facing "nice to
  have," but PROJECT.md defers it; do not pull into this phase.
- **Richer/additional demo endpoints** to make rate-limiting more demonstrable — adding endpoints is
  capability creep; document the existing endpoints only. Revisit only if a future phase expands the demo.
- **CI pipeline / coverage badge automation** — the coverage *number* is in scope (D-12); standing up
  CI to publish a live badge is its own concern, not required for the graded submission.

</deferred>

---

*Phase: 5-quality-swagger-compliance*
*Context gathered: 2026-06-25*
