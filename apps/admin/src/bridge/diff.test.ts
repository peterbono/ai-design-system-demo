import { describe, expect, it } from 'vitest';
import { dependents, EMPTY_LINE, outOfView, isKey, longhands, outermost, roleName, surfaceLine, usages, varsIn, type RuleLike } from './diff';

const rules: RuleLike[] = [
  { selector: ':root', decls: [{ prop: '--color-bg-default', value: 'var(--palette-neutral-50)' }, { prop: '--color-text-default', value: 'var(--palette-ink-900)' }] },
  { selector: '[data-brand="bridge"]', decls: [{ prop: '--card-bg', value: 'var(--color-bg-default)' }, { prop: '--chip-bg', value: 'var(--card-bg)' }] },
  { selector: ':where(body)', decls: [{ prop: 'background-color', value: 'var(--color-bg-default)' }, { prop: 'min-height', value: '100vh' }] },
  { selector: '.card, .tile::before', decls: [{ prop: 'border', value: '1px solid var(--chip-bg)' }] },
  { selector: '.title', decls: [{ prop: 'color', value: 'var(--color-text-default)' }] },
  { selector: ':is(.a, .b) > .c', decls: [{ prop: 'background', value: 'var(--card-bg, white)' }] },
];

describe('varsIn', () => {
  it('reads every variable of a value, fallbacks included', () => {
    expect(varsIn('var(--a, var(--b)) 1px')).toEqual(['--a', '--b']);
    expect(varsIn('red')).toEqual([]);
  });
});

describe('dependents', () => {
  it('follows aliases to every variable that resolves through a changed token', () => {
    const roots = dependents(rules, ['--color-bg-default']);
    expect([...roots.keys()].sort()).toEqual(['--card-bg', '--chip-bg', '--color-bg-default']);
    expect([...roots.get('--chip-bg')!]).toEqual(['--color-bg-default']);
    expect(roots.has('--color-text-default')).toBe(false);
  });
});

describe('usages', () => {
  it('lists the rules and computed properties a changed token feeds, pseudo-elements apart', () => {
    const u = usages(rules, dependents(rules, ['--color-bg-default']));
    expect(u).toEqual([
      { selector: ':where(body)', pseudo: null, props: ['background-color'], roots: ['--color-bg-default'] },
      { selector: '.card', pseudo: null, props: longhands('border'), roots: ['--color-bg-default'] },
      { selector: '.tile', pseudo: '::before', props: longhands('border'), roots: ['--color-bg-default'] },
      { selector: ':is(.a, .b) > .c', pseudo: null, props: ['background-color', 'background-image'], roots: ['--color-bg-default'] },
    ]);
  });

  it('skips what paints nothing on screen: native control tint, caret and text selection', () => {
    const quiet: RuleLike[] = [
      { selector: ':root', decls: [{ prop: 'accent-color', value: 'var(--x)' }, { prop: 'caret-color', value: 'var(--x)' }] },
      { selector: '::selection', decls: [{ prop: 'background-color', value: 'var(--x)' }] },
    ];
    expect(usages(quiet, dependents(quiet, ['--x']))).toEqual([]);
  });

  it('finds nothing when no rule reads the token', () => {
    expect(usages(rules, dependents(rules, ['--color-unused']))).toEqual([]);
  });
});

describe('longhands', () => {
  it('expands shorthands and logical properties to what getComputedStyle reports', () => {
    expect(longhands('border-color')).toEqual(['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']);
    expect(longhands('border-inline-end')).toEqual(['border-right-color', 'border-right-width']);
    expect(longhands('color')).toEqual(['color']);
  });
});

describe('wording and keys', () => {
  it('counts tokens and surfaces, and says when the screen is untouched', () => {
    expect(surfaceLine(['Page canvas', 'Page canvas'], 3)).toBe('1 token changed: Page canvas, on 3 surfaces');
    expect(surfaceLine(['A', 'B', 'C', 'D'], 1)).toBe('4 tokens changed: A, B, C and 1 more, on 1 surface');
    expect(outOfView(1)).toBe('Nothing changed in view. 1 surface changes further down: scroll to see it.');
    expect(outOfView(3)).toContain('3 surfaces change further down');
    expect(EMPTY_LINE).toBe("This change doesn't touch this screen. Open Screens to see where it does.");
  });

  it('toggles on C, never while typing or with a modifier', () => {
    const k = (key: string, target: unknown = null, meta = false) => ({ key, altKey: false, ctrlKey: false, metaKey: meta, target });
    expect(isKey(k('c'), 'c')).toBe(true);
    expect(isKey(k('C'), 'c')).toBe(true);
    expect(isKey(k('c', null, true), 'c')).toBe(false);
    expect(isKey(k('c', { tagName: 'TEXTAREA' }), 'c')).toBe(false);
    expect(isKey(k('b'), 'c')).toBe(false);
  });
});

describe('outermost', () => {
  type N = { id: string; parent: string | null; keys: string[] };
  const nodes: N[] = [
    { id: 'html', parent: null, keys: ['--bg|background-color'] },
    { id: 'body', parent: 'html', keys: ['--bg|background-color'] },
    { id: 'bar', parent: 'body', keys: ['--bg|background-color'] },
    { id: 'link', parent: 'body', keys: ['--link|color'] },
  ];
  const ancestor = (a: N, b: N): boolean => {
    let p = b.parent;
    while (p) {
      if (p === a.id) return true;
      p = nodes.find((n) => n.id === p)!.parent;
    }
    return false;
  };
  it('keeps the outermost surface per token and property, and nested ones that change something else', () => {
    expect(outermost(nodes, ancestor).map((n) => n.id)).toEqual(['html', 'link']);
  });

  it('keeps a sticky or fixed element as its own surface: it paints over other content', () => {
    const floating = nodes.map((n) => (n.id === 'bar' ? { ...n, floating: true } : n));
    expect(outermost(floating, ancestor).map((n) => n.id)).toEqual(['html', 'bar', 'link']);
  });
});

describe('roleName', () => {
  const info = (o: Partial<Parameters<typeof roleName>[0]>) => ({ tag: 'div', role: null, ariaLabel: null, classes: [], text: null, ...o });
  it('names landmarks, roles and components before their text', () => {
    expect(roleName(info({ tag: 'BODY' }))).toBe('Page');
    expect(roleName(info({ classes: ['_column_1s9u8_40'] }))).toBe('Content column');
    expect(roleName(info({ classes: ['_toolbar_1f7pa_30', '_sticky_1f7pa_38'], text: 'Save changes' }))).toBe('Save bar (Save changes)');
    expect(roleName(info({ tag: 'header', text: 'Order RNENVNHI' }))).toBe('Header (Order RNENVNHI)');
    expect(roleName(info({ role: 'dialog', text: 'A very long text that is longer than thirty two characters' }))).toBe('Dialog');
    expect(roleName(info({ classes: ['_statCard_ab12c_3'] }))).toBe('Stat card');
    expect(roleName(info({ text: 'Total' }))).toBe('Total');
    expect(roleName(info({ tag: 'path', classes: ['recharts-curve'] }))).toBe('Chart');
    expect(roleName(info({ tag: 'span', classes: ['_mark_1s9u8_60'], text: 'NP' }))).toBe('Shop logo');
  });
});
