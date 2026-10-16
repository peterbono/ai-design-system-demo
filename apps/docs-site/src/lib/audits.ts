// Adoption page data: `bridge audit` reports committed under src/data/audits/*.json.
// Pure helpers take report objects (tested in audits.test.ts); only loadAudits() reads files.
import { listDir, readJson } from './repo';
import type { AuditReport, FindingCategory, HistoryPoint } from '@bridge/core/audit';

export const AUDITS_DIR = 'apps/docs-site/src/data/audits';

export interface AuditEntry {
  /** File name without .json, used as the anchor id. */
  id: string;
  file: string;
  report: AuditReport;
}

export interface TrendPoint {
  label: string;
  generatedAt: string;
  tokenAdoption: number | null;
  componentAdoption: number | null;
  hardcoded: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** A report this page can render: schema version 1 with metrics. */
export function isAuditReport(x: unknown): x is AuditReport {
  return isObj(x) && x.schemaVersion === 1 && isObj(x.metrics) && typeof x.generatedAt === 'string' && Array.isArray(x.files);
}

/** Valid reports from a { path: json } map, newest first. */
export function parseAudits(modules: Record<string, unknown>): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const data = isObj(mod) && 'default' in mod ? mod.default : mod;
    if (!isAuditReport(data)) continue;
    const file = path.split('/').pop() ?? path;
    out.push({ id: file.replace(/\.json$/, '').replace(/[^\w-]/g, '-'), file, report: data });
  }
  return out.sort((a, b) => b.report.generatedAt.localeCompare(a.report.generatedAt));
}

/** Every committed report under AUDITS_DIR. Unreadable JSON is skipped. */
export function loadAudits(): AuditEntry[] {
  const modules: Record<string, unknown> = {};
  for (const f of listDir(AUDITS_DIR).filter((n) => n.endsWith('.json'))) {
    try {
      modules[`${AUDITS_DIR}/${f}`] = readJson(`${AUDITS_DIR}/${f}`);
    } catch {
      /* not JSON: ignored */
    }
  }
  return parseAudits(modules);
}

const fromHistory = (h: HistoryPoint): TrendPoint => ({
  label: h.label ?? h.generatedAt.slice(0, 10),
  generatedAt: h.generatedAt,
  tokenAdoption: h.tokenAdoption,
  componentAdoption: h.componentAdoption,
  hardcoded: h.hardcoded,
});

/** Trend over runs: each report's history plus the reports themselves, deduplicated by date, oldest first. */
export function trendPoints(reports: AuditReport[]): TrendPoint[] {
  const byDate = new Map<string, TrendPoint>();
  for (const r of reports) {
    for (const h of r.history ?? []) if (!byDate.has(h.generatedAt)) byDate.set(h.generatedAt, fromHistory(h));
    byDate.set(r.generatedAt, {
      label: r.label ?? r.generatedAt.slice(0, 10),
      generatedAt: r.generatedAt,
      tokenAdoption: r.metrics.tokenAdoption,
      componentAdoption: r.metrics.componentAdoption,
      hardcoded: r.metrics.hardcoded,
    });
  }
  return [...byDate.values()].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  color: 'Color',
  spacing: 'Spacing',
  size: 'Size',
  radius: 'Radius',
  'border-width': 'Border width',
  shadow: 'Shadow',
  duration: 'Duration',
  easing: 'Easing',
  'z-index': 'Z-index',
  'font-family': 'Font family',
  'font-size': 'Font size',
  'font-weight': 'Font weight',
  'line-height': 'Line height',
};

export interface CategoryRow {
  key: FindingCategory;
  label: string;
  hardcoded: number;
  exact: number;
  /** Suggested but not exact. */
  near: number;
  /** No token suggestion. */
  none: number;
}

/** By-category rows, largest first. */
export function categoryRows(r: AuditReport): CategoryRow[] {
  return Object.entries(r.byCategory)
    .filter((e): e is [FindingCategory, NonNullable<(typeof e)[1]>] => !!e[1] && e[1].hardcoded > 0)
    .map(([key, c]) => {
      const exact = Math.min(c.exact, c.hardcoded);
      const suggested = Math.min(Math.max(c.suggested, exact), c.hardcoded);
      return { key, label: CATEGORY_LABELS[key] ?? key, hardcoded: c.hardcoded, exact, near: suggested - exact, none: c.hardcoded - suggested };
    })
    .sort((a, b) => b.hardcoded - a.hardcoded);
}

export interface ComponentBreakdown {
  ds: number;
  foreign: number;
  native: number;
  recreated: number;
  total: number;
  libraries: { name: string; instances: number; top: { name: string; count: number }[] }[];
  dsTop: { name: string; count: number }[];
  nativeTop: { name: string; count: number }[];
}

const topOf = (m: Record<string, number>, n: number) =>
  Object.entries(m)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function componentBreakdown(r: AuditReport, topN = 5): ComponentBreakdown {
  const c = r.components;
  const ds = sum(Object.values(c.ds));
  const foreign = sum(Object.values(c.foreign).map((l) => l.instances));
  const native = sum(Object.values(c.native));
  // Re-created instances are what the metrics count beyond DS, foreign and native (a shadcn/ui Button is
  // already a foreign instance; `recreated[].instances` also counts those, so it is not summed here).
  const total = Math.max(r.metrics.uiComponentInstances, ds + foreign + native);
  const recreated = total - ds - foreign - native;
  return {
    ds,
    foreign,
    native,
    recreated,
    total,
    libraries: Object.entries(c.foreign)
      .map(([name, l]) => ({ name, instances: l.instances, top: topOf(l.components, topN) }))
      .sort((a, b) => b.instances - a.instances),
    dsTop: topOf(c.ds, topN),
    nativeTop: topOf(c.native, 10),
  };
}

/** Tone of an adoption percentage: pass from 80, warn from 50. */
export const adoptionTone = (pct: number | null): 'pass' | 'warn' | 'fail' | 'none' => (pct === null ? 'none' : pct >= 80 ? 'pass' : pct >= 50 ? 'warn' : 'fail');

export const formatPct = (pct: number | null) => (pct === null ? 'n/a' : `${Math.round(pct * 10) / 10}%`);

export const formatDelta = (d: number | null | undefined) => (d === null || d === undefined ? '' : `${d > 0 ? '+' : d < 0 ? '-' : ''}${Math.abs(Math.round(d * 10) / 10)}`);
