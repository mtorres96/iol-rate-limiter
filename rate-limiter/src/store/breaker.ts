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
  // HALF-OPEN exclusivity (CR-01): once a probe is admitted, every other
  // concurrent `canAttempt()` is rejected until that probe resolves via
  // `recordSuccess`/`recordFailure`. Without this guard, under the `Promise.all`
  // load this store exists for, the WHOLE pending backlog would see `half-open`
  // and fire simultaneous Redis round-trips on recovery — re-flooding a still-
  // recovering Redis and piling up `commandTimeout`s (the exact D2-05 invariant
  // the breaker is supposed to protect).
  private probeInFlight = false;

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
   * May an op call Redis right now? Side effects: the OPEN → HALF-OPEN
   * transition once the cooldown has elapsed, AND claiming the single
   * half-open probe slot.
   *
   * - CLOSED: always `true`.
   * - OPEN (cooldown not yet elapsed): `false`.
   * - HALF-OPEN: `true` for EXACTLY ONE caller (the probe). It sets
   *   `probeInFlight` and every subsequent caller gets `false` until the probe
   *   resolves via {@link recordSuccess} / {@link recordFailure} (CR-01). This
   *   holds under concurrent `Promise.all` callers because `canAttempt()` runs
   *   synchronously to completion on the single-threaded event loop — there is
   *   no `await` between the check and the set, so the first caller claims the
   *   slot before any other observes it.
   */
  canAttempt(): boolean {
    if (this.state === "open" && this.clock.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open"; // allow a single probe
    }
    if (this.state === "half-open") {
      if (this.probeInFlight) return false; // a probe is already out — short-circuit
      this.probeInFlight = true; // claim the single probe slot
      return true;
    }
    return this.state === "closed";
  }

  /** A Redis op succeeded: close the breaker, reset failures, release the probe. */
  recordSuccess(): void {
    this.state = "closed";
    this.failures = 0;
    this.probeInFlight = false; // probe resolved → free the slot
  }

  /**
   * A Redis op failed/timed out: count it. Open (or re-open) the breaker when a
   * half-open probe fails OR the consecutive-failure threshold is reached;
   * `openedAt` is stamped to `clock.now()` so the cooldown restarts. Releases
   * the probe slot so the next post-cooldown caller can probe again.
   */
  recordFailure(): void {
    this.probeInFlight = false; // probe resolved → free the slot
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.clock.now();
    }
  }
}
