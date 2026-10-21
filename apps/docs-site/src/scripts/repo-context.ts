// Which repository this page works on, and its settings (multi-team plan, sections 1 and 0.2).
//
// Two modes:
// - Self-hosted (today's site): the layout embeds the build checkout's bridge.config.json as <script id="bridge-repo">
//   (lib/config.ts siteRepoJson). The repository and its settings come from there, exactly as before.
// - Hosted (team shells, <html data-hosted>): the repository comes from the address, /studio/<owner>/<repo>/... (or
//   the escape form /studio/~/<owner>/<repo>/...), and its settings from the team's own bridge.config.json, read at
//   the default branch head by loadTeamModel below.
//
// Every browser reader of the repository or its settings goes through repoContext() and siteConfig() here, never
// through #bridge-repo directly, so the same Studio code serves both modes.

import {
  gitHubSource,
  GitHubError,
  loadRepoModel,
  snapshotIsFresh,
  snapshotSource,
  type GitHubClient,
  type RepoModel,
  type RepoModelOptions,
  type RepoSnapshot,
  type SiteRepo,
} from '@bridge-ds/core';
import { blobCacheFor, getCachedModel, putCachedModel } from './repo-cache';
import { isHosted, repoFromPath } from '../lib/team-path';

export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** A team shell: the repository comes from the address, its settings from GitHub at runtime. */
  hosted: boolean;
}

/** The repository a page without any context works on (the demo), as readRepo always did. */
export const FALLBACK_REPO = { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main' } as const;

// The address parsing lives in lib/team-path.ts (pure, shared with studioHref); re-exported for existing callers.
export { isHosted, repoFromPath };

/** The settings a team shell learned from GitHub (loadTeamModel), keyed by "owner/repo" (lower case). */
const runtime = new Map<string, { defaultBranch?: string; site?: SiteRepo }>();
const key = (owner: string, repo: string) => `${owner}/${repo}`.toLowerCase();

/** The settings embedded by the layout (#bridge-repo), {} without one or when it does not parse. */
function embedded(): Partial<SiteRepo> {
  try {
    const el = typeof document === 'undefined' ? null : document.getElementById('bridge-repo');
    const v = JSON.parse(el?.textContent || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<SiteRepo>) : {};
  } catch {
    return {};
  }
}

/** The team a hosted page is on, null when the address is not a team address. */
function hostedRepo(): { owner: string; repo: string } | null {
  return isHosted() && typeof location !== 'undefined' ? repoFromPath(location.pathname) : null;
}

/** The repository this page works on. Synchronous: on a team shell the default branch is known once read. */
export function repoContext(): RepoContext {
  const team = hostedRepo();
  if (team) {
    const known = runtime.get(key(team.owner, team.repo));
    return { ...team, defaultBranch: known?.defaultBranch ?? known?.site?.defaultBranch ?? FALLBACK_REPO.defaultBranch, hosted: true };
  }
  const site = embedded();
  return {
    owner: typeof site.owner === 'string' && site.owner ? site.owner : FALLBACK_REPO.owner,
    repo: typeof site.repo === 'string' && site.repo ? site.repo : FALLBACK_REPO.repo,
    defaultBranch: typeof site.defaultBranch === 'string' && site.defaultBranch ? site.defaultBranch : FALLBACK_REPO.defaultBranch,
    hosted: false,
  };
}

/**
 * The repository's settings (roles, owners, rights, mode, products, integrations), as far as they are known: the
 * embedded config in self-hosted mode; on a team shell, the team's config once loadTeamModel has read it ({} before,
 * so every reader falls back to its defaults). Read on each call: cheap, and tests swap the page between calls.
 */
export function siteConfig(): Partial<SiteRepo> {
  const team = hostedRepo();
  if (!team) return embedded();
  const site = runtime.get(key(team.owner, team.repo))?.site;
  return site ? { ...site, owner: team.owner, repo: team.repo } : {};
}

/** Records what GitHub said about a team's repository (default branch, settings) for repoContext and siteConfig. */
export function rememberRepo(owner: string, repo: string, facts: { defaultBranch?: string; site?: SiteRepo }) {
  const k = key(owner, repo);
  runtime.set(k, { ...runtime.get(k), ...facts });
  // Readers that painted before the team's settings were known (the team chip, Settings > Your team) repaint.
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('bridge:team-model', { detail: { owner, repo } }));
}

/** Where a team model came from: this browser's cache, the team's published snapshot, or the repository itself. */
export type TeamModelSource = 'cache' | 'snapshot' | 'live';

export interface TeamModel {
  model: RepoModel;
  /** The default branch head the model was read at. */
  sha: string;
  defaultBranch: string;
  private: boolean;
  /** Served from this browser's cache (no file read). */
  cached: boolean;
  source: TeamModelSource;
  /** The snapshot the model was computed from, when it was (source "snapshot"). */
  snapshot?: RepoSnapshot;
}

/**
 * Reads the team's published snapshot (bridge-data branch), null when there is none or it cannot be used. Called only
 * on a cache miss, with what GET /repos said, so a private repository can read it through the API.
 */
export type SnapshotReader = (client: GitHubClient, repo: { private: boolean }) => Promise<RepoSnapshot | null>;

/** Where loadTeamModel keeps models and bodies. Swapped in tests. */
export interface ModelCache {
  get(repo: string, sha: string): Promise<RepoModel | undefined>;
  put(repo: string, sha: string, model: RepoModel, opts: { private: boolean }): Promise<void>;
  blobs: typeof blobCacheFor;
}

const indexedDbCache: ModelCache = { get: getCachedModel, put: putCachedModel, blobs: blobCacheFor };

/**
 * The repo model of `client`'s repository at its default branch head. Signed in, the client carries the visitor's
 * token and bodies come from the API; anonymous (no token), from the raw host of a public repository. Costs two API
 * calls (GET /repos, the branch head) when the head is cached, one more (the tree) plus the bodies when not.
 * GitHub errors (404, rate limit, a rejected token) are thrown for the caller to show (access states, stale data).
 */
export async function loadTeamModel(
  client: GitHubClient,
  opts: RepoModelOptions & { cache?: ModelCache; snapshot?: SnapshotReader } = {},
): Promise<TeamModel> {
  const { cache = indexedDbCache, snapshot: readSnapshot, ...modelOptions } = opts;
  const repo = `${client.owner}/${client.name}`;
  const info = await client.getRepo();
  const sha = await client.getBranchSha(info.defaultBranch);
  if (!sha) throw new GitHubError(404, `${repo} has no ${info.defaultBranch} branch.`);
  const remember = (model: RepoModel) =>
    rememberRepo(client.owner, client.name, { defaultBranch: info.defaultBranch, site: { ...model.site, owner: client.owner, repo: client.name, defaultBranch: info.defaultBranch } });

  const kept = await cache.get(repo, sha);
  if (kept) {
    remember(kept);
    return { model: kept, sha, defaultBranch: info.defaultBranch, private: info.private, cached: true, source: 'cache' };
  }
  // The team's snapshot first, when it was computed from this very head: one raw read instead of the tree and
  // every body. A missing, broken or older snapshot falls through to the live read.
  const snap = readSnapshot ? await readSnapshot(client, { private: info.private }).catch(() => null) : null;
  if (snap && snapshotIsFresh(snap, sha)) {
    const model = await loadRepoModel(snapshotSource(snap), modelOptions);
    await cache.put(repo, sha, model, { private: info.private });
    remember(model);
    return { model, sha, defaultBranch: info.defaultBranch, private: info.private, cached: false, source: 'snapshot', snapshot: snap };
  }
  const source = gitHubSource(client, sha, { blobCache: cache.blobs(repo, { private: info.private }) });
  const model = await loadRepoModel(source, modelOptions);
  await cache.put(repo, sha, model, { private: info.private });
  remember(model);
  return { model, sha, defaultBranch: info.defaultBranch, private: info.private, cached: false, source: 'live' };
}
