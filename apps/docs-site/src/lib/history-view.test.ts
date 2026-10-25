import { describe, expect, it } from 'vitest';
import { LayeredTokenSet, applyTokenEdits, composeProposalBody, demoHistory, planRevert } from '@bridge-ds/core';
import { authorsOf, countsLabel, demoBeforeFiles, humanAuthored, laterThan, overrideLine, realSummary, suggestionOverrideLine, viewTimeline } from './history-view';
import { overrideComment, parseOverrideComment } from './review-rules';
import { currentTokenFiles, siteConfig } from './history';

const config = siteConfig();
// The demo is built backwards from the current files, and a step whose "before" equals today's value drops out.
// Pin the three values the demo steps touch, so a designer editing them in Studio never breaks these tests.
const files = Object.fromEntries(
  applyTokenEdits(new LayeredTokenSet(config, new Map(Object.entries(currentTokenFiles()))), [
    { op: 'set', path: 'color.text.muted', file: 'semantic/light.tokens.json', value: '{palette.neutral.600}' },
    { op: 'set', path: 'button.radius', file: 'components/button.tokens.json', value: '{radius.control}' },
    { op: 'set', path: 'alert.radius', file: 'components/feedback.tokens.json', description: 'Inline alerts are containers.' },
  ]).files,
);
const demo = demoHistory(config, new Map(Object.entries(files)));
const muted = (f: Record<string, string>) => new LayeredTokenSet(config, new Map(Object.entries(f))).defs.find((d) => d.path === 'color.text.muted' && d.file === 'semantic/light.tokens.json')!.value;

describe('history view', () => {
  it('rebuilds demo states newest first: before #106 muted text was neutral.700, before #101 neutral.500', () => {
    let after = files;
    const states: Record<string, unknown> = {};
    for (const e of demo.entries) {
      const before = demoBeforeFiles(config, after, e);
      states[e.id] = muted(before);
      after = before;
    }
    expect(states['pr-106']).toBe('{palette.neutral.700}');
    expect(states['pr-101']).toBe('{palette.neutral.500}');
    // A description-only entry leaves values alone.
    expect(states['pr-104']).toBe('{palette.neutral.700}');
  });

  it('timeline groups by version and drops versions the filter empties', () => {
    expect(viewTimeline(demo).map((g) => [g.version, g.items.map((e) => e.id)])).toEqual([
      ['Unreleased', ['pr-106']],
      ['1.2.0', ['pr-104']],
      ['1.1.0', ['pr-102', 'pr-101']],
    ]);
    expect(viewTimeline(demo, { token: 'color.text.muted' }).map((g) => g.version)).toEqual(['Unreleased', '1.1.0']);
    expect(viewTimeline(demo, { tier: 1 }).flatMap((g) => g.items.map((e) => e.id))).toEqual(['pr-104']);
    expect(authorsOf(demo.entries)).toEqual(['demo-designer', 'demo-engineer']);
  });

  it('labels counts, later entries and the sparse summary', () => {
    expect(countsLabel({ added: 1, changed: 3, removed: 0, renamed: 0, total: 4 })).toBe('3 changed, 1 added');
    const first = demo.entries.find((e) => e.id === 'pr-101')!;
    expect(laterThan(demo.entries, first).map((e) => e.id)).toEqual(['pr-106', 'pr-104', 'pr-102']);
    expect(realSummary(null)).toEqual({ total: 0, reviewable: 0, imports: 0, tokenChanges: 0 });
    expect(realSummary(demo)).toMatchObject({ total: 4, reviewable: 4, imports: 0 });
  });

  it('the demo revert of #101 meets the #106 conflict on the built files', () => {
    const plan = planRevert({ current: new LayeredTokenSet(config, new Map(Object.entries(files))), entry: demo.entries.find((e) => e.id === 'pr-101')!, later: demo.entries });
    expect(plan.conflicts.map((c) => [c.reason, c.later.map((l) => l.pr)])).toEqual([['changed-later', [106]]]);
  });

  it('marks web proposals as human-authored', () => {
    const body = composeProposalBody({ summary: 'x', changes: [], contrast: [], impact: { total: 0, entries: [] }, tier: { tier: 1, bump: 'patch', reasons: [], label: '' }, validationErrors: 0, tool: 'Bridge' });
    const out = humanAuthored(body);
    expect(out).toContain('- [x] Human');
    expect(out).toContain('- [ ] AI agent');
    expect(out).not.toContain('Agent-authored');
    expect(out).not.toMatch(/\u2014/);
  });
});

describe('overrideLine', () => {
  it('says who merged with the owner override, without which approvals, and why', () => {
    const ov = parseOverrideComment(overrideComment('dana', 'Solo maintainer, <b>tests</b> pass', ['design approval']))!;
    const html = overrideLine(ov, (x) => x.replace(/</g, '&lt;'), (l) => `[${l}]`);
    expect(html).toBe('Merged with the owner override by [dana] without design approval. Reason: Solo maintainer, &lt;b>tests&lt;/b> pass.');
  });
  it('says so when no reason was given', () => {
    expect(overrideLine({ login: 'dana', reason: 'no reason given', missing: [] }, (x) => x, (l) => l)).toBe('Merged with the owner override by dana. No reason was given.');
  });
});

describe('a suggestion applied with the owner override', () => {
  it('says who approved it as owner, without what, and why', () => {
    const line = suggestionOverrideLine({ login: 'peterbono', reason: 'Solo maintainer, <checked>', missing: ['design approval'] }, (x) => x.replace(/</g, '&lt;'), (l) => `<b>${l}</b>`);
    expect(line).toBe('Applied with the owner override by <b>peterbono</b> without design approval. Reason: Solo maintainer, &lt;checked>.');
  });
});
