// Studio Changes: the pure rules behind the "In review" list, the pull request opener and the undo panel. No DOM,
// no fetch: shared by scripts/changes and scripts/reviews, unit tested in changes.test.ts.
//
// Color means status, never risk. Four groups, one tone each, everywhere in the Studio:
//   blocked  red     blocked by tests, changes requested, conflict
//   waiting  violet  waiting for an approval
//   ready    green   ready to merge
//   neutral  grey    draft, unknown, checks running or checking, shipped, closed
// What a change needs is plain words, never colored ("Design + tech", lib/review-queue), so a token change that
// is ready reads green, not red.
import { CONFLICT_REASON, mergeGate, REVIEW_STATUS, type ApprovalSummary, type CiSummary, type MergeGate, type MissingApproval, type PullState, type ReviewStatusKind, type Tier } from './review-rules';
import type { TokenReview } from './token-review';
import { ghAction } from './gh-wording';
import { branchCount, VOCAB } from './vocabulary';
import { eligibleReviewers, entriesFor, pendingApprovals, requiredApprovals, soloOwnerSentence, type ApprovalRole, type TeamStates } from '@bridge-ds/core';

export type StatusGroup = 'blocked' | 'waiting' | 'ready' | 'neutral';

/** The DS Badge tones a status can take: one per status group. */
export type StatusTone = 'danger' | 'info' | 'success' | 'neutral';

export const STATUS_GROUP: Record<ReviewStatusKind, StatusGroup> = {
  'ci-failing': 'blocked',
  'changes-requested': 'blocked',
  conflict: 'blocked',
  'needs-design': 'waiting',
  'needs-tech': 'waiting',
  'needs-approval': 'waiting',
  ready: 'ready',
  'ci-running': 'neutral',
  checking: 'neutral',
  draft: 'neutral',
  unknown: 'neutral',
  merged: 'neutral',
  closed: 'neutral',
};

/** DS Badge tone of each group. */
export const GROUP_TONE: Record<StatusGroup, StatusTone> = { blocked: 'danger', waiting: 'info', ready: 'success', neutral: 'neutral' };

export const statusGroup = (kind: ReviewStatusKind | null | undefined): StatusGroup => (kind ? STATUS_GROUP[kind] : 'neutral');
export const statusTone = (kind: ReviewStatusKind | null | undefined): StatusTone => GROUP_TONE[statusGroup(kind)];

/** The neutral risk label. Never colored: color is for status. */
export const tierLabel = (t: Tier | null | undefined) => (t ? `Tier ${t}` : 'Tier not set');

/** The tier filter of the In review list (?tier=1|2|3, linked from Settings Approvals), or null for all. */
export function tierParam(search: string): Tier | null {
  const n = Number(new URLSearchParams(search).get('tier'));
  return n === 1 || n === 2 || n === 3 ? n : null;
}

/** Rows at that tier only. A pull request without a tier label or checkbox is left out of a filtered list. */
export function filterByTier<R extends { tier: Tier | null }>(rows: R[], tier: Tier | null): R[] {
  return tier ? rows.filter((r) => r.tier === tier) : rows;
}

/** Most urgent first: blocked, then waiting for approval, then ready, then the rest. */
const URGENCY: Record<StatusGroup, number> = { blocked: 0, waiting: 1, ready: 2, neutral: 3 };

export interface UrgencyRow {
  number: number;
  kind: ReviewStatusKind | null;
  updated_at?: string;
}

export function urgencyRank(kind: ReviewStatusKind | null | undefined): number {
  // Running checks and unknown statuses may turn out blocked: above drafts, merged and closed ones.
  if (kind === 'ci-running' || kind === 'checking' || kind === 'unknown' || !kind) return URGENCY.neutral;
  if (kind === 'draft' || kind === 'merged' || kind === 'closed') return URGENCY.neutral + 1;
  return URGENCY[STATUS_GROUP[kind]];
}

/** Stable sort by urgency, then most recently updated, then the higher number. */
export function byUrgency<R extends UrgencyRow>(rows: R[]): R[] {
  return [...rows].sort(
    (a, b) => urgencyRank(a.kind) - urgencyRank(b.kind) || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')) || b.number - a.number,
  );
}

export interface OpenerRow extends UrgencyRow {
  title: string;
  /** Who acts now (whoActs) says it is the viewer. Unknown while the status is read, and for a visitor. */
  yourTurn?: boolean;
  /** Only developer tests fail: a developer acts, never the designer (whoActs who "developer"). */
  developer?: boolean;
}

export interface Opener {
  /** "3 changes in review. Your turn on #3: it waits for a design approval." */
  sentence: string;
  /** The one primary action: open the change to act on first. Null when nothing is open or it waits on a developer. */
  action: { label: string; pr: number } | null;
}

const WHY: Partial<Record<ReviewStatusKind, string>> = {
  'ci-failing': 'is blocked by failing checks',
  conflict: `conflicts with ${VOCAB.main}`,
  'changes-requested': 'is blocked: a reviewer requested changes',
  'needs-design': 'waits for a design approval',
  'needs-tech': 'waits for a tech approval',
  'needs-approval': 'waits for an approval',
  ready: 'is ready to merge',
  'ci-running': 'is waiting for its tests',
  checking: 'is still being checked',
  draft: 'is still a draft',
};

/**
 * The In review opener: how many are open, then the change to open first, with "Review #N". The most urgent change
 * where it is the viewer's turn comes first, so a designer is never sent to a change only a developer can move. With
 * none, the most urgent change overall; when that one waits on a developer, the sentence says so and there is no button.
 */
export function openerFor(rows: OpenerRow[]): Opener {
  const n = rows.length;
  if (!n) return { sentence: 'Nothing to review.', action: null };
  const sorted = byUrgency(rows);
  const count = `${branchCount(n)} in review.`;
  const mine = sorted.find((r) => r.yourTurn);
  const first = mine ?? sorted[0]!;
  const action = { label: `Review #${first.number}`, pr: first.number };
  if (!mine && first.developer) return { sentence: `${count} #${first.number} waits on a developer to fix its tests.`, action: null };
  const why = first.kind ? WHY[first.kind] : undefined;
  if (mine) return { sentence: `${count} Your turn on #${first.number}: it ${why ?? 'needs you'}.`, action };
  return { sentence: why ? `${count} #${first.number} ${why}.` : `${count} Open one to see its tests and approvals.`, action };
}

// ---------------------------------------------------------------------------------------------------------------
// Pull request detail

/** "1 approval", "a design and a tech approval": what is still missing, in words. */
export function missingApprovals(missing: MergeGate['missing']): string {
  const design = missing.includes('design approval');
  const tech = missing.includes('tech approval');
  if (design && tech) return 'a design and a tech approval';
  if (design) return 'a design approval';
  if (tech) return 'a tech approval';
  return missing.length ? `${missing.length} approval${missing.length === 1 ? '' : 's'}` : '';
}

const names = (xs: { name: string }[]) => (xs.length <= 2 ? xs.map((x) => x.name).join(' and ') : `${xs.slice(0, 2).map((x) => x.name).join(', ')} and ${xs.length - 2} more`);

export interface DetailState {
  state: 'open' | 'draft' | 'merged' | 'closed';
  ci: CiSummary;
  gate: MergeGate;
  changesRequestedBy: string[];
}

/** One sentence for the pull request opener: what blocks it, then what it needs after that. */
export function detailSentence(s: DetailState): string {
  if (s.state === 'merged') return 'Merged.';
  if (s.state === 'closed') return 'Closed without merging.';
  const needs = missingApprovals(s.gate.missing);
  const after = needs ? ` After that it needs ${needs}.` : '';
  if (s.state === 'draft') return `Draft: request a review first.${after}`;
  if (s.ci.state === 'fail') {
    const many = s.ci.failed.length > 1;
    return `Blocked: the ${names(s.ci.failed)} test${many ? 's fail' : ' fails'}.${after}`;
  }
  if (s.changesRequestedBy.length) return `Blocked: @${s.changesRequestedBy.join(', @')} requested changes.${after}`;
  if (s.gate.reasons.includes(CONFLICT_REASON)) return `Blocked: it conflicts with ${VOCAB.main}.${after}`;
  if (s.ci.state === 'pending') return `Tests are still running.${after}`;
  if (needs) return `Waiting for ${needs}. Tests pass.`;
  if (s.gate.allowed) return 'Ready to merge: tests pass and the approvals are in.';
  return s.ci.state === 'none' ? `No tests reported for this version yet.${after}` : 'Open the tests and the conversation to see what it needs.';
}

export type PrimaryKind = 'open-run' | 'connect' | 'approve' | 'merge' | 'github';

/**
 * The one primary action of the opener. A failing check sends you to its run; without GitHub you connect; with
 * GitHub you approve a green change that waits for approval, or merge one that is ready (write access only).
 */
export function primaryAction(input: {
  state: DetailState['state'];
  ci: CiSummary;
  gate: MergeGate;
  connected: boolean;
  canWrite: boolean;
  /** The viewer wrote this pull request: GitHub refuses self-approval. */
  isAuthor?: boolean;
  /** The site has Sign in with GitHub: the connect label says "Sign in". */
  signIn?: boolean;
}): { kind: PrimaryKind; label: string; url?: string } {
  if (input.state === 'merged' || input.state === 'closed') return { kind: 'github', label: VOCAB.openOnGitHub };
  const failed = input.ci.state === 'fail' ? input.ci.failed.find((f) => f.url) : undefined;
  if (failed) return { kind: 'open-run', label: 'Open failing test', url: failed.url };
  if (!input.connected) return { kind: 'connect', label: ghAction('review', input.signIn ?? false) };
  if (input.gate.allowed && input.canWrite) return { kind: 'merge', label: VOCAB.merge };
  const green = input.ci.state === 'pass' || input.ci.state === 'none';
  if (green && input.gate.missing.length && !input.isAuthor && input.state === 'open') return { kind: 'approve', label: 'Approve' };
  return { kind: 'github', label: VOCAB.openOnGitHub };
}

// ---------------------------------------------------------------------------------------------------------------
// Who acts now: one person or role and one action, for the pull request header, the In review rows and the
// Overview "Waiting for you" block. Built from GitHub data already read (CI, reviews, lifecycle) and the owners in
// bridge.config.json (governance.owners). Never guesses a login: when nobody is named in the config, it names a role.

// Which approvals a branch still needs, and who can give them: one rule with the MCP server and the CLI
// (@bridge-ds/core review-gate).
export { pendingApprovals, requiredApprovals, type ApprovalRole };

const ROLE_OF: Record<MissingApproval, ApprovalRole> = { 'design approval': 'design', 'tech approval': 'tech', approval: 'approval' };

/** What the pull request needs next, before deciding who does it. */
export type Need =
  | { kind: 'merged' }
  | { kind: 'closed' }
  | { kind: 'draft' }
  | { kind: 'exploration' }
  /** `developerOnly`: every failing check is a developer check, so a developer fixes them, not the author. */
  | { kind: 'fix-checks'; failing: number; developerOnly?: boolean; then?: ApprovalRole[] }
  | { kind: 'address-changes'; by: string[] }
  | { kind: 'resolve-conflict' }
  | { kind: 'checks-running'; then: ApprovalRole[] }
  /** GitHub has not said yet whether the change fits the latest library (mergeable null). */
  | { kind: 'checking-merge'; then: ApprovalRole[] }
  | { kind: 'approve'; roles: ApprovalRole[] }
  | { kind: 'ready' }
  | { kind: 'unknown' };

/**
 * The need of an opened pull request, in the order mergeGate blocks: lifecycle, draft, CI, changes, conflict, then
 * approvals. Same order as the list chip (core reviewStatusKind). `mergeable` null: GitHub is still computing
 * whether it fits the latest library, so an approved change does not promise a merge yet; a missing approval still shows.
 */
export function needFromDetail(s: { state: PullState; ci: CiSummary; gate: MergeGate; changesRequestedBy: string[]; exploration?: boolean; mergeable?: boolean | null }): Need {
  if (s.state === 'merged') return { kind: 'merged' };
  if (s.state === 'closed') return { kind: 'closed' };
  if (s.exploration) return { kind: 'exploration' };
  if (s.state === 'draft') return { kind: 'draft' };
  if (s.ci.state === 'fail') return { kind: 'fix-checks', failing: s.ci.failed.length };
  if (s.changesRequestedBy.length) return { kind: 'address-changes', by: s.changesRequestedBy };
  if (s.gate.reasons.includes(CONFLICT_REASON)) return { kind: 'resolve-conflict' };
  const roles = s.gate.missing.map((m) => ROLE_OF[m]);
  if (s.ci.state === 'pending') return { kind: 'checks-running', then: roles };
  // A missing approval is missing whether or not GitHub has worked out the merge yet (core reviewStatusKind).
  if (roles.length) return { kind: 'approve', roles };
  if (s.mergeable === null && s.state === 'open') return { kind: 'checking-merge', then: roles };
  if (s.gate.allowed) return { kind: 'ready' };
  return { kind: 'unknown' };
}

/** The need behind a list status chip (reviewStatus), when only the status is known. */
export function needFromStatus(kind: ReviewStatusKind | null | undefined, extra: { failing?: number; changesRequestedBy?: string[]; developerOnly?: boolean; pending?: ApprovalRole[] } = {}): Need {
  switch (kind) {
    case 'merged':
    case 'closed':
    case 'draft':
    case 'ready':
      return { kind };
    case 'ci-failing':
      return { kind: 'fix-checks', failing: extra.failing ?? 0, ...(extra.developerOnly ? { developerOnly: true } : {}), ...(extra.pending?.length ? { then: extra.pending } : {}) };
    case 'changes-requested':
      return { kind: 'address-changes', by: extra.changesRequestedBy ?? [] };
    case 'conflict':
      return { kind: 'resolve-conflict' };
    case 'ci-running':
      return { kind: 'checks-running', then: [] };
    case 'checking':
      return { kind: 'checking-merge', then: [] };
    case 'needs-design':
      return { kind: 'approve', roles: ['design'] };
    case 'needs-tech':
      return { kind: 'approve', roles: ['tech'] };
    case 'needs-approval':
      return { kind: 'approve', roles: ['approval'] };
    default:
      return { kind: 'unknown' };
  }
}

export interface People {
  /** governance.owners in bridge.config.json, after rights, GitHub teams expanded to their members once read. */
  owners: { design: string[]; tech: string[] };
  /** The same lists as the config names them (people and "@org/team" entries), so sentences name a team as a team. */
  entries?: { design: string[]; tech: string[] };
  /** The ship right as the config names it (people and teams). */
  shipEntries?: string[];
  /** Team states read from GitHub ("@acme/design (4 people)"). */
  teams?: TeamStates;
  /** Login of the pull request author. GitHub refuses self-approval. */
  author: string;
  /** Login of the connected viewer, if any. */
  viewer?: string | null;
  /** Logins whose latest review approves (summarizeApprovals). They cannot cover a second role alone. */
  approvers?: string[];
  /** The viewer can merge (write access). Unknown in lists: owners merge there (docs/GOVERNANCE.md). */
  canMerge?: boolean;
  /** governance.rights ship holders (shipPolicy). Absent: the owners ship. */
  shippers?: string[];
  /** governance.override.allowed. */
  overrideBy?: string[];
  /** mergeGate says the viewer may merge past the missing approvals. */
  overridable?: boolean;
  /** The only owner whose approval covers design and tech (governance.soloOwnerCanApproveBoth, core soloOwnerOf). */
  soloOwner?: string | null;
}

export type WhoAction =
  | 'approve-design'
  | 'approve-tech'
  | 'approve'
  | 'fix-checks'
  | 'address-changes'
  | 'resolve-conflict'
  | 'mark-ready'
  | 'promote'
  | 'merge'
  | 'override'
  | 'wait'
  | 'none';

export interface WhoActs {
  /** Who acts: the viewer, the author, an owner role, any reviewer, or nobody (finished, or checks running). */
  who: 'you' | 'author' | 'design' | 'tech' | 'reviewer' | 'owner' | 'developer' | 'nobody';
  /** Logins named in the sentence, from GitHub or the config. Empty when only a role is known. */
  logins: string[];
  yourTurn: boolean;
  action: WhoAction;
  /** "Waiting for the design owner (@peterbono) to approve." */
  sentence: string;
  /** Row form: "Design owner to approve", "Your turn: approve design". Null when it adds nothing to the status. */
  short: string | null;
}

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && norm(a) === norm(b));
const uniq = (xs: string[]) => xs.filter((x, i) => xs.findIndex((y) => norm(y) === norm(x)) === i);
const or = (xs: string[]) => (xs.length <= 2 ? xs.join(' or ') : `${xs.slice(0, 2).join(', ')} or ${xs.length - 2} more`);
const at = (xs: string[]) => or(xs.map((x) => `@${x.replace(/^@/, '')}`));
const checks = (n: number) => (n === 1 ? 'the failing check' : n > 1 ? `${n} failing checks` : 'the failing checks');

/** Owners listed for a role in the config (both lists for a plain approval), before removing anyone. */
function listedFor(role: ApprovalRole, owners: People['owners']): string[] {
  return eligibleReviewers(role, { owners, author: '' }).listed;
}

/**
 * Who can still give this approval (core eligibleReviewers): the listed owners minus the author and anyone who
 * already approved. `open` means the config lists nobody for the role, so any reviewer other than the author counts.
 */
export function eligibleFor(role: ApprovalRole, p: People): { open: boolean; logins: string[]; listed: string[] } {
  return eligibleReviewers(role, { owners: p.owners, author: p.author, approvers: p.approvers });
}

/** The viewer is the only owner and the team opted in: one approval covers the design and the tech parts still missing. */
function soloCovers(roles: readonly ApprovalRole[], p: People): boolean {
  return Boolean(p.soloOwner && same(p.viewer, p.soloOwner) && roles.includes('design') && roles.includes('tech'));
}

/** Whether the viewer can give this approval now. */
export function viewerCanApprove(role: ApprovalRole, p: People): boolean {
  if (!p.viewer || same(p.viewer, p.author) || (p.approvers ?? []).some((a) => same(a, p.viewer))) return false;
  const e = eligibleFor(role, p);
  return e.open || e.logins.some((l) => same(l, p.viewer));
}

const ROLE_NAME: Record<ApprovalRole, string> = { design: 'design owner', tech: 'tech owner', approval: 'reviewer' };
const APPROVE_ACTION: Record<ApprovalRole, WhoAction> = { design: 'approve-design', tech: 'approve-tech', approval: 'approve' };
const YOUR_APPROVAL: Record<ApprovalRole, string> = { design: 'approve the design', tech: 'approve the tech side', approval: 'approve this change' };
const SHORT_APPROVAL: Record<ApprovalRole, string> = { design: 'Design owner to approve', tech: 'Tech owner to approve', approval: 'Reviewer to approve' };
const YOUR_SHORT: Record<ApprovalRole, string> = { design: 'Your turn: approve design', tech: 'Your turn: approve tech', approval: 'Your turn: approve' };

/**
 * Who can still act, as the sentence names them: people as "@login", a team as "@acme/design (4 people)" when one
 * of its members can (or its members are unknown). Without config entries, the logins as they are.
 */
export function namesFor(role: ApprovalRole, logins: string[], p: Pick<People, 'entries' | 'teams'>): string {
  if (!p.entries) return at(logins);
  const labels = entriesFor(listedFor(role, p.entries), logins, p.teams);
  return labels.length ? or(labels) : at(logins);
}

/** "the design owner (@a)", "a reviewer", "the design owner (@acme/design (4 people))". */
function namedRole(role: ApprovalRole, logins: string[], p: People): string {
  if (role === 'approval') return logins.length ? `a reviewer (${namesFor(role, logins, p)})` : 'a reviewer';
  return logins.length ? `the ${ROLE_NAME[role]} (${namesFor(role, logins, p)})` : `a ${ROLE_NAME[role]}`;
}

/**
 * Who must act now on a pull request, and what they do, in one sentence. The viewer reads "Your turn: ..." when it
 * is them. Same rules for the detail header (needFromDetail), the list rows and the Overview (needFromStatus).
 */
export function whoActs(need: Need, p: People): WhoActs {
  const author = p.author;
  const isAuthor = same(p.viewer, author);
  const authorTurn = (action: WhoAction, yours: string, theirs: string, shortTheirs: string, shortYours: string): WhoActs =>
    isAuthor
      ? { who: 'you', logins: [author], yourTurn: true, action, sentence: `Your turn: ${yours}.`, short: shortYours }
      : { who: 'author', logins: [author], yourTurn: false, action, sentence: `Waiting for @${author} to ${theirs}.`, short: shortTheirs };

  switch (need.kind) {
    case 'merged':
      return { who: 'nobody', logins: [], yourTurn: false, action: 'none', sentence: 'Merged.', short: null };
    case 'closed':
      return { who: 'nobody', logins: [], yourTurn: false, action: 'none', sentence: 'Closed without merging.', short: null };
    case 'unknown':
      return { who: 'nobody', logins: [], yourTurn: false, action: 'none', sentence: 'Open the checks and the conversation to see what it needs.', short: null };
    case 'draft':
      return authorTurn('mark-ready', 'request a review of this draft', 'request a review of this draft', 'Author to finish the draft', 'Your turn: finish the draft');
    case 'exploration':
      return authorTurn('promote', 'request a review of this exploration, or close it', 'request a review of this exploration', 'Author to request a review', 'Your turn: request a review');
    case 'fix-checks':
      // Developer tests failing on a design change are a developer's to fix, whoever made it (the detail says the same:
      // lib/check-explain failingSentence). A failing design rule, or failures not known yet, stay with the author.
      // An approval the viewer can give does not wait for the developer's fix: both go on in parallel, so the viewer's
      // turn comes first and the failing tests stay in the sentence.
      if (need.developerOnly) {
        const mine = need.then?.find((r) => viewerCanApprove(r, p));
        if (mine) return { who: 'you', logins: p.viewer ? [p.viewer] : [], yourTurn: true, action: APPROVE_ACTION[mine], sentence: `Your turn: ${YOUR_APPROVAL[mine]}. A developer fixes ${checks(need.failing)} meanwhile.`, short: YOUR_SHORT[mine] };
      }
      if (need.developerOnly) return { who: 'developer', logins: [], yourTurn: false, action: 'fix-checks', sentence: `Waiting for a developer to fix ${checks(need.failing)}.`, short: 'Blocked by tests' };
      return authorTurn('fix-checks', `fix ${checks(need.failing)}`, `fix ${checks(need.failing)}`, 'Blocked by tests', 'Your turn: fix tests');
    case 'address-changes': {
      const by = need.by.length ? ` @${need.by.join(', @')} requested` : ' a reviewer requested';
      return authorTurn('address-changes', `address the changes${by}`, `address the changes${by}`, 'Author to address changes', 'Your turn: address changes');
    }
    case 'resolve-conflict':
      return authorTurn('resolve-conflict', `resolve a conflict with ${VOCAB.main}`, `resolve a conflict with ${VOCAB.main}`, 'Author to resolve a conflict', 'Your turn: resolve a conflict');
    case 'checks-running': {
      const next = need.then[0];
      const then = next ? ` Then ${namedRole(next, eligibleFor(next, p).logins, p)} approves.` : ' Then it is ready to merge.';
      return { who: 'nobody', logins: [], yourTurn: false, action: 'wait', sentence: `Tests are still running.${then}`, short: 'Tests running' };
    }
    case 'checking-merge': {
      const next = need.then[0];
      const then = next ? ` Then ${namedRole(next, eligibleFor(next, p).logins, p)} approves.` : '';
      return { who: 'nobody', logins: [], yourTurn: false, action: 'wait', sentence: `Checking that it fits ${VOCAB.main}.${then}`, short: 'Checking' };
    }
    case 'approve': {
      // The viewer first: the first role they can give.
      const mine = need.roles.find((r) => viewerCanApprove(r, p));
      if (mine && soloCovers(need.roles, p)) return { who: 'you', logins: [p.viewer!], yourTurn: true, action: 'approve', sentence: `Your turn: approve. ${soloOwnerSentence(p.viewer!, true)}`, short: YOUR_SHORT.approval };
      if (mine) return { who: 'you', logins: p.viewer ? [p.viewer] : [], yourTurn: true, action: APPROVE_ACTION[mine], sentence: `Your turn: ${YOUR_APPROVAL[mine]}.`, short: YOUR_SHORT[mine] };
      const role = need.roles[0]!;
      const e = eligibleFor(role, p);
      // Every listed owner wrote the change or already approved: only the owner override can merge it.
      if (!e.open && e.logins.length === 0) {
        const by = (p.overrideBy ?? []).map((x) => x.replace(/^@/, ''));
        if (p.overridable) return { who: 'you', logins: p.viewer ? [p.viewer] : [], yourTurn: true, action: 'override', sentence: `Your turn: no other ${ROLE_NAME[role]} can approve, so merge it with the owner override, under More.`, short: 'Your turn: owner override' };
        const via = by.length ? ` @${by.join(' or @')} can merge it with the owner override.` : ' Add an owner in Settings.';
        return { who: 'owner', logins: by, yourTurn: false, action: 'override', sentence: `No other ${ROLE_NAME[role]} can approve.${via}`, short: 'Owner override needed' };
      }
      const both = need.roles.length > 1 && need.roles.includes('design') && need.roles.includes('tech');
      const tech = both ? eligibleFor('tech', p) : null;
      const sameOwners = tech && tech.logins.length === e.logins.length && tech.logins.every((l) => e.logins.some((x) => same(x, l)));
      const sentence =
        both && sameOwners && e.logins.length
          ? `Waiting for the design and tech owners (${namesFor('approval', e.logins, p)}) to approve.`
          : both && tech && (tech.logins.length || tech.open)
            ? `Waiting for ${namedRole('design', e.logins, p)} and ${namedRole('tech', tech.logins, p)} to approve.`
            : `Waiting for ${namedRole(role, e.logins, p)} to approve.`;
      return { who: role === 'approval' ? 'reviewer' : role, logins: e.logins, yourTurn: false, action: APPROVE_ACTION[role], sentence, short: SHORT_APPROVAL[role] };
    }
    case 'ready': {
      const owners = (p.shippers?.length ? uniq(p.shippers) : uniq([...p.owners.design, ...p.owners.tech])).map((x) => x.replace(/^@/, ''));
      const mine = p.canMerge ?? owners.some((o) => same(o, p.viewer));
      if (p.viewer && mine) return { who: 'you', logins: [p.viewer], yourTurn: true, action: 'merge', sentence: 'Your turn: ready to merge.', short: 'Your turn: merge it' };
      const named = p.teams && (p.shipEntries ?? p.entries) ? entriesFor(p.shipEntries ?? [...p.entries!.design, ...p.entries!.tech], owners, p.teams) : [];
      const who = named.length ? or(named) : owners.length ? at(owners) : 'an owner';
      return { who: 'owner', logins: owners, yourTurn: false, action: 'merge', sentence: `Ready to merge: ${who} can merge it.`, short: 'Ready to merge' };
    }
  }
}

/**
 * The status pill of an open branch, the same on every surface: the Branches list, the branch page header and the
 * home cards. The kind comes from core reviewStatusKind, the words from who acts now (whoActs short: "Design owner to
 * approve", "Owner override needed"), else the status itself ("Needs design approval"). Tone follows the kind.
 */
export function statusPill(kind: ReviewStatusKind, who: Pick<WhoActs, 'short'> | null | undefined): { label: string; tone: StatusTone } {
  return { label: who?.short ?? REVIEW_STATUS[kind].label, tone: statusTone(kind) };
}

export interface ApprovalRow {
  role: ApprovalRole;
  /** "Design", "Tech", or "Approval" when the tier needs one approval of anyone. */
  label: string;
  state: 'approved' | 'changes' | 'waiting';
  /** "Approved by @a", "Changes requested by @b", "Waiting for @c". */
  text: string;
  /** The viewer holds this role and has not approved: the row carries the action. */
  canAct: boolean;
  /** "Approve design". */
  actionLabel: string;
}

const ROW_LABEL: Record<ApprovalRole, string> = { design: 'Design', tech: 'Tech', approval: 'Approval' };
const ROW_ACTION: Record<ApprovalRole, string> = { design: 'Approve design', tech: 'Approve tech', approval: 'Approve' };

/**
 * The approval checklist of a pull request, like GitHub's reviewers box or a Figma review: one row per approval the
 * tier needs (requiredApprovals), each with who approved, who requested changes, or who it waits for. Only the first
 * row the viewer can give carries the action (one review covers one role).
 */
export function approvalRows(input: { tier: Tier | null; approvals: ApprovalSummary; people: People; open: boolean }): ApprovalRow[] {
  const { approvals: a, people: p } = input;
  const covered: Record<ApprovalRole, boolean> = { design: a.design, tech: a.tech, approval: a.approvers.length > 0 };
  // The only owner covers both parts with one review: the first row carries "Approve", the other says so.
  const solo = input.open && soloCovers((['design', 'tech'] as const).filter((r) => !covered[r]), { ...p, approvers: a.approvers }) && viewerCanApprove('design', { ...p, approvers: a.approvers });
  let acted = false;
  return requiredApprovals(input.tier).map((role) => {
    const listed = listedFor(role, p.owners);
    // A plain approval counts from anyone (mergeGate); a design or tech approval only from that role's owners.
    const inRole = (l: string) => role === 'approval' || listed.length === 0 || listed.some((x) => same(x, l));
    const by = a.approvers.filter(inRole);
    const asked = a.changesRequested.filter(inRole);
    const canAct = input.open && !covered[role] && !acted && viewerCanApprove(role, { ...p, approvers: a.approvers });
    if (canAct) acted = true;
    const e = eligibleFor(role, { ...p, approvers: a.approvers });
    const base = { role, label: ROW_LABEL[role], canAct, actionLabel: solo ? ROW_ACTION.approval : ROW_ACTION[role] };
    if (covered[role]) return { ...base, state: 'approved' as const, text: by.length ? `Approved by @${by.join(', @')}` : 'Approved' };
    if (asked.length) return { ...base, state: 'changes' as const, text: `Changes requested by @${asked.join(', @')}` };
    const text = canAct
      ? 'Waiting for you'
      : solo && role !== 'approval'
        ? 'Covered by your approval'
      : e.logins.length
        ? `Waiting for ${namesFor(role, e.logins, p)}`
        : e.open
          ? 'Waiting for a reviewer'
          : `Waiting: no other ${ROLE_NAME[role]} can approve`;
    return { ...base, state: 'waiting' as const, text };
  });
}

/** Package names renamed since a changeset was written (the scope moved from @demo-ds and @bridge to @bridge-ds). */
export const currentPackageName = (pkg: string) => pkg.replace(/^@(?:demo-ds|bridge)\//, '@bridge-ds/');

// ---------------------------------------------------------------------------------------------------------------
// Cached list: the last open pull requests and their statuses, so a rate-limited visitor still sees them.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CachedPull {
  number: number;
  title: string;
  html_url?: string;
  updated_at: string;
  tier: Tier | null;
  kind: ReviewStatusKind | null;
  head: { ref: string; sha: string };
  user: { login: string };
  draft?: boolean;
  /** Claude made it (lib/work-nature agentMade), kept so a cached list still shows Claude's identity. */
  agent?: boolean;
}

export interface ListSnapshot {
  at: string;
  pulls: CachedPull[];
}

export const snapshotKey = (repo: string) => `bridge.changes.list:${repo}`;
/** Read by the nav count before the list loads. Same shape as before this page existed. */
export const OPEN_COUNT_KEY = 'bridge.reviews.open';

export function writeSnapshot(storage: StorageLike | null, repo: string, pulls: CachedPull[], now: Date): void {
  if (!storage) return;
  try {
    storage.setItem(snapshotKey(repo), JSON.stringify({ at: now.toISOString(), pulls } satisfies ListSnapshot));
    storage.setItem(OPEN_COUNT_KEY, JSON.stringify({ n: pulls.length, at: now.toISOString() }));
  } catch {
    /* quota or private mode: no fallback next time, nothing breaks now */
  }
}

export function readSnapshot(storage: StorageLike | null, repo: string): ListSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(snapshotKey(repo));
    const s = raw ? (JSON.parse(raw) as ListSnapshot) : null;
    return s && Array.isArray(s.pulls) && typeof s.at === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** The open count the nav shows when GitHub cannot be read: the last one this browser saw. */
export function cachedOpenCount(storage: StorageLike | null): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(OPEN_COUNT_KEY);
    const n = raw ? (JSON.parse(raw) as { n?: unknown }).n : null;
    return typeof n === 'number' && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export type ListSource<P> = { kind: 'live'; pulls: P[] } | { kind: 'stale'; pulls: P[]; at: string } | { kind: 'cached'; pulls: CachedPull[]; at: string } | { kind: 'unavailable' };

/**
 * What the list shows: live data when GitHub answered; else the last snapshot, labelled with its time; else an
 * honest "unavailable". A stale answer from the request cache counts as cached, with the time it was saved.
 */
export function listSource<P>(live: { pulls: P[]; staleAt?: string | null } | null, snapshot: ListSnapshot | null): ListSource<P> {
  if (live && !live.staleAt) return { kind: 'live', pulls: live.pulls };
  if (live && live.staleAt) return { kind: 'stale', pulls: live.pulls, at: live.staleAt };
  if (snapshot) return { kind: 'cached', pulls: snapshot.pulls, at: snapshot.at };
  return { kind: 'unavailable' };
}

/** "as of 14:05" today, "as of Oct 16, 14:05" before. */
export function asOf(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'as of an earlier visit';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `as of ${time}` : `as of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Undo panel

const MODE_WORD: Record<string, string> = { light: 'Light', dark: 'Dark' };
const modeWord = (m: string) => MODE_WORD[m] ?? (m ? m.charAt(0).toUpperCase() + m.slice(1) : '');

/** "Restores color.text.muted to {palette.neutral.700} in Light. 10 contrast pairs improve, none fail." */
export function undoSentence(review: Pick<TokenReview, 'changes' | 'contrast'>): string {
  const c = review.changes;
  let first: string;
  if (!c.length) first = 'Restores nothing: main already has these values.';
  else if (c.length === 1) {
    const x = c[0]!;
    const to = x.after ? (x.after.alias ? `{${x.after.alias}}` : (x.after.css ?? 'its old value')) : 'nothing';
    first = x.kind === 'removed' ? `Removes ${x.path}${x.context ? ` in ${modeWord(x.context)}` : ''}.` : `Restores ${x.path} to ${to}${x.context ? ` in ${modeWord(x.context)}` : ''}.`;
  } else first = `Restores ${c.length} token values.`;
  const up = review.contrast.filter((p) => p.after > p.before).length;
  const down = review.contrast.filter((p) => p.after < p.before).length;
  const fail = review.contrast.filter((p) => p.after < p.min).length;
  if (!review.contrast.length) return `${first} No checked contrast pair moves.`;
  const pairs = (n: number) => `${n} contrast pair${n === 1 ? '' : 's'}`;
  const move = up && !down ? `${pairs(up)} ${up === 1 ? 'improves' : 'improve'}` : down && !up ? `${pairs(down)} ${down === 1 ? 'gets' : 'get'} lower` : `${pairs(review.contrast.length)} move`;
  return `${first} ${move}, ${fail ? `${fail} ${fail === 1 ? 'fails' : 'fail'}` : 'none fail'}.`;
}
