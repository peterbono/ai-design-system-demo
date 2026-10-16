// Compiles test/*.test.ts with esbuild and runs them with the built-in node:test runner.
// No test framework dependency: Node 20 cannot run TypeScript directly.
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.test-dist');
const tests = (await readdir(join(root, 'test'))).filter((f) => f.endsWith('.test.ts'));

await rm(out, { recursive: true, force: true });
await esbuild.build({
  entryPoints: tests.map((f) => join(root, 'test', f)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: out,
  outExtension: { '.js': '.mjs' },
  // @bridge/core ships TypeScript sources: bundle it (Node builtins stay external on platform node).
  logLevel: 'warning',
});
const files = tests.map((f) => join(out, f.replace(/\.ts$/, '.mjs')));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
