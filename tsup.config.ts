import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/pr-policy.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
});
