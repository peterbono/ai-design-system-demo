// Explorations from Push ("Try in an exploration"): list the running ones, start a new one, and the target a push
// sends to. The rules and the GitHub calls are @bridge-ds/core's (explorations.ts, explorations-github.ts), the same
// as Studio, the CLI and the MCP server. Independent of the DOM and of figma.*.

import {
  type BridgeConfig,
  type ExplorationInstall,
  type GitHubClient,
  explorationProblems,
  listExplorationsOnGitHub,
  startExplorationOnGitHub,
} from '@bridge-ds/core';
import type { ExplorationTarget } from './flows';

/** A running exploration as Push shows it: its name, its branch and draft pull request, how to try it. */
export interface ExplorationChoice {
  name: string;
  purpose: string;
  /** `explore/<slug>`. */
  branch: string;
  slug: string;
  number: number;
  url: string;
  previews: { app: string; label: string; url: string }[];
  install: ExplorationInstall;
}

const settingsOf = (config: BridgeConfig | undefined, base: string) => ({ base, packages: config?.previews?.packages ?? [], apps: config?.previews?.apps ?? {} });

/** Running explorations (open draft pull requests labeled `exploration` on `explore/*`), newest activity first. */
export async function runningExplorations(client: GitHubClient, config: BridgeConfig | undefined, base: string): Promise<ExplorationChoice[]> {
  const list = await listExplorationsOnGitHub(client, settingsOf(config, base), { state: 'open' });
  return list
    .filter((e) => e.status === 'active')
    .map((e) => ({ name: e.name, purpose: e.purpose, branch: e.branch, slug: e.slug, number: e.number, url: e.url, previews: e.previews, install: e.install }));
}

/** Problems with a new exploration's name and purpose, as sentences. Empty when it can start. */
export const newExplorationProblems = (name: string, purpose: string) => explorationProblems({ name, purpose });

/** Starts an exploration from Push: the branch from the base with its note, and the draft pull request. */
export async function startExploration(client: GitHubClient, config: BridgeConfig | undefined, base: string, input: { name: string; purpose: string; author?: string | undefined }): Promise<ExplorationChoice> {
  const name = input.name.trim();
  const purpose = input.purpose.trim();
  const s = await startExplorationOnGitHub(client, { name, purpose, useCase: 'other', ...(input.author ? { author: input.author } : {}) }, settingsOf(config, base));
  return { name, purpose, branch: s.branch, slug: s.slug, number: s.pr, url: s.url, previews: s.previews, install: s.install };
}

/** What a push sends to. */
export const targetOf = (e: ExplorationChoice): ExplorationTarget => ({ branch: e.branch, pr: { number: e.number, url: e.url, title: `Exploration: ${e.name}`, draft: true, headRef: e.branch } });
