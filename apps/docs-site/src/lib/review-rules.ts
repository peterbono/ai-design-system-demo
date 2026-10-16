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

export interface MergeGate {
  allowed: boolean;
  reasons: string[];
}

/** Whether the Merge button is enabled, and why not. Mirrors docs/GOVERNANCE.md. */
export function mergeGate(input: {
  tier: Tier | null;
  ci: CiSummary;
  approvals: ApprovalSummary;
  draft: boolean;
  mergeable?: boolean | null;
  state: string;
}): MergeGate {
  const reasons: string[] = [];
  if (input.state !== 'open') reasons.push('This pull request is not open.');
  if (input.draft) reasons.push('It is a draft. Mark it ready for review on GitHub first.');
  if (input.ci.state === 'fail') reasons.push(`CI fails: ${input.ci.failed.map((f) => f.name).join(', ')}.`);
  if (input.ci.state === 'pending') reasons.push('CI is still running.');
  if (input.approvals.changesRequested.length) reasons.push(`Changes requested by @${input.approvals.changesRequested.join(', @')}.`);
  const tier = input.tier ?? 3;
  if (tier === 3) {
    if (!input.approvals.design) reasons.push('Tier 3 needs a design owner approval.');
    if (!input.approvals.tech) reasons.push('Tier 3 needs a tech owner approval.');
  } else if (!input.approvals.approvers.length) {
    reasons.push(`Tier ${tier} needs one approval.`);
  }
  if (input.mergeable === false) reasons.push('GitHub reports a merge conflict.');
  return { allowed: reasons.length === 0, reasons };
}

/** Changeset files in a PR (`.changeset/*.md`, not the README) with their bump lines. */
export function parseChangeset(text: string): { bumps: { pkg: string; bump: string }[]; summary: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { bumps: [], summary: text.trim() };
  const bumps = [...m[1]!.matchAll(/["']?([@\w/.-]+)["']?\s*:\s*(major|minor|patch)/g)].map((x) => ({ pkg: x[1]!, bump: x[2]! }));
  return { bumps, summary: m[2]!.trim() };
}
