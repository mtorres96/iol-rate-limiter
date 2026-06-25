// The in-memory reference implementation of the three rate-limiting algorithms.
//
// This is the human-readable REFERENCE the Phase-2 Lua script ports near
// line-by-line (CONTEXT D-06 / "specific ideas"). Optimize for clarity over
// cleverness (APOSD deep module). Each algorithm lives ENTIRELY inside its
// Store op — the limiter only assembles the public Decision (D-06/D-07).
//
// Concurrency model — EVENT-LOOP ATOMICITY (STOR-01 / RESEARCH Pitfall 2):
// Each op is a SINGLE synchronous read-modify-write critical section. There is
// NO `await` anywhere inside an op, so Node's single-threaded event loop runs it
// to completion before any other consume() observes the state. That is the
// guarantee — there is intentionally NO mutex/lock (the loop IS the lock). The
// concurrency test (plan 01-04) proves exactly `limit` admitted under N
// overlapping calls.
//
// Async contract (D2-01): each op's return type is `Promise<OpTuple>` to match
// the uniform `Store` contract the RedisStore also implements. The synchronous
// read-modify-write body is UNCHANGED — the only async-ness is wrapping the
// already-computed tuple in `Promise.resolve(...)` at the return. There is still
// NO `await` inside any critical section, so event-loop atomicity is preserved.
//
// Rounding contract (LOCKED — pinned in comments on every outgoing duration and
// on `remaining` because the Phase-2 Lua must reproduce these bit-for-bit for
// TEST-02 conformance):
//   - `remaining`    → Math.floor  (D-04)
//   - `resetMs`      → Math.ceil   (durations: never under-report)
//   - `retryAfterMs` → Math.ceil   (durations: never under-report; 0 when allowed)
// Integer ms cross the op boundary (D-09); fractional token counts stay INSIDE
// `TBState` only.

import type { OpTuple, Store, TBConfig, WindowConfig } from "../types.js";

/** Token Bucket internal state — `tokens` may be fractional (stays internal, D-09). */
type TBState = { tokens: number; lastRefill: number };

/**
 * Window internal state (shared shape for fixed + sliding).
 *
 * `bucket` is the window index `floor(now / windowMs)`. `curr` is the count in
 * that bucket; `prev` is the count in the immediately previous bucket (used only
 * by the sliding-window weighted estimate — fixed window ignores it).
 */
type WindowState = { bucket: number; curr: number; prev: number };

type AlgoState = TBState | WindowState;

/**
 * In-memory reference Store. One `Map` entry per distinct key.
 *
 * NOTE (T-01-08, accepted): the key-space grows unbounded (no TTL/eviction) —
 * this is an intentional, documented limitation of the single-node reference
 * store; the Redis store (Phase 2) sets a key TTL inside Lua. Surfaced in
 * DESIGN.md (Phase 4).
 */
export class MemoryStore implements Store {
  private readonly state = new Map<string, AlgoState>();

  /**
   * Token Bucket (ALGO-01 / D-10): lazily refill `refillPerInterval` tokens per
   * `intervalMs`, clamped to `capacity`; admit when `cost <= tokens`.
   */
  tokenBucket(key: string, cfg: TBConfig, cost: number, now: number): Promise<OpTuple> {
    // (1) load state or init a FULL bucket at `now`.
    const s = (this.state.get(key) as TBState | undefined) ?? {
      tokens: cfg.capacity,
      lastRefill: now,
    };

    // (2) lazy refill. Recompute `elapsed` from the integer `now` every call —
    // never accumulate fractional ms (avoids 0.1+0.2 drift — Pitfall 3).
    const elapsed = Math.max(0, now - s.lastRefill);
    const refilled = Math.min(
      cfg.capacity,
      s.tokens + (elapsed / cfg.intervalMs) * cfg.refillPerInterval,
    );

    // (3) decide — all-or-nothing (D-01). `cost > capacity` simply fails here
    // without throwing or clamping (D-02): it can never satisfy `cost <= refilled`.
    const allowed: 0 | 1 = cost <= refilled ? 1 : 0;

    // (4) compute next token count — unchanged on reject (D-01: byte-identical).
    const tokensAfter = allowed === 1 ? refilled - cost : refilled;

    // (5) assemble the integer-ms tuple.
    const remaining = Math.floor(tokensAfter); // FLOOR: D-04; matches Lua math.floor(...)
    const deficitToFull = cfg.capacity - tokensAfter;
    const resetMs = Math.ceil((deficitToFull / cfg.refillPerInterval) * cfg.intervalMs); // CEIL: D-05; matches Lua math.ceil(...)
    const need = Math.max(0, cost - refilled);
    const retryAfterMs =
      allowed === 1
        ? 0
        : Math.ceil((need / cfg.refillPerInterval) * cfg.intervalMs); // CEIL: D-03; matches Lua math.ceil(...)

    // persist new state (lastRefill always advances to `now`; tokens reflect the
    // refill even on reject, but `cost` is NOT consumed on reject — D-01).
    this.state.set(key, { tokens: tokensAfter, lastRefill: now });

    // Wrap the already-computed tuple; NO await ran inside the section above.
    return Promise.resolve([allowed, remaining, resetMs, retryAfterMs]);
  }

  /**
   * Sliding Window Counter (ALGO-02 / D-13/D-14): weighted estimate across the
   * current and previous fixed buckets. Admit when
   * `floor(curr + prev*overlapFraction) + cost <= limit`.
   *
   * Pinned regression anchor (D-14, Xu Ch.4): limit=7, prev=5, curr=3, 50% into
   * the current window → floor(3 + 5*0.5) = floor(5.5) = 5; 5 + 1 = 6 <= 7 →
   * admit, remaining = 1.
   */
  slidingWindow(key: string, cfg: WindowConfig, cost: number, now: number): Promise<OpTuple> {
    const bucket = Math.floor(now / cfg.windowMs);

    // (1) load + roll. On a 1-bucket advance, curr→prev; on a >=2-bucket gap the
    // previous window is fully decayed, so prev resets to 0 too.
    const prevState = this.state.get(key) as WindowState | undefined;
    let curr: number;
    let prev: number;
    if (prevState === undefined) {
      curr = 0;
      prev = 0;
    } else if (prevState.bucket === bucket) {
      curr = prevState.curr;
      prev = prevState.prev;
    } else if (prevState.bucket === bucket - 1) {
      prev = prevState.curr;
      curr = 0;
    } else {
      prev = 0;
      curr = 0;
    }

    // (2) weighted estimate. `overlapFraction` = how much of the PREVIOUS window
    // still overlaps the rolling window: 1 at a fresh boundary, →0 as we move in.
    const elapsedInCurrent = now - bucket * cfg.windowMs;
    const overlapFraction = (cfg.windowMs - elapsedInCurrent) / cfg.windowMs;
    const estimate = curr + prev * overlapFraction;
    const flooredEstimate = Math.floor(estimate); // FLOOR: D-13; matches Lua math.floor(...)

    // (3) decide — all-or-nothing (D-01). `cost > limit` fails gracefully (D-02).
    const allowed: 0 | 1 = flooredEstimate + cost <= cfg.limit ? 1 : 0;

    // (4) increment curr ONLY on admit (reject leaves counts byte-identical — D-01).
    const currAfter = allowed === 1 ? curr + cost : curr;

    // (5) assemble the integer-ms tuple.
    const usedAfter = flooredEstimate + (allowed === 1 ? cost : 0);
    const remaining = Math.max(0, cfg.limit - usedAfter); // FLOOR-domain integer (counts) — D-04
    // resetMs: time until the current bucket rolls (the window fully elapses).
    const msToBoundary = (bucket + 1) * cfg.windowMs - now;
    const resetMs = Math.ceil(msToBoundary); // CEIL: D-05; matches Lua math.ceil(...)
    // retryAfterMs: best-effort time until enough previous-window weight decays
    // for the request to fit. If even an empty previous window can't fit (curr
    // alone over the limit), the soonest relief is the next boundary.
    let retryAfterMs: number;
    if (allowed === 1) {
      retryAfterMs = 0;
    } else if (curr + cost > cfg.limit) {
      // curr alone (ignoring all previous weight) already exceeds the limit —
      // earliest possible relief is when this window rolls.
      retryAfterMs = Math.ceil(msToBoundary); // CEIL: D-03; matches Lua math.ceil(...)
    } else {
      // Need the previous-window contribution to decay by `overshoot` requests.
      // prev decays linearly over `windowMs`; ms per one request of weight =
      // windowMs / prev. Solve floor(curr + prev*frac') + cost <= limit.
      const overshoot = flooredEstimate + cost - cfg.limit; // > 0 here
      // The `prev === 0` fallback is unreachable here: this `else` runs only when
      // `curr + cost <= limit` (the `else if` above was false), and with prev===0
      // we'd have flooredEstimate === curr, making `curr + cost <= limit` an ADMIT
      // — so the reject path can never see prev===0. Kept as a defensive guard for
      // the Lua-parity arithmetic; the dead else-branch is excluded from coverage.
      /* v8 ignore next -- prev===0 unreachable given the curr+cost>limit guard above @preserve */
      const msToDecayOne = prev > 0 ? cfg.windowMs / prev : msToBoundary;
      retryAfterMs = Math.min(
        Math.ceil(overshoot * msToDecayOne), // CEIL: D-03; matches Lua math.ceil(...)
        Math.ceil(msToBoundary),
      );
    }

    this.state.set(key, { bucket, curr: currAfter, prev });

    // Wrap the already-computed tuple; NO await ran inside the section above.
    return Promise.resolve([allowed, remaining, resetMs, retryAfterMs]);
  }

  /**
   * Fixed Window Counter (ALGO-03 / D-11): a plain counter per `windowMs` bucket,
   * reset when the bucket index changes; admit while `count + cost <= limit`.
   *
   * The 2×-at-the-boundary burst (admit `limit` at the end of window N and
   * `limit` again at the start of N+1) is REQUIRED behavior to exhibit — do NOT
   * add any smoothing (ALGO-03 / Pitfall 4). The hard reset at the bucket edge
   * (count restarts at 0 the instant `bucket` changes) IS the burst: it is the
   * deliberate teaching contrast to Sliding Window's weighted blend (DESIGN §3),
   * not a defect to fix here.
   */
  fixedWindow(key: string, cfg: WindowConfig, cost: number, now: number): Promise<OpTuple> {
    const bucket = Math.floor(now / cfg.windowMs);

    // (1) load state; (reset) start a fresh count whenever the bucket index moves.
    const prevState = this.state.get(key) as WindowState | undefined;
    const count =
      prevState !== undefined && prevState.bucket === bucket ? prevState.curr : 0;

    // (3) decide — all-or-nothing (D-01). `cost > limit` fails gracefully (D-02).
    const allowed: 0 | 1 = count + cost <= cfg.limit ? 1 : 0;

    // (4) increment ONLY on admit (reject leaves count byte-identical — D-01).
    const countAfter = allowed === 1 ? count + cost : count;

    // (5) assemble the integer-ms tuple.
    const remaining = Math.max(0, cfg.limit - countAfter); // integer counts — D-04
    const msToBoundary = (bucket + 1) * cfg.windowMs - now;
    const resetMs = Math.ceil(msToBoundary); // CEIL: D-05; matches Lua math.ceil(...)
    const retryAfterMs = allowed === 1 ? 0 : Math.ceil(msToBoundary); // CEIL: D-03; matches Lua math.ceil(...)

    // `prev` is unused by fixed window but kept for the shared WindowState shape.
    this.state.set(key, { bucket, curr: countAfter, prev: 0 });

    // Wrap the already-computed tuple; NO await ran inside the section above.
    return Promise.resolve([allowed, remaining, resetMs, retryAfterMs]);
  }
}
