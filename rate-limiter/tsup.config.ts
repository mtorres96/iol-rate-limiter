import { defineConfig } from 'tsup';

// ESM-only build. tsup performs the actual JS + .d.ts emit; tsconfig stays
// noEmit so `tsc --noEmit` is purely the type-gate.
// NOTE: tsdown migration is intentionally declined — CLAUDE.md locks tsup.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node24',
});
