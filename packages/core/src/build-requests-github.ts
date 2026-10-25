// Build requests and Figma token pushes on GitHub: file a build request, list build requests with their status (read
// only: developers split and track the work in GitHub or Jira), and read where a shipped token push stands. Shared by
// the Figma plugin, Studio, the MCP server and the CLI. The rules are in build-requests.ts.

import {
  BUILD_REQUEST_LABEL,
  assembleBuildRequests,
  composeBuildRequestIssue,
  libraryArrival,
  type BuildIssueLike,
  type BuildPullLike,
  type BuildRequestInput,
  type BuildRequestView,
  type LibraryArrival,
  type PublishOutcome,
} from './build-requests';
import type { GitHubClient } from './github-client';
import { REQUEST_LABEL } from './requests';
import { summarizeApprovals, summarizeCi } from './review-gate';

/**
 * Files a build request: one issue, labeled component-change (the bridge-jira Action mirrors it to Jira when set up),
 * bridge-build, the request kind and the source. `labels` and `assignees` come from integrations.requests. Returns the
 * outcome the plugin shows ("Build request sent").
 */
export async function createBuildRequestOnGitHub(
  gh: GitHubClient,
  input: BuildRequestInput,
  opts: { labels?: string[] | undefined; assignees?: string[] | undefined; componentUrl?: string | undefined } = {},
): Promise<PublishOutcome> {
  const issue = composeBuildRequestIssue(input, opts);
  const created = await gh.createIssue({ title: issue.title, body: issue.body, labels: issue.labels, ...(issue.assignees.length ? { assignees: issue.assignees } : {}) });
  return { subject: { type: 'component', name: input.component }, route: 'build-request', ref: { kind: 'issue', number: created.number, url: created.url } };
}

/**
 * Every build request with its status, read from GitHub: the component-change and bridge-build issues, and the pull
 * requests that close them or are library branches from Figma. Two to three list calls, no per-item reads.
 */
export async function listBuildRequestsOnGitHub(gh: GitHubClient, opts: { now?: Date | number | undefined; nameOf?: ((login: string) => string) | undefined } = {}): Promise<BuildRequestView[]> {
  const [requests, builds, pulls] = await Promise.all([
    gh.listIssues({ label: REQUEST_LABEL, state: 'all', perPage: 100 }),
    gh.listIssues({ label: BUILD_REQUEST_LABEL, state: 'all', perPage: 100 }),
    gh.listPullRequests('all'),
  ]);
  const seen = new Set<number>();
  const issues: BuildIssueLike[] = [];
  for (const i of [...requests, ...builds]) {
    if (seen.has(i.number)) continue;
    seen.add(i.number);
    issues.push({ ...i, stateReason: i.stateReason, assignees: i.assignees ?? [], closedAt: i.closedAt ?? null });
  }
  const prs: BuildPullLike[] = pulls.map((p) => ({ ...p, assignees: p.assignees ?? [] }));
  return assembleBuildRequests({ issues, pulls: prs, now: opts.now, nameOf: opts.nameOf });
}

/**
 * Where a token push the plugin published as `shipped` stands: poll it until `final` ("In the library", or "Held for a
 * developer" / "Not shipped"). Reads the pull request, its checks and its reviews.
 */
export async function libraryArrivalOnGitHub(gh: GitHubClient, n: number): Promise<LibraryArrival> {
  const pr = await gh.getPullRequest(n);
  if (pr.state !== 'open') return libraryArrival({ state: pr.state, merged_at: pr.mergedAt ?? null });
  const [runs, statuses, reviews] = await Promise.all([
    gh.listCheckRuns(pr.headSha).catch(() => []),
    gh.listCommitStatuses(pr.headSha).catch(() => []),
    gh.listReviews(n).catch(() => []),
  ]);
  const ci = summarizeCi(
    runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion })),
    statuses.map((s) => ({ context: s.context, state: s.state, description: s.description })),
  );
  const approvals = summarizeApprovals(
    reviews.map((r) => ({ user: r.user ? { login: r.user } : null, state: r.state, submitted_at: r.submittedAt ?? null })),
    { design: [], tech: [] },
    pr.author,
  );
  return libraryArrival({ state: pr.state, mergeable: pr.mergeable, ci, changesRequested: approvals.changesRequested.length });
}
