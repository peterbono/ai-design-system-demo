// Explorations on GitHub: start one (branch from the base with the exploration note, a draft pull request labeled
// `exploration`), list them, promote one to review, close one. Shared by Studio (in the browser, with the viewer's
// token), the MCP server and the CLI. The pure rules are in explorations.ts.

import type { BridgeConfig } from './config';
import {
  EXPLORATION_LABEL,
  EXPLORATION_PREFIX,
  explorationNote,
  explorationNotePath,
  explorationPrBody,
  explorationPrTitle,
  explorationProblems,
  explorationSlug,
  explorationStatus,
  explorationTryIt,
  isExplorationPull,
  parseExplorationBody,
  promotionPlan,
  type Exploration,
  type ExplorationStatus,
  type ExplorationTryIt,
  type PromotionPlan,
} from './explorations';
import { GitHubError, type GitHubClient, type PullRequestSummary } from './github-client';
import { findPreviewComment, previewLinks, previewsSettled, type BranchPreview, type PreviewApps } from './previews';
import { branchPreviewUrls } from './previews-github';

export interface ExplorationSettings {
  /** Branch explorations start from and pull requests target (the default branch). */
  base: string;
  /** Snapshot packages (bridge.config.json previews.packages). */
  packages: string[];
  /** Per-branch preview URL templates (bridge.config.json previews.apps). */
  apps: PreviewApps;
}

export interface ExplorationSummary {
  number: number;
  url: string;
  branch: string;
  slug: string;
  name: string;
  purpose: string;
  useCase?: string | undefined;
  status: ExplorationStatus;
  draft: boolean;
  author: string;
  updatedAt: string;
  /** Head commit of the branch. */
  headSha: string;
  /**
   * Template previews Vercel cannot have shortened (a host label of 63 characters or less), without a round trip. The
   * URLs Vercel reports, with their build state, come from `explorationTestBuildOnGitHub`.
   */
  previews: { app: string; label: string; url: string }[];
}

/** One exploration from a pull request summary. */
export function explorationSummary(p: PullRequestSummary, _owner: string, _repo: string, s: Pick<ExplorationSettings, 'packages' | 'apps'>): ExplorationSummary {
  const e = parseExplorationBody(p.body);
  const slug = p.headRef?.startsWith(EXPLORATION_PREFIX) ? p.headRef.slice(EXPLORATION_PREFIX.length) : (e?.slug ?? explorationSlug(p.title));
  return {
    number: p.number,
    url: p.url,
    branch: p.headRef,
    slug,
    name: e?.name ?? p.title.replace(/^Exploration:\s*/i, ''),
    purpose: e?.purpose ?? '',
    ...(e?.useCase ? { useCase: e.useCase } : {}),
    status: explorationStatus({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body }),
    draft: p.draft,
    author: e?.author ?? p.author,
    updatedAt: p.updatedAt,
    headSha: p.headSha,
    previews: previewLinks(s.apps, { branch: p.headRef, pr: p.number, sha: p.headSha }),
  };
}

/** Explorations of the repo, newest activity first. `state: 'open'` lists the running ones and the promoted open ones. */
export async function listExplorationsOnGitHub(gh: GitHubClient, s: Pick<ExplorationSettings, 'packages' | 'apps'>, opts: { state?: 'open' | 'closed' | 'all' } = {}): Promise<ExplorationSummary[]> {
  const pulls = await gh.listPullRequests(opts.state ?? 'open');
  return pulls.filter((p) => isExplorationPull({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body })).map((p) => explorationSummary(p, gh.owner, gh.name, s));
}

export interface StartedExploration {
  branch: string;
  slug: string;
  pr: number;
  url: string;
  commit: string;
  /** Just started: the snapshot is not built yet. `explorationTestBuildOnGitHub` reads the command once it is. */
  tryIt: ExplorationTryIt;
  previews: { app: string; label: string; url: string }[];
}

/**
 * Starts an exploration: the branch `explore/<slug>` from the base with one commit (the exploration note), a draft
 * pull request labeled `exploration`, then the body rewritten with the pull request number so it carries the
 * install command. Refuses an exploration whose branch already exists.
 */
export async function startExplorationOnGitHub(gh: GitHubClient, e: Exploration, s: ExplorationSettings): Promise<StartedExploration> {
  const problems = explorationProblems(e);
  if (problems.length) throw new GitHubError(422, problems.join(' '));
  if (!gh.canWrite) throw new GitHubError(401, 'Starting an exploration needs a GitHub token (contents and pull requests, read and write, on this repository only).');
  const slug = e.slug || explorationSlug(e.name);
  const branch = `${EXPLORATION_PREFIX}${slug}`;
  const x = gh.withBranchPrefix(EXPLORATION_PREFIX);
  if (await x.getBranchSha(branch)) throw new GitHubError(422, `An exploration named "${slug}" already exists (${branch}). Pick another name, or continue that one.`);
  const full: Exploration = { ...e, slug, startedAt: e.startedAt ?? new Date().toISOString() };
  const commit = await x.commitToNewBranch({
    base: s.base,
    branch,
    message: `chore(explore): start ${full.name.trim()}\n\n${full.purpose.trim()}\n\nExploration: never merged as is. Promote it to review or close it.`,
    files: [{ path: explorationNotePath(slug), content: explorationNote(full) }],
  });
  const ctx = { owner: gh.owner, repo: gh.name, packages: s.packages, apps: s.apps };
  const pr = await x.createPullRequest({ title: explorationPrTitle(full), head: branch, base: s.base, body: explorationPrBody(full, ctx), draft: true });
  await x.addLabels(pr.number, [EXPLORATION_LABEL]);
  // The number exists now: the body gets the install command.
  await x.updatePullRequest(pr.number, { body: explorationPrBody(full, { ...ctx, pr: pr.number }) }).catch(() => undefined);
  return {
    branch,
    slug,
    pr: pr.number,
    url: pr.url,
    commit: commit.sha,
    tryIt: { state: 'building' },
    previews: previewLinks(s.apps, { branch, pr: pr.number, sha: commit.sha }),
  };
}

/**
 * Where the test build of an exploration stands: the install command from its sticky preview comment when it matches
 * the branch head, "building" while the workflow has not caught up, "failed" when the publish failed. Two reads.
 */
export async function explorationTryItOnGitHub(gh: GitHubClient, e: { number: number; branch: string }): Promise<ExplorationTryIt> {
  const [comments, head] = await Promise.all([gh.listIssueComments(e.number), gh.getBranchSha(e.branch).catch(() => undefined)]);
  return explorationTryIt({ comment: findPreviewComment(comments)?.body, headSha: head });
}

export interface ExplorationTestBuild {
  /** The install command from the sticky preview comment, or building/failed. Never a guessed command. */
  tryIt: ExplorationTryIt;
  /** Every configured app with the URL Vercel reports (null while unknown) and its build state. */
  previews: BranchPreview[];
  /** True when the command is ready (or the publish failed) and every preview is built: polling can stop. */
  settled: boolean;
}

/**
 * Everything "Try it" shows for an exploration, read in one go: the command from the preview comment and the real
 * preview URLs (deployments, Vercel statuses, the Vercel comment). Comments and the branch head are read once.
 */
export async function explorationTestBuildOnGitHub(gh: GitHubClient, e: { number: number; branch: string }, config: Pick<BridgeConfig, 'previews'> | undefined): Promise<ExplorationTestBuild> {
  const [comments, head] = await Promise.all([gh.listIssueComments(e.number), gh.getBranchSha(e.branch).catch(() => undefined)]);
  const tryIt = explorationTryIt({ comment: findPreviewComment(comments)?.body, headSha: head });
  const previews = await branchPreviewUrls(gh, e.number, config, { branch: e.branch, sha: head, comments }).catch(() => [] as BranchPreview[]);
  return { tryIt, previews, settled: tryIt.state !== 'building' && previewsSettled(previews) };
}

/** The open exploration pull request of a branch, slug or number. */
export async function findExplorationOnGitHub(gh: GitHubClient, ref: string | number): Promise<PullRequestSummary & { body: string }> {
  if (typeof ref === 'number' || /^#?\d+$/.test(String(ref))) {
    const p = await gh.getPullRequest(Number(String(ref).replace(/^#/, '')));
    if (!isExplorationPull({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body })) throw new GitHubError(422, `Pull request #${p.number} is not an exploration.`);
    return p;
  }
  const branch = `${EXPLORATION_PREFIX}${explorationSlug(String(ref))}`;
  const open = await gh.findOpenPullRequest(branch);
  if (!open) throw new GitHubError(404, `No open exploration on ${branch}. \`bridge explore list\` shows the running ones.`);
  return gh.getPullRequest(open.number);
}

export interface PromotedExploration extends PromotionPlan {
  number: number;
  url: string;
  branch: string;
  /** Steps that did not go through, with what to do on GitHub instead. */
  warnings: string[];
}

/**
 * Promotes an exploration to a normal pull request for review: the exploration note removed from the branch, the
 * tier labels from the shared classifier, the `exploration` label removed, the body for review (closing the
 * requests implemented on it), and the draft marked ready for review (GraphQL). Never merges.
 */
export async function promoteExplorationOnGitHub(
  gh: GitHubClient,
  ref: string | number,
  opts: { config?: BridgeConfig | undefined; requests?: number[] | undefined; date?: Date | undefined; dryRun?: boolean | undefined } = {},
): Promise<PromotedExploration> {
  const p = await findExplorationOnGitHub(gh, ref);
  const status = explorationStatus({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body });
  if (status !== 'active') throw new GitHubError(422, status === 'closed' ? `Exploration #${p.number} is closed. Reopen it on GitHub first.` : `#${p.number} is already promoted to review.`);
  const files = await gh.listPullRequestFiles(p.number);
  const plan = promotionPlan({ title: p.title, body: p.body, labels: p.labels, files: files.map((f) => ({ path: f.filename, status: f.status })), config: opts.config, requests: opts.requests, date: opts.date });
  const out: PromotedExploration = { ...plan, number: p.number, url: p.url, branch: p.headRef, warnings: [] };
  if (opts.dryRun) return out;
  if (!gh.canWrite) throw new GitHubError(401, 'Promoting an exploration needs a GitHub token (contents and pull requests, read and write).');
  const x = gh.withBranchPrefix(EXPLORATION_PREFIX);
  if (plan.removeFiles.length) {
    await x.commitToBranch({ branch: p.headRef, message: 'chore(explore): promote to review, remove the exploration note', files: plan.removeFiles.map((path) => ({ path, content: null })) }).catch((e: Error) => {
      out.warnings.push(`The exploration note stays on the branch (${e.message}). Delete ${plan.removeFiles.join(', ')} before merging.`);
    });
  }
  await x.addLabels(p.number, plan.addLabels);
  await x.removeLabel(p.number, EXPLORATION_LABEL).catch((e: Error) => {
    if (!(e instanceof GitHubError && e.status === 404)) out.warnings.push(`The exploration label is still on (${e.message}). Remove it on GitHub.`);
  });
  await x.updatePullRequest(p.number, { title: plan.title, body: plan.body });
  await x.markReadyForReview(p.number).catch((e: Error) => {
    out.warnings.push(`Still a draft: ${e.message}`);
  });
  return out;
}

/** Closes an exploration without merging. The branch stays for reference; the workflow removes the prerelease. */
export async function closeExplorationOnGitHub(gh: GitHubClient, ref: string | number): Promise<{ number: number; url: string; branch: string }> {
  if (!gh.canWrite) throw new GitHubError(401, 'Closing an exploration needs a GitHub token (pull requests: write).');
  const p = await findExplorationOnGitHub(gh, ref);
  await gh.updatePullRequest(p.number, { state: 'closed' });
  return { number: p.number, url: p.url, branch: p.headRef };
}
