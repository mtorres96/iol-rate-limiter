// Demo HTTP server (DELIV-01) — the composition root that wires Phases 1–3
// together end-to-end and is the artifact the Docker image (plan 02) runs.
//
// This is a NEW top tier. It is the ONLY module allowed to import BOTH the core
// barrel (the stores + limiters) AND the Express adapter subpath — it composes
// them but introduces NO new policy/limiter/store types. Nothing here is added to
// `src/index.ts`: the core barrel stays framework-agnostic (the tier boundary,
// mirrored by store/redis.ts being the only ioredis importer and adapters/express
// being the only Express importer).
//
// Runtime selection is env-driven (D4-01/D4-02):
//   - REDIS_URL set   → RedisStore.connect(url) (the real distributed path, compose).
//   - REDIS_URL unset → MemoryStore (zero-Docker fallback, so `tsx`/`node` runs bare).
//   - RL_ALGO         → token-bucket (default) | sliding-window | fixed-window.
//                       Any other value fails LOUD at startup (RangeError) — the
//                       codebase's construct-time-validation convention (validate.ts),
//                       never a silent default.
//
// Route ordering is load-bearing (D4-03 / T-04-01): /health is registered BEFORE
// the limiter middleware so the healthcheck is never throttled and never consumes
// budget; /api/ping is registered AFTER it so it IS rate-limited. The demo passes
// ONLY `{ limiter }` to rateLimit (D4-04) — it keeps the `req.ip` default key and
// does NOT override the key extractor.

import express from "express";
import swaggerUi from "swagger-ui-express";

import { openapiSpec } from "./openapi.js";
import {
  FixedWindowLimiter,
  MemoryStore,
  RedisStore,
  SlidingWindowLimiter,
  TokenBucketLimiter,
} from "../index.js";
import type { RateLimiter, Store } from "../index.js";
import { rateLimit } from "../adapters/express/index.js";

/** Default listen port when `PORT` is unset. */
const DEFAULT_PORT = 3000;

/**
 * Tiny limits (D4-03): small enough that a short curl/test loop reaches the 429,
 * making the over-limit behavior trivially observable in the demo. Token Bucket
 * and the two window algorithms take DIFFERENT config shapes (the config-field
 * trap — see types.ts): TB = { capacity, refillPerInterval, intervalMs }; the
 * windows = { limit, windowMs }.
 *
 * These are now the FALLBACK defaults for the env-driven knobs below
 * (RL_LIMIT / RL_WINDOW_MS / RL_REFILL): unset/empty env → these values, so the
 * demo's out-of-the-box behavior is unchanged.
 */
const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Parse an integer-ish env var, fail loud on a present-but-bad value. Local to the
 * composition root (NOT an exported core type — server.ts stays composition-only):
 *   - undefined or empty string → `fallback` (preserves default behavior).
 *   - otherwise Number(raw); if not finite → throw naming the var + bad value
 *     (matching the RL_ALGO fail-loud convention).
 * No range/positivity/integer check here — the core limiters already throw
 * RangeError on non-positive/NaN/non-finite config (validate.ts); lean on that.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite number, got "${raw}"`);
  }
  return n;
}

/**
 * Select the store by REDIS_URL (D4-01). Returns the store plus a `close()` so
 * the lifecycle handler can release the connection on shutdown. RedisStore.connect
 * is batteries-included (it sets the defensive ioredis options itself), so the
 * demo passes ONLY the URL — it does not hand-build an ioredis client.
 */
export function buildStore(): { store: Store; close: () => Promise<void> } {
  const url = process.env.REDIS_URL;
  if (url) {
    const store = RedisStore.connect(url);
    return { store, close: () => store.close() }; // close() = redis.ts (quit w/ 1s race → disconnect)
  }
  return { store: new MemoryStore(), close: async () => {} };
}

/**
 * Select the limiter by RL_ALGO (D4-02, default token-bucket). Any value outside
 * the three known algorithms throws a RangeError at startup (fail loud — the
 * validate.ts convention), so a typo in the env never silently picks a default.
 */
export function buildLimiter(store: Store): RateLimiter {
  const algo = process.env.RL_ALGO ?? "token-bucket";
  const limit = envInt("RL_LIMIT", DEFAULT_LIMIT);
  const windowMs = envInt("RL_WINDOW_MS", DEFAULT_WINDOW_MS);
  const refill = envInt("RL_REFILL", limit); // default refill = limit (preserves current behavior)
  switch (algo) {
    case "token-bucket":
      return new TokenBucketLimiter(store, {
        capacity: limit,
        refillPerInterval: refill,
        intervalMs: windowMs,
      });
    case "sliding-window":
      return new SlidingWindowLimiter(store, { limit, windowMs });
    case "fixed-window":
      return new FixedWindowLimiter(store, { limit, windowMs });
    default:
      throw new RangeError(
        `RL_ALGO must be token-bucket|sliding-window|fixed-window, got "${algo}"`,
      );
  }
}

/**
 * Compose the demo Express app: store → limiter → middleware → routes. Returns
 * the configured `app` (so tests can drive it via supertest without binding a
 * port) plus `close()` to release the store. Importing this module does NOT start
 * a server — see {@link start} for the entrypoint behavior.
 */
export function buildApp(): { app: express.Express; close: () => Promise<void> } {
  const { store, close } = buildStore();
  const limiter = buildLimiter(store);

  const app = express();

  // /health is registered BEFORE the limiter → unlimited (T-04-01): an external
  // healthcheck must never be throttled or consume the limiter budget.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // D-07: docs registered outside the limiter (like /health) so the Swagger UI's
  // many static-asset requests are never throttled (throttling /docs breaks the
  // page). Prefix mount only — no bare `*` wildcard (Express-5 path-to-regexp@8 safe).
  app.get("/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

  // From here on, every route is rate-limited per req.ip (D4-04: lean on the
  // rateLimit defaults — no key-extractor override).
  app.use(rateLimit({ limiter }));

  app.get("/api/ping", (_req, res) => {
    res.status(200).json({ pong: true });
  });

  return { app, close };
}

/**
 * Entrypoint: build the app, listen, and wire graceful shutdown. SIGTERM/SIGINT
 * close the HTTP server (stop accepting connections), then close the store, then
 * exit 0. An unref'd safety-net timeout forces exit(1) if a close hangs so a stuck
 * shutdown can never wedge the container (paired with compose `init: true`).
 */
export function start(): void {
  const { app, close } = buildApp();
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  const server = app.listen(port, () => {
    // The demo is an app, so a startup line on stdout is expected and intended.
    console.log(`demo rate-limiter listening on :${port}`);
  });

  const shutdown = (signal: string): void => {
    console.log(`received ${signal}, shutting down`);
    server.close(() => {
      void close().then(() => process.exit(0));
    });
    // Safety net: if server.close()/store close() hangs, force exit. unref() so
    // this timer itself never keeps the event loop alive.
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Start a real server ONLY when run as the entrypoint (node dist/demo/server.js /
// tsx src/demo/server.ts) — never on import (so the smoke test can build the app
// without binding a port). import.meta.url vs process.argv[1] is the ESM analog of
// `require.main === module`.
const isEntrypoint =
  process.argv[1] != null &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntrypoint) {
  start();
}
