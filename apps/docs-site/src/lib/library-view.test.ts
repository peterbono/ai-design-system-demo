// A team's Library (multi-team PR 4a): what its pages show, from a repo model. Run on this repository's own model, plus
// hostile docs.json shapes a team repository could hold.
import { describe, expect, it } from 'vitest';
import { repoModel } from './model';
import {
  bridgeDataUrl,
  componentFromQuery,
  filterTokenRows,
  hasGuidance,
  libraryComponents,
  libraryDocs,
  libraryFoundations,
  libraryHome,
  librarySearchIndex,
  libraryTokenRows,
  llmsTxtUrl,
  publishedLine,
  tierCounts,
  tokenFromQuery,
} from './library-view';

describe('bridge-data links', () => {
  it('reads a public repository from the raw host and a private one on GitHub', () => {
    expect(llmsTxtUrl('acme', 'ds', false)).toBe('https://raw.githubusercontent.com/acme/ds/bridge-data/llms.txt');
    expect(llmsTxtUrl('acme', 'ds', true)).toBe('https://github.com/acme/ds/blob/bridge-data/llms.txt');
    expect(bridgeDataUrl('a b', 'c', 'snapshot.json', false)).toBe('https://raw.githubusercontent.com/a%20b/c/bridge-data/snapshot.json');
  });
});

describe('home', () => {
  it('counts what the Library holds in one sentence', () => {
    const home = libraryHome(repoModel);
    expect(home.components).toBe(repoModel.components!.list.length);
    expect(home.tokens).toBe(repoModel.tokens.rows.all.length);
    expect(home.lead).toMatch(/^\d+ components and \d+ tokens, in light and dark\.$/);
    expect(libraryHome({ ...repoModel, components: null, tokens: { ...repoModel.tokens, rows: { ...repoModel.tokens.rows, all: [], semantic: [] } } }).lead).toMatch(/^No tokens or components/);
  });
});

describe('foundations', () => {
  it('draws more than the Studio glimpse', () => {
    const set = libraryFoundations(repoModel);
    expect(set.color.length).toBeGreaterThan(12);
    expect(set.total).toBeGreaterThan(0);
  });
});

describe('components', () => {
  it('lists every component with its docs as text', () => {
    const list = libraryComponents(repoModel);
    expect(list).toHaveLength(repoModel.components!.list.length);
    const button = componentFromQuery(list, '?c=Button');
    expect(button?.name).toBe('Button');
    expect(hasGuidance(button!.docs)).toBe(true);
    expect(componentFromQuery(list, '?c=nope')).toBeUndefined();
    expect(componentFromQuery(list, '')).toBeUndefined();
  });

  it('coerces any docs.json a repository holds into text', () => {
    expect(libraryDocs(null)).toBeNull();
    expect(libraryDocs(['x'])).toBeNull();
    const d = libraryDocs({ summary: { evil: true }, status: '<b>', whenToUse: ['ok', 3, null, '  '], dos: [{ title: 'Do this', text: 7 }, { text: 'no title' }, null], donts: 'x', accessibility: [{}] });
    expect(d).toEqual({ summary: '', status: 'stable', whenToUse: ['ok'], whenNotToUse: [], dos: [{ title: 'Do this', text: '' }], donts: [], accessibility: [], contentGuidelines: [] });
    expect(hasGuidance(libraryDocs({ summary: 'Only a summary' }))).toBe(false);
  });
});

describe('tokens', () => {
  const rows = libraryTokenRows(repoModel);

  it('lists every token, semantic first and primitives last', () => {
    expect(rows).toHaveLength(repoModel.tokens.rows.all.length + repoModel.tokens.rows.primitives.length);
    expect(rows[0]!.tier).toBe('semantic');
    expect(rows[rows.length - 1]!.tier).toBe('primitive');
    expect(tierCounts(rows)[0]).toEqual({ tier: 'semantic', n: repoModel.tokens.rows.semantic.length });
  });

  it('gives each themed value a safe swatch', () => {
    const canvas = rows.find((r) => r.path === 'color.bg.default')!;
    expect(canvas.values.map((v) => v.label)).toEqual(['light', 'dark']);
    for (const v of canvas.values) expect(v.swatch).toBe(v.text);
  });

  it('searches path, variable, description and value within a tier', () => {
    expect(filterTokenRows(rows, '--color-bg-default', '').map((r) => r.path)).toContain('color.bg.default');
    expect(filterTokenRows(rows, 'color.bg.default', 'primitive')).toEqual([]);
    expect(filterTokenRows(rows, '', 'primitive').every((r) => r.tier === 'primitive')).toBe(true);
  });
});

describe('published line', () => {
  it('dates a snapshot read as published', () => {
    expect(publishedLine({ published: '2026-10-20T08:00:00Z', sha: 'a1b2c3d4e5', branch: 'main' })).toBe('Published Oct 20, 2026 from a1b2c3d on main.');
    expect(publishedLine({ sha: 'a1b2c3d', branch: 'main' })).toBeNull();
    expect(publishedLine({ published: 'not a date', sha: 'a1b2c3d', branch: 'main' })).toBeNull();
  });
});

describe('header search', () => {
  it("indexes the team's places, components and tokens at the team's Library addresses", () => {
    const index = librarySearchIndex(repoModel, 'peterbono', 'bridge-demo-ds');
    const pages = index.filter((x) => x.kind === 'page');
    expect(pages.map((p) => p.title)).toEqual(['Home', 'Foundations', 'Components', 'Tokens']);
    expect(pages[0]!.href).toBe('/library/peterbono/bridge-demo-ds/');
    const components = index.filter((x) => x.kind === 'component');
    expect(components.length).toBe(libraryComponents(repoModel).length);
    expect(components.find((c) => c.title === 'Button')?.href).toBe('/library/peterbono/bridge-demo-ds/components/?c=button');
    const tokens = index.filter((x) => x.kind === 'token');
    expect(tokens.length).toBe(libraryTokenRows(repoModel).length);
    const token = tokens.find((t) => t.title === 'color.text.default')!;
    expect(token.href).toBe('/library/peterbono/bridge-demo-ds/tokens/?t=color.text.default');
    expect(token.swatch).toBeTruthy();
    expect(token.keys).toContain('--color-text-default');
  });

  it('opens the token a search result names', () => {
    expect(tokenFromQuery('?t=color.text.default')).toBe('color.text.default');
    expect(tokenFromQuery('?c=button')).toBe('');
    expect(tokenFromQuery('')).toBe('');
  });
});
