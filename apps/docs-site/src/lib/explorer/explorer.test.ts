import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenSet, contrastScope, evaluatePairs, layoutOptions, loadConfig, parseContrastChecks, TIER_NAMES } from '@bridge-ds/core';
import { aliasLabel, codeSyntax, cssText, isForeground, typeCategory, valueLine } from './format';
import {
  activeFilterCount,
  applyFilters,
  buildTokens,
  categoryList,
  cellValue,
  collectionTree,
  emptyFilters,
  inSelection,
  matchesQuery,
  modeKeyFor,
  modesOf,
  planColumns,
  sectionsFor,
  varyingOf,
  type ViewState,
} from './model';
import { badgeFor, componentsUsing, contrastFor, directDependents, introducedIn, transitiveDependents, upstreamLanes } from './flow';

// The real token files of this repo: the explorer builds the same set in the browser.
const ROOT = join(__dirname, '../../../../..');
const config = loadConfig(readFileSync(join(ROOT, 'bridge.config.json'), 'utf8'));
const TOKENS = join(ROOT, config.tokens.root);
const files: Record<string, string> = {};
for (const dir of readdirSync(TOKENS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(TOKENS, dir.name))) if (f.endsWith('.tokens.json')) files[`${dir.name}/${f}`] = readFileSync(join(TOKENS, dir.name, f), 'utf8');
}
const set = buildTokenSet(files, layoutOptions(config));
const pairs = parseContrastChecks(readFileSync(join(TOKENS, 'contrast.checks.json'), 'utf8'));
const usage = {
  'color.text.muted': { used: true, usedBy: [{ name: 'Field', href: '/components/field/' }] },
  'menu.item.text-muted': { used: true, usedBy: [{ name: 'Menu', href: '/components/menu/' }] },
};
const tokens = buildTokens(set, usage);
const modes = modesOf(set);
const view: ViewState = { brand: 'bridge', theme: 'light', density: 'comfortable', allCombos: false };
const byPath = new Map(tokens.map((t) => [t.path, t]));

describe('alias labels and code syntax', () => {
  it('reads like a Figma alias chip, not a brace string', () => {
    expect(aliasLabel('palette.neutral.900')).toBe('neutral / 900');
    expect(aliasLabel('color.action.primary.bg')).toBe('action / primary / bg');
    expect(aliasLabel('space.4')).toBe('space / 4');
    expect(aliasLabel('white')).toBe('white');
  });

  it('switches between CSS, JS and DTCG syntax', () => {
    expect(codeSyntax('color.text.muted', 'semantic', 'css')).toBe('var(--color-text-muted)');
    expect(codeSyntax('color.text.muted', 'semantic', 'js')).toBe("cssVar['color-text-muted']");
    expect(codeSyntax('color.steel.50', 'primitive', 'js')).toBe("primitives['color-steel-50']");
    expect(codeSyntax('space.0-5', 'primitive', 'dtcg')).toBe('{space.0-5}');
  });

  it('formats resolved values like tokens.css', () => {
    expect(cssText('duration', { value: 150, unit: 'ms' })).toBe('150ms');
    expect(cssText('cubicBezier', [0.2, 0, 0, 1])).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(cssText('color', { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5, hex: '#000000' })).toBe('rgb(0 0 0 / 0.5)');
    expect(valueLine('color', { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5, hex: '#000000' })).toBe('#000000 50%');
    expect(cssText('shadow', set.byPath.get('shadow.1')!.values.value)).toMatch(/^0px 1px 2px 0px rgb\(13 24 37 \/ 0\.06\), /);
  });

  it('files tokens under a type category and spots foregrounds', () => {
    expect(typeCategory({ path: 'font.size.200', type: 'dimension' })).toBe('typography');
    expect(typeCategory({ path: 'motion.easing.standard', type: 'cubicBezier' })).toBe('motion');
    expect(typeCategory({ path: 'z.modal', type: 'number' })).toBe('number');
    expect(isForeground('color.text.muted')).toBe(true);
    expect(isForeground('checkbox.fg-checked')).toBe(true);
    expect(isForeground('color.bg.default')).toBe(false);
    expect(isForeground('tag.signal-bg')).toBe(false);
  });
});

describe('lenses', () => {
  it('lists exactly the Figma plugin collections, in tier order, with counts', () => {
    const tree = collectionTree(tokens);
    expect(tree.map((c) => c.label)).toEqual(['Primitives', 'Brand', 'Base', 'Semantic', 'Density', 'Component']);
    expect(tree.map((c) => c.label)).toEqual(Object.values(TIER_NAMES));
    expect(tree.reduce((s, c) => s + c.count, 0)).toBe(tokens.length);
    const semantic = tree.find((c) => c.tier === 'semantic')!;
    const color = semantic.groups.find((g) => g.key === 'color')!;
    expect(color.children.map((c) => c.key)).toContain('color.text');
    expect(color.count).toBe(color.children.reduce((s, c) => s + c.count, 0));
  });

  it('groups by type category with counts that add up', () => {
    const cats = categoryList(tokens);
    expect(cats[0]!.category).toBe('color');
    expect(cats.reduce((s, c) => s + c.count, 0)).toBe(tokens.length);
  });

  it('selects a collection, a group inside it, or a type', () => {
    const inText = tokens.filter((t) => inSelection(t, { lens: 'collections', tier: 'semantic', group: 'color.text' }));
    expect(inText.length).toBeGreaterThan(3);
    expect(inText.every((t) => t.path.startsWith('color.text.'))).toBe(true);
    const colors = tokens.filter((t) => inSelection(t, { lens: 'types', category: 'color' }));
    expect(new Set(colors.map((t) => t.tier)).size).toBeGreaterThan(3);
  });

  it('makes Figma group sections in a collection, collection sections across tiers', () => {
    const sem = tokens.filter((t) => t.tier === 'semantic');
    const secs = sectionsFor(sem, { lens: 'collections', tier: 'semantic' });
    expect(secs.map((s) => s.label)).toContain('color / text');
    expect(secs.reduce((s, x) => s + x.tokens.length, 0)).toBe(sem.length);
    const byType = sectionsFor(tokens.filter((t) => t.category === 'color'), { lens: 'types', category: 'color' });
    expect(byType.map((s) => s.label)).toEqual(['Primitives', 'Brand', 'Semantic', 'Component']);
  });
});

describe('mode columns', () => {
  const plan = (s: Parameters<typeof planColumns>[0], v = view) => planColumns(s, modes, v, varyingOf(tokens.filter((t) => inSelection(t, s))));

  it('shows one column per mode of the selected collection', () => {
    expect(plan({ lens: 'collections', tier: 'primitive' }).columns.map((c) => c.label)).toEqual(['Value']);
    expect(plan({ lens: 'collections', tier: 'brand' }).columns.map((c) => c.label)).toEqual(['Bridge', 'Ocean']);
    expect(plan({ lens: 'collections', tier: 'density' }).columns.map((c) => c.label)).toEqual(['Comfortable', 'Compact']);
    const sem = plan({ lens: 'collections', tier: 'semantic' });
    expect(sem.columns.map((c) => c.label)).toEqual(['Light', 'Dark']);
    expect(sem.selectors).toEqual(['brand']);
    expect(sem.combos).toBe(true);
  });

  it('lays out every brand x theme combination when asked', () => {
    const all = plan({ lens: 'collections', tier: 'semantic' }, { ...view, allCombos: true });
    expect(all.columns.map((c) => c.label)).toEqual(['Bridge · Light', 'Bridge · Dark', 'Ocean · Light', 'Ocean · Dark']);
    expect(all.selectors).toEqual([]);
  });

  it('follows the brand selector in theme columns', () => {
    const cols = plan({ lens: 'collections', tier: 'semantic' }, { ...view, brand: 'ocean' }).columns;
    expect(cols.every((c) => c.ctx.brand === 'ocean')).toBe(true);
  });

  it('derives columns for single-mode collections from what their tokens vary along', () => {
    expect(plan({ lens: 'collections', tier: 'component' }).columns.map((c) => c.label)).toEqual(['Light', 'Dark']);
    expect(plan({ lens: 'types', category: 'number' }).columns.map((c) => c.label)).toEqual(['Value']);
    expect(plan({ lens: 'types', category: 'color' }).columns.map((c) => c.label)).toEqual(['Light', 'Dark']);
  });

  it('edits the mode of the token own tier in a column', () => {
    const [light, dark] = plan({ lens: 'collections', tier: 'semantic' }).columns;
    expect(modeKeyFor('semantic', dark!)).toBe('dark');
    expect(modeKeyFor('component', dark!)).toBe('value');
    expect(modeKeyFor('brand', light!)).toBe('bridge');
  });
});

describe('cells', () => {
  it('shows the alias, the resolved value and brand overrides', () => {
    const light = cellValue(set, 'color.text.muted', { brand: 'bridge', theme: 'light', density: 'comfortable' });
    expect(light.alias).toMatch(/^palette\.neutral\./);
    expect(light.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(light.chain[0]).toBe('color.text.muted');
    const o = set.overrides[0]!;
    const over = cellValue(set, o.path, { brand: o.brand, theme: o.theme, density: 'comfortable' });
    expect(over.override).toBe(true);
  });
});

describe('search and filters', () => {
  const muted = byPath.get('color.text.muted')!;

  it('matches words anywhere, or the exact name, CSS variable, var() or hex', () => {
    expect(matchesQuery(muted, 'text muted', false)).toBe(true);
    expect(matchesQuery(muted, 'text', true)).toBe(false);
    expect(matchesQuery(muted, 'color.text.muted', true)).toBe(true);
    expect(matchesQuery(muted, 'var(--color-text-muted)', true)).toBe(true);
    expect(matchesQuery(muted, '{color.text.muted}', true)).toBe(true);
    const hex = cellValue(set, 'color.text.muted', { brand: 'bridge', theme: 'light', density: 'comfortable' }).hex!;
    expect(matchesQuery(muted, hex.toUpperCase(), true)).toBe(true);
  });

  it('combines tier, type and usage filters and counts them for the badge', () => {
    const f = { ...emptyFilters(), tiers: ['semantic' as const, 'component' as const], categories: ['color' as const], usage: 'used' as const };
    expect(activeFilterCount(f)).toBe(4);
    const out = applyFilters(tokens, f);
    expect(out.map((t) => t.path).sort()).toEqual(['color.text.muted', 'menu.item.text-muted'].filter((p) => byPath.has(p)).sort());
    expect(applyFilters(tokens, { ...emptyFilters(), usage: 'unused' }).length).toBe(tokens.length - out.length);
  });
});

describe('token flow', () => {
  const sem = planColumns({ lens: 'collections', tier: 'semantic' }, modes, view, []).columns;

  it('builds the upstream chain per mode, down to the primitive', () => {
    const lanes = upstreamLanes(set, 'color.text.muted', sem);
    expect(lanes).toHaveLength(2);
    for (const lane of lanes) {
      expect(lane.nodes[0]!.path).toBe('color.text.muted');
      expect(lane.nodes.at(-1)!.tier).toBe('primitive');
      expect(lane.nodes.every((n) => n.values[lane.columns[0]!.key]!.hex)).toBe(true);
    }
  });

  it('shares one lane when the chain is the same in every column', () => {
    const comp = set.byPath.get('button.radius') ? 'button.radius' : 'card.radius';
    const lanes = upstreamLanes(set, comp, planColumns({ lens: 'collections', tier: 'density' }, modes, view, []).columns);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.columns).toHaveLength(2);
  });

  it('finds downstream tokens and the components that read them', () => {
    const deps = directDependents(set, 'color.text.muted');
    expect(deps.length).toBeGreaterThan(0);
    expect(deps.every((d) => set.byPath.get(d.path)!.tier === 'component')).toBe(true);
    const all = transitiveDependents(set, 'palette.neutral.600');
    expect(all).toContain('color.text.muted');
    const comps = componentsUsing('color.text.muted', transitiveDependents(set, 'color.text.muted'), usage);
    expect(comps.map((c) => c.name)).toContain('Field');
  });
});

describe('contrast', () => {
  const results = evaluatePairs(set.byPath, pairs, contrastScope(set));

  it('grades text pairs AA, AA large or Fail, and UI pairs at 3:1', () => {
    expect(badgeFor(4.6, 'text')).toBe('AA');
    expect(badgeFor(3.2, 'text')).toBe('AA large');
    expect(badgeFor(2.9, 'text')).toBe('Fail');
    expect(badgeFor(3.1, 'ui')).toBe('AA');
    expect(badgeFor(undefined, 'text')).toBe('Fail');
  });

  it('lists every pair a token is part of, per brand and theme', () => {
    const { direct, through } = contrastFor('color.text.muted', results);
    expect(direct.length).toBeGreaterThan(1);
    expect(direct.every((r) => r.role === 'fg' && r.cells.length === 4)).toBe(true);
    expect(through).toHaveLength(0);
    const viaPalette = contrastFor('palette.neutral.900', results);
    expect(viaPalette.direct).toHaveLength(0);
    expect(viaPalette.through.length).toBeGreaterThan(0);
  });

  it('carries the ratio before a draft', () => {
    const shifted = results.map((r) => ({ ...r, ratio: (r.ratio ?? 0) - 1 }));
    const { direct } = contrastFor('color.text.muted', shifted, results);
    expect(direct[0]!.cells[0]!.before).toBeGreaterThan(direct[0]!.cells[0]!.ratio!);
  });
});

describe('history', () => {
  it('reads the version that added a token, else nothing', () => {
    expect(introducedIn([{ kind: 'changed', version: '1.3.0', date: '2026-05-01' }, { kind: 'added', version: 'v1.1.0', date: '2026-03-01' }])).toBe('1.1.0');
    expect(introducedIn([{ kind: 'added', date: '2026-03-01' }])).toBeUndefined();
    expect(introducedIn([])).toBeUndefined();
  });
});
