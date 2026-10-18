// Library protection over the GitHub client: read the state of the default branch, read the checks to require,
// and create (or complete) the Bridge ruleset. Studio, the CLI and the MCP server call these.

import { GitHubError, type GitHubClient } from './github-client';
import { type ProtectionOptions, protectionRuleset, type ProtectionState, protectionState, requiredCheckNames, type Ruleset } from './protection';

/**
 * The protection of `defaultBranch`. Rulesets are listed (read access is enough), then read one by one for their
 * rules; classic branch protection is read too. Whatever cannot be read counts as unknown, never as unprotected.
 */
export async function loadProtection(client: GitHubClient, defaultBranch: string): Promise<ProtectionState> {
  const rulesets = await client
    .listRulesets()
    // Disabled rulesets enforce nothing: kept as listed (the Bridge one is still found by name, to update it).
    .then((list) => Promise.all(list.map((r) => (r.enforcement === 'disabled' || r.id === undefined ? r : client.getRuleset(r.id)))))
    // Any failure (no access, a repo GitHub hides behind a 404, rate limit) leaves the state unknown.
    .catch((): Ruleset[] | null => null);
  const classic = await client.getBranchProtection(defaultBranch).catch(() => undefined);
  return protectionState(rulesets, classic, defaultBranch);
}

/** The checks to require: the default branch's latest check runs, kept to those the last merged pull request ran. */
export async function loadRequiredChecks(client: GitHubClient, defaultBranch: string): Promise<string[]> {
  const onDefault = await client.listCheckRuns(defaultBranch).catch(() => []);
  const merged = await client
    .listPullRequests('closed')
    .then((prs) => prs.find((p) => p.state === 'merged' && p.baseRef === defaultBranch))
    .catch(() => undefined);
  const onPull = merged?.headSha ? await client.listCheckRuns(merged.headSha).catch(() => []) : [];
  return requiredCheckNames(onDefault, onPull);
}

/**
 * Turns protection on: creates the Bridge ruleset, or replaces it when one with its name exists (Complete
 * protection). Needs a token with admin on the repository; GitHub's refusal is thrown as a GitHubError.
 */
export async function protectLibrary(
  client: GitHubClient,
  defaultBranch: string,
  opts: Partial<ProtectionOptions> & { state?: ProtectionState } = {},
): Promise<Ruleset> {
  const checks = opts.checks ?? (await loadRequiredChecks(client, defaultBranch));
  const payload = protectionRuleset({ repo: { defaultBranch } }, { checks, approvals: opts.approvals ?? 1, adminBypass: opts.adminBypass ?? true });
  const id = opts.state?.bridgeRulesetId;
  return id !== undefined ? client.updateRuleset(id, payload) : client.createRuleset(payload);
}

/** GitHub's message when the plan does not allow rulesets on a private repository. */
const PLAN_REFUSED = /upgrade to github (pro|team)|make this repository public|not available for private repositories/i;

/** True when GitHub refused the ruleset because of the repository's plan, not the token. */
export const isPlanRefusal = (err: unknown) => err instanceof GitHubError && (err.status === 403 || err.status === 422) && PLAN_REFUSED.test(`${err.detail ?? ''} ${err.message}`);

/** Where rulesets are managed on GitHub. */
export const rulesSettingsUrl = (owner: string, repo: string) => `https://github.com/${owner}/${repo}/settings/rules`;

/**
 * The one sentence for a refused "Protect the library": the plan, the token's permission, or admin access.
 * Null for any other failure (the caller shows GitHub's message).
 */
export function protectRefusal(err: unknown): string | null {
  if (!(err instanceof GitHubError)) return null;
  if (isPlanRefusal(err)) return "GitHub's plan for this private repository does not include protection rules. Upgrade the plan or make the repository public, then try again.";
  // "Must have admin rights": the person is not an admin, whatever the token allows.
  if (/admin rights/i.test(`${err.detail ?? ''}`)) return 'Only a repository admin can protect the library. Ask an admin, or set it up in GitHub settings.';
  if (err.auth === 'missing-permission') return 'This token cannot change the protection. Add Administration: Read and write to the token on GitHub, then try again.';
  if (err.status === 403 || err.status === 404) return 'Only a repository admin can protect the library. Ask an admin, or set it up in GitHub settings.';
  return null;
}
