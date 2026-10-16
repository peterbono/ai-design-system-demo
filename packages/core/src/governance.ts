// The branch guard every Bridge write path shares: the GitHub client, the local git writer, the plugin and
// the MCP server. Agents create new branches and pull requests; they never write to a protected branch.

export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

export class ProtectedBranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectedBranchError';
  }
}

export interface BranchRules {
  protectedBranches?: string[] | undefined;
  /** The branch a proposal targets; writing to it is refused too. */
  base?: string | undefined;
  /** When set, new branches must start with it. */
  branchPrefix?: string | undefined;
}

/** Throws ProtectedBranchError when `branch` is protected, is the base, or lacks the required prefix. */
export function assertSafeBranch(branch: string, rules: BranchRules = {}): void {
  const name = branch.replace(/^refs\/heads\//, '').trim();
  const blocked = new Set([...(rules.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES), ...(rules.base ? [rules.base] : [])]);
  if (!name || blocked.has(name)) {
    throw new ProtectedBranchError(`Refusing to write to protected branch "${name}". Bridge only creates new branches and pull requests.`);
  }
  if (rules.branchPrefix && !name.startsWith(rules.branchPrefix)) {
    throw new ProtectedBranchError(`Branch "${name}" must start with "${rules.branchPrefix}".`);
  }
}
