// Bundles the server (dist/index.js) and the library the CLI uses (dist/lib.js) with esbuild.
// @bridge-ds/core ships TypeScript sources, so it is compiled into the bundle; npm dependencies stay external.
import { build } from 'esbuild';
import { chmod, rm } from 'node:fs/promises';

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: { index: 'src/index.ts', lib: 'src/lib.ts' },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  // Workspace packages resolve to their TypeScript sources (the `source` export condition), compiled in.
  conditions: ['source'],
  target: 'node20',
  external: ['typescript', 'playwright-core', 'pixelmatch', 'pngjs', '@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'zod', 'zod/*'],
  logLevel: 'warning',
  absWorkingDir: new URL('.', import.meta.url).pathname,
});
await chmod(new URL('./dist/index.js', import.meta.url), 0o755);
