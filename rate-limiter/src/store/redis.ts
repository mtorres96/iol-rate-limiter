// The distributed `Store` backed by atomic Redis Lua + a defensive wrapper
// (STOR-02/04/05 / DEF-01/02 / D2-04..D2-08).
//
// This is the ONLY file in `src/**` that imports ioredis — the core
// (`types.ts`, the limiters) stays framework/transport-agnostic (the tier
// boundary). The three algorithm scripts ported in plan 02-02 run server-side
// (atomic per EVAL), so a real multi-client Redis race is serialized by Redis
// itself — distinct from the in-memory event-loop atomicity.
//
// Defensive layering on EVERY op (so a flaky/slow/down Redis can never crash or
// hang the caller — DEF-01/DEF-02):
//   1. commandTimeout bounds the round-trip (DEF-01, 50–100ms band).
//   2. A CircuitBreaker short-circuits during an outage (D2-05) — no piled-up
//      timeouts; the policy is applied directly.
//   3. EVERY error path resolves through `degraded()` (the fail-open/closed
//      policy). RedisStore NEVER rejects — there is no `throw` on the op path.

import { readFileSync } from "node:fs";
import Redis from "ioredis";
import type {
  Clock,
  OpTuple,
  RedisStoreConfig,
  Store,
  TBConfig,
  WindowConfig,
} from "../types.js";
import { SystemClock } from "../clock.js";
import { CircuitBreaker } from "./breaker.js";
import { assertPolicy, assertPositiveConfig, assertPrefix } from "../validate.js";

// Load the three Lua scripts at module load. `import.meta.url` resolves against
// the BUILT module, and plan 02-02's tsup `onSuccess` copies `lua/` into
// `dist/store/lua/`, so this works in both `src` (tsx) and `dist` (built).
const TB_LUA = readFileSync(new URL("./lua/token-bucket.lua", import.meta.url), "utf8");
const SW_LUA = readFileSync(new URL("./lua/sliding-window.lua", import.meta.url), "utf8");
const FW_LUA = readFileSync(new URL("./lua/fixed-window.lua", import.meta.url), "utf8");

// ioredis is callable with the defineCommand'd custom commands; they are not on
// the published types, so declare exactly the three we register.
type ScriptClient = Redis & {
  rl_tb(key: string, ...argv: number[]): Promise<[number, number, number, number]>;
  rl_sw(key: string, ...argv: number[]): Promise<[number, number, number, number]>;
  rl_fw(key: string, ...argv: number[]): Promise<[number, number, number, number]>;
};

/** Defaults (D2-04..D2-07) applied to any field the caller omits. */
const DEFAULT_CONFIG: RedisStoreConfig = {
  keyPrefix: "rl", // D2-07
  commandTimeoutMs: 75, // DEF-01: middle of the 50–100ms band
  policy: "fail-open", // D2-04: availability over strictness by default
  breaker: { failureThreshold: 5, cooldownMs: 2000 }, // D2-05
};

export class RedisStore implements Store {
  private readonly client: ScriptClient;
  private readonly breaker: CircuitBreaker;
  private readonly cfg: RedisStoreConfig;

  /**
   * @param client a pre-constructed ioredis client (the caller owns its
   *   connection options — though `commandTimeout`/`maxRetriesPerRequest`/
   *   `enableOfflineQueue` should be set so a down/slow Redis errors fast INTO
   *   the breaker rather than queueing). Use {@link RedisStore.connect} for the
   *   batteries-included path that builds the client with the right options.
   * @param config validated RedisStoreConfig (partial — omitted fields default
   *   per D2-04..D2-07).
   * @param clock  injectable clock for the breaker (FakeClock in tests).
   */
  constructor(client: Redis, config: Partial<RedisStoreConfig> = {}, clock: Clock = SystemClock) {
    this.cfg = {
      ...DEFAULT_CONFIG,
      ...config,
      breaker: { ...DEFAULT_CONFIG.breaker, ...config.breaker },
    };
    // Construction-time validation (T-02-01): reject garbage before any op runs.
    assertPrefix("RedisStore", this.cfg.keyPrefix);
    assertPolicy("RedisStore", this.cfg.policy);
    assertPositiveConfig("RedisStore", "commandTimeoutMs", this.cfg.commandTimeoutMs);
    assertPositiveConfig("RedisStore", "failureThreshold", this.cfg.breaker.failureThreshold);
    assertPositiveConfig("RedisStore", "cooldownMs", this.cfg.breaker.cooldownMs);

    this.client = client as ScriptClient;
    // Register the three scripts as first-class custom commands (D2-08): ioredis
    // caches the SHA and auto-EVALSHAs, falling back to EVAL on NOSCRIPT.
    this.client.defineCommand("rl_tb", { numberOfKeys: 1, lua: TB_LUA });
    this.client.defineCommand("rl_sw", { numberOfKeys: 1, lua: SW_LUA });
    this.client.defineCommand("rl_fw", { numberOfKeys: 1, lua: FW_LUA });

    this.breaker = new CircuitBreaker(
      clock,
      this.cfg.breaker.failureThreshold,
      this.cfg.breaker.cooldownMs,
    );
  }

  /**
   * Batteries-included constructor: builds a single shared ioredis client with
   * the defensive connection options (DEF-01 — fail fast into the breaker) and
   * returns a ready RedisStore. `commandTimeout` comes from the (validated)
   * config so a hung Redis can never block longer than the configured band.
   */
  static connect(
    connection?: string,
    config: Partial<RedisStoreConfig> = {},
    clock: Clock = SystemClock,
  ): RedisStore {
    const commandTimeout = config.commandTimeoutMs ?? DEFAULT_CONFIG.commandTimeoutMs;
    const options = {
      commandTimeout, // DEF-01: bound every round-trip
      maxRetriesPerRequest: 1, // fail fast into the breaker rather than queueing
      enableOfflineQueue: false, // when down, error immediately → policy fires
      lazyConnect: true, // connect on first command, not in the constructor
    };
    const client = connection ? new Redis(connection, options) : new Redis(options);
    return new RedisStore(client, config, clock);
  }

  tokenBucket(key: string, cfg: TBConfig, cost: number, now: number): Promise<OpTuple> {
    const redisKey = `${this.cfg.keyPrefix}:tb:${key}`; // D2-07: rl:tb:<key>
    return this.run(() =>
      this.client.rl_tb(redisKey, now, cfg.capacity, cfg.refillPerInterval, cfg.intervalMs, cost),
    );
  }

  slidingWindow(key: string, cfg: WindowConfig, cost: number, now: number): Promise<OpTuple> {
    const redisKey = `${this.cfg.keyPrefix}:sw:${key}`; // D2-07: rl:sw:<key>
    return this.run(() => this.client.rl_sw(redisKey, now, cfg.limit, cfg.windowMs, cost));
  }

  fixedWindow(key: string, cfg: WindowConfig, cost: number, now: number): Promise<OpTuple> {
    const redisKey = `${this.cfg.keyPrefix}:fw:${key}`; // D2-07: rl:fw:<key>
    return this.run(() => this.client.rl_fw(redisKey, now, cfg.limit, cfg.windowMs, cost));
  }

  /** Close the shared client (test teardown / graceful shutdown). */
  async close(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /**
   * The single defensive seam shared by all three ops (DEF-01/DEF-02). Gate on
   * the breaker; on success record it and return the script's integer tuple; on
   * ANY error/timeout record the failure and resolve through the policy. This
   * method NEVER rejects — a Redis fault can never crash the caller.
   */
  private async run(op: () => Promise<[number, number, number, number]>): Promise<OpTuple> {
    if (!this.breaker.canAttempt()) {
      return this.degraded(); // breaker open → short-circuit, no round-trip
    }
    try {
      const [allowed, remaining, resetMs, retryAfterMs] = await op();
      this.breaker.recordSuccess();
      return [allowed === 1 ? 1 : 0, remaining, resetMs, retryAfterMs];
    } catch {
      // Timeout, connection error, NOSCRIPT-with-no-fallback, etc. — never leak.
      this.breaker.recordFailure();
      return this.degraded();
    }
  }

  /**
   * Apply the fail-open/closed policy when Redis is unavailable (D2-04 / DEF-02).
   * - fail-open  (default): admit. remaining/reset are best-effort (we cannot
   *   know real state); retryAfterMs is 0 since we admitted.
   * - fail-closed: deny. `resetMs` is UNKNOWN while Redis is down — it means "ms
   *   until full replenishment" (types.ts), which has NOTHING to do with the
   *   breaker cooldown (WR-03). Reusing `cooldownMs` for it was a category error,
   *   so it is reported as `0` (unknown, consistent with the fail-open branch).
   *   `retryAfterMs` stays the breaker cooldown — a sensible backoff hint until
   *   Redis is probed again.
   */
  private degraded(): OpTuple {
    if (this.cfg.policy === "fail-open") {
      // [allowed=1, remaining (unknown → 0), resetMs (unknown → 0), retryAfterMs=0]
      return [1, 0, 0, 0];
    }
    // fail-closed: deny with a cooldown-sized retry hint; resetMs unknown (0).
    return [0, 0, 0, this.cfg.breaker.cooldownMs];
  }
}
