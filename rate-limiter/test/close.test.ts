// RedisStore.close() teardown-safety tests (WR-04) — no Docker.
//
// Under the SLOW fault (a frozen container) `client.quit()` can hang — neither
// resolving nor rejecting. close() must NOT await it unboundedly: it races the
// quit against a short timeout and force-disconnects. These stub the ioredis
// client so we can assert close() resolves (and falls back to disconnect) even
// when quit() never settles, without spinning up Redis.

import { describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import { FakeClock, RedisStore } from "../src/index.js";

/** Build a RedisStore over a stub client with a controllable quit(). */
function storeWith(quit: () => Promise<unknown>, disconnect: () => void): RedisStore {
  const client = {
    defineCommand(name: string): void {
      (client as Record<string, unknown>)[name] = () => Promise.resolve([1, 4, 0, 0]);
    },
    quit,
    disconnect,
  };
  return new RedisStore(client as unknown as Redis, { keyPrefix: "close" }, new FakeClock(0));
}

describe("RedisStore.close() (WR-04)", () => {
  it("force-disconnects (and resolves) when quit() HANGS forever", async () => {
    const disconnect = vi.fn();
    // quit() returns a promise that never settles — the SLOW-Redis hang.
    const store = storeWith(() => new Promise<never>(() => {}), disconnect);

    vi.useFakeTimers();
    const closing = store.close();
    // Advance past the internal quit timeout so the race rejects → disconnect().
    await vi.advanceTimersByTimeAsync(1000);
    await expect(closing).resolves.toBeUndefined();
    vi.useRealTimers();

    expect(disconnect).toHaveBeenCalledTimes(1); // fell back to a forced socket teardown
  });

  it("resolves cleanly on a normal quit() without disconnecting", async () => {
    const disconnect = vi.fn();
    const store = storeWith(() => Promise.resolve("OK"), disconnect);
    await expect(store.close()).resolves.toBeUndefined();
    expect(disconnect).not.toHaveBeenCalled(); // graceful quit → no force-disconnect
  });

  it("force-disconnects when quit() REJECTS", async () => {
    const disconnect = vi.fn();
    const store = storeWith(() => Promise.reject(new Error("connection error")), disconnect);
    await expect(store.close()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
