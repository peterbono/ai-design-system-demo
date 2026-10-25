// @vitest-environment jsdom
// Token files come from arbitrary repositories: names, descriptions and values must never become markup, a style
// that breaks out of its declaration, or a javascript: link in the explorer grid, cells, details and review.
import { describe, expect, it, vi } from 'vitest';
import { buildTokenSet, layoutOptions, loadConfig } from '@bridge-ds/core';
import { buildTokens, emptyFilters, modesOf, type Column, type UsageMap } from '../../lib/explorer/model';
import type { ExplorerData, ExplorerState, View } from './types';

vi.mock('../history/state', () => ({
  loadHistory: () => Promise.reject(new Error('no history in tests')),
  activeReport: () => ({ report: null, demo: false }),
}));

const { cellHtml, studioCellHtml, preview } = await import('./cells');
const { renderGrid } = await import('./grid');
const { renderDetail } = await import('./detail');
const { cssValue } = await import('./util');

const IMG = '<img src=x onerror=alert(1)>';
const SVG = '"><svg onload=alert(1)>';
const STYLE = 'red;background:url(javascript:alert(1))';
const JS = 'javascript:alert(1)';

const files = {
  'primitives/evil.tokens.json': JSON.stringify({
    color: {
      text: {
        [SVG]: { $type: 'color', $description: IMG, $value: { colorSpace: 'srgb', components: [1, 0, 0], hex: STYLE } },
      },
      [IMG]: { $type: 'color', $description: SVG, $value: { colorSpace: 'srgb', components: [0, 0, 1], hex: STYLE } },
      ok: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' } },
      alias: { $type: 'color', $value: `{color.${IMG}}` },
    },
    space: { [SVG]: { $type: 'dimension', $description: IMG, $value: { value: 4, unit: 'px;background:url(javascript:alert(1))' } } },
    font: { family: { [IMG]: { $type: 'fontFamily', $value: STYLE } } },
    shadow: { [SVG]: { $type: 'shadow', $value: { offsetX: { value: 0, unit: 'px' }, offsetY: { value: 1, unit: 'px' }, blur: { value: 2, unit: 'px' }, spread: { value: 0, unit: 'px' }, color: { colorSpace: 'srgb', components: [0, 0, 0], hex: STYLE } } } },
  }),
};

const set = buildTokenSet(files, layoutOptions(loadConfig('{}')));
const paths = [...set.byPath.keys()];
const usage: UsageMap = Object.fromEntries(paths.map((p) => [p, { used: true, usedBy: [{ name: IMG, href: JS }], styles: [SVG] }]));
const tokens = buildTokens(set, usage);
const modes = modesOf(set);
const d: ExplorerData = {
  set,
  head: set,
  tokens,
  byPath: new Map(tokens.map((t) => [t.path, t])),
  usage,
  pairs: [],
  results: [],
  before: [],
  modes,
  tokensRoot: '',
  repo: { owner: 'o', name: 'r', defaultBranch: 'main' },
  reads: { [IMG]: paths },
};
const col: Column = { key: 'value', label: IMG, ctx: { brand: modes.brands[0] ?? 'bridge', theme: modes.themes[0] ?? 'light', density: modes.densities[0] ?? 'comfortable' } };
const view: View = { visible: tokens, plan: { columns: [col], selectors: [], combos: false }, columns: [col] };
const state = (mode: 'read' | 'edit', flat = false): ExplorerState => ({
  mode,
  selection: { lens: 'collections', tier: 'all' },
  filters: emptyFilters(),
  view: { brand: col.ctx.brand, theme: col.ctx.theme, density: col.ctx.density, allCombos: false },
  syntax: 'css',
  showCode: true,
  showDescription: true,
  flat,
  collapsed: new Set(),
  treeOpen: new Set(),
  selected: null,
  active: null,
});

/** No element carries an event handler, no link or style runs script, nothing loads a URL from a style. */
function expectInert(host: Element) {
  for (const el of host.querySelectorAll('*')) {
    for (const a of el.attributes) {
      expect(a.name.startsWith('on'), `${el.tagName} ${a.name}`).toBe(false);
      expect(/javascript:/i.test(a.value) && (a.name === 'href' || a.name === 'src' || a.name === 'style'), `${a.name}=${a.value}`).toBe(false);
      if (a.name === 'style') expect(a.value).not.toMatch(/url\(|expression|;\s*background/i);
    }
  }
  expect(host.querySelector('img, svg[onload], script, iframe')).toBeNull();
  // The payloads still read as text.
  return host;
}

const mount = (html: string) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
};

describe('explorer sinks with hostile token files', () => {
  it('the token set holds the payloads (the test is meaningful)', () => {
    expect(paths.some((p) => p.includes('<img'))).toBe(true);
    expect(paths.some((p) => p.includes('"><svg'))).toBe(true);
  });

  it('cssValue drops values that load URLs or end the declaration, and escapes the rest', () => {
    expect(cssValue(STYLE)).toBe('');
    expect(cssValue('image-set("x.png" 1x)')).toBe('');
    expect(cssValue('expression(alert(1))')).toBe('');
    expect(cssValue('\\75 rl(x)')).toBe('');
    expect(cssValue('@import x')).toBe('');
    expect(cssValue('"Inter Tight", sans-serif')).toBe('&quot;Inter Tight&quot;, sans-serif');
    expect(cssValue('#ff0000')).toBe('#ff0000');
    expect(cssValue('rgb(0 0 0 / 0.5)')).toBe('rgb(0 0 0 / 0.5)');
  });

  it('cells (read and Studio) and previews', () => {
    for (const p of paths) {
      const type = set.byPath.get(p)!.type;
      expectInert(mount(cellHtml(d, p, col, true)));
      expectInert(mount(studioCellHtml(d, p, col, true)));
      expectInert(mount(preview(d, type, p, { resolved: 1, css: STYLE, raw: STYLE, line: STYLE } as never, col, 'lg')));
    }
  });

  it('the grid: names, descriptions, data-path and section keys', () => {
    for (const s of [state('read'), state('edit'), state('read', true)]) {
      const host = document.createElement('div');
      renderGrid(host, d, view, s, { sync: true });
      expectInert(host);
      expect(host.textContent).toContain(IMG);
      const rows = [...host.querySelectorAll<HTMLElement>('[data-path]')].map((r) => r.dataset.path);
      expect(rows).toEqual(expect.arrayContaining(paths));
    }
  });

  it('the details panel, Library and Studio: hrefs from usage never keep javascript:', () => {
    for (const mode of ['read', 'edit'] as const) {
      for (const p of paths) {
        const host = document.createElement('div');
        renderDetail(host, d, view, state(mode), p);
        expectInert(host);
        expect(host.querySelector('#xp-d-title')?.textContent).toBe(p);
        host.querySelectorAll('a').forEach((a) => expect(a.getAttribute('href')).not.toMatch(/^\s*javascript:/i));
      }
    }
  });
});
