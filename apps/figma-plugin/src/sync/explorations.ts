// Explorations from Push ("Try in an exploration"): list the running ones, start a new one, and the target a push
// sends to. The rules and the GitHub calls are @bridge-ds/core's (explorations.ts, explorations-github.ts), the same
// as Studio, the CLI and the MCP server. Independent of the DOM and of figma.*.

import {
  type BranchPreview,
  type BridgeConfig,
  type ExplorationTestBuild,
  type ExplorationTryIt,
  type GitHubClient,
  explorationProblems,
  explorationShareMessage,
  explorationTestBuildOnGitHub,
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
  /** The URL Vercel reports. Null while it has not reported one (a long branch alias it shortens with a hash). */
  url: string | null;
  /** The build of the latest commit: `building` while Vercel deploys it, `unknown` when nothing reports it. */
  state: BranchPreview['state'];
}

const LINK_ORDER = ['admin', 'docs', 'storybook'];
const LINK_WORDS: Record<string, { label?: string; hint: string }> = {
  admin: { hint: 'The product with your edits' },
  docs: { label: 'Library', hint: 'Component pages and tokens' },
  storybook: { label: 'Workbench', hint: 'Every component state' },
};

/**
 * The previews of an exploration in the order a designer tries them: the product (admin demo) first. `real` are the
 * previews read from GitHub (`explorationTestBuild`); before that read, the template URLs Vercel cannot have shortened.
 */
export function tryItLinks(e: Pick<ExplorationChoice, 'previews'>, real?: BranchPreview[] | undefined): TryItLink[] {
  const list: { app: string; label: string; url: string | null; state: BranchPreview['state'] }[] = real?.length ? real : e.previews.map((p) => ({ ...p, state: 'unknown' as const }));
  return [...list]
    .sort((a, b) => (LINK_ORDER.indexOf(a.app) + 1 || 99) - (LINK_ORDER.indexOf(b.app) + 1 || 99))
    .map((p) => ({ app: p.app, label: LINK_WORDS[p.app]?.label ?? p.label, hint: LINK_WORDS[p.app]?.hint ?? '', url: p.url, state: p.state }));
}

/**
 * Where the exploration's test build stands: the install command from the pull request's sticky preview comment
 * (what the workflow actually published), or "building" until that comment matches the branch head.
 */
export const explorationTryIt = (client: GitHubClient, e: Pick<ExplorationChoice, 'number' | 'branch'>): Promise<ExplorationTryIt> => explorationTryItOnGitHub(client, e);

/** The install command and the real preview URLs in one read (the result screen polls it). */
export const explorationTestBuild = (client: GitHubClient, config: BridgeConfig | undefined, e: Pick<ExplorationChoice, 'number' | 'branch'>): Promise<ExplorationTestBuild> =>
  explorationTestBuildOnGitHub(client, e, config);

/** The message "Share with a developer" copies: the working command when it is ready, the previews, the pull request. */
export function shareMessage(e: Pick<ExplorationChoice, 'name' | 'branch' | 'url' | 'previews'>, tryIt: ExplorationTryIt | undefined, real?: BranchPreview[] | undefined): string {
  return explorationShareMessage({
    name: e.name,
    branch: e.branch,
    url: e.url,
    command: tryIt?.state === 'ready' ? tryIt.command : undefined,
    previews: tryItLinks(e, real).flatMap((l) => (l.url ? [{ label: l.label, url: l.url }] : [])),
  });
}

export const TEST_BUILD_POLL_MS = 15_000;
export const TEST_BUILD_TIMEOUT_MS = 10 * 60_000;

export interface TestBuildPollerOptions {
  read: () => Promise<ExplorationTestBuild>;
  /** Each successful read. */
  onUpdate: (t: ExplorationTestBuild) => void;
  /** 10 minutes without everything ready. Polling has stopped; start() polls again. */
  onTimeout: () => void;
  /** A read failed; polling goes on. */
  onError?: ((message: string) => void) | undefined;
  /** False while the result screen is not shown: the tick reads nothing (and keeps counting toward the timeout). */
  isOpen?: (() => boolean) | undefined;
  intervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((handle: unknown) => void) | undefined;
}

/**
 * Reads the exploration's test build every 15 seconds, for up to 10 minutes, until the install command is ready (or
 * failed) and every preview has its URL and a finished deploy.
 */
export class TestBuildPoller {
  private handle: unknown;
  private startedAt = 0;
  private running = false;
  private busy = false;

  constructor(private readonly o: TestBuildPollerOptions) {}

  get active(): boolean {
    return this.running;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private schedule(): void {
    const set = this.o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.handle = set(() => void this.tick(), this.o.intervalMs ?? TEST_BUILD_POLL_MS);
  }

  /** Starts (or restarts) polling; the 10 minutes count from now. */
  start(): void {
    this.stop();
    this.running = true;
    this.startedAt = this.now();
    this.schedule();
  }

  stop(): void {
    if (this.handle !== undefined) (this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.handle);
    this.handle = undefined;
    this.running = false;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    this.handle = undefined;
    const done = this.o.isOpen && !this.o.isOpen() ? false : await this.check();
    if (done || !this.running) return;
    if (this.now() - this.startedAt >= (this.o.timeoutMs ?? TEST_BUILD_TIMEOUT_MS)) {
      this.stop();
      this.o.onTimeout();
      return;
    }
    this.schedule();
  }

  /** Reads once. True when everything is settled (polling stops). */
  async check(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const t = await this.o.read();
      if (t.settled) this.stop();
      this.o.onUpdate(t);
      return t.settled;
    } catch (err) {
      this.o.onError?.(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this.busy = false;
    }
  }
}
