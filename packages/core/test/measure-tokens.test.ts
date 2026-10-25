// @vitest-environment jsdom
// Token harvest: the in-page script on a DOM (declarations at the story, providers, aliases), and the pure helpers the
// plugin uses (variable paths, library prefix, used marks).
import { beforeEach, describe, expect, it } from 'vitest';
import { markUsedTokens, sharedTokenPrefix, tokenVariablePath, type MeasuredTokens } from '../src';
import { harvestTokens, type MeasurePage } from '../src/node';
import { TOKENS_SCRIPT } from '../src/node/tokens-script';

type Raw = { name: string; raw: string; applies: boolean; scopes: string[] };
const run = () => ((0, eval)(`(${TOKENS_SCRIPT})`)({}) as { properties: Raw[] }).properties;

beforeEach(() => {
  document.head.innerHTML = `<style>
    :root { --color-blue-500: #0969da; --space-2: 8px; --_private: 1px; }
    :root, [data-color-mode="light"] { --fg-accent: var(--color-blue-500); }
    [data-color-mode="dark"] { --fg-accent: var(--color-blue-300); }
    .provider { --colorBrandBackground: var(--color-blue-500); --gap: calc(var(--space-2) * 2); }
  </style>`;
  document.body.innerHTML = `<div class="provider" data-color-mode="dark"><div id="storybook-root"><button>Save</button></div></div>`;
});

describe('TOKENS_SCRIPT', () => {
  it('lists the custom properties the stylesheets define, private ones aside', () => {
    expect(run().map((p) => p.name).sort()).toEqual(['--color-blue-500', '--colorBrandBackground', '--fg-accent', '--gap', '--space-2']);
  });

  it('takes the declaration that applies where the story sits: a provider or theme selector over :root', () => {
    const byName = Object.fromEntries(run().map((p) => [p.name, p]));
    expect(byName['--fg-accent']).toMatchObject({ raw: 'var(--color-blue-300)', applies: true });
    expect(byName['--fg-accent']!.scopes).toContain('[data-color-mode="dark"]');
    expect(byName['--colorBrandBackground']).toMatchObject({ raw: 'var(--color-blue-500)', scopes: ['.provider'] });
  });
});

describe('TOKENS_SCRIPT: channels', () => {
  type Typed = Raw & { type: string; value: string | number };
  it('channels every use wraps in one color function are that color; a bare use keeps them as written', () => {
    document.head.innerHTML = `<style>
      :root { --primary: 212 100% 47%; --rgb: 9 105 218; --mixed: 0 0% 50%; --ring: var(--primary); --opacity: 0.5; }
      .a { background-color: hsl(var(--primary) / var(--opacity, 1)); }
      .b { border-color: rgb(var(--rgb)); outline-color: hsl(var(--ring)); }
      .c { color: hsl(var(--mixed)); }
      .d { content: var(--mixed); }
    </style>`;
    const byName = Object.fromEntries((run() as Typed[]).map((p) => [p.name, p]));
    expect(byName['--primary']).toMatchObject({ type: 'color', value: 'rgb(0, 112, 240)' });
    expect(byName['--rgb']).toMatchObject({ type: 'color', value: 'rgb(9, 105, 218)' });
    expect(byName['--mixed']!.type).toBe('string');
    expect(byName['--opacity']!.type).toBe('number');
  });
});

describe('token helpers', () => {
  it('derives Figma variable paths from property names, prefix dropped', () => {
    expect(tokenVariablePath('--color-fg-default')).toBe('color/fg/default');
    expect(tokenVariablePath('--fgColor-muted')).toBe('fg/color/muted');
    expect(tokenVariablePath('--cds-layer-01', 'cds')).toBe('layer/01');
    expect(tokenVariablePath('--colorNeutralForeground1')).toBe('color/neutral/foreground1');
  });

  it('finds a prefix most properties share, not a common first word', () => {
    expect(sharedTokenPrefix(Array.from({ length: 30 }, (_, i) => `--cds-x-${i}`))).toBe('cds');
    expect(sharedTokenPrefix([...Array.from({ length: 10 }, (_, i) => `--color-${i}`), ...Array.from({ length: 12 }, (_, i) => `--space-${i}`)])).toBeUndefined();
  });

  it('marks what measured stories use, and the primitives their aliases need', () => {
    const p = (name: string, extra: object = {}) => ({ name, path: name, tier: 'primitive' as const, kind: 'literal' as const, type: 'color' as const, raw: '#000', value: 'rgb(0, 0, 0)', ...extra });
    const tokens: MeasuredTokens = {
      story: 's',
      modes: [],
      properties: [p('--blue-500'), p('--blue-300'), p('--fg-accent', { tier: 'semantic', kind: 'alias', raw: 'var(--blue-500)', aliasOf: '--blue-500', aliasOfByMode: { 'theme:dark': '--blue-300' } }), p('--unused')],
      counts: { properties: 4, primitives: 3, semantic: 1, used: 0, scoped: 0 },
    };
    const spec = { story: 's', parts: [], values: {}, raw: {}, boxes: {}, coverage: { fields: 1, declared: 1, matched: 0, literal: 0 }, tokens: { root: { fill: { via: 'declared' as const, chain: ['--_bg', '--fg-accent'], exact: true } } } };
    expect(markUsedTokens(tokens, [{ spec }])).toBe(3);
    expect(tokens.properties.filter((x) => x.used).map((x) => x.name)).toEqual(['--blue-500', '--blue-300', '--fg-accent']);
  });
});

describe('harvestTokens over an injected page', () => {
  // Two themes, compiled to literals (Primer, Carbon): the semantic token is a literal per theme.
  const row = (name: string, raw: string, value: string | number, type = 'color') => ({ name, raw, applies: true, type, value, scopes: [] as string[] });
  const light = [row('--green-5', '#1f883d', 'rgb(31, 136, 61)'), row('--green-3', '#4ac26b', 'rgb(74, 194, 107)'), row('--bg-success', '#1f883d', 'rgb(31, 136, 61)'), row('--fg-accent', 'var(--green-5)', 'rgb(31, 136, 61)'), row('--space-2', '8px', 8, 'length')];
  const dark = light.map((r) => (r.name === '--bg-success' ? row('--bg-success', '#4ac26b', 'rgb(74, 194, 107)') : r.name === '--fg-accent' ? row('--fg-accent', 'var(--green-3)', 'rgb(74, 194, 107)') : r));
  const page = (): MeasurePage & { urls: string[] } => {
    const urls: string[] = [];
    return {
      urls,
      goto: async (u) => void urls.push(u),
      evaluate: async <T>(e: string) => {
        if (e.includes('globalTypes')) return [{ global: 'colorScheme', values: ['light', 'dark', 'all'], default: 'light' }, { global: 'locale', values: ['en', 'fr'], default: 'en' }] as T;
        if (e.includes('TOKENS') || e.includes('decls')) return { properties: urls.at(-1)!.includes('colorScheme:dark') ? dark : light } as T;
        return 'rendered' as T;
      },
    };
  };

  it('reads each theme global, keeps modes that change something, and splits primitives from semantic', async () => {
    const p = page();
    const t = await harvestTokens(p, 'https://sb.example.com', 'button--default');
    expect(p.urls).toEqual(['https://sb.example.com/iframe.html?id=button--default&viewMode=story', 'https://sb.example.com/iframe.html?id=button--default&viewMode=story&globals=colorScheme:dark']);
    expect(t.modes).toEqual([{ global: 'colorScheme', values: ['light', 'dark'], default: 'light' }]);
    const by = Object.fromEntries(t.properties.map((x) => [x.name, x]));
    expect(by['--fg-accent']).toMatchObject({ tier: 'semantic', kind: 'alias', aliasOf: '--green-5', aliasOfByMode: { 'colorScheme:dark': '--green-3' } });
    // Written as a literal per theme, but a primitive holds the value in each: a semantic alias of it.
    expect(by['--bg-success']).toMatchObject({ tier: 'semantic', inferred: true, aliasOf: '--green-5', aliasOfByMode: { 'colorScheme:light': '--green-5', 'colorScheme:dark': '--green-3' } });
    expect(by['--space-2']).toMatchObject({ tier: 'primitive', type: 'length', value: 8, path: 'space/2' });
    expect(by['--space-2']!.values).toBeUndefined();
    expect(t.counts).toMatchObject({ properties: 5, primitives: 3, semantic: 2, inferred: 1 });
  });
});

