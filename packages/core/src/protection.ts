// Library protection: Bridge is the only way into the default branch. Whatever writes (Claude Code, Claude Design,
// a developer, the MCP server), the change lands on a branch and reaches the default branch through a reviewed pull
// request. GitHub enforces it with a repository ruleset on the default branch; this module builds that ruleset and
// reads whether the default branch is protected, from rulesets and from classic branch protection.
//
// Pure: no fetch, no DOM. The GitHub reads live in github-client.ts (listRulesets, getRuleset, getBranchProtection,
// listCheckRuns); Studio, the CLI and the MCP server share these functions.

/** A ruleset rule as GitHub returns and accepts it. */
export interface RulesetRule {
  type: string;
  parameters?: Record<string, unknown>;
}

export interface RulesetBypassActor {
  actor_id: number | null;
  actor_type: 'RepositoryRole' | 'Team' | 'Integration' | 'OrganizationAdmin' | 'DeployKey';
  bypass_mode: 'always' | 'pull_request';
}

/** A repository ruleset (GET /repos/{o}/{r}/rulesets/{id}). The list endpoint leaves out `rules`. */
export interface Ruleset {
  id?: number;
  name: string;
  target?: 'branch' | 'tag' | 'push' | string;
  enforcement: 'active' | 'evaluate' | 'disabled' | string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } } | null;
  rules?: RulesetRule[];
  bypass_actors?: RulesetBypassActor[];
  /** Where the ruleset is edited on GitHub. */
  html_url?: string;
  _links?: { html?: { href?: string } };
}

/** The body of POST /repos/{o}/{r}/rulesets. */
export interface RulesetPayload {
  name: string;
  target: 'branch';
  enforcement: 'active';
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: RulesetRule[];
  bypass_actors: RulesetBypassActor[];
}

/**
 * Classic branch protection (GET /repos/{o}/{r}/branches/{b}/protection), the fields Bridge reads.
 * `null` means the branch has none; `undefined` means it could not be read (no token, no admin access).
 */
export interface ClassicProtection {
  required_pull_request_reviews?: { required_approving_review_count?: number } | null;
  required_status_checks?: { contexts?: string[]; checks?: { context: string }[] } | null;
  allow_force_pushes?: { enabled: boolean } | null;
  allow_deletions?: { enabled: boolean } | null;
}

/** What protecting the library takes, in the order Studio names them. */
export type ProtectionPart = 'review' | 'checks' | 'history' | 'deletion';
export const PROTECTION_PARTS: readonly ProtectionPart[] = ['review', 'checks', 'history', 'deletion'];

export type ProtectionKind = 'protected' | 'partial' | 'unprotected' | 'unknown';

export interface ProtectionState {
  kind: ProtectionKind;
  /** Parts not enforced on the default branch (empty when protected; every part when unprotected or unknown). */
  missing: ProtectionPart[];
  /** The Bridge ruleset (by name), when one exists, active or not: "Complete protection" updates it in place. */
  bridgeRulesetId?: number;
  /** Where to see the rule that protects the branch on GitHub, when one does. */
  url?: string;
}

/** The name Bridge gives its ruleset. Bridge finds it again by this name. */
export const protectionRulesetName = (defaultBranch: string) => `Protect the library (${defaultBranch})`;

/** GitHub's built-in repository role id for "Admin", used in bypass_actors. */
export const ADMIN_ROLE_ID = 5;

export interface ProtectionOptions {
  /** Check names that must pass before a merge (see requiredCheckNames). Empty: no checks rule. */
  checks: string[];
  /** Approvals a pull request needs. Never below 1. */
  approvals: number;
  /** Let repository admins merge a pull request without its approvals (the owner override). */
  adminBypass: boolean;
}

/**
 * The ruleset that protects the library. Choices:
 * - Target `~DEFAULT_BRANCH`, not a branch name: it follows a rename of the default branch.
 * - `deletion` and `non_fast_forward`: nobody deletes the default branch or rewrites its history.
 * - `pull_request` with at least 1 approval: every change goes through a reviewed pull request, direct pushes are
 *   refused whoever pushes. Stale approvals are dismissed on a new push, so what was approved is what merges.
 *   Code owner review and "approval of the most recent push" stay off: CODEOWNERS often holds placeholders, and a
 *   team of two must still be able to ship.
 * - `required_status_checks`: the CI jobs that ran on recent pull requests must pass. Not strict (the branch does
 *   not have to be up to date), which keeps merges from queueing behind each other.
 * - Bypass: repository admins in `pull_request` mode only. They keep the owner override (merge a pull request
 *   whose approvals are missing) but cannot push to the default branch either.
 */
export function protectionRuleset(config: { repo?: { defaultBranch?: string } | undefined } | null | undefined, opts: ProtectionOptions): RulesetPayload {
  const branch = config?.repo?.defaultBranch ?? 'main';
  const approvals = Math.max(1, Math.floor(Number.isFinite(opts.approvals) ? opts.approvals : 1));
  const checks = [...new Set(opts.checks.map((c) => c.trim()).filter(Boolean))];
  const rules: RulesetRule[] = [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: approvals,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    },
  ];
  if (checks.length) {
    rules.push({
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: checks.map((context) => ({ context })),
      },
    });
  }
  return {
    name: protectionRulesetName(branch),
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules,
    bypass_actors: opts.adminBypass ? [{ actor_id: ADMIN_ROLE_ID, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }] : [],
  };
}

/** Minimal check run shape (github-client CheckRun fits). `app` is the GitHub App slug when known. */
export interface CheckRunLike {
  name: string;
  status?: string;
  conclusion: string | null;
  app?: string | undefined;
}

const isVercel = (r: CheckRunLike) => /vercel/i.test(r.app ?? '') || /^vercel\b/i.test(r.name);
const ran = (r: CheckRunLike) => r.conclusion !== 'skipped' && r.conclusion !== 'cancelled' && r.conclusion !== 'stale';

/**
 * The check names to require, read from the repository's own CI, never hardcoded: the check runs of the default
 * branch's latest commit, without Vercel (deploy previews, not tests) and without skipped ones. When the head of a
 * recent pull request is given, only checks that also ran there are kept: a job that runs on pushes to the default
 * branch only (a release job) never reports on a pull request, and requiring it would block every merge.
 */
export function requiredCheckNames(defaultBranchRuns: CheckRunLike[], pullRequestRuns?: CheckRunLike[]): string[] {
  const names = [...new Set(defaultBranchRuns.filter((r) => !isVercel(r) && ran(r)).map((r) => r.name))];
  if (!pullRequestRuns?.length) return names;
  const onPulls = new Set(pullRequestRuns.filter((r) => !isVercel(r)).map((r) => r.name));
  return names.filter((n) => onPulls.has(n));
}

/** Converts a ref pattern (fnmatch: `*` within a segment, `**` across) to a RegExp. */
function refPattern(pattern: string): RegExp {
  const src = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${src}$`);
}

/** True when a branch ruleset's conditions cover the default branch. */
export function rulesetTargetsDefault(ruleset: Ruleset, defaultBranch: string): boolean {
  if (ruleset.target && ruleset.target !== 'branch') return false;
  const ref = `refs/heads/${defaultBranch}`;
  const hit = (p: string) => p === '~ALL' || p === '~DEFAULT_BRANCH' || p === ref || p === defaultBranch || refPattern(p.startsWith('refs/') ? p : `refs/heads/${p}`).test(ref);
  const cond = ruleset.conditions?.ref_name;
  // A repository ruleset with no ref condition applies to nothing; GitHub requires one.
  if (!cond) return false;
  if ((cond.exclude ?? []).some(hit)) return false;
  return (cond.include ?? []).some(hit);
}

const count = (v: unknown) => (typeof v === 'number' ? v : 0);

/** The parts one ruleset enforces (active rulesets only; "evaluate" only reports). */
function rulesetParts(ruleset: Ruleset): Set<ProtectionPart> {
  const parts = new Set<ProtectionPart>();
  if (ruleset.enforcement !== 'active') return parts;
  for (const rule of ruleset.rules ?? []) {
    if (rule.type === 'deletion') parts.add('deletion');
    if (rule.type === 'non_fast_forward') parts.add('history');
    if (rule.type === 'pull_request' && count(rule.parameters?.required_approving_review_count) >= 1) parts.add('review');
    if (rule.type === 'required_status_checks' && Array.isArray(rule.parameters?.required_status_checks) && (rule.parameters.required_status_checks as unknown[]).length > 0) parts.add('checks');
  }
  return parts;
}

/** The parts classic branch protection enforces. Force pushes and deletions are refused unless allowed. */
function classicParts(p: ClassicProtection): Set<ProtectionPart> {
  const parts = new Set<ProtectionPart>();
  if (count(p.required_pull_request_reviews?.required_approving_review_count) >= 1) parts.add('review');
  if (((p.required_status_checks?.contexts?.length ?? 0) || (p.required_status_checks?.checks?.length ?? 0)) > 0) parts.add('checks');
  if (!p.allow_force_pushes?.enabled) parts.add('history');
  if (!p.allow_deletions?.enabled) parts.add('deletion');
  return parts;
}

const rulesetUrl = (r: Ruleset) => r.html_url ?? r._links?.html?.href;

/**
 * Whether the default branch is protected, from full rulesets (with `rules`; null when they could not be read) and
 * classic branch protection (null when the branch has none, undefined when it could not be read).
 * - protected: review, checks, no history rewrite and no deletion are all enforced.
 * - partial: some of them are.
 * - unprotected: none of them, and both sources were read.
 * - unknown: nothing could be read, or nothing was found in one source while the other could not be read.
 */
export function protectionState(rulesets: Ruleset[] | null | undefined, branchProtection: ClassicProtection | null | undefined, defaultBranch: string): ProtectionState {
  const bridge = rulesets?.find((r) => r.name === protectionRulesetName(defaultBranch));
  const extra = bridge?.id !== undefined ? { bridgeRulesetId: bridge.id } : {};
  const covered = new Set<ProtectionPart>();
  let url: string | undefined;
  for (const r of rulesets ?? []) {
    if (!rulesetTargetsDefault(r, defaultBranch)) continue;
    const parts = rulesetParts(r);
    if (parts.size && !url) url = rulesetUrl(r);
    parts.forEach((p) => covered.add(p));
  }
  if (branchProtection) classicParts(branchProtection).forEach((p) => covered.add(p));
  const missing = PROTECTION_PARTS.filter((p) => !covered.has(p));
  const withUrl = url ? { url } : {};
  if (!missing.length) return { kind: 'protected', missing, ...extra, ...withUrl };
  const unreadable = rulesets == null || branchProtection === undefined;
  if (covered.size === 0) return { kind: unreadable ? 'unknown' : 'unprotected', missing, ...extra };
  return { kind: 'partial', missing, ...extra, ...withUrl };
}

/** Plain words for each part, for designers: no "ruleset", "branch" or "force push". */
export const PROTECTION_PART_PHRASE: Record<ProtectionPart, string> = {
  review: 'changes can skip review',
  checks: 'checks do not have to pass',
  history: 'past changes can be rewritten',
  deletion: 'the library can be deleted',
};

const joinAnd = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The one sentence Studio, the CLI and the MCP server show for a protection state. */
export function protectionSentence(state: ProtectionState): string {
  switch (state.kind) {
    case 'protected':
      return 'Protected: every change goes through review.';
    case 'unprotected':
      return 'Your library can be changed without review.';
    case 'partial': {
      const s = joinAnd(state.missing.map((p) => PROTECTION_PART_PHRASE[p]));
      return `Partly protected: ${s}.`;
    }
    default:
      return 'Protection status unknown: GitHub did not let this token read it.';
  }
}
