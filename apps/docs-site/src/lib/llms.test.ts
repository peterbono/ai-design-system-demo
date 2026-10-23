// Every link /llms.txt gives agents leads to a page or file the site builds (a 404 there sends an agent nowhere).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadComponents } from './components';
import { buildLlmsTxt } from './llms';

const PAGES = fileURLToPath(new URL('../pages', import.meta.url));

/** Whether src/pages builds this path: a page, an index, an endpoint (`tokens.css.ts`) or a [param] route. */
function built(path: string): boolean {
  const parts = path.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (!rest.length) return existsSync(join(dir, 'index.astro'));
    const [head, ...tail] = rest as [string, ...string[]];
    if (!tail.length && (existsSync(join(dir, `${head}.astro`)) || existsSync(join(dir, `${head}.ts`)) || existsSync(join(dir, head, 'index.astro')))) return true;
    if (existsSync(join(dir, head)) && walk(join(dir, head), tail)) return true;
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((f) => {
      if (!f.startsWith('[')) return false;
      if (!tail.length && f.endsWith('.astro')) return true;
      // [slug].json.ts builds <slug>.json
      if (!tail.length && f.endsWith('.ts')) return head.endsWith(f.replace(/^\[[^\]]+\]/, '').replace(/\.ts$/, ''));
      return !f.includes('.') && walk(join(dir, f), tail);
    });
  };
  return walk(PAGES, parts);
}

describe('/llms.txt', () => {
  const text = buildLlmsTxt();
  const links = [...new Set([...text.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]!))];
  const bare = [...new Set([...text.matchAll(/(?<=[\s(])(\/[a-z][a-z0-9-]*(?:\/[a-z0-9.-]+)*\/?)(?=[\s,).]|$)/gm)].map((m) => m[1]!))];

  it('links only to pages and files the site builds', () => {
    expect(links.length).toBeGreaterThan(5);
    for (const l of [...links, ...bare]) expect(built(l.split('#')[0]!), l).toBe(true);
  });

  it('never points at the /foundations/ index, which does not exist', () => {
    expect(built('/foundations/')).toBe(false);
    expect(text).not.toMatch(/\/foundations\/(?=[\s,)]|$)/m);
  });

  it('links the tokens stylesheet and each component docs facts file', () => {
    expect(links).toContain('/tokens.css');
    for (const c of loadComponents()) expect(links).toContain(`/docs-ai/${c.slug}.json`);
  });
});
