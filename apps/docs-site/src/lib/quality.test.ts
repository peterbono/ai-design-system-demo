// Studio Quality: findings ordering, the opener sentence and the opener's one action.
import { describe, expect, it } from 'vitest';
import { adoptionRows, cleanupTitle, contrastFinding, firstFindingTarget, openerSentence, qualityModel, sortFindings, sparkLabel, sparkPoints, type Finding } from './quality';
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
  it('shows before -> after per app and links the newest report', () => {
    const m = (t: number, c: number) => ({ report: { metrics: { tokenAdoption: t, componentAdoption: c } } });
    const rows = adoptionRows([
      { app: { id: 'admin', title: 'Admin demo (long)' }, reports: [{ id: 'admin-before' }, { id: 'admin-after' }], before: m(0, 0), after: { id: 'admin-after', ...m(100, 90.2) } },
      { app: { id: 'x', title: 'X app' }, reports: [{ id: 'x-1' }], before: m(10, 20) },
    ]);
    expect(rows[0]).toEqual({ id: 'admin', label: 'Admin demo', token: { from: 0, to: 100 }, component: { from: 0, to: 90.2 }, href: '/studio/quality/audits/admin-after/' });
    expect(rows[1]).toMatchObject({ label: 'X app', token: { from: 10, to: null }, href: '/studio/quality/audits/x-1/' });
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

describe('adoption sparkline', () => {
  const runs = [
    { tokenAdoption: 0, componentAdoption: 0 },
    { tokenAdoption: 50, componentAdoption: null },
    { tokenAdoption: 100, componentAdoption: 90 },
  ];

  it('spreads runs on x and maps 0 to 100 percent on y, skipping missing values', () => {
    expect(sparkPoints(runs, 'tokenAdoption', 84, 24)).toBe('2,22 42,12 82,2');
    expect(sparkPoints(runs, 'componentAdoption', 84, 24)).toBe('2,22 82,4');
  });

  it('centers a single run and clamps out of range values', () => {
    expect(sparkPoints([{ tokenAdoption: 120, componentAdoption: -5 }], 'tokenAdoption', 84, 24)).toBe('42,2');
    expect(sparkPoints([{ tokenAdoption: 120, componentAdoption: -5 }], 'componentAdoption', 84, 24)).toBe('42,22');
  });

  it('says the first and last run for screen readers', () => {
    expect(sparkLabel('Admin demo', [runs[0]!, { tokenAdoption: 100, componentAdoption: 90.2 }])).toBe(
      'Admin demo adoption over 2 runs: tokens 0% to 100%, components 0% to 90.2%.',
    );
    expect(sparkLabel('Admin demo', [runs[0]!])).toBe('Admin demo: one run so far.');
  });
});
