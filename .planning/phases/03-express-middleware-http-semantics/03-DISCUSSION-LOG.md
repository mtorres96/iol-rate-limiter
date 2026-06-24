# Phase 3: Express Middleware & HTTP Semantics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 03-express-middleware-http-semantics
**Areas discussed:** Client key extraction, Header mapping & reset unit, Error / fail-open policy, Middleware API & 429 body
**Language:** Discussion conducted in Spanish at user request (CONTEXT.md kept in English for downstream agents).

---

## Client key extraction (HTTP-01 / CORE-05)

| Option | Description | Selected |
|--------|-------------|----------|
| req.ip + optional keyGenerator override | Default req.ip; optional `keyGenerator(req)` to override; `trust proxy` is the app's documented responsibility; null key → admit + log | ✓ |
| keyGenerator mandatory | No IP default; user must supply keyGenerator | |
| req.ip, error if no key | Default req.ip; error (500) when no key resolves | |

**User's choice:** req.ip + optional keyGenerator override (Recommended)
**Notes:** Keeps key opaque to the core; demo works out of the box. → D3-01/02/03.

---

## Header mapping & reset unit (HTTP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| IETF + legacy, delta-seconds | Current IETF `RateLimit`/`RateLimit-Policy` (structured fields) + legacy `X-RateLimit-*`; reset & Retry-After in delta-seconds; consistent unit | ✓ |
| Legacy X-RateLimit-* + Retry-After only | Simpler; only legacy headers | |
| X-RateLimit-Reset as epoch | Legacy reset in epoch-seconds, rest delta | |

**User's choice:** IETF + legacy, delta-seconds (Recommended)
**Notes:** Consistent unit is the graded subtlety; epoch rejected to avoid mixed units. → D3-04/05/06.

---

## Error / fail-open policy (HTTP-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Middleware owns its own policy | try/catch around consume(); configurable fail-open/closed (default fail-open); verified via throwing stub limiter | ✓ |
| Delegate 100% to store | Trust store never throws; let exceptions reach Express error handler | |
| Always fail-open, not configurable | Admit on any error, no knob | |

**User's choice:** Middleware owns its own policy (Recommended)
**Notes:** RedisStore already resolves its policy internally and never throws, so a middleware-level policy is the only way to supertest HTTP-04 without Redis. → D3-07/08.

---

## Middleware API & 429 body

| Option | Description | Selected |
|--------|-------------|----------|
| Factory + 429 JSON + optional handler | `rateLimit({...})` factory; 429 JSON `{error, retryAfterMs}`; custom handler/message; headers always | ✓ |
| Factory + 429 plain text | Same factory, plain-text 429, minimal options | |
| Factory + 429 no body | Status + headers only, optional custom handler | |

**User's choice:** Factory + 429 JSON, optional handler (Recommended)
**Notes:** JSON body is friendliest for the Phase 4 demo and API clients. → D3-09/10.

---

## Claude's Discretion

- Exact IETF draft version / structured-field syntax for `RateLimit` / `RateLimit-Policy` (researcher confirms against current draft).
- Adapter file layout + build wiring: `src/adapters/express/` subpath export, second tsup entry, `express`/`@types/express`/`supertest` devDeps.
- `policy` middleware default = `fail-open` (symmetric with D2-04), configurable.
- `keyGenerator` returning null → skip limiting (admit) + log via `DegradedLogger`.
- `headers` option shape and reset/serialization helper location.

These were presented to the user as a pre-close summary and accepted ("Listo, escribe el CONTEXT").

## Deferred Ideas

- Variable request `cost` through the middleware (EXT-01, v2).
- Allowlist / skip rules (new capability, own phase).
- Per-decision metrics / decision logging (OBS-01/02, v2).
- Non-Express adapter, e.g. Fastify (EXT-02, v2).
