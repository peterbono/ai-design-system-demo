import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenSet, layoutOptions, loadConfig } from '@bridge-ds/core';
import { applyDraft, type Draft } from './editor-model';
import {
  addableChanges,
  addedNotice,
  addedComment,
  addedSentence,
  canAddTo,
  changeDraftKey,
  changeParam,
  mergeChangeset,
  dropEdits,
  unresolved,
  changeTitle,
  conflictHref,
  conflictSentence,
  defaultTarget,
  dismissedApprovals,
  dismissedSentence,
  draftDestination,
  isTokenChange,
  mergeCheck,
  parseChangeDraft,
  parseTargetValue,
  scopeBanner,
  targetOptions,
  targetValue,
  type ChangePullLike,
} from './continue-change';

const REPO = 'peterbono/ai-design-system-demo';

const pull = (over: Partial<ChangePullLike> & { number: number }): ChangePullLike => ({
  title: 'tokens: Darker default background',
  state: 'open',
  draft: false,
  merged_at: null,
  updated_at: '2026-10-17T10:00:00Z',
  user: { login: 'ana' },
  labels: [{ name: 'tokens' }, { name: 'source: bridge-web' }],
  head: { ref: `tokens/darker-bg-${over.number}`, sha: `sha${over.number}`, repo: { full_name: REPO } },
  ...over,
});

describe('which changes take more token edits', () => {
  it('takes open token changes from the editor or the Figma plugin', () => {
    expect(isTokenChange(pull({ number: 1 }), REPO)).toBe(true);
    expect(isTokenChange(pull({ number: 2, labels: [{ name: 'tokens' }], draft: true }), REPO)).toBe(true);
  });

  it('leaves explorations, brands, docs, closed, shipped and forked changes to their own flows', () => {
    expect(isTokenChange(pull({ number: 1, head: { ref: 'explore/teal', sha: 'a', repo: { full_name: REPO } }, labels: [{ name: 'tokens' }, { name: 'exploration' }] }), REPO)).toBe(false);
    expect(isTokenChange(pull({ number: 2, head: { ref: 'bridge/brand-forest', sha: 'a', repo: { full_name: REPO } }, labels: [{ name: 'tokens' }, { name: 'new brand' }] }), REPO)).toBe(false);
    expect(isTokenChange(pull({ number: 3, labels: [{ name: 'tokens' }, { name: 'new brand' }] }), REPO)).toBe(false);
    expect(isTokenChange(pull({ number: 4, head: { ref: 'docs/button', sha: 'a', repo: { full_name: REPO } }, labels: [{ name: 'docs' }] }), REPO)).toBe(false);
    expect(isTokenChange(pull({ number: 5, labels: [] }), REPO)).toBe(false);
    expect(isTokenChange(pull({ number: 6, state: 'closed' }), REPO)).toBe(false);
    expect(isTokenChange(pull({ number: 7, merged_at: '2026-10-01T00:00:00Z' }), REPO)).toBe(false);
    expect(isTokenChange(pull({ number: 8, head: { ref: 'tokens/x', sha: 'a', repo: { full_name: 'someone/fork' } } }), REPO)).toBe(false);
  });

  it('lets only the author or someone with write access add', () => {
    const p = pull({ number: 1 });
    expect(canAddTo(p, 'ana', false)).toBe(true);
    expect(canAddTo(p, 'ANA', false)).toBe(true);
    expect(canAddTo(p, 'ben', false)).toBe(false);
    expect(canAddTo(p, 'ben', true)).toBe(true);
    expect(canAddTo(p, null, true)).toBe(false);
  });

  it('lists the viewer’s own changes first, then the most recent', () => {
    const list = addableChanges(
      [
        pull({ number: 1, user: { login: 'ben' }, updated_at: '2026-10-18T09:00:00Z' }),
        pull({ number: 2, updated_at: '2026-10-10T09:00:00Z' }),
        pull({ number: 3, updated_at: '2026-10-12T09:00:00Z' }),
        pull({ number: 4, labels: [{ name: 'exploration' }, { name: 'tokens' }] }),
      ],
      { repo: REPO, viewer: 'ana', write: true },
    );
    expect(list.map((t) => t.number)).toEqual([3, 2, 1]);
    expect(list[0]).toMatchObject({ mine: true, title: 'Darker default background', branch: 'tokens/darker-bg-3' });
    expect(addableChanges([pull({ number: 1, user: { login: 'ben' } })], { repo: REPO, viewer: 'ana', write: false })).toEqual([]);
  });

  it('names a change in designer words', () => {
    expect(changeTitle('tokens: darker default background')).toBe('Darker default background');
    expect(changeTitle('feat(tokens): Forest brand')).toBe('Forest brand');
    expect(changeTitle('Plain title')).toBe('Plain title');
    expect(changeTitle('DS-42 tokens: darker default background')).toBe('Darker default background');
  });
});

describe('where the edits go', () => {
  const targets = addableChanges([pull({ number: 5, user: { login: 'ben' } }), pull({ number: 9 })], { repo: REPO, viewer: 'ana', write: true });

  it('defaults to the viewer’s own change, the scoped change wins, someone else’s never is the default', () => {
    expect(defaultTarget(targets)).toEqual({ kind: 'change', number: 9 });
    expect(defaultTarget(targets, 5)).toEqual({ kind: 'change', number: 5 });
    expect(defaultTarget(targets, 77)).toEqual({ kind: 'change', number: 9 });
    expect(defaultTarget(targets.filter((t) => !t.mine))).toEqual({ kind: 'new' });
    expect(defaultTarget([])).toEqual({ kind: 'new' });
  });

  it('offers at most three changes plus a new one, with radio values that round-trip', () => {
    const many = addableChanges([1, 2, 3, 4, 5].map((n) => pull({ number: n })), { repo: REPO, viewer: 'ana', write: false });
    const opts = targetOptions(many, () => '2 hours ago');
    expect(opts).toHaveLength(4);
    expect(opts[0]).toMatchObject({ label: 'Add to Darker default background' });
    expect(opts[0]!.description).toBe('Your branch, updated 2 hours ago.');
    expect(opts[3]).toMatchObject({ value: 'new', label: 'Create a new branch' });
    expect(targetOptions(targets.filter((t) => !t.mine), () => 'today')[0]!.description).toMatch(/^Opened by ben/);
    for (const c of [{ kind: 'new' } as const, { kind: 'change', number: 12 } as const]) expect(parseTargetValue(targetValue(c))).toEqual(c);
    expect(parseTargetValue('nope')).toBeNull();
  });

  it('tells the Changes draft strip where the draft goes', () => {
    expect(draftDestination(targets[0]!)).toBe('They go to Darker default background.');
    expect(draftDestination(targets[0]!, 1)).toBe('It goes to Darker default background.');
    expect(draftDestination(null)).toBe('Requesting review creates a new branch.');
  });
});

// The real token files of this repo, as the change's base.
const ROOT = join(__dirname, '../../../..');
const config = loadConfig(readFileSync(join(ROOT, 'bridge.config.json'), 'utf8'));
const TOKENS = join(ROOT, config.tokens.root);
const originals: Record<string, string> = {};
for (const dir of readdirSync(TOKENS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(TOKENS, dir.name))) if (f.endsWith('.tokens.json')) originals[`${dir.name}/${f}`] = readFileSync(join(TOKENS, dir.name, f), 'utf8');
}
const options = layoutOptions(config);
const base = buildTokenSet(originals, options);
const otherThan = (current: unknown, ...choices: string[]) => choices.find((c) => c !== current)!;
const edit = (path: string, mode: string, ...choices: string[]): Draft['edits'][number] => {
  const before = base.byPath.get(path)!.values[mode];
  return { kind: 'value', id: path, path, mode, before, after: otherThan(before, ...choices) };
};

describe('3-way check against the change as it is now', () => {
  const ours = edit('color.bg.default', 'light', '{palette.neutral.50}', '{palette.neutral.0}');
  const mine = applyDraft(base, originals, { edits: [ours] }, options);

  it('finds nothing when the change has not moved', () => {
    expect(mergeCheck(base, mine.proposed, base)).toEqual({ conflicts: [], upstream: [] });
  });

  it('keeps tokens only the change moved, and lets the draft go on top', () => {
    const theirs = applyDraft(base, originals, { edits: [edit('color.text.muted', 'light', '{palette.neutral.700}', '{palette.neutral.600}')] }, options);
    const r = mergeCheck(base, mine.proposed, theirs.proposed);
    expect(r.conflicts).toEqual([]);
    expect(r.upstream).toEqual(['color.text.muted']);
    // On top of the change: both edits survive.
    const onTop = applyDraft(theirs.proposed, { ...originals, ...theirs.files }, { edits: [ours] }, options);
    expect(onTop.proposed.byPath.get('color.bg.default')!.values.light).toBe(ours.kind === 'value' ? ours.after : undefined);
    expect(onTop.proposed.byPath.get('color.text.muted')!.values.light).toBe(theirs.proposed.byPath.get('color.text.muted')!.values.light);
  });

  it('stops when the same token was edited in both, differently', () => {
    const theirsEdit = edit('color.bg.default', 'light', '{palette.neutral.100}', '{palette.neutral.200}');
    const theirs = applyDraft(base, originals, { edits: [theirsEdit] }, options);
    expect(mergeCheck(base, mine.proposed, theirs.proposed).conflicts).toEqual(['color.bg.default']);
  });

  it('stops even when the other side edited another mode of the same token', () => {
    const theirs = applyDraft(base, originals, { edits: [edit('color.bg.default', 'dark', '{palette.neutral.900}', '{palette.neutral.800}')] }, options);
    expect(mergeCheck(base, mine.proposed, theirs.proposed).conflicts).toEqual(['color.bg.default']);
  });

  it('is no conflict when both made the same edit', () => {
    expect(mergeCheck(base, mine.proposed, mine.proposed).conflicts).toEqual([]);
  });

  it('keeps the changeset listing everything the change does, with the larger bump', () => {
    const opts = { title: 'Darker default background', branch: 'tokens/darker-bg', packageName: '@bridge-ds/tokens' };
    const first = mine.changes;
    const existing = mergeChangeset(null, first, opts);
    expect(existing).toMatch(/^---\n"@bridge-ds\/tokens": (minor|patch)\n---/);
    expect(existing).toContain('`color.bg.default`');
    const more = applyDraft(base, originals, { edits: [edit('color.text.muted', 'light', '{palette.neutral.700}', '{palette.neutral.600}')] }, options).changes;
    const merged = mergeChangeset(existing, [...first, ...more], opts);
    expect(merged.match(/`color\.bg\.default`/g)).toHaveLength(1);
    expect(merged).toContain('- changed `color.text.muted`');
    expect(merged.startsWith('---\n"@bridge-ds/tokens": ')).toBe(true);
    expect(mergeChangeset('---\n"@bridge-ds/tokens": patch\n---\n\nWording.\n', more, opts)).toMatch(/: minor\n/);
    expect(mergeChangeset('no front matter', more, opts)).toBe('no front matter');
  });

  it('says what stopped and how to fix it, linking to the conflict flow', () => {
    expect(conflictSentence(['color.bg.default'])).toBe('Someone also edited color.bg.default in this branch after you opened it. Nothing was saved, so no edit is lost. Keep your value, or keep theirs and drop your edit.');
    expect(conflictSentence(['color.bg.default'], false)).toBe('This branch already edits color.bg.default, to another value than yours. Nothing was saved, so no edit is lost. Keep your value, or keep theirs and drop your edit.');
    expect(conflictSentence(['a', 'b'])).toContain('a and b');
    expect(conflictSentence(['a', 'b', 'c'])).toContain('a and 2 other tokens');
    expect(unresolved(['a', 'b'], ['a'])).toEqual(['b']);
    const d = { baseSha: 'x', edits: [edit('color.bg.default', 'light', '{palette.neutral.50}'), edit('color.text.muted', 'light', '{palette.neutral.700}')] };
    expect(dropEdits(d, ['color.bg.default']).edits.map((e) => e.path)).toEqual(['color.text.muted']);
    expect(dropEdits(d, ['color.bg.default']).baseSha).toBe('x');
    expect(conflictHref(12)).toBe('/studio/changes/?pr=12');
  });
});

describe('approvals after new edits', () => {
  const r = (login: string, state: string, at: string, commit = 'old') => ({ user: { login }, state, submitted_at: at, commit_id: commit });

  it('shows approvals GitHub dismissed that nobody gave again', () => {
    const reviews = [r('ana', 'APPROVED', '1'), r('ana', 'DISMISSED', '2'), r('ben', 'DISMISSED', '1'), r('ben', 'APPROVED', '3', 'head'), r('cy', 'COMMENTED', '4')];
    expect(dismissedApprovals(reviews, 'head')).toEqual([{ login: 'ana', afterEdits: true }]);
    expect(dismissedApprovals([r('ana', 'DISMISSED', '1', 'head')], 'head')).toEqual([{ login: 'ana', afterEdits: false }]);
    expect(dismissedApprovals([r('ana', 'APPROVED', '1')], 'head')).toEqual([]);
  });

  it('says it in one sentence', () => {
    expect(dismissedSentence([])).toBeNull();
    expect(dismissedSentence([{ login: 'ana', afterEdits: true }])).toBe('The approval from ana was reset when new edits were added.');
    expect(dismissedSentence([{ login: 'ana', afterEdits: false }, { login: 'ben', afterEdits: true }])).toBe('The approvals from ana and ben were reset.');
  });
});

describe('words and storage', () => {
  it('scopes the editor with ?change=N and keeps each change’s draft apart', () => {
    expect(changeParam('?change=12')).toBe(12);
    expect(changeParam('?change=abc')).toBeNull();
    expect(changeParam('')).toBeNull();
    expect(changeDraftKey('Peter/Repo', 3)).toBe('bridge.draft.change.peter/repo#3.v1');
    expect(parseChangeDraft(null)).toEqual({ edits: [], baseSha: null });
    expect(parseChangeDraft('{"edits":[{"kind":"delete","id":"x","path":"a"}],"baseSha":"abc"}')).toEqual({ edits: [{ kind: 'delete', id: 'x', path: 'a' }], baseSha: 'abc' });
    expect(parseChangeDraft('not json')).toEqual({ edits: [], baseSha: null });
  });

  it('writes the banner, the status and the comment', () => {
    expect(scopeBanner('Darker default background').title).toBe('Editing: Darker default background');
    expect(addedSentence(1, 'X', 0)).toBe('Added 1 edit to X.');
    expect(addedNotice(1)).toBe('Added 1 edit to this branch. Reviewers see it now.');
    expect(addedNotice(3)).toBe('Added 3 edits to this branch. Reviewers see them now.');
    expect(addedSentence(2, 'X', 1)).toBe('Added 2 edits to X. It had moved since you opened it: 1 other token stays as the branch has it.');
    expect(addedComment(['a.b'], 'ana')).toBe('@ana added token edits from the Bridge token editor:\n\n- `a.b`');
  });
});
