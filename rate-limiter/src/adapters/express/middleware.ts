// The Express adapter — `rateLimit(options) => RequestHandler` (HTTP-01..HTTP-04).
//
// This is the ONLY tier (with its siblings under `src/adapters/express/**`) that
// imports Express — the core (`types.ts`, the limiters) imports NOTHING from
// Express (the tier boundary, symmetric to `store/redis.ts` being the only file
// that imports ioredis). It REUSES the core contracts (`RateLimiter`/`Decision`/
// `RateLimitPolicy`/`DegradedLogger`) and `assertPolicy` — it defines NO new
// policy or logger type.
//
// The handler mirrors `redis.ts`'s "try/catch that never throws + edge-triggered
// DegradedLogger.warn" at the HTTP edge (D3-07..D3-09): a `consume()` rejection is
// caught and resolved through a middleware-owned fail-open/closed policy, never
// rethrown and never leaked to Express's error handler — a flaky limiter can never
// crash the request.

import type { Request, RequestHandler, Response } from 'express';

import type {
  Decision,
  DegradedLogger,
  RateLimiter,
  RateLimitPolicy,
} from '../../types.js';
import { assertPolicy } from '../../validate.js';
import { setRateLimitHeaders } from './headers.js';

/**
 * Options for {@link rateLimit}. Only `limiter` is required; everything else has
 * a sensible default so `rateLimit({ limiter })` works out of the box (D3-01,
 * D3-04, D3-07).
 */
export interface RateLimitOptions {
  /** The core limiter to enforce. Required — its `consume(key)` is the seam. */
  limiter: RateLimiter;
  /**
   * Extract the client key from the request. Default: `req.ip` (D3-01). The key
   * is OPAQUE — it is passed straight to `consume()` and never parsed here. The
   * middleware NEVER reads `X-Forwarded-For` itself; populating `req.ip` from a
   * trusted proxy is the deployment's `trust proxy` concern (D3-02 / T-03-02).
   */
  keyGenerator?: (req: Request) => string | null | undefined;
  /** Behavior when `consume()` rejects (D3-07). Default: `"fail-open"`. */
  policy?: RateLimitPolicy;
  /** Which header family/families to emit (D3-04). Default: `"both"`. */
  headers?: 'both' | 'ietf' | 'legacy' | false;
  /** Window length in seconds — appended to `RateLimit-Policy` as `;w=` when set. */
  windowSeconds?: number;
  /** Custom over-limit responder. When set it OWNS the 429 response body. */
  handler?: (req: Request, res: Response, decision: Decision) => void;
  /** Body message for the default 429 response. Default: `"Too Many Requests"`. */
  message?: string;
  /** Optional structured-log sink for empty-key + limiter-error visibility (D3-03/D3-08). */
  logger?: DegradedLogger;
}

/**
 * Build an Express middleware that enforces `options.limiter` per client key.
 *
 * Options are validated at factory-call time (the analog of construction-time
 * validation in the limiters / `RedisStore`): a missing `limiter` throws
 * `TypeError` and an invalid `policy` throws `RangeError` BEFORE any request is
 * served, so misconfiguration fails loud at startup rather than silently at the
 * edge.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  // Factory-time validation (fail loud at startup, not per-request).
  if (options.limiter == null) {
    throw new TypeError('rateLimit: `limiter` is required');
  }
  const policy = options.policy ?? 'fail-open'; // D3-07: mirror the store default.
  assertPolicy('rateLimit', policy); // RangeError on a garbage policy literal.

  const keyOf = options.keyGenerator ?? ((req: Request) => req.ip); // D3-01.

  return async (req, res, next) => {
    const key = keyOf(req);

    // Empty/absent key → admit AND log (D3-03 / T-03-03): we cannot rate-limit a
    // request we cannot identify, but an operator should see it happened. No
    // `consume()` call is made.
    if (key == null || key === '') {
      options.logger?.warn(
        { path: req.path },
        'rate-limit: empty key, admitting',
      );
      return next();
    }

    let decision: Decision;
    try {
      decision = await options.limiter.consume(key);
    } catch (err) {
      // The limiter rejected (e.g. Redis down behind a fail-closed store, or a
      // store that throws). Resolve through the middleware-owned policy — NEVER
      // rethrow / leak to Express's error handler (D3-08/D3-09 / T-03-04).
      options.logger?.warn({ err, key }, 'rate-limit: limiter error');
      if (policy === 'fail-open') {
        return next(); // availability over strictness — admit.
      }
      // fail-closed: deny. There is no `Decision` to build budget headers from
      // (Pitfall 4), so we send a bare 429 JSON with a minimal `Retry-After: 1`
      // hint. The explicit `return` here is the ONLY exit for the error path —
      // no code may run below the try/catch, or it would execute after the
      // response is sent (ERR_HTTP_HEADERS_SENT).
      res.setHeader('Retry-After', '1');
      res.status(429).json({ error: 'Too Many Requests' });
      return;
    }

    // Headers BEFORE the body on EVERY non-error path (D3-04 / Pitfall 5 — avoid
    // ERR_HTTP_HEADERS_SENT), on both the allowed and the rejected response.
    setRateLimitHeaders(res, decision, options);

    if (decision.allowed) {
      return next();
    }
    sendThrottled(req, res, decision, options);
  };
}

/**
 * Send the over-limit (429) response: a `Retry-After` delta-seconds header (the
 * ONLY place it is set — D3-10) followed by either a caller-supplied `handler`
 * override or the default JSON body. `setRateLimitHeaders` has already run, so
 * the budget headers are present on the 429 too.
 */
function sendThrottled(
  req: Request,
  res: Response,
  decision: Decision,
  options: RateLimitOptions,
): void {
  // `retryAfterMs === 0` on a throttled response is a data-contract violation
  // (a 429 that says "wait zero seconds" defeats the limiter). Clamp to at least
  // 1 s so `Retry-After` is never "0" on a 429 (RFC 9110 §10.2.3).
  const retryAfterS = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
  res.setHeader('Retry-After', String(retryAfterS));
  if (options.handler) {
    options.handler(req, res, decision); // handler OWNS the body.
    return;
  }
  res.status(429).json({
    error: options.message ?? 'Too Many Requests',
    retryAfterMs: decision.retryAfterMs,
  });
}
