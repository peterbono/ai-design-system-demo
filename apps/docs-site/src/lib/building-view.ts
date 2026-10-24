// Studio "Being built" (pages/studio/building.astro, its team shell, components/ds/studio/BeingBuilt.tsx): the pure
// rules behind the page, its detail, the home line and the Library "Figma is ahead" line. The status of each build
// request comes from @bridge-ds/core (build-requests.ts, docs/BUILD-REQUESTS.md); this file turns GitHub's REST shapes
// into what core reads, and core's views into rows and words a designer reads. No DOM, no fetch: building-view.test.ts.
//
// Read only: developers split and track the work in GitHub or Jira, Bridge never writes to a build request.
import {
  BUILD_FILTER_LABEL,
  BUILD_STEPS,
  BUILD_STATUS_LABEL,
  buildRequestBrief,
  matchesBuildFilter,
  parseBuildRequestIssue,
  parseBuildSpec,
  requestIssueTitle,
  type BuildFilter,
  type BuildIssueLike,
  type BuildProp,
  type BuildPullLike,
  type BuildRequestView,
  type BuildStatus,
} from '@bridge-ds/core';
import { daysSince, type PillTone } from './home-model';

/** The fields of a GitHub issue the page reads (GET /repos/{o}/{r}/issues). */
export interface RestIssue {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: string;
  state_reason?: string | null;
  labels: ({ name?: string } | string)[];
  user?: { login: string } | null;
  assignees?: { login: string }[] | null;
  created_at: string;
  closed_at?: string | null;
  pull_request?: unknown;
}

/** The fields of a pull request the page reads (GET /repos/{o}/{r}/pulls). */
export interface RestPull {
  number: number;
  title?: string;
  body?: string | null;
  html_url: string;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  created_at?: string;
  updated_at?: string;
  labels?: ({ name?: string } | string)[] | null;
  user?: { login: string } | null;
  assignees?: { login: string }[] | null;
  head?: { ref: string } | null;
}

const labelNames = (labels: readonly ({ name?: string } | string)[] | null | undefined) => (labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);

export function toBuildIssue(i: RestIssue): BuildIssueLike {
  return {
    number: Number(i.number),
    url: i.html_url,
    title: i.title,
    body: i.body ?? '',
    state: i.state === 'closed' ? 'closed' : 'open',
    stateReason: i.state_reason ?? null,
    labels: labelNames(i.labels),
    author: i.user?.login,
    assignees: (i.assignees ?? []).map((a) => a.login),
    createdAt: i.created_at,
    closedAt: i.closed_at ?? null,
  };
}

export function toBuildPull(p: RestPull): BuildPullLike {
  return {
    number: Number(p.number),
    url: p.html_url,
    title: p.title,
    body: p.body ?? '',
    state: p.merged_at ? 'merged' : p.state,
    draft: Boolean(p.draft),
    mergedAt: p.merged_at ?? null,
    labels: labelNames(p.labels),
    author: p.user?.login,
    assignees: (p.assignees ?? []).map((a) => a.login),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    headRef: p.head?.ref,
  };
}

/** Only what the page reads is kept in the session cache; issue bodies stay (the detail reads them). */
export const slimIssue = (i: RestIssue): RestIssue => ({
  number: Number(i.number),
  title: i.title,
  body: i.body ?? '',
  html_url: i.html_url,
  state: i.state,
  state_reason: i.state_reason ?? null,
  labels: labelNames(i.labels),
  user: i.user ? { login: i.user.login } : null,
  assignees: (i.assignees ?? []).map((a) => ({ login: a.login })),
  created_at: i.created_at,
  closed_at: i.closed_at ?? null,
  ...(i.pull_request ? { pull_request: true } : {}),
});

/** A pull request body only matters for its closing references and its "From Figma" block: kept whole when short. */
export const slimPull = (p: RestPull): RestPull => ({
  number: Number(p.number),
  title: p.title,
  body: (p.body ?? '').length > 4000 ? (p.body ?? '').slice(0, 4000) : (p.body ?? ''),
  html_url: p.html_url,
  state: p.state,
  draft: Boolean(p.draft),
  merged_at: p.merged_at ?? null,
  created_at: p.created_at,
  updated_at: p.updated_at,
  labels: labelNames(p.labels),
  user: p.user ? { login: p.user.login } : null,
  assignees: (p.assignees ?? []).map((a) => ({ login: a.login })),
  head: p.head ? { ref: p.head.ref } : null,
});

// ---------------------------------------------------------------------------------------------------------------
// Rows

export const BUILD_FILTERS: { value: BuildFilter; label: string }[] = (['all', 'waiting', 'in-progress', 'shipped-this-week'] as const).map((value) => ({ value, label: BUILD_FILTER_LABEL[value] }));

/** The one tag of a row. Only a stale request is highlighted; shipped is the only green. */
export function statusTag(v: Pick<BuildRequestView, 'status' | 'label' | 'stale'>): { label: string; tone: PillTone | 'info' } {
  const tone: Record<BuildStatus, PillTone | 'info'> = { requested: 'neutral', 'picked-up': 'info', 'in-progress': 'info', 'in-review': 'info', shipped: 'success', 'not-planned': 'neutral' };
  return { label: v.label, tone: v.stale ? 'warning' : tone[v.status] };
}

/** "Today", "1 day", "9 days": how long a request has existed. */
export function ageLabel(createdAt: string, now: number): string {
  const d = daysSince(createdAt, now);
  return d === 0 ? 'Today' : `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** The address of a build request's detail, in place on the page. */
export const detailQuery = (v: Pick<BuildRequestView, 'kind' | 'number'>) => `?${v.kind === 'pull' ? 'pull' : 'request'}=${v.number}`;

/** Which build request the address opens, or null. */
export function detailFromQuery(search: string): { kind: 'issue' | 'pull'; number: number } | null {
  const q = new URLSearchParams(search);
  const r = Number(q.get('request'));
  if (Number.isInteger(r) && r > 0) return { kind: 'issue', number: r };
  const p = Number(q.get('pull'));
  if (Number.isInteger(p) && p > 0) return { kind: 'pull', number: p };
  return null;
}

/** The counts on the filters: "In progress 3". */
export function filterCounts(views: readonly BuildRequestView[], now: number): Record<BuildFilter, number> {
  const out = { all: 0, waiting: 0, 'in-progress': 0, 'shipped-this-week': 0 } as Record<BuildFilter, number>;
  for (const f of Object.keys(out) as BuildFilter[]) out[f] = views.filter((v) => matchesBuildFilter(v, f, now)).length;
  return out;
}

/** The sentence under the page title. */
export function pageSentence(views: readonly BuildRequestView[]): string {
  const open = views.filter((v) => v.status !== 'shipped' && v.status !== 'not-planned');
  const stale = open.filter((v) => v.stale).length;
  if (!views.length) return 'Nothing is being built yet.';
  if (!open.length) return 'Everything sent from Figma is in the library.';
  const waiting = open.filter((v) => v.status === 'requested').length;
  const building = open.length - waiting;
  const parts = [...(building ? [`${building} being built`] : []), ...(waiting ? [`${waiting} waiting for a developer`] : [])];
  return `${parts.join(', ')}${stale ? `, ${stale} for more than a week` : ''}.`.replace(/^./, (c) => c.toUpperCase());
}

/** What a filter with nothing in it says. */
export const EMPTY_FILTER: Record<BuildFilter, string> = {
  all: 'Nothing is being built.',
  waiting: 'Every build request has been picked up.',
  'in-progress': 'Nothing is in progress right now.',
  'shipped-this-week': 'Nothing shipped this week yet.',
};

/** The empty state: what a build request is, where it comes from, who picks it up. */
export const EMPTY_WORDS = {
  title: 'Nothing is being built yet.',
  text: 'When you push a change from the Bridge Figma plugin that needs code, like a new variant, a new option or a new layout, it becomes a build request. Developers pick it up where they work, in GitHub or Jira, and you follow it here until it is in the library.',
  more: 'Token values ship by themselves after the automatic checks, so they never wait here.',
};

// ---------------------------------------------------------------------------------------------------------------
// Detail

export interface BuildTimelineStep {
  status: BuildStatus;
  label: string;
  reached: boolean;
  current: boolean;
  at?: string | undefined;
  who?: string | undefined;
}

/** Every step of the line, reached or not, with who and when when GitHub said. Not planned replaces the steps after Requested. */
export function timelineSteps(v: Pick<BuildRequestView, 'status' | 'timeline'>): BuildTimelineStep[] {
  if (v.status === 'not-planned') {
    return v.timeline.map((e, i, all) => ({ status: e.status, label: BUILD_STATUS_LABEL[e.status], reached: true, current: i === all.length - 1, at: e.at, who: e.who }));
  }
  return BUILD_STEPS.map((s) => {
    const e = v.timeline.find((x) => x.status === s);
    return { status: s, label: BUILD_STATUS_LABEL[s], reached: Boolean(e), current: s === v.status, at: e?.at, who: e?.who };
  });
}

export interface BuildDetail {
  summary: string;
  line: string | null;
  before: string[];
  after: string[];
  props: BuildProp[];
  changes: { field: string; before?: string | undefined; after?: string | undefined }[];
  figmaUrl: string | null;
  figmaName: string | null;
  /** The brief for Claude, with the issue number. Null for a library branch from Figma (its brief lives on the branch). */
  brief: string | null;
  hasSpec: boolean;
}

/** What was sent, read back from the issue body (a build request or a plain component change request). */
export function buildDetail(body: string | null | undefined, v: Pick<BuildRequestView, 'kind' | 'number' | 'url'>): BuildDetail | null {
  const r = parseBuildRequestIssue(body);
  if (!r) return null;
  return {
    summary: r.summary.trim(),
    line: r.line?.trim() || null,
    before: r.build.before ?? [],
    after: r.build.after ?? r.images ?? [],
    props: r.build.props ?? [],
    changes: r.changes,
    figmaUrl: r.figma?.url ?? null,
    figmaName: r.figma?.nodeName ?? null,
    brief: v.kind === 'issue' ? buildRequestBrief(r, { issue: v.number, issueUrl: v.url }) : null,
    hasSpec: parseBuildSpec(body) !== undefined,
  };
}

/** "Add `size` (variant): sm, md, lg. Default md." in plain words for the designer. */
export function propLine(p: BuildProp): string {
  const what = p.change === 'removed' ? 'Remove' : p.change === 'changed' ? 'Change' : 'Add';
  const values = p.values?.length ? `: ${p.values.join(', ')}` : '';
  const def = p.default ? `. Default ${p.default}` : '';
  return `${what} ${p.name}${p.type ? ` (${p.type})` : ''}${values}${def}.`;
}

/** The Jira link of a key, from integrations.jira.baseUrl, or null. */
export function jiraLink(key: string | null | undefined, baseUrl: string | null | undefined): string | null {
  if (!key || !baseUrl || !/^https:\/\//.test(baseUrl)) return null;
  return `${baseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`;
}

/** The date of a timeline step: "Oct 21". */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** The session cache key of a list read. */
export const buildCacheKey = (repo: string, what: 'requests' | 'builds' | 'pulls') => `bridge.building.${what}:${repo.toLowerCase()}`;

/** A cached list is fresh for 5 minutes. */
export const BUILD_CACHE_MS = 5 * 60 * 1000;

/** Line 2 of a row: when it was sent, then who builds it ("Sent 4 days ago · Ana is on it"). */
export function rowLine(v: Pick<BuildRequestView, 'status' | 'createdAt' | 'stale' | 'sentence' | 'shippedAt' | 'builders'>, now: number, nameOf: (login: string) => string = (l) => l): string {
  const d = daysSince(v.createdAt, now);
  const sent = d === 0 ? 'Sent today' : `Sent ${d} ${d === 1 ? 'day' : 'days'} ago`;
  if (v.status === 'requested') return v.stale ? 'Nobody has picked it up yet' : sent;
  if (v.status === 'shipped') {
    const s = v.shippedAt ? daysSince(v.shippedAt, now) : null;
    return s === null ? 'In the library' : s === 0 ? 'Shipped today' : `Shipped ${s} ${s === 1 ? 'day' : 'days'} ago`;
  }
  if (v.status === 'in-review') return `${sent} · ${v.builders.length ? `Built by ${v.builders.map(nameOf).join(' and ')}` : 'Built'}, in code review`;
  return `${sent} · ${v.sentence.replace(/\.$/, '')}`;
}

/** The title of a row and of the detail: "Button: add a lg size", the same words as the issue on GitHub. */
export const viewTitle = (v: Pick<BuildRequestView, 'component' | 'title'>) => (v.component ? requestIssueTitle({ component: v.component, title: v.title }) : v.title);
