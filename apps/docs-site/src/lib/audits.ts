// Adoption page data: `bridge audit` reports committed under src/data/audits/*.json.
// Pure helpers take report objects (tested in audits.test.ts); only loadAudits() reads files.
import { listDir, readJson } from './repo';
import type { AuditReport, FindingCategory, HistoryPoint } from '@bridge-ds/core/audit';

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

/** An audited app: its reports share a file prefix under AUDITS_DIR (`admin-before.json`, `admin-after.json`). */
export interface AuditApp {
  id: string;
  title: string;
  /** One line under the title: what was audited and what changed. */
  summary: string;
  /** What the audit does not see for this app, said plainly. */
  note?: string;
  /** What the run before the move to Bridge measured, in plain words (shown after "before the move to Bridge"). */
  baselineNote?: string;
  prefix: string;
}

/** Apps shown side by side on the Adoption page, in order. Reports matching no app are listed after them. */
export const AUDIT_APPS: AuditApp[] = [
  {
    id: 'admin',
    title: 'Admin demo (react-admin, migrated from MUI)',
    summary: 'A real back office moved from Material UI to Bridge tokens and components.',
    // admin-before.json scans apps/admin/_original: the react-admin demo as published, built on Material UI.
    baselineNote: 'original Material UI version',
    prefix: 'admin-',
  },
  {
    id: 'bridge-site',
    title: 'Bridge itself (dogfooding)',
    summary: 'This docs app, rebuilt on the design system it documents: chrome on the bridge brand tokens, controls from @bridge-ds/react.',
    note: 'The audit reads CSS, TS and TSX. Astro templates and HTML strings built by scripts are not scanned: native disclosures, the search dialog, a few range and checkbox inputs and script-built rows in Reviews, History and the token explorer still live there. They are listed in apps/admin/DS-GAPS.md.',
    // bridge-site-before.json scans apps/docs-site/src before the site was rebuilt on its own design system.
    baselineNote: 'the docs site before its rebuild',
    prefix: 'bridge-site-',
  },
];

export interface AppAudits {
  app: AuditApp;
  /** Reports of the app, oldest first. */
  reports: AuditEntry[];
  /** The `-before` report, else the oldest. */
  before?: AuditEntry;
  /** The `-after` report, else the newest (undefined when the app has a single report). */
  after?: AuditEntry;
}

/** Groups reports by app (file prefix). Apps without any report are left out. */
export function groupByApp(entries: AuditEntry[], apps: AuditApp[] = AUDIT_APPS): { apps: AppAudits[]; other: AuditEntry[] } {
  const used = new Set<AuditEntry>();
  const out: AppAudits[] = [];
  for (const app of apps) {
    const reports = entries.filter((e) => e.file.startsWith(app.prefix)).sort((a, b) => a.report.generatedAt.localeCompare(b.report.generatedAt));
    if (!reports.length) continue;
    reports.forEach((e) => used.add(e));
    const before = reports.find((e) => e.id.endsWith('-before')) ?? reports[0];
    const afterNamed = reports.find((e) => e.id.endsWith('-after'));
    const after = afterNamed ?? (reports.length > 1 ? reports[reports.length - 1] : undefined);
    out.push({ app, reports, before, after: after === before ? undefined : after });
  }
  return { apps: out, other: entries.filter((e) => !used.has(e)) };
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
