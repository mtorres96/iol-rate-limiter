---
phase: 04-demo-docker-design-md
verified: 2026-06-25T02:30:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 4: Demo, Docker & DESIGN.md — Verification Report

**Phase Goal:** The solution is reproducibly deployable with one command and is documented to a
graded standard, passing the mandatory final verification gate from a clean checkout.
**Verified:** 2026-06-25T02:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Running the demo server with no REDIS_URL starts on MemoryStore and serves GET /api/ping | VERIFIED | `buildStore()` in server.ts checks `process.env.REDIS_URL`; falls back to `new MemoryStore()`. Test passes 122/122. |
| 2  | GET /health returns 200 and is never rate-limited (never returns 429) | VERIFIED | `/health` registered before `app.use(rateLimit(...))` at line 104 of server.ts. test/demo.test.ts exhausts ping budget, then asserts health still 200. |
| 3  | GET /api/ping returns 200 until tiny limit exceeded, then 429 with Retry-After | VERIFIED | `/api/ping` is behind `app.use(rateLimit({limiter}))`. test/demo.test.ts asserts 200×5 then 429 with Retry-After header. |
| 4  | Setting RL_ALGO to an unknown value makes the server fail loud (RangeError) | VERIFIED | `buildLimiter()` default branch: `throw new RangeError(...)` at line 84 of server.ts. test/demo.test.ts asserts `expect(() => buildApp()).toThrow(RangeError)` for bad RL_ALGO. |
| 5  | tsup build emits dist/demo/server.js so the Docker runtime image has an entrypoint | VERIFIED | tsup.config.ts entry array includes `src/demo/server.ts`. `dist/demo/server.js` confirmed present after build. build-smoke.test.ts asserts it. |
| 6  | npm run verify runs typecheck then full Vitest suite as a single command | VERIFIED | package.json: `"verify": "npm run typecheck && npm run test"`. Executed: 122/122 tests passed, tsc --noEmit clean. |
| 7  | `docker compose up` builds the image and starts app + redis together with no manual steps | VERIFIED | docker-compose.yml: two services, `app: build: .`, redis:7.4-alpine, `depends_on redis condition: service_healthy`. SUMMARY confirms end-to-end test passed (200×5 → 429 via real Redis). |
| 8  | The app container runs as the non-root node user | VERIFIED | Dockerfile line: `USER node` (runtime stage). Both stages on `node:24-alpine`. |
| 9  | The app container HEALTHCHECK hits /health without curl/wget (Node global fetch) | VERIFIED | Dockerfile: `CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`. |
| 10 | Under compose the demo uses the real Redis path (REDIS_URL=redis://redis:6379) | VERIFIED | docker-compose.yml env: `REDIS_URL: redis://redis:6379`. Redis has no host port mapping (internal only). |
| 11 | DESIGN.md documents architecture, all locked trade-offs, and an honest AI-usage section | VERIFIED | 274 lines. Covers: atomic Lua, fixed-window boundary burst, concurrency guarantee, fail-open/closed (with rejected-alternatives table), delta-seconds convention, verify gate, Docker prerequisite, Claude Code / GSD AI-usage section. |
| 12 | README leads with docker compose up quickstart, 200→429 curl, Docker-required note, two Mermaid diagrams | VERIFIED | 164 lines, 2 mermaid blocks. Leads with `docker compose up`, shows 200×6 → 429 loop with Retry-After, Docker-required section, env-vars table matching server.ts values. |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `rate-limiter/src/demo/server.ts` | Composition root: env-driven store+limiter, /health outside, /api/ping inside, RangeError on bad algo, SIGTERM | VERIFIED | 159 lines. All behaviors present and tested. No keyGenerator override (0 occurrences). |
| `rate-limiter/tsup.config.ts` | Third tsup entry for demo server | VERIFIED | entry: `['src/index.ts', 'src/adapters/express/index.ts', 'src/demo/server.ts']`. |
| `rate-limiter/package.json` | verify + start + dev scripts; tsx in devDeps; express in deps | VERIFIED | All scripts confirmed. `tsx ^4.22.4` in devDependencies only. `express ^5.2.1` in dependencies. |
| `rate-limiter/Dockerfile` | Multi-stage node:24-alpine, non-root, Node-fetch HEALTHCHECK, exec-form CMD | VERIFIED | 2× `FROM node:24-alpine`, `USER node`, `npm ci --omit=dev`, `CMD ["node","dist/demo/server.js"]`, Node fetch healthcheck. No `:latest` tags. |
| `rate-limiter/.dockerignore` | Excludes node_modules, dist, .git, test, .planning | VERIFIED | All five patterns confirmed present. |
| `rate-limiter/docker-compose.yml` | app + redis:7.4-alpine, depends_on service_healthy, init:true, REDIS_URL, no version key | VERIFIED | All criteria satisfied. Redis has no host port. No top-level `version:` key. |
| `rate-limiter/DESIGN.md` | Architecture + trade-offs + honest AI-usage section (min 60 lines) | VERIFIED | 274 lines. All must-have topics present. |
| `rate-limiter/README.md` | Quickstart + 200→429 curl + Docker-required note + 2 Mermaid diagrams (min 40 lines) | VERIFIED | 164 lines, 2 mermaid blocks. |
| `rate-limiter/test/demo.test.ts` | D4-03 route contract: /health never 429, /api/ping admits then 429 | VERIFIED | 80 lines. Three tests: health never throttled, ping 200→429, bad RL_ALGO RangeError. |
| `rate-limiter/test/build-smoke.test.ts` | Asserts dist/demo/server.js exists and is non-empty | VERIFIED | `demo/server.js` in expressSubpathAssets array; tested under `beforeAll` real build. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/demo/server.ts` | core barrel + express adapter | `import ... from "../index.js"` and `import {rateLimit} from "../adapters/express/index.js"` | WIRED | Both import lines confirmed. `rateLimit` called at line 110 with `{ limiter }`. |
| `tsup.config.ts` | `dist/demo/server.js` | third entry in array | WIRED | Entry `'src/demo/server.ts'` present. Build confirms `dist/demo/server.js` emitted (2.32 KB). |
| `Dockerfile CMD` | `dist/demo/server.js` | exec-form `CMD ["node", "dist/demo/server.js"]` | WIRED | Dockerfile line confirmed. Script `npm run start` mirrors the same path. |
| `docker-compose.yml app` | redis service | `REDIS_URL=redis://redis:6379` + `depends_on redis condition: service_healthy` | WIRED | Both wires confirmed. Redis has no host port (internal only). |
| `README.md quickstart` | `docker-compose.yml` | `docker compose up` command | WIRED | README leads with `docker compose up`; matches the compose file exactly. |
| `README.md verify note` | `package.json scripts.verify` | documents Docker required for `npm run verify` | WIRED | README states "Start Docker before running `npm run verify`"; DESIGN.md §7 also documents this. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/demo/server.ts buildStore()` | `process.env.REDIS_URL` | Env at runtime | Yes — branches to real `RedisStore.connect(url)` or `new MemoryStore()` | FLOWING |
| `src/demo/server.ts buildLimiter()` | `process.env.RL_ALGO` | Env at runtime; default `token-bucket` | Yes — constructs real limiter with `TINY_LIMIT=5` params; throws RangeError on invalid | FLOWING |
| `src/demo/server.ts /api/ping` | `rateLimit({ limiter })` middleware | Real limiter backed by real store | Yes — 122 tests pass; build-smoke confirms build; SUMMARY confirms Redis path via compose | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `npm run verify` completes with 122 tests | `cd rate-limiter && npm run verify` | 16 test files, 122 tests passed. tsc --noEmit clean. | PASS |
| `dist/demo/server.js` emitted by build | `test -f dist/demo/server.js` | EXISTS (2.32 KB) | PASS |
| `dist/lua/` contains Lua scripts | `ls dist/lua/` | `fixed-window.lua`, `sliding-window.lua`, `token-bucket.lua` present | PASS |
| Dockerfile has no `:latest` tags | `grep ':latest' Dockerfile` | No matches | PASS |
| docker-compose.yml has no top-level `version:` | `grep -E '^version:' docker-compose.yml` | No matches | PASS |
| Redis has no host port in compose | inspect docker-compose.yml redis service | redis service has no `ports:` key; `ports:` belongs to app service only | PASS |

---

### Probe Execution

No probe scripts declared for this phase. Behavioral spot-checks above serve as the verification layer (Step 7b).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DELIV-01 | 04-01 | Demo HTTP server wiring the middleware end-to-end | SATISFIED | `src/demo/server.ts` with env-driven store+limiter, /health outside limiter, /api/ping inside, SIGTERM shutdown. Tested in test/demo.test.ts. |
| DELIV-02 | 04-02 | `docker compose up` starts demo + Redis together (multi-stage, non-root, healthcheck) | SATISFIED | Dockerfile and docker-compose.yml verified against all PLAN acceptance criteria. SUMMARY confirms end-to-end compose run. |
| DELIV-03 | 04-01 | `npm run verify` (typecheck + full test suite) passes from clean checkout | SATISFIED | Executed live: 122/122 tests pass, tsc --noEmit clean. |
| DELIV-04 | 04-03 | DESIGN.md documents architecture and trade-offs with honest AI-usage section | SATISFIED | 274-line DESIGN.md covering all six required trade-offs + AI-usage section naming Claude Code / GSD workflow. |
| DELIV-06 | 04-03 | README provides one-command quickstart with curl example and Mermaid diagrams | SATISFIED | 164-line README with `docker compose up` quickstart, 200→429 curl, Docker-required note, two Mermaid blocks. |

All five phase requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `Dockerfile` | 24 | Stale comment: `dist/store/lua/*.lua` — the actual runtime path is `dist/lua/` (fixed in plan 02) | INFO | Zero functional impact. The `COPY --from=build /app/dist ./dist` command copies the entire `dist/` tree including `dist/lua/`. The runtime chunk resolves `./lua/` relative to its location in `dist/`, confirming `dist/lua/` is correct. Comment is stale, code is correct. |

No `TBD`, `FIXME`, or `XXX` markers found in any phase-04 deliverable. No unreferenced debt markers. No placeholder/stub patterns. No empty return values in rendered paths.

---

### Human Verification Required

None. All success criteria are programmatically verifiable and verified. The compose end-to-end run was validated during plan 02's execution (SUMMARY documents `/health` → 200, `/api/ping` → 200×5 then 429 via real Redis Lua path).

---

### Gaps Summary

No gaps. All 12 must-haves verified, all 5 requirements satisfied, all key links wired, build gate live-tested at 122/122.

The only finding is the stale Dockerfile comment on line 24 (INFO/cosmetic). It has no functional impact: the COPY command is correct, the runtime chunk resolves the correct `dist/lua/` path, and tests confirm this (122 pass including Redis integration and build-smoke tests).

---

_Verified: 2026-06-25T02:30:00Z_
_Verifier: Claude (gsd-verifier)_
