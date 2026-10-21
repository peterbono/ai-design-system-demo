// Repo activity: the team's work in progress, written by `bridge snapshot --activity` in the team's CI (with the
// workflow's GITHUB_TOKEN) and published next to snapshot.json on the bridge-data branch as activity.json. A
// signed-out visitor of a hosted Studio gets GitHub's 60 API requests an hour, about three page views; with
// activity.json Home, Branches, Review, History, suggestions and requests read nothing from the API at all.
//
// Two parts:
// - `responses`: the GitHub REST reads (GET) those pages make, as GitHub answered them, trimmed of what no page reads
//   (API links, nested repository objects, diffs). The Studio answers its own GETs from them (activityAnswer), so every
//   view, rule and gate keeps one code path whatever the source, the way snapshotSource() serves the repo model.
// - Summaries for readers that do not run the Studio (agents, the Library, a status line): open branches, open
//   suggestions with their parsed payload, request issues, recent merges, and the token history report.
//
// Pure: no Node, no DOM. The CLI hands it a fetch carrying the token.

import { GitHubClient, type FetchLike } from './github-client';
import type { BridgeConfig } from './config';
import { packageDirCandidates, type HistoryReport } from './history';
import { gitHubHistoryBackend, loadGitHubHistory } from './history-github';
import { parseRequestIssue, requestStatus, REQUEST_LABEL, type RequestKind, type RequestStatus } from './requests';
import { effectiveTier } from './review-gate';
import type { RiskTier } from './risk';
import { getSuggestionOnGitHub, listSuggestionsOnGitHub } from './suggestions-github';
import type { SuggestionKind, SuggestionPayloadV1, SuggestionStatus } from './suggestions';
import { SNAPSHOT_BRANCH } from './snapshot';

export const ACTIVITY_SCHEMA_VERSION = 1;
/** Next to snapshot.json on the bridge-data branch. */
export const ACTIVITY_FILE = 'activity.json';
/** Above this, the recorded reads are dropped heaviest first (trees, then older branches) until it fits. */
export const ACTIVITY_MAX_BYTES = 3_000_000;
/** A guest reads activity.json while it is younger than this; older, the Studio reads GitHub live. */
export const ACTIVITY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How much one activity.json carries. Each is a count of items, newest first. */
export const ACTIVITY_LIMITS = {
  /** Open pull requests recorded in full (the page of each; the list carries every open one). */
  branches: 30,
  /** Open suggestions read with their comments (parsed payload, counted approvals). */
  suggestions: 30,
  /** Request issues listed (open and closed); open ones are read with their comments. */
  requests: 30,
  /** Merged pull requests summarized. */
  merged: 20,
  /** Token history entries (core loadGitHubHistory limit). */
  history: 20,
  /** History entries whose two commits' file lists are recorded, so their before/after opens without the API. */
  historyTrees: 10,
} as const;
export type ActivityLimits = { [K in keyof typeof ACTIVITY_LIMITS]: number };

/** One GitHub answer: its status (200, or 404 for a read that finds nothing) and its JSON body, trimmed. */
export interface ActivityResponse {
  status: number;
  body: unknown;
}

export interface ActivityBranch {
  number: number;
  title: string;
  author: string;
  url: string;
  branch: string;
  base: string;
  headSha: string;
  baseSha: string;
  state: 'open' | 'draft';
  labels: string[];
  /** Risk tier from the labels, the body or the files (review-gate effectiveTier); null when none says. */
  tier: RiskTier | null;
  createdAt: string;
  updatedAt: string;
  /** Conversation plus line comments. Null when the branch was not read in full (over the limit). */
  comments: number | null;
  /** Files the branch changes, and the token files among them (the token diff opens from them). Null: not read. */
  files: { changed: number; tokens: string[] } | null;
  /** Previews built for the head commit (commit statuses with a link, success only). */
  previews: { context: string; url: string }[];
  /** Combined check state of the head commit. */
  checks: 'success' | 'failure' | 'pending' | 'none' | null;
}

export interface ActivitySuggestion {
  number: number;
  title: string;
  author: string;
  url: string;
  createdAt: string;
  kind: SuggestionKind | null;
  status: SuggestionStatus;
  labels: string[];
  comments: number | null;
  /** The parsed suggestion (null when its block does not parse). */
  payload: SuggestionPayloadV1 | null;
  approvers: string[];
}

export interface ActivityRequest {
  number: number;
  title: string;
  author: string;
  url: string;
  state: 'open' | 'closed';
  status: RequestStatus;
  kind: RequestKind | null;
  component: string | null;
  labels: string[];
  createdAt: string;
}

export interface ActivityMerged {
  number: number;
  title: string;
  author: string;
  url: string;
  mergedAt: string;
  labels: string[];
  tier: RiskTier | null;
}

export interface RepoActivity {
  kind: 'bridge-activity';
  schemaVersion: typeof ACTIVITY_SCHEMA_VERSION;
  tool: { name: 'bridge'; version: string };
  generatedAt: string;
  repo: { owner: string; name: string; branch: string };
  /** Default branch head when it was written. */
  headSha: string;
  branches: ActivityBranch[];
  suggestions: ActivitySuggestion[];
  requests: ActivityRequest[];
  merged: ActivityMerged[];
  /** Token history of the default branch (core HistoryReport), null when it could not be read. */
  history: HistoryReport | null;
  /** GitHub REST answers by activityKey (path relative to api.github.com, query sorted). */
  responses: Record<string, ActivityResponse>;
  /** What was left out to stay within the limits, in words. */
  truncated: string[];
  /** What could not be read. */
  problems: string[];
}

export class ActivityError extends Error {}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const API = 'https://api.github.com';

/**
 * The key of a GitHub REST read: the path relative to api.github.com with the query parameters sorted, and the
 * owner and repository (or user) lowercased, since GitHub reads them without case. Null for any other host.
 */
export function activityKey(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url, API);
  } catch {
    return null;
  }
  if (u.origin !== API) return null;
  const parts = u.pathname.split('/');
  if (parts[1] === 'repos' && parts.length > 3) {
    parts[2] = parts[2]!.toLowerCase();
    parts[3] = parts[3]!.toLowerCase();
  } else if (parts[1] === 'users' && parts.length > 2) parts[2] = parts[2]!.toLowerCase();
  const q = [...u.searchParams].sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  const search = q.length ? `?${new URLSearchParams(q).toString()}` : '';
  return parts.join('/') + search;
}

// --- trimming -----------------------------------------------------------------------------------------------------

/** URL fields a page reads; every other `*_url` and `url` is an API link nothing follows. */
const KEPT_URLS = new Set(['html_url', 'avatar_url', 'target_url', 'details_url', 'environment_url', 'raw_url']);
/** Fields no page reads that weigh the most. */
const DROPPED = new Set(['_links', 'patch', 'body_html', 'body_text', 'reactions', 'performed_via_github_app', 'node_id', 'gravatar_id', 'user_view_type', 'site_admin', 'event', 'sub_issues_summary', 'issue_dependencies_summary', 'pull_request_review_id']);
const LONG_TEXT = 60_000;

const trimUser = (u: Record<string, unknown>) => ({
  login: u.login,
  ...(u.id !== undefined ? { id: u.id } : {}),
  ...(u.avatar_url ? { avatar_url: u.avatar_url } : {}),
  ...(u.html_url ? { html_url: u.html_url } : {}),
  ...(u.type ? { type: u.type } : {}),
});

const trimRepo = (r: Record<string, unknown>) => ({
  ...(r.id !== undefined ? { id: r.id } : {}),
  name: r.name,
  full_name: r.full_name,
  ...(r.private !== undefined ? { private: r.private } : {}),
  ...(r.fork !== undefined ? { fork: r.fork } : {}),
  ...(r.default_branch ? { default_branch: r.default_branch } : {}),
  ...(isObj(r.owner) ? { owner: trimUser(r.owner) } : {}),
  ...(r.html_url ? { html_url: r.html_url } : {}),
});

/**
 * A GitHub answer without what no page reads: API links, node ids, diffs, reactions, the repository objects nested in
 * a pull request's head and base (name, owner and fork kept), and user objects beyond login, avatar and type. A tree
 * keeps path, type and sha per entry. Strings longer than 60 000 characters are cut.
 */
export function trimGitHub(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return value.length > LONG_TEXT ? value.slice(0, LONG_TEXT) : value;
  if (Array.isArray(value)) return value.map((v) => trimGitHub(v, key));
  if (!isObj(value)) return value;
  if (key === 'tree' && typeof value.path === 'string' && typeof value.type === 'string') return { path: value.path, type: value.type, sha: value.sha, ...(value.mode ? { mode: value.mode } : {}) };
  if ((key === 'repo' || key === 'repository' || key === 'head_repository') && typeof value.full_name === 'string') return trimRepo(value);
  if (typeof value.login === 'string' && ('avatar_url' in value || 'type' in value)) return trimUser(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (DROPPED.has(k)) continue;
    if ((k === 'url' || k.endsWith('_url')) && !KEPT_URLS.has(k)) continue;
    if (k === 'output' && isObj(v)) {
      out[k] = { title: v.title ?? null, summary: typeof v.summary === 'string' ? v.summary.slice(0, 2000) : null, annotations_count: v.annotations_count ?? 0 };
      continue;
    }
    if (k === 'app' && isObj(v)) {
      out[k] = { id: v.id, slug: v.slug, name: v.name };
      continue;
    }
    out[k] = trimGitHub(v, k);
  }
  return out;
}

// --- recording ----------------------------------------------------------------------------------------------------

const JSON_ACCEPT = /application\/(vnd\.github\+)?json/;
/** What a recordingFetch shaper returns for a read it should not keep. */
export const SKIP: unique symbol = Symbol('skip');

/**
 * The paths of a tree the Studio reads from a recorded tree: token files and the contrast checks (the branch token
 * diff), bridge.config.json, changesets, and the CHANGELOG.md and package.json the history reads. Every other entry is
 * left out of activity.json, which keeps a tree at a few kilobytes instead of a whole repository listing.
 */
export function activityTreeFilter(config: BridgeConfig): (path: string) => boolean {
  const under = (dir: string | undefined) => {
    const d = (dir ?? '').replace(/^\.\/|\/$/g, '');
    return d && d !== '.' ? `${d}/` : '';
  };
  const tokens = under(config.tokens.root);
  const changesets = config.changesets ? under(config.changesets.dir) : null;
  const pkg = new Set(packageDirCandidates(config).flatMap((d) => [d ? `${d}/CHANGELOG.md` : 'CHANGELOG.md', d ? `${d}/package.json` : 'package.json']));
  return (p) => p === 'bridge.config.json' || pkg.has(p) || (tokens ? p.startsWith(tokens) : p.endsWith('.json')) || (changesets !== null && changesets !== '' && p.startsWith(changesets));
}

/** History internals the Studio never reads from a recorded answer (it reads the history report instead). */
const UNREAD = [/\/git\/blobs\//, /\/commits\/[^/]+\/pulls$/, /\/commits\?/, /\/tags\?/, /\/contents\//];

/** The shaper collectActivity records with: trees filtered (activityTreeFilter), compares to what a branch page reads. */
export function activityShaper(config: BridgeConfig): (key: string, body: unknown) => unknown | typeof SKIP {
  const keep = activityTreeFilter(config);
  return (key, body) => {
    if (UNREAD.some((r) => r.test(key))) return SKIP;
    if (key.includes('/git/trees/') && isObj(body) && Array.isArray(body.tree)) return { sha: body.sha, tree: (body.tree as { path: string }[]).filter((e) => keep(e.path)), truncated: Boolean(body.truncated) };
    if (key.includes('/compare/') && isObj(body)) {
      const c = body as Record<string, any>;
      return {
        status: c.status,
        ahead_by: c.ahead_by,
        behind_by: c.behind_by,
        total_commits: c.total_commits,
        merge_base_commit: c.merge_base_commit ? { sha: c.merge_base_commit.sha } : null,
        base_commit: c.base_commit ? { sha: c.base_commit.sha, commit: { tree: { sha: c.base_commit.commit?.tree?.sha } } } : null,
        files: Array.isArray(c.files) ? c.files.map((f: Record<string, unknown>) => ({ filename: f.filename, status: f.status, ...(f.previous_filename ? { previous_filename: f.previous_filename } : {}), sha: f.sha, additions: f.additions, deletions: f.deletions, changes: f.changes })) : [],
      };
    }
    return body;
  };
}

/** Changes listed per history entry; an import of hundreds of tokens keeps its counts and its first changes. */
export const HISTORY_MAX_CHANGES = 100;

/** A history report with each entry's change and reason lists capped (counts stay whole). */
export function capHistory(report: HistoryReport, max = HISTORY_MAX_CHANGES): HistoryReport {
  return {
    ...report,
    entries: report.entries.map((e) => (e.changes.length > max || (e.reasons?.length ?? 0) > max ? { ...e, changes: e.changes.slice(0, max), ...(e.reasons ? { reasons: e.reasons.slice(0, max) } : {}) } : e)),
  };
}

/**
 * Wraps a fetch and records every GitHub REST GET that answers 200 or 404 with JSON, trimmed, under its activityKey.
 * Reads with another media type (raw file bodies) pass through unrecorded.
 */
export function recordingFetch(fetchImpl: FetchLike, into: Map<string, ActivityResponse>, shape: (key: string, body: unknown) => unknown | typeof SKIP = (_k, b) => b): FetchLike {
  return async (url, init) => {
    const res = await fetchImpl(url, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const accept = init?.headers?.Accept ?? init?.headers?.accept ?? 'application/vnd.github+json';
    const key = activityKey(url);
    if (method !== 'GET' || !key || !JSON_ACCEPT.test(accept) || (res.status !== 200 && res.status !== 404)) return res;
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: res.ok, status: res.status, headers: res.headers, json: async () => JSON.parse(text), text: async () => text };
    }
    const shaped = shape(key, trimGitHub(body));
    if (shaped !== SKIP) into.set(key, { status: res.status, body: shaped });
    return { ok: res.ok, status: res.status, ...(res.headers ? { headers: res.headers } : {}), json: async () => JSON.parse(text) as unknown, text: async () => text };
  };
}

// --- collecting ---------------------------------------------------------------------------------------------------

export interface CollectActivityInput {
  /** fetch for api.github.com (the token goes in `token`). */
  fetch: FetchLike;
  token: string;
  owner: string;
  repo: string;
  /** The repository's Bridge config (tokens root, governance, changesets): history and suggestion approvals read it. */
  config: BridgeConfig;
  version: string;
  generatedAt?: string;
  /**
   * The activity published last time. Its history (and the file lists recorded for it) is kept when the default
   * branch head has not moved, which saves most of the reads of a run on a schedule or a pull request event.
   */
  previous?: RepoActivity | null;
  limits?: Partial<ActivityLimits>;
}

interface RawPull {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  state: string;
  body?: string | null;
  user?: { login?: string } | null;
  labels?: ({ name?: string } | string)[];
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  comments?: number;
  review_comments?: number;
}

const labelObjs = (labels: RawPull['labels']) => labelNames(labels).map((name) => ({ name }));
function labelNames(labels: RawPull['labels']): string[] {
  return (labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);
}
const byUpdated = <T extends { updated_at: string }>(a: T, b: T) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0);

/**
 * Reads the team's activity from GitHub: the same reads, with the same paths, as the hosted Studio's guest pages
 * (Home, Branches and each open branch, Review, History, suggestions, requests), recorded, plus the summaries. A read
 * that fails is noted in `problems` and the rest goes on; an exhausted hourly limit stops the reading there.
 */
export async function collectActivity(input: CollectActivityInput): Promise<RepoActivity> {
  const limits: ActivityLimits = { ...ACTIVITY_LIMITS, ...input.limits };
  const responses = new Map<string, ActivityResponse>();
  const rec = recordingFetch(input.fetch, responses, activityShaper(input.config));
  const client = new GitHubClient(`${input.owner}/${input.repo}`, input.token, rec, { attempts: 2, baseDelayMs: 500, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, { etags: false });
  const R = `/repos/${input.owner}/${input.repo}`;
  const problems: string[] = [];
  const truncated: string[] = [];
  let limited = false;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}) };

  /** One GET of a path as the Studio writes it; undefined when it failed (noted). */
  const get = async <T>(path: string): Promise<T | undefined> => {
    if (limited) return undefined;
    try {
      const res = await rec(`${API}${path}`, { headers });
      if (res.status === 404) return undefined;
      if (!res.ok) {
        if ((res.status === 403 || res.status === 429) && res.headers?.get('x-ratelimit-remaining') === '0') {
          limited = true;
          problems.push('GitHub hourly limit reached while reading activity: the rest was left out.');
        } else problems.push(`GitHub answered ${res.status} for ${path}`);
        return undefined;
      }
      return (await res.json()) as T;
    } catch (err) {
      problems.push(`Could not read ${path}: ${(err as Error).message}`);
      return undefined;
    }
  };
  /** A core read; its failure is noted and gives `fallback`. */
  const safely = async <T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    if (limited) return fallback;
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message;
      if (/limit/i.test(msg) && (err as { status?: number }).status === 429) limited = true;
      problems.push(`${what}: ${msg}`);
      return fallback;
    }
  };

  // The repository and its default branch head (every team page reads both first).
  const info = await safely('Repository', () => client.getRepo(), null);
  const branch = info?.defaultBranch ?? input.config.repo?.defaultBranch ?? 'main';
  const headSha = (await safely('Default branch', () => client.getBranchSha(branch), undefined)) ?? '';

  // Branches: the open list, the closed lists the Branches and Requests views read, then each open branch's page.
  const open = (await get<RawPull[]>(`${R}/pulls?state=open&per_page=100`)) ?? [];
  const closed = (await get<RawPull[]>(`${R}/pulls?state=closed&sort=updated&direction=desc&per_page=30`)) ?? [];
  await get(`${R}/pulls?state=closed&per_page=50&sort=updated&direction=desc`);
  await get(`${R}/rules/branches/${encodeURIComponent(branch)}`);
  await get(`${R}/git/matching-refs/heads/bridge-visual`);
  await safely('Owner account', () => client.getAccountType(input.owner), null);

  // What the last activity recorded, reused where nothing changed (keeps a scheduled run to a few requests).
  const prev = input.previous ?? null;
  const sameRepoPrev = Boolean(prev && sameRepo(prev, input));
  const prevOk = sameRepoPrev && Boolean(headSha) && prev!.headSha === headSha;
  /** A read the last activity recorded, when `reuse`; else read now. */
  const kept = async <T>(path: string, reuse: boolean): Promise<T | undefined> => {
    const key = reuse ? activityKey(`${API}${path}`) : null;
    const hit = key ? prev!.responses[key] : undefined;
    if (key && hit) {
      responses.set(key, hit);
      return hit.status === 200 ? (hit.body as T) : undefined;
    }
    return get<T>(path);
  };

  const branches: ActivityBranch[] = [];
  const sorted = [...open].sort(byUpdated);
  if (sorted.length > limits.branches) truncated.push(`${sorted.length - limits.branches} open branches beyond the ${limits.branches} most recently updated are listed without their pages.`);
  for (const [i, p] of sorted.entries()) {
    const full = i < limits.branches;
    const base: ActivityBranch = {
      number: p.number,
      title: p.title,
      author: p.user?.login ?? '',
      url: p.html_url,
      branch: p.head.ref,
      base: p.base.ref,
      headSha: p.head.sha,
      baseSha: p.base.sha,
      state: p.draft ? 'draft' : 'open',
      labels: labelNames(p.labels),
      tier: effectiveTier(labelObjs(p.labels), p.body ?? null, null),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      comments: null,
      files: null,
      previews: [],
      checks: null,
    };
    if (!full || limited) {
      branches.push(base);
      continue;
    }
    const n = p.number;
    // A branch nobody touched since the last activity (same update time, same head, same default branch head) keeps
    // its recorded page; its checks and statuses are read again (they change without touching the pull request).
    // Trees are named by commit and never change.
    const was = prevOk ? prev!.branches.find((b) => b.number === n) : undefined;
    const same = Boolean(was && was.updatedAt === p.updated_at && was.headSha === p.head.sha && was.comments !== null);
    const [pull, files, , , , , status] = await Promise.all([
      kept<RawPull>(`${R}/pulls/${n}`, same),
      kept<{ filename: string; status?: string }[]>(`${R}/pulls/${n}/files?per_page=100`, same),
      kept(`${R}/pulls/${n}/reviews?per_page=100`, same),
      kept(`${R}/issues/${n}/comments?per_page=100`, same),
      kept(`${R}/pulls/${n}/comments?per_page=100`, same),
      get(`${R}/commits/${p.head.sha}/check-runs?per_page=100`),
      get<{ state?: string; statuses?: { context: string; state: string; target_url?: string | null }[] }>(`${R}/commits/${p.head.sha}/status`),
      kept(`${R}/compare/${encodeURIComponent(p.base.ref)}...${p.head.sha}`, same),
      kept(`${R}/git/trees/${p.base.sha}?recursive=1`, sameRepoPrev),
      kept(`${R}/git/trees/${p.head.sha}?recursive=1`, sameRepoPrev),
      kept(`${R}/issues/${n}/labels`, same),
    ]);
    const root = input.config.tokens.root.replace(/\/$/, '');
    branches.push({
      ...base,
      tier: effectiveTier(labelObjs((pull ?? p).labels), (pull ?? p).body ?? null, files ?? null),
      comments: pull ? (pull.comments ?? 0) + (pull.review_comments ?? 0) : null,
      files: files ? { changed: files.length, tokens: files.map((f) => f.filename).filter((f) => f.startsWith(`${root}/`) && f.endsWith('.json')) } : null,
      previews: (status?.statuses ?? []).filter((s) => s.state === 'success' && s.target_url && /^https:\/\//.test(s.target_url)).map((s) => ({ context: s.context, url: s.target_url! })),
      checks: status ? (status.state === 'success' || status.state === 'failure' || status.state === 'pending' ? status.state : 'none') : null,
    });
  }

  // Suggestions: the open list as Branches reads it, then each one as its page reads it (payload, approvals).
  const gov = { owners: input.config.governance.owners, rights: input.config.governance.rights, soloOwnerCanApproveBoth: input.config.governance.soloOwnerCanApproveBoth };
  const items = await safely('Suggestions', () => listSuggestionsOnGitHub(client, { state: 'open' }), []);
  const pullsAll = items.length ? await safely('Pull requests', () => client.listPullRequests('all'), []) : [];
  if (items.length > limits.suggestions) truncated.push(`${items.length - limits.suggestions} open suggestions beyond the ${limits.suggestions} newest are listed without their pages.`);
  const suggestions: ActivitySuggestion[] = [];
  for (const [i, s] of items.entries()) {
    const d = i < limits.suggestions ? await safely(`Suggestion #${s.number}`, () => getSuggestionOnGitHub(client, s.number, gov, { pulls: pullsAll }), null) : null;
    suggestions.push({
      number: s.number,
      title: s.title,
      author: s.author,
      url: s.url,
      createdAt: s.createdAt,
      kind: s.kind ?? null,
      status: d?.status ?? s.status,
      labels: s.labels,
      comments: d ? d.comments.length : null,
      payload: d?.parsed.ok ? d.parsed.payload : null,
      approvers: d?.approvals?.approvers ?? [],
    });
  }

  // Requests: the list the Requests view reads, and each open one as its page reads it.
  const issues = await safely('Requests', () => client.listIssues({ label: REQUEST_LABEL, state: 'all', perPage: 50 }), []);
  const requests: ActivityRequest[] = [];
  const openIssues = issues.filter((i) => i.state === 'open');
  if (openIssues.length > limits.requests) truncated.push(`${openIssues.length - limits.requests} open requests beyond the ${limits.requests} newest are listed without their pages.`);
  for (const [i, r] of issues.slice(0, Math.max(limits.requests, 0)).entries()) {
    if (r.state === 'open' && i < limits.requests) {
      await get(`${R}/issues/${r.number}`);
      await get(`${R}/issues/${r.number}/comments?per_page=100`);
    }
    const parsed = parseRequestIssue(r.body);
    const linked = [...open, ...closed].filter((p) => new RegExp(`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${r.number}\\b`, 'i').test(p.body ?? ''));
    requests.push({
      number: r.number,
      title: r.title,
      author: r.author,
      url: r.url,
      state: r.state,
      status: requestStatus({ state: r.state, stateReason: r.stateReason, linkedPrs: linked.map((p) => ({ state: p.state === 'open' ? 'open' : 'closed', merged: Boolean(p.merged_at) })) }),
      kind: parsed?.kind ?? null,
      component: parsed?.component ?? null,
      labels: r.labels,
      createdAt: r.createdAt,
    });
  }

  const merged: ActivityMerged[] = closed
    .filter((p) => p.merged_at)
    .slice(0, limits.merged)
    .map((p) => ({ number: p.number, title: p.title, author: p.user?.login ?? '', url: p.html_url, mergedAt: p.merged_at!, labels: labelNames(p.labels), tier: effectiveTier(labelObjs(p.labels), p.body ?? null, null) }));

  // Token history: kept from the last activity while the head has not moved (it is the costly part), else read again,
  // with the file lists of the newest entries' commits so their before/after opens without the API.
  let history: HistoryReport | null = null;
  if (prevOk && prev!.history) {
    history = prev!.history;
    for (const [k, v] of Object.entries(prev!.responses)) if (isHistoryKey(k) && !responses.has(k)) responses.set(k, v);
  } else if (!limited && headSha) {
    const read = await safely('Token history', () => loadGitHubHistory(client, input.config, { ref: branch, limit: limits.history }), null);
    history = read && capHistory(read);
    if (history) {
      const backend = gitHubHistoryBackend(client, input.config, { concurrency: 2 });
      const shas = [...new Set(history.entries.filter((e) => !e.bulk).slice(0, limits.historyTrees).flatMap((e) => [e.sha, ...(e.baseSha ? [e.baseSha] : [])]))];
      for (const sha of shas) await safely(`Files at ${sha.slice(0, 7)}`, () => backend.tree(sha), []);
    }
  }

  const activity: RepoActivity = {
    kind: 'bridge-activity',
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    tool: { name: 'bridge', version: input.version },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    repo: { owner: input.owner, name: input.repo, branch },
    headSha,
    branches,
    suggestions,
    requests,
    merged,
    history,
    responses: Object.fromEntries([...responses].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    truncated,
    problems,
  };
  return fitActivity(activity);
}

const sameRepo = (a: RepoActivity, b: { owner: string; repo: string }) => a.repo.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.name.toLowerCase() === b.repo.toLowerCase();
const isHistoryKey = (k: string) => /\/git\/commits\/[0-9a-f]+$/.test(k) || /\/git\/trees\/[0-9a-f]+\?recursive=1$/.test(k);

/** Bytes of the activity as written. */
export const activityBytes = (a: RepoActivity): number => new TextEncoder().encode(`${JSON.stringify(a)}\n`).length;

/**
 * Keeps the activity under `max` bytes: drops the recorded file lists (trees) first, then the pages of the least
 * recently updated branches, then every recorded read. The summaries always stay. Says what it dropped in `truncated`.
 */
export function fitActivity(activity: RepoActivity, max = ACTIVITY_MAX_BYTES): RepoActivity {
  if (activityBytes(activity) <= max) return activity;
  const out = { ...activity, responses: { ...activity.responses }, truncated: [...activity.truncated] };
  const drop = (test: (k: string) => boolean) => {
    for (const k of Object.keys(out.responses)) if (test(k)) delete out.responses[k];
  };
  drop((k) => k.includes('/git/trees/'));
  out.truncated.push('File lists were left out to keep activity.json small: a branch or history change reads them from GitHub.');
  if (activityBytes(out) <= max) return out;
  const old = [...out.branches].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
  for (const b of old) {
    drop((k) => new RegExp(`/(pulls|issues)/${b.number}(/|$|\\?)`).test(k) || k.includes(`/commits/${b.headSha}/`) || k.includes(`...${b.headSha}`));
    if (activityBytes(out) <= max) {
      out.truncated.push('The pages of the least recently updated branches were left out: they read from GitHub.');
      return out;
    }
  }
  out.responses = {};
  out.truncated.push('Every recorded read was left out: pages read GitHub live.');
  return out;
}

// --- reading ------------------------------------------------------------------------------------------------------

/** Validates an activity (text or parsed JSON). Throws ActivityError naming the first problem. */
export function parseActivity(input: string | unknown): RepoActivity {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      throw new ActivityError(`${ACTIVITY_FILE} is not valid JSON (${(err as Error).message})`);
    }
  }
  if (!isObj(data) || data.kind !== 'bridge-activity') throw new ActivityError(`${ACTIVITY_FILE} is not a Bridge activity file`);
  if (data.schemaVersion !== ACTIVITY_SCHEMA_VERSION) throw new ActivityError(`${ACTIVITY_FILE} is schema version ${String(data.schemaVersion)}; this version of Bridge reads ${ACTIVITY_SCHEMA_VERSION}`);
  const repo = data.repo;
  if (!isObj(repo) || typeof repo.owner !== 'string' || typeof repo.name !== 'string' || typeof repo.branch !== 'string') throw new ActivityError(`${ACTIVITY_FILE}: repo needs owner, name and branch`);
  if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) throw new ActivityError(`${ACTIVITY_FILE}: generatedAt is missing`);
  for (const k of ['branches', 'suggestions', 'requests', 'merged', 'truncated', 'problems'] as const) if (!Array.isArray(data[k])) throw new ActivityError(`${ACTIVITY_FILE}: ${k} must be a list`);
  if (!isObj(data.responses) || !Object.values(data.responses).every((r) => isObj(r) && typeof r.status === 'number')) throw new ActivityError(`${ACTIVITY_FILE}: responses must map paths to { status, body }`);
  if (data.history !== null && !(isObj(data.history) && Array.isArray(data.history.entries))) throw new ActivityError(`${ACTIVITY_FILE}: history must be null or a history report`);
  return data as unknown as RepoActivity;
}

/** Milliseconds since the activity was written (never negative). */
export const activityAge = (a: Pick<RepoActivity, 'generatedAt'>, now = Date.now()): number => Math.max(0, now - Date.parse(a.generatedAt));

/** True while a guest should read the activity instead of GitHub: written for this repository, and recently. */
export function activityIsUsable(a: Pick<RepoActivity, 'generatedAt' | 'repo'>, team: { owner: string; repo: string }, now = Date.now(), maxAge = ACTIVITY_MAX_AGE_MS): boolean {
  return a.repo.owner.toLowerCase() === team.owner.toLowerCase() && a.repo.name.toLowerCase() === team.repo.toLowerCase() && activityAge(a, now) <= maxAge;
}

/**
 * The recorded answer to a GitHub REST GET, or undefined when the activity did not record it (read it live). Only
 * reads of the activity's own repository (and the user accounts it recorded) are answered.
 */
export function activityAnswer(a: Pick<RepoActivity, 'responses' | 'repo'>, url: string): ActivityResponse | undefined {
  const key = activityKey(url);
  if (!key) return undefined;
  const own = `/repos/${a.repo.owner.toLowerCase()}/${a.repo.name.toLowerCase()}`;
  if (!(key === own || key.startsWith(`${own}/`) || key.startsWith(`${own}?`) || key.startsWith('/users/'))) return undefined;
  return Object.prototype.hasOwnProperty.call(a.responses, key) ? a.responses[key] : undefined;
}

/** "activity.json" on the bridge-data branch of a public repository, on the raw host (no API quota). */
export const activityRawUrl = (owner: string, repo: string): string => `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${SNAPSHOT_BRANCH}/${ACTIVITY_FILE}`;
