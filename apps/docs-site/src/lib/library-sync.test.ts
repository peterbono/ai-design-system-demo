import { describe, expect, it } from 'vitest';
import { applyTokenMerge, buildTokenSet, parseContrastChecks, planTokenMerge } from '@bridge-ds/core';
import {
  behindTag,
  conflictLine,
  conflictRoute,
  conflictRows,
  dismissStaleFrom,
  fileContext,
  freshness,
  guardrail,
  libraryLine,
  nextSteps,
  overlap,
  resolution,
  resolutionMessage,
  resolveLabel,
} from './library-sync';
import { reviewTokenChange } from './token-review';

const color = (hex: string) => ({ colorSpace: 'srgb', components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), hex });
const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

const primitives = json({ color: { $type: 'color', white: { $value: color('#ffffff') }, ink: { 600: { $value: color('#5b6672') }, 300: { $value: color('#c0c4ca') }, 900: { $value: color('#15202b') } }, blue: { 700: { $value: color('#0b4a8b') } } } });
const light = (muted: string | null, link = '{color.blue.700}') =>
  json({
    color: {
      $type: 'color',
      bg: { default: { $value: '{color.white}' } },
      text: { default: { $value: '{color.ink.900}' }, ...(muted ? { muted: { $value: muted } } : {}), link: { $value: link } },
    },
  });
const dark = json({ color: { $type: 'color', bg: { default: { $value: '{color.ink.900}' } }, text: { default: { $value: '{color.white}' }, muted: { $value: '{color.ink.300}' }, link: { $value: '{color.white}' } } } });
const LIGHT = 'semantic/light.tokens.json';
const files = (l: string) => ({ 'primitives/color.tokens.json': primitives, [LIGHT]: l, 'semantic/dark.tokens.json': dark });
const checks = parseContrastChecks(json({ pairs: [['color.text.muted', 'color.bg.default', 4.5], ['color.text.link', 'color.bg.default', 4.5]] }));

describe('freshness', () => {
  it('reads behind_by from the compare API', () => {
    expect(freshness({ compare: { behind_by: 3, ahead_by: 1, merge_base_commit: { sha: 'abc' } }, mergeable: true, open: true })).toEqual({ state: 'behind', behindBy: 3, mergeBase: 'abc' });
    expect(freshness({ compare: { behind_by: 0, ahead_by: 2 }, mergeable: true, open: true }).state).toBe('current');
  });

  it('says conflict when GitHub cannot combine them, whatever behind_by says', () => {
    expect(freshness({ compare: { behind_by: 5 }, mergeable: false, open: true }).state).toBe('conflict');
    expect(freshness({ compare: null, mergeable: false, open: true })).toEqual({ state: 'conflict', behindBy: null, mergeBase: null });
  });

  it('never says up to date when the compare could not be read', () => {
    expect(freshness({ compare: null, mergeable: true, open: true }).state).toBe('unknown');
    expect(freshness({ compare: undefined, mergeable: null, open: true }).state).toBe('unknown');
  });

  it('has nothing to bring in once shipped or closed', () => {
    expect(freshness({ compare: { behind_by: 9 }, mergeable: false, open: false }).state).toBe('current');
  });
});

describe('libraryLine and behindTag', () => {
  it('names the number of updates, singular and plural', () => {
    expect(libraryLine({ state: 'behind', behindBy: 1, mergeBase: null })).toBe('main has moved on: 1 update since this branch started.');
    expect(libraryLine({ state: 'conflict', behindBy: 12, mergeBase: null })).toBe('main has moved on: 12 updates since this branch started.');
    expect(libraryLine({ state: 'current', behindBy: 0, mergeBase: null })).toBeNull();
    expect(libraryLine({ state: 'unknown', behindBy: null, mergeBase: null })).toBeNull();
  });

  it('tags list rows only when behind', () => {
    expect(behindTag(4)).toBe('main moved on: 4 updates');
    expect(behindTag(1)).toBe('main moved on: 1 update');
    expect(behindTag(0)).toBeNull();
    expect(behindTag(null)).toBeNull();
  });
});

describe('overlap and conflictRoute', () => {
  const isToken = (f: string) => f.endsWith('.tokens.json');
  it('splits files both sides changed into token files and code', () => {
    const o = overlap(
      [{ filename: 'packages/tokens/src/semantic/light.tokens.json', status: 'modified' }, { filename: 'src/Button.tsx', status: 'modified' }, { filename: 'README.md', status: 'modified' }],
      [{ filename: 'packages/tokens/src/semantic/light.tokens.json', status: 'modified' }, { filename: 'src/Button.tsx', status: 'modified' }],
      isToken,
    );
    expect(o).toEqual({ tokenFiles: ['packages/tokens/src/semantic/light.tokens.json'], codeFiles: ['src/Button.tsx'] });
  });

  it('counts a renamed file under its old name', () => {
    expect(overlap([{ filename: 'b.tokens.json', previous_filename: 'a.tokens.json', status: 'renamed' }], [{ filename: 'a.tokens.json', status: 'modified' }], isToken).tokenFiles).toEqual(['a.tokens.json']);
  });

  it('lets the designer resolve only a pure token-file conflict', () => {
    expect(conflictRoute({ tokenFiles: ['a.tokens.json'], codeFiles: [] })).toEqual({ kind: 'tokens', files: ['a.tokens.json'] });
    expect(conflictRoute({ tokenFiles: ['a.tokens.json'], codeFiles: ['x.ts'] })).toEqual({ kind: 'code', alsoTokens: true, files: ['x.ts'] });
    expect(conflictRoute({ tokenFiles: [], codeFiles: [] })).toEqual({ kind: 'code', alsoTokens: false, files: [] });
    expect(conflictRoute({ tokenFiles: ['a.tokens.json'], codeFiles: [] }, { truncated: true }).kind).toBe('code');
  });

  it('says who resolves, in designer words', () => {
    expect(conflictLine({ kind: 'code', alsoTokens: true, files: [] }, null)).toBe('This branch also conflicts in code. A developer resolves that part.');
    expect(conflictLine({ kind: 'code', alsoTokens: false, files: [] }, null)).toMatch(/A developer resolves it\.$/);
    expect(conflictLine({ kind: 'tokens', files: [] }, 2)).toBe('2 tokens changed here and on main. Pick which value to keep.');
    expect(conflictLine({ kind: 'tokens', files: [] }, 0)).toMatch(/Bridge can combine them/);
    expect(resolveLabel(1)).toBe('Resolve 1 conflict');
    expect(resolveLabel(3)).toBe('Resolve 3 conflicts');
    expect(resolveLabel(0)).toBe('Update from main');
  });
});

describe('what happens next', () => {
  it('reads the dismissal rule from the branch rules', () => {
    expect(dismissStaleFrom([{ type: 'deletion' }, { type: 'pull_request', parameters: { dismiss_stale_reviews_on_push: true } }])).toBe(true);
    expect(dismissStaleFrom([{ type: 'pull_request', parameters: { dismiss_stale_reviews_on_push: false } }])).toBe(false);
    expect(dismissStaleFrom([{ type: 'deletion' }])).toBeNull();
    expect(dismissStaleFrom(null)).toBeNull();
  });

  it('says checks run again and what happens to the approvals', () => {
    expect(nextSteps({ checks: 5, visual: false, approvals: 0, dismissStale: true })).toBe('Checks run again.');
    expect(nextSteps({ checks: 5, visual: true, approvals: 1, dismissStale: true })).toBe('Checks and the visual comparison run again, and the approval needs renewing.');
    expect(nextSteps({ checks: 5, visual: false, approvals: 2, dismissStale: true })).toBe('Checks run again, and the 2 approvals need renewing.');
    expect(nextSteps({ checks: 5, visual: false, approvals: 2, dismissStale: false })).toBe('Checks run again. The 2 approvals stay.');
    expect(nextSteps({ checks: 0, visual: false, approvals: 1, dismissStale: null })).toBe('Checks run on the new version. Approvals may need renewing.');
  });
});

describe('conflict rows and the resolution plan', () => {
  const base = files(light('{color.ink.600}'));
  const mine = files(light('{color.ink.900}'));
  const theirs = files(light('{color.ink.300}', '{color.ink.900}'));
  const input = (m = mine, t = theirs) => ({ base, mine: m, theirs: t, files: [LIGHT] });
  const sets = (m = mine, t = theirs) => ({ base: buildTokenSet(base), mine: buildTokenSet(m), theirs: buildTokenSet(t) });

  it('shows the name, mode, and the three values resolved as swatches', () => {
    const plan = planTokenMerge(input());
    const rows = conflictRows(plan.conflicts, sets());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'color.text.muted',
      context: 'Light',
      library: { alias: 'color.ink.300', hex: '#c0c4ca' },
      mine: { alias: 'color.ink.900', hex: '#15202b' },
      base: { alias: 'color.ink.600', hex: '#5b6672' },
      mustPick: false,
      defaultChoice: 'mine',
      note: null,
    });
    expect(fileContext(buildTokenSet(base), 'primitives/color.tokens.json')).toBe('');
  });

  it('makes the designer pick when the library removed a token this change changed', () => {
    const removed = files(light(null));
    const plan = planTokenMerge(input(mine, removed));
    const rows = conflictRows(plan.conflicts, sets(mine, removed));
    expect(rows[0]).toMatchObject({ name: 'color.text.muted', library: null, mustPick: true, defaultChoice: null, note: 'Removed on main: pick one.' });
    expect(resolution(plan.conflicts, {})).toMatchObject({ ready: false, missing: 1, sentence: 'Pick a value for 1 more token.' });
    expect(resolution(plan.conflicts, { [plan.conflicts[0]!.key]: 'theirs' })).toMatchObject({ ready: true, theirs: 1, sentence: "Keeps main's for 1 token." });
  });

  it('counts the choices and writes them in the commit message', () => {
    const plan = planTokenMerge(input());
    expect(resolution(plan.conflicts, {}).sentence).toBe('Keeps yours for 1 token.');
    expect(resolution([], {}).sentence).toMatch(/no token changed on both/);
    const msg = resolutionMessage({ library: 'main', conflicts: plan.conflicts, choices: { [plan.conflicts[0]!.key]: 'theirs' }, who: 'ann' });
    expect(msg).toBe(`Bring in the latest main and resolve 1 token conflict\n\n- color.text.muted (${LIGHT}): used the main value\n\nResolved in Bridge by @ann.`);
  });

  it('runs the contrast guardrail on the resolved tokens before anything is sent', () => {
    const plan = planTokenMerge(input());
    // Keep mine: ink.900 on white passes. Use the library's: ink.300 on white fails 4.5.
    const resolvedFiles = (side: 'mine' | 'theirs') => ({ ...theirs, ...(applyTokenMerge(input(), { [plan.conflicts[0]!.key]: side }).files as Record<string, string>) });
    const ok = guardrail(reviewTokenChange(theirs, resolvedFiles('mine'), checks));
    expect(ok).toMatchObject({ ok: true, sentence: 'All 4 contrast checks pass with these choices.' });
    const bad = guardrail(reviewTokenChange(theirs, { ...theirs, [LIGHT]: light('{color.ink.300}', '{color.ink.300}') }, checks));
    expect(bad.ok).toBe(false);
    expect(bad.sentence).toMatch(/^1 contrast check fails with these choices/);
    expect(bad.failing[0]).toMatchObject({ pair: 'color.text.link on color.bg.default', where: 'Light', min: '4.5:1' });
  });
});
