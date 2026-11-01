// Starting an exploration from Studio, shared by Changes > Explorations ("Start an exploration", also from a request)
// and the Components drawer ("Change this component", Add a variant or option): the core helpers the MCP server and
// the CLI run (startExplorationOnGitHub, linkRequestToExplorationOnGitHub), with the viewer's own token. The page
// embeds its preview settings as #bridge-branches. In suggest mode nothing starts: an exploration is a branch.
import {
  EXPLORATION_PREFIX,
  GitHubError,
  linkRequestToExplorationOnGitHub,
  productRepoAccess,
  startExplorationOnGitHub,
  type ExplorationSettings,
  type ExplorationUseCase,
  type StartedExploration,
} from '@bridge-ds/core';
import type { ExplorationsConfig } from '../lib/explorations-view';
import { currentContributor, getToken, readRepo, studioClient } from './github-session';
import { SuggestOnlyError, changesModeOnPage } from './changes-mode';
import { EXPLORATION_SUGGEST_INSTEAD } from '../lib/gh-wording';

/** The repository and preview settings the page embeds (#bridge-branches), else the site repository alone. */
export function explorationsConfig(): ExplorationsConfig {
  const repo = readRepo();
  try {
    const b = JSON.parse(document.getElementById('bridge-branches')?.textContent || '{}') as Partial<ExplorationsConfig>;
    return { owner: b.owner ?? repo.owner, repo: b.repo ?? repo.repo, defaultBranch: b.defaultBranch ?? repo.defaultBranch, apps: b.apps ?? {}, packages: b.packages ?? [], production: b.production ?? {} };
  } catch {
    return { owner: repo.owner, repo: repo.repo, defaultBranch: repo.defaultBranch, apps: {}, packages: [] };
  }
}

/** A client that writes only to exploration branches, never to the default one. */
export const explorationClient = (cfg: ExplorationsConfig) =>
  studioClient(`${cfg.owner}/${cfg.repo}`, getToken() ?? '', { protectedBranches: [cfg.defaultBranch], branchPrefix: EXPLORATION_PREFIX });

export interface LinkedStart {
  started: StartedExploration;
  /** The request linked to it, when it was started for one: its warnings, or why the link failed. */
  link?: { warnings: string[] } | { error: string };
}

/**
 * Starts an exploration and, when it answers a request, links the request to it the way
 * `bridge request create --exploration` does, with the starter assigned. A failed link does not undo the start.
 */
export async function startLinkedExploration(
  cfg: ExplorationsConfig,
  e: { name: string; purpose: string; useCase?: ExplorationUseCase; author?: string; jira?: string },
  request?: { number: number; title: string } | null,
  /** More labels for it: the product ones (productMarks from @bridge-ds/core), as the CLI and MCP server write. */
  labels: string[] = [],
  /** Started in a product's own repository: what its pull request body says (startInProductRepo passes it). */
  inProduct?: ExplorationSettings['inProduct'],
): Promise<LinkedStart> {
  // An exploration is a branch: a repository in suggest mode gets none from Bridge, before any GitHub call.
  if (changesModeOnPage() === 'suggest') throw new SuggestOnlyError('start explorations', EXPLORATION_SUGGEST_INSTEAD);
  const gh = explorationClient(cfg);
  const started = await startExplorationOnGitHub(
    gh,
    { name: e.name, purpose: e.purpose, source: 'studio', ...(e.useCase ? { useCase: e.useCase } : {}), ...(e.author ? { author: e.author } : {}), ...(e.jira ? { jira: e.jira } : {}) },
    { base: cfg.defaultBranch, packages: cfg.packages, apps: cfg.apps, ...(request ? { requests: [request] } : {}), ...(labels.length ? { labels } : {}), ...(inProduct ? { inProduct } : {}) },
  );
  if (!request) return { started };
  try {
    const l = await linkRequestToExplorationOnGitHub(gh, request.number, started.branch, { assignee: e.author ?? null });
    return { started, link: { warnings: l.warnings } };
  } catch (err) {
    return { started, link: { error: (err as Error).message } };
  }
}

/**
 * Bridge cannot open branches in the product's own repository: not connected (or out of the token's reach), or read
 * only; for a product explored in the design team's copy, `no-copy` when the copy is not made yet.
 */
export interface ProductRepoBlocked {
  blocked: 'not-connected' | 'read-only' | 'no-copy';
}

/**
 * Starts a product feature in the product's own repository (productRepoOf from @bridge-ds/core), with the viewer's
 * token: one read for its default branch and the right to push, then the same start as in the library repository.
 * When Bridge cannot reach it, nothing is written and the dialog asks an admin to connect it instead.
 */
export async function startInProductRepo(
  repo: string,
  e: { name: string; purpose: string; useCase?: ExplorationUseCase; author?: string; jira?: string },
  labels: string[],
  inProduct: NonNullable<ExplorationSettings['inProduct']>,
): Promise<LinkedStart | ProductRepoBlocked> {
  const [owner, name] = repo.split('/') as [string, string];
  // An email member explores in the design team's copy through Bridge (api/contribute planProductCall), never in the
  // developers' own repository. Their right to push is Bridge's to decide, so only the default branch is read here.
  if (currentContributor()) {
    if (!inProduct.copyOf) return { blocked: 'read-only' };
    let base: string;
    try {
      base = (await studioClient(repo, getToken() ?? '').getRepo()).defaultBranch;
    } catch (err) {
      // No copy yet, or Bridge not on it: making one is an admin's (the dialog asks one), never an email member's.
      if (err instanceof GitHubError && (err.status === 404 || err.status === 403 || err.status === 409) && err.auth !== 'rejected') return { blocked: 'read-only' };
      throw err;
    }
    return startLinkedExploration({ owner, repo: name, defaultBranch: base, apps: {}, packages: [] }, e, null, labels, inProduct);
  }
  const access = await productRepoAccess(studioClient(repo, getToken() ?? ''));
  // The design team's copy GitHub does not show: not made yet (the dialog offers to make it).
  if (!access.ok) return { blocked: inProduct.copyOf && access.reason === 'not-connected' ? 'no-copy' : access.reason };
  return startLinkedExploration({ owner, repo: name, defaultBranch: access.base, apps: {}, packages: [] }, e, null, labels, inProduct);
}
