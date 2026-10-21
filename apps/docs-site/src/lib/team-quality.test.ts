import { describe, expect, it } from 'vitest';
import { loadRepoModel, memorySource, type SnapshotAudit } from '@bridge-ds/core';
import { repoModel } from './model';
import { dashboard } from './stats';
import { guidanceLead, pctLabel, teamQuality } from './team-quality';
import { HOSTED_DOCS_URL } from './team-load';

const SHA = 'b'.repeat(40);
const team = { owner: 'acme', repo: 'ds', sha: SHA };

/** Every link a team page would show. */
const hrefs = (q: ReturnType<typeof teamQuality>) => [
  q.cta.href,
  ...q.figures.map((f) => f.href),
  ...[q.gate, ...q.tokenFindings, ...q.guidanceFindings].flatMap((f) => (f.action ? [f.action.href] : [])),
  ...q.cleanup.map((i) => i.href),
  ...q.guidance.rows.map((r) => r.href),
  ...(q.adoption ?? []).map((a) => a.href),
];

describe('teamQuality on this repository (parity with the build-time dashboard)', () => {
  const q = teamQuality({ model: repoModel, ...team, audits: null });
  const s = dashboard();

  it('counts the same contrast checks, per brand and theme', () => {
    expect(q.hasChecks).toBe(true);
    expect(q.contrast.total).toBe(s.contrast.total);
    expect(q.contrast.fail).toBe(s.contrast.fail);
    expect(q.contrast.combos.map((c) => [c.pass, c.total])).toEqual(s.contrast.byCombo.map((c) => [c.pass, c.total]));
    expect(q.failRows).toHaveLength(s.contrast.failing.length);
  });

  it('finds the same guidance state and deprecated tokens', () => {
    expect(q.guidance.total).toBe(s.components);
    expect(q.guidance.total - q.guidance.missing).toBe(s.documented);
    const deprecated = s.issues.filter((i) => i.kind === 'deprecated').length;
    expect(q.tokenFindings.filter((f) => f.title.endsWith('is deprecated'))).toHaveLength(deprecated);
  });

  it('links only to the team: Studio pages and GitHub, never the demo Library', () => {
    for (const h of hrefs(q)) expect(h).toMatch(/^(\/studio\/|#|https:\/\/github\.com\/acme\/ds\/)/);
    expect(q.gate.action?.href).toBe(`https://github.com/acme/ds/blob/${SHA}/${repoModel.contrast.path}`);
  });

  it('says there is no audit instead of a number, without a snapshot', () => {
    expect(q.adoption).toBeNull();
    expect(q.figures.map((f) => f.id)).toEqual(['contrast', 'adoption', 'guidance']);
    expect(q.figures[1]!.value).toBe('No audit yet');
  });
});

describe('teamQuality on a repository Bridge cannot read much from', () => {
  it('no checks file is not a pass, no components is said plainly', async () => {
    const model = await loadRepoModel(memorySource({ 'README.md': '# hi' }, { owner: 'acme', repo: 'ds', sha: SHA }));
    const q = teamQuality({ model, ...team, audits: null });
    expect(q.hasChecks).toBe(false);
    expect(q.gate.title).toBe('No contrast checks yet');
    expect(q.gate.action?.href).toBe(HOSTED_DOCS_URL);
    expect(q.figures[0]!.value).toBe('No checks yet');
    expect(q.figures[0]!.tone).toBeNull();
    expect(q.figures.find((f) => f.id === 'guidance')?.value).toBe('No components');
    expect(q.sentence).not.toMatch(/All 0/);
    expect(q.cleanup).toEqual([]);
    expect(guidanceLead(q.guidance)).toBe('Bridge found no components in this repository.');
    for (const h of hrefs(q)) expect(h).toMatch(/^(\/studio\/|#|https:\/\/github\.com\/)/);
  });
});

describe('adoption from the snapshot audits', () => {
  const audit = (id: string, ds: number, ui: number, label?: string): SnapshotAudit => ({
    id,
    path: `audits/${id}.json`,
    ...(label ? { label } : {}),
    generatedAt: '2026-10-20T10:00:00Z',
    target: { path: `apps/${id}/src`, files: 10 },
    metrics: { tokenAdoption: 91.24, componentAdoption: ui ? (ds / ui) * 100 : null, tokenUsages: 10, hardcoded: 1, themeRefs: 0, dsComponentInstances: ds, uiComponentInstances: ui },
  });

  it('one row per audit, the report on the bridge-data branch, the combined figure', () => {
    const q = teamQuality({ model: repoModel, ...team, audits: [audit('web', 30, 40, 'Web app'), audit('admin', 10, 10)] });
    expect(q.adoption).toEqual([
      { id: 'web', label: 'Web app', token: 91.24, component: 75, generatedAt: '2026-10-20T10:00:00Z', href: 'https://github.com/acme/ds/blob/bridge-data/audits/web.json' },
      { id: 'admin', label: 'apps/admin/src', token: 91.24, component: 100, generatedAt: '2026-10-20T10:00:00Z', href: 'https://github.com/acme/ds/blob/bridge-data/audits/admin.json' },
    ]);
    expect(q.figures[1]!.value).toBe('80%');
    expect(pctLabel(91.24)).toBe('91.2%');
    expect(pctLabel(null)).toBe('n/a');
  });

  it('an empty audit list counts as no audit', () => {
    expect(teamQuality({ model: repoModel, ...team, audits: [] }).adoption).toBeNull();
  });
});

describe('adoptionPerProduct', () => {
  it('counts each audited product once: its latest run now, its first run before', async () => {
    const { adoptionPerProduct } = await import('./team-quality');
    const m = (ds: number) => ({ dsComponentInstances: ds, uiComponentInstances: 10 }) as never;
    const a = (id: string, path: string, at: string, ds: number) => ({ id, path: `audits/${id}.json`, generatedAt: at, target: { path, files: 1 }, metrics: m(ds) });
    const out = adoptionPerProduct([a('old', 'apps/a', '2026-01-01', 2), a('new', 'apps/a', '2026-03-01', 9), a('b', 'apps/b', '2026-02-01', 5)]);
    expect(out).toEqual([
      { now: m(9), before: m(2) },
      { now: m(5), before: null },
    ]);
  });
});
