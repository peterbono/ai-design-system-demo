import { describe, expect, it } from 'vitest';
import type { AuditReport } from '@bridge-ds/core/audit';
import { adoptionTone, categoryRows, componentBreakdown, formatDelta, formatPct, isAuditReport, parseAudits, trendPoints } from './audits';

const report = (over: Partial<AuditReport> = {}): AuditReport => ({
  schemaVersion: 1,
  tool: { name: 'bridge', version: '0.1.0' },
  generatedAt: '2026-10-16T10:00:00.000Z',
  target: { path: 'src', files: 2, skipped: 0 },
  designSystem: { packages: ['@bridge-ds/react'], components: 3, tokens: 10, modes: ['theme'] },
  metrics: { tokenAdoption: 40, componentAdoption: 25, tokenUsages: 4, hardcoded: 6, themeRefs: 1, dsComponentInstances: 1, uiComponentInstances: 4 },
  byCategory: { color: { hardcoded: 4, exact: 1, suggested: 3 }, spacing: { hardcoded: 2, exact: 2, suggested: 2 }, radius: { hardcoded: 0, exact: 0, suggested: 0 } },
  components: {
    ds: { Button: 1 },
    foreign: { '@mui/material': { instances: 2, components: { Box: 1, Card: 1 } } },
    native: { button: 1 },
    recreated: [{ name: 'Avatar', file: 'src/Avatar.tsx', line: 3, instances: 0 }],
  },
  topFiles: [],
  topFixes: [],
  files: [],
  history: [],
  ...over,
});

describe('audits', () => {
  it('keeps schema v1 reports only, newest first', () => {
    const older = report({ generatedAt: '2026-10-01T00:00:00.000Z' });
    const list = parseAudits({
      '../data/audits/a-before.json': { default: older },
      '../data/audits/b.json': report(),
      '../data/audits/bad.json': { default: { schemaVersion: 2 } },
    });
    expect(list.map((e) => e.id)).toEqual(['b', 'a-before']);
    expect(isAuditReport({ schemaVersion: 1 })).toBe(false);
  });

  it('builds a deduplicated trend from history and reports', () => {
    const h = { generatedAt: '2026-09-01T00:00:00.000Z', tokenAdoption: 10, componentAdoption: 5, hardcoded: 20, uiComponentInstances: 4, dsComponentInstances: 0 };
    const a = report({ generatedAt: '2026-10-01T00:00:00.000Z', label: 'Before', history: [h] });
    const b = report({ history: [h, { ...h, generatedAt: a.generatedAt, label: 'Before (copy)' }] });
    const t = trendPoints([b, a]);
    expect(t.map((p) => p.generatedAt)).toEqual([h.generatedAt, a.generatedAt, b.generatedAt]);
    expect(t[1]!.label).toBe('Before');
    expect(t[0]!.label).toBe('2026-09-01');
  });

  it('splits categories into exact, near and no suggestion', () => {
    const rows = categoryRows(report());
    expect(rows).toEqual([
      { key: 'color', label: 'Color', hardcoded: 4, exact: 1, near: 2, none: 1 },
      { key: 'spacing', label: 'Spacing', hardcoded: 2, exact: 2, near: 0, none: 0 },
    ]);
  });

  it('sums component instances', () => {
    const c = componentBreakdown(report());
    expect([c.ds, c.foreign, c.native, c.recreated, c.total]).toEqual([1, 2, 1, 0, 4]);
    const local = componentBreakdown(report({ metrics: { ...report().metrics, uiComponentInstances: 6 } }));
    expect([local.recreated, local.total]).toEqual([2, 6]);
    expect(c.libraries[0]!.top.map((x) => x.name)).toEqual(['Box', 'Card']);
  });

  it('formats', () => {
    expect(formatPct(null)).toBe('n/a');
    expect(formatPct(12.345)).toBe('12.3%');
    expect(formatDelta(-4)).toBe('-4');
    expect(formatDelta(2.25)).toBe('+2.3');
    expect(adoptionTone(85)).toBe('pass');
    expect(adoptionTone(10)).toBe('fail');
  });
});
