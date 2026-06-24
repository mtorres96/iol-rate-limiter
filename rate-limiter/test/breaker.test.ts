// Deterministic circuit-breaker state-machine tests (DEF-02 / D2-05).
//
// Every cooldown transition is driven by `FakeClock` — NO real timers, NO
// `setTimeout`, NO `Date.now()`. `.tick(ms)`/`.setTime(ms)` cross the cooldown
// boundary exactly, so each closed/open/half-open transition is proven
// deterministically (RESEARCH Pattern 2 / Pitfall 1).

import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/clock.js";
import { CircuitBreaker } from "../src/store/breaker.js";

// Defaults under test (D2-05): 5 failures opens; 2000ms cooldown; 1 probe.
const THRESHOLD = 5;
const COOLDOWN = 2000;

describe("CircuitBreaker", () => {
  it("starts closed and allows attempts", () => {
    const breaker = new CircuitBreaker(new FakeClock(0), THRESHOLD, COOLDOWN);
    expect(breaker.canAttempt()).toBe(true);
  });

  it("closed: recordSuccess keeps it closed and resets the failure count", () => {
    const breaker = new CircuitBreaker(new FakeClock(0), THRESHOLD, COOLDOWN);
    // 4 failures (one short of the threshold) ...
    for (let i = 0; i < THRESHOLD - 1; i++) breaker.recordFailure();
    expect(breaker.canAttempt()).toBe(true);
    // ... a success resets the count, so the NEXT 4 failures must not open it.
    breaker.recordSuccess();
    for (let i = 0; i < THRESHOLD - 1; i++) breaker.recordFailure();
    expect(breaker.canAttempt()).toBe(true);
  });

  it("closed → open: opens after exactly `failureThreshold` consecutive failures", () => {
    const breaker = new CircuitBreaker(new FakeClock(0), THRESHOLD, COOLDOWN);
    for (let i = 0; i < THRESHOLD - 1; i++) {
      breaker.recordFailure();
      expect(breaker.canAttempt()).toBe(true); // still closed before the 5th
    }
    breaker.recordFailure(); // the 5th
    expect(breaker.canAttempt()).toBe(false); // now open
  });

  it("open: stays open (no probe) until the cooldown has fully elapsed", () => {
    const clock = new FakeClock(0);
    const breaker = new CircuitBreaker(clock, THRESHOLD, COOLDOWN);
    for (let i = 0; i < THRESHOLD; i++) breaker.recordFailure(); // opened at t=0
    expect(breaker.canAttempt()).toBe(false);

    clock.tick(COOLDOWN - 1); // 1ms short of the cooldown
    expect(breaker.canAttempt()).toBe(false);
  });

  it("open → half-open: admits EXACTLY ONE probe; further attempts short-circuit until it resolves (CR-01)", () => {
    const clock = new FakeClock(0);
    const breaker = new CircuitBreaker(clock, THRESHOLD, COOLDOWN);
    for (let i = 0; i < THRESHOLD; i++) breaker.recordFailure(); // opened at t=0

    clock.setTime(COOLDOWN); // cooldown elapsed (>= boundary)
    // First call transitions open → half-open and CLAIMS the single probe slot.
    expect(breaker.canAttempt()).toBe(true);
    // The probe is in flight (not yet resolved): every subsequent attempt is
    // short-circuited so we never flood a recovering Redis with concurrent probes.
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.canAttempt()).toBe(false);
  });

  it("half-open burst: of N synchronous (Promise.all-shaped) attempts, EXACTLY ONE is admitted (CR-01)", () => {
    const clock = new FakeClock(0);
    const breaker = new CircuitBreaker(clock, THRESHOLD, COOLDOWN);
    for (let i = 0; i < THRESHOLD; i++) breaker.recordFailure(); // opened at t=0

    clock.setTime(COOLDOWN); // cooldown elapsed → next attempt half-opens
    // Mirror RedisStore.run() under Promise.all: every pending caller calls
    // canAttempt() synchronously (no await between the gate and the round-trip),
    // then the awaited op resolves later. The breaker must admit exactly one as
    // the probe and short-circuit the rest.
    const N = 20;
    const admitted = Array.from({ length: N }, () => breaker.canAttempt()).filter(Boolean).length;
    expect(admitted).toBe(1); // exactly ONE probe reaches Redis; the other N-1 short-circuit

    // The single probe then resolves the breaker for everyone.
    breaker.recordSuccess();
    expect(breaker.canAttempt()).toBe(true); // CLOSED again
  });

  it("half-open probe failure releases the slot so the NEXT post-cooldown caller can re-probe (CR-01)", () => {
    const clock = new FakeClock(0);
    const breaker = new CircuitBreaker(clock, THRESHOLD, COOLDOWN);
    for (let i = 0; i < THRESHOLD; i++) breaker.recordFailure(); // opened at t=0

    clock.setTime(COOLDOWN);
    expect(breaker.canAttempt()).toBe(true); // probe slot claimed
    expect(breaker.canAttempt()).toBe(false); // concurrent callers short-circuit
    breaker.recordFailure(); // probe failed → re-open, slot released, cooldown restarts

    // Still open before the restarted cooldown — no leaked half-open admit.
    clock.setTime(COOLDOWN + COOLDOWN - 1);
    expect(breaker.canAttempt()).toBe(false);
    // After the restarted cooldown, a single fresh probe is admitted again ...
    clock.setTime(COOLDOWN + COOLDOWN);
    expect(breaker.canAttempt()).toBe(true);
    // ... and exclusivity holds on the new probe too.
    expect(breaker.canAttempt()).toBe(false);
  });

  it("half-open → closed: a probe success closes the breaker and resets failures", () => {
    const clock = new FakeClock(0);
    const breaker = new CircuitBreaker(clock, THRESHOLD, COOLDOWN);
    for (let i = 0; i < THRESHOLD; i++) breaker.recordFailure();

    clock.setTime(COOLDOWN);
    expect(breaker.canAttempt()).toBe(true); // → half-open probe
    breaker.recordSuccess(); // probe succeeded → closed

    // Fully closed: a fresh threshold-1 burst must NOT re-open (failures reset).
    for (let i = 0; i < THRESHOLD - 1; i++) breaker.recordFailure();
    expect(breaker.canAttempt()).toBe(true);
  });

  it("half-open → open: a probe failure re-opens and RESTARTS the cooldown", () => {
    const clock = new FakeClock(0);
    const breaker = new CircuitBreaker(clock, THRESHOLD, COOLDOWN);
    for (let i = 0; i < THRESHOLD; i++) breaker.recordFailure(); // opened at t=0

    clock.setTime(COOLDOWN);
    expect(breaker.canAttempt()).toBe(true); // → half-open probe
    breaker.recordFailure(); // probe failed → re-open, openedAt = COOLDOWN
    expect(breaker.canAttempt()).toBe(false);

    // Cooldown restarted from t=COOLDOWN: still open 1ms before the new boundary.
    clock.setTime(COOLDOWN + COOLDOWN - 1);
    expect(breaker.canAttempt()).toBe(false);
    // ... and half-open again once the restarted cooldown elapses.
    clock.setTime(COOLDOWN + COOLDOWN);
    expect(breaker.canAttempt()).toBe(true);
  });
});
