import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Container startup (testcontainers pulling/starting redis:7.4-alpine) and
    // the build-smoke test (a real `tsup` build) are far slower than the default
    // 5s. Bump the global test + hook timeout so the Docker-backed conformance /
    // integration / concurrency suites have room to start their container in
    // beforeAll; the fast in-memory tests are unaffected (they finish in ms).
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Run test FILES sequentially. The Docker-backed suites (conformance,
    // integration, concurrency, fault-injection) each start their own
    // testcontainers Redis in beforeAll; running the files in parallel spins up
    // several containers at once and the contention flakily times out a worker's
    // container start / `docker info` probe (tests skip or the suite errors). The
    // in-memory unit tests finish in milliseconds, so serializing files costs
    // almost nothing while making the Redis suites reliable.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // D-01: scope the gate to the real algorithm/adapter surface. The demo app
      // and the barrel re-export files carry no branch logic to grade, and the
      // `.lua` scripts are server-side Redis code that rolldown CANNOT parse
      // (PARSE_ERROR) — excluding them keeps the gate meaningful and the run
      // green instead of catering the global metric or crashing the coverage pass.
      exclude: [
        'src/demo/**',
        'src/index.ts',
        'src/adapters/express/index.ts',
        'src/store/lua/**',
      ],
      // D-02: a HARD four-metric gate. All four must be >= 95 or the run fails —
      // branches was the only metric below 95 (88.18%) before this plan closed
      // the defensive arms with real tests.
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95,
      },
    },
  },
});
