import type { Clock } from "./types.js";

/**
 * Wall-clock time source — the default `clock` arg downstream limiters use, so
 * limiters work without callers passing a clock. Wall-clock behavior is
 * intentionally NOT unit-tested; tests exercise the injected `FakeClock` path
 * instead (RESEARCH Pattern 2 / Pitfall 1).
 */
export const SystemClock: Clock = { now: () => Date.now() };

/**
 * Deterministic, timer-free clock for tests.
 *
 * Time advances ONLY via explicit `tick`/`setTime` — no real timers and no
 * fake-timer runner hooks. This is the one custom time abstraction this phase
 * hand-rolls (RESEARCH "Don't Hand-Roll"); everything else is off-the-shelf.
 */
export class FakeClock implements Clock {
  constructor(private t = 0) {}

  /** Current integer-ms time. */
  now(): number {
    return this.t;
  }

  /** Advance time by `ms`. Returns `this` for chaining. */
  tick(ms: number): this {
    this.t += ms;
    return this;
  }

  /** Set the absolute time to `ms`. Returns `this` for chaining. */
  setTime(ms: number): this {
    this.t = ms;
    return this;
  }
}
