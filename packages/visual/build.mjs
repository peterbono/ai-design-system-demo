// Bundles @bridge-ds/visual with esbuild for publishing. Inside the monorepo the CLI and the MCP server compile
// its sources in (the `source` export condition); npm dependencies stay external.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@bridge-ds/'));

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
  external: [...deps, 'typescript'],
  logLevel: 'warning',
  absWorkingDir: new URL('.', import.meta.url).pathname,
});
