// Express adapter barrel — the SECOND `tsup` entry and the `rate-limiter/express`
// `package.json` subpath target.
//
// Express lives ONLY here and its siblings (`middleware.ts`, `headers.ts`); the
// core barrel (`src/index.ts`) stays Express-free. Importing `rate-limiter/express`
// pulls in the adapter; importing `rate-limiter` pulls in only the framework-
// agnostic core.

export { rateLimit } from './middleware.js';
export type { RateLimitOptions } from './middleware.js';
