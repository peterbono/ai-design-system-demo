// Build requests in the browser: Being built (components/ds/studio/BeingBuilt.tsx), the home line and the Library
// "Figma is ahead" line read them here. Three list reads (component-change issues, bridge-build issues, pull
// requests), each kept in sessionStorage for 5 minutes and shared by every reader of the page. The sample team of the
// demo reads its sample data (lib/building-sample.ts) and never GitHub. Rules: lib/building-view.ts and
// @bridge-ds/core build-requests.ts.
import { assembleBuildRequests, BUILD_REQUEST_LABEL, listBuildRequestsOnGitHub, REQUEST_LABEL, type BuildRequestView, type GitHubClient } from '@bridge-ds/core';
import { isSampleTeam } from '../lib/demo';
import { BUILD_CACHE_MS, buildCacheKey, slimIssue, slimPull, toBuildIssue, toBuildPull, type RestIssue, type RestPull } from '../lib/building-view';
import { sampleBuildData, SAMPLE_BUILDERS } from '../lib/building-sample';
import { personName } from '../lib/people';
import { ghGet, readRepo } from './github-session';
import { knownNames, lookUpNames } from './people';
import { siteConfig } from './repo-context';

export interface BuildData {
  views: BuildRequestView[];
  /** The issue bodies by number, for the detail (what was sent). */
  bodies: Map<number, string>;
  /** Sample data of the demo's sample team: read only, never GitHub. */
  sample: boolean;
  /** Shown from this browser's cache because GitHub refused a read. */
  stale: boolean;
  nameOf: (login: string) => string;
  /** integrations.jira.baseUrl, for the Jira links. */
  jiraBase: string | null;
}

const repoName = () => {
  const r = readRepo();
  return `${r.owner}/${r.repo}`;
};

function cached<T>(key: string): T[] | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; data: T[] };
    return Date.now() - v.at < BUILD_CACHE_MS && Array.isArray(v.data) ? v.data : null;
  } catch {
    return null;
  }
}

function keep(key: string, data: unknown[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* private mode or quota: one more read next time */
  }
}

async function list<T>(repo: string, what: 'requests' | 'builds' | 'pulls', path: string, slim: (x: T) => T): Promise<{ data: T[]; stale: boolean }> {
  const key = buildCacheKey(repo, what);
  const hit = cached<T>(key);
  if (hit) return { data: hit.map(slim), stale: false };
  const f = await ghGet<T[]>(path);
  const data = f.data.map(slim);
  if (!f.stale) keep(key, data);
  return { data, stale: f.stale };
}

const jiraBase = (): string | null => {
  try {
    const j = (siteConfig() as { integrations?: { jira?: { baseUrl?: string } } }).integrations?.jira?.baseUrl;
    return typeof j === 'string' && j ? j : null;
  } catch {
    return null;
  }
};

let loading: Promise<BuildData> | null = null;

/** Every build request of this page's team, with its status. One load per page; `fresh` reads again. */
export function loadBuildData(opts: { fresh?: boolean } = {}): Promise<BuildData> {
  if (loading && !opts.fresh) return loading;
  loading = read().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

async function read(): Promise<BuildData> {
  const repo = repoName();
  const now = Date.now();
  if (isSampleTeam(repo)) {
    const { issues, pulls } = sampleBuildData(now, repo);
    const nameOf = (l: string) => SAMPLE_BUILDERS[l] ?? l;
    return {
      views: assembleBuildRequests({ issues: issues.map(toBuildIssue), pulls: pulls.map(toBuildPull), now, nameOf }),
      bodies: new Map(issues.map((i) => [i.number, i.body ?? ''])),
      sample: true,
      stale: false,
      nameOf,
      jiraBase: null,
    };
  }
  const R = `/repos/${repo}`;
  const issuePath = (label: string) => `${R}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100&sort=created&direction=desc`;
  const [requests, builds, pulls] = await Promise.all([
    list<RestIssue>(repo, 'requests', issuePath(REQUEST_LABEL), slimIssue),
    list<RestIssue>(repo, 'builds', issuePath(BUILD_REQUEST_LABEL), slimIssue),
    list<RestPull>(repo, 'pulls', `${R}/pulls?state=all&per_page=100&sort=updated&direction=desc`, slimPull),
  ]);
  const seen = new Set<number>();
  // The issues list also answers pull requests carrying the label (a library branch from Figma): they come from the
  // pull request list instead.
  const issues = [...requests.data, ...builds.data].filter((i) => !i.pull_request && !seen.has(i.number) && seen.add(i.number));
  // Builders and senders by their profile names, as Branches shows them (people.ts), not by their GitHub login.
  const logins = [...issues.flatMap((i) => [i.user?.login, ...(i.assignees ?? []).map((a) => a.login)]), ...pulls.data.map((p) => p.user?.login)].filter((l): l is string => Boolean(l));
  const names = await lookUpNames(logins).catch(() => knownNames());
  const nameOf = (l: string) => personName(l, names);
  return {
    views: assembleBuildRequests({ issues: issues.map(toBuildIssue), pulls: pulls.data.map(toBuildPull), now, nameOf }),
    bodies: new Map(issues.map((i) => [i.number, i.body ?? ''])),
    sample: false,
    stale: requests.stale || builds.stale || pulls.stale,
    nameOf,
    jiraBase: jiraBase(),
  };
}

/** The open build requests' views of a team read with its own client (a team's Library page), the sample ones on the sample team. */
export async function buildViewsFor(repo: string, client: GitHubClient): Promise<{ views: BuildRequestView[]; nameOf: (login: string) => string }> {
  if (isSampleTeam(repo)) {
    const now = Date.now();
    const { issues, pulls } = sampleBuildData(now, repo);
    const nameOf = (l: string) => SAMPLE_BUILDERS[l] ?? l;
    return { views: assembleBuildRequests({ issues: issues.map(toBuildIssue), pulls: pulls.map(toBuildPull), now, nameOf }), nameOf };
  }
  const names = knownNames();
  const nameOf = (l: string) => personName(l, names);
  return { views: await listBuildRequestsOnGitHub(client, { nameOf }), nameOf };
}
