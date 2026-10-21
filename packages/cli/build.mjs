// Bundles the bridge CLI with esbuild. @bridge-ds/mcp (its built dist) and npm dependencies stay external;
// @bridge-ds/core sources are compiled in.
import { build } from 'esbuild';
import { chmod, readFile, rm } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

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
  external: ['typescript', '@bridge-ds/mcp', 'playwright-core', 'pixelmatch', 'pngjs', '@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'zod', 'zod/*'],
  // The CLI's own published version (banner, --version, audit reports, snapshots), not @bridge-ds/mcp's.
  define: { __BRIDGE_CLI_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
  absWorkingDir: new URL('.', import.meta.url).pathname,
});
await chmod(new URL('./dist/index.js', import.meta.url), 0o755);
