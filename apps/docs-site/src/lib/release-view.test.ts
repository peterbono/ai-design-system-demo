import { describe, expect, it } from 'vitest';
import { jargonIn } from './vocabulary';
import { historySummary, isDsChange, packageLine, parseReleaseBody, releaseCard, splitActivity, waitingLine } from './release-view';

// Shape of the body the changesets action writes on the release pull request (trimmed from #58).
const BODY = `This PR was opened by the [Changesets release](https://github.com/changesets/action) GitHub action.


# Releases
## @bridge-ds/cli@0.3.0

### Minor Changes

- 3d3d77d: Library protection: Bridge is the only way into the default branch.

  Core: new \`protection.ts\`.

### Patch Changes

- 196d02b: Real branch preview URLs and install commands everywhere.
- Updated dependencies [80228c0]
- Updated dependencies [3d3d77d]
  - @bridge-ds/mcp@0.3.0
## @bridge-ds/core@0.3.0

### Minor Changes

- 80228c0: Claude titles each component request.
- 3d3d77d: Library protection: Bridge is the only way into the default branch.
## @bridge-ds/react@1.1.0

### Minor Changes

- 9574d19: Textarea gets an inline appearance.
## @bridge-ds/tokens@1.0.1

### Patch Changes

- Updated dependencies [9574d19]
`;

describe('release body', () => {
  const plan = parseReleaseBody(BODY);

  it('counts each changeset once, never the dependency lines', () => {
    expect(plan.changes).toBe(4);
  });

  it('reads each package, its new version and its highest bump', () => {
    expect(plan.packages).toEqual([
      { name: '@bridge-ds/cli', version: '0.3.0', bump: 'minor' },
      { name: '@bridge-ds/core', version: '0.3.0', bump: 'minor' },
      { name: '@bridge-ds/react', version: '1.1.0', bump: 'minor' },
      { name: '@bridge-ds/tokens', version: '1.0.1', bump: 'patch' },
    ]);
  });

  it('reads an empty body as nothing', () => {
    expect(parseReleaseBody(null)).toEqual({ changes: 0, packages: [] });
  });

  it('takes a major heading over a minor one', () => {
    expect(parseReleaseBody('## @bridge-ds/react@2.0.0\n### Minor Changes\n- abcdef1: a\n### Major Changes\n- abcdef2: b').packages[0]!.bump).toBe('major');
  });
});

describe('release card', () => {
  const card = releaseCard(parseReleaseBody(BODY));

  it('says how many changes and that they are ready to publish', () => {
    expect(card.title).toBe('Next release: 4 merged branches, ready to publish.');
  });

  it('puts the design system packages first, in plain words', () => {
    expect(card.lines).toEqual(['Components 1.1.0, new options', 'Tokens 1.0.1, fixes']);
    expect(card.tools).toBe('And 2 Bridge tool updates: Command line tool, Bridge core.');
    expect(card.breaking).toBe(false);
  });

  it('flags a breaking release', () => {
    expect(packageLine({ name: '@bridge-ds/tokens', version: '2.0.0', bump: 'major' })).toBe('Tokens 2.0.0, action needed');
    expect(releaseCard({ changes: 1, packages: [{ name: '@bridge-ds/tokens', version: '2.0.0', bump: 'major' }] }).breaking).toBe(true);
  });

  it('has no developer words in what a designer reads', () => {
    const text = [card.title, ...card.lines, card.tools].join(' ');
    expect(jargonIn(text)).toEqual([]);
    expect(text).not.toMatch(/npm|@bridge-ds/i);
  });

  it('says what is live when no release waits', () => {
    expect(waitingLine('v1.0.0', 14)).toBe('v1.0.0 is live. 14 merged branches wait for the next release.');
    expect(waitingLine('v1.0.0', 1)).toBe('v1.0.0 is live. 1 merged branch waits for the next release.');
    expect(waitingLine('v1.0.0', 0)).toBe('v1.0.0 is live. Nothing waits for the next release.');
  });
});

describe('activity split', () => {
  it('keeps component and token changes in the design system activity', () => {
    expect(isDsChange(['@bridge-ds/react', '@bridge-ds/docs-site'])).toBe(true);
    expect(isDsChange(['@bridge-ds/core', '@bridge-ds/mcp'])).toBe(false);
    expect(isDsChange([])).toBe(false);
    const s = splitActivity([{ id: 'a', packages: ['@bridge-ds/tokens'] }, { id: 'b', packages: ['@bridge-ds/figma-plugin'] }, { id: 'c', packages: [] }]);
    expect(s.ds.map((e) => e.id)).toEqual(['a']);
    expect(s.app.map((e) => e.id)).toEqual(['b', 'c']);
  });
});

describe('history summary', () => {
  const base = { title: 'ci: skip Changeset present on the Version packages PR (#56)', counts: { total: 3 } };

  it('prefers the changeset summary the author wrote for people', () => {
    expect(historySummary({ ...base, changesets: [{ summary: 'Muted text gets one step darker.\n\nMore details here.' }] })).toBe('Muted text gets one step darker');
  });

  it('falls back to the pull request title, then the commit subject, without prefix or number', () => {
    expect(historySummary({ ...base, pr: { title: 'feat(tokens): add focus.ring.offset semantic token' } })).toBe('Add focus.ring.offset semantic token');
    expect(historySummary(base)).toBe('Skip Changeset present on the Version packages PR');
  });

  it('keeps the whole summary for the detail heading when asked', () => {
    const long = { ...base, pr: { title: `feat: ${'word '.repeat(30).trim()}` } };
    expect(historySummary(long).endsWith('...')).toBe(true);
    expect(historySummary(long, { full: true })).toBe(`Word ${'word '.repeat(29).trim()}`);
  });

  it('reads an import as one line', () => {
    expect(historySummary({ ...base, bulk: true, counts: { total: 895 } })).toBe('Large token update, 895 token edits');
  });

  it('cuts long summaries on a word', () => {
    const long = historySummary({ ...base, changesets: [{ summary: `${'word '.repeat(40)}end.` }] });
    expect(long.length).toBeLessThanOrEqual(90);
    expect(long.endsWith('...')).toBe(true);
  });
});
