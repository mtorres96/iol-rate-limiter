// Pure `Decision → HTTP headers` transform at the adapter tier.
//
// This is a SIDE-EFFECT-ONLY pure mapping: it reads a core `Decision` (integer-ms
// fields, D-09) plus the resolved `RateLimitOptions` and writes response headers —
// no re-derivation, no wall-clock epoch. It is the symmetric analog of the limiters'
// `OpTuple → Decision` mapping (token-bucket.ts): map fields straight through.
//
// Two header families are emitted (D3-04):
//   - IETF draft-11 List-of-Items form: `RateLimit-Policy` + `RateLimit`.
//   - Legacy `X-RateLimit-*` triple.
// `mode` ("both" | "ietf" | "legacy" | false) selects which, defaulting to "both".
//
// `Retry-After` is NOT set here — it is the 429-only path and lives in
// `middleware.ts` (RESEARCH §"Header Mapping Table" note).

import type { Response } from 'express';

import type { Decision } from '../../types.js';
import type { RateLimitOptions } from './middleware.js';

/**
 * The ONE place integer milliseconds are converted to HTTP delta-seconds (D-09 /
 * D3-05). `ceil` so any non-zero sub-second remainder rounds UP to at least `1`
 * (never advertise `0` seconds for a reset that is still pending). NEVER an epoch
 * value — no wall-clock read appears in the header path (RESEARCH Pitfall 2).
 */
export const toSeconds = (ms: number): number => Math.ceil(ms / 1000);

/**
 * Write the rate-limit headers for `d` onto `res` according to `opts.headers`
 * (default `"both"`). Called on BOTH the allowed and the rejected (429) path, so
 * a client always sees its current budget. Header values derive only from the
 * numeric `Decision` fields and the fixed `"default"` policy name — no
 * user-controlled string is interpolated (T-03-05).
 */
export function setRateLimitHeaders(
  res: Response,
  d: Decision,
  opts: RateLimitOptions,
): void {
  const mode = opts.headers ?? 'both';
  if (mode === false) return; // headers disabled — emit nothing.

  const resetS = toSeconds(d.resetMs);

  if (mode === 'both' || mode === 'ietf') {
    // draft-11 List-of-Items form (NOT the draft-07 dictionary `key=value` form).
    // `;w=<windowSeconds>` is appended to the policy ONLY when a window is supplied.
    const wPart = opts.windowSeconds != null ? `;w=${opts.windowSeconds}` : '';
    res.setHeader('RateLimit-Policy', `"default";q=${d.limit}${wPart}`);
    res.setHeader('RateLimit', `"default";r=${d.remaining};t=${resetS}`);
  }

  if (mode === 'both' || mode === 'legacy') {
    // `limit`/`remaining` are emitted as-is — already floored integers (D3-06),
    // no re-flooring. `reset` is delta-seconds (NOT epoch — D3-05).
    res.setHeader('X-RateLimit-Limit', String(d.limit));
    res.setHeader('X-RateLimit-Remaining', String(d.remaining));
    res.setHeader('X-RateLimit-Reset', String(resetS));
  }
}
