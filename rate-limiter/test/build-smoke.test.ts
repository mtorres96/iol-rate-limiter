// Build smoke test (STOR-02 / RESEARCH A4).
//
// The RedisStore loads its Lua scripts at runtime from the BUILT package via
// `readFileSync(new URL('./lua/<algo>.lua', import.meta.url))`. tsup only bundles
// `.ts`, so the `.lua` assets are copied into `dist/store/lua/` by the
// `onSuccess` hook in tsup.config.ts. This test runs the real build and asserts
// those assets actually land in `dist` and are non-empty — catching a broken or
// removed asset-copy step before it silently ships a package that can't load its
// own scripts.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const luaScripts = ["token-bucket.lua", "sliding-window.lua", "fixed-window.lua"];

// The Express adapter ships as a SECOND tsup entry + the `./express` subpath in
// `package.json` `exports` (wired in plan 03-01). These are the built artifacts
// that subpath must resolve to.
const expressSubpathAssets = [
  "adapters/express/index.js",
  "adapters/express/index.d.ts",
];

describe("build ships the assets into dist", () => {
  beforeAll(() => {
    // Run the real production build (tsup). The `onSuccess` hook copies the
    // `.lua` files into `dist/store/lua/`, and the second entry emits the Express
    // adapter into `dist/adapters/express/`.
    execFileSync("npm", ["run", "build"], { cwd: pkgRoot, stdio: "inherit" });
  }, 120_000);

  it.each(luaScripts)("dist/store/lua/%s exists and is non-empty", (script) => {
    const path = fileURLToPath(new URL(`../dist/store/lua/${script}`, import.meta.url));
    const contents = readFileSync(path, "utf8");
    expect(contents.length).toBeGreaterThan(0);
  });

  // Guards plan 03-01's second tsup entry + the `./express` export: a broken or
  // missing second-entry wiring would ship a `rate-limiter/express` subpath that
  // resolves to a non-existent file (T-03-07).
  it.each(expressSubpathAssets)("dist/%s exists and is non-empty", (asset) => {
    const path = fileURLToPath(new URL(`../dist/${asset}`, import.meta.url));
    const contents = readFileSync(path, "utf8");
    expect(contents.length).toBeGreaterThan(0);
  });
});
