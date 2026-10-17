// Read tools against the real repo tokens: resolution must match the Style Dictionary build exactly.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BridgeContext, ops } from '../dist/lib.js';
import { REPO } from './helpers.js';

let ctx: BridgeContext;
const RESOLVED = join(REPO, 'packages/tokens/dist/resolved.json');

beforeAll(async () => {
  if (!existsSync(RESOLVED)) execFileSync('node', ['build.mjs'], { cwd: join(REPO, 'packages/tokens'), stdio: 'pipe' });
  ctx = await BridgeContext.create({ root: REPO });
});

describe('real repo tokens', () => {
  it('bridge_get_config: reads bridge.config.json, 6 tiers, 8 mode combinations, local branches only', async () => {
    const c = await ops.getConfig(ctx);
    expect(c.configOrigin).toBe('bridge.config.json');
    expect(Object.keys(c.tokensPerTier)).toEqual(['primitive', 'brand', 'base', 'semantic', 'density', 'component']);
    expect(c.modeCombinations).toBe(8);
    expect(c.write).toMatch(/local branches only/);
    expect(c.repo).toBe('peterbono/ai-design-system-demo');
  });

  it('resolves every value exactly like dist/resolved.json (brand x theme)', async () => {
    const built = JSON.parse(readFileSync(RESOLVED, 'utf8'));
    const set = await ctx.tokens();
    let compared = 0;
    for (const b of built.brands) {
      for (const t of built.themes) {
        for (const [path, value] of Object.entries(built.values[b][t])) {
          expect(set.resolve(path, { brand: b, theme: t, density: 'comfortable' }).css, `${b}/${t} ${path}`).toBe(String(value));
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(700);
  });

  it('bridge_validate_tokens: the repo is valid (DTCG, aliases, light/dark parity)', async () => {
    const v = await ops.validateTokens(ctx, {});
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it('bridge_check_contrast: same 220 checks and ratios as the token build', async () => {
    const built = JSON.parse(readFileSync(RESOLVED, 'utf8'));
    const c = await ops.checkContrast(ctx, { includePassing: true });
    expect('checks' in c && c.checks).toBe(built.contrast.length);
    expect('failing' in c && c.failing).toBe(0);
    const results = 'results' in c ? c.results! : [];
    for (const r of built.contrast) {
      const mine = results.find((x) => x.fg === r.fg && x.bg === r.bg && x.modes === `brand=${r.brand},theme=${r.theme},density=comfortable`);
      expect(mine?.ratio, `${r.fg} on ${r.bg}`).toBe(r.ratio);
    }
  });

  it('bridge_check_contrast with edits: reports new failures without writing', async () => {
    const before = readFileSync(join(REPO, 'packages/tokens/src/semantic/light.tokens.json'), 'utf8');
    const c = await ops.checkContrast(ctx, { edits: [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.300}', mode: { theme: 'light' } }] });
    expect('newFailures' in c && c.newFailures!.length).toBeGreaterThan(0);
    expect(readFileSync(join(REPO, 'packages/tokens/src/semantic/light.tokens.json'), 'utf8')).toBe(before);
  });

  it('bridge_check_contrast with ad-hoc pairs', async () => {
    const c = await ops.checkContrast(ctx, { pairs: [{ fg: 'color.text.default', bg: 'color.bg.default', min: 7 }], mode: { brand: 'bridge' } });
    expect('checks' in c && c.checks).toBe(2);
  });

  it('bridge_list_tokens: filters by tier, type, prefix and mode', async () => {
    const comp = await ops.listTokens(ctx, { tier: 'component', limit: 500 });
    expect(comp.tokens.every((t) => t.tier === 'component')).toBe(true);
    const dark = await ops.listTokens(ctx, { prefix: 'color.text', type: 'color', mode: { theme: 'dark' } });
    const muted = dark.tokens.find((t) => t.path === 'color.text.muted');
    expect(muted?.value).toBe('#a0aab5');
    expect(muted?.alias).toBe('{palette.neutral.400}');
    const page = await ops.listTokens(ctx, { limit: 10, offset: 10 });
    expect(page.tokens).toHaveLength(10);
    expect(page.next).toBe('offset 20');
    await expect(ops.listTokens(ctx, { mode: { theme: 'sepia' } })).rejects.toThrow(/Unknown theme/);
  });

  it('bridge_get_token: values per mode, alias chain, referencedBy, component usage', async () => {
    const t = await ops.getToken(ctx, { path: 'var(--color-text-muted)' });
    expect(t.path).toBe('color.text.muted');
    expect(t.tier).toBe('semantic');
    expect(t.values).toHaveLength(4);
    expect(t.values[0]!.chain).toEqual(['color.text.muted', 'palette.neutral.600', 'color.ink.600']);
    expect(t.definedIn.map((d) => d.file)).toContain('packages/tokens/src/semantic/dark.tokens.json');
    expect(t.referencedBy.length).toBeGreaterThan(0);
    expect(t.usedIn.length).toBeGreaterThan(0);
    const bg = await ops.getToken(ctx, { path: 'color.action.primary.bg' });
    expect(bg.usedIn.some((u) => u.component === 'Button' && u.via === 'button.primary.bg')).toBe(true);
    await expect(ops.getToken(ctx, { path: 'color.text.nope' })).rejects.toThrow(/No token/);
  });

  it('bridge_search_tokens: by words, by CSS variable and by color value', async () => {
    const words = await ops.searchTokens(ctx, { query: 'focus ring' });
    expect(words.results[0]!.path).toMatch(/^focus\.ring\./);
    const v = await ops.searchTokens(ctx, { query: '--color-text-muted' });
    expect(v.results[0]!.path).toBe('color.text.muted');
    const hex = await ops.searchTokens(ctx, { query: '#5b6672', type: 'color' });
    expect(hex.results.map((r) => r.path)).toContain('color.text.muted');
  });
});
