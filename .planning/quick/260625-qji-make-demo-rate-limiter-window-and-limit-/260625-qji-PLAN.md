---
phase: quick-260625-qji
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - rate-limiter/src/demo/server.ts
  - rate-limiter/docker-compose.yml
  - rate-limiter/README.md
autonomous: true
requirements: [DEMO-CONFIG]

must_haves:
  truths:
    - "Setting RL_LIMIT changes the demo's allowed-request budget without code changes"
    - "Setting RL_WINDOW_MS changes the demo's interval/window without code changes"
    - "Setting RL_REFILL changes the token-bucket refill rate; unset defaults to RL_LIMIT"
    - "Unset/empty env vars preserve the current 5 / 60000 / refill=limit behavior"
    - "A present-but-non-numeric env value fails loud at startup"
    - "docker-compose app service shows the three new tunable vars with current defaults"
    - "README Configuration section documents the new vars with a docker example"
  artifacts:
    - path: "rate-limiter/src/demo/server.ts"
      provides: "env-driven RL_LIMIT / RL_WINDOW_MS / RL_REFILL config with int parsing helper"
      contains: "RL_LIMIT"
    - path: "rate-limiter/docker-compose.yml"
      provides: "RL_LIMIT / RL_WINDOW_MS / RL_REFILL in app environment block"
      contains: "RL_LIMIT"
    - path: "rate-limiter/README.md"
      provides: "Configuration table rows + docker example for the new vars"
      contains: "RL_LIMIT"
  key_links:
    - from: "rate-limiter/src/demo/server.ts buildLimiter"
      to: "process.env.RL_LIMIT / RL_WINDOW_MS / RL_REFILL"
      via: "envInt helper with defaults"
      pattern: "process\\.env\\.RL_(LIMIT|WINDOW_MS|REFILL)"
---

<objective>
Make the demo rate-limiter's limit, window, and (token-bucket) refill configurable via
environment variables, mirroring the existing `RL_ALGO`/`PORT`/`REDIS_URL` env-driven pattern,
so they can be tuned from the Docker command / docker-compose without code changes — and document them.

Purpose: Currently `TINY_LIMIT = 5` and `WINDOW_MS = 60_000` are hardcoded. Operators tuning the
demo must edit source and rebuild. Env-driven config removes that friction.

Output: Updated `server.ts` (env reads + parsing helper), `docker-compose.yml` (visible knobs),
and `README.md` Configuration docs.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md

@rate-limiter/src/demo/server.ts
@rate-limiter/docker-compose.yml
@rate-limiter/README.md
@rate-limiter/test/demo.test.ts

<interfaces>
<!-- Limiter config shapes the demo composes against (from server.ts buildLimiter). -->
<!-- Token Bucket: { capacity, refillPerInterval, intervalMs } -->
<!-- Sliding/Fixed Window: { limit, windowMs } -->
<!-- The core limiters already throw RangeError on non-positive/NaN/non-finite config
     (validate.ts convention) — DO NOT re-validate ranges in server.ts; only parse. -->

Current hardcoded defaults (to become DEFAULT_* constants):
  TINY_LIMIT = 5
  WINDOW_MS  = 60_000

Existing env-read pattern in this file:
  process.env.RL_ALGO ?? "token-bucket"
  Number(process.env.PORT ?? DEFAULT_PORT)
  process.env.REDIS_URL
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add env-driven RL_LIMIT / RL_WINDOW_MS / RL_REFILL to server.ts</name>
  <files>rate-limiter/src/demo/server.ts</files>
  <action>
    Rename the two hardcoded constants to defaults: `DEFAULT_LIMIT = 5` and
    `DEFAULT_WINDOW_MS = 60_000` (preserve/adapt the existing WHY-comment above them explaining
    the tiny-limit rationale, and add a short note that they are now the FALLBACK defaults for the
    new env vars).

    Add a small LOCAL parsing helper (a plain function, NOT a new exported core type — server.ts
    must stay composition-only per its top-of-file contract). Signature like
    `function envInt(name: string, fallback: number): number`. Behavior:
    - Read `process.env[name]`. If undefined OR empty string → return `fallback`.
    - Otherwise parse with `Number(raw)`. If the result is NOT a finite number
      (`!Number.isFinite(n)`) → throw a clear `Error` naming the env var and the bad value
      (fail loud at startup, matching the RL_ALGO fail-loud convention). Return the parsed number
      otherwise. Do NOT range-check (positivity/integer-ness) here — the core limiters already
      throw RangeError on non-positive/NaN/non-finite config; lean on that.

    In `buildLimiter`, replace the hardcoded uses:
    - `const limit = envInt("RL_LIMIT", DEFAULT_LIMIT);`
    - `const windowMs = envInt("RL_WINDOW_MS", DEFAULT_WINDOW_MS);`
    - `const refill = envInt("RL_REFILL", limit);`  // default refill = limit (preserves current behavior)
    Then feed them in:
    - token-bucket: `{ capacity: limit, refillPerInterval: refill, intervalMs: windowMs }`
    - sliding-window: `{ limit, windowMs }`
    - fixed-window: `{ limit, windowMs }`

    Keep `envInt` defined near the top with the other module-level helpers/constants. Do NOT add
    these helpers/constants to `src/index.ts` (the core barrel stays framework-agnostic — tier
    boundary). Do NOT export `envInt` from the package.
  </action>
  <verify>
    <automated>cd /Users/manulocal/Desktop/iol/rate-limiter && npx tsc --noEmit && grep -E "RL_LIMIT|RL_WINDOW_MS|RL_REFILL" src/demo/server.ts</automated>
  </verify>
  <done>server.ts reads RL_LIMIT/RL_WINDOW_MS/RL_REFILL with DEFAULT_LIMIT/DEFAULT_WINDOW_MS/limit fallbacks; typecheck passes; no new exported types; existing demo.test.ts (which relies on the unchanged 5/60000 defaults) still passes.</done>
</task>

<task type="auto">
  <name>Task 2: Surface the new vars in docker-compose and document them</name>
  <files>rate-limiter/docker-compose.yml, rate-limiter/README.md</files>
  <action>
    docker-compose.yml: in the `app` service `environment:` block, after the existing `RL_ALGO`
    line, add the three new tunable vars with their current defaults shown (as quoted strings,
    matching the `PORT: "3000"` style) and a brief inline comment that they are tunable:
    - `RL_LIMIT: "5"`        # allowed budget (capacity / limit); default 5
    - `RL_WINDOW_MS: "60000"` # interval / window in ms; default 60000
    - `RL_REFILL: "5"`       # token-bucket refill per interval; default = RL_LIMIT

    README.md: in the existing `## Configuration` table, add three rows after `RL_ALGO`:
    - `RL_LIMIT` — default `5` — "Allowed budget per window. Token Bucket: `capacity`. Sliding/Fixed Window: `limit`."
    - `RL_WINDOW_MS` — default `60000` — "Refill interval / window length in ms. Token Bucket: `intervalMs`. Sliding/Fixed Window: `windowMs`."
    - `RL_REFILL` — default `= RL_LIMIT` — "Token Bucket only: tokens refilled per interval (`refillPerInterval`). Ignored by the window algorithms."
    Below the table, add a short docker example showing override at run time, e.g.
    `docker run -e RL_LIMIT=10 -e RL_WINDOW_MS=10000 <image>` and/or a note that the same vars can
    be edited in the compose `app.environment` block. Keep the existing note that an invalid
    `RL_ALGO` fails loud; optionally mention a present-but-non-numeric limit/window also fails loud.

    Do NOT touch DESIGN.md — it does not document these specific demo knobs (it only references the
    composition root reading the environment generically), so no DESIGN change is required.
  </action>
  <verify>
    <automated>cd /Users/manulocal/Desktop/iol/rate-limiter && grep -E "RL_LIMIT|RL_WINDOW_MS|RL_REFILL" docker-compose.yml && grep -E "RL_LIMIT|RL_WINDOW_MS|RL_REFILL" README.md</automated>
  </verify>
  <done>compose app.environment lists RL_LIMIT/RL_WINDOW_MS/RL_REFILL with current-default values; README Configuration table documents all three with per-algorithm meaning and a docker override example.</done>
</task>

</tasks>

<verification>
- `cd rate-limiter && npm run verify` stays green (typecheck + ≥95% four-metric coverage gate + lint).
  Note: `src/demo/**` is excluded from the coverage gate, so no new unit tests are required, but the
  full suite — including `test/demo.test.ts` — must still pass. Defaults are unchanged (5 / 60000 /
  refill=limit), so the existing demo test's 5-request budget assertion holds.
- `grep RL_LIMIT rate-limiter/src/demo/server.ts rate-limiter/docker-compose.yml rate-limiter/README.md` finds all three.
</verification>

<success_criteria>
- RL_LIMIT, RL_WINDOW_MS, RL_REFILL drive the demo limiter config; unset → current behavior.
- Present-but-non-numeric env value throws a clear startup error.
- server.ts remains composition-only (no new exported policy/limiter/store types).
- docker-compose and README document the new vars; DESIGN.md untouched (no demo-knob docs there).
- `npm run verify` passes; coverage gate not lowered.
</success_criteria>

<output>
Create `.planning/quick/260625-qji-make-demo-rate-limiter-window-and-limit-/260625-qji-SUMMARY.md` when done.
</output>
