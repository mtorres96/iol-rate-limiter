---
phase: quick-260625-tce
plan: 01
subsystem: docs
tags: [docs, diagram, quickstart, readme, design]
requires: []
provides:
  - "rate-limiter/docs/request-flow.png (author's hand-drawn request-flow sequence diagram)"
  - "DESIGN.md request-flow subsection embedding the diagram via relative path"
  - "README explicit one-command full-stack Quickstart"
affects:
  - rate-limiter/DESIGN.md
  - rate-limiter/README.md
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - rate-limiter/docs/request-flow.png
  modified:
    - rate-limiter/DESIGN.md
    - rate-limiter/README.md
decisions:
  - "Embedded the diagram as a short '### Request flow (sequence diagram)' subsection under DESIGN.md §1 (Architecture overview), matching the existing numbered-section tone, rather than a new top-level numbered section"
  - "README pointer kept to a single cross-reference line from the existing 'Request path' Mermaid block to DESIGN.md (lean README, no re-embed)"
  - "Quickstart documents the already-live full stack as a 4-item bullet list of access points + a cross-reference to the Observability section (no duplication of full detail)"
metrics:
  duration: "5 min"
  completed: "2026-06-25"
  tasks: 2
  files: 3
requirements: [DOCS-DIAGRAM, DOCS-QUICKSTART]
---

# Quick Task 260625-tce: Author Sequence Diagram + One-Command Quickstart Summary

Added the author's own hand-drawn request-flow sequence diagram (Cliente → Backend (TypeScript) → Redis per-window counter) to the rate-limiter docs and made the single-command full-stack Docker startup explicit in the README Quickstart — docs + one image asset only, verify gate stays green.

## What Was Done

### Task 1 — Commit the hand-drawn diagram + embed in DESIGN.md + README pointer
- Copied `/Users/manulocal/Desktop/diagrama.png` (117 KB) into the repo at `rate-limiter/docs/request-flow.png`; the Desktop original was left untouched.
- DESIGN.md: added a `### Request flow (sequence diagram)` subsection under §1 "Architecture overview" that embeds the image via the **relative** `./docs/request-flow.png` path, with English alt text and a 3–4 line English caption explaining the per-window counter, the 200/OK-while-within-limit → 429/Retry-After-once-exceeded behavior, and noting it is the author's hand-drawn, Spanish-labeled diagram.
- README.md: added a single one-line pointer from the existing "Request path" Mermaid block to the request-flow diagram in DESIGN.md.
- Commit: `e7101b5`

### Task 2 — Explicit one-command full-stack Quickstart
- README.md "Quickstart — one command": updated the command to `docker compose up --build` and added a concise statement + 4-item bullet list making explicit that one command brings the whole stack up out of the box with no extra setup: app on :3000 (Swagger UI `/docs`, Prometheus metrics `/metrics`), Redis (healthchecked, internal-only), Prometheus :9090, and Grafana :3001 opening directly on the pre-provisioned "Rate Limiter — Allowed vs Blocked" dashboard. Cross-references the existing Observability section rather than duplicating its detail. Existing route/limit facts preserved.
- Commit: `898ebb5`

## Verification

- `cd rate-limiter && npm run verify` → **exit 0** (Docker daemon up). 135 tests pass across 20 files; coverage 100% statements / 98.4% branches / 100% functions / 100% lines; `eslint .` clean.
- Files changed across both commits: exactly `rate-limiter/docs/request-flow.png`, `rate-limiter/DESIGN.md`, `rate-limiter/README.md` — no `.ts`, `docker-compose.yml`, or config files.
- Desktop original `/Users/manulocal/Desktop/diagrama.png` confirmed intact.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

- `e7101b5` docs(quick-260625-tce): add author hand-drawn request-flow diagram
- `898ebb5` docs(quick-260625-tce): make one-command full-stack Quickstart explicit

## Self-Check: PASSED

- FOUND: rate-limiter/docs/request-flow.png
- FOUND: commit e7101b5
- FOUND: commit 898ebb5
