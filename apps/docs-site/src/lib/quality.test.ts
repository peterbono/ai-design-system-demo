// Studio Quality: findings ordering, the opener sentence and the opener's one action.
import { describe, expect, it } from 'vitest';
import {
  adoptionRows,
  adoptionSummary,
  baselineSince,
  beforeLabel,
  cleanupTitle,
  componentSentence,
  componentSources,
  contrastFinding,
  deltaPhrase,
  firstFindingTarget,
  hardcodedLine,
  openerSentence,
  qualityModel,
  sortFindings,
  tokenSentence,
  trendLabels,
  type Finding,
} from './quality';
import type { Issue } from './stats';

const combos = ['Bridge light', 'Bridge dark', 'Ocean light', 'Ocean dark'].map((label) => ({ label, pass: 74, total: 74 }));
const pass = { total: 296, fail: 0, combos };
const failing = { total: 296, fail: 3, combos: combos.map((c, i) => (i === 1 ? { ...c, pass: 71 } : c)) };
const edit = (slug: string) => `/studio/components/docs/?c=${slug}`;
const comps = [
  { name: 'Button', slug: 'button', state: 'ok' as const, docsPath: 'b' },
  { name: 'Icon', slug: 'icon', state: 'missing' as const, docsPath: 'Icon.docs.json' },
  { name: 'VisuallyHidden', slug: 'visually-hidden', state: 'review' as const, docsPath: 'v' },
];
const unused: Issue = { kind: 'unused', severity: 'info', title: '16 semantic tokens not in use', detail: '', href: '/tokens/' };
const deprecated: Issue = { kind: 'deprecated', severity: 'warn', title: 'color.old is deprecated', detail: '', href: '/tokens/?t=color.old' };
const unknown: Issue = { kind: 'unknown-ref', severity: 'fail', title: 'Card reads --nope', detail: '', href: '/components/card/#anatomy' };
const guidanceIssue: Issue = { kind: 'guidance', severity: 'warn', title: 'Icon has no usage guidance', detail: '', href: '/components/icon/' };

describe('quality findings', () => {
  it('sorts fail, then warn, then notes, then what passes, stable inside a severity', () => {
    const f = (id: string, severity: Finding['severity']): Finding => ({ id, kind: 'validation', severity, title: id, status: { label: '', group: 'neutral' } });
    expect(sortFindings([f('a', 'pass'), f('b', 'warn'), f('c', 'note'), f('d', 'fail'), f('e', 'warn')]).map((x) => x.id)).toEqual(['d', 'b', 'e', 'c', 'a']);
  });

  it('puts a passing contrast gate after the open findings, as one green line with four combos', () => {
    const m = qualityModel({ contrast: pass, components: comps, issues: [unused, guidanceIssue], editHref: edit });
    expect(m.findings.map((x) => x.id)).toEqual(['guidance-icon', 'guidance-visually-hidden', 'contrast']);
    const c = m.findings.at(-1)!;
    expect(c.status).toEqual({ label: 'Passing', group: 'ready' });
    expect(c.combos).toHaveLength(4);
    expect(m.cleanup).toEqual([unused]);
  });

  it('leads with a failing contrast gate and unknown references, then warnings', () => {
    const m = qualityModel({ contrast: failing, components: comps, issues: [deprecated, unknown], editHref: edit });
    expect(m.findings.map((x) => x.severity)).toEqual(['fail', 'fail', 'warn', 'warn', 'warn']);
    expect(m.findings[0]!.id).toBe('contrast');
    expect(m.findings[0]!.status.group).toBe('blocked');
  });

  it('says missing guidance and Claude drafts apart, with their actions', () => {
    const m = qualityModel({ contrast: pass, components: comps, issues: [], editHref: edit });
    const [icon, vh] = m.findings;
    expect(icon).toMatchObject({ status: { label: 'Missing guidance', group: 'neutral' }, action: { label: 'Add guidance', href: edit('icon') } });
    expect(vh).toMatchObject({ status: { label: 'Draft by Claude, needs review', group: 'waiting' }, action: { label: 'Review', href: edit('visually-hidden') } });
  });
});

describe('quality opener', () => {
  const sentence = (contrast: typeof pass, cs: { state: 'ok' | 'review' | 'missing' }[], issues: Issue[] = []) =>
    openerSentence(contrast, cs, qualityModel({ contrast, components: cs.map((c, i) => ({ ...c, name: `C${i}`, slug: `c${i}`, docsPath: '' })), issues, editHref: edit }).findings);

  it('names the contrast gate first, then guidance', () => {
    expect(sentence(pass, [{ state: 'missing' }, { state: 'missing' }])).toBe('All 296 contrast checks pass. 2 components need guidance.');
    expect(sentence(pass, [{ state: 'review' }, { state: 'review' }])).toBe('All 296 contrast checks pass. 2 docs drafts need review.');
    expect(sentence(pass, [{ state: 'missing' }, { state: 'review' }])).toBe('All 296 contrast checks pass. 1 component needs guidance and 1 docs draft needs review.');
    expect(sentence(pass, [{ state: 'ok' }])).toBe('All 296 contrast checks pass. Nothing needs you.');
    expect(sentence(failing, [{ state: 'ok' }], [unknown])).toBe('3 of 296 contrast checks fail, so the token build is blocked. 1 token finding needs a fix.');
  });

  it('points its one action at the first open finding, else the contrast grid', () => {
    const open = qualityModel({ contrast: pass, components: comps, issues: [], editHref: edit }).findings;
    expect(firstFindingTarget(open)).toEqual({ label: 'Fix the first finding', href: edit('icon') });
    const blocked = qualityModel({ contrast: failing, components: comps, issues: [], editHref: edit }).findings;
    expect(firstFindingTarget(blocked)).toEqual({ label: 'Fix the first finding', href: '/foundations/accessibility/' });
    expect(firstFindingTarget([contrastFinding(pass)])).toEqual({ label: 'Open the contrast grid', href: '/foundations/accessibility/' });
  });
});

describe('adoption rows', () => {
  it('leads with the newest run, the run before the move as baseline, and links the newest report', () => {
    const m = (t: number, c: number) => ({ report: { metrics: { tokenAdoption: t, componentAdoption: c } } });
    const rows = adoptionRows([
      { app: { id: 'admin', title: 'Admin demo (long)' }, reports: [{ id: 'admin-before' }, { id: 'admin-after' }], before: m(0, 0), after: { id: 'admin-after', ...m(100, 90.2) } },
      { app: { id: 'x', title: 'X app' }, reports: [{ id: 'x-1' }], before: m(10, 20) },
    ]);
    expect(rows[0]).toEqual({ id: 'admin', label: 'Admin demo', token: { from: 0, to: 100 }, component: { from: 0, to: 90.2 }, href: '/studio/quality/audits/admin-after/' });
    expect(rows[1]).toMatchObject({ label: 'X app', token: { from: null, to: 10 }, href: '/studio/quality/audits/x-1/' });
  });
});

describe('clean up title', () => {
  it('counts unused tokens, not groups', () => {
    expect(cleanupTitle(16 + 86)).toBe('102 unused tokens');
    expect(cleanupTitle(1)).toBe('1 unused token');
    expect(cleanupTitle(0)).toBe('No unused tokens');
  });

  it('keeps file paths out of the missing guidance line', () => {
    const m = qualityModel({ contrast: pass, components: comps, issues: [], editHref: edit });
    expect(m.findings[0]!.detail).toBe('Its page shows props and tokens only. Add guidance in the docs editor.');
    expect(m.findings[0]!.detail).not.toContain('docs.json');
  });
});

describe('adoption in plain words', () => {
  it('names the baseline as a quiet label, or nothing without one', () => {
    expect(beforeLabel(0)).toBe('Before Bridge: 0%');
    expect(beforeLabel(52.84)).toBe('Before Bridge: 52.8%');
    expect(beforeLabel(null)).toBeNull();
  });

  it('says the token metric in one sentence', () => {
    expect(tokenSentence({ tokenAdoption: 100, tokenUsages: 445, hardcoded: 0 })).toBe('100% of styling values come from tokens (445 uses, no hard-coded value).');
    expect(tokenSentence({ tokenAdoption: 100, tokenUsages: 4667, hardcoded: 2 })).toBe('100% of styling values come from tokens (4667 uses, 2 hard-coded values left).');
    expect(tokenSentence({ tokenAdoption: 0, tokenUsages: 0, hardcoded: 131 }, true)).toBe('0% of styling values came from tokens (0 uses, 131 hard-coded values).');
  });

  it('says the component metric in one sentence', () => {
    expect(componentSentence({ componentAdoption: 90.2, dsComponentInstances: 239, uiComponentInstances: 265 })).toBe('90.2% of components come from the design system (239 of 265).');
  });

  it('names the baseline in plain words and says the change in points', () => {
    const since = baselineSince(true, 'original Material UI version', 'Oct 16');
    expect(since).toBe('before the move to Bridge (original Material UI version)');
    expect(baselineSince(true, undefined, 'Oct 16')).toBe('before the move to Bridge');
    expect(baselineSince(false, 'x', 'Oct 16')).toBe('the run of Oct 16');
    expect(deltaPhrase(100, since)).toBe('Up 100 points since before the move to Bridge (original Material UI version).');
    expect(deltaPhrase(-1, 'the run of Oct 16')).toBe('Down 1 point since the run of Oct 16.');
    expect(deltaPhrase(0.01, 'the run of Oct 16')).toBe('Same as the run of Oct 16.');
    expect(deltaPhrase(undefined, since)).toBeNull();
  });

  it('sums a report up in one sentence', () => {
    expect(adoptionSummary({ tokenAdoption: 100, componentAdoption: 90.2 }, { tokenAdoption: 0, componentAdoption: 0 })).toBe(
      '100% of styling values and 90.2% of components come from the design system, up from 0% before the move.',
    );
    expect(adoptionSummary({ tokenAdoption: 100, componentAdoption: 100 }, { tokenAdoption: 9.7, componentAdoption: 52.8 })).toBe(
      '100% of styling values and 100% of components come from the design system, up from 9.7% and 52.8% before the move.',
    );
    expect(adoptionSummary({ tokenAdoption: 40, componentAdoption: 50 }, null)).toBe('40% of styling values and 50% of components come from the design system.');
    expect(adoptionSummary({ tokenAdoption: 0, componentAdoption: 0 }, null, true)).toBe('0% of styling values and 0% of components came from the design system before the move.');
  });

  it('lists the component sources with counts, empty ones left out', () => {
    expect(componentSources({ ds: 239, foreign: 22, native: 4, recreated: 0 })).toEqual([
      { key: 'ds', label: 'Bridge', count: 239 },
      { key: 'foreign', label: 'Other libraries', count: 22 },
      { key: 'native', label: 'Plain HTML elements', count: 4 },
    ]);
  });

  it('says one success line when no hard-coded value is left', () => {
    expect(hardcodedLine(0, 0)).toBe('No hard-coded value left.');
    expect(hardcodedLine(2, 2)).toBe('2 hard-coded values left, 2 match a token exactly.');
    expect(hardcodedLine(131, 1, true)).toBe('131 hard-coded values, 1 matches a token exactly.');
  });

  it('labels the trend runs in plain words', () => {
    const fmt = (iso: string) => iso.slice(5, 10);
    const runs = [{ generatedAt: '2026-10-01T00:00:00Z' }, { generatedAt: '2026-10-08T00:00:00Z' }, { generatedAt: '2026-10-16T00:00:00Z' }];
    expect(trendLabels(runs, '2026-10-01T00:00:00Z', fmt)).toEqual(['Before Bridge', '10-08', 'Now']);
    expect(trendLabels(runs, undefined, fmt)).toEqual(['10-01', '10-08', 'Now']);
  });
});
