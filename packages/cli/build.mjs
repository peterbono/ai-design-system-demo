// Bundles the bridge CLI with esbuild. @bridge-ds/mcp (its built dist) and npm dependencies stay external;
// @bridge-ds/core sources are compiled in.
import { build } from 'esbuild';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { chmod, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

// @bridge-ds/mcp stays external, so the CLI runs on its built dist. In the monorepo (a fresh worktree, or after a
// change to core or mcp) build it first when it is missing or older than its sources, instead of a CLI that crashes
// with ERR_MODULE_NOT_FOUND or runs stale code. Published installs have no ../mcp/src and skip this.
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const newest = (dir) => {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
};
if (existsSync(here('../mcp/src')) && existsSync(here('../mcp/build.mjs'))) {
  const lib = here('../mcp/dist/lib.js');
  const sources = Math.max(newest(here('../mcp/src')), existsSync(here('../core/src')) ? newest(here('../core/src')) : 0, existsSync(here('../visual/src')) ? newest(here('../visual/src')) : 0);
  if (!existsSync(lib) || statSync(lib).mtimeMs < sources) {
    console.log('Building @bridge-ds/mcp first (the CLI runs on its dist).');
    await import(new URL('../mcp/build.mjs', import.meta.url).href);
  }
}

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
