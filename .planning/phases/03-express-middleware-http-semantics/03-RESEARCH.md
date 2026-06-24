# Phase 3: Express Middleware & HTTP Semantics - Research

**Researched:** 2026-06-24
**Domain:** Express 5 middleware authoring, IETF RateLimit header standards, HTTP 429/Retry-After semantics, package subpath exports
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D3-01:** Default key source is `req.ip`, with an optional `keyGenerator(req) => string` override. Key stays OPAQUE to the core (CORE-05) — extraction lives only in the adapter.
- **D3-02:** Proxy / `X-Forwarded-For` handling is the app's responsibility, documented, not re-implemented. Middleware relies on Express's own `trust proxy` to populate `req.ip`. We do NOT parse `X-Forwarded-For` ourselves.
- **D3-03:** When `keyGenerator` returns `null`/`undefined`/empty, the request is ADMITTED (limiting skipped) and a warning is logged via the optional `DegradedLogger`. (Symmetric with the fail-open default, D3-07.)
- **D3-04:** Emit BOTH the IETF `RateLimit` family AND the legacy `X-RateLimit-*` headers, on allowed AND rejected responses. (Exact IETF draft version / field syntax was a research item — RESOLVED below.)
- **D3-05:** One consistent unit across all reset/retry headers: **delta-seconds**. `Retry-After = ceil(retryAfterMs/1000)`, `reset = ceil(resetMs/1000)`. `X-RateLimit-Reset` is ALSO delta-seconds (NOT epoch). Rejected GitHub-style epoch-seconds precisely because it would split units.
- **D3-06:** `remaining` is emitted as the integer already floored by the core (D-04). `limit` comes from `Decision.limit` (D-12). Middleware does NO re-derivation — maps `Decision` fields straight to headers.
- **D3-07:** The middleware owns its OWN configurable fail-open/closed policy, independent of the store, default `fail-open`. Wraps `limiter.consume()` in try/catch: on rejection, fail-open ADMITS (`next()`), fail-closed returns `429`.
- **D3-08:** HTTP-04 is verified by injecting a stub `RateLimiter` whose `consume` rejects, then asserting fail-open admits and fail-closed returns 429 — no unhandled rejection. Catch path also logs via `DegradedLogger`.
- **D3-09:** A factory `rateLimit(options) => RequestHandler`. Options: `{ limiter, keyGenerator?, policy?, headers?, handler?, message?, logger? }`. `limiter` required; everything else defaults. Middleware still catches `consume()` itself to apply D3-07 rather than leaking to the error handler.
- **D3-10:** 429 default body is JSON (`{ error: "Too Many Requests", retryAfterMs }`) with `Content-Type: application/json`, plus `Retry-After` and all rate-limit headers. A `handler(req, res, decision)` override or custom `message` lets the caller change the body. Headers set on the response in ALL paths.

### Claude's Discretion
- **Exact IETF draft version + structured-field syntax** for `RateLimit` / `RateLimit-Policy` — researcher confirms against current `draft-ietf-httpapi-ratelimit-headers` and picks the form to emit. **(RESOLVED — see "IETF RateLimit Headers" below.)**
- **Adapter file layout & build wiring:** new `src/adapters/express/` directory with its own barrel; exported as a package subpath (e.g. `rate-limiter/express`) via a second `tsup` entry + `package.json` `exports` map — keeping Express out of the main core entry. Add `express`, `@types/express`, `supertest` as devDeps. **(Recommendation below.)**
- **`headers` option shape** (e.g. `"both" | "ietf" | "legacy" | false`) and whether to expose it at all — planner's call; default emits both (D3-04). **(Recommendation below.)**
- **Where the `reset`/`Retry-After` rounding helper lives** and how headers are serialized (structured-field helper vs. manual string) — implementation detail. **(Recommendation below.)**

### Deferred Ideas (OUT OF SCOPE)
- Variable request `cost` through the middleware (EXT-01, v2).
- Allowlist / skip rules (skip rate-limiting for certain IPs/paths) — own phase if ever.
- Metrics / structured decision logging (allowed/denied counters) — OBS-01/02, v2. The `DegradedLogger` only logs degraded/skip events, not every decision.
- A non-Express adapter (Fastify, etc.) — EXT-02, v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HTTP-01 | Express middleware enforces a limiter per extracted client key | Factory `rateLimit({ limiter, keyGenerator })` → `RequestHandler`; default key = `req.ip` (Express populates via `trust proxy`); key passed opaquely to `limiter.consume(key)`. See "Express 5 Middleware Authoring" + "Client Key Extraction". |
| HTTP-02 | Over-limit requests get `429 Too Many Requests` with `Retry-After` | `res.status(429)`; `Retry-After: ceil(retryAfterMs/1000)` delta-seconds (RFC 9110 §10.2.3). Default JSON body. See "429 Response & Retry-After". |
| HTTP-03 | Rate-limit headers on allowed AND rejected responses (IETF `RateLimit`/`RateLimit-Policy` + legacy `X-RateLimit-*`), integer `remaining`, consistent `reset` unit | IETF draft-11 structured-field form (named policy items with `q`/`w`/`r`/`t`) + legacy `X-RateLimit-Limit/Remaining/Reset`. All reset units delta-seconds (D3-05). See "IETF RateLimit Headers" + "Header Mapping Table". |
| HTTP-04 | Middleware handles async/store errors without crashing, honoring fail-open/closed | try/catch around `await limiter.consume()`; reuse `RateLimitPolicy` type + `assertPolicy`; default fail-open. Verified via throwing stub limiter + supertest. See "Error Handling & Fail-Open/Closed". |
</phase_requirements>

## Summary

Phase 3 wraps the existing framework-agnostic `RateLimiter` in an Express 5 middleware. The work is small and well-bounded: a factory `rateLimit(options) => RequestHandler` that extracts an opaque key (default `req.ip`), awaits `limiter.consume(key)`, maps the returned `Decision` straight to HTTP headers, and either calls `next()` or sends a `429`. Two correctness subtleties dominate the grading surface: (1) **getting the IETF `RateLimit` header syntax right against the *current* draft**, and (2) **proving fail-open/closed without Redis** via a throwing stub limiter under supertest.

The single most important finding: **the IETF draft has moved to `draft-ietf-httpapi-ratelimit-headers-11` (expires 2026-11-24), and the syntax in CONTEXT's example (`RateLimit: limit=10, remaining=1, reset=5` + `RateLimit-Policy: 10;w=60`) is OUTDATED** — that was the draft-07/08 dictionary form. Draft-11 refactored both headers into **Lists of Items** (RFC 9651 structured fields): a named policy item carries `q` (quota) + `w` (window seconds), and a named service-limit item carries `r` (remaining) + `t` (effective window seconds). The concrete current form to emit is `RateLimit-Policy: "default";q=10;w=60` and `RateLimit: "default";r=1;t=5`. This is the prescriptive change the planner must encode — emitting the older form would read as following a stale spec.

Stack is fully locked by CLAUDE.md and verified against npm on 2026-06-24: Express 5.2.1, @types/express 5.0.6, supertest 7.2.2 (needs `@types/supertest@^7.2.0` — supertest ships NO types), Vitest 4.1.x already installed. The adapter ships as a subpath export `rate-limiter/express` via a second tsup entry + `package.json` `exports` map, keeping Express out of the core barrel (mirrors how only `store/redis.ts` imports ioredis today).

**Primary recommendation:** Build `src/adapters/express/middleware.ts` exporting `rateLimit(options)`. Emit IETF draft-11 structured-field headers (`"default";q=…;w=…` / `"default";r=…;t=…`) PLUS legacy `X-RateLimit-*`, all in delta-seconds, on every path. Reuse `RateLimitPolicy` + `assertPolicy` + the `DegradedLogger` shape from the core. Verify all four requirements with supertest against the in-memory store; verify HTTP-04 with a throwing stub limiter.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Client key extraction (IP / keyGenerator) | API / Adapter (Express middleware) | — | CORE-05: identity is opaque to core; extraction lives only in the adapter. `req.ip` is an Express-tier concern. |
| Proxy / `X-Forwarded-For` resolution | Frontend Server / Express `trust proxy` setting | Deployment (reverse proxy) | D3-02: Express owns `req.ip` population; middleware never parses XFF (spoofing footgun). |
| Rate-limit decision (allow/deny, remaining, reset) | Core (`RateLimiter.consume`) | — | Already built in Phase 1/2; middleware only consumes the `Decision`. |
| Header serialization (IETF + legacy) | API / Adapter | — | Pure mapping of `Decision` → HTTP; transport concern, belongs in the adapter. |
| Fail-open/closed on `consume()` error | API / Adapter (middleware policy, D3-07) | Core store (its own internal policy) | D3-07: middleware needs its OWN policy so HTTP-04 is provable without Redis. |
| 429 response shaping | API / Adapter | — | HTTP status/body is a transport concern. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.1 (verified latest 5.2.1) | Middleware adapter host | CLAUDE.md-locked; Express 5 is `latest`, native async error propagation, stable. `[VERIFIED: npm registry]` |
| (core) `RateLimiter` from `rate-limiter` | local | Decision verb the middleware calls | Already built (Phase 1). Middleware imports the interface only. `[VERIFIED: codebase]` |

### Supporting (dev / build / test)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/express | ^5 (verified 5.0.6) | TS types for Express 5 `RequestHandler`, `Request`, `Response` | devDep — middleware authoring. `[VERIFIED: npm registry]` |
| supertest | ^7.2 (verified 7.2.2) | HTTP assertions without binding a port | devDep — supertest verification of status/headers/body (HTTP-01..04). `[VERIFIED: npm registry]` |
| @types/supertest | ^7.2 (verified 7.2.0) | TS types for supertest | **REQUIRED** — supertest 7.2.2 ships NO bundled types (no `types`/`typings`/`exports` field). `[VERIFIED: npm registry]` |
| vitest | ^4.1 (installed 4.1.9) | Test runner | Already installed; supertest suite runs under Vitest. `[VERIFIED: codebase package.json]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written middleware | `express-rate-limit` / `rate-limiter-flexible` | **FORBIDDEN by CLAUDE.md** — importing one defeats the challenge and reads as AI slop. The challenge *is* to implement this. |
| supertest | `node:test` + real `fetch` against `app.listen(0)` | More boilerplate, must manage port + teardown. supertest is CLAUDE.md-locked and binds an ephemeral server internally. |
| `@types/supertest` | supertest's own types | supertest 7.2.2 does NOT ship types (verified: no `types` field). The `@types/supertest` package is the only option and is NOT deprecated. |

**Installation:**
```bash
# from /rate-limiter — all three are devDeps (adapter + tests only; never in runtime image)
npm install -D express@^5.1 @types/express@^5 supertest@^7.2 @types/supertest@^7.2
```

Note: `express` is a **devDependency** here, not a runtime dependency of the published library — the adapter has Express as a *peer* concern (the consuming app brings Express). For this challenge deliverable, devDep is sufficient and keeps the core install lean. If the planner wants strict correctness for a published package, declare `express` as a `peerDependency` (`"express": ">=5"`) and keep it in devDeps for the tests. **Recommendation: peerDependency + devDependency**, since the adapter genuinely requires the consumer to supply Express.

**Version verification (npm, 2026-06-24):**
- express `5.2.1` (dist-tags: latest=5.2.1, latest-4=4.22.2), created 2010, 110.6M downloads/week, no postinstall.
- @types/express `5.0.6`.
- supertest `7.2.2`, created 2012, 15.6M downloads/week, no postinstall, deps: methods/superagent/cookie-signature.
- @types/supertest `7.2.0`, not deprecated, deps: @types/methods/@types/superagent.

## Package Legitimacy Audit

> slopcheck was **not available** at research time (`pip install slopcheck` failed in this environment). Per protocol, packages are tagged `[ASSUMED]` for slopcheck status. However, all four are CLAUDE.md-locked, npm-registry-verified, decade-old, and have postinstall-free, extremely high download counts — the residual risk is near zero. The planner SHOULD still gate the install behind a single `checkpoint:human-verify` (one checkpoint for all four) per protocol.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| express | npm | ~16 yrs (2010) | 110.6M/wk | github.com/expressjs/express | [ASSUMED — slopcheck unavailable] | Approved (CLAUDE.md-locked, verified) |
| @types/express | npm | DefinitelyTyped | (bundled w/ DT) | github.com/DefinitelyTyped/DefinitelyTyped | [ASSUMED] | Approved |
| supertest | npm | ~14 yrs (2012) | 15.6M/wk | github.com/ladjs/supertest | [ASSUMED] | Approved (CLAUDE.md-locked, verified) |
| @types/supertest | npm | DefinitelyTyped | (bundled w/ DT) | github.com/DefinitelyTyped/DefinitelyTyped | [ASSUMED] | Approved (REQUIRED — supertest ships no types) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**Postinstall scripts checked:** express → none; supertest → none. Both clean.

*Because slopcheck was unavailable, the planner should add ONE `checkpoint:human-verify` before the install task confirming the four package names — then proceed.*

## IETF RateLimit Headers (the key research item — RESOLVED)

### Current draft: `draft-ietf-httpapi-ratelimit-headers-11`
- Latest version is **-11**, expires **2026-11-24**. `[CITED: datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers]`
- Built on **RFC 9651 Structured Field Values** (the -11 update references RFC 9651; earlier drafts referenced RFC 8941). `[CITED: draft-ietf-httpapi-ratelimit-headers-11]`

### CONTEXT's example syntax is OUTDATED
The CONTEXT example `RateLimit: limit=10, remaining=1, reset=5` + `RateLimit-Policy: 10;w=60` is the **draft-07/08 dictionary form** and should NOT be emitted. Draft-11 refactored both fields into **Lists of Items**, each Item being a String (the policy name) with parameters. `[CITED: draft-ietf-httpapi-ratelimit-headers-11 §"Recent Changes"]`

### Exact draft-11 syntax to emit

**`RateLimit-Policy`** — a List of *Quota Policy* Items. Per policy:
- String identifier (policy name, e.g. `"default"`)
- `q` (REQUIRED): non-negative integer quota allocated (in quota units)
- `w` (OPTIONAL): time window in **seconds**
- `qu` (OPTIONAL): quota unit, default `"requests"` (omit — default is correct here)
- `pk` (OPTIONAL): partition key (omit — not needed)

**`RateLimit`** — a List of *Service Limit* Items. Per limit:
- String identifier (policy name, MUST correspond to a `RateLimit-Policy` name)
- `r` (REQUIRED): non-negative integer remaining quota (in quota units)
- `t` (OPTIONAL): effective window in **seconds** — "the number of seconds within which the client can use no more than the available quota"
- `pk` (OPTIONAL): omit

**Verbatim spec examples** `[CITED: draft-ietf-httpapi-ratelimit-headers-11]`:
```
RateLimit-Policy: "burst";q=100;w=60,"daily";q=1000;w=86400
RateLimit: "default";r=50;t=30
```
```
RateLimit-Policy: "basic";q=100;w=60
RateLimit: "basic";r=60;t=58
```

### Concrete form THIS middleware emits

Single policy, named `"default"`. Mapping from `Decision`:

```
RateLimit-Policy: "default";q=<Decision.limit>;w=<windowSeconds>
RateLimit:        "default";r=<Decision.remaining>;t=<ceil(Decision.resetMs/1000)>
```

- `q` = `Decision.limit` (D-12: capacity for Token Bucket, `limit` for windows).
- `r` = `Decision.remaining` (D-04: already a floored integer — emit as-is, D3-06).
- `t` = `ceil(resetMs/1000)` (delta-seconds, consistent with D3-05).
- `w` = the policy's configured window in seconds. **OPEN: see "windowSeconds source" below.**

### `windowSeconds` source (small open item for the planner)
`w` (policy window) and `t` (effective window) are NOT the same as `resetMs`. `resetMs` is *time to full replenishment now*; `w` is the *configured* window/interval. The `Decision` type does NOT carry the configured window. Two options:
1. **Derive `t` from `resetMs`** (`ceil(resetMs/1000)`) and **omit `w`** from `RateLimit-Policy` (it's OPTIONAL). Simplest; spec-valid. **Recommended.**
2. Pass a `policy`/`windowSeconds` value into `rateLimit(options)` so `RateLimit-Policy` can advertise the static `w`. More complete but adds an option the `Decision` can't supply on its own.
Recommendation: **emit `t` from `resetMs`, make `w` optional** — if the caller supplies a window in options, include it; otherwise omit `w`. The `RateLimit` line (with `r` + `t`) is the one clients act on; `RateLimit-Policy` is explicitly informative ("MAY be ignored", §7.10).

### Standards cross-checks (HIGH confidence)
- **RateLimit-Policy is OPTIONAL** and informative — "MAY be ignored" (§7.10). `[CITED: draft-11 §7.10]`
- **Headers MAY be sent on any status code, including 429** — "A server MAY return RateLimit header fields independently of the response status code. This includes throttled responses." (§6.1). Satisfies D3-04 (emit on rejected responses). `[CITED: draft-11 §6.1]`
- **Retry-After + RateLimit interaction:** "If a response contains both the Retry-After and the RateLimit header fields, the Retry-After field value SHOULD NOT reference a point in time earlier than the end of the effective window" (§6.4), and "the Retry-After field MUST take precedence" (§7.11). **Implication:** ensure `Retry-After ≥ t` is consistent. Since both derive from the same `Decision` (`retryAfterMs ≤ resetMs` by construction — retry is when *one* slot frees, reset is when *full* replenishment occurs), `Retry-After (ceil(retryAfterMs/1000)) ≤ t (ceil(resetMs/1000))`, which satisfies the SHOULD. `[CITED: draft-11 §6.4, §7.11]`

### Legacy `X-RateLimit-*` (D3-04, emitted alongside)
There is **no formal spec** for `X-RateLimit-*` — it is a de-facto convention (GitHub/Twitter-style). The widely-recognized triple:
```
X-RateLimit-Limit:     <Decision.limit>
X-RateLimit-Remaining: <Decision.remaining>
X-RateLimit-Reset:     <ceil(Decision.resetMs/1000)>   # delta-seconds per D3-05 (NOT epoch)
```
Note: GitHub's `X-RateLimit-Reset` is **epoch seconds**; D3-05 deliberately diverges to keep ONE unit (delta-seconds) across all headers. This is a defensible, documented choice — the DESIGN.md (Phase 4, DELIV-04) explains it. `[ASSUMED — X-RateLimit-* is convention, not a spec; delta-seconds is the project's locked choice per D3-05]`

## Header Mapping Table (prescriptive — the planner encodes this exactly)

Given a `Decision { allowed, limit, remaining, resetMs, retryAfterMs }` and optional configured `windowSeconds`:

| HTTP Header | Value | Source | Notes |
|-------------|-------|--------|-------|
| `RateLimit-Policy` | `"default";q=<limit>[;w=<windowSeconds>]` | `Decision.limit`, optional window | `w` omitted if no window supplied (OPTIONAL per spec) |
| `RateLimit` | `"default";r=<remaining>;t=<ceil(resetMs/1000)>` | `Decision.remaining`, `Decision.resetMs` | the actionable header |
| `X-RateLimit-Limit` | `<limit>` | `Decision.limit` | legacy |
| `X-RateLimit-Remaining` | `<remaining>` | `Decision.remaining` | integer, already floored (D-04) |
| `X-RateLimit-Reset` | `<ceil(resetMs/1000)>` | `Decision.resetMs` | delta-seconds (D3-05), NOT epoch |
| `Retry-After` | `<ceil(retryAfterMs/1000)>` | `Decision.retryAfterMs` | **only on 429** (RFC 9110 §10.2.3 delta-seconds) |

All six rate-limit headers are set on **allowed AND rejected** responses (HTTP-03). `Retry-After` is set **only** when rejected (its semantics are "when to retry" — meaningless on an allowed response).

## Architecture Patterns

### System Architecture Diagram

```
HTTP request
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Express app  (sets `trust proxy` → populates req.ip)     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ rateLimit(options) middleware  (src/adapters/express/)   │
│                                                          │
│  1. key = keyGenerator(req) ?? req.ip                    │
│     ├─ empty? → log warn (DegradedLogger), next()  ─────┐│  D3-03
│     │                                                   ││
│  2. try { decision = await limiter.consume(key) }       ││
│     catch (err) → policy:                                ││  D3-07
│        ├─ fail-open  → setHeaders?, next()  ───────────┐││
│        └─ fail-closed → 429 + Retry-After + headers ──┐│││
│                                                       ││││
│  3. setHeaders(res, decision)  (IETF + legacy)        ││││  D3-04
│        ├─ decision.allowed → next()  ─────────────────┼┼┼┼─► route handler
│        └─ !allowed → 429 + Retry-After + body  ───────┴┴┴┴─► client (429)
└─────────────────────────────────────────────────────────┘
            │ (opaque key, never parsed)
            ▼
   RateLimiter.consume(key)  ──►  Store op  ──►  Decision
   (core — imports NOTHING from Express)
```

### Recommended Project Structure
```
rate-limiter/src/
├── index.ts                      # core barrel — UNCHANGED, no Express
├── types.ts                      # RateLimiter/Decision/RateLimitPolicy/DegradedLogger (reused)
├── validate.ts                   # assertPolicy reused
├── adapters/
│   └── express/
│       ├── index.ts              # adapter barrel: export { rateLimit } + option types
│       ├── middleware.ts         # rateLimit(options) => RequestHandler
│       └── headers.ts            # setRateLimitHeaders(res, decision, opts) + delta-seconds helper
└── adapters/express/*.test.ts    # supertest suites (HTTP-01..04)
```

### Pattern 1: Express 5 middleware factory (RequestHandler)
**What:** A factory returns a typed `RequestHandler`. Validate options at factory time (mirrors limiter construction validation — reuse `assertPolicy`).
**When to use:** the `rateLimit(options)` entry (D3-09).
**Example:**
```typescript
// Source: Express 5 docs (expressjs.com/en/guide/using-middleware.html) + project pattern
import type { RequestHandler, Request, Response } from "express";
import type { Decision, RateLimiter, RateLimitPolicy, DegradedLogger } from "../../types.js";
import { assertPolicy } from "../../validate.js";

export interface RateLimitOptions {
  limiter: RateLimiter;                              // required
  keyGenerator?: (req: Request) => string | null | undefined;
  policy?: RateLimitPolicy;                          // default "fail-open"
  headers?: "both" | "ietf" | "legacy" | false;     // default "both"
  windowSeconds?: number;                            // optional, for RateLimit-Policy `w`
  handler?: (req: Request, res: Response, decision: Decision) => void;
  message?: string;
  logger?: DegradedLogger;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  if (options.limiter == null) {
    throw new TypeError("rateLimit: `limiter` is required");
  }
  const policy: RateLimitPolicy = options.policy ?? "fail-open";
  assertPolicy("rateLimit", policy);                 // reuse construction-time validator
  const keyOf = options.keyGenerator ?? ((req: Request) => req.ip);

  // Express 5: an async middleware that REJECTS propagates to the error handler
  // automatically. We deliberately DO NOT rely on that — we catch consume()
  // ourselves to apply the fail-open/closed policy (D3-07/D3-09).
  return async (req, res, next) => {
    const key = keyOf(req);
    if (key == null || key === "") {
      options.logger?.warn({ path: req.path }, "rate-limit: empty key, admitting"); // D3-03
      return next();
    }
    let decision: Decision;
    try {
      decision = await options.limiter.consume(key);
    } catch (err) {
      options.logger?.warn({ err, key }, "rate-limit: limiter error");              // D3-08
      if (policy === "fail-open") return next();                                     // D3-07
      // fail-closed: deny. (Headers unavailable — no Decision; send a bare 429.)
      res.status(429).json({ error: "Too Many Requests" });
      return;
    }
    setRateLimitHeaders(res, decision, options);       // D3-04, on ALL paths
    if (decision.allowed) return next();
    sendThrottled(req, res, decision, options);        // D3-02/D3-10: 429 + Retry-After + body
  };
}
```

### Pattern 2: Header serialization helper (delta-seconds at the edge)
**What:** A pure `setRateLimitHeaders(res, decision, opts)` that does the `ceil(ms/1000)` conversion at the boundary (D-09 / D3-05) and writes both header families.
**Example:**
```typescript
// Source: draft-ietf-httpapi-ratelimit-headers-11 + RFC 9110 §10.2.3
const toSeconds = (ms: number): number => Math.ceil(ms / 1000);

export function setRateLimitHeaders(res: Response, d: Decision, opts: RateLimitOptions): void {
  const mode = opts.headers ?? "both";
  if (mode === false) return;
  const resetS = toSeconds(d.resetMs);
  if (mode === "both" || mode === "ietf") {
    const wPart = opts.windowSeconds != null ? `;w=${opts.windowSeconds}` : "";
    res.setHeader("RateLimit-Policy", `"default";q=${d.limit}${wPart}`);
    res.setHeader("RateLimit", `"default";r=${d.remaining};t=${resetS}`);
  }
  if (mode === "both" || mode === "legacy") {
    res.setHeader("X-RateLimit-Limit", String(d.limit));
    res.setHeader("X-RateLimit-Remaining", String(d.remaining));
    res.setHeader("X-RateLimit-Reset", String(resetS));   // delta-seconds (D3-05)
  }
}
```

### Pattern 3: subpath export + second tsup entry
**What:** Ship the adapter as `rate-limiter/express` without leaking Express into the core entry.
**Example — `package.json` `exports`:**
```jsonc
"exports": {
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./express": { "types": "./dist/adapters/express/index.d.ts", "import": "./dist/adapters/express/index.js" }
}
```
**Example — `tsup.config.ts` (add the second entry):**
```typescript
entry: ['src/index.ts', 'src/adapters/express/index.ts'],   // was: ['src/index.ts']
// format/dts/sourcemap/clean/target unchanged; onSuccess lua-copy unchanged
```
tsup emits each entry preserving directory structure under `dist/`, so `src/adapters/express/index.ts` → `dist/adapters/express/index.js`. `[CITED: tsup docs — multiple entry points]`

### Anti-Patterns to Avoid
- **Parsing `X-Forwarded-For` yourself** — D3-02 forbids it; rely on Express `trust proxy`. Re-parsing is a documented IP-spoofing footgun.
- **Importing Express in `types.ts`, the limiters, or the core barrel** — breaks the tier boundary. Express is confined to `src/adapters/express/**`.
- **Using an off-the-shelf limiter** (`express-rate-limit`, `rate-limiter-flexible`) — FORBIDDEN by CLAUDE.md.
- **Epoch seconds in `X-RateLimit-Reset`** — D3-05 mandates delta-seconds for unit consistency. Do not copy GitHub's epoch convention.
- **Emitting the old draft-07 dictionary form** (`RateLimit: limit=10, remaining=1, reset=5`) — superseded by draft-11 List-of-Items.
- **Leaking `consume()` rejections to the Express error handler** — D3-09: catch in the middleware to apply the fail-open/closed policy. (Express 5 *would* auto-propagate, but that bypasses the policy.)
- **Re-flooring or re-deriving `remaining`/`limit`** — D3-06: map `Decision` fields straight through.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Extracting client IP behind a proxy | Custom XFF parser | Express `app.set('trust proxy', …)` + `req.ip` | Express handles the trust-boundary logic; hand-rolling XFF parsing is a spoofing vuln (D3-02). |
| Async error catching in middleware | A custom `asyncHandler` wrapper | Plain `try/catch` around `await consume()` | Express 5 auto-propagates rejections; and D3-07 needs an explicit catch anyway for the policy. |
| HTTP test harness | `http.createServer` + manual port + fetch | supertest | supertest binds an ephemeral server and asserts status/headers/body in-process. |
| Structured-field header building | A generic RFC 9651 serializer | Direct string templates for the two fixed headers | Only ONE policy item is emitted; a full structured-field library is overkill (anti-slop). |

**Key insight:** This middleware is intentionally thin. The hard correctness work (algorithms, atomicity, fail-open/closed in the store) is already done in Phases 1–2. The adapter's only jobs are key extraction (delegated to Express), straight-through header mapping, and a try/catch policy — resist adding anything more.

## Common Pitfalls

### Pitfall 1: Emitting the outdated IETF header form
**What goes wrong:** Using `RateLimit: limit=10, remaining=1, reset=5` (draft-07 dictionary) instead of draft-11's `RateLimit: "default";r=1;t=5` (List of Items).
**Why it happens:** CONTEXT's example and most blog posts predate draft-09's structural refactor.
**How to avoid:** Emit named-item form: `RateLimit: "<name>";r=<n>;t=<sec>` and `RateLimit-Policy: "<name>";q=<n>;w=<sec>`.
**Warning signs:** No quoted policy name in the header; `limit=`/`remaining=`/`reset=` keys present.

### Pitfall 2: Split reset units (epoch vs delta-seconds)
**What goes wrong:** `X-RateLimit-Reset` as epoch seconds while `RateLimit`'s `t` is delta-seconds — HTTP-03 explicitly grades "consistent reset unit."
**How to avoid:** ALL of `t`, `X-RateLimit-Reset`, `Retry-After` use `ceil(ms/1000)` delta-seconds (D3-05).
**Warning signs:** A header value in the billions (epoch), or any use of `Date.now()` in the header path.

### Pitfall 3: `req.ip` is `undefined` without `trust proxy`, or empty in tests
**What goes wrong:** Behind a proxy with no `trust proxy`, `req.ip` is the proxy IP; in some supertest setups `req.ip` can be `undefined`/`::ffff:127.0.0.1`.
**Why it happens:** `req.ip` derives from socket + `trust proxy`. supertest connects over loopback.
**How to avoid:** D3-03 already handles empty key (admit + warn). In tests, prefer an explicit `keyGenerator` (e.g. read a test header) so key extraction is deterministic and the IP path is documented separately.
**Warning signs:** Tests pass with `req.ip` but the limiter sees `undefined` keys in practice.

### Pitfall 4: fail-closed path has no `Decision` to build headers from
**What goes wrong:** On a `consume()` rejection under fail-closed, there is no `Decision`, so the rate-limit headers can't be populated from real data.
**Why it happens:** The error path bypasses the store entirely.
**How to avoid:** Send a bare `429` (optionally a `Retry-After` of a small constant if you want a hint) without fabricating `RateLimit` values. Document this. The supertest assertion for HTTP-04 checks status + no-crash, not header fidelity on the error path.
**Warning signs:** Trying to read `decision.remaining` inside the `catch`.

### Pitfall 5: `headers` already sent before middleware writes them
**What goes wrong:** If a `handler` override writes the response before `setRateLimitHeaders` runs, `res.setHeader` throws `ERR_HTTP_HEADERS_SENT`.
**How to avoid:** Set headers BEFORE calling `handler`/sending the body (the patterns above set headers first, then branch).
**Warning signs:** `Cannot set headers after they are sent` in tests.

## Code Examples

### 429 response & Retry-After (D3-10 / HTTP-02)
```typescript
// Source: RFC 9110 §10.2.3 (Retry-After delta-seconds) + D3-10
function sendThrottled(req: Request, res: Response, d: Decision, opts: RateLimitOptions): void {
  res.setHeader("Retry-After", String(Math.ceil(d.retryAfterMs / 1000)));  // delta-seconds
  if (opts.handler) return opts.handler(req, res, d);                       // caller override
  res
    .status(429)
    .json({ error: opts.message ?? "Too Many Requests", retryAfterMs: d.retryAfterMs });
}
```

### supertest verification (HTTP-01..03, in-memory store, no Redis)
```typescript
// Source: supertest README + project Phase 1/2 test patterns
import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { MemoryStore, TokenBucketLimiter, FakeClock } from "../../index.js";
import { rateLimit } from "./index.js";

it("admits then 429s with Retry-After + headers", async () => {
  const clock = new FakeClock(0);
  const limiter = new TokenBucketLimiter(new MemoryStore(), { capacity: 1, refillPerInterval: 1, intervalMs: 1000 }, clock);
  const app = express();
  app.use(rateLimit({ limiter, keyGenerator: () => "k1" }));   // deterministic key
  app.get("/", (_req, res) => res.send("ok"));

  const ok = await request(app).get("/");
  expect(ok.status).toBe(200);
  expect(ok.headers["ratelimit"]).toMatch(/^"default";r=0;t=\d+$/);
  expect(ok.headers["x-ratelimit-remaining"]).toBe("0");

  const blocked = await request(app).get("/");
  expect(blocked.status).toBe(429);
  expect(blocked.headers["retry-after"]).toBeDefined();
  expect(blocked.headers["ratelimit-policy"]).toContain('"default";q=1');
});
```

### HTTP-04 fail-open/closed via throwing stub (D3-08)
```typescript
// Source: D3-08 — a stub RateLimiter whose consume rejects
const boom: RateLimiter = { consume: () => Promise.reject(new Error("store down")) };

it("fail-open admits on limiter error", async () => {
  const app = express();
  app.use(rateLimit({ limiter: boom, keyGenerator: () => "k", policy: "fail-open" }));
  app.get("/", (_req, res) => res.send("ok"));
  const r = await request(app).get("/");
  expect(r.status).toBe(200);            // admitted, no crash
});

it("fail-closed denies on limiter error", async () => {
  const app = express();
  app.use(rateLimit({ limiter: boom, keyGenerator: () => "k", policy: "fail-closed" }));
  app.get("/", (_req, res) => res.send("ok"));
  const r = await request(app).get("/");
  expect(r.status).toBe(429);            // denied, no unhandled rejection
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `RateLimit: limit=10, remaining=1, reset=5` (dictionary, draft-07/08) | `RateLimit: "default";r=1;t=5` + `RateLimit-Policy: "default";q=10;w=60` (List of Items, RFC 9651) | draft-09 → -11 (current) | The header form THIS phase emits must be the new one. |
| Express 4 + `asyncHandler` wrapper | Express 5 native async error propagation | Express 5 (now `latest`) | No wrapper needed; but D3-07 still uses explicit try/catch for policy. |
| `@types/express@^4` | `@types/express@^5` | with Express 5 | Use v5 types. |
| supertest bundled `.d.ts` (some versions) | `@types/supertest` required | supertest 7.x ships no `types` field | Must add `@types/supertest@^7.2`. |

**Deprecated/outdated:**
- draft-07/08 RateLimit dictionary syntax — replaced by List-of-Items in draft-09+.
- Epoch-seconds `X-RateLimit-Reset` (GitHub style) — project chooses delta-seconds (D3-05) for unit consistency.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `X-RateLimit-*` is a de-facto convention with no formal spec; delta-seconds reset is the project's locked choice (D3-05), diverging from GitHub's epoch. | IETF / Legacy headers | LOW — D3-05 is locked; this is documented intent, not a spec compliance claim. |
| A2 | slopcheck status for express/@types/express/supertest/@types/supertest is `[ASSUMED]` (tool unavailable). All four are CLAUDE.md-locked, npm-verified, decade-old, postinstall-free. | Package Legitimacy Audit | NEAR-ZERO — manual verification covered name, registry, age, downloads, postinstall. Planner adds one human-verify checkpoint. |
| A3 | Emitting `t` from `resetMs` and omitting `w` (unless supplied) is spec-valid and sufficient. | IETF — windowSeconds source | LOW — `w` is OPTIONAL per spec; `RateLimit` (r+t) is the actionable header. |
| A4 | Declaring `express` as a peerDependency (not runtime dep) is the correct packaging for a library adapter. | Standard Stack / Installation | LOW — standard practice; for a graded challenge, devDep alone also works. Planner's call. |

**Note:** A2/A4 are decisions the planner can finalize; A1/A3 are already constrained by locked decisions (D3-05) and the spec.

## Open Questions

1. **`RateLimit-Policy` `w` (window) source**
   - What we know: `Decision` carries `resetMs` (time to replenishment) but NOT the configured window.
   - What's unclear: whether to surface a `windowSeconds` option or omit `w`.
   - Recommendation: omit `w` by default; include it only if `rateLimit({ windowSeconds })` is supplied. `RateLimit` (`r`+`t` from `resetMs`) is sufficient and spec-valid.

2. **`express` as devDep vs peerDep**
   - What we know: the adapter requires the consumer to bring Express.
   - Recommendation: `peerDependencies: { "express": ">=5" }` + keep in devDeps for tests. For the challenge, devDep-only is acceptable.

3. **`headers` option exposure**
   - Recommendation: expose `headers?: "both" | "ietf" | "legacy" | false`, default `"both"` (satisfies D3-04 out of the box). Cheap, and demonstrates the design is configurable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime + tests | ✓ | v24.15.0 | — (matches CLAUDE.md LTS pin) |
| Vitest | Test runner | ✓ | 4.1.9 (installed) | — |
| express | Adapter + tests | ✗ (not yet installed) | install ^5.1 (5.2.1) | none — must install (devDep) |
| supertest | HTTP tests | ✗ (not yet installed) | install ^7.2 (7.2.2) | none — must install (devDep) |
| Redis / Docker | **NOT needed this phase** | n/a | — | Phase 3 runs entirely against the in-memory store (D3 boundary). |

**Missing dependencies with no fallback:** `express`, `@types/express`, `supertest`, `@types/supertest` — all four must be installed (single `npm install -D`). These are the only blockers and are CLAUDE.md-locked.
**Missing dependencies with fallback:** none.

## Security Domain

> `security_enforcement` is not set in config (absent = enabled). Included; scope is narrow for a transport adapter.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Middleware does not authenticate; key may be an API-key/user-id supplied by `keyGenerator`, but auth itself is out of scope. |
| V3 Session Management | no | Stateless per-request. |
| V4 Access Control | partial | Rate limiting IS an access-control mechanism (throttling). The fail-open default (D3-07) is an availability-over-strictness choice — documented. |
| V5 Input Validation | yes | `assertPolicy` validates the `policy` option at factory time; `keyGenerator` output is treated opaquely (no injection surface — key never reaches a query). |
| V6 Cryptography | no | No crypto in this adapter. |

### Known Threat Patterns for Express middleware

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IP spoofing via forged `X-Forwarded-For` to evade or impersonate a rate-limit key | Spoofing | Rely on Express `trust proxy` set correctly to the deployment's proxy depth; never parse XFF in the middleware (D3-02). Document that the proxy MUST strip/overwrite inbound `X-Forwarded-For`. |
| Rate-limit bypass via empty/forged key | Tampering | D3-03 admits + logs on empty key (visibility); a `keyGenerator` should derive from an authenticated identity where available. |
| Unhandled rejection / DoS via store error crashing the process | Denial of Service | D3-07 try/catch + fail-open/closed policy; HTTP-04 proves no unhandled rejection (supertest). |
| Header injection via key/policy values | Tampering | Header values here are derived from numeric `Decision` fields and a fixed `"default"` policy name — no user-controlled string is interpolated into a header. Keep it that way. |

## Sources

### Primary (HIGH confidence)
- `draft-ietf-httpapi-ratelimit-headers-11` — datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers-11 — current syntax (List of Items: `q`/`w`/`r`/`t`), §6.1 (headers on throttled responses), §6.4/§7.10/§7.11 (Retry-After interaction, policy informative). Expires 2026-11-24.
- ietf-wg-httpapi.github.io/ratelimit-headers/ — editor's copy, verbatim examples.
- expressjs.com/en/guide/behind-proxies.html — `req.ip` / `trust proxy` population + XFF spoofing warning.
- expressjs.com/en/guide/error-handling.html — Express 5 async error propagation.
- npm registry (`npm view`, 2026-06-24) — express 5.2.1, @types/express 5.0.6, supertest 7.2.2 (no bundled types), @types/supertest 7.2.0; postinstall-free; download counts.
- Codebase: `rate-limiter/src/types.ts`, `index.ts`, `validate.ts`, `tsup.config.ts`, `package.json`, `limiters/token-bucket.ts` — exact contracts the middleware reuses.

### Secondary (MEDIUM confidence)
- RFC 9110 §10.2.3 — `Retry-After` delta-seconds semantics (referenced by the draft; not fetched directly this session but corroborated by the draft's §6.4 alignment language).

### Tertiary (LOW confidence)
- `X-RateLimit-*` legacy header conventions — no formal spec; treated as `[ASSUMED]` (A1).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package CLAUDE.md-locked and npm-verified with versions/postinstall/downloads.
- IETF header syntax: HIGH — fetched current draft-11 directly with verbatim examples; identified and corrected the outdated CONTEXT example.
- Architecture / patterns: HIGH — thin adapter over an existing, well-typed core; reuses established codebase patterns (subpath, validation, tier boundary).
- Pitfalls: HIGH — grounded in spec details and the existing `Decision`/build wiring.
- Legacy `X-RateLimit-*`: MEDIUM — convention, not spec; project choice (delta-seconds) is locked.

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable; the only fast-moving item is the IETF draft, which could advance past -11 — re-check datatracker if planning slips past the draft's 2026-11-24 expiry).
