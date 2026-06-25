# Phase 5: Quality, Swagger & Exercise Compliance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 05-quality-swagger-compliance
**Areas discussed:** Coverage target & gate, Swagger/OpenAPI scope, Audit disposition & artifacts, AI-slop/comment pass, Coverage branch policy, Swagger testing, Docs surface

---

## Coverage scope

| Option | Description | Selected |
|--------|-------------|----------|
| Core algos + store + adapter | limiters/* + store/* + validate/clock + adapters/express/*; exclude demo, barrels, .lua | ✓ |
| Core algorithms only | 95% bar narrowly on limiters/* + validate/clock; adapters/store measured not gated | |
| Entire src/** | Gate the whole tree incl. demo server + barrels | |

**User's choice:** Core algos + store + adapter
**Notes:** Most honest "is the core tested" signal; avoids low-value barrel/demo lines dragging the number and inviting test-for-coverage's-sake.

---

## Coverage gate metrics

| Option | Description | Selected |
|--------|-------------|----------|
| Hard gate, lines+branches | coverage.thresholds ≥95 on lines/statements/branches/functions; verify runs coverage | ✓ |
| Hard gate, lines only | Lines/statements/functions gated; branches report-only | |
| Measure & report only | Document the number, don't fail the build | |

**User's choice:** Hard gate, lines+branches
**Notes:** Matches the "mandatory gate every milestone" constraint; strongest grading signal.

---

## Coverage gate wiring

| Option | Description | Selected |
|--------|-------------|----------|
| Coverage in verify | npm run verify = typecheck + coverage; single source of truth | ✓ |
| Separate coverage gate | verify stays fast; distinct coverage gate run explicitly | |
| You decide at planning | Defer script wiring; lock only "enforced somewhere in green gate" | |

**User's choice:** Coverage in verify
**Notes:** Redis suites already run under test, so coverage adds little beyond instrumentation; one gate everyone trusts.

---

## Swagger/OpenAPI inclusion

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, minimal OpenAPI + UI | Hand-written OpenAPI 3 for demo endpoints, swagger-ui at /docs, README link | ✓ |
| Spec file only, no UI | openapi.yaml referenced in DESIGN.md, no /docs route | |
| Skip it | Two trivial endpoints don't justify Swagger | |

**User's choice:** Yes, minimal OpenAPI + UI
**Notes:** Makes the 200/429 + RateLimit-header behavior interactively visible — a real strength for a rate-limiter demo.

---

## Swagger authoring mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Static spec + swagger-ui-express | Hand-written static spec as source of truth; swagger-ui-express at /docs | ✓ |
| Decorator/code-generated | swagger-jsdoc generation from route annotations | |
| You decide at planning | Lock minimal+/docs, defer mechanism | |

**User's choice:** Static spec + swagger-ui-express
**Notes:** Spec is reviewable, version-controlled, understood line-by-line; avoids a generation toolchain for ~2 endpoints.

---

## Audit finding disposition

| Option | Description | Selected |
|--------|-------------|----------|
| Fix material-only + log rest | Fix correctness/security/clear-APOSD wins; record the rest with rationale | ✓ |
| Fix everything found | Resolve every finding | |
| Audit-only, defer fixes | Report only, no code changes this phase | |

**User's choice:** Fix material-only + log rest
**Notes:** Avoids over-refactoring working/tested code right before submission; demonstrates judgment.

---

## Compliance artifact

| Option | Description | Selected |
|--------|-------------|----------|
| COMPLIANCE.md mapping table | Brief item → repo evidence + audit dispositions, standalone | ✓ |
| Fold into DESIGN.md | Add compliance + audit sections to DESIGN.md | |
| No standalone artifact | Let code/tests/DESIGN speak for themselves | |

**User's choice:** COMPLIANCE.md mapping table
**Notes:** One scannable artifact under /rate-limiter; grader confirms full coverage at a glance.

---

## Documentation pass rigor

| Option | Description | Selected |
|--------|-------------|----------|
| Targeted: non-obvious only | Comment Lua atomicity, sliding-window math, boundary-burst, breaker/policy, rounding; leave trivial clean | ✓ |
| Exhaustive: every export | Doc comment on every export regardless of obviousness | |
| Spot-check only | Assume Phases 1-4 adequate; verify a few hotspots | |

**User's choice:** Targeted: non-obvious only
**Notes:** Matches the brief's "better to write a few yourself than slop over every function."

---

## Coverage branch policy

| Option | Description | Selected |
|--------|-------------|----------|
| Prefer real test, ignore as last resort | Cover defensive paths with real tests; allow /* v8 ignore */ + justification only when truly unreachable | ✓ |
| No ignore comments allowed | Forbid ignore pragmas entirely | |
| You decide at planning | Lock threshold, defer handling | |

**User's choice:** Prefer real test, ignore as last resort
**Notes:** Pragmatic + honest; defensive paths covered via existing fault-injection/throwing-stub harnesses.

---

## Swagger testing

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — validate spec + smoke /docs | supertest GET /docs 200 + structural OpenAPI validity check | ✓ |
| Smoke route only | Assert /docs 200; skip schema validation | |
| No test | Manual check only | |

**User's choice:** Yes — validate spec + smoke /docs
**Notes:** Keeps the new surface inside the green gate; prevents a broken /docs or malformed spec shipping.

---

## Docs surface

| Option | Description | Selected |
|--------|-------------|----------|
| Both: README + DESIGN note | Coverage badge + /docs link in README; Swagger + audit note in DESIGN.md | ✓ |
| README only | Update README; leave DESIGN.md as-is | |
| COMPLIANCE.md only | All Phase-5 narrative in COMPLIANCE.md | |

**User's choice:** Both: README + DESIGN note
**Notes:** Keeps the docs a grader opens first reflecting the hardened state (coverage gate + /docs).

---

## Claude's Discretion

- Which Claude skills to install/apply for the audit and the order of audit lenses.
- OpenAPI source file format (YAML file vs typed TS object) within the hand-written constraint.
- Whether COMPLIANCE.md is generated before or after audit fixes (must reflect final state).

## Deferred Ideas

- Logging (pino) / metrics (prom-client) — OBS-01/02, v2, explicitly out of this phase.
- Richer/additional demo endpoints — capability creep; document existing endpoints only.
- CI pipeline / live coverage badge automation — coverage number is in scope, CI is not required.
