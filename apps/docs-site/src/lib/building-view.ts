// Studio "Being built" (pages/studio/building.astro, its team shell, components/ds/studio/BeingBuilt.tsx): the pure
// rules behind the page, its detail, the home line and the Library "Figma is ahead" line. The status of each build
// request comes from @bridge-ds/core (build-requests.ts, docs/BUILD-REQUESTS.md); this file turns GitHub's REST shapes
// into what core reads, and core's views into rows and words a designer reads. No DOM, no fetch: building-view.test.ts.
//
// Read only: developers split and track the work in GitHub or Jira, Bridge never writes to a build request.
import {
  BUILD_FILTER_LABEL,
  BUILD_STALE_DAYS,
  EXPLORATION_STATUS_LABEL,
  explorationStatus,
  isArchivedExploration,
  isExplorationPull,
  parseExplorationBody,
  type ProductConfig,
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
import type { ThumbSpec } from './branch-thumb';
import { daysSince, type PillTone } from './home-model';
import { safeUrl } from './html';
import { isProductBranch } from './product-branch';
import { explorationHref } from './explorations-view';

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
  closed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  labels?: ({ name?: string } | string)[] | null;
  user?: { login: string } | null;
  assignees?: { login: string }[] | null;
  head?: { ref: string; sha?: string } | null;
  base?: { ref: string; sha?: string } | null;
  /** Read in a product's own repository (scripts/product-repos.ts): that product's key. */
  product?: string;
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
    closedAt: p.closed_at ?? null,
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

const EXPLORATION_BLOCK = /<!-- bridge-exploration \{[\s\S]*?\} -->/;

/**
 * A pull request body only matters for its closing references, its "From Figma" block and an exploration's block
 * (its name and when it was done exploring): kept whole when short, else its start and the exploration block.
 */
function slimBody(body: string | null | undefined): string {
  const b = body ?? '';
  if (b.length <= 4000) return b;
  const m = EXPLORATION_BLOCK.exec(b);
  if (!m || m.index + m[0].length <= 4000) return b.slice(0, 4000);
  return `${b.slice(0, Math.min(4000, m.index)).trim()}\n\n${m[0]}`;
}

export const slimPull = (p: RestPull): RestPull => ({
  number: Number(p.number),
  title: p.title,
  body: slimBody(p.body),
  html_url: p.html_url,
  state: p.state,
  draft: Boolean(p.draft),
  merged_at: p.merged_at ?? null,
  closed_at: p.closed_at ?? null,
  created_at: p.created_at,
  updated_at: p.updated_at,
  labels: labelNames(p.labels),
  user: p.user ? { login: p.user.login } : null,
  assignees: (p.assignees ?? []).map((a) => ({ login: a.login })),
  // The head commit: an exploration done exploring reads "Being built" once developers pushed past it.
  head: p.head ? { ref: p.head.ref, ...(p.head.sha ? { sha: p.head.sha } : {}) } : null,
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

const ROW_ORDER: Record<BuildStatus, number> = { requested: 0, 'picked-up': 1, 'in-progress': 2, 'in-review': 3, shipped: 4, 'not-planned': 5 };

/**
 * One list: the build requests and the rows of Claude's fixes (lib/claude-connector fixRows), in the order core gives
 * build requests (what waits longest first, then work in flight, then shipped, newest first). A fix whose pull request
 * already reads as a build request is not listed twice.
 */
export function mergeRows<V extends BuildRequestView>(views: readonly BuildRequestView[], fixes: readonly V[]): (BuildRequestView | V)[] {
  const pulls = new Set(views.filter((v) => v.kind === 'pull').map((v) => v.number));
  const own = fixes.filter((f) => !f.pull || !pulls.has(f.pull.number));
  return [...views, ...own].sort((a, b) => ROW_ORDER[a.status] - ROW_ORDER[b.status] || (a.status === 'shipped' ? String(b.shippedAt).localeCompare(String(a.shippedAt)) : a.createdAt.localeCompare(b.createdAt)));
}

/**
 * What the page lists: every row "All" shows (a request closed as not planned leaves a week after it was closed). The
 * sentence, the empty state and the counts read these rows, never the ones that left.
 */
export const listedRows = <V extends BuildRequestView>(rows: readonly V[], now: number): V[] => rows.filter((v) => matchesBuildFilter(v, 'all', now));

/** The counts on the filters: "In progress 3". */
export function filterCounts(views: readonly BuildRequestView[], now: number): Record<BuildFilter, number> {
  const out = { all: 0, waiting: 0, 'in-progress': 0, 'shipped-this-week': 0 } as Record<BuildFilter, number>;
  for (const f of Object.keys(out) as BuildFilter[]) out[f] = views.filter((v) => matchesBuildFilter(v, f, now)).length;
  return out;
}

/** The sentence under the page title, from the rows the page lists (listedRows). */
export function pageSentence(views: readonly BuildRequestView[]): string {
  const open = views.filter((v) => v.status !== 'shipped' && v.status !== 'not-planned');
  const stale = open.filter((v) => v.stale).length;
  if (!views.length) return 'Nothing is being built yet.';
  if (!open.length) {
    // Shipped is in the library; a declined request is not, so it never reads as "everything is in the library".
    const declined = views.filter((v) => v.status === 'not-planned').length;
    if (!declined) return 'Everything handed to developers is in the library.';
    return `Nothing is being built right now. ${declined === 1 ? 'One change was' : `${declined} changes were`} closed without being built this week.`;
  }
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
  text: 'When you push a change from the Bridge Figma plugin that needs code, like a new variant, a new option or a new layout, or ask for one from Components, it becomes a build request. An exploration comes here too once you say Done exploring. Developers pick them up where they work, in GitHub or Jira, and you follow each one here until it is in the library.',
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

/**
 * The thumbnail of a row: the request's own pictures (In code now | In Figma, from its issue) when it carries both,
 * else the component placeholder. Either way it is labelled with the request's component, never a default one.
 */
export function rowThumb(v: Pick<BuildRequestView, 'kind' | 'number' | 'url' | 'component'>, body: string | null | undefined): ThumbSpec {
  const label = v.component || 'Component';
  const d = v.kind === 'issue' && body ? buildDetail(body, v) : null;
  const before = safeUrl(d?.before[0]);
  const after = safeUrl(d?.after[0]);
  return before && after ? { kind: 'image', before, after, label } : { kind: 'icon', icon: 'component', label };
}


// ---------------------------------------------------------------------------------------------------------------
// Explorations handed to developers

/**
 * An exploration someone said "Done exploring" on: developers build it, so it is a row of the same list (decision
 * 2026-10-31: Being built is everything developers have to build, whatever its origin). The row opens the exploration.
 */
export interface ExplorationBuildRow extends BuildRequestView {
  exploration: {
    /** The Studio path the row opens: `changes/?exploration=12`, with `&product=shop` in a product's own repository. */
    href: string;
    /** Line 2: the product, who said Done exploring and when, then where it stands. */
    line: string;
    /** The product's name, when it was explored for one. */
    product: string | null;
  };
}


const DAY = 86_400_000;
const EXPLORATION_BUILD_STATUS = { ready: 'requested', building: 'in-progress', shipped: 'shipped' } as const;

/**
 * The explorations handed to developers among pull requests already read (the design system's list of Being built,
 * the open ones of each product repository): waiting for code reads Waiting to be picked up, developers pushing reads
 * In progress, merged this week reads Shipped this week. Running, archived, closed and older shipped ones stay out.
 */
export function explorationBuildRows(
  pulls: readonly RestPull[],
  ctx: { products: readonly ProductConfig[]; now: number; nameOf?: (login: string) => string },
): ExplorationBuildRow[] {
  const nameOf = ctx.nameOf ?? ((l: string) => l);
  const seen = new Set<string>();
  return pulls.flatMap((p): ExplorationBuildRow[] => {
    const key = p.product ? `${p.product}#${p.number}` : String(p.number);
    if (seen.has(key)) return [];
    seen.add(key);
    const core = { state: p.state, merged_at: p.merged_at ?? null, labels: p.labels ?? [], headRef: p.head?.ref, body: p.body ?? '', headSha: p.head?.sha, draft: p.draft };
    if (!isExplorationPull(core) || isArchivedExploration(core.labels)) return [];
    const was = explorationStatus(core);
    if (was !== 'ready' && was !== 'building' && was !== 'shipped') return [];
    const shippedAt = was === 'shipped' ? (p.merged_at ?? null) : null;
    if (was === 'shipped' && !(shippedAt && ctx.now - Date.parse(shippedAt) <= 7 * DAY)) return [];
    const status = EXPLORATION_BUILD_STATUS[was];
    const block = parseExplorationBody(p.body);
    const raw = block?.name?.trim() || (p.title ?? '').replace(/^Exploration:\s*/i, '').trim() || `Exploration #${p.number}`;
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);
    const product = (p.product ? ctx.products.find((x) => x.key === p.product) : isProductBranch(p.labels, ctx.products))?.name ?? null;
    const doneAt = block?.doneAt ?? null;
    const doneBy = block?.doneBy ?? null;
    const createdAt = doneAt ?? p.created_at ?? p.updated_at ?? new Date(ctx.now).toISOString();
    const ageDays = daysSince(createdAt, ctx.now);
    const stale = status === 'requested' && ageDays > BUILD_STALE_DAYS;
    const done = `Done exploring${doneBy ? ` by ${nameOf(doneBy)}` : ''}${doneAt ? ` on ${shortDate(doneAt)}` : ''}`;
    const s = shippedAt ? daysSince(shippedAt, ctx.now) : 0;
    const where = { requested: null, 'in-progress': 'Developers are building it', shipped: s === 0 ? 'Shipped today' : `Shipped ${s} ${s === 1 ? 'day' : 'days'} ago` } as const;
    const line = [product, status === 'shipped' ? null : done, where[status]].filter(Boolean).join(' · ');
    const sentence = { requested: 'Waiting for a developer.', 'in-progress': 'Developers are building it.', shipped: 'Shipped.' } as const;
    const timeline: BuildRequestView['timeline'] = [{ status: 'requested', at: createdAt, ...(doneBy ? { who: doneBy } : {}) }];
    if (status !== 'requested') timeline.push({ status: 'in-progress' });
    if (shippedAt) timeline.push({ status: 'shipped', at: shippedAt });
    return [
      {
        id: `exploration-${key}`,
        kind: 'pull',
        number: Number(p.number),
        url: p.html_url,
        component: '',
        title: name,
        requestKind: null,
        status,
        label: EXPLORATION_STATUS_LABEL[was],
        sentence: sentence[status],
        builders: status === 'in-progress' ? (p.assignees ?? []).map((a) => a.login) : [],
        requestedBy: doneBy ?? block?.author ?? p.user?.login ?? null,
        createdAt,
        ageDays,
        stale,
        shippedAt,
        // A product repository's numbers are its own: only a design system pull request can match a build request's.
        pull: p.product ? null : { number: Number(p.number), url: p.html_url, state: shippedAt ? 'merged' : p.state },
        jira: null,
        figmaUrl: null,
        timeline,
        exploration: { href: `changes/${explorationHref({ number: Number(p.number), product: p.product })}`, line, product },
      },
    ];
  });
}
