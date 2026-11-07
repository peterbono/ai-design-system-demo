// Build requests in the browser: Being built (components/ds/studio/BeingBuilt.tsx), the home line and the Library
// "Figma is ahead" line read them here. Three list reads (component-change issues, bridge-build issues, pull
// requests), each kept in sessionStorage for 5 minutes and shared by every reader of the page. The sample team of the
// demo reads its sample data (lib/building-sample.ts) and never GitHub. Rules: lib/building-view.ts and
// @bridge-ds/core build-requests.ts.
// Being built also lists Claude's fixes (the fix sessions of the team's Claude, api/mcp ?view=sessions) as rows of the
// same list, reconciled with the pull requests read here (lib/claude-connector fixRows). They stay out of `views`, so
// the home line and "Figma is ahead" count build requests only.
// Explorations handed to developers (Done exploring) are rows of the same list too, read from the pull requests read
// here (no read per row) and, for products with their own repository, from the one read of their open pull requests
// that Changes and the home make too (scripts/product-repos.ts). They stay out of `views` as well.
import { assembleBuildRequests, BUILD_REQUEST_LABEL, DEFAULT_PRODUCTS, liveAddressOf, parseExplorationBody, listBuildRequestsOnGitHub, REQUEST_LABEL, type BuildRequestView, type GitHubClient, type ProductConfig } from '@bridge-ds/core';
import { fixRows, fixStaysListed, isLoginLike, missingFixPulls, parseSession, type FixRow, type Session } from '../lib/claude-connector';
import { isSampleTeam } from '../lib/demo';
import { BUILD_CACHE_MS, buildCacheKey, explorationBuildRows, slimIssue, slimPull, toBuildIssue, toBuildPull, withLifecycle, withProducts, type ExplorationBuildRow, type LifecycleExtra, type RestIssue, type RestPull } from '../lib/building-view';
import { inNextRelease, libraryRelease, parseReleaseBody } from '../lib/release-view';
import { needsReviewRead } from '../lib/review-state';
import { readDesignTask } from './design-task';
import { libraryScope } from './next-release';
import { readReviews } from './review-reads';
import { siteApprovers } from './teams';
import { sampleBuildData, SAMPLE_BUILDERS } from '../lib/building-sample';
import { personName } from '../lib/people';
import { currentAccess, currentContributor, currentViewer, ghGet, hasWorkingToken, readRepo } from './github-session';
import { teamMember } from '../lib/developers-message';
import { previewShotOf } from './preview-shots';
import { knownNames, lookUpNames } from './people';
import { siteConfig } from './repo-context';
import { isHosted } from '../lib/team-path';

export interface BuildData {
  views: (BuildRequestView & LifecycleExtra)[];
  /** The issue bodies by number, for the detail (what was sent). */
  bodies: Map<number, string>;
  /** Sample data of the demo's sample team: read only, never GitHub. */
  sample: boolean;
  /** Shown from this browser's cache because GitHub refused a read. */
  stale: boolean;
  nameOf: (login: string) => string;
  /** integrations.jira.baseUrl, for the Jira links. */
  jiraBase: string | null;
  /** Claude's fixes, as rows of the list (none on the sample team, or when the site has no connector). */
  fixes?: FixRow[];
  /** The pull requests read, so the fixes can be read again while Claude works without reading GitHub again. */
  pulls?: RestPull[];
  /** Explorations handed to developers, as rows of the list (none on the sample team). */
  explorations?: (ExplorationBuildRow & LifecycleExtra)[];
  /** bridge.config.json products, for the product filter. Absent: the default products. */
  products?: readonly ProductConfig[];
  /** Who You is in the people filter: the login or email, the demo lead's seat on the sample team, else nobody. */
  viewer?: string | null;
  /** The viewer's profile name: their rows read with it where only a name is recorded. */
  viewerName?: string | null;
}

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');

/** The team's fix sessions, or none (no connector here, signed out, the sample team). */
async function readSessions(repo: string): Promise<Session[]> {
  if (noRepoPage() || isSampleTeam(repo)) return [];
  try {
    const api = await import('./connector-api');
    return (await api.listFixSessions(repo)).map(parseSession).filter((s): s is Session => Boolean(s));
  } catch {
    return [];
  }
}

/** Claude's fixes read again (every 10 seconds while Claude works), against the pull requests already read. */
export async function readFixes(data: Pick<BuildData, 'pulls' | 'nameOf' | 'sample' | 'products'>): Promise<FixRow[]> {
  if (data.sample) return [];
  const pulls = data.pulls ?? [];
  return withProducts(fixRows(await readSessions(repoName()), pulls, Date.now(), data.nameOf).filter(fixStaysListed), { pulls, products: data.products ?? DEFAULT_PRODUCTS });
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
    // The product filter names the team's products: its settings, the one memoized team load of every page.
    await teamSettings();
    const products = sitesProducts();
    return {
      views: withProducts(assembleBuildRequests({ issues: issues.map(toBuildIssue), pulls: pulls.map(toBuildPull), now, nameOf }), { issues, pulls, products }),
      bodies: new Map(issues.map((i) => [i.number, i.body ?? ''])),
      sample: true,
      stale: false,
      nameOf,
      jiraBase: null,
      products,
      ...viewerOf(),
    };
  }
  // A team shell knows the team's settings (its products and their repositories, the approvers, Jira) once the team is
  // read. Opened directly, no other page read them first: read them here (the one memoized team load), or the product
  // repositories are unknown and their explorations handed to developers never show.
  await teamSettings();
  const R = `/repos/${repo}`;
  const issuePath = (label: string) => `${R}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100&sort=created&direction=desc`;
  // Loaded on demand, as the home does: the product repositories' reads and the site's products.
  const productRepos = import('./product-repos').catch(() => null);
  const [requests, builds, pulls, sessions, productPulls] = await Promise.all([
    list<RestIssue>(repo, 'requests', issuePath(REQUEST_LABEL), slimIssue),
    list<RestIssue>(repo, 'builds', issuePath(BUILD_REQUEST_LABEL), slimIssue),
    list<RestPull>(repo, 'pulls', `${R}/pulls?state=all&per_page=100&sort=updated&direction=desc`, slimPull),
    readSessions(repo),
    // The open explorations of products with their own repository: the same read as Changes and the home.
    productRepos.then((m) => m?.productPulls() ?? []).catch(() => []),
  ]);
  const seen = new Set<number>();
  // The issues list also answers pull requests carrying the label (a library branch from Figma): they come from the
  // pull request list instead.
  const issues = [...requests.data, ...builds.data].filter((i) => !i.pull_request && !seen.has(i.number) && seen.add(i.number));
  // Builders and senders by their profile names, as Branches shows them (people.ts), not by their GitHub login.
  // Who asked Claude for a fix too (the connector grant's GitHub login): a name the server wrote stays as written.
  const askers = sessions.flatMap((s) => s.steps.map((x) => x.by)).filter(isLoginLike);
  const explored = [...pulls.data, ...(productPulls as unknown as RestPull[])];
  const doneBy = explored.map((p) => parseExplorationBody(p.body)?.doneBy);
  const logins = [...issues.flatMap((i) => [i.user?.login, ...(i.assignees ?? []).map((a) => a.login)]), ...pulls.data.map((p) => p.user?.login), ...askers, ...doneBy].filter((l): l is string => Boolean(l));
  // The lifecycle (lib/review-state): the reviews of the few pull requests in review (open explorations handed to
  // developers that are no longer drafts, build requests in review), read at once and cached; and the library release
  // (the release pull request the changesets action keeps open, already in the list read) for In the next release.
  const assembled = assembleBuildRequests({ issues: issues.map(toBuildIssue), pulls: pulls.data.map(toBuildPull), now, nameOf: (l) => l });
  const inReview = new Set(assembled.filter((v) => v.status === 'in-review' && v.pull?.state === 'open').map((v) => v.pull!.number));
  const toRead = [
    ...explored.filter((p) => needsReviewRead(p) || (!p.product && inReview.has(Number(p.number)) && p.state === 'open' && p.draft === false)),
  ].map((p) => {
    const own = (p as RestPull & { repo?: string }).repo;
    return { key: p.product ? `${p.product}#${p.number}` : String(p.number), repo: p.product && own ? own : repo, number: Number(p.number), version: p.updated_at ?? p.head?.sha ?? null };
  });
  // The developers' tasks of the design copy's explorations handed to them (one read each, a few at most).
  const taskUrls = [...new Set(explored.filter((p) => p.state === 'open').map((p) => parseExplorationBody(p.body)?.task).filter((u): u is string => Boolean(u)))];
  // Claude's fixes whose pull request is older than the list read: one read each, so a merged one reads Shipped.
  const [names, reviews, tasks, olderFixPulls] = await Promise.all([
    lookUpNames([...new Set(logins)]).catch(() => knownNames()),
    readReviews(toRead.filter((x, i, all) => all.findIndex((y) => y.key === x.key) === i)),
    // Their comments are not read here: Being built says where it stands, the exploration page shows a question.
    Promise.all(taskUrls.map(async (u) => [u, await readDesignTask(u, { comments: false })] as const)).then((all) => new Map(all)),
    readFixPulls(R, missingFixPulls(sessions, pulls.data)),
  ]);
  const nameOf = (l: string) => personName(l, names);
  // Products added from their address: team members copy their developers a message, with the preview's screenshot
  // when Bridge kept one (one raw file for every exploration, no GitHub API call).
  const products = (await productRepos)?.configuredProducts() ?? DEFAULT_PRODUCTS;
  const member = teamMember({ emailMember: Boolean(currentContributor()), signedIn: Boolean(hasWorkingToken() && currentViewer()), access: currentAccess()?.state ?? null });
  const shots = new Map<string, string>();
  if (member) {
    const elsewhere = explored.filter((p) => p.product && p.state === 'open' && liveAddressOf(products.find((x) => x.key === p.product)));
    await Promise.all(
      elsewhere.map((p) =>
        previewShotOf({ number: Number(p.number), product: p.product })
          .then((s) => s && shots.set(`${p.product}#${p.number}`, s.src))
          .catch(() => undefined),
      ),
    );
  }
  const fixPulls = [...pulls.data, ...olderFixPulls];
  const releaseBody = pulls.data.find((p) => p.state === 'open' && /^changeset-release\//.test(p.head?.ref ?? ''))?.body ?? null;
  const ids = releaseBody ? libraryRelease(parseReleaseBody(releaseBody), libraryScope()).ids : new Set<string>();
  const nextRelease = (p: RestPull) => inNextRelease(p.merge_commit_sha, ids);
  const viewer = currentViewer()?.login ?? null;
  const lifecycle = { reviews: (k: string) => reviews.get(k) ?? null, nextRelease, nameOf, viewer };
  const task = (u: string) => tasks.get(u) ?? null;
  return {
    views: withProducts(withLifecycle(assembleBuildRequests({ issues: issues.map(toBuildIssue), pulls: pulls.data.map(toBuildPull), now, nameOf }), { pulls: pulls.data, ...lifecycle }), { issues, pulls: pulls.data, products }),
    bodies: new Map(issues.map((i) => [i.number, i.body ?? ''])),
    sample: false,
    stale: requests.stale || builds.stale || pulls.stale,
    nameOf,
    jiraBase: jiraBase(),
    fixes: withProducts(fixRows(sessions, fixPulls, now, nameOf), { pulls: fixPulls, products }),
    pulls: fixPulls,
    explorations: explorationBuildRows(explored, { products, now, approvers: approversNow(), ...lifecycle, task, member, shot: (k) => shots.get(k) ?? null }),
    products,
    ...viewerOf(),
  };
}

/** The site's products, once its settings were read; the defaults otherwise. */
function sitesProducts(): ProductConfig[] {
  try {
    const site = siteConfig() as { products?: ProductConfig[] };
    return site.products?.length ? site.products : DEFAULT_PRODUCTS;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

/** Who You is, as on Changes: the signed-in person, else the demo persona whose seat a visitor takes on the sample team. */
function viewerOf(): Pick<BuildData, 'viewer' | 'viewerName'> {
  const me = currentViewer();
  const login = me?.login ?? currentContributor()?.email ?? null;
  if (login) return { viewer: login, viewerName: me?.name ?? null };
  try {
    return { viewer: isSampleTeam(repoName()) ? ((siteConfig() as { demo?: { viewer?: string } }).demo?.viewer?.trim().toLowerCase() ?? null) : null, viewerName: null };
  } catch {
    return { viewer: null, viewerName: null };
  }
}

/** On a team shell, the team's settings read (scripts/team-data, memoized per page); a failed read keeps the defaults. */
async function teamSettings(): Promise<void> {
  if (!isHosted()) return;
  await import('./team-data').then((m) => m.loadTeamData()).catch(() => null);
}

/** The fix pull requests the list did not return, read at once; one GitHub refuses is left out (the row stays In review). */
async function readFixPulls(R: string, numbers: readonly number[]): Promise<RestPull[]> {
  const read = await Promise.all(numbers.map((n) => ghGet<RestPull>(`${R}/pulls/${n}`).then((f) => slimPull(f.data), () => null)));
  return read.filter((p): p is RestPull => p !== null);
}

/** The design approvers, teams expanded once read (none when the roles cannot be read). */
function approversNow(): string[] {
  try {
    return siteApprovers().design;
  } catch {
    return [];
  }
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
