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
    },
  },
});
