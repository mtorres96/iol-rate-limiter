// RedisStore.connect() static-factory coverage (D2-08 — D-01/D-04).
//
// `connect()` builds a single ioredis client with the defensive connection
// options and returns a ready RedisStore. Because those options set
// `lazyConnect: true`, constructing the client opens NO socket — so both
// factory branches (with a connection URL and with no argument → default
// options) are covered here with NO Docker and NO network. Each store is
// released via `await store.close()`, mirroring degraded.test.ts, so the lazily
// built client is torn down and never leaks an open handle.
//
// This is a real covering test (D-04: prefer a test over an ignore pragma).

import { describe, expect, it } from "vitest";
import { RedisStore } from "../src/index.js";

describe("RedisStore.connect() static factory (no Docker — lazyConnect)", () => {
  it("builds a RedisStore from a connection URL (connection branch)", async () => {
    const store = RedisStore.connect("redis://127.0.0.1:6379");
    expect(store).toBeInstanceOf(RedisStore);
    await store.close(); // release the lazily-built ioredis client.
  });

  it("builds a RedisStore with no argument (default-options branch)", async () => {
    const store = RedisStore.connect();
    expect(store).toBeInstanceOf(RedisStore);
    await store.close();
  });
});
