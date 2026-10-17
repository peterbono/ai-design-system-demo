// Studio Quality: findings ordering, the opener sentence and the opener's one action.
import { describe, expect, it } from 'vitest';
import { adoptionRows, contrastFinding, firstFindingTarget, openerSentence, qualityModel, sortFindings, type Finding } from './quality';
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
