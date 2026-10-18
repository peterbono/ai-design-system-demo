import { describe, expect, it } from 'vitest';
import { contrastMeta, definedIn, readsByComponent, splitDescription, summarySentence, usedByRows } from './detail-summary';

describe('splitDescription', () => {
  it('moves a developer-only note out of the lead', () => {
    expect(splitDescription('Self-hosted via @fontsource-variable/ibm-plex-sans (import @bridge-ds/tokens/fonts.css).')).toEqual({
      developer: 'Self-hosted via @fontsource-variable/ibm-plex-sans (import @bridge-ds/tokens/fonts.css).',
    });
  });

  it('keeps the designer sentence as the lead', () => {
    expect(splitDescription('Display and heading serif of the bridge brand. Self-hosted via @fontsource-variable/fraunces (import @bridge-ds/tokens/fonts.css).')).toEqual({
      lead: 'Display and heading serif of the bridge brand.',
      developer: 'Self-hosted via @fontsource-variable/fraunces (import @bridge-ds/tokens/fonts.css).',
    });
  });

  it('keeps a plain description whole and handles none', () => {
    expect(splitDescription('Primary action fill (steel ink in the bridge brand).')).toEqual({ lead: 'Primary action fill (steel ink in the bridge brand).' });
    expect(splitDescription(undefined)).toEqual({});
    expect(splitDescription('  ')).toEqual({});
  });
});

describe('summarySentence', () => {
  it('reads the plex sans example', () => {
    expect(summarySentence({ tier: 'primitive', aliasedBy: Array(9).fill('brand'), components: 36, styles: 0 })).toBe('Primitive. 9 brand tokens point to it, used by 36 components.');
  });

  it('counts mixed tiers, one alias, styles and an override', () => {
    expect(summarySentence({ tier: 'semantic', aliasedBy: ['component'], components: 1, styles: 1, overriddenBy: 'ocean' })).toBe(
      'Semantic token. 1 component token points to it, used by 1 component and 1 global style. The ocean brand overrides its value here.',
    );
    expect(summarySentence({ tier: 'brand', aliasedBy: ['semantic', 'component'], components: 0, styles: 0 })).toBe('Brand token. 2 tokens point to it, no component uses it.');
  });

  it('says when nothing uses it', () => {
    expect(summarySentence({ tier: 'component', aliasedBy: [], components: 0, styles: 0 })).toBe('Component token. No token points to it and nothing uses it yet.');
  });
});

describe('usedByRows', () => {
  const comps = [
    { name: 'Button', href: '/components/button/' },
    { name: 'Card', href: '/components/card/' },
    { name: 'Menu', href: '/components/menu/' },
  ];
  it('names the nearest token each component reads, then global styles', () => {
    const reads = { Button: ['font.family.plex-sans'], Card: ['typography.body.family', 'font.family.sans'] };
    expect(usedByRows('font.family.plex-sans', ['font.family.sans', 'typography.body.family'], comps, ['base.css'], reads)).toEqual([
      { name: 'Button', href: '/components/button/', via: 'font.family.plex-sans' },
      { name: 'Card', href: '/components/card/', via: 'font.family.sans' },
      { name: 'Menu', href: '/components/menu/', via: 'Through an alias' },
      { name: 'base.css', via: 'Global style' },
    ]);
  });

  it('merges the components index by name', () => {
    expect(readsByComponent({ button: { name: 'Button', paths: ['a'] }, 'button-2': { name: 'Button', paths: ['b'] } })).toEqual({ Button: ['a', 'b'] });
  });
});

describe('definedIn and contrastMeta', () => {
  it('lists each file once under the tokens root', () => {
    expect(definedIn({ light: 'semantic/light.tokens.json', dark: 'semantic/dark.tokens.json', x: 'semantic/light.tokens.json' }, 'packages/tokens/src/')).toEqual([
      'packages/tokens/src/semantic/light.tokens.json',
      'packages/tokens/src/semantic/dark.tokens.json',
    ]);
    expect(definedIn({ value: 'primitives/color.tokens.json' }, '.')).toEqual(['primitives/color.tokens.json']);
  });

  it('summarises contrast pairs', () => {
    expect(contrastMeta(0, 0)).toBe('Not checked');
    expect(contrastMeta(1, 0)).toBe('1 pair, passes');
    expect(contrastMeta(3, 0)).toBe('3 pairs, all pass');
    expect(contrastMeta(3, 1)).toBe('3 pairs, 1 failing');
  });
});
