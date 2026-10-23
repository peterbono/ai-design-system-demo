// What a team's Library shell reads besides the views: where its published files are, the line that dates them, the
// home's lead and the header search. Run on this repository's own model.
import { describe, expect, it } from 'vitest';
import { repoModel } from '../model';
import { libraryHome } from './home';
import { bridgeDataUrl, llmsTxtUrl, publishedLine } from './published';
import { librarySearchIndex } from './search-index';

describe('bridge-data links', () => {
  it('reads a public repository from the raw host and a private one on GitHub', () => {
    expect(llmsTxtUrl('acme', 'ds', false)).toBe('https://raw.githubusercontent.com/acme/ds/bridge-data/llms.txt');
    expect(llmsTxtUrl('acme', 'ds', true)).toBe('https://github.com/acme/ds/blob/bridge-data/llms.txt');
    expect(bridgeDataUrl('a b', 'c', 'snapshot.json', false)).toBe('https://raw.githubusercontent.com/a%20b/c/bridge-data/snapshot.json');
  });
});

describe('published line', () => {
  it('dates a snapshot read as published', () => {
    expect(publishedLine({ published: '2026-10-20T08:00:00Z', sha: 'a1b2c3d4e5', branch: 'main' })).toBe('Published Oct 20, 2026 from a1b2c3d on main.');
    expect(publishedLine({ sha: 'a1b2c3d', branch: 'main' })).toBeNull();
    expect(publishedLine({ published: 'not a date', sha: 'a1b2c3d', branch: 'main' })).toBeNull();
  });
});

describe('home', () => {
  it('counts what the Library holds in one sentence', () => {
    const home = libraryHome(repoModel);
    expect(home.components).toBe(repoModel.components!.list.length);
    expect(home.tokens).toBe(repoModel.tokens.rows.all.length);
    expect(home.documented).toBe(repoModel.components!.list.filter((c) => c.docs).length);
    expect(home.lead).toMatch(/^\d+ components and \d+ tokens, in light and dark\.$/);
    expect(libraryHome({ ...repoModel, components: null, tokens: { ...repoModel.tokens, rows: { ...repoModel.tokens.rows, all: [], semantic: [] } } }).lead).toMatch(/^No tokens or components/);
  });
});

describe('header search', () => {
  it("indexes the team's places, components and tokens at the team's Library addresses", () => {
    const index = librarySearchIndex(repoModel, 'peterbono', 'bridge-demo-ds');
    const pages = index.filter((x) => x.kind === 'page');
    expect(pages.map((p) => p.title)).toEqual(['Home', 'Color', 'Typography', 'Spacing', 'Radius and borders', 'Elevation', 'Accessibility', 'All tokens', 'Components', 'Install', 'Agents', 'How review works', 'Changelog']);
    expect(pages[0]!.href).toBe('/library/peterbono/bridge-demo-ds/');
    expect(pages.find((p) => p.title === 'Accessibility')?.href).toBe('/library/peterbono/bridge-demo-ds/foundations/accessibility/');
    const components = index.filter((x) => x.kind === 'component');
    expect(components.length).toBe(repoModel.components!.list.length);
    expect(components.find((c) => c.title === 'Button')?.href).toBe('/library/peterbono/bridge-demo-ds/components/button/');
    const tokens = index.filter((x) => x.kind === 'token');
    expect(tokens.length).toBe(repoModel.tokens.rows.all.length + repoModel.tokens.rows.primitives.length);
    // Semantic first, primitives last.
    expect(tokens[0]!.meta).toMatch(/^Semantic, /);
    expect(tokens[tokens.length - 1]!.meta).toMatch(/^Primitive, /);
    const token = tokens.find((t) => t.title === 'color.text.default')!;
    expect(token.href).toBe('/library/peterbono/bridge-demo-ds/tokens/?t=color.text.default');
    expect(token.swatch).toBeTruthy();
    expect(token.keys).toContain('--color-text-default');
  });
});
