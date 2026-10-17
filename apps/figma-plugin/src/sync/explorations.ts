// Explorations from Push ("Try in an exploration"): list the running ones, start a new one, and the target a push
// sends to. The rules and the GitHub calls are @bridge-ds/core's (explorations.ts, explorations-github.ts), the same
// as Studio, the CLI and the MCP server. Independent of the DOM and of figma.*.

import {
  type BridgeConfig,
  type ExplorationTryIt,
  type GitHubClient,
  explorationProblems,
  explorationShareMessage,
  explorationTryItOnGitHub,
  listExplorationsOnGitHub,
  startExplorationOnGitHub,
} from '@bridge-ds/core';
import type { ExplorationTarget } from './flows';

/**
 * A running exploration as Push shows it: its name, its branch and draft pull request, its previews. The install
 * command is not here on purpose: it comes from the pull request's preview comment (`explorationTryIt`), never a guess.
 */
export interface ExplorationChoice {
  name: string;
  purpose: string;
  /** `explore/<slug>`. */
  branch: string;
  slug: string;
  number: number;
  url: string;
  previews: { app: string; label: string; url: string }[];
}

const settingsOf = (config: BridgeConfig | undefined, base: string) => ({ base, packages: config?.previews?.packages ?? [], apps: config?.previews?.apps ?? {} });

/** Running explorations (open draft pull requests labeled `exploration` on `explore/*`), newest activity first. */
export async function runningExplorations(client: GitHubClient, config: BridgeConfig | undefined, base: string): Promise<ExplorationChoice[]> {
  const list = await listExplorationsOnGitHub(client, settingsOf(config, base), { state: 'open' });
  return list
    .filter((e) => e.status === 'active')
    .map((e) => ({ name: e.name, purpose: e.purpose, branch: e.branch, slug: e.slug, number: e.number, url: e.url, previews: e.previews }));
}

/** Problems with a new exploration's name and purpose, as sentences. Empty when it can start. */
export const newExplorationProblems = (name: string, purpose: string) => explorationProblems({ name, purpose });

/** Starts an exploration from Push: the branch from the base with its note, and the draft pull request. */
export async function startExploration(client: GitHubClient, config: BridgeConfig | undefined, base: string, input: { name: string; purpose: string; author?: string | undefined }): Promise<ExplorationChoice> {
  const name = input.name.trim();
  const purpose = input.purpose.trim();
  const s = await startExplorationOnGitHub(client, { name, purpose, useCase: 'other', ...(input.author ? { author: input.author } : {}) }, settingsOf(config, base));
  return { name, purpose, branch: s.branch, slug: s.slug, number: s.pr, url: s.url, previews: s.previews };
}

/** What a push sends to. */
export const targetOf = (e: ExplorationChoice): ExplorationTarget => ({ branch: e.branch, pr: { number: e.number, url: e.url, title: `Exploration: ${e.name}`, draft: true, headRef: e.branch } });

/** A branch preview as the result screen shows it: the product first, then the library and the workbench. */
export interface TryItLink {
  app: string;
  /** Designer words: the app's name from bridge.config.json for the product, "Library" and "Workbench" for the others. */
  label: string;
  hint: string;
  url: string;
}

const LINK_ORDER = ['admin', 'docs', 'storybook'];
const LINK_WORDS: Record<string, { label?: string; hint: string }> = {
  admin: { hint: 'The product with your edits' },
  docs: { label: 'Library', hint: 'Component pages and tokens' },
  storybook: { label: 'Workbench', hint: 'Every component state' },
};

/** The previews of an exploration in the order a designer tries them: the product (admin demo) first. */
export function tryItLinks(e: Pick<ExplorationChoice, 'previews'>): TryItLink[] {
  return [...e.previews]
    .sort((a, b) => (LINK_ORDER.indexOf(a.app) + 1 || 99) - (LINK_ORDER.indexOf(b.app) + 1 || 99))
    .map((p) => ({ app: p.app, label: LINK_WORDS[p.app]?.label ?? p.label, hint: LINK_WORDS[p.app]?.hint ?? '', url: p.url }));
}

/**
 * Where the exploration's test build stands: the install command from the pull request's sticky preview comment
 * (what the workflow actually published), or "building" until that comment matches the branch head.
 */
export const explorationTryIt = (client: GitHubClient, e: Pick<ExplorationChoice, 'number' | 'branch'>): Promise<ExplorationTryIt> => explorationTryItOnGitHub(client, e);

/** The message "Share with a developer" copies: the working command when it is ready, the previews, the pull request. */
export function shareMessage(e: Pick<ExplorationChoice, 'name' | 'branch' | 'url' | 'previews'>, tryIt: ExplorationTryIt | undefined): string {
  return explorationShareMessage({
    name: e.name,
    branch: e.branch,
    url: e.url,
    command: tryIt?.state === 'ready' ? tryIt.command : undefined,
    previews: tryItLinks(e).map((l) => ({ label: l.label, url: l.url })),
  });
}
