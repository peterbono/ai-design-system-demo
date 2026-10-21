// Starting an exploration from Studio, shared by Changes > Explorations ("Start an exploration", also from a request)
// and the Components drawer ("Change this component", Add a variant or option): the core helpers the MCP server and
// the CLI run (startExplorationOnGitHub, linkRequestToExplorationOnGitHub), with the viewer's own token. The page
// embeds its preview settings as #bridge-branches. In suggest mode nothing starts: an exploration is a branch.
import { EXPLORATION_PREFIX, linkRequestToExplorationOnGitHub, startExplorationOnGitHub, type ExplorationUseCase, type StartedExploration } from '@bridge-ds/core';
import type { ExplorationsConfig } from '../lib/explorations-view';
import { getToken, readRepo, studioClient } from './github-session';
import { SuggestOnlyError, changesModeOnPage } from './changes-mode';
import { EXPLORATION_SUGGEST_INSTEAD } from '../lib/gh-wording';

/** The repository and preview settings the page embeds (#bridge-branches), else the site repository alone. */
export function explorationsConfig(): ExplorationsConfig {
  const repo = readRepo();
  try {
    const b = JSON.parse(document.getElementById('bridge-branches')?.textContent || '{}') as Partial<ExplorationsConfig>;
    return { owner: b.owner ?? repo.owner, repo: b.repo ?? repo.repo, defaultBranch: b.defaultBranch ?? repo.defaultBranch, apps: b.apps ?? {}, packages: b.packages ?? [] };
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
): Promise<LinkedStart> {
  // An exploration is a branch: a repository in suggest mode gets none from Bridge, before any GitHub call.
  if (changesModeOnPage() === 'suggest') throw new SuggestOnlyError('start explorations', EXPLORATION_SUGGEST_INSTEAD);
  const gh = explorationClient(cfg);
  const started = await startExplorationOnGitHub(
    gh,
    { name: e.name, purpose: e.purpose, source: 'studio', ...(e.useCase ? { useCase: e.useCase } : {}), ...(e.author ? { author: e.author } : {}), ...(e.jira ? { jira: e.jira } : {}) },
    { base: cfg.defaultBranch, packages: cfg.packages, apps: cfg.apps, ...(request ? { requests: [request] } : {}), ...(labels.length ? { labels } : {}) },
  );
  if (!request) return { started };
  try {
    const l = await linkRequestToExplorationOnGitHub(gh, request.number, started.branch, { assignee: e.author ?? null });
    return { started, link: { warnings: l.warnings } };
  } catch (err) {
    return { started, link: { error: (err as Error).message } };
  }
}
