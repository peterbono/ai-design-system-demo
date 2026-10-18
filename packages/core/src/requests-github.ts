// Deciding on a component change request on GitHub: link it to an exploration, assign someone, or decline it. The
// same calls for Studio (the viewer's own token), the MCP server and the CLI. Pure rules live in requests.ts.
import { EXPLORATION_LABEL, isExplorationBranch } from './explorations';
import { GitHubClient, GitHubError } from './github-client';
import { declineComment, declineReasonProblems, withRequestExploration } from './requests';

export interface RequestExplorationLink {
  number: number;
  branch: string;
  /** Who is now on it, when someone was assigned in the same step. */
  assignees: string[];
  /** Sentences about the parts that did not go through (label refused): the link itself holds. */
  warnings: string[];
}

/**
 * Links a request to an exploration branch, the way `bridge request create --exploration` files one: the hidden block
 * gets `exploration`, the issue gets the `exploration` label, and whoever starts the exploration is assigned, so the
 * request reads "in progress" everywhere. Implementing it then happens on that branch (`request implement --branch`).
 */
export async function linkRequestToExplorationOnGitHub(gh: GitHubClient, n: number, branch: string, opts: { assignee?: string | null } = {}): Promise<RequestExplorationLink> {
  if (!isExplorationBranch(branch)) throw new GitHubError(422, `"${branch}" is not an exploration branch. Exploration branches are named explore/<name>.`);
  const issue = await gh.getIssue(n);
  const body = withRequestExploration(issue.body, branch);
  if (!body) throw new GitHubError(422, `#${n} has no Bridge request block, so it cannot be linked. Add "exploration: ${branch}" to it on GitHub.`);
  await gh.updateIssue(n, { body });
  const warnings: string[] = [];
  if (!(await gh.addLabels(n, [EXPLORATION_LABEL]))) warnings.push(`The ${EXPLORATION_LABEL} label could not be added to #${n}.`);
  let assignees: string[] = [];
  if (opts.assignee) {
    try {
      assignees = await gh.addAssignees(n, [opts.assignee.replace(/^@/, '')]);
    } catch {
      warnings.push(`@${opts.assignee.replace(/^@/, '')} could not be assigned to #${n}.`);
    }
  }
  return { number: n, branch, assignees, warnings };
}

/** Assigns someone to a request. Throws when GitHub does not keep the assignee (no access to the repository). */
export async function assignRequestOnGitHub(gh: GitHubClient, n: number, login: string): Promise<string[]> {
  const who = login.trim().replace(/^@/, '');
  if (!who) throw new GitHubError(422, 'Pick who should work on it.');
  const assignees = await gh.addAssignees(n, [who]);
  if (!assignees.some((a) => a.toLowerCase() === who.toLowerCase())) throw new GitHubError(422, `GitHub did not assign @${who}: they need access to this repository.`);
  return assignees;
}

/** Declines a request: the reason as a comment the requester is notified of, then the issue closed as not planned. */
export async function declineRequestOnGitHub(gh: GitHubClient, n: number, reason: string, by?: string | null): Promise<void> {
  const problems = declineReasonProblems(reason);
  if (problems.length) throw new GitHubError(422, problems.join(' '));
  await gh.addComment(n, declineComment(reason, by));
  await gh.updateIssue(n, { state: 'closed', state_reason: 'not_planned' });
}
