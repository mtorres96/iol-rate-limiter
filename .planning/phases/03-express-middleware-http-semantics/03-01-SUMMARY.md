---
phase: 03-express-middleware-http-semantics
plan: 01
subsystem: build-and-packaging
tags: [express, packaging, tsup, exports, devdeps, peer-dependency]
requires:
  - "Phase 1 core: rate-limiter package.json + tsup single-entry build"
provides:
  - "express, @types/express, supertest, @types/supertest installed and resolvable"
  - "rate-limiter/express exports subpath -> dist/adapters/express/index.{js,d.ts}"
  - "express declared as peerDependency (>=5), not a runtime dependency"
  - "second tsup entry pointed at src/adapters/express/index.ts (source created in 03-02)"
affects:
  - "rate-limiter/package.json"
  - "rate-limiter/tsup.config.ts"
tech-stack:
  added:
    - "express ^5.2.1 (devDep + peerDep)"
    - "@types/express ^5.0.6 (devDep)"
    - "supertest ^7.2.2 (devDep)"
    - "@types/supertest ^7.2.0 (devDep)"
  patterns:
    - "Subpath export + second tsup entry; tsup preserves dir structure so the adapter emits to dist/adapters/express/"
    - "Adapter framework dep (express) is a peerDependency, kept in devDeps for the test suite"
key-files:
  created: []
  modified:
    - "rate-limiter/package.json"
    - "rate-limiter/tsup.config.ts"
    - "rate-limiter/package-lock.json"
decisions:
  - "express declared as peerDependency (>=5) AND devDep (RESEARCH A4) — adapter requires the consumer to bring Express; never in runtime dependencies (which stays ioredis-only)"
  - "Build is NOT run in this plan: src/adapters/express/index.ts does not exist yet (created in 03-02); build-smoke deferred to 03-03. This plan only verifies config/JSON shape."
metrics:
  duration_min: 1
  tasks: 3
  files: 3
  completed: "2026-06-25"
---

# Phase 03 Plan 01: Express Adapter DevDeps + Build Wiring Summary

Installed the four Express-adapter devDependencies behind an operator-approved package-legitimacy gate and wired the `rate-limiter/express` subpath into both `tsup.config.ts` (second entry) and `package.json` `exports` — without leaking Express into the Express-free core (`.`) entry.

## What Was Built

- **Task 1 (package-legitimacy gate):** Pre-approved by the operator before execution. The operator reviewed all four npm registry pages (express, @types/express, supertest, @types/supertest) — all four were tagged `[ASSUMED]` because slopcheck was unavailable at research time — and explicitly typed "approved". No re-prompt; install proceeded.
- **Task 2 (install + peerDependency):** Ran `npm install -D express@^5.1 @types/express@^5 supertest@^7.2 @types/supertest@^7.2` from `rate-limiter/`. npm resolved these to express `^5.2.1`, @types/express `^5.0.6`, supertest `^7.2.2`, @types/supertest `^7.2.0` (caret-pinned, matching existing style). Added a `peerDependencies` block (`"express": ">=5"`). Left runtime `dependencies` as `ioredis`-only. `require.resolve('express')` and `require.resolve('supertest')` both succeed.
- **Task 3 (build wiring):** Added `src/adapters/express/index.ts` as a second `tsup` entry alongside `src/index.ts`; tsup preserves directory structure, so the adapter will emit to `dist/adapters/express/index.{js,d.ts}`. Added a `"./express"` key to the `exports` map pointing `import`/`types` at that emit. The `format`/`dts`/`sourcemap`/`clean`/`target` settings and the `onSuccess` Lua-copy hook are unchanged; the core `"."` export is unchanged and Express-free.

## Verification

- Task 2 automated check passed: all four devDeps present, `peerDependencies.express` set, express NOT a runtime dependency, both packages resolve from node_modules.
- Task 3 automated check passed: `./express` export points to the correct `dist/adapters/express/index.{js,d.ts}` targets; core `.` export unchanged; `grep -q "src/adapters/express/index.ts" tsup.config.ts` succeeds.
- `npm run typecheck` (`tsc --noEmit`) still passes — confirms the installs did not break the existing type-gate. No new source was added, so no new types to check.
- **Build intentionally NOT run:** `src/adapters/express/index.ts` does not exist yet (created in plan 03-02). Per the plan, build-smoke is deferred to plan 03-03 once the adapter source exists. Running `tsup` now would fail on the missing entry — this is expected and documented, not a defect.

## Deviations from Plan

**1. [Rule 1 - Correctness] Kept requirement HTTP-01 as Pending, not Complete**
- **Found during:** State updates (post-Task 3)
- **Issue:** The plan frontmatter lists `requirements: [HTTP-01]`, which the state machine would mark Complete. But HTTP-01 ("An Express middleware enforces a limiter per extracted client key") is NOT satisfied by this plan — this plan only installs the four devDeps and wires the build/exports; the middleware *source* (`src/adapters/express/index.ts`) is created in plan 03-02 and verified in 03-03. Marking HTTP-01 Complete here would falsely report a working middleware that does not yet exist.
- **Fix:** Reverted HTTP-01 to `[ ]` / `Pending` in `.planning/REQUIREMENTS.md` (both the checklist and the traceability table). HTTP-01 should be marked Complete by the plan that actually delivers the enforcing middleware (03-02/03-03).
- **Files modified:** `.planning/REQUIREMENTS.md`

Otherwise the plan executed exactly as written. Task 1's blocking-human package-legitimacy gate was pre-approved by the operator before this executor ran (per orchestrator context); no other auto-fixes (Rules 1-3) and no architectural decisions (Rule 4) were required.

## Threat Surface

The single `mitigate`-disposition threat (T-03-SC: untrusted npm package code) was handled exactly as the threat register prescribes: the four `[ASSUMED]` packages were confirmed on their registry pages by the operator (correct repos, decade-old, no postinstall) and explicitly approved before any install ran. No new security-relevant surface beyond what the plan's threat_model anticipated. The `./express` subpath (T-03-01, disposition `accept`) only re-points to local `dist/`; no external input crosses it.

## Known Stubs

None. This plan deliberately creates no source files — it only installs deps and points the build/exports at a source path that plan 03-02 will create. The dangling `src/adapters/express/index.ts` reference in `tsup.config.ts`/`exports` is a planned forward-reference, not a stub: it is resolved by 03-02 (source) and verified by 03-03 (build-smoke).

## Self-Check: PASSED

- `rate-limiter/package.json` modified — FOUND (`./express` export + four devDeps + express peerDependency present)
- `rate-limiter/tsup.config.ts` modified — FOUND (`src/adapters/express/index.ts` in entry array)
- Commit `55c6601` (Task 2 install) — FOUND in git log
- Commit `a17d3bb` (Task 3 build wiring) — FOUND in git log
