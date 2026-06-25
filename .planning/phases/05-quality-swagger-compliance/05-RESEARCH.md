# Phase 5: Quality, Swagger & Exercise Compliance - Research

**Researched:** 2026-06-25
**Domain:** Test-coverage hardening (Vitest 4.1 / v8), API documentation (OpenAPI 3 + swagger-ui-express on Express 5), grading-compliance audit
**Confidence:** HIGH (codebase findings + live coverage run are direct measurements; external package facts verified against npm registry + official docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Coverage Target & Gate**
- **D-01:** ≥95% measured over **testable logic only**: `src/limiters/*`, `src/store/*` (memory, redis, breaker), `src/validate.ts`, `src/clock.ts`, `src/adapters/express/*`. **Exclude** the demo server (`src/demo/**`), barrels (`src/index.ts`, adapter `index.ts`), and `.lua` files.
- **D-02:** Enforce as a **hard gate** via `coverage.thresholds` in `vitest.config.ts` on **all four metrics** — lines, statements, functions, branches ≥ 95.
- **D-03:** Wire as a **single green gate**: `npm run verify` = typecheck + coverage run. No separate coverage command needed.
- **D-04:** **Branch-coverage policy:** prefer covering defensive paths with a **real test** (fault-injection / throwing stub) first. Only when a branch is genuinely unreachable, allow a `/* v8 ignore */` pragma **with a one-line justification comment**. Ignore pragmas are last resort.

**Swagger / OpenAPI**
- **D-05:** **Include** API docs — makes the 200→429 + `RateLimit-*` header semantics interactively visible.
- **D-06:** **Hand-write a static OpenAPI 3 spec** (YAML or a typed TS object), version-controlled, line-by-line-understood — **no decorator/codegen toolchain**.
- **D-07:** Serve with **`swagger-ui-express` at `/docs`** on the demo server; add as a **demo-only dependency**. Document existing endpoints (`/health`, `/api/ping`) including 200/429 responses and rate-limit headers. Do **not** add new endpoints.
- **D-08:** **Test the new surface:** a supertest asserting `GET /docs` (and the served spec JSON) returns 200, **plus** a structural-validity check of the OpenAPI document. Keeps `/docs` inside the green gate.

**Audit Disposition & Artifacts**
- **D-09:** **Fix material findings only** — correctness, security, clear APOSD/readability wins. Everything else recorded with a rationale for not acting.
- **D-10:** Produce **`rate-limiter/COMPLIANCE.md`** (alongside DESIGN.md): a mapping table from every brief item ("Focus on" MUST + "Nice to have") to concrete repo evidence (file / test / doc section), plus audit findings and their disposition.

**Documentation Pass**
- **D-11:** **Targeted** doc-comment pass — add/upgrade comments only where intent is **non-obvious** (Lua atomicity, sliding-window math, fixed-window boundary-burst, breaker policy, OpTuple rounding parity). Leave trivial code clean.

**Docs Surface**
- **D-12:** Update **both** README and DESIGN.md: coverage statement/badge + `/docs` link to README; short DESIGN.md note on the Swagger decision and the audit's material fixes.

### Claude's Discretion
- Which Claude skills to install/apply for the audit (code-quality, design-patterns, docker-expert, documentation-writer) and the order of audit lenses.
- File format of the OpenAPI source (YAML file vs typed TS object) within D-06's hand-written constraint.
- Whether `COMPLIANCE.md` is generated before or after the audit fixes (must reflect final state).

### Deferred Ideas (OUT OF SCOPE)
- **Logging (pino) / metrics (prom-client)** — OBS-01/02, explicitly v2. Do NOT pull into this phase.
- **Richer/additional demo endpoints** — capability creep; document existing endpoints only.
- **CI pipeline / coverage badge automation** — the coverage *number* is in scope (D-12); standing up CI to publish a live badge is not.
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 5 has no net-new v1 requirement IDs (Phases 1–4 cover CORE/ALGO/STOR/DEF/HTTP/TEST/DELIV). It hardens against three derived thrusts, each grounded in an existing requirement family:

| ID (derived) | Description | Research Support |
|----|-------------|------------------|
| QUAL-COV | ≥95% coverage on testable logic (D-01), hard-gated on all four metrics (D-02), wired into `verify` (D-03) | Live coverage run: current scoped numbers are 96.31% stmts / 88.18% branches / 100% funcs / 96.13% lines. **Branches is the only failing metric.** Exact uncovered branches enumerated below (Coverage Gap Analysis). All reachable via simple construction/stub tests. |
| QUAL-DOC | OpenAPI 3 spec + Swagger UI at `/docs` (D-05..D-08) | `swagger-ui-express@5.0.1` verified, Express-5 peer support confirmed. Mount pattern + raw-spec-route pattern + Docker runtime-dep constraint documented below. |
| QUAL-AUDIT | Skill-assisted audit + COMPLIANCE.md mapping brief→evidence (D-09/D-10) | Brief PDF confirmed identical to PROJECT.md (`Version: 89f729a`). Concrete audit findings already surfaced (eslint error + 2 stale disable directives). COMPLIANCE.md target table enumerated. |
| QUAL-DOCS | README coverage statement + `/docs` link; DESIGN.md Swagger + audit note (D-12); targeted comments (D-11) | Existing README/DESIGN.md confirmed present; code already heavily commented — D-11 is a targeted top-up, not a rewrite. |

REQUIREMENTS.md note: **OBS-01/02 (logging/metrics) are v2-deferred and OUT of scope.** All other v1 IDs are already complete (Phases 1–4).
</phase_requirements>

## Summary

Phase 5 is a hardening pass on a feature-complete deliverable. The single most valuable
finding is **the live coverage run**: with D-01's exact scope (testable logic only, demo + barrels + `.lua`
excluded), the codebase is already at **96.31% statements / 88.18% branches / 100% functions / 96.13% lines**.
**Branch coverage is the only metric below the 95% gate.** The 12-or-so uncovered branches are
concentrated in a handful of known, *reachable* defensive arms — the `throw` arms of three
`validate.ts` guards, `RedisStore.connect()` (the batteries-included static factory), one
`headers.ts` IETF-mode branch + the `windowSeconds` ternary, the `middleware.ts` missing-limiter
`TypeError` arm, and one sliding-window `prev > 0` else branch. Almost all are coverable with
short construction/stub tests; at most one or two may justify a `/* v8 ignore … -- @preserve */`
pragma (D-04).

A critical mechanical fact: **v8 global thresholds count every included file**, so D-01's
`coverage.exclude` list is mandatory, not cosmetic — and **the `.lua` files MUST be excluded
because rolldown (the v8 remapper) cannot parse Lua and throws `PARSE_ERROR` on every `.lua`
file** during the coverage run today. The demo (`server.ts`, 50% lines) would also crater the
gate if left in scope.

For Swagger: `swagger-ui-express@5.0.1` (4.58M weekly downloads, no postinstall) declares Express
peer `>=4.0.0 || >=5.0.0-beta` and works with the standard `app.use('/docs', serve, setup(spec))`
prefix mount — no bare-wildcard route, so the Express-5 `path-to-regexp@8` wildcard breaking change
does **not** bite. A hand-written OpenAPI 3 object (D-06) avoids any codegen. **Docker constraint:**
the runtime stage runs `npm ci --omit=dev`, so swagger-ui-express must be a production
`dependency` (joining `express`/`ioredis`), NOT a devDependency, or `/docs` MODULE_NOT_FOUNDs in
the container.

**Primary recommendation:** Drive the gate green by *closing real branches with small tests*,
not by lowering scope or sprinkling ignore pragmas; add swagger-ui-express as a runtime dependency
with a hand-written OpenAPI 3 object served at `/docs`; produce COMPLIANCE.md from the (already
near-complete) brief→evidence map; and fix the two concrete lint findings already surfaced.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Coverage threshold gate | Build/test config (`vitest.config.ts`, `package.json`) | — | A test-tooling concern; no source code changes the gate, only config + new tests. |
| New branch-covering tests | Test tier (`test/**`) | — | Tests exercise existing source through public seams; no production source change to *reach* coverage (only to *fix* genuine bugs the audit finds). |
| OpenAPI spec authoring | Demo tier (`src/demo/**`) | — | The spec describes the demo's HTTP surface; it is demo-only and must NOT leak into the core (`src/index.ts`) or adapter (`src/adapters/express/**`) tiers. |
| Swagger UI mount (`/docs`) | Demo tier (`src/demo/server.ts`) | — | The composition root is the only module allowed to add runtime HTTP routes; mirrors how it already mounts `rateLimit`. |
| `/docs` + spec-validity test | Test tier (`test/**`) | — | Extends the existing supertest pattern (`test/demo.test.ts`). |
| Audit fixes (material) | Wherever the finding lives | — | APOSD/correctness fixes land in the offending file; the audit is cross-tier but each fix is local. |
| COMPLIANCE.md / README / DESIGN.md | Docs (`rate-limiter/*.md`) | — | Documentation artifacts, no code tier. |

## Standard Stack

This is a hardening phase: the stack is **already locked and installed**. The only *new* runtime
package is `swagger-ui-express`; the only new dev/types package is its types. Everything else is
present and verified.

### Core (new this phase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `swagger-ui-express` | **5.0.1** | Serve Swagger UI for a hand-written OpenAPI 3 spec at `/docs` | The de-facto Express adapter for Swagger UI; 4.58M weekly downloads; declares Express-5 peer support; trivial `app.use('/docs', serve, setup(spec))` API. [VERIFIED: npm registry — `npm view swagger-ui-express version` = 5.0.1, peerDependencies.express = `>=4.0.0 \|\| >=5.0.0-beta`] [CITED: github.com/scottie1984/swagger-ui-express] |

### Supporting (optional, discretion)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/swagger-ui-express` | **4.1.8** | TypeScript types for the above | Required for `verbatimModuleSyntax` + `strict` TS. Types lag at 4.1.x but cover the `serve`/`setup` surface used here. [VERIFIED: npm registry] dev-dependency. |
| `openapi-types` | **12.1.3** | Types-only `OpenAPIV3.Document` to type a hand-written spec *object* | Use ONLY if D-06 is implemented as a typed TS object (vs a YAML file). 11.2M weekly downloads, zero runtime, types-only. Gives compile-time validation of the spec shape — a lightweight alternative to a runtime validator for D-08. [VERIFIED: npm registry] dev-dependency. |
| `yaml` | **2.9.0** | Parse a `.yaml` spec file at startup | Use ONLY if D-06 is implemented as a YAML file (vs a TS object). [VERIFIED: npm registry] If the TS-object form is chosen (recommended — see below), neither `yaml` nor a file read is needed. |

### Recommendation within D-06's discretion
**Prefer a typed TS object** (`const spec: OpenAPIV3.Document = { … }`) over a YAML file:
- No file-read/parse at startup, no `yaml` dependency, no path-resolution-in-`dist` concern (the
  `.lua` files already showed how fiddly runtime asset paths are in this build — `tsup` hoists into
  `dist/lua/`, see `tsup.config.ts`).
- `openapi-types` gives **compile-time** structural validation for free, partially satisfying D-08's
  "structural-validity check" at the type level (the runtime supertest still asserts the served JSON).
- It is the most "line-by-line understood" form (D-06's stated intent), defensible in interview.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `swagger-ui-express` | `@scalar/express-api-reference` / `redoc` | Newer/prettier UIs, but swagger-ui-express is the most familiar to reviewers and the lightest fit for "2 endpoints"; D-07 names it explicitly. |
| Hand-written spec (D-06) | `swagger-jsdoc` (JSDoc → spec) or `zod-to-openapi` | Codegen/decorator machinery for 2 endpoints = AI-slop trap; **explicitly forbidden by D-06**. |
| `openapi-types` (typed object) | YAML file + `yaml` parser | YAML reads cleaner to some, but adds a runtime dep + a `dist` path concern; both are within D-06 discretion. |
| Runtime spec validator (`@apidevtools/swagger-parser`) for D-08 | A small hand-rolled structural assertion in the test | A full validator is a heavy dep for one test; D-08 says "without a heavy validator dep". Prefer typed object (compile-time) + a few `expect(spec.openapi).toMatch(/^3\./)`-style structural assertions in supertest. |

**Installation:**
```bash
# Runtime (demo tier) — MUST be a production dependency (Docker runtime uses --omit=dev):
npm install swagger-ui-express
# Dev — types (+ optional openapi-types if using the typed-object form):
npm install -D @types/swagger-ui-express openapi-types
```

**Version verification (run at plan/execute time to reconfirm):**
```bash
npm view swagger-ui-express version          # expect 5.0.1
npm view @types/swagger-ui-express version    # expect 4.1.8
npm view openapi-types version                # expect 12.1.3
```

## Package Legitimacy Audit

> slopcheck could not be installed in the research environment. Per protocol, the new packages are
> tagged `[ASSUMED]` and the planner SHOULD gate the install behind a `checkpoint:human-verify`
> task. Registry facts below were verified directly via `npm view` + the npm downloads API.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `swagger-ui-express` | npm | published years; last modified 2024-05-31 | 4,585,546 / wk | github.com/scottie1984/swagger-ui-express | unavailable | Approved [ASSUMED] — strong legitimacy signals; **no postinstall** (`scripts` = test/coverage only). Verify at install. |
| `@types/swagger-ui-express` | npm | DefinitelyTyped (4.1.8) | high (DT) | github.com/DefinitelyTyped/DefinitelyTyped | unavailable | Approved [ASSUMED] dev-only types. |
| `openapi-types` | npm | last modified 2023-05-24 | 11,255,001 / wk | github.com/kogosoftwarellc/open-api | unavailable | Approved [ASSUMED] types-only, zero runtime. Only if typed-object form chosen. |
| `yaml` | npm | mature (2.9.0) | very high | github.com/eemeli/yaml | unavailable | Approved [ASSUMED]. Only if YAML-file form chosen. |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none. (`swagger-ui-express` was checked for a malicious
postinstall — `npm view swagger-ui-express scripts` shows only `test`/`coverage:report`/`test-app`,
**no `postinstall`**. Transitive `swagger-ui-dist` also has no scripts.)

*Because slopcheck was unavailable, the planner should add one `checkpoint:human-verify` before the
install step (re-run `npm view … scripts` and confirm version/downloads).*

## Architecture Patterns

### System Architecture Diagram

```
                         demo tier (src/demo/server.ts — composition root)
                         ─────────────────────────────────────────────────
  HTTP request ──▶ express() app
                     │
                     ├─ GET /health ───────────────▶ 200 {status:ok}     (BEFORE limiter — never throttled)
                     │
                     ├─ GET /docs  ────────────────▶ swaggerUi.serve + setup(SPEC)   [NEW, D-07]
                     │                                  └─ renders SPEC (hand-written OpenAPI 3 object)
                     ├─ GET /openapi.json ─────────▶ res.json(SPEC)        [NEW, optional raw-spec route, eases D-08]
                     │
                     ├─ app.use(rateLimit({limiter}))   ◀── adapter tier (src/adapters/express)
                     │        │
                     │        ▼ consume(key)
                     │   core tier (src/limiters/* → src/store/*)   ◀── Redis/Lua or MemoryStore
                     │        │ Decision
                     │        ▼ setRateLimitHeaders + 200 / 429
                     └─ GET /api/ping ─────────────▶ 200 {pong} … then 429 + Retry-After + RateLimit-*

  SPEC documents the /health and /api/ping responses INCLUDING the 429 + the IETF
  RateLimit / RateLimit-Policy / legacy X-RateLimit-* headers (the part that showcases the project).
```

The `/docs` and `/openapi.json` routes are demo-tier only. The OpenAPI *object* lives in a new file
under `src/demo/` (e.g. `src/demo/openapi.ts`); it is excluded from coverage by D-01's `src/demo/**`
exclude.

### Recommended Project Structure (additions only)
```
src/demo/
├── server.ts        # existing composition root — add /docs + /openapi.json routes
└── openapi.ts       # NEW: hand-written OpenAPIV3.Document object (D-06), demo-only
test/
└── docs.test.ts     # NEW: supertest GET /docs 200 + spec structural-validity (D-08)
rate-limiter/
└── COMPLIANCE.md    # NEW: brief→evidence map + audit dispositions (D-10)
```

### Pattern 1: Mount Swagger UI for a hand-written spec (D-06/D-07)
**What:** Serve a static OpenAPI object via swagger-ui-express at `/docs`, plus the raw JSON.
**When to use:** Documenting the existing two endpoints; no codegen.
**Example:**
```typescript
// Source: github.com/scottie1984/swagger-ui-express (README) + CITED docs
import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./openapi.js"; // the hand-written OpenAPIV3.Document

// Raw spec (helps the D-08 structural assertion + lets clients fetch the doc):
app.get("/openapi.json", (_req, res) => res.json(openapiSpec));

// Swagger UI at /docs — prefix mount, NOT a wildcard route (Express-5 safe):
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
```
Notes:
- `swaggerUi.serve` is an array of static-asset middleware; `swaggerUi.setup(spec)` returns the
  request handler that renders the UI. Both are plain Express middleware. [CITED: github.com/scottie1984/swagger-ui-express]
- Mount `/docs` AFTER `/health` and ideally BEFORE `app.use(rateLimit(...))` if you do NOT want the
  docs UI itself rate-limited (the UI loads many static assets — throttling it would break the page).
  This is a planning decision: register `/docs` and `/openapi.json` outside the limiter, same as
  `/health`. Do not add the docs routes to the limited surface.

### Pattern 2: Cover a reachable defensive branch with a throwing stub / construction test (D-04)
**What:** Hit an uncovered `throw`/error arm with a focused test rather than an ignore pragma.
**When to use:** First choice for every gap (D-04 makes pragmas last resort).
**Example:**
```typescript
// validate.ts throw arms — currently uncovered (lines 17/47/60):
import { describe, expect, it } from "vitest";
import { RedisStore, MemoryStore } from "../src/index.js";

it("RedisStore rejects an empty keyPrefix (assertPrefix throw arm)", () => {
  // construction validates before any op; client never connects (lazyConnect).
  expect(() => RedisStore.connect("redis://x", { keyPrefix: "" })).toThrow(RangeError);
});
it("RedisStore rejects a garbage policy (assertPolicy throw arm)", () => {
  expect(() => RedisStore.connect("redis://x", { policy: "nope" as never })).toThrow(RangeError);
});
it("Limiter rejects non-positive config (assertPositiveConfig throw arm)", () => {
  expect(() => new TokenBucketLimiter(new MemoryStore(), { capacity: 0, refillPerInterval: 1, intervalMs: 1 })).toThrow(RangeError);
});
```
(`RedisStore.connect` uses `lazyConnect: true`, so constructing it touches NO network — these run
without Docker. See `src/store/redis.ts` L116-130.)

### Pattern 3: v8 ignore pragma WITH justification (D-04 last resort)
**What:** Exclude a genuinely-unreachable line/branch from v8 coverage.
**Syntax (Vitest 4.1 / v8 provider):**
```typescript
/* v8 ignore next 3 -- unreachable: <one-line justification> @preserve */
```
- Forms: `/* v8 ignore next */`, `/* v8 ignore next N */`, `/* v8 ignore start */ … /* v8 ignore stop */`,
  `/* v8 ignore if */`, `/* v8 ignore else */`, `/* v8 ignore file */`.
- **The `-- @preserve` suffix is REQUIRED in this codebase**: tsup/esbuild strips comments unless
  marked as a legal comment, which would silently drop the pragma. Always end the pragma with
  `@preserve`. [CITED: vitest.dev/guide/coverage]
- D-04 requires a one-line justification before/in the pragma. Put the reason in the same comment.

### Anti-Patterns to Avoid
- **Lowering scope to pass the gate.** D-01 fixes the scope; do not quietly add files to `exclude`
  beyond demo/barrels/`.lua` to dodge a real branch. Cover the branch instead.
- **Ignore-pragma spray.** D-04 makes pragmas the last resort. Each one needs a justification and
  should be genuinely unreachable (e.g. a `default:` that TS exhaustiveness already proves dead).
- **Codegen/JSDoc-decorator Swagger.** D-06 forbids it; it reads as slop for 2 endpoints.
- **swagger-ui-express as a devDependency.** Docker runtime does `npm ci --omit=dev` — it must be a
  runtime `dependency` or `/docs` 500s/crashes in the container.
- **Rate-limiting the `/docs` UI.** It pulls many static assets; throttling breaks the page.
- **Re-commenting trivial code (D-11).** The codebase is already heavily, well-commented. D-11 is a
  *targeted* top-up of non-obvious intent only — adding comments to getters/barrels is the exact
  "AI slop over every function" the brief penalizes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Serving Swagger UI | A custom HTML page embedding swagger-ui-dist | `swagger-ui-express` | Handles asset serving, versioning, and the setup handler; D-07 names it. |
| OpenAPI structural validation in the test | A full `swagger-parser` runtime validator | Typed object (`openapi-types`) at compile time + a few structural `expect()`s on the served JSON | D-08 explicitly wants this "without a heavy validator dep". |
| Coverage thresholds | A custom script parsing `coverage-summary.json` and failing CI | `coverage.thresholds` in `vitest.config.ts` | Native, fails the run non-zero when under threshold; D-02 names it. |

**Key insight:** Everything this phase needs is either already in the stack or a single, named,
well-known package. The risk here is *adding* machinery (codegen, validators, custom scripts) that
reads as overengineering against the APOSD/anti-slop grading lens — the dominant lens per CLAUDE.md.

## Coverage Gap Analysis (the decisive section — D-01..D-04)

**Live measurement (run 2026-06-25, full suite incl. Docker-backed Redis tests, 122 tests passing).**
Scoped to D-01's testable surface (demo, barrels, `.lua` excluded):

| Metric | Current | Gate (D-02) | Status |
|--------|---------|-------------|--------|
| Statements | **96.31%** (209/217) | ≥95 | ✅ PASS |
| Branches | **88.18%** (112/127) | ≥95 | ❌ **FAIL — the only gap** |
| Functions | **100%** (42/42) | ≥95 | ✅ PASS |
| Lines | **96.13%** (199/207) | ≥95 | ✅ PASS |

Per-file uncovered lines/branches (from the same run):

| File | Stmts | Branch | Uncovered lines | What the gap is | Reachable? |
|------|-------|--------|-----------------|-----------------|-----------|
| `src/validate.ts` | 62.5% | 81.25% | 17, 47, 60 | The `throw new RangeError(...)` arm of `assertPositiveConfig` (17), `assertPolicy` (47), `assertPrefix` (60). Only `assertCost` throw is tested today (`test/cost-validation.test.ts`). | **YES** — trivial construction tests (Pattern 2). |
| `src/store/redis.ts` | 92.59% | 63.63% | 121-129 | The entire `RedisStore.connect()` static factory (builds the ioredis client). | **YES** — `lazyConnect:true` means constructing it touches no network; call `RedisStore.connect("redis://x")` and assert it returns a store / validates config. No Docker needed. |
| `src/adapters/express/headers.ts` | 100% | 85.71% | 49-57 | The `mode === 'ietf'`-only branch and the `windowSeconds != null ? … : ''` ternary (no test passes `windowSeconds`, and `ietf`-only mode is untested — only `legacy` and `false` are). | **YES** — one supertest with `headers: 'ietf'` + one with `windowSeconds` set. |
| `src/adapters/express/middleware.ts` | 96.55% | 94.44% | 68 | The `if (options.limiter == null) throw new TypeError(...)` arm. | **YES** — `expect(() => rateLimit({} as never)).toThrow(TypeError)`. |
| `src/store/memory.ts` | 100% | 97.22% | 167 | The `prev > 0 ? cfg.windowMs / prev : msToBoundary` ELSE branch in sliding-window `retryAfterMs` (the `prev === 0` fallback). | **LIKELY** — construct a sliding-window state where the request is rejected with `curr+cost <= limit` but `prev === 0`. May be hard to reach given the `curr + cost > limit` guard above it; **if genuinely unreachable, this is the one justified `/* v8 ignore */` candidate** (D-04). Investigate first. |
| `src/store/breaker.ts` | (not listed = 100%) | — | — | Fully covered by `test/breaker.test.ts`. No action. |
| `src/limiters/*` | (not listed = 100%) | — | — | Fully covered. No action. |
| `src/clock.ts` | (not listed) | — | — | `FakeClock` is exercised everywhere; `SystemClock.now` is intentionally untested (documented in `clock.ts` L4-8). If `clock.ts` shows a gap under the final config, the `SystemClock.now` arrow is the candidate — but it is currently not flagged. |

**Plan implication:** A single new test file (or additions to existing ones) covering the
`validate.ts` throw arms, `RedisStore.connect()`, the `headers.ts` ietf/windowSeconds branches, and
the `middleware.ts` TypeError arm will lift branches well past 95% with **zero production-source
changes**. The `memory.ts:167` else-branch is the only possible ignore-pragma candidate and must be
investigated for reachability first (D-04 order).

**Mechanical gotchas confirmed by the live run:**
1. **`.lua` files break the coverage run.** With the current `include: ['src/**']`, rolldown (the
   v8 remapper) emits `PARSE_ERROR` for all three `.lua` files ("Expected a semicolon … found none").
   D-01's `.lua` exclude is therefore **required for the run to even complete cleanly**, not just for
   the number. Exclude `src/store/lua/**` (or `**/*.lua`).
2. **Global thresholds count every included file.** Vitest counts all files matching `include` into
   the global thresholds. So `src/demo/**` (server.ts is at 50% lines) and the barrels MUST be in
   `coverage.exclude`, or they drag the global metrics below 95 regardless of the algorithm coverage.
   [CITED: vitest.dev/config/coverage — "Vitest counts all files … into the global coverage thresholds."]
3. **`exclude` filters `include`.** `coverage.exclude` acts as a secondary filter over the `include`
   set, so the D-01 pattern is: keep a tight `include` of the testable dirs/files (or `src/**` minus
   excludes) AND list demo/barrels/lua in `exclude`. [CITED: vitest.dev/guide/coverage]

## Recommended `vitest.config.ts` shape (D-01/D-02)

```typescript
coverage: {
  provider: 'v8',
  include: ['src/**'],
  exclude: [
    'src/demo/**',                 // D-01: demo server excluded
    'src/index.ts',                // D-01: core barrel
    'src/adapters/express/index.ts', // D-01: adapter barrel
    'src/store/lua/**',            // D-01: .lua exercised via Redis integration; also unparseable by rolldown
  ],
  thresholds: {                    // D-02: hard gate, all four metrics
    lines: 95,
    statements: 95,
    functions: 95,
    branches: 95,
  },
},
```
- A failing threshold exits the run non-zero, so wiring `verify` to run coverage (D-03) makes the
  gate mandatory. [CITED: vitest.dev/config/coverage]
- `perFile: false` (the default) means the gate is on the aggregate — appropriate here (D-01 measures
  the surface as a whole). Do NOT set `perFile: true` unless you want each file individually ≥95.

## `verify` script wiring (D-03)

Current: `"verify": "npm run typecheck && npm run test"` and `"test": "vitest run"`.
D-03 wants verify = typecheck + **coverage** run. Two options:
```jsonc
// Option A (minimal): point verify at coverage directly
"verify": "npm run typecheck && vitest run --coverage"
// Option B: make coverage the default test gate (keeps one command)
"test": "vitest run --coverage",   // then verify stays typecheck && test
```
Either keeps it a single green gate (D-03). **Open question for the planner:** should `lint` join
`verify`? It is currently NOT in verify, and `eslint` currently exits **1** (see audit findings).
D-03 only specifies typecheck + coverage; adding lint is a discretionary hardening but would require
fixing the existing lint error first.

## Audit Findings Already Surfaced (input to D-09 / COMPLIANCE.md)

Running the existing gates during research surfaced concrete, material findings:

| # | Finding | Severity | File | Disposition (suggested) |
|---|---------|----------|------|-------------------------|
| AF-1 | `eslint .` exits **1** — `'_d' is defined but never used` (`@typescript-eslint/no-unused-vars`) | Material (a lint error; brief MANDATES code quality) | `test/adapters/express/middleware.test.ts:99` | **FIX** — rename to `_` is already the convention; this `_d` slipped the rule. Trivial. |
| AF-2 | 2× "Unused eslint-disable directive (no problems reported from 'no-console')" warnings | Minor | `src/demo/server.ts:130, 135` | **FIX** — remove the now-stale `eslint-disable no-console` directives (or keep one if the startup `console.log` is intentional and the rule is enabled elsewhere). Cheap APOSD tidy. |
| AF-3 | `lint` is not part of `verify` | Process | `package.json` | **CONSIDER** — adding lint to the gate is discretionary (D-03 names only typecheck+coverage); if added, AF-1 must be fixed first. Record decision either way. |

These three are the kind of "material findings" D-09 targets. The skill-assisted audit (code-quality,
design-patterns, docker-expert, documentation-writer) should look for more, but these are confirmed
real today and belong in COMPLIANCE.md's audit-disposition section.

## COMPLIANCE.md Target Map (D-10)

The brief PDF (`iol-challenge-actualizado (1).pdf`, `Version: 89f729a`) is **confirmed identical**
to PROJECT.md — same Rules, Focus-on, Nice-to-haves, submission shape. COMPLIANCE.md (D-10) should
be a scannable table mapping each brief item to repo evidence. The brief's enumerable items:

**Rules (MUST):**
| Brief item | Evidence anchor (suggested) |
|------------|------------------------------|
| Working, correct, well-designed, tested solution | `npm run verify` green; whole `rate-limiter/` |
| Allowed language (TypeScript) | `package.json`, `tsconfig.json` |
| AI tool usage allowed; undocumented AI code penalized | `DESIGN.md` AI-usage section (DELIV-04); D-11 targeted comments |
| Unknown code minimized + documented | Dense intent comments across `src/**`; D-11 pass |

**Focus on:**
| Brief item | Evidence anchor (suggested) |
|------------|------------------------------|
| Correct code that builds + passes tests (MANDATORY) | `tsc --noEmit` green; 122 tests passing; the new ≥95% coverage gate |
| Comprehensive tests for core logic | `test/token-bucket.test.ts`, `sliding-window.test.ts`, `fixed-window.test.ts`, `concurrency.test.ts`, `conformance/*`, `redis-*` |
| Elegant design (APOSD) | `DESIGN.md`; deep `Store`/`RateLimiter` modules; `types.ts` narrow interfaces |
| Correct error handling | `validate.ts` construct-time guards; `redis.ts` fail-open/closed + breaker; `middleware.ts` never-leak try/catch |
| Concurrency only where needed | `memory.ts` event-loop atomicity note; `breaker.ts` HALF-OPEN single-probe; Lua atomicity; `concurrency.test.ts` over-admission guard |
| Avoiding overengineering | Out-of-scope table in REQUIREMENTS.md; "What NOT to Use" in CLAUDE.md |
| Avoiding AI slop | D-11 hand-comments; D-06 hand-written spec (no codegen) |

**Nice to haves:**
| Brief item | Evidence anchor (suggested) |
|------------|------------------------------|
| Logging, metrics, ease of deployment | Ease of deployment: `docker compose up` (DELIV-02), Dockerfile multi-stage. **Logging/metrics: v2-deferred (OBS-01/02)** — COMPLIANCE.md should state this honestly as a deliberate scope decision, NOT claim it. The `DegradedLogger` hook in `redis.ts`/`middleware.ts` is the seam. |
| Defensive design (timeouts, pools, circuit breakers) | `commandTimeout` (DEF-01); `CircuitBreaker` (`breaker.ts`); single shared ioredis client; fail-open/closed policy |
| Good comments / documentation | Dense intent comments; `DESIGN.md`; `README.md`; **NEW: `/docs` Swagger UI + COMPLIANCE.md** |

**Honesty note for COMPLIANCE.md:** logging/metrics are explicitly v2-deferred. Map them as
"deferred (rationale: …)", not as delivered — claiming un-shipped nice-to-haves would be the kind of
overstatement the APOSD/anti-slop lens punishes.

## Common Pitfalls

### Pitfall 1: Forgetting the `.lua` and demo excludes → coverage run errors / gate impossible
**What goes wrong:** Adding `thresholds` while keeping `include: ['src/**']` leaves the demo (50%
lines) and barrels in scope, so the global gate can never reach 95; and the `.lua` files emit
`PARSE_ERROR` from rolldown.
**Why it happens:** v8 global thresholds count every included file; rolldown can't parse Lua.
**How to avoid:** Add the D-01 `exclude` list (demo, both barrels, `src/store/lua/**`) in the SAME
change as `thresholds`.
**Warning signs:** `PARSE_ERROR` / "Failed to parse … .lua" lines in the coverage output; global %
far below per-algorithm %.

### Pitfall 2: swagger-ui-express as a devDependency → container crash
**What goes wrong:** `/docs` works in `tsx`/dev but the Docker image (which runs
`npm ci --omit=dev`, see `Dockerfile`) is missing the package → `ERR_MODULE_NOT_FOUND` at
`node dist/demo/server.js` startup, breaking the one-command deploy (DELIV-02).
**Why it happens:** D-07 says "demo-only dependency", which is easily misread as devDependency. The
demo runs at runtime in the container, so it needs runtime deps.
**How to avoid:** Install swagger-ui-express as a production `dependency` (alongside `express`/`ioredis`,
which are already runtime deps for exactly this reason). Types go in devDependencies.
**Warning signs:** `docker compose up` fails at server start; smoke test passes locally only.

### Pitfall 3: Express-5 wildcard route breakage
**What goes wrong:** A bare wildcard route (`app.get('*', …)` / `app.use('*', …)`) throws under
Express 5 / path-to-regexp@8 ("Missing parameter name").
**Why it happens:** path-to-regexp@8 requires named wildcards (`/*splat`).
**How to avoid:** The Swagger mount uses a **prefix** mount (`app.use('/docs', …)`), which is NOT a
wildcard and is unaffected. Do not introduce any bare-`*` catch-all for docs. [CITED: github.com/expressjs/express issues #6606/#6468]
**Warning signs:** TypeError at app construction mentioning path-to-regexp.

### Pitfall 4: v8 ignore pragma silently stripped by tsup/esbuild
**What goes wrong:** A `/* v8 ignore next */` without `@preserve` is removed by esbuild as a
non-legal comment, so the branch is counted again and the gate fails mysteriously.
**Why it happens:** esbuild strips comments unless marked legal (`@preserve`/`@license`).
**How to avoid:** Always write `/* v8 ignore next -- <reason> @preserve */`. [CITED: vitest.dev/guide/coverage]
**Warning signs:** Coverage doesn't move after adding a pragma.

### Pitfall 5: Over-commenting / over-refactoring before submission (D-09/D-11)
**What goes wrong:** A broad "improve everything" pass adds comment-slop to trivial code and
refactors working, tested code, risking regressions days before grading.
**Why it happens:** Audit-lens momentum.
**How to avoid:** D-09 = fix material only, record the rest; D-11 = comment non-obvious intent only.
The code is already well-commented — treat additions as exceptions.
**Warning signs:** Diff touching getters/barrels; comments restating the code.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `c8`/`istanbul` ignore syntax (`/* c8 ignore */`, `/* istanbul ignore */`) | `/* v8 ignore … -- @preserve */` | Vitest's v8 provider standardized `v8 ignore` | Use the `v8` form; the `c8` form may not be recognized by the bundled provider. |
| Express 4 `app.get('*')` catch-all | Express 5 named wildcard `/*splat` | Express 5 + path-to-regexp@8 | Avoid bare wildcards; prefix mounts unaffected (our case). |
| swagger-jsdoc codegen | Hand-written OpenAPI object (for small surfaces) | n/a — design choice | D-06: hand-written, no codegen. |

**Deprecated/outdated:**
- ESLint `.eslintrc` — already on flat config (`eslint.config.js`). No action.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `swagger-ui-express@5.0.1` works with this exact Express 5.2.1 + ESM + tsup build at runtime in the Docker image | Standard Stack / Pitfall 2 | If an ESM/CJS interop or asset-path issue appears, the `/docs` route may need `swaggerUi.serveFiles`/options tweaks or a CJS interop shim. **Mitigation:** the D-08 supertest + the build-smoke test will catch it; verify `docker compose up` reaches `/docs` 200 before finishing. (Package legitimacy itself is verified; the ASSUMED part is the build-integration, not the package.) |
| A2 | `memory.ts:167` (`prev > 0` else branch) is reachable by a crafted sliding-window state | Coverage Gap Analysis | If genuinely unreachable, it needs a justified `/* v8 ignore */` (D-04) instead of a test. Low risk — either path lifts the gate. |
| A3 | Adding the D-01 excludes + the enumerated branch tests is sufficient to clear all four metrics ≥95 | Coverage Gap Analysis | Branches is at 88.18%; the enumerated gaps account for the visible shortfall, but a previously-hidden branch could surface once demo/lua are excluded. **Mitigation:** re-run coverage after each test addition; the live numbers give a tight estimate. |
| A4 | swagger-ui-express has no malicious postinstall | Package Legitimacy Audit | Verified `scripts` has no postinstall today; re-confirm at install (versions can change). |

## Open Questions

1. **Should `lint` join the `verify` gate?**
   - What we know: D-03 specifies typecheck + coverage; `eslint` currently exits 1 (AF-1).
   - What's unclear: Whether the user wants lint mandatory.
   - Recommendation: Fix AF-1/AF-2 regardless (material, D-09). Adding lint to `verify` is a sound
     hardening but is the planner's/user's call — record the decision in COMPLIANCE.md/DESIGN.md.

2. **OpenAPI source format: typed TS object vs YAML file?**
   - What we know: D-06 allows either (discretion).
   - Recommendation: typed TS object + `openapi-types` (no runtime dep, no `dist` path concern,
     compile-time structural check). Strong default unless the user prefers YAML.

3. **`memory.ts:167` reachability.**
   - What we know: it's the only plausible ignore-pragma candidate.
   - Recommendation: attempt a covering test first (D-04 order); only pragma if proven unreachable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/test/run | ✓ | v24.15.0 | — |
| Vitest | coverage gate | ✓ | 4.1.9 | — |
| @vitest/coverage-v8 | coverage gate | ✓ | 4.1.9 (deduped with vitest) | — |
| Docker | Redis integration/conformance/fault-injection suites in the coverage run | ✓ | running (docker info OK) | The branch-coverage tests this phase adds (validate throws, connect(), headers, middleware) do NOT need Docker; but the FULL `verify` run runs the Redis suites which DO need Docker (already a documented project constraint). |
| swagger-ui-express | `/docs` (D-07) | ✗ (not yet installed) | target 5.0.1 | none — must install (runtime dep) |
| @types/swagger-ui-express | TS build of demo | ✗ | target 4.1.8 | none — must install (dev) |

**Missing dependencies with no fallback:** swagger-ui-express + its types (must be installed this phase).
**Missing dependencies with fallback:** none.

## Validation Architecture

> nyquist_validation: `.planning/config.json` not present in repo root for this project's planning;
> treating as enabled (key absent = enabled). The project already has a mature test suite; this
> section maps the phase's NEW behaviors to tests.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.9 (+ @vitest/coverage-v8 4.1.9, supertest 7.2.2) |
| Config file | `rate-limiter/vitest.config.ts` |
| Quick run command | `cd rate-limiter && npx vitest run <file>` (in-memory tests finish in ms) |
| Full suite command | `cd rate-limiter && npm run verify` (typecheck + full Vitest incl. Docker Redis suites) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUAL-COV | branches/lines/funcs/stmts ≥95 on testable surface | coverage gate | `npx vitest run --coverage` | ⚠️ config change + new tests (Wave 0) |
| QUAL-COV | validate.ts throw arms covered | unit | `npx vitest run test/validate.test.ts` (new) | ❌ Wave 0 |
| QUAL-COV | `RedisStore.connect()` covered | unit (no Docker) | `npx vitest run test/redis-connect.test.ts` (or fold into existing) | ❌ Wave 0 |
| QUAL-COV | headers ietf-mode + windowSeconds covered | http unit | extend `test/adapters/express/middleware.test.ts` | ✅ extend |
| QUAL-COV | middleware missing-limiter TypeError covered | unit | extend middleware test | ✅ extend |
| QUAL-DOC | `GET /docs` → 200 | smoke/http | `test/docs.test.ts` (new) | ❌ Wave 0 |
| QUAL-DOC | `GET /openapi.json` → 200 + structurally valid OpenAPI 3 | http | `test/docs.test.ts` (new) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the specific new/edited test file via `npx vitest run <file>`.
- **Per wave merge:** `npm run verify` (typecheck + full coverage gate).
- **Phase gate:** `npm run verify` green (with thresholds enforced) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `test/validate.test.ts` (or additions) — covers the three `validate.ts` throw arms (QUAL-COV).
- [ ] `RedisStore.connect()` coverage — a no-Docker construction test (QUAL-COV).
- [ ] `test/docs.test.ts` — `/docs` 200 + `/openapi.json` structural validity (QUAL-DOC, D-08).
- [ ] `vitest.config.ts` — add `exclude` (demo/barrels/lua) + `thresholds` (Wave 0 config change).
- [ ] Install `swagger-ui-express` (runtime) + `@types/swagger-ui-express` (+ optional `openapi-types`).

*(Existing infrastructure — supertest, FakeClock, throwing-stub harnesses, testcontainers — covers
the rest; no framework install needed.)*

## Security Domain

> `security_enforcement` config not located for this planning project; included for completeness.
> This phase adds NO new attack surface beyond a read-only docs route.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Demo is unauthenticated by design (challenge prototype). |
| V3 Session Management | no | Stateless HTTP. |
| V4 Access Control | no | No protected resources; `/docs` is intentionally public docs. |
| V5 Input Validation | yes (already) | `validate.ts` construct-time guards + `assertCost`; the new OpenAPI object is static (no user input parsed into it). |
| V6 Cryptography | no | No secrets/crypto introduced this phase. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Exposing internals via `/docs` in production | Information Disclosure | The demo is a challenge prototype; `/docs` documents only the two public demo endpoints. No internal/admin surface is described. Acceptable; note in DESIGN.md that docs are demo-scoped. |
| Supply-chain (new dependency) | Tampering | Package legitimacy audit above; swagger-ui-express has no postinstall, 4.58M wk downloads, named source repo. Re-verify at install (slopcheck unavailable here). |
| Static-asset DoS on the docs UI if rate-limited | Denial of Service | Register `/docs`/`/openapi.json` OUTSIDE the limiter (like `/health`) so the UI's many asset requests don't trip the limiter and break the page. |

## Sources

### Primary (HIGH confidence)
- **Live codebase + live coverage run** (`cd rate-limiter && npm run coverage`, scoped re-run with D-01 excludes) — current coverage numbers, exact uncovered lines, `.lua` PARSE_ERROR, demo at 50%. Direct measurement, 2026-06-25.
- **Live tooling runs** — `tsc --noEmit` (exit 0), `eslint .` (exit 1, AF-1), `docker info` (available), `npm view` for all package versions/scripts/downloads.
- npm registry (`npm view`) — swagger-ui-express 5.0.1 (peer express `>=4.0.0 || >=5.0.0-beta`, no postinstall), @types/swagger-ui-express 4.1.8, openapi-types 12.1.3, yaml 2.9.0. npm downloads API — 4.58M/wk + 11.2M/wk. 2026-06-25.
- vitest.dev/guide/coverage + vitest.dev/config/coverage — `/* v8 ignore … -- @preserve */` syntax, `coverage.thresholds` shape (lines/functions/branches/statements + perFile/autoUpdate/100/per-glob), global thresholds count all included files, exclude filters include.
- `iol-challenge-actualizado (1).pdf` (`Version: 89f729a`) — confirmed identical Rules/Focus-on/Nice-to-haves/submit to PROJECT.md; gap audit is confirmatory.

### Secondary (MEDIUM confidence)
- github.com/scottie1984/swagger-ui-express (README) — `app.use('/docs', serve, setup(spec))` mount + raw-spec route pattern.
- expressjs/express issues #6606, #6468, #6711 — Express 5 path-to-regexp@8 wildcard breaking change (relevant only as a thing to AVOID; prefix mount is unaffected).

### Tertiary (LOW confidence)
- General community examples of swagger-ui-express + Express (dev.to / logrocket) — corroborate the mount pattern; not load-bearing.

## Metadata

**Confidence breakdown:**
- Coverage analysis: **HIGH** — measured directly against the live suite; exact uncovered lines from the v8 report.
- Swagger stack/versions: **HIGH** — verified on npm registry + official README; Express-5 peer support explicit.
- Docker runtime-dep constraint: **HIGH** — read directly from the project `Dockerfile` (`npm ci --omit=dev`).
- Audit findings (AF-1/2): **HIGH** — reproduced from live `eslint` run.
- swagger build-integration (ESM/tsup): **MEDIUM** — package supports it; this exact build wasn't end-to-end exercised (A1).
- COMPLIANCE.md mapping: **HIGH** — brief PDF read directly and confirmed identical.

**Research date:** 2026-06-25
**Valid until:** ~2026-07-25 (stable; package versions and Vitest config API are mature). Re-verify swagger-ui-express version/scripts at install per the legitimacy gate.
