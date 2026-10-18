import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenSet, formatValue, layoutOptions, loadConfig } from '@bridge-ds/core';
import { applyDraft, previewOverrides, type Draft } from './editor-model';
import { allPages } from './nav';
import {
  bannerBody,
  bannerTitle,
  beforeText,
  changedComponents,
  changedGuidance,
  changedTokens,
  editInChangeHref,
  gitBlobSha,
  keepScopeHref,
  LATEST,
  openChanges,
  optionValue,
  overrideCss,
  parseOptionValue,
  planFiles,
  readError,
  scopeChange,
  scopeHref,
  scopeOf,
  staleKeys,
  VIEW_PAGES,
  viewCacheKey,
  viewOptions,
  viewsChange,
  fromLabel,
  isTogether,
  parseChangeList,
  scopeChanges,
  togetherOption,
  togetherTitle,
  viewTogetherHref,
  type ViewPull,
} from './view-scope';

const ROOT = join(__dirname, '../../../..');
const config = loadConfig(readFileSync(join(ROOT, 'bridge.config.json'), 'utf8'));
const TOKENS = join(ROOT, config.tokens.root);
const originals: Record<string, string> = {};
for (const dir of readdirSync(TOKENS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(TOKENS, dir.name))) if (f.endsWith('.tokens.json')) originals[`${dir.name}/${f}`] = readFileSync(join(TOKENS, dir.name, f), 'utf8');
}
const options = layoutOptions(config);
const main = buildTokenSet(originals, options);
const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');
const otherThan = (current: unknown, ...choices: string[]) => choices.find((c) => c !== current)!;

describe('the address model: latest, view, edit', () => {
  it('reads a view from ?change=N on the pages that can show a change', () => {
    for (const p of VIEW_PAGES) expect(scopeOf('?change=12', p)).toEqual({ kind: 'view', change: 12 });
    expect(scopeOf('?change=12', '/studio/quality')).toEqual({ kind: 'view', change: 12 });
    expect(scopeOf('', '/studio/tokens/')).toEqual(LATEST);
  });

  it('edits only on Studio Tokens with edit=1; elsewhere edit=1 still views', () => {
    expect(scopeOf('?change=12&edit=1', '/studio/tokens/')).toEqual({ kind: 'edit', change: 12 });
    expect(scopeOf('?edit=1&change=12', '/studio/components/')).toEqual({ kind: 'view', change: 12 });
    expect(scopeOf('?edit=1', '/studio/tokens/')).toEqual(LATEST);
  });

  it('reads the latest library on other pages and for a malformed number', () => {
    expect(scopeOf('?change=12', '/studio/changes/')).toEqual(LATEST);
    expect(scopeOf('?change=12', '/studio/')).toEqual(LATEST);
    for (const bad of ['?change=abc', '?change=0', '?change=-3', '?change=1.5', '?change=']) expect(scopeOf(bad, '/studio/tokens/')).toEqual(LATEST);
    expect(viewsChange('/studio/quality/audits/x/')).toBe(false);
  });

  it('says which change a scope reads', () => {
    expect(scopeChange(LATEST)).toBeNull();
    expect(scopeChange({ kind: 'edit', change: 4 })).toBe(4);
  });

  it('moves between scopes on the same page, keeping filters and the hash', () => {
    const loc = { pathname: '/studio/tokens/', search: '?q=bg&change=3&edit=1', hash: '#review' };
    expect(scopeHref(loc, { kind: 'view', change: 3 })).toBe('/studio/tokens/?q=bg&change=3#review');
    expect(scopeHref(loc, { kind: 'edit', change: 7 })).toBe('/studio/tokens/?q=bg&change=7&edit=1#review');
    expect(scopeHref(loc, LATEST)).toBe('/studio/tokens/?q=bg#review');
    expect(scopeHref({ pathname: '/studio/quality/', search: '?change=3' }, LATEST)).toBe('/studio/quality/');
  });

  it('keeps the view on links to pages that can show it, never the edit, and drops it elsewhere', () => {
    const base = 'https://bridge.test/studio/tokens/?change=5&edit=1';
    const view = { kind: 'view', change: 5 } as const;
    expect(keepScopeHref('/studio/components/', view, base)).toBe('/studio/components/?change=5');
    expect(keepScopeHref('/studio/tokens/?component=button&edit=1', view, base)).toBe('/studio/tokens/?component=button&change=5');
    expect(keepScopeHref('/studio/changes/?change=9', view, base)).toBe('/studio/changes/');
    expect(keepScopeHref('https://github.com/x', view, base)).toBe('https://github.com/x');
    expect(keepScopeHref('#top', view, base)).toBe('#top');
    expect(keepScopeHref('/studio/components/', LATEST, base)).toBe('/studio/components/');
  });

  it('opens editing with edit=1, which the token editor reads as its change', () => {
    expect(editInChangeHref(8)).toBe('/studio/tokens/?change=8&edit=1');
    const url = new URL(editInChangeHref(8), 'https://bridge.test');
    expect(scopeOf(url.search, url.pathname)).toEqual({ kind: 'edit', change: 8 });
  });

  it('matches the nav: exactly the pages marked branchAware can show a change', () => {
    const aware = allPages()
      .filter((p) => p.branchAware)
      .map((p) => p.href)
      .sort();
    expect(aware).toEqual([...VIEW_PAGES].sort());
  });
});

describe('the selector', () => {
  const pull = (n: number, extra: Partial<ViewPull> = {}): ViewPull => ({ number: n, title: `tokens: change ${n}`, state: 'open', updated_at: `2026-10-${10 + n}T00:00:00Z`, user: { login: 'ana' }, head: { ref: `tokens/c${n}`, sha: `s${n}` }, ...extra });

  it('lists open changes once, newest first, never the default branch, shipped or closed ones', () => {
    const list = openChanges([pull(1), pull(3), pull(2), pull(3), pull(4, { head: { ref: 'main', sha: 'm' } }), pull(5, { state: 'closed' }), pull(6, { merged_at: '2026-10-01' })], 'main');
    expect(list.map((p) => p.number)).toEqual([3, 2, 1]);
  });

  it('starts with the latest library, then each change with its status and author', () => {
    const opts = viewOptions([pull(1), pull(2, { draft: true })], { defaultBranch: 'main', lifecycleOf: (p) => (p.draft ? 'draft' : 'ready') });
    expect(opts[0]).toMatchObject({ value: 'latest', label: 'Latest library' });
    expect(opts.slice(1)).toEqual([
      { value: 'change-2', label: 'Change 2', description: 'Draft, by ana', group: 'Open changes' },
      { value: 'change-1', label: 'Change 1', description: 'Ready for review, by ana', group: 'Open changes' },
    ]);
  });

  it('keeps the change in the address listed when it is not open any more', () => {
    const shipped = pull(9, { state: 'closed', merged_at: '2026-10-02' });
    const opts = viewOptions([pull(1)], { defaultBranch: 'main', lifecycleOf: () => 'shipped', current: shipped });
    expect(opts.map((o) => o.value)).toEqual(['latest', 'change-9', 'change-1']);
    expect(opts[1]!.description).toBe('Shipped, by ana');
  });

  it('round-trips option values', () => {
    expect(optionValue(null)).toBe('latest');
    expect(parseOptionValue(optionValue(42))).toBe(42);
    expect(parseOptionValue('latest')).toBeNull();
    expect(parseOptionValue('change-x')).toBeNull();
  });
});

describe('reading a change cheaply', () => {
  it('computes git blob ids like git hash-object', async () => {
    expect(await gitBlobSha('', sha1)).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha('hello\n', sha1)).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    // Multi-byte text counts bytes, not characters.
    expect(await gitBlobSha('é\n', sha1)).toBe(createHash('sha1').update(Buffer.concat([Buffer.from('blob 3\0'), Buffer.from('é\n')])).digest('hex'));
  });

  it('reuses unchanged files, reads only changed or new ones, and notes removed ones', () => {
    const mainShas = { 'semantic/light.tokens.json': 'a', 'semantic/dark.tokens.json': 'b', 'components/old.tokens.json': 'c' };
    const head = [
      { path: 'packages/tokens/src/semantic/light.tokens.json', sha: 'a', type: 'blob' },
      { path: 'packages/tokens/src/semantic/dark.tokens.json', sha: 'B', type: 'blob' },
      { path: 'packages/tokens/src/components/new.tokens.json', sha: 'd', type: 'blob' },
      { path: 'packages/tokens/src/contrast.checks.json', sha: 'e', type: 'blob' },
      { path: 'packages/tokens/src/semantic', sha: 'f', type: 'tree' },
      { path: 'apps/docs-site/x.tokens.json', sha: 'g', type: 'blob' },
    ];
    expect(planFiles(mainShas, head, '/packages/tokens/src/')).toEqual({
      reuse: ['semantic/light.tokens.json'],
      fetch: ['components/new.tokens.json', 'semantic/dark.tokens.json'],
      removed: ['components/old.tokens.json'],
    });
  });

  it('keeps one cache entry per version, dropping the oldest', () => {
    expect(viewCacheKey('Peter/Repo', 'abc')).toBe('bridge.view.peter/repo@abc');
    const entries = [1, 5, 3, 9, 7].map((at) => ({ key: `k${at}`, at }));
    expect(staleKeys(entries, 3)).toEqual(['k3', 'k1']);
    expect(staleKeys(entries.slice(0, 2), 3)).toEqual([]);
  });
});

describe('changed tokens', () => {
  const before = main.byPath.get('color.bg.default')!.values.light;
  const after = otherThan(before, '{palette.neutral.50}', '{palette.neutral.0}');
  const draft: Draft = {
    edits: [
      { kind: 'value', id: 'a', path: 'color.bg.default', mode: 'light', before, after },
      { kind: 'add', id: 'b', path: 'color.bg.view-test', type: 'color', tier: 'semantic', values: { light: '{palette.neutral.50}', dark: '{palette.neutral.900}' } },
    ],
  };
  const { files } = applyDraft(main, originals, draft, options);
  // Remove one token by hand, the way a change deleting it would.
  const light = JSON.parse(files['semantic/light.tokens.json'] ?? originals['semantic/light.tokens.json']!) as { color: { text: Record<string, unknown> } };
  const removedName = Object.keys(light.color.text).find((k) => !k.startsWith('$'))!;
  delete light.color.text[removedName];
  const dark = JSON.parse(files['semantic/dark.tokens.json'] ?? originals['semantic/dark.tokens.json']!) as { color: { text: Record<string, unknown> } };
  delete dark.color.text[removedName];
  const change = buildTokenSet({ ...originals, ...files, 'semantic/light.tokens.json': JSON.stringify(light), 'semantic/dark.tokens.json': JSON.stringify(dark) }, options);
  const { marks, removed } = changedTokens(main, change);

  it('marks the tokens the change defines differently, with the latest library value of each moved mode', () => {
    expect(marks.get('color.bg.default')).toEqual({ kind: 'changed', modes: ['light'], before: { light: before }, type: 'color' });
  });

  it('marks new tokens as added and lists removed ones', () => {
    expect(marks.get('color.bg.view-test')?.kind).toBe('added');
    expect(removed).toEqual([`color.text.${removedName}`]);
  });

  it('marks nothing else: a token that only resolves differently through an alias is not "changed"', () => {
    expect([...marks.keys()].sort()).toEqual(['color.bg.default', 'color.bg.view-test']);
    expect(changedTokens(main, main).marks.size).toBe(0);
  });

  it('says the before value in the tooltip', () => {
    const text = beforeText(marks.get('color.bg.default')!, formatValue, (m) => m.charAt(0).toUpperCase() + m.slice(1));
    expect(text).toBe(`Before: Light ${formatValue('color', before).replace(/^palette\./, '')}`);
    expect(beforeText({ kind: 'changed', modes: ['value'], before: { value: { value: 16, unit: 'px' } }, type: 'dimension' }, formatValue)).toBe('Before: 16px');
    expect(beforeText(marks.get('color.bg.view-test')!, formatValue)).toBe('Not in the latest library.');
  });

  it('finds the components whose look the change moves, through any alias', () => {
    const vars = new Set(Object.keys(previewOverrides(main, change, { brand: 'bridge', theme: 'light', density: 'comfortable' })));
    expect(vars.has('--color-bg-default')).toBe(true);
    const index = { card: { name: 'Card', paths: ['color.bg.default'] }, kbd: { name: 'Kbd', paths: ['space.1'] } };
    expect(changedComponents(index, vars)).toEqual(['card']);
  });

  it('finds the guidance the change edits or removes', () => {
    const docs = { button: { path: 'p/Button.docs.json', sha: '1' }, card: { path: 'p/Card.docs.json', sha: '2' }, kbd: { path: 'p/Kbd.docs.json', sha: '3' } };
    expect(changedGuidance(docs, { 'p/Button.docs.json': '1', 'p/Card.docs.json': 'X' })).toEqual(['card', 'kbd']);
  });

  it('writes the preview stylesheet per theme, skipping a theme without differences', () => {
    const css = overrideCss({ light: { '--b': 'red', '--a': '#fff' }, dark: {} }, (t) => `.f[data-theme="${t}"]`);
    expect(css).toBe('.f[data-theme="light"] {\n  --a: #fff;\n  --b: red;\n}');
    expect(overrideCss({ light: { '--a': 'x;}</style>' } }, () => '.f')).not.toMatch(/[;}<]style/);
  });
});

describe('words', () => {
  it('says the mode in one sentence', () => {
    expect(bannerTitle('Darker canvas')).toBe('Viewing the library as Darker canvas. Nothing is saved.');
  });

  it('says what each page shows of the change', () => {
    expect(bannerBody('tokens', { changed: 3, added: 1 })).toBe('3 tokens changed and 1 token added, listed first in the table.');
    expect(bannerBody('tokens', {})).toBe('It changes no token values.');
    expect(bannerBody('components', { components: 2 })).toBe('Previews use its tokens: 2 components look different, marked in the list.');
    expect(bannerBody('components', { components: 1, guidance: ['Button', 'Card'] })).toBe("Previews use its tokens: 1 component looks different and 2 have edited guidance, marked in the list. Guidance text here is the latest library's.");
    expect(bannerBody('components', {})).toBe('Previews use its tokens. It changes how no component looks.');
    expect(bannerBody('quality', {})).toBe('');
  });

  it('says how to fix a failed read', () => {
    expect(readError('rate', 'Darker canvas', 'Sign in with GitHub', '14:05')).toBe("GitHub's hourly limit for visitors is used up, so Darker canvas could not be read. Sign in with GitHub to keep going, or try again after 14:05.");
    expect(readError('missing', 'Change #4', 'Sign in')).toContain('go back to the latest library');
  });

  it('never uses developer words or em dashes on screen', () => {
    const shown = [bannerTitle('X'), bannerBody('tokens', { changed: 1, removed: 2 }), bannerBody('components', { components: 1, guidance: ['A'] }), readError('rate', 'X', 'Sign in', null), readError('other', 'X', 'Sign in')].join(' ');
    expect(shown).not.toMatch(/\b(branch|pull request|PR|commit|merge|SHA|CI|workflow)\b|—/i);
  });
});

describe('several changes together in the address', () => {
  it('reads a list of 2 to 4 changes, with the picks, as a read-only view', () => {
    const s = scopeOf('?change=101,118,120&use=118%3Asemantic%2Flight.tokens.json%23path%3Acolor.bg.default', '/studio/tokens/');
    expect(s).toEqual({ kind: 'view', change: 101, changes: [101, 118, 120], use: '118:semantic/light.tokens.json#path:color.bg.default' });
    expect(scopeChanges(s)).toEqual([101, 118, 120]);
    expect(isTogether(s)).toBe(true);
    // edit=1 never applies to several changes.
    expect(scopeOf('?change=101,118&edit=1', '/studio/tokens/').kind).toBe('view');
    // An encoded comma reads the same.
    expect(scopeChanges(scopeOf('?change=101%2C118', '/studio/components/'))).toEqual([101, 118]);
  });

  it('parses lists strictly: no repeats, at most 4, nothing half-read', () => {
    expect(parseChangeList('101,101,118')).toEqual([101, 118]);
    expect(parseChangeList('1,2,3,4,5')).toEqual([1, 2, 3, 4]);
    expect(parseChangeList('101,abc')).toEqual([]);
    expect(parseChangeList('101,0')).toEqual([]);
    expect(parseChangeList('')).toEqual([]);
    expect(scopeOf('?change=101,abc', '/studio/tokens/')).toEqual(LATEST);
    // One change in a list is the plain view of #116.
    expect(scopeOf('?change=118,118', '/studio/tokens/')).toEqual({ kind: 'view', change: 118 });
  });

  it('keeps the list and the picks on links between view pages, and drops them elsewhere', () => {
    const s = scopeOf('?change=101,118&use=118%3Aa%23b', '/studio/tokens/');
    expect(keepScopeHref('/studio/components/', s, 'https://bridge.test/studio/tokens/')).toBe('/studio/components/?change=101,118&use=118%3Aa%23b');
    expect(keepScopeHref('/studio/changes/', s, 'https://bridge.test/studio/tokens/')).toBe('/studio/changes/');
    expect(scopeHref({ pathname: '/studio/quality/', search: '?change=101,118&use=x&q=bg' }, LATEST)).toBe('/studio/quality/?q=bg');
    expect(scopeHref({ pathname: '/studio/tokens/', search: '?change=101,118&use=x' }, { kind: 'view', change: 118 })).toBe('/studio/tokens/?change=118');
  });

  it('builds the address of a combination and names it', () => {
    expect(viewTogetherHref([101, 118], '118:a#b')).toBe('/studio/tokens/?change=101,118&use=118%3Aa%23b');
    expect(viewTogetherHref([101, 118], '')).toBe('/studio/tokens/?change=101,118');
    expect(togetherTitle(['Darker canvas', 'Rounder buttons', 'Deeper links'])).toBe('Viewing the library with Darker canvas, Rounder buttons and 1 other. Nothing is saved.');
    expect(togetherOption([101, 118], ['Darker canvas', 'Rounder buttons'])).toEqual({ value: 'together-101-118', label: '2 changes together', description: 'Darker canvas and Rounder buttons', group: 'Open changes' });
    expect(fromLabel('changed', [118])).toBe('Changed in #118');
    expect(fromLabel('added', [101, 118])).toBe('New in #101 and #118');
    expect(bannerBody('tokens', { changed: 3, together: true })).toBe('3 tokens changed, listed first in the table, each marked with its change.');
    expect(bannerBody('components', { components: 0, together: true })).toBe('Previews use their tokens. They change how no component looks.');
  });
});
