import { describe, expect, it } from 'vitest';
import { DETAIL_MAX, announcement, groupReleases, packagesLabel, parseChangelog, parseChangeset, sentences, sortEntries, splitNote } from './changelog-model';

const REACT = `# @bridge-ds/react

## 1.1.0

### Minor Changes

- dfa95ed: Textarea gets \`appearance="inline"\` for editing text in place. No border, no resize handle.
  Never use it in forms.

## 1.0.0

### Major Changes

- a55525d: Bridge brand moves to the Field Guide direction. Check your screens.

### Patch Changes

- 73b1a6f: Add usage guidance files.

  For you: Nothing changes in your designs.

- Updated dependencies [a55525d]
  - @bridge-ds/tokens@1.0.0
`;

const CORE = `# @bridge-ds/core

## 0.3.0

### Minor Changes

- 80228c0: Claude titles each component request.

## 0.2.0

### Patch Changes

- a55525d: Bridge brand moves to the Field Guide direction. Check your screens.
`;

const VISUAL = `# @bridge-ds/visual

## 0.2.1

### Patch Changes

- Updated dependencies [80228c0]
  - @bridge-ds/core@0.3.0
`;

describe('sentences and splitNote', () => {
  it('splits on sentence ends, never inside code', () => {
    expect(sentences('Use `a. B` here. Then this. And that')).toEqual(['Use `a. B` here.', 'Then this.', 'And that']);
  });
  it('takes the first sentence as title and the second as description', () => {
    expect(splitNote('Studio Overview redesign. One line with one action. More text.')).toEqual({ title: 'Studio Overview redesign', detail: 'One line with one action.', forYou: undefined });
  });
  it('drops a second sentence too long for a list', () => {
    expect(splitNote(`Short title. ${'x'.repeat(DETAIL_MAX + 1)}`).detail).toBe('');
  });
  it('reads the author For you line apart from the text', () => {
    const n = splitNote('Add usage guidance files.\n\nFor you: Nothing changes in your designs.');
    expect(n.title).toBe('Add usage guidance files');
    expect(n.forYou).toBe('Nothing changes in your designs.');
  });
});

describe('parseChangelog', () => {
  it('reads versions, bump sections and notes, skipping dependency lines', () => {
    const s = parseChangelog(REACT, '@bridge-ds/react', true);
    expect(s.map((x) => x.version)).toEqual(['1.1.0', '1.0.0']);
    expect(s[0]!.notes).toEqual([{ id: 'dfa95ed', bump: 'minor', text: 'Textarea gets `appearance="inline"` for editing text in place. No border, no resize handle.\nNever use it in forms.' }]);
    expect(s[1]!.notes.map((n) => [n.id, n.bump])).toEqual([
      ['a55525d', 'major'],
      ['73b1a6f', 'patch'],
    ]);
  });
  it('keeps a version with only dependency updates, with no notes', () => {
    expect(parseChangelog(VISUAL, '@bridge-ds/visual', true)).toEqual([{ pkg: '@bridge-ds/visual', version: '0.2.1', published: true, notes: [] }]);
  });
});

describe('parseChangeset', () => {
  it('reads the packages, the highest bump and the title', () => {
    const e = parseChangeset('---\n"@bridge-ds/docs-site": patch\n"@bridge-ds/core": minor\n---\n\nStudio says Sign in. More.\n', '.changeset/a.md')!;
    expect(e).toMatchObject({ source: 'changeset', kind: 'New', bump: 'minor', packages: ['@bridge-ds/docs-site', '@bridge-ds/core'], title: 'Studio says Sign in', detail: 'More.', ref: '.changeset/a.md', forYouAuthored: false });
  });
  it('marks a changeset that releases nothing as Internal', () => {
    const e = parseChangeset('---\n---\n\nTests only: no package changes.\n', '.changeset/t.md')!;
    expect(e.kind).toBe('Internal');
    expect(e.packages).toEqual([]);
    expect(e.bump).toBeNull();
  });
  it('returns null for a file without front matter', () => {
    expect(parseChangeset('# Changesets\n', 'README.md')).toBeNull();
  });
});

describe('groupReleases', () => {
  const sections = [...parseChangelog(REACT, '@bridge-ds/react', true), ...parseChangelog(CORE, '@bridge-ds/core', true), ...parseChangelog(VISUAL, '@bridge-ds/visual', true)];
  const tags: Record<string, string> = {
    '@bridge-ds/react@1.1.0': '2026-10-18',
    '@bridge-ds/core@0.3.0': '2026-10-18',
    '@bridge-ds/visual@0.2.1': '2026-10-18',
    '@bridge-ds/react@1.0.0': '2026-10-17',
    '@bridge-ds/core@0.2.0': '2026-10-17',
  };

  it('groups the versions released on one date, newest first, named after the Library version', () => {
    const r = groupReleases(sections, (p, v) => tags[`${p}@${v}`]);
    expect(r.map((x) => [x.name, x.date])).toEqual([
      ['v1.1.0', '2026-10-18'],
      ['v1.0.0', '2026-10-17'],
    ]);
    expect(r[0]!.packages.map((p) => `${p.name}@${p.version}`)).toEqual(['@bridge-ds/react@1.1.0', '@bridge-ds/core@0.3.0', '@bridge-ds/visual@0.2.1']);
  });

  it('shows a change once per release with every package it touched, breaking first', () => {
    const r = groupReleases(sections, (p, v) => tags[`${p}@${v}`]);
    const brand = r[1]!.entries[0]!;
    expect(brand).toMatchObject({ kind: 'Breaking', bump: 'major', packages: ['@bridge-ds/react', '@bridge-ds/core'], date: '2026-10-17' });
    expect(r[1]!.entries.map((e) => e.kind)).toEqual(['Breaking', 'Fix']);
  });

  it('without dates, groups by shared changesets and never invents a date', () => {
    const r = groupReleases(sections, () => undefined);
    const old = r.find((x) => x.name === 'v1.0.0')!;
    expect(old.date).toBeUndefined();
    expect(old.packages.map((p) => p.name)).toEqual(['@bridge-ds/react', '@bridge-ds/core']);
    // visual 0.2.1 only bumped a dependency: with no date to place it, it is not shown as a release
    expect(r.some((x) => x.packages.some((p) => p.name === '@bridge-ds/visual'))).toBe(false);
  });
});

describe('sortEntries, packagesLabel, announcement', () => {
  it('orders Breaking, New, Fix, Internal and keeps the order inside a kind', () => {
    expect(sortEntries([{ kind: 'Fix', n: 1 }, { kind: 'Internal', n: 2 }, { kind: 'New', n: 3 }, { kind: 'Fix', n: 4 }]).map((e) => e.n)).toEqual([3, 1, 4, 2]);
  });
  it('shows up to three package tags, a count beyond', () => {
    expect(packagesLabel(['@bridge-ds/react', '@bridge-ds/core'])).toEqual({ tags: ['react', 'core'], count: null });
    expect(packagesLabel(['a', 'b', 'c', 'd', 'e']).count).toBe('5 packages');
  });
  it('writes a ready-to-post message without code marks', () => {
    const text = announcement({ name: 'v1.1.0', pending: false, packages: [], entries: [{ source: 'release', title: 'Textarea gets `appearance`', detail: '', kind: 'New', bump: 'minor', packages: ['@bridge-ds/react'], forYou: '' }] });
    expect(text).toContain('Design system v1.1.0 is out:');
    expect(text).toContain('- New: Textarea gets appearance');
  });
});
