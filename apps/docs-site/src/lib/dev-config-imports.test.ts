// `npm run dev:full` loads dev/local-api.ts with astro.config.mjs, before the dev server exists. There a workspace
// package (@bridge-ds/core...) resolves to its built dist, which a fresh checkout does not have: one value import
// reachable from that file and dev:full does not start ("Failed to resolve entry for package @bridge-ds/core").
// Modules that need a workspace package are loaded later, through the dev server (server.ssrLoadModule).
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Static value imports and re-exports (type-only ones are erased at runtime, so they are skipped). */
function imports(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  for (const m of code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  return out;
}

describe('dev:full starts on a fresh checkout', () => {
  it('nothing loaded with astro.config.mjs imports a workspace package', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const queue = [join(root, 'dev/local-api.ts')];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of imports(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('@bridge-ds/')) bad.push(`${relative(root, file)}: '${spec}'`);
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
        try {
          if (statSync(target).isFile()) queue.push(target);
        } catch {
          /* a .json or a real .js file */
        }
      }
    }
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(5);
  });
});
