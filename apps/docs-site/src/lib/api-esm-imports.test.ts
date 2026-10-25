// The /api functions run as plain Node ES modules on Vercel: a relative import without its `.js` extension builds and
// passes every other test, then crashes the function in production (ERR_MODULE_NOT_FOUND). This walks every module an
// /api function can load and asks each relative import for its extension.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiDir = join(root, 'api');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** Relative specifiers of static imports and re-exports (type-only imports are erased, so they are skipped). */
function relativeImports(code: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm;
  for (const m of code.matchAll(re)) out.push(m[1]!);
  const side = /^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm;
  for (const m of code.matchAll(side)) out.push(m[1]!);
  return out;
}

describe('api functions load as Node ES modules', () => {
  it('every relative import reachable from /api names its .js file', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const queue = sources(apiDir);
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of relativeImports(readFileSync(file, 'utf8'))) {
        if (!spec.endsWith('.js') && !spec.endsWith('.json')) {
          bad.push(`${relative(root, file)}: '${spec}'`);
          continue;
        }
        const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
        try {
          if (statSync(target).isFile()) queue.push(target);
        } catch {
          /* a real .js file or a .json: nothing to follow */
        }
      }
    }
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(10);
  });
});
