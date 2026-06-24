// Shared real-Redis test scaffolding for the Docker-backed suites (TEST-02/03/04).
//
// Three concerns, one file:
//   1. `dockerAvailable()` — a SYNCHRONOUS preflight used by `describe.skipIf(...)`
//      so the Redis-dependent suites skip CLEANLY when no Docker daemon is
//      reachable (T-02-14: missing-Docker is `accept`ed; the non-Docker suites
//      still gate `npm test`). It must be sync because `skipIf` is evaluated at
//      collection time, before any `beforeAll`.
//   2. `startRedis()` — start ONE `redis:7.4-alpine` container (Pitfall 5: one
//      container per FILE, in `beforeAll`, NOT per test).
//   3. `makeRedisStore()` / `stopRedis()` — build a `RedisStore` pointed at the
//      container with an injected `FakeClock` (so `now` is deterministic and the
//      Lua `now` ARGV matches the MemoryStore oracle), and tear it all down.
//
// The container image is pinned (`redis:7.4-alpine`) per CLAUDE.md — never
// `:latest` — so the scripted-counter behavior is reproducible.

import { execFileSync } from "node:child_process";
import Redis from "ioredis";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { RedisStore } from "../../src/index.js";
import type { Clock, RedisStoreConfig } from "../../src/index.js";

const REDIS_IMAGE = "redis:7.4-alpine";

/** Cache the (relatively expensive) liveness probe so `skipIf` is cheap to re-call. */
let dockerProbe: boolean | undefined;

/**
 * SYNCHRONOUS detection of a *reachable, running* Docker daemon.
 *
 * Used by `describe.skipIf(!dockerAvailable())`, which is evaluated at collection
 * time and CANNOT await an async ping. A socket FILE existing is NOT enough —
 * Docker Desktop leaves `~/.docker/run/docker.sock` on disk even when the daemon
 * is stopped, which would make the suite FAIL (container start throws) instead of
 * skip. So we run an actual liveness probe: `docker info` against a dead daemon
 * exits non-zero quickly, against a live one exits 0. The result is cached.
 *
 * An explicit `RL_SKIP_DOCKER=1` forces a skip (CI lanes without Docker). If the
 * `docker` CLI is absent the probe throws and we treat Docker as unavailable.
 */
export function dockerAvailable(): boolean {
  if (process.env.RL_SKIP_DOCKER === "1") return false;
  if (dockerProbe !== undefined) return dockerProbe;

  try {
    // `docker info` talks to the daemon (not just the CLI): exit 0 ⇒ live daemon.
    // A short timeout keeps a hung/unreachable daemon from stalling collection.
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
    dockerProbe = true;
  } catch {
    dockerProbe = false;
  }
  return dockerProbe;
}

/** A started container plus the single shared ioredis client pointed at it. */
export interface RedisHarness {
  container: StartedRedisContainer;
  client: Redis;
}

/**
 * Start ONE pinned `redis:7.4-alpine` container and a single ioredis client
 * connected to it. Call this in `beforeAll` (Pitfall 5). The client is built
 * with the same defensive options `RedisStore.connect` would use so behavior
 * matches production, but here we inject the client directly so several stores
 * (one per algorithm/case) can share the one container without reconnecting.
 */
export async function startRedis(): Promise<RedisHarness> {
  const container = await new RedisContainer(REDIS_IMAGE).start();
  const client = new Redis(container.getConnectionUrl(), {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  // The fault-injection suite deliberately kills/freezes Redis, so the client
  // will emit ECONNREFUSED 'error' events while it retries. The suites assert on
  // the STORE's degraded() behavior, not on raw client errors — swallow them so
  // ioredis doesn't log "Unhandled error event" (and so an unhandled 'error'
  // can't crash the run).
  client.on("error", () => {});
  // `enableOfflineQueue: false` means any command issued before the socket is
  // ready throws "Stream isn't writeable" instead of queueing. The client
  // connects eagerly but asynchronously, so we MUST await the `ready` event
  // before handing it out — otherwise the first `flushall()`/op in a `beforeAll`
  // races the connection and the whole Redis suite fails on a cold start.
  await new Promise<void>((resolve, reject) => {
    const onReady = (): void => {
      client.off("error", onError);
      resolve();
    };
    const onError = (err: Error): void => {
      client.off("ready", onReady);
      reject(err);
    };
    client.once("ready", onReady);
    client.once("error", onError);
  });
  return { container, client };
}

/**
 * Build a `RedisStore` over the harness's shared client + the supplied
 * `FakeClock`. `keyPrefix` is per-case so concurrent cases never collide even
 * without a `flushall` (the conformance runner also flushes between cases).
 */
export function makeRedisStore(
  harness: RedisHarness,
  clock: Clock,
  config: Partial<RedisStoreConfig> = {},
): RedisStore {
  return new RedisStore(harness.client, config, clock);
}

/**
 * Block until `client` can actually serve a command again, by PINGing in a retry
 * loop until one succeeds (or `timeoutMs` elapses).
 *
 * The fault-injection suite stops / restarts / pauses / unpauses the container
 * mid-test. ioredis reconnects ASYNCHRONOUSLY in the background, and because the
 * clients run with `enableOfflineQueue: false`, any command issued during that
 * reconnect window throws "Stream isn't writeable" — which the store turns into a
 * `degraded()` sentinel. Without this gate the NEXT cell's healthy sanity call
 * races the reconnect and flakily sees degraded state instead of real Redis.
 * Uses real wall-clock time (NOT any injected FakeClock) — this is about the
 * socket, not the breaker.
 */
export async function waitReady(client: Redis, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await client.ping();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/** Quit the client and stop the container (call in `afterAll`). */
export async function stopRedis(harness: RedisHarness): Promise<void> {
  await harness.client.quit().catch(() => harness.client.disconnect());
  await harness.container.stop();
}
