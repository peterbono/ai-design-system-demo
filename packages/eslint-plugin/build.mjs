// Bundles the plugin with esbuild: @bridge-ds/core sources are compiled in; typescript stays external.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  // Workspace packages resolve to their TypeScript sources (the `source` export condition), compiled in.
  conditions: ['source'],
  target: 'node20',
  external: ['typescript'],
  logLevel: 'warning',
  absWorkingDir: new URL('.', import.meta.url).pathname,
});
