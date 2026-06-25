---
phase: 03-express-middleware-http-semantics
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - rate-limiter/src/adapters/express/headers.ts
  - rate-limiter/src/adapters/express/middleware.ts
  - rate-limiter/src/adapters/express/index.ts
  - rate-limiter/test/adapters/express/middleware.test.ts
  - rate-limiter/test/adapters/express/fail-open-closed.test.ts
  - rate-limiter/test/build-smoke.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-06-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

The six files implement the Express middleware adapter (`rateLimit`), the header-writing
side-effect module (`setRateLimitHeaders`), a re-export barrel, and three test suites. The
tier-boundary is respected: no Express imports appear outside `src/adapters/express/**`.
The fail-open/closed try/catch wraps the entire `consume()` call and never rethrows,
satisfying the no-leak contract. The IETF draft-11 `RateLimit` header format, the
delta-seconds conversion, and the `X-RateLimit-*` legacy triple are structurally correct.

One critical correctness bug was found: the `Retry-After` response header can be emitted
as `"0"` on a throttled request when the token-bucket bucket is at exactly capacity (the
full-bucket edge case), sending a semantically invalid hint to clients. Four warnings cover
the `RateLimit-Policy` format divergence from draft-11 (a quoted-string policy name is used
where a token is required), a missing `next()` call after `res.status(429).json()` in the
fail-closed path that masks double-write risk, untested code paths for the `handler` and
`message` options, and a race window in the `unhandledRejection` guard test. Three info
items cover the `headers: "ietf"` mode having no test, factory-time validation having no
test, and an ambiguous `windowSeconds` option type.

---

## Critical Issues

### CR-01: `Retry-After: 0` emitted on a throttled response when `retryAfterMs` is 0

**File:** `rate-limiter/src/adapters/express/middleware.ts:129`

**Issue:** `sendThrottled` unconditionally emits `Retry-After` as
`String(Math.ceil(decision.retryAfterMs / 1000))`. `decision.retryAfterMs` is `0` when the
request is rejected but the token-bucket store returns `retryAfterMs = 0` — this can
happen when `refilled >= cost` is false but the computed `need` is `0` due to
floating-point cancellation (i.e. `cost - refilled` rounds to `≤0` before the `Math.max`
guard). In that edge case `Math.ceil(0 / 1000)` is `0`, and the response carries
`Retry-After: 0`. RFC 9110 §10.2.3 defines `Retry-After` as "the minimum number of seconds
the user agent ought to wait"; a value of `0` is syntactically legal but semantically
contradicts the 429 status ("wait zero seconds before retrying immediately"). Clients that
respect `Retry-After` will hammer the endpoint at full speed, defeating the rate limiter.

Beyond the edge case, `retryAfterMs` is typed as `number` throughout the contract and there
is no runtime guarantee it is always `> 0` when `allowed === false`. The test at line 88
(`expect(blocked.body.retryAfterMs).toBeGreaterThan(0)`) exercises only the token-bucket
steady state; it does not cover `retryAfterMs === 0`.

**Fix:** Guard the header emission and clamp to at least `1` second when the decision is
throttled:

```typescript
function sendThrottled(
  req: Request,
  res: Response,
  decision: Decision,
  options: RateLimitOptions,
): void {
  // retryAfterMs === 0 on a throttled response is a data contract violation;
  // clamp to 1 s so the Retry-After header is never "0" on a 429.
  const retryAfterS = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
  res.setHeader('Retry-After', String(retryAfterS));
  if (options.handler) {
    options.handler(req, res, decision);
    return;
  }
  res.status(429).json({
    error: options.message ?? 'Too Many Requests',
    retryAfterMs: decision.retryAfterMs,
  });
}
```

---

## Warnings

### WR-01: `RateLimit-Policy` uses a quoted-string name; IETF draft-11 requires an sf-token

**File:** `rate-limiter/src/adapters/express/headers.ts:50`

**Issue:** The emitted header is:
```
RateLimit-Policy: "default";q=1;w=60
```
In IETF draft-ietf-httpapi-ratelimit-headers-11 (the `draft-11` the codebase explicitly
targets), `RateLimit-Policy` is a Structured Fields `sf-list`. Each list member is an
`sf-item`. The `name` is an `sf-token`, not an `sf-string` — tokens are unquoted bare
identifiers (e.g. `default`), whereas quoted strings use double-quotes. Emitting
`"default"` (an `sf-string`) is therefore non-conformant; a strict SF parser will reject
the value. The `RateLimit` header has the same defect at line 51:
```
RateLimit: "default";r=0;t=1
```
Because both headers are emitted together, a client relying on the policy-name for matching
the `RateLimit` member to its `RateLimit-Policy` entry using case-sensitive token comparison
will fail to correlate them.

**Fix:** Remove the double-quotes so `default` is emitted as an sf-token:

```typescript
res.setHeader('RateLimit-Policy', `default;q=${d.limit}${wPart}`);
res.setHeader('RateLimit', `default;r=${d.remaining};t=${resetS}`);
```

The test at `middleware.test.ts:56` (`toContain('"default";q=1')`) will need to be updated
to `toContain('default;q=1')` once the fix is applied.

---

### WR-02: Fail-closed path calls `res.status(429).json(...)` without `return` — double-write risk if Express calls `next` later

**File:** `rate-limiter/src/adapters/express/middleware.ts:102–103`

**Issue:** The fail-closed branch is:

```typescript
res.status(429).json({ error: 'Too Many Requests' });
return;
```

The `return` here exits the `catch` block. The outer `async` handler then falls off the
bottom of the function body at line 114 and the function returns `undefined` without
calling `next()`. That is correct under the current layout. However, the logic relies on
the reader understanding that `return` inside the `catch` block cascades out of the entire
`return async (req, res, next) => { ... }` body after the catch concludes. This is
structurally sound but fragile: any future refactor that adds code after the `try/catch`
block (e.g. metrics) will silently execute after the response body has already been sent
(`ERR_HTTP_HEADERS_SENT`). The fail-closed path also omits `Retry-After` and budget
headers — correct per the comment ("no `Decision` to build budget headers from") — but the
HTTP spec still recommends `Retry-After` on 429 even when no `Decision` is available.

**Fix:** Make the control flow explicit to prevent the fragile-fallthrough pattern:

```typescript
// In the catch block:
if (policy === 'fail-open') {
  return next();
}
// fail-closed
res.status(429).json({ error: 'Too Many Requests' });
return; // explicit early return from the RequestHandler

// ... (no code should execute below the try/catch for the error path)
```

Additionally, consider adding a minimal `Retry-After` hint on the fail-closed path:

```typescript
res
  .status(429)
  .setHeader('Retry-After', '1')
  .json({ error: 'Too Many Requests' });
```

---

### WR-03: `options.handler` callback is untested — custom 429 body ownership not verified

**File:** `rate-limiter/src/adapters/express/middleware.ts:130–132`

**Issue:** `RateLimitOptions.handler` is a documented public API surface:
```typescript
/** Custom over-limit responder. When set it OWNS the 429 response body. */
handler?: (req: Request, res: Response, decision: Decision) => void;
```
There is no test in either `middleware.test.ts` or `fail-open-closed.test.ts` that passes a
custom `handler` and verifies: (a) the custom handler runs instead of the default JSON
body; (b) the standard rate-limit headers (`RateLimit`, `X-RateLimit-*`) are still present
because `setRateLimitHeaders` runs before `sendThrottled`; (c) `Retry-After` is still set
because it is in `sendThrottled` before the `if (options.handler)` branch. The absence of
tests means there is also no coverage guard that would catch a refactor accidentally
swapping the header-setting and handler-calling order (which would break `Retry-After` for
custom handlers).

**Fix:** Add a test case:

```typescript
it("custom handler owns the 429 body but standard headers are still present", async () => {
  const limiter = oneShotLimiter();
  const app = express();
  app.use(rateLimit({
    limiter,
    keyGenerator: () => "k1",
    handler: (_req, res, _d) => res.status(429).json({ custom: true }),
  }));
  app.get("/", (_req, res) => res.send("ok"));

  await request(app).get("/");          // drain token
  const blocked = await request(app).get("/");

  expect(blocked.status).toBe(429);
  expect(blocked.body).toEqual({ custom: true });
  // Standard headers must still be present even with a custom handler
  expect(blocked.headers["retry-after"]).toBeDefined();
  expect(blocked.headers["ratelimit"]).toBeDefined();
});
```

---

### WR-04: `unhandledRejection` test guard has a timing race — does not await all in-flight promises

**File:** `rate-limiter/test/adapters/express/fail-open-closed.test.ts:93–96`

**Issue:** The final test in the `fail-open/closed` suite is:

```typescript
it("never produced an unhandled rejection across the suite (T-03-06)", () => {
  expect(unhandled).toHaveLength(0);
});
```

This test runs synchronously and checks `unhandled` at the moment of assertion. The
`process.on('unhandledRejection', onUnhandled)` listener fires asynchronously in a future
microtask or macrotask tick after an unhandled rejection is detected by V8. Because this
test body is synchronous and runs in the same turn as any lingering promise from a
`boom.consume()` call, a leaked rejection from the previous tests could arrive in the
`unhandled` array in the very next microtask — AFTER the assertion has already passed. The
test can pass a run where the middleware actually leaked a rejection but the V8 detection
callback simply had not fired yet.

The root issue is that `unhandledRejection` is edge-triggered and asynchronous; checking a
synchronous accumulator immediately is not a reliable guarantee.

**Fix:** Convert the guard test to `async` and flush the microtask queue before asserting:

```typescript
it("never produced an unhandled rejection across the suite (T-03-06)", async () => {
  // Flush the microtask queue so any pending rejection callbacks have fired.
  await Promise.resolve();
  expect(unhandled).toHaveLength(0);
});
```

---

## Info

### IN-01: `headers: "ietf"` mode has no test — only IETF+legacy ("both") and legacy are covered

**File:** `rate-limiter/test/adapters/express/middleware.test.ts:114–144`

**Issue:** The header-mode selection suite tests `"legacy"` (line 115) and `false` (line
129) but omits `"ietf"`. That means there is no test verifying that `headers: "ietf"`
emits `RateLimit` and `RateLimit-Policy` but NOT `X-RateLimit-*`. The code path in
`headers.ts` that handles `mode === 'ietf'` independently (lines 46–52 only) is
unexercised by the test suite.

**Fix:** Add a test:

```typescript
it('headers: "ietf" omits X-RateLimit-* but keeps the IETF headers', async () => {
  const limiter = oneShotLimiter();
  const app = express();
  app.use(rateLimit({ limiter, keyGenerator: () => "k1", headers: "ietf" }));
  app.get("/", (_req, res) => res.send("ok"));

  const ok = await request(app).get("/");

  expect(ok.status).toBe(200);
  expect(ok.headers["ratelimit"]).toBeDefined();
  expect(ok.headers["ratelimit-policy"]).toBeDefined();
  expect(ok.headers["x-ratelimit-limit"]).toBeUndefined();
  expect(ok.headers["x-ratelimit-remaining"]).toBeUndefined();
  expect(ok.headers["x-ratelimit-reset"]).toBeUndefined();
});
```

---

### IN-02: Factory-time validation (missing `limiter`, invalid `policy`) is untested

**File:** `rate-limiter/src/adapters/express/middleware.ts:67–71`

**Issue:** The factory validates `options.limiter != null` (throws `TypeError`) and calls
`assertPolicy` (throws `RangeError`) at call time, before any request is served. Neither of
these paths has a test. If either guard regressed — e.g., the `assertPolicy` call were
removed — misconfigured middleware would silently serve requests instead of failing loudly
at startup.

**Fix:** Add tests:

```typescript
it("throws TypeError at factory time when limiter is missing", () => {
  expect(() => rateLimit({} as any)).toThrow(TypeError);
});

it("throws RangeError at factory time for an invalid policy string", () => {
  expect(() => rateLimit({ limiter: oneShotLimiter(), policy: "fail-maybe" as any }))
    .toThrow(RangeError);
});
```

---

### IN-03: `windowSeconds` option is typed as `number | undefined` with no validation — a negative or zero value produces an invalid `RateLimit-Policy` header

**File:** `rate-limiter/src/adapters/express/middleware.ts:47` / `headers.ts:49`

**Issue:** `windowSeconds?: number` has no runtime validation. If a caller passes
`windowSeconds: -5` or `windowSeconds: 0`, the emitted header becomes:
```
RateLimit-Policy: "default";q=1;w=-5
```
which is malformed (the `w` parameter is defined as a positive integer in draft-11).
There is no `assertPositiveConfig` guard equivalent for this field, unlike `capacity`,
`intervalMs`, `windowMs`, etc.

**Fix:** Either document that `windowSeconds` must be a positive integer and add a
factory-time guard:

```typescript
if (options.windowSeconds != null) {
  if (!Number.isInteger(options.windowSeconds) || options.windowSeconds <= 0) {
    throw new RangeError('rateLimit: `windowSeconds` must be a positive integer when set');
  }
}
```

Or narrow the type: `windowSeconds?: number` → document it clearly and add the guard in
`headers.ts` before interpolation:

```typescript
const wPart =
  opts.windowSeconds != null && opts.windowSeconds > 0
    ? `;w=${opts.windowSeconds}`
    : '';
```

---

_Reviewed: 2026-06-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
