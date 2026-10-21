// Suggestions on GitHub: create (issue plus continuation comments), list, read with status, review, link the pull
// request that applies it, decline. The same calls for Studio (the viewer's own token), the MCP server and the CLI.
// Needs Issues read and write; never writes code (contents) or pull requests. Pure rules live in suggestions.ts and
// suggestion-review.ts; declining reuses the request flow (requests-github.ts).

import { GitHubClient, GitHubError, type IssueSummary, type PullRequestSummary } from './github-client';
import { closingIssueNumbers } from './requests';
import { declineRequestOnGitHub } from './requests-github';
import {
  composeSuggestionAppliedComment,
  composeSuggestionReviewComment,
  parseSuggestionAppliedComment,
  suggestionReviewState,
  summarizeSuggestionApprovals,
  type SuggestionAppliedRecord,
  type SuggestionApprovals,
  type SuggestionCommentLike,
  type SuggestionGovernance,
  type SuggestionReviewEvent,
} from './suggestion-review';
import {
  composeSuggestionIssue,
  parseSuggestionIssue,
  SUGGESTION_LABEL,
  SUGGESTION_STATE_LABELS,
  suggestionKindFromLabels,
  suggestionStateFromLabels,
  suggestionStateLabel,
  suggestionStatus,
  type ComposeSuggestionOptions,
  type ParsedSuggestion,
  type SuggestionKind,
  type SuggestionPayloadV1,
  type SuggestionStatus,
} from './suggestions';
import type { ApprovalRole } from './review-gate';

export interface CreatedSuggestion {
  number: number;
  url: string;
  /** sha256 of the payload: what approvals bind to. */
  sha: string;
  /** Continuation comments posted. */
  parts: number;
  /** Sentences about parts that did not go through (labels refused). The suggestion itself holds. */
  warnings: string[];
}

/**
 * Files a suggestion: the issue (title, body, labels), then its continuation comments in order when the payload is
 * too large for the body. A part that fails leaves the suggestion incomplete (parsers refuse it) and throws with the
 * issue number, so the caller can say so.
 */
export async function createSuggestionOnGitHub(gh: GitHubClient, payload: SuggestionPayloadV1, opts: ComposeSuggestionOptions = {}): Promise<CreatedSuggestion> {
  const issue = composeSuggestionIssue(payload, { repo: gh.fullName, ...opts });
  const created = await gh.createIssue({ title: issue.title, body: issue.body, labels: issue.labels, assignees: issue.assignees });
  for (const [i, part] of issue.parts.entries()) {
    try {
      await gh.createIssueComment(created.number, part);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new GitHubError(err instanceof GitHubError ? err.status : 500, `Suggestion #${created.number} is incomplete: part ${i + 1} of ${issue.parts.length} could not be posted (${why}). Send it again, then close #${created.number}.`);
    }
  }
  const warnings: string[] = [];
  const missing = issue.labels.filter((l) => !created.labels.includes(l));
  if (created.labels.length && missing.length) warnings.push(`GitHub did not keep these labels on #${created.number}: ${missing.join(', ')}.`);
  return { number: created.number, url: created.url, sha: issue.sha, parts: issue.parts.length, warnings };
}

/** Linked pull requests of an issue, from the bodies that close it ("Closes #n"). */
export function linkedPullsOf(n: number, pulls: readonly Pick<PullRequestSummary, 'number' | 'state' | 'body' | 'url'>[]): { number: number; url: string; state: 'open' | 'closed'; merged: boolean }[] {
  return pulls
    .filter((p) => closingIssueNumbers(p.body).includes(n))
    .map((p) => ({ number: p.number, url: p.url, state: p.state === 'open' ? 'open' : 'closed', merged: p.state === 'merged' }));
}

export interface SuggestionListItem {
  number: number;
  title: string;
  url: string;
  author: string;
  createdAt: string;
  state: 'open' | 'closed';
  stateReason: string | null;
  labels: string[];
  kind: SuggestionKind | undefined;
  /** Tier from the `tier: N` label. */
  tier: 1 | 2 | 3 | undefined;
  linkedPrs: { number: number; url: string; state: 'open' | 'closed'; merged: boolean }[];
  /**
   * Status from the issue state, linked pull requests and the state label (a cache: getSuggestionOnGitHub reads the
   * review comments for the real one).
   */
  status: SuggestionStatus;
}

/**
 * Suggestions in the repository, newest first. Status comes from labels and linked pull requests (one call per list,
 * no comment reads); open getSuggestionOnGitHub for the counted approvals.
 */
export async function listSuggestionsOnGitHub(gh: GitHubClient, opts: { state?: 'open' | 'closed' | 'all' | undefined; perPage?: number | undefined; pulls?: PullRequestSummary[] | undefined } = {}): Promise<SuggestionListItem[]> {
  const issues = await gh.listIssues({ label: SUGGESTION_LABEL, state: opts.state ?? 'open', perPage: opts.perPage ?? 50 });
  const pulls = opts.pulls ?? (issues.length ? await gh.listPullRequests('all').catch(() => [] as PullRequestSummary[]) : []);
  return issues.map((i) => listItem(i, pulls));
}

function listItem(i: IssueSummary, pulls: readonly PullRequestSummary[]): SuggestionListItem {
  const linkedPrs = linkedPullsOf(i.number, pulls);
  const cached = suggestionStateFromLabels(i.labels);
  const t = i.labels.map((l) => /^tier: ([123])$/.exec(l)?.[1]).find(Boolean);
  return {
    number: i.number,
    title: i.title,
    url: i.url,
    author: i.author,
    createdAt: i.createdAt,
    state: i.state,
    stateReason: i.stateReason,
    labels: i.labels,
    kind: suggestionKindFromLabels(i.labels),
    tier: t ? (Number(t) as 1 | 2 | 3) : undefined,
    linkedPrs,
    status: suggestionStatus({ state: i.state, stateReason: i.stateReason, linkedPrs, applied: cached === 'applying', review: cached === 'applying' ? undefined : cached }),
  };
}

export interface SuggestionDetail {
  issue: IssueSummary;
  parsed: ParsedSuggestion;
  comments: (SuggestionCommentLike & { id: number })[];
  /** Counted on the current payload sha. Undefined when the payload does not parse. */
  approvals: SuggestionApprovals | undefined;
  linkedPrs: { number: number; url: string; state: 'open' | 'closed'; merged: boolean }[];
  applied: SuggestionAppliedRecord[];
  status: SuggestionStatus;
}

/**
 * One suggestion with everything its status needs: the payload (parts reassembled from the author's comments), the
 * review comments counted against the owners of the config read from the default branch, linked pull requests and
 * applied markers. `outdated` comes from the caller's dry run (it needs the current files).
 */
export async function getSuggestionOnGitHub(gh: GitHubClient, n: number, gov: SuggestionGovernance, opts: { pulls?: PullRequestSummary[] | undefined; outdated?: boolean | undefined } = {}): Promise<SuggestionDetail> {
  const [issue, comments, pulls] = await Promise.all([gh.getIssue(n), gh.listIssueComments(n), opts.pulls ? Promise.resolve(opts.pulls) : gh.listPullRequests('all').catch(() => [] as PullRequestSummary[])]);
  const parsed = parseSuggestionIssue(issue.body, { comments, author: issue.author || undefined });
  const linkedPrs = linkedPullsOf(n, pulls);
  const applied = comments.flatMap((c) => parseSuggestionAppliedComment(c.body) ?? []);
  const approvals = parsed.ok ? summarizeSuggestionApprovals(comments, gov, { payloadSha: parsed.sha, author: issue.author }) : undefined;
  const status = suggestionStatus({
    state: issue.state,
    stateReason: issue.stateReason,
    linkedPrs,
    applied: parsed.ok && applied.some((a) => a.payloadSha === parsed.sha),
    outdated: opts.outdated,
    review: parsed.ok && approvals ? suggestionReviewState(parsed.payload.tier.tier, approvals) : undefined,
  });
  return { issue, parsed, comments, approvals, linkedPrs, applied, status };
}

/**
 * Keeps exactly one state label on the issue, the one the status calls for (none once closed or outdated). Best
 * effort: returns a warning sentence when the labels could not be changed.
 */
export async function syncSuggestionStateLabel(gh: GitHubClient, n: number, labels: readonly string[], status: SuggestionStatus): Promise<string | null> {
  const want = suggestionStateLabel(status);
  let ok = true;
  for (const l of Object.values(SUGGESTION_STATE_LABELS)) {
    if (l === want || !labels.includes(l)) continue;
    try {
      await gh.removeLabel(n, l);
    } catch {
      ok = false;
    }
  }
  if (want && !labels.includes(want)) ok = (await gh.addLabels(n, [want])) && ok;
  return ok ? null : `The state label on #${n} could not be updated; the status shown in Bridge is still right.`;
}

export interface SuggestionReviewResult {
  commentUrl: string;
  payloadSha: string;
  status: SuggestionStatus;
  /** Whether this review counts (the reviewer is an owner, or a collaborator when no owner is set). */
  counts: boolean;
  warnings: string[];
}

/**
 * Approves, requests changes on or comments on a suggestion as the token's user. `payloadSha` is the version the
 * reviewer saw: when the payload changed since, nothing is posted and the error says to reload. Then the state label
 * is re-synced from the recomputed status.
 */
export async function reviewSuggestionOnGitHub(
  gh: GitHubClient,
  n: number,
  input: { event: SuggestionReviewEvent; role?: ApprovalRole | undefined; message?: string | undefined; payloadSha?: string | undefined; by?: string | undefined; at?: Date | undefined },
  gov: SuggestionGovernance,
): Promise<SuggestionReviewResult> {
  if (input.event === 'request-changes' && !input.message?.trim()) throw new GitHubError(422, 'Say what should change, in a sentence or two: the author reads it.');
  const before = await getSuggestionOnGitHub(gh, n, gov);
  if (!before.parsed.ok) throw new GitHubError(422, `#${n} cannot be reviewed: ${before.parsed.message}`);
  if (before.issue.state === 'closed') throw new GitHubError(422, `#${n} is closed. Reopen it on GitHub to review it again.`);
  const sha = before.parsed.sha;
  if (input.payloadSha && input.payloadSha !== sha) throw new GitHubError(409, `#${n} changed since you opened it. Reload it and review the new version.`);
  const by = input.by ?? (await gh.getViewer().catch(() => ({ login: '' }))).login;
  const body = composeSuggestionReviewComment({ event: input.event, role: input.role, payloadSha: sha, at: (input.at ?? new Date()).toISOString(), by: by || undefined, message: input.message });
  const posted = await gh.createIssueComment(n, body);
  // Read back: GitHub says who posted the comment and with which association, which is what counts.
  const after = await getSuggestionOnGitHub(gh, n, gov);
  const status = after.status;
  const who = (after.comments.find((c) => c.id === posted.id)?.author ?? by).toLowerCase();
  const counts = input.event === 'comment' || [...(after.approvals?.approvers ?? []), ...(after.approvals?.changesRequested ?? [])].some((l) => l.toLowerCase() === who);
  const warnings: string[] = [];
  if (!counts) warnings.push('Your review is posted but does not count: only the owners listed in bridge.config.json approve suggestions.');
  if (before.parsed.edited) warnings.push(`#${n} was edited by hand after Bridge wrote it: check the machine-readable block before applying it.`);
  const labelWarning = await syncSuggestionStateLabel(gh, n, before.issue.labels, status);
  if (labelWarning) warnings.push(labelWarning);
  return { commentUrl: posted.url, payloadSha: sha, status, counts, warnings };
}

/**
 * Records that a suggestion is being applied (the applied marker comment) and sets the `suggestion: applying` label.
 * Called after a developer pushed the branch or opened the pull request that says "Closes #n".
 */
export async function linkSuggestionPrOnGitHub(
  gh: GitHubClient,
  n: number,
  link: { pr?: number | undefined; branch?: string | undefined; commit?: string | undefined; by?: string | undefined; payloadSha: string; forced?: boolean | undefined; at?: Date | undefined },
): Promise<{ warnings: string[] }> {
  if (!link.pr && !link.branch && !link.commit) throw new GitHubError(422, 'Say where it is applied: a pull request number, a branch or a commit.');
  const issue = await gh.getIssue(n);
  await gh.addComment(n, composeSuggestionAppliedComment({ by: link.by, branch: link.branch, commit: link.commit, pr: link.pr, payloadSha: link.payloadSha, forced: link.forced, at: (link.at ?? new Date()).toISOString() }));
  const warning = await syncSuggestionStateLabel(gh, n, issue.labels, 'applying');
  return { warnings: warning ? [warning] : [] };
}

/** Declines a suggestion like a request (reason comment, closed as not planned), then clears its state label. */
export async function declineSuggestionOnGitHub(gh: GitHubClient, n: number, reason: string, by?: string | null): Promise<{ warnings: string[] }> {
  const issue = await gh.getIssue(n);
  await declineRequestOnGitHub(gh, n, reason, by);
  const warning = await syncSuggestionStateLabel(gh, n, issue.labels, 'declined');
  return { warnings: warning ? [warning] : [] };
}
