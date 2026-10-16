// Branches page data layer: what a design system branch offers for testing (preview deploys, snapshot packages,
// CI, visual impact). Pure functions over GitHub API shapes, shared by the client script and its tests.
import { installCommand, previewLinks, snapshotUrl, type PreviewApps } from '@bridge-ds/core';
import { summarizeCi, type CheckRunLike, type CiState } from './review-rules';

export interface BranchesConfig {
  owner: string;
  repo: string;
  defaultBranch: string;
  apps: PreviewApps;
  packages: string[];
}

export interface PullLike {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  state?: string;
  merged_at?: string | null;
  user: { login: string } | null;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  updated_at: string;
}

export interface BranchEntry {
  pr: number | null;
  title: string;
  url: string;
  branch: string;
  sha: string;
  draft: boolean;
  author: string | null;
  updatedAt: string | null;
  /** Fork PRs get no snapshot (the workflow cannot publish from a fork). */
  fromFork: boolean;
  previews: { app: keyof PreviewApps; label: string; url: string }[];
  /** One command that installs every snapshot package of this commit; null when snapshots do not apply. */
  install: string | null;
  /** Per-branch tokens.css for the staging override, when the docs preview is configured. */
  tokensCss: string | null;
}

export function pullEntry(pull: PullLike, cfg: BranchesConfig): BranchEntry {
  const fromFork = Boolean(pull.head.repo && pull.head.repo.full_name.toLowerCase() !== `${cfg.owner}/${cfg.repo}`.toLowerCase());
  const ctx = { branch: pull.head.ref, pr: pull.number, sha: pull.head.sha };
  const previews = fromFork ? [] : previewLinks(cfg.apps, ctx);
  const docs = previews.find((p) => p.app === 'docs');
  return {
    pr: pull.number,
    title: pull.title,
    url: pull.html_url,
    branch: pull.head.ref,
    sha: pull.head.sha,
    draft: pull.draft,
    author: pull.user?.login ?? null,
    updatedAt: pull.updated_at,
    fromFork,
    previews,
    install: fromFork || !cfg.packages.length ? null : installCommand(cfg.packages.map((p) => snapshotUrl(cfg.owner, cfg.repo, p, pull.head.sha))),
    tokensCss: docs ? new URL('tokens.css', docs.url).href : null,
  };
}

/** A branch without an open pull request: deploy previews only (snapshots are published per PR commit). */
export function branchEntry(branch: { name: string; commit: { sha: string } }, cfg: BranchesConfig): BranchEntry {
  const previews = previewLinks(cfg.apps, { branch: branch.name, sha: branch.commit.sha });
  const docs = previews.find((p) => p.app === 'docs');
  return {
    pr: null,
    title: branch.name,
    url: `https://github.com/${cfg.owner}/${cfg.repo}/tree/${encodeURIComponent(branch.name)}`,
    branch: branch.name,
    sha: branch.commit.sha,
    draft: false,
    author: null,
    updatedAt: null,
    fromFork: false,
    previews,
    install: null,
    tokensCss: docs ? new URL('tokens.css', docs.url).href : null,
  };
}

/** Branches worth listing on their own: not the default branch, not already shown through an open PR. */
export function orphanBranches<B extends { name: string }>(branches: B[], pulls: PullLike[], defaultBranch: string): B[] {
  const withPr = new Set(pulls.map((p) => p.head.ref));
  return branches.filter((b) => b.name !== defaultBranch && !withPr.has(b.name));
}

const VISUAL = /visual|impact|chromatic|percy|screenshot|lost ?pixel|argos/i;

export interface BranchChecks {
  ci: CiState;
  failed: string[];
  /** Visual impact check (visual regression or Bridge's visual impact report), or 'none' when no such check ran. */
  visual: { state: CiState; url: string | null; name: string | null };
}

/** Splits check runs into the CI verdict and the visual impact verdict. */
export function branchChecks(runs: CheckRunLike[]): BranchChecks {
  const visualRuns = runs.filter((r) => VISUAL.test(r.name));
  const ciRuns = runs.filter((r) => !VISUAL.test(r.name));
  const ci = summarizeCi(ciRuns);
  const v = summarizeCi(visualRuns);
  const first = visualRuns.find((r) => r.status === 'completed' && r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion)) ?? visualRuns[0];
  return {
    ci: ci.state,
    failed: ci.failed.map((f) => f.name),
    visual: { state: v.state, url: first?.html_url ?? null, name: first?.name ?? null },
  };
}

/** What is not set up yet, in the order a maintainer should fix it. Empty when everything is configured. */
export function setupGaps(cfg: BranchesConfig): ('apps' | 'packages')[] {
  const gaps: ('apps' | 'packages')[] = [];
  if (!Object.values(cfg.apps).some(Boolean)) gaps.push('apps');
  if (!cfg.packages.length) gaps.push('packages');
  return gaps;
}
