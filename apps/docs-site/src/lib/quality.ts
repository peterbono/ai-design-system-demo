// Studio Quality: the pure rules behind the one Quality page (it replaced Checks and Adoption). No file reads: the
// page passes the dashboard numbers, the components' guidance state and the audit reports in; quality.test.ts
// covers the ordering, the opener sentence and the first finding.
//
// One list of findings, most severe first: fail, then warn, then notes, then what passes. Color means status
// (lib/changes.ts): red blocked, violet waiting, green ready, grey the rest.
import type { StatusGroup } from './changes';
import type { GuidanceState } from './components';
import type { Issue } from './stats';

export type Severity = 'fail' | 'warn' | 'note' | 'pass';

const RANK: Record<Severity, number> = { fail: 0, warn: 1, note: 2, pass: 3 };

export interface ComboResult {
  label: string;
  pass: number;
  total: number;
}

export interface Finding {
  id: string;
  kind: 'contrast' | 'guidance' | 'validation';
  severity: Severity;
  title: string;
  detail?: string;
  /** The status pill: a word and its group (the group picks the color). */
  status: { label: string; group: StatusGroup };
  action?: { label: string; href: string };
  /** Contrast only: one row per brand and theme. */
  combos?: ComboResult[];
}

export interface ContrastInput {
  total: number;
  fail: number;
  combos: ComboResult[];
}

export interface GuidanceInput {
  name: string;
  slug: string;
  state: GuidanceState;
  /** Where its docs.json would live, for the missing case. */
  docsPath: string;
}

export interface QualityInput {
  contrast: ContrastInput;
  components: GuidanceInput[];
  /** dashboard().issues: contrast and guidance issues are rebuilt here, unused tokens go to the clean-up group. */
  issues: Issue[];
  /** Docs editor link for a component slug. */
  editHref: (slug: string) => string;
}

export interface QualityModel {
  findings: Finding[];
  /** Unused tokens and other housekeeping, collapsed under "Clean up (N)". */
  cleanup: Issue[];
}

export const CONTRAST_GRID = '/foundations/accessibility/';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function contrastFinding(c: ContrastInput): Finding {
  const ok = c.fail === 0;
  return {
    id: 'contrast',
    kind: 'contrast',
    severity: ok ? 'pass' : 'fail',
    title: ok ? `All ${c.total} contrast checks pass` : `${c.fail} of ${c.total} contrast checks fail`,
    detail: ok ? `${c.combos.length} brand and theme combinations, AA everywhere.` : 'The token build is blocked until they pass.',
    status: ok ? { label: 'Passing', group: 'ready' } : { label: 'Blocking', group: 'blocked' },
    action: { label: ok ? 'Full contrast grid' : 'See the failing pairs', href: CONTRAST_GRID },
    combos: c.combos,
  };
}

/** Every finding, most severe first; inside a severity, the order they were given in. */
export function sortFindings(list: Finding[]): Finding[] {
  return list
    .map((f, i) => ({ f, i }))
    .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
}

export function qualityModel(input: QualityInput): QualityModel {
  const guidance: Finding[] = input.components
    .filter((c) => c.state !== 'ok')
    .map((c) =>
      c.state === 'missing'
        ? {
            id: `guidance-${c.slug}`,
            kind: 'guidance' as const,
            severity: 'warn' as const,
            title: `${c.name} has no usage guidance`,
            detail: `Its page shows props and tokens only. Write ${c.docsPath}.`,
            status: { label: 'Missing guidance', group: 'neutral' as const },
            action: { label: 'Add guidance', href: input.editHref(c.slug) },
          }
        : {
            id: `guidance-${c.slug}`,
            kind: 'guidance' as const,
            severity: 'warn' as const,
            title: `${c.name} guidance is a draft`,
            detail: 'Drafted from its code. A reviewer accepts it or edits it.',
            status: { label: 'Draft by Claude, needs review', group: 'waiting' as const },
            action: { label: 'Review', href: input.editHref(c.slug) },
          },
    );
  const other: Finding[] = input.issues
    .filter((i) => i.kind === 'unknown-ref' || i.kind === 'deprecated')
    .map((i, n) => ({
      id: `issue-${n}`,
      kind: 'validation' as const,
      severity: i.severity === 'fail' ? ('fail' as const) : i.severity === 'warn' ? ('warn' as const) : ('note' as const),
      title: i.title,
      detail: i.detail,
      status: i.severity === 'fail' ? { label: 'Fix', group: 'blocked' as const } : { label: 'Review', group: 'neutral' as const },
      action: { label: 'Open', href: i.href },
    }));
  return {
    findings: sortFindings([contrastFinding(input.contrast), ...other, ...guidance]),
    cleanup: input.issues.filter((i) => i.kind === 'unused'),
  };
}

/** The opener: one sentence on the state of the system, the most severe news first. */
export function openerSentence(c: ContrastInput, components: Pick<GuidanceInput, 'state'>[], findings: Finding[]): string {
  const missing = components.filter((x) => x.state === 'missing').length;
  const review = components.filter((x) => x.state === 'review').length;
  const parts: string[] = [c.fail ? `${c.fail} of ${c.total} contrast checks fail, so the token build is blocked.` : `All ${c.total} contrast checks pass.`];
  const others = findings.filter((f) => f.kind === 'validation' && (f.severity === 'fail' || f.severity === 'warn')).length;
  if (others) parts.push(`${plural(others, 'token finding needs', 'token findings need')} a fix.`);
  if (missing && review) parts.push(`${plural(missing, 'component needs', 'components need')} guidance and ${plural(review, 'docs draft needs', 'docs drafts need')} review.`);
  else if (missing) parts.push(`${plural(missing, 'component needs', 'components need')} guidance.`);
  else if (review) parts.push(`${plural(review, 'docs draft needs', 'docs drafts need')} review.`);
  if (parts.length === 1 && !c.fail) parts.push('Nothing needs you.');
  return parts.join(' ');
}

/** The primary of the opener: the action of the most severe open finding, or the contrast grid when all is clean. */
export function firstFindingTarget(findings: Finding[]): { label: string; href: string } {
  const open = findings.find((f) => (f.severity === 'fail' || f.severity === 'warn') && f.action);
  return open ? { label: 'Fix the first finding', href: open.action!.href } : { label: 'Open the contrast grid', href: CONTRAST_GRID };
}

// ---------------------------------------------------------------------------------------------------------------
// Adoption summary

export interface AdoptionRow {
  id: string;
  label: string;
  token: { from: number | null; to: number | null };
  component: { from: number | null; to: number | null };
  /** The newest report of the app, on its own route. */
  href: string;
}

export const APP_SHORT: Record<string, string> = { admin: 'Admin demo', 'bridge-site': 'Bridge itself' };

export const auditHref = (id: string) => `/studio/quality/audits/${id}/`;

interface Metrics {
  tokenAdoption: number | null;
  componentAdoption: number | null;
}
interface AppGroup {
  app: { id: string; title: string };
  reports: { id: string }[];
  before?: { report: { metrics: Metrics } };
  after?: { id: string; report: { metrics: Metrics } };
}

export function adoptionRows(apps: AppGroup[]): AdoptionRow[] {
  return apps.map(({ app, reports, before, after }) => ({
    id: app.id,
    label: APP_SHORT[app.id] ?? app.title,
    token: { from: before?.report.metrics.tokenAdoption ?? null, to: after?.report.metrics.tokenAdoption ?? null },
    component: { from: before?.report.metrics.componentAdoption ?? null, to: after?.report.metrics.componentAdoption ?? null },
    href: auditHref(after?.id ?? reports[reports.length - 1]!.id),
  }));
}
