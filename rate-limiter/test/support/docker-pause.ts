// Freeze / unfreeze a *started* testcontainers container — the SLOW-Redis
// simulation for the fault-injection matrix (TEST-05 / plan 02-05).
//
// Why pause (cgroups freeze) and not stop:
//   `container.stop()` closes the TCP socket, so an in-flight ioredis command
//   gets a fast connection error (the DOWN case). To exercise the `commandTimeout`
//   path (DEF-01) we need the socket to stay OPEN while the server stops
//   responding — exactly what a Docker `pause` does (it SIGSTOP-freezes the
//   container's processes via the freezer cgroup; TCP stays established but no
//   reply ever comes), so the client's `commandTimeout` fires (the SLOW case).
//
// Path choice (02-RESEARCH A3 / Open-Question Q1): the installed testcontainers
// 12.0.3 `StartedTestContainer` exposes NO first-class `pause()/unpause()`
// (verified against `node_modules/testcontainers/build/test-container.d.ts` —
// it has stop/restart/exec/… but no pause). So we try a native `pause` first in
// case a future testcontainers adds one, and otherwise fall back to dockerode —
// `new Docker().getContainer(container.getId()).pause()` — which is already an
// installed transitive dep (with @types/dockerode present). The wrapper stays a
// thin, typed seam so the test file never reaches for `as any` Docker plumbing.

import Docker from "dockerode";
import type { StartedTestContainer } from "testcontainers";

// A container that *might* expose a native freeze API (future testcontainers).
type MaybePausable = StartedTestContainer & {
  pause?: () => Promise<unknown>;
  unpause?: () => Promise<unknown>;
};

/** Lazily-built dockerode client (talks to the same daemon testcontainers used). */
let docker: Docker | undefined;
function dockerClient(): Docker {
  docker ??= new Docker();
  return docker;
}

/**
 * Freeze a started container so an in-flight Redis command hangs (no reply) and
 * the client's `commandTimeout` fires — the SLOW-Redis simulation. Prefers a
 * native testcontainers `pause()` if present, else dockerode by container id.
 */
export async function pause(container: StartedTestContainer): Promise<void> {
  const maybe = container as MaybePausable;
  if (typeof maybe.pause === "function") {
    await maybe.pause();
    return;
  }
  await dockerClient().getContainer(container.getId()).pause();
}

/**
 * Unfreeze a previously {@link pause}d container so subsequent commands succeed
 * again (drives the breaker's half-open probe → CLOSED recovery). Mirrors the
 * native-then-dockerode path used by {@link pause}.
 */
export async function unpause(container: StartedTestContainer): Promise<void> {
  const maybe = container as MaybePausable;
  if (typeof maybe.unpause === "function") {
    await maybe.unpause();
    return;
  }
  await dockerClient().getContainer(container.getId()).unpause();
}
