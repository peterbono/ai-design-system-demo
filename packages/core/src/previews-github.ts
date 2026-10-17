// Real branch preview URLs read from GitHub: the deployments and commit statuses of the head commit and the Vercel
// bot comment on the pull request, resolved by `resolveBranchPreviews` (previews.ts). Shared by the plugin, Studio,
// the MCP server and the CLI, so none of them shows a guessed URL. See docs/PREVIEWS.md.

import type { BridgeConfig } from './config';
import type { GitHubClient } from './github-client';
import { resolveBranchPreviews, type BranchPreview, type PreviewApps } from './previews';

export interface BranchPreviewOptions {
  /** Branch and head commit when the caller knows them (skips reading the pull request). */
  branch?: string | undefined;
  sha?: string | undefined;
  /** The pull request's comments when the caller already read them (skips one read). */
  comments?: { body?: string | null | undefined }[] | undefined;
}

/**
 * The preview of each app configured in `previews.apps` for a pull request (by number) or a commit (by sha): the URL
 * Vercel reports (deployments, then commit statuses, then its PR comment), the template only when Vercel cannot have
 * shortened it, and whether the build of that commit is ready. A failed read leaves that source out, never throws for it.
 */
export async function branchPreviewUrls(gh: GitHubClient, ref: number | string, config: Pick<BridgeConfig, 'previews'> | { previews?: { apps?: PreviewApps | undefined } | undefined } | undefined, opts: BranchPreviewOptions = {}): Promise<BranchPreview[]> {
  const apps: PreviewApps = config?.previews?.apps ?? {};
  if (!Object.values(apps).some(Boolean)) return [];
  let pr: number | undefined;
  let branch = opts.branch;
  let sha = opts.sha;
  if (typeof ref === 'number') {
    pr = ref;
    if (!branch || !sha) {
      const p = await gh.getPullRequest(ref);
      branch ??= p.headRef;
      sha ??= p.headSha;
    }
  } else {
    sha = ref;
    if (!branch || !opts.comments) {
      const open = (await gh.listPullRequestsForCommit(ref).catch(() => [])).find((p) => p.state === 'open');
      if (open) {
        pr = open.number;
        branch ??= open.headRef;
      }
    }
  }
  const [comments, statuses, deployments] = await Promise.all([
    opts.comments ? Promise.resolve(opts.comments) : pr !== undefined ? gh.listIssueComments(pr).catch(() => []) : Promise.resolve([]),
    sha ? gh.listCommitStatuses(sha).catch(() => []) : Promise.resolve([]),
    sha ? gh.listDeployments(sha).catch(() => []) : Promise.resolve([]),
  ]);
  return resolveBranchPreviews(apps, { branch: branch ?? '', ...(pr !== undefined ? { pr } : {}), ...(sha ? { sha } : {}) }, { comments, statuses, deployments });
}
