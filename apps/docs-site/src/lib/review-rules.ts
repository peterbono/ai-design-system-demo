// Governance rules for the Reviews section, as pure functions so they are unit tested and shared by the page
// script. Same rules as docs/GOVERNANCE.md: the highest tier wins, Tier 3 needs a design and a tech approval,
// nothing merges while CI fails.

export type Tier = 1 | 2 | 3;

export interface LabelLike {
  name: string;
}

/** Tier from labels (`tier-3`, `tier: 3`, `risk:3`), the PR template checkbox (`- [x] Tier 3`) or a `Risk tier: 3` line. Highest wins. */
export function parseTier(labels: LabelLike[], body: string | null | undefined): Tier | null {
  const found: number[] = [];
  for (const l of labels) {
    const m = l.name.match(/^(?:risk[\s:-]*)?tier[\s:_-]*([123])\b/i) ?? l.name.match(/^risk[\s:_-]*([123])$/i);
    if (m) found.push(Number(m[1]));
  }
  for (const m of (body ?? '').matchAll(/-\s*\[[xX]\]\s*\**\s*Tier\s*([123])\b/g)) found.push(Number(m[1]));
  // "**Risk tier:** 3, high" or "Risk tier: Tier 2"
  for (const m of (body ?? '').matchAll(/risk tier\W{0,6}(?:tier\s*)?([123])\b/gi)) found.push(Number(m[1]));
  return found.length ? (Math.max(...found) as Tier) : null;
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

export interface CheckRunLike {
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: string | null;
  html_url?: string;
}

export interface StatusLike {
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
export function summarizeCi(runs: CheckRunLike[], statuses: StatusLike[] = []): CiSummary {
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

/** Latest decisive review per person (comments do not reset an approval), then owner coverage. */
export function summarizeApprovals(reviews: ReviewLike[], owners: { design: string[]; tech: string[] }, author?: string): ApprovalSummary {
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
    // One person holding both roles cannot cover both approvals alone.
    const soloBoth = (x: string) => a.length === 1 && d.includes(x);
    tech = t.length ? a.some((x) => t.includes(x) && !soloBoth(x)) : a.length > 1;
  } else {
    // No owners configured: two distinct approvers stand in for design and tech.
    design = a.length >= 1;
    tech = a.length >= 2;
  }
  return { approvers, changesRequested, design, tech };
}

export interface OverridePolicy {
  /** GitHub logins allowed to merge as owner override. Empty: nobody. */
  allowed: string[];
  requireReason: boolean;
  minReasonLength: number;
}

export const NO_OVERRIDE: OverridePolicy = { allowed: [], requireReason: true, minReasonLength: 20 };

export type MissingApproval = 'design approval' | 'tech approval' | 'approval';

export interface MergeGate {
  allowed: boolean;
  reasons: string[];
  /** True when the only failing reasons are missing approvals and the viewer is in `governance.override.allowed`. */
  overridable: boolean;
  /** Approvals still missing, in the words the override comment uses. */
  missing: MissingApproval[];
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
  tier: Tier | null;
  ci: CiSummary;
  approvals: ApprovalSummary;
  draft: boolean;
  mergeable?: boolean | null;
  state: string;
  merged_at?: string | null;
  /** Login of the connected viewer (GitHub /user). */
  viewer?: string | null;
  override?: OverridePolicy | null;
}): MergeGate {
  const blocking: string[] = [];
  const missing: MissingApproval[] = [];
  const approvalReasons: string[] = [];
  const lifecycle = pullState(input);
  if (lifecycle === 'merged') blocking.push('This pull request is already merged.');
  else if (lifecycle === 'closed') blocking.push('This pull request is closed.');
  if (input.draft) blocking.push('It is a draft. Mark it ready for review on GitHub first.');
  if (input.ci.state === 'fail') blocking.push(`CI fails: ${input.ci.failed.map((f) => f.name).join(', ')}.`);
  if (input.ci.state === 'pending') blocking.push('CI is still running.');
  if (input.approvals.changesRequested.length) blocking.push(`Changes requested by @${input.approvals.changesRequested.join(', @')}.`);
  const tier = input.tier ?? 3;
  if (tier === 3) {
    if (!input.approvals.design) {
      approvalReasons.push('Tier 3 needs a design owner approval.');
      missing.push('design approval');
    }
    if (!input.approvals.tech) {
      approvalReasons.push('Tier 3 needs a tech owner approval.');
      missing.push('tech approval');
    }
  } else if (!input.approvals.approvers.length) {
    approvalReasons.push(`Tier ${tier} needs one approval.`);
    missing.push('approval');
  }
  const conflict = input.mergeable === false ? ['GitHub reports a merge conflict.'] : [];
  // Order: state, draft, CI, changes requested, approvals, conflict.
  const reasons = [...blocking, ...approvalReasons, ...conflict];
  const allowed = reasons.length === 0;
  const overridable = !allowed && blocking.length + conflict.length === 0 && missing.length > 0 && canOverride(input.viewer, input.override);
  return { allowed, reasons, overridable, missing };
}

export const OVERRIDE_HEADING = '**Bridge owner override**';

/** Problem with an override reason, or null when it is accepted. */
export function overrideReasonProblem(reason: string, policy: OverridePolicy): string | null {
  if (!policy.requireReason) return null;
  const n = reason.trim().length;
  if (n === 0) return 'Write why this merges without the missing approvals.';
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
export function canWrite(perms: { admin?: boolean; maintain?: boolean; push?: boolean } | null | undefined): boolean {
  return Boolean(perms && (perms.admin || perms.maintain || perms.push));
}

/** Changeset files in a PR (`.changeset/*.md`, not the README) with their bump lines. */
export function parseChangeset(text: string): { bumps: { pkg: string; bump: string }[]; summary: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { bumps: [], summary: text.trim() };
  const bumps = [...m[1]!.matchAll(/["']?([@\w/.-]+)["']?\s*:\s*(major|minor|patch)/g)].map((x) => ({ pkg: x[1]!, bump: x[2]! }));
  return { bumps, summary: m[2]!.trim() };
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
  | 'ready'
  | 'unknown';

export interface ReviewStatus {
  kind: ReviewStatusKind;
  label: string;
  /** Pill class: '', is-pass, is-fail, is-warn, is-info, is-accent. */
  tone: string;
}

/**
 * Label and tone of each status. Color means status only (lib/changes.ts): red when something blocks the merge,
 * violet while it waits for an approval, green when it is ready, grey for drafts, running checks, unknown, merged
 * and closed. Risk tiers never take a color.
 */
export const REVIEW_STATUS: Record<ReviewStatusKind, { label: string; tone: string }> = {
  merged: { label: 'Merged', tone: '' },
  closed: { label: 'Closed', tone: '' },
  draft: { label: 'Draft', tone: '' },
  'ci-failing': { label: 'CI failing', tone: 'is-fail' },
  'changes-requested': { label: 'Changes requested', tone: 'is-fail' },
  'ci-running': { label: 'CI running', tone: '' },
  'needs-design': { label: 'Needs design approval', tone: 'is-info' },
  'needs-tech': { label: 'Needs tech approval', tone: 'is-info' },
  'needs-approval': { label: 'Needs approval', tone: 'is-info' },
  conflict: { label: 'Merge conflict', tone: 'is-fail' },
  ready: { label: 'Ready to merge', tone: 'is-pass' },
  unknown: { label: 'Status unknown', tone: '' },
};

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
  unknown: 8,
  draft: 9,
  merged: 10,
  closed: 11,
};

/**
 * One status chip for a pull request, from real data. Same rules and order as mergeGate: lifecycle, draft, CI
 * failing, changes requested, CI running, missing approvals (Tier 3 by default), merge conflict, then ready.
 * `ready` is returned only when mergeGate allows the merge. Unknown CI or reviews (null, still loading or failed)
 * never read as ready.
 */
export function reviewStatus(input: {
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  ci: CiSummary | null;
  approvals: ApprovalSummary | null;
  tier: Tier | null;
  mergeable?: boolean | null;
}): ReviewStatus {
  const out = (kind: ReviewStatusKind): ReviewStatus => ({ kind, ...REVIEW_STATUS[kind] });
  const lifecycle = pullState(input);
  if (lifecycle === 'merged') return out('merged');
  if (lifecycle === 'closed') return out('closed');
  if (lifecycle === 'draft') return out('draft');
  if (input.ci?.state === 'fail') return out('ci-failing');
  if (input.approvals?.changesRequested.length) return out('changes-requested');
  if (input.ci?.state === 'pending') return out('ci-running');
  if (!input.ci || !input.approvals) return out('unknown');
  const tier = input.tier ?? 3;
  if (tier === 3) {
    if (!input.approvals.design) return out('needs-design');
    if (!input.approvals.tech) return out('needs-tech');
  } else if (!input.approvals.approvers.length) return out('needs-approval');
  if (input.mergeable === false) return out('conflict');
  const gate = mergeGate({ tier: input.tier, ci: input.ci, approvals: input.approvals, draft: Boolean(input.draft), mergeable: input.mergeable, state: input.state ?? 'open', merged_at: input.merged_at });
  return gate.allowed ? out('ready') : out('unknown');
}
