import { describe, expect, it } from 'vitest';
import { allTokenRows, matchesRow, normalizeQuery, rowForLink, shortValue, sourceLabel, typeChips, type SemanticInput } from './all-tokens';

const mode = (css: string, chain: string[], hex?: string) => ({ css, chain, hex });
const tok = (path: string, type: string, light: ReturnType<typeof mode>, dark = light, tier = 'semantic'): SemanticInput => ({
  path,
  cssVar: `--${path.replace(/\./g, '-')}`,
  type,
  tier,
  modes: { light, dark },
});

const tokens: SemanticInput[] = [
  tok('color.bg.zone', 'color', mode('#cfe8ff', ['palette.primary.200', 'color.harbor.200'], '#cfe8ff'), mode('#00274b', ['palette.primary.900', 'color.harbor.900'], '#00274b')),
  tok('color.text.default', 'color', mode('#15202b', ['palette.neutral.900', 'color.ink.900'], '#15202b')),
  tok('motion.duration.fast', 'duration', mode('150ms', ['duration.150'])),
  tok('motion.easing.standard', 'cubicBezier', mode('cubic-bezier(0.2, 0, 0, 1)', ['easing.standard'])),
  tok('elevation.raised', 'shadow', mode('0px 1px 2px 0px rgb(13 24 37 / 0.06)', ['shadow.1'])),
  tok('icon.size.sm', 'dimension', mode('16px', ['size.4'])),
  tok('layer.modal', 'number', mode('1200', ['z.modal'])),
  tok('radius.control', 'dimension', mode('12px', ['radius.xl']), undefined, 'brand'),
  tok('control.height.md', 'dimension', mode('44px', ['size.11']), undefined, 'density'),
];

describe('all tokens rows', () => {
  const rows = allTokenRows(tokens);

  it('keeps the semantic tier only, in source order', () => {
    expect(rows.map((r) => r.path)).toEqual(['color.bg.zone', 'color.text.default', 'motion.duration.fast', 'motion.easing.standard', 'elevation.raised', 'icon.size.sm', 'layer.modal']);
  });

  it('files durations and easings under motion', () => {
    expect(rows.find((r) => r.path === 'motion.easing.standard')?.type).toBe('motion');
    expect(rows.find((r) => r.path === 'elevation.raised')?.type).toBe('shadow');
  });

  it('names the palette step a color comes from, per mode', () => {
    const zone = rows[0];
    expect(zone.light).toEqual({ css: '#cfe8ff', short: '#cfe8ff', source: 'primary.200' });
    expect(zone.dark.source).toBe('primary.900');
  });

  it('shows the primitive instead of a long value', () => {
    expect(rows.find((r) => r.path === 'elevation.raised')?.light.short).toBe('shadow.1');
    expect(rows.find((r) => r.path === 'motion.easing.standard')?.light.short).toBe('easing.standard');
    expect(rows.find((r) => r.path === 'motion.duration.fast')?.light.short).toBe('150ms');
  });
});

describe('type chips', () => {
  it('counts every type that has tokens, All first', () => {
    const chips = typeChips(allTokenRows(tokens));
    expect(chips).toEqual([
      { value: 'all', label: 'All', count: 7 },
      { value: 'color', label: 'Color', count: 2 },
      { value: 'dimension', label: 'Dimension', count: 1 },
      { value: 'motion', label: 'Motion', count: 2 },
      { value: 'number', label: 'Number', count: 1 },
      { value: 'shadow', label: 'Shadow', count: 1 },
    ]);
  });
});

describe('filter', () => {
  const rows = allTokenRows(tokens);
  const find = (q: string, type: Parameters<typeof matchesRow>[2] = 'all') => rows.filter((r) => matchesRow(r, q, type)).map((r) => r.path);

  it('matches path, CSS variable, var() and hex', () => {
    expect(find('bg.zone')).toEqual(['color.bg.zone']);
    expect(find('--color-bg-zone')).toEqual(['color.bg.zone']);
    expect(find('var(--color-bg-zone)')).toEqual(['color.bg.zone']);
    expect(find('#00274B')).toEqual(['color.bg.zone']);
  });

  it('matches the alias chain, so a primitive finds the tokens built on it', () => {
    expect(find('color.harbor.200')).toEqual(['color.bg.zone']);
    expect(find('ink.900')).toEqual(['color.text.default']);
  });

  it('needs every word and respects the type chip', () => {
    expect(find('color text')).toEqual(['color.text.default']);
    expect(find('', 'motion')).toEqual(['motion.duration.fast', 'motion.easing.standard']);
    expect(find('zone', 'motion')).toEqual([]);
  });

  it('normalizes pasted names', () => {
    expect(normalizeQuery('  VAR( --color-bg-zone ) ')).toBe('--color-bg-zone');
  });
});

describe('helpers', () => {
  it('sourceLabel', () => {
    expect(sourceLabel(['palette.accent.50', 'color.harbor.50'])).toBe('accent.50');
    expect(sourceLabel(['duration.150'])).toBe('duration.150');
    expect(sourceLabel([])).toBe('');
  });

  it('shortValue', () => {
    expect(shortValue('#fff', '#ffffff', 'x')).toBe('#ffffff');
    expect(shortValue('a very long css value', undefined, '')).toBe('a very long css value');
  });

  it('rowForLink accepts a path or a CSS variable', () => {
    const rows = allTokenRows(tokens);
    expect(rowForLink(rows, 'color.bg.zone')).toBe('color.bg.zone');
    expect(rowForLink(rows, '--color-bg-zone')).toBe('color.bg.zone');
    expect(rowForLink(rows, 'color-bg-zone')).toBe('color.bg.zone');
    expect(rowForLink(rows, 'color.harbor.200')).toBeNull();
    expect(rowForLink(rows, null)).toBeNull();
  });
});
