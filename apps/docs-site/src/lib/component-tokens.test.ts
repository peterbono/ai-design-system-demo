// Studio > Components "Edit tokens" opens /studio/tokens/?component=<slug>. On every component of this repo, the
// filter shows exactly the tokens the Tokens column counts, and the link only exists when that count is above 0.
import { describe, expect, it } from 'vitest';
import { buildTokenSet, layoutOptions, loadConfig, TIER_ORDER } from '@bridge-ds/core';
import { componentTokenIndex, editTokensHref, loadComponents, resolveInherited, tokenCountLabel, type ComponentInfo } from './components';
import { tokenFiles } from './explorer';
import { applyFilters, buildTokens, componentScope, emptyFilters } from './explorer/model';
import { exists, readText } from './repo';

const set = buildTokenSet(tokenFiles(), layoutOptions(loadConfig(exists('bridge.config.json') ? readText('bridge.config.json') : '{}')));
const tokens = buildTokens(set, {});
const components = loadComponents();
// What the explorer shows on a ?component= load: every collection, then the component scope.
const filtered = (paths: string[]) => applyFilters(componentScope(tokens, paths), { ...emptyFilters(), tiers: [...TIER_ORDER] });

describe('component token filter', () => {
  it('covers every component', () => {
    expect(components.length).toBeGreaterThan(10);
    expect(Object.keys(componentTokenIndex()).sort()).toEqual(components.map((c) => c.slug).sort());
  });

  it.each(components.map((c) => [c.name, c] as const))('%s: own plus inherited equals the filtered result, link iff > 0', (_name, c) => {
    const shown = filtered(c.allTokenPaths);
    const counted = c.tokenPaths.length + c.inherited.reduce((n, i) => n + i.paths.length, 0);
    expect(shown.length).toBe(counted);
    expect(componentTokenIndex()[c.slug]!.paths).toEqual(c.allTokenPaths);
    expect(Boolean(editTokensHref(c))).toBe(counted > 0);
    if (counted) expect(editTokensHref(c)).toBe(`/studio/tokens/?component=${c.slug}`);
  });

  it('counts the known tokens of the CSS module only, in every tier', () => {
    for (const c of components) expect(c.tokenPaths.length).toBe(new Set(c.tokensUsed.filter((t) => t.known).map((t) => t.name)).size);
    const button = components.find((c) => c.slug === 'button')!;
    expect(button.tokenPaths.some((p) => p.startsWith('button.'))).toBe(true);
    const iconButton = components.find((c) => c.slug === 'icon-button')!;
    expect(filtered(iconButton.tokenPaths).map((t) => t.path)).toEqual(iconButton.tokenPaths);
    expect(iconButton.tokenPaths.length).toBeGreaterThan(0);
  });
});

describe('inherited tokens', () => {
  const byName = (n: string) => components.find((c) => c.name === n)!;

  it('IconButton paints with Button stylesheet: counted apart, filtered together', () => {
    const iconButton = byName('IconButton');
    const button = byName('Button');
    expect(iconButton.inherited.map((i) => i.from)).toEqual(['Button']);
    const fromButton = iconButton.inherited[0]!.paths;
    // Distinct: nothing counted twice, and own plus inherited covers Button's whole set.
    expect(fromButton.some((p) => iconButton.tokenPaths.includes(p))).toBe(false);
    expect(new Set([...iconButton.tokenPaths, ...fromButton])).toEqual(new Set([...iconButton.tokenPaths, ...button.tokenPaths]));
    expect(tokenCountLabel(iconButton)).toBe(`${iconButton.tokenPaths.length} own · ${fromButton.length} from Button`);
    expect(componentTokenIndex()['icon-button']).toEqual({ name: 'IconButton', paths: iconButton.allTokenPaths, via: ['Button'] });
    expect(filtered(iconButton.allTokenPaths).length).toBe(iconButton.allTokenPaths.length);
  });

  it('AlertDialog inherits from Dialog, components that import no stylesheet inherit nothing', () => {
    expect(byName('AlertDialog').inherited.map((i) => i.from)).toEqual(['Dialog']);
    expect(byName('Button').inherited).toEqual([]);
    expect(tokenCountLabel(byName('Button'))).toBe(String(byName('Button').tokenPaths.length));
  });

  it('follows reuse transitively, once per component, without counting a token twice', () => {
    type Row = Pick<ComponentInfo, 'name' | 'slug' | 'tokenPaths' | 'inherited' | 'allTokenPaths'> & { reuses: string[] };
    const row = (name: string, tokenPaths: string[], reuses: string[]): Row => ({ name, slug: name.toLowerCase(), tokenPaths, inherited: [], allTokenPaths: [], reuses });
    const list = [row('A', ['a', 'shared'], ['B']), row('B', ['b', 'shared'], ['C', 'A']), row('C', ['c', 'b'], [])];
    resolveInherited(list);
    const [a, b] = list;
    expect(a!.inherited).toEqual([
      { from: 'B', slug: 'b', paths: ['b'] },
      { from: 'C', slug: 'c', paths: ['c'] },
    ]);
    expect(a!.allTokenPaths).toEqual(['a', 'b', 'c', 'shared']);
    expect(b!.inherited.map((i) => i.from)).toEqual(['C', 'A']);
    expect('reuses' in a!).toBe(false);
  });
});
