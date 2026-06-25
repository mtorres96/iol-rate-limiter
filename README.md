# IOL — System Design Implementation Challenge

This repository is my submission for IOL's **System Design Implementation Challenge**
(based on the rate-limiter chapter of *System Design Interview — An Insider's Guide, Vol 1*
by Alex Xu).

## ➜ The solution lives in [`/rate-limiter`](./rate-limiter)

A distributed **rate limiter** in TypeScript/Node.js: a framework-agnostic core
(Token Bucket, Sliding Window Counter, Fixed Window Counter behind one interface,
backed by an in-memory **or** atomic-Lua **Redis** store), an Express middleware
adapter, and a Dockerized demo server with interactive Swagger docs.

Start here:

| Document | What it covers |
|----------|----------------|
| [`rate-limiter/README.md`](./rate-limiter/README.md) | Quickstart (`docker compose up`), the 200→429 demo, configuration, how to run the tests |
| [`rate-limiter/DESIGN.md`](./rate-limiter/DESIGN.md) | Architecture, trade-offs, and **how AI was used** (challenge submission item) |
| [`rate-limiter/COMPLIANCE.md`](./rate-limiter/COMPLIANCE.md) | Brief → evidence map: each challenge requirement pointed at a file/test/doc |

## What else is in this repo

- **[`.planning/`](./.planning)** — the full planning/execution trail (GSD workflow). It is
  kept in the repo deliberately, as transparent evidence of *how* the solution was built with
  AI assistance — the challenge asks contributors to be able to explain every line, and this
  trail is the audit record behind that. `DESIGN.md §8` and `COMPLIANCE.md` reference it.
- **`CLAUDE.md`** — the project instructions / tech-stack rationale given to the AI assistant.

## TL;DR — run it

```bash
cd rate-limiter
docker compose up --build        # app + Redis on http://localhost:3000
# then: curl http://localhost:3000/api/ping   (5 allowed, then 429)
#       open http://localhost:3000/docs        (Swagger UI)
```
