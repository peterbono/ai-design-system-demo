// Studio Quality: the pure rules behind the one Quality page (it replaced Checks and Adoption). No file reads: the
// page passes the dashboard numbers, the components' guidance state and the audit reports in; quality.test.ts
// covers the ordering, the opener sentence and the first finding.
//
// One list of findings, most severe first: fail, then warn, then notes, then what passes. Color means status
// (lib/changes.ts): red blocked, violet waiting, green ready, grey the rest.
import type { StatusGroup } from './changes';
import type { GuidanceState } from './components';
import type { Issue } from './stats';
import { studioHref } from './team-path';

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
  /** Where its docs.json would live (developer detail, not shown on the Quality page). */
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
  /** Unused tokens and other housekeeping, collapsed under one line titled by cleanupTitle(). */
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
            detail: 'Its page shows props and tokens only. Add guidance in the docs editor.',
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
// Adoption, in plain words. Every number comes from the committed `bridge audit` reports (lib/audits). The current
// value leads; the baseline (the product before it moved to Bridge) is a quiet secondary phrase.

export interface AdoptionRow {
  id: string;
  label: string;
  /** `to` is the newest run, `from` the run before the move to Bridge (null when the product has one run). */
  token: { from: number | null; to: number | null };
  component: { from: number | null; to: number | null };
  /** The newest report of the app, on its own route. */
  href: string;
}

export const APP_SHORT: Record<string, string> = { admin: 'Admin demo', 'bridge-site': 'Bridge itself' };

export const auditHref = (id: string) => studioHref(`quality/audits/${id}/`);

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
  return apps.map(({ app, reports, before, after }) => {
    // One run only: it is the current value, there is no baseline to compare with.
    const now = after ?? before;
    const base = after ? before : undefined;
    return {
      id: app.id,
      label: APP_SHORT[app.id] ?? app.title,
      token: { from: base?.report.metrics.tokenAdoption ?? null, to: now?.report.metrics.tokenAdoption ?? null },
      component: { from: base?.report.metrics.componentAdoption ?? null, to: now?.report.metrics.componentAdoption ?? null },
      href: auditHref(after?.id ?? reports[reports.length - 1]!.id),
    };
  });
}

/** What adoption means, said once per page. */
export const ADOPTION_MEANING = 'Adoption is the share of colors, sizes and components in a product that come from the design system.';

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 10) / 10}%`);
const points = (d: number) => {
  const n = Math.round(Math.abs(d) * 10) / 10;
  return `${n} ${n === 1 ? 'point' : 'points'}`;
};

/** The quiet baseline label under a current value: "Before Bridge: 0%", or null when there is no baseline. */
export function beforeLabel(from: number | null): string | null {
  return from === null ? null : `Before Bridge: ${pct(from)}`;
}

/** Token metric in one sentence: "100% of styling values come from tokens (445 uses, no hard-coded value)." */
export function tokenSentence(m: { tokenAdoption: number | null; tokenUsages: number; hardcoded: number }, past = false): string {
  const left = m.hardcoded === 0 ? 'no hard-coded value' : `${plural(m.hardcoded, 'hard-coded value')}${past ? '' : ' left'}`;
  return `${pct(m.tokenAdoption)} of styling values ${past ? 'came' : 'come'} from tokens (${plural(m.tokenUsages, 'use')}, ${left}).`;
}

/** Component metric in one sentence: "90.2% of components come from the design system (239 of 265)." */
export function componentSentence(m: { componentAdoption: number | null; dsComponentInstances: number; uiComponentInstances: number }, past = false): string {
  return `${pct(m.componentAdoption)} of components ${past ? 'came' : 'come'} from the design system (${m.dsComponentInstances} of ${m.uiComponentInstances}).`;
}

/**
 * What the baseline is, in plain words. The run before the move gets the product's own note ("original Material UI
 * version"); any other baseline is named by its date.
 */
export function baselineSince(isBeforeRun: boolean, note: string | undefined, date: string): string {
  if (!isBeforeRun) return `the run of ${date}`;
  return note ? `before the move to Bridge (${note})` : 'before the move to Bridge';
}

/** "Up 100 points since before the move to Bridge (original Material UI version)." Null without a delta. */
export function deltaPhrase(delta: number | null | undefined, since: string): string | null {
  if (delta === null || delta === undefined) return null;
  if (Math.round(delta * 10) === 0) return `Same as ${since}.`;
  return `${delta > 0 ? 'Up' : 'Down'} ${points(delta)} since ${since}.`;
}

/**
 * The one summary sentence of an adoption report: "100% of styling values and 90.2% of components come from the design system,
 * up from 0% before the move." Without a baseline the tail is left out; `past` describes the run before the move.
 */
export function adoptionSummary(now: Metrics, before: Metrics | null, past = false): string {
  const head = `${pct(now.tokenAdoption)} of styling values and ${pct(now.componentAdoption)} of components ${past ? 'came' : 'come'} from the design system`;
  if (past) return `${head} before the move.`;
  if (!before) return `${head}.`;
  const a = pct(before.tokenAdoption);
  const b = pct(before.componentAdoption);
  return `${head}, up from ${a === b ? a : `${a} and ${b}`} before the move.`;
}

export interface SourceSegment {
  key: 'ds' | 'foreign' | 'native' | 'recreated';
  label: string;
  count: number;
}

/** The legend of the component bar, in the bar's order, empty sources left out. */
export function componentSources(b: { ds: number; foreign: number; native: number; recreated: number }): SourceSegment[] {
  const all: SourceSegment[] = [
    { key: 'ds', label: 'Bridge', count: b.ds },
    { key: 'foreign', label: 'Other libraries', count: b.foreign },
    { key: 'native', label: 'Plain HTML elements', count: b.native },
    { key: 'recreated', label: 'Look-alikes of Bridge components', count: b.recreated },
  ];
  return all.filter((s) => s.count > 0);
}

/** The hard-coded values line: one success line when none is left. */
export function hardcodedLine(total: number, exact: number, past = false): string {
  if (total === 0) return past ? 'No hard-coded value.' : 'No hard-coded value left.';
  const head = past ? plural(total, 'hard-coded value') : `${plural(total, 'hard-coded value')} left`;
  return `${head}, ${exact} ${exact === 1 ? 'matches' : 'match'} a token exactly.`;
}

/** Labels under the trend chart: the run before the move is "Before Bridge", the newest "Now", the others their date. */
export function trendLabels(runs: { generatedAt: string }[], beforeAt: string | undefined, fmt: (iso: string) => string): string[] {
  return runs.map((p, i) =>
    beforeAt && p.generatedAt === beforeAt ? 'Before Bridge' : i === runs.length - 1 && runs.length > 1 ? 'Now' : fmt(p.generatedAt),
  );
}

/** The clean-up line: the real number of unused tokens (semantic plus primitives), not the number of groups. */
export function cleanupTitle(unused: number): string {
  return unused === 0 ? 'No unused tokens' : plural(unused, 'unused token');
}
