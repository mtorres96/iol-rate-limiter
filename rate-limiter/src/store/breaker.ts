// Circuit breaker around the Redis round-trip (DEF-02 / D2-05).
//
// A tiny, in-tree state machine — deliberately NOT a library (RESEARCH
// Anti-Patterns). The whole point (D2-05): during a Redis outage the breaker
// SHORT-CIRCUITS so timeouts don't pile up — `RedisStore` applies its
// fail-open/closed policy directly without touching the network.
//
// State machine:
//   CLOSED → (failureThreshold consecutive failures) → OPEN
//   OPEN   → (cooldownMs elapsed, per the injected Clock) → HALF-OPEN
//   HALF-OPEN: allow exactly ONE probe.
//     probe success → CLOSED (failures reset)
//     probe failure → OPEN  (cooldown restarts from clock.now())
//
// All cooldown timing is driven by the injected `Clock` (the same FakeClock the
// limiters use in tests) — NO real timers and NO `Date.now()` here, so every
// transition is deterministically unit-testable (RESEARCH Pattern 2).

import type { Clock } from "../types.js";

type BreakerState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;

  /**
   * @param clock            injectable time source (FakeClock in tests).
   * @param failureThreshold consecutive failures before the breaker opens (D2-05 default 5).
   * @param cooldownMs       ms the breaker stays open before a single probe (D2-05 default 2000).
   */
  constructor(
    private readonly clock: Clock,
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 2000,
  ) {}

  /**
   * May an op call Redis right now? Pure-ish: the ONLY side effect is the
   * OPEN → HALF-OPEN transition once the cooldown has elapsed, which permits a
   * single probe. Returns `false` only while OPEN (cooldown not yet elapsed).
   */
  canAttempt(): boolean {
    if (this.state === "open" && this.clock.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open"; // allow a single probe
    }
    return this.state !== "open";
  }

  /** A Redis op succeeded: close the breaker and reset the failure count. */
  recordSuccess(): void {
    this.state = "closed";
    this.failures = 0;
  }

  /**
   * A Redis op failed/timed out: count it. Open (or re-open) the breaker when a
   * half-open probe fails OR the consecutive-failure threshold is reached;
   * `openedAt` is stamped to `clock.now()` so the cooldown restarts.
   */
  recordFailure(): void {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.clock.now();
    }
  }
}
