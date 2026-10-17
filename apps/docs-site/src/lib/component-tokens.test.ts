// Studio > Components "Edit tokens" opens /studio/tokens/?component=<slug>. On every component of this repo, the
// filter shows exactly the tokens the Tokens column counts, and the link only exists when that count is above 0.
import { describe, expect, it } from 'vitest';
import { buildTokenSet, layoutOptions, loadConfig, TIER_ORDER } from '@bridge-ds/core';
import { componentTokenIndex, editTokensHref, loadComponents } from './components';
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

  it.each(components.map((c) => [c.name, c] as const))('%s: count equals the filtered result, link iff count > 0', (_name, c) => {
    const shown = filtered(c.tokenPaths);
    expect(shown.length).toBe(c.tokenPaths.length);
    expect(shown.length > 0).toBe(c.tokenPaths.length > 0);
    expect(Boolean(editTokensHref(c))).toBe(c.tokenPaths.length > 0);
    if (c.tokenPaths.length) expect(editTokensHref(c)).toBe(`/studio/tokens/?component=${c.slug}`);
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
