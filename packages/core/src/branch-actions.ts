// The writes behind the actions on a branch in review, shared by Bridge Studio (scripts/reviews.ts), the MCP server
// and the CLI: merge, merge as owner override (reason posted first, marked "not merged" when GitHub refuses), review,
// close and reopen. The rules that decide whether they are allowed live in review-gate.ts; these only write, through
// the core GitHub client, so every surface sends GitHub the same requests.
import type { GitHubClient, Review } from './github-client';
import { OVERRIDE_HEADING, overrideComment, overrideRefusedComment, type MergeMethod, type MissingApproval } from './review-gate';

/**
 * Merges a branch at the head the person saw (GitHub refuses when it moved meanwhile). Studio's Merge button: squash.
 * `draft`: GitHub still calls it a draft though the gate reads it ready (core isDraft, `drafted-by-claude`), so it is
 * marked ready for review first: GitHub never merges a draft.
 */
export async function mergeOnGitHub(gh: GitHubClient, input: { number: number; headSha: string; method?: MergeMethod | undefined; draft?: boolean | undefined }): Promise<{ sha: string }> {
  if (input.draft) await gh.markReadyForReview(input.number);
  const r = await gh.mergePullRequest(input.number, { method: input.method ?? 'squash', sha: input.headSha });
  return { sha: r.sha };
}

/** Where an owner override stopped: GitHub refused the reason comment (nothing merged), or the merge itself. */
export class OverrideMergeError extends Error {
  constructor(
    readonly stage: 'comment' | 'merge',
    message: string,
    readonly cause?: unknown,
    readonly commentUrl?: string | undefined,
  ) {
    super(message);
    this.name = 'OverrideMergeError';
  }
}

/**
 * Merge as owner override: posts the reason on the branch first (the audit trail History reads back), then merges
 * with the first merge method the repository allows. When GitHub refuses the merge, the comment is edited to say
 * "Merge refused by GitHub ... Not merged", so the trail never claims a merge that did not happen. The caller checks
 * the gate first (mergeGate: overridable) and the reason (overrideReasonProblem).
 */
export async function overrideMergeOnGitHub(
  gh: GitHubClient,
  input: { number: number; headSha: string; login: string; reason: string; missing: MissingApproval[]; method: MergeMethod; draft?: boolean | undefined },
): Promise<{ sha: string; commentUrl: string; comment: string }> {
  // A GitHub draft the gate reads ready (core isDraft): marked ready first, GitHub never merges a draft.
  if (input.draft) await gh.markReadyForReview(input.number);
  const body = overrideComment(input.login, input.reason, input.missing);
  let comment: { id: number; url: string };
  try {
    comment = await gh.createIssueComment(input.number, body);
  } catch (err) {
    throw new OverrideMergeError('comment', `GitHub did not take the comment, so nothing merged: ${(err as Error).message}`, err);
  }
  try {
    const r = await gh.mergePullRequest(input.number, { method: input.method, sha: input.headSha, commitMessage: body.replace(OVERRIDE_HEADING, '').trim() });
    return { sha: r.sha, commentUrl: comment.url, comment: body };
  } catch (err) {
    const msg = (err as Error).message.trim().replace(/[.\s]+$/, '');
    await gh.updateIssueComment(comment.id, overrideRefusedComment(body, msg)).catch(() => undefined);
    throw new OverrideMergeError(
      'merge',
      `GitHub refused to merge it: ${msg}. Your reason stays on the branch, marked not merged. The protection of main may need an approving review or an admin bypass.`,
      err,
      comment.url,
    );
  }
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

/** Approve, request changes or comment, on the head the reviewer saw. Changes and comments need a text. */
export async function reviewOnGitHub(gh: GitHubClient, input: { number: number; event: ReviewEvent; body?: string | undefined; headSha?: string | undefined }): Promise<Review> {
  const text = input.body?.trim() ?? '';
  if (input.event === 'REQUEST_CHANGES' && !text) throw new Error('Add a comment that says what to change.');
  if (input.event === 'COMMENT' && !text) throw new Error('Write a comment first.');
  return gh.submitReview(input.number, { event: input.event, body: text || undefined, commitId: input.headSha });
}

/** A comment on the branch's conversation. */
export async function commentOnGitHub(gh: GitHubClient, n: number, body: string): Promise<{ id: number; url: string }> {
  const text = body.trim();
  if (!text) throw new Error('Write the comment first.');
  return gh.createIssueComment(n, text);
}

/**
 * "Ask someone else to review": requests the review from `others` (core reviewersToAsk) and takes the viewer off the
 * requested reviewers when GitHub had them on it. Throws how to fix it when nobody else can.
 */
export async function askOthersToReviewOnGitHub(gh: GitHubClient, input: { number: number; others: string[]; viewer?: string | null | undefined; viewerRequested?: boolean | undefined }): Promise<string[]> {
  if (!input.others.length) throw new Error('Nobody else can give the missing approval. Review it, or ask an owner in Settings to add a reviewer.');
  await gh.requestReviewers(input.number, input.others);
  if (input.viewer && input.viewerRequested) await gh.removeRequestedReviewers(input.number, [input.viewer]).catch(() => undefined);
  return input.others;
}

/** Closes a branch without merging it. Its work stays on GitHub and it can be reopened. */
export async function closeOnGitHub(gh: GitHubClient, n: number): Promise<void> {
  await gh.updatePullRequest(n, { state: 'closed' });
}

/** Reopens a closed branch (GitHub refuses when its branch was deleted). */
export async function reopenOnGitHub(gh: GitHubClient, n: number): Promise<void> {
  await gh.updatePullRequest(n, { state: 'open' });
}

// ---------------------------------------------------------------------------------------------------------------
// Adding edits to a branch already in review

const sameLogin = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase().replace(/^@/, '') === b.toLowerCase().replace(/^@/, ''));

/** Only the author or someone with write access to the repository adds to a branch. */
export function canAddTo(p: { user: { login: string } | null }, viewer: string | null | undefined, write: boolean): boolean {
  if (!viewer) return false;
  return write || sameLogin(p.user?.login, viewer);
}

/** The comment posted on the branch, so reviewers see what was added and from where. */
export function addedComment(paths: string[], viewer: string | null | undefined, from = 'the Bridge token editor'): string {
  const lines = paths.slice(0, 20).map((p) => `- \`${p}\``);
  if (paths.length > 20) lines.push(`- and ${paths.length - 20} more`);
  return `${viewer ? `@${viewer} added` : 'Added'} token edits from ${from}:\n\n${lines.join('\n')}`;
}
