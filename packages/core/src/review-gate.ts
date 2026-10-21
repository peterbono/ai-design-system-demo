// Review and merge rules shared by Bridge Studio, the MCP server and the CLI: one implementation of who may merge
// a branch, what blocks it, the owner override and its audit comment, the review queue and the status of a branch.
// Pure functions over GitHub REST shapes, no fetch, no DOM. Same rules as docs/GOVERNANCE.md: the highest tier wins,
// Tier 2 and 3 need a design and a tech approval, nothing merges while tests fail. Who may ship comes from
// `governance.rights` (rights.ts). Moved from the docs site (apps/docs-site/src/lib/review-rules.ts re-exports it).
import type { OverridePolicy } from './config';
import { isActiveExploration } from './explorations';
import { canShip, soloApprover, unreadableShipTeams, whoCanShipSentence, type ShipPolicy } from './rights';
import { classifyRisk, type RiskTier } from './risk';

export interface LabelLike {
  name: string;
}

/** Tier from labels (`tier-3`, `tier: 3`, `risk:3`), the PR template checkbox (`- [x] Tier 3`) or a `Risk tier: 3` line. Highest wins. */
export function parseTier(labels: LabelLike[], body: string | null | undefined): RiskTier | null {
  const found: number[] = [];
  for (const l of labels) {
    const m = l.name.match(/^(?:risk[\s:-]*)?tier[\s:_-]*([123])\b/i) ?? l.name.match(/^risk[\s:_-]*([123])$/i);
    if (m) found.push(Number(m[1]));
  }
  for (const m of (body ?? '').matchAll(/-\s*\[[xX]\]\s*\**\s*Tier\s*([123])\b/g)) found.push(Number(m[1]));
  // "**Risk tier:** 3, high" or "Risk tier: Tier 2"
  for (const m of (body ?? '').matchAll(/risk tier\W{0,6}(?:tier\s*)?([123])\b/gi)) found.push(Number(m[1]));
  return found.length ? (Math.max(...found) as RiskTier) : null;
}

/** What GitHub returns about a pull request's lifecycle. `merged_at` is set once merged; `state` is then "closed". */
export interface PullStateLike {
  state?: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
}

export type PullState = 'merged' | 'closed' | 'draft' | 'open';

/** Merged wins over closed (GitHub reports merged pull requests as closed), closed over draft, draft over open. */
export function pullState(p: PullStateLike): PullState {
  if (p.merged_at || p.merged) return 'merged';
  if (p.state && p.state !== 'open') return 'closed';
  if (p.draft) return 'draft';
  return 'open';
}

/** Label and pill tone of each state, for list and detail views. */
export const PULL_STATE_PILL: Record<PullState, { label: string; cls: string }> = {
  merged: { label: 'Merged', cls: '' },
  closed: { label: 'Closed', cls: '' },
  draft: { label: 'Draft', cls: '' },
  open: { label: 'Open', cls: '' },
};

/** Pull requests still waiting for review (open or draft): merged and closed ones never count as open reviews. */
export function openPulls<P extends PullStateLike>(pulls: P[]): P[] {
  return pulls.filter((p) => {
    const s = pullState(p);
    return s === 'open' || s === 'draft';
  });
}

export interface CiRunLike {
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: string | null;
  html_url?: string;
}

export interface CiStatusLike {
  context: string;
  state: 'success' | 'failure' | 'error' | 'pending' | string;
  target_url?: string | null;
}

export type CiState = 'pass' | 'fail' | 'pending' | 'none';

export interface CiSummary {
  state: CiState;
  total: number;
  passed: number;
  failed: { name: string; url?: string }[];
  pending: { name: string; url?: string }[];
}

const OK = new Set(['success', 'neutral', 'skipped']);

/** Combines check runs and commit statuses into one verdict. Any failure wins over pending. */
export function summarizeCi(runs: CiRunLike[], statuses: CiStatusLike[] = []): CiSummary {
  const failed: CiSummary['failed'] = [];
  const pending: CiSummary['pending'] = [];
  let passed = 0;
  for (const r of runs) {
    if (r.status !== 'completed') pending.push({ name: r.name, url: r.html_url });
    else if (r.conclusion && OK.has(r.conclusion)) passed++;
    else failed.push({ name: r.name, url: r.html_url });
  }
  // Statuses repeat per context; the first one is the latest.
  const seen = new Set<string>();
  for (const s of statuses) {
    if (seen.has(s.context)) continue;
    seen.add(s.context);
    if (s.state === 'success') passed++;
    else if (s.state === 'pending') pending.push({ name: s.context, url: s.target_url ?? undefined });
    else failed.push({ name: s.context, url: s.target_url ?? undefined });
  }
  const total = passed + failed.length + pending.length;
  const state: CiState = total === 0 ? 'none' : failed.length ? 'fail' : pending.length ? 'pending' : 'pass';
  return { state, total, passed, failed, pending };
}

export interface ReviewLike {
  user: { login: string } | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING' | string;
  submitted_at?: string | null;
}

export interface ApprovalSummary {
  approvers: string[];
  changesRequested: string[];
  design: boolean;
  tech: boolean;
}

export interface ApprovalRules {
  /**
   * `governance.soloOwnerCanApproveBoth`: when the owners resolve to one person holding both roles, that person's
   * approval counts for design and tech. Default false. The author still never approves their own change.
   */
  soloOwnerCanApproveBoth?: boolean | undefined;
}

/** Latest decisive review per person (comments do not reset an approval), then owner coverage. */
export function summarizeApprovals(reviews: ReviewLike[], owners: { design: string[]; tech: string[] }, author?: string, rules: ApprovalRules = {}): ApprovalSummary {
  const latest = new Map<string, string>();
  const sorted = [...reviews].sort((a, b) => String(a.submitted_at ?? '').localeCompare(String(b.submitted_at ?? '')));
  for (const r of sorted) {
    const login = r.user?.login;
    if (!login || login === author) continue;
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') latest.set(login, r.state);
  }
  const approvers = [...latest].filter(([, s]) => s === 'APPROVED').map(([l]) => l);
  const changesRequested = [...latest].filter(([, s]) => s === 'CHANGES_REQUESTED').map(([l]) => l);
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase().replace(/^@/, ''));
  const d = lower(owners.design);
  const t = lower(owners.tech);
  const a = lower(approvers);
  let design: boolean;
  let tech: boolean;
  if (d.length || t.length) {
    design = d.length ? a.some((x) => d.includes(x)) : a.length > 0;
    // One person holding both roles cannot cover both approvals alone, unless the team opted in and that person is
    // the only owner (governance.soloOwnerCanApproveBoth).
    const solo = rules.soloOwnerCanApproveBoth ? soloApprover(owners) : null;
    const soloBoth = (x: string) => a.length === 1 && d.includes(x) && x !== solo;
    tech = t.length ? a.some((x) => t.includes(x) && !soloBoth(x)) : a.length > 1;
  } else {
    // No owners configured: two distinct approvers stand in for design and tech.
    design = a.length >= 1;
    tech = a.length >= 2;
  }
  return { approvers, changesRequested, design, tech };
}

export type MissingApproval = 'design approval' | 'tech approval' | 'approval';

export interface MergeGate {
  allowed: boolean;
  reasons: string[];
  /** True when the only failing reasons are missing approvals and the viewer is in `governance.override.allowed`. */
  overridable: boolean;
  /** Approvals still missing, in the words the override comment uses. */
  missing: MissingApproval[];
  /** Whether the viewer holds the right to ship (true when no rule singles anyone out or the viewer is unknown). */
  canShip: boolean;
}

const normLogin = (x: string) => x.trim().toLowerCase().replace(/^@/, '');

/** Whether `login` may use the owner override. Case-insensitive, a leading @ is ignored. */
export function canOverride(login: string | null | undefined, policy: OverridePolicy | null | undefined): boolean {
  if (!login || !policy?.allowed.length) return false;
  return policy.allowed.map(normLogin).includes(normLogin(login));
}

/**
 * Whether the Merge button is enabled, and why not. Mirrors docs/GOVERNANCE.md.
 * The owner override only ever covers missing approvals: CI failing or running, changes requested, a draft,
 * a closed pull request or a merge conflict always block, for everyone.
 */
export function mergeGate(input: {
  tier: RiskTier | null;
  ci: CiSummary;
  approvals: ApprovalSummary;
  draft: boolean;
  mergeable?: boolean | null;
  state: string;
  merged_at?: string | null;
  /** Login of the connected viewer (GitHub /user). */
  viewer?: string | null;
  override?: OverridePolicy | null;
  /** A running exploration (label `exploration`): never merged as is, whatever else is green. */
  exploration?: boolean;
  /** Who may ship (shipPolicy from governance.rights). null or absent: anyone with write access. */
  ship?: ShipPolicy | null;
}): MergeGate {
  const blocking: string[] = [];
  const missing: MissingApproval[] = [];
  const approvalReasons: string[] = [];
  const lifecycle = pullState(input);
  if (lifecycle === 'merged') blocking.push('This branch is already merged.');
  else if (lifecycle === 'closed') blocking.push('This branch is closed.');
  if (input.exploration && lifecycle !== 'merged' && lifecycle !== 'closed') blocking.push('It is an exploration: promote it to review first.');
  if (input.draft) blocking.push('It is a draft. Mark it ready for review on GitHub first.');
  if (input.ci.state === 'fail') blocking.push(`Tests fail: ${input.ci.failed.map((f) => f.name).join(', ')}.`);
  if (input.ci.state === 'pending') blocking.push('Tests are still running.');
  if (input.approvals.changesRequested.length) blocking.push(`Changes requested by @${input.approvals.changesRequested.join(', @')}.`);
  const tier = input.tier ?? 3;
  // docs/GOVERNANCE.md: Tier 2 (new component, variant or prop) and Tier 3 need a design and a tech owner approval.
  if (tier >= 2) {
    if (!input.approvals.design) {
      approvalReasons.push('It needs a design owner approval.');
      missing.push('design approval');
    }
    if (!input.approvals.tech) {
      approvalReasons.push('It needs a tech owner approval.');
      missing.push('tech approval');
    }
  } else if (!input.approvals.approvers.length) {
    approvalReasons.push('It needs one approval.');
    missing.push('approval');
  }
  const conflict = input.mergeable === false ? [CONFLICT_REASON] : [];
  // Only a known viewer is checked: without a login the Merge button asks to connect first anyway.
  const shipper = !input.viewer || canShip(input.viewer, input.ship);
  // A team holding the right that GitHub would not show: say why and how to fix it, never treat it as empty.
  const ship = !shipper && lifecycle !== 'merged' && lifecycle !== 'closed' ? [whoCanShipSentence(input.ship!), ...unreadableShipTeams(input.ship).map((t) => (t.status === 'unreadable' ? t.message : ''))] : [];
  // Order: state, draft, CI, changes requested, approvals, who ships, conflict.
  const reasons = [...blocking, ...approvalReasons, ...ship, ...conflict];
  const allowed = reasons.length === 0;
  // The override skips approvals only: it never lets someone ship who does not hold the right.
  const overridable = !allowed && blocking.length + conflict.length + ship.length === 0 && missing.length > 0 && canOverride(input.viewer, input.override);
  return { allowed, reasons, overridable, missing, canShip: shipper };
}

/** The gate reason of a conflict, in the words a designer reads. Detected by identity, never by regex. */
export const CONFLICT_REASON = 'It conflicts with main: resolve it with Update from main on the branch.';

export const OVERRIDE_HEADING = '**Bridge owner override**';

/** Problem with an override reason, or null when it is accepted. */
export function overrideReasonProblem(reason: string, policy: OverridePolicy): string | null {
  if (!policy.requireReason) return null;
  const n = reason.trim().length;
  if (n === 0) return `Write why this merges without the missing approvals, in at least ${policy.minReasonLength} characters.`;
  if (n < policy.minReasonLength) return `Write at least ${policy.minReasonLength} characters (${n} so far), so the history says why.`;
  return null;
}

/**
 * The audit comment posted on the pull request before an override merge. Stable format: History and the PR
 * timeline find it by its first line, `**Bridge owner override**`, and read it back with parseOverrideComment.
 */
export function overrideComment(login: string, reason: string, missing: MissingApproval[]): string {
  const why = reason.trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
  return `${OVERRIDE_HEADING}\n\nOwner override by @${normLogin(login)}: ${why || 'no reason given'}. Missing: ${missing.join(', ')}. Merged from Bridge.`;
}

/** The comment body after GitHub refused the merge, so the audit trail does not claim a merge that never happened. */
export function overrideRefusedComment(body: string, message: string): string {
  return body.replace(/ Merged from Bridge\.$/, ` Merge refused by GitHub: ${message.trim().replace(/[.\s]+$/, '')}. Not merged.`);
}

export interface OverrideRecord {
  login: string;
  reason: string;
  missing: string[];
  merged: boolean;
}

/** Reads an override comment back; null for any other comment. */
export function parseOverrideComment(body: string | null | undefined): OverrideRecord | null {
  const text = (body ?? '').trim();
  if (!text.startsWith(OVERRIDE_HEADING)) return null;
  const m = text.match(/Owner override by @([\w-]+): ([\s\S]*?)\. Missing: ([^.]*)\. (Merged from Bridge\.|Merge refused by GitHub)/);
  if (!m) return null;
  return { login: m[1]!, reason: m[2]!, missing: m[3]!.split(/,\s*/).filter(Boolean), merged: m[4]!.startsWith('Merged') };
}

export type MergeMethod = 'squash' | 'merge' | 'rebase';

/** Merge methods the repo allows, squash first. Unknown settings (no push access) count as allowed. */
export function allowedMergeMethods(repo: { allow_squash_merge?: boolean; allow_merge_commit?: boolean; allow_rebase_merge?: boolean } | null | undefined): MergeMethod[] {
  const out: MergeMethod[] = [];
  if (repo?.allow_squash_merge !== false) out.push('squash');
  if (repo?.allow_merge_commit !== false) out.push('merge');
  if (repo?.allow_rebase_merge !== false) out.push('rebase');
  return out;
}

/** Whether the viewer can write to the repo, from `permissions` on GET /repos/{owner}/{repo} with their token. */
export function hasWriteAccess(perms: { admin?: boolean; maintain?: boolean; push?: boolean } | null | undefined): boolean {
  return Boolean(perms && (perms.admin || perms.maintain || perms.push));
}

export type ReviewStatusKind =
  | 'merged'
  | 'closed'
  | 'draft'
  | 'ci-failing'
  | 'changes-requested'
  | 'ci-running'
  | 'needs-design'
  | 'needs-tech'
  | 'needs-approval'
  | 'conflict'
  | 'checking'
  | 'ready'
  | 'unknown';

/**
 * Sort order for a "needs you" list, most urgent first: what blocks the merge, then what waits for an approval,
 * then what is ready, then running checks and unknown ones, drafts and finished ones last. Lower comes first.
 */
export const REVIEW_STATUS_ORDER: Record<ReviewStatusKind, number> = {
  'ci-failing': 0,
  conflict: 1,
  'changes-requested': 2,
  'needs-design': 3,
  'needs-tech': 4,
  'needs-approval': 5,
  ready: 6,
  'ci-running': 7,
  checking: 8,
  unknown: 9,
  draft: 10,
  merged: 11,
  closed: 12,
};

/**
 * One status chip for a pull request, from real data. Same rules and order as the pull request header
 * (lib/changes needFromDetail): lifecycle, draft, CI failing, changes requested, merge conflict, CI running, then
 * missing approvals (Tier 3 by default), then ready. `mergeable` null means GitHub has not computed it yet: the chip
 * reads "Checking" instead of an approval or "Ready to ship", so a list never says something the detail contradicts.
 * Undefined means it was not read: no conflict known. `ready` is returned only when mergeGate allows the merge.
 * Unknown CI or reviews (null, still loading or failed) never read as ready.
 */
export function reviewStatusKind(input: {
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  ci: CiSummary | null;
  approvals: ApprovalSummary | null;
  tier: RiskTier | null;
  mergeable?: boolean | null;
}): ReviewStatusKind {
  const out = (kind: ReviewStatusKind): ReviewStatusKind => kind;
  const lifecycle = pullState(input);
  if (lifecycle === 'merged') return out('merged');
  if (lifecycle === 'closed') return out('closed');
  if (lifecycle === 'draft') return out('draft');
  if (input.ci?.state === 'fail') return out('ci-failing');
  if (input.approvals?.changesRequested.length) return out('changes-requested');
  if (input.mergeable === false) return out('conflict');
  if (input.ci?.state === 'pending') return out('ci-running');
  if (!input.ci || !input.approvals) return out('unknown');
  if (input.mergeable === null) return out('checking');
  const tier = input.tier ?? 3;
  if (tier >= 2) {
    if (!input.approvals.design) return out('needs-design');
    if (!input.approvals.tech) return out('needs-tech');
  } else if (!input.approvals.approvers.length) return out('needs-approval');
  const gate = mergeGate({ tier: input.tier, ci: input.ci, approvals: input.approvals, draft: Boolean(input.draft), mergeable: input.mergeable, state: input.state ?? 'open', merged_at: input.merged_at });
  return gate.allowed ? out('ready') : out('unknown');
}

// ---------------------------------------------------------------------------------------------------------------
// The review queue: which open pull requests wait for a review. Left out: running explorations (tried, never merged
// as is) and GitHub automation (the changesets release pull request, anything github-actions[bot] opened).

export interface QueuePull extends PullStateLike {
  state: string;
  labels?: ({ name?: string } | string)[];
  head: { ref: string };
  user?: { login: string; type?: string } | null;
}

const BOTS = new Set(['github-actions[bot]', 'app/github-actions', 'changeset-bot[bot]']);

/** The changesets release pull request ("Version packages"), on a changeset-release/* branch. */
export const isReleasePull = (p: Pick<QueuePull, 'head'>) => p.head.ref.startsWith('changeset-release/');

/** Opened by GitHub automation, not by a person: the release pull request or anything github-actions[bot] opened. */
export function isAutomationPull(p: Pick<QueuePull, 'head' | 'user'>): boolean {
  return isReleasePull(p) || BOTS.has((p.user?.login ?? '').toLowerCase());
}

/** A running exploration: open and labeled exploration. */
const runningExploration = (p: Pick<QueuePull, 'state' | 'labels'>) => p.state === 'open' && isActiveExploration((p.labels ?? []) as never);

/** The open pull requests that wait for a review, in the order given. Every count in the Studio comes from here. */
export function reviewQueue<P extends QueuePull>(pulls: P[]): P[] {
  return openPulls(pulls).filter((p) => !isAutomationPull(p) && !runningExploration(p));
}

/** The open release pull request, if the changesets action opened one. */
export function releasePull<P extends QueuePull>(pulls: P[]): P | null {
  return openPulls(pulls).find((p) => isReleasePull(p)) ?? null;
}

/**
 * The approval a change needs, the same rule everywhere: the tier the author set (label, PR template checkbox or
 * "Risk tier" line) or the one the shared classifier computes from the changed files, highest wins. Without files
 * (not read yet) only a label counts, and a missing label stays unknown.
 */
export function effectiveTier(labels: LabelLike[], body: string | null | undefined, files: { filename: string; status?: string }[] | null): RiskTier | null {
  const labelled = parseTier(labels, body);
  if (!files) return labelled;
  const computed = classifyRisk({ files: files.map((f) => ({ path: f.filename, status: f.status })) }).tier;
  return Math.max(labelled ?? 0, computed) as RiskTier;
}

// ---------------------------------------------------------------------------------------------------------------
// Reopen

export type ReopenEligibility =
  /** The branch is still there: the change can be reopened as it was. */
  | { kind: 'reopen' }
  /** The branch is gone: nothing to reopen, but its token edits can start a new change. */
  | { kind: 'gone' }
  /** Not closed, or not the viewer's to reopen, or not known yet. */
  | { kind: 'none' };

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');

/**
 * Whether the viewer can reopen a closed change: only a change closed without shipping, only its author or an owner
 * (governance.owners, both roles), and only someone GitHub lets write (write access, or the author). `branch` is what
 * GitHub said about the head branch: there, removed, or not read.
 */
export function reopenEligibility(x: {
  state: PullState;
  viewer: string | null;
  author: string;
  owners: string[];
  canWrite: boolean;
  branch: 'exists' | 'gone' | 'unknown';
}): ReopenEligibility {
  if (x.state !== 'closed' || !x.viewer) return { kind: 'none' };
  const isAuthor = norm(x.viewer) === norm(x.author);
  const isOwner = x.owners.some((o) => norm(o) === norm(x.viewer!));
  if (!isAuthor && !isOwner) return { kind: 'none' };
  if (!x.canWrite && !isAuthor) return { kind: 'none' };
  if (x.branch === 'exists') return { kind: 'reopen' };
  if (x.branch === 'gone') return { kind: 'gone' };
  return { kind: 'none' };
}


// ---------------------------------------------------------------------------------------------------------------
// Who still approves, and who else to ask ("Ask someone else to review" in the review queue)

export type ApprovalRole = 'design' | 'tech' | 'approval';

const NO_CI: CiSummary = { state: 'pass', total: 0, passed: 0, failed: [], pending: [] };
const ROLE_OF_MISSING: Record<MissingApproval, ApprovalRole> = { 'design approval': 'design', 'tech approval': 'tech', approval: 'approval' };

/** The approvals a tier needs, as mergeGate counts them (Tier 2 and 3: design and tech; Tier 1: one approval). */
export function requiredApprovals(tier: RiskTier | null): ApprovalRole[] {
  return mergeGate({ tier, ci: NO_CI, approvals: { approvers: [], changesRequested: [], design: false, tech: false }, draft: false, state: 'open' }).missing.map((m) => ROLE_OF_MISSING[m]);
}

/** The approvals still missing on a branch, from its tier and the reviews read (empty when either is unknown). */
export function pendingApprovals(tier: RiskTier | null | undefined, approvals: ApprovalSummary | null | undefined): ApprovalRole[] {
  if (tier == null || !approvals) return [];
  return mergeGate({ tier, ci: NO_CI, approvals, draft: false, state: 'open' }).missing.map((m) => ROLE_OF_MISSING[m]);
}

const uniqLogins = (xs: string[]) => xs.filter((x, i) => xs.findIndex((y) => normLogin(y) === normLogin(x)) === i);

/**
 * Who can still give an approval: the owners listed for the role (both lists for a plain approval) minus the author
 * and anyone who already approved. `open`: the config lists nobody for the role, so any reviewer but the author counts.
 */
export function eligibleReviewers(role: ApprovalRole, p: { owners: { design: string[]; tech: string[] }; author: string; approvers?: string[] | undefined }): { open: boolean; logins: string[]; listed: string[] } {
  const raw = role === 'design' ? p.owners.design : role === 'tech' ? p.owners.tech : uniqLogins([...p.owners.design, ...p.owners.tech]);
  const listed = raw.map((x) => x.replace(/^@/, ''));
  const approvers = (p.approvers ?? []).map(normLogin);
  const logins = listed.filter((l) => normLogin(l) !== normLogin(p.author) && !approvers.includes(normLogin(l)));
  return { open: listed.length === 0, logins, listed };
}

/**
 * "Ask someone else to review": the other people who can give the missing approvals, never the viewer or the author.
 * Empty when nobody else can (the caller says to review it or to add a reviewer in Settings).
 */
export function reviewersToAsk(x: { tier: RiskTier | null; approvals: ApprovalSummary; owners: { design: string[]; tech: string[] }; author: string; viewer: string | null | undefined }): string[] {
  const roles = pendingApprovals(x.tier, x.approvals);
  const all = roles.flatMap((r) => eligibleReviewers(r, { owners: x.owners, author: x.author, approvers: x.approvals.approvers }).logins);
  return uniqLogins(all).filter((l) => normLogin(l) !== normLogin(x.viewer ?? '') && normLogin(l) !== normLogin(x.author));
}
