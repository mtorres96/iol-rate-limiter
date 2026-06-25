import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

// ESM-only build. tsup performs the actual JS + .d.ts emit; tsconfig stays
// noEmit so `tsc --noEmit` is purely the type-gate.
// NOTE: tsdown migration is intentionally declined — CLAUDE.md locks tsup.
//
// Asset copy (STOR-02): the RedisStore loads its Lua scripts at runtime via
// `readFileSync(new URL('./lua/<algo>.lua', import.meta.url))`. tsup hoists the
// store code into a shared top-level chunk in `dist/`, so `import.meta.url`
// resolves `./lua/` to `dist/lua/` (NOT `dist/store/lua/`). The `.lua` files
// must therefore be copied verbatim into `dist/lua/` after a successful build,
// or the real-Redis path throws ENOENT in the built image.
export default defineConfig({
  entry: ['src/index.ts', 'src/adapters/express/index.ts', 'src/demo/server.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node24',
  onSuccess: async () => {
    cpSync('src/store/lua', 'dist/lua', { recursive: true });
  },
});
