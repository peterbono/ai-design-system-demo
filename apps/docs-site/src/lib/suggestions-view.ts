// Suggestions in Studio, the pure side: what a DS lead reads on a suggestion (a change filed as a GitHub issue by
// someone who cannot write code, applied later by a developer), whether it waits on them, what they may do on it and,
// when they may not, why. Scripts read GitHub (scripts/suggestions.ts); components/ds/studio/SuggestionReview paints
// the view. The core owns the model (packages/core/src/suggestions.ts, suggestion-review.ts): this file only turns its
// answers into Studio words, with no developer jargon (lib/vocabulary DEV_WORDS). Tested in suggestions-view.test.ts.
import {
  pendingApprovals,
  soloOwnerSentence,
  SUGGESTION_STATUS_LABEL,
  type ApprovalRole,
  type Owners,
  type SuggestionApplyOp,
  type SuggestionApprovals,
  type SuggestionKind,
  type SuggestionPayloadV1,
  type SuggestionStatus,
} from '@bridge-ds/core';
import type { ThumbSpec, ThumbToken } from './branch-thumb';
import { branchThumb } from './branch-thumb';
import type { ShownValue } from './token-review';
import { waitingLabel, type BranchCard, type NeedRow, type Person } from './home-model';
import { studioHref } from './team-path';

/** Where a suggestion opens in Studio: Branches, in place (pages/studio/changes.astro). */
export const suggestionHref = (n: number) => studioHref(`changes/?suggestion=${n}`);

/** The queue key of a suggestion row (lib/queue-nav keyFromSearch reads it back from ?item=). */
export const suggestionKey = (n: number) => `suggestion-${n}`;

/** The suggestion number of a queue key, or null for any other row. */
export function suggestionOfKey(key: string | null | undefined): number | null {
  const m = key ? /^suggestion-(\d+)$/.exec(key) : null;
  return m ? Number(m[1]) : null;
}

/**
 * The words of this screen that are not in lib/gh-wording.ts (owned by the sending side): kept here until they move
 * there, so the review and the send say the same thing.
 */
export const SUGGESTION_WORDS = {
  /** The row line on Home and in the queue. */
  asks: (name: string) => `${name} suggests a change`,
  /** The row line for a developer once it is approved. */
  toApply: (name: string) => `Approved. ${name} waits for you to apply it`,
  approve: 'Approve',
  requestChanges: 'Suggest changes',
  decline: 'Decline',
  /** After an approval that completes the review. */
  ready: 'Approved, ready to apply',
  /** Once approved: who acts next. The commands sit under For developers, for developers only. */
  applyHint: 'A developer applies it next. It reaches the library once their change merges, without a second review.',
} as const;

const KIND_LABEL: Record<SuggestionKind, string> = {
  'token-change': 'Token change',
  docs: 'Docs change',
  'component-spec': 'Component change',
  brand: 'New brand',
  revert: 'Undo of a change',
  config: 'Settings change',
};

/** "Token change", "Docs change"... Never "issue". */
export const kindLabel = (k: SuggestionKind | undefined) => (k ? KIND_LABEL[k] : 'Suggestion');

export type SuggestionTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONE: Record<SuggestionStatus, SuggestionTone> = {
  'needs-review': 'info',
  'changes-requested': 'warning',
  approved: 'success',
  applying: 'info',
  applied: 'success',
  declined: 'neutral',
  outdated: 'warning',
};

/** The status badge: the core label ("Needs review", "Approved, ready to apply") and a tone. */
export function statusBadge(status: SuggestionStatus): { label: string; tone: SuggestionTone } {
  return { label: SUGGESTION_STATUS_LABEL[status], tone: STATUS_TONE[status] };
}

// ---------------------------------------------------------------------------------------------------------------
// The queue: a suggestion as a row next to the branches, counted in the same buckets (lib/review-queue)

/** The queue state of a suggestion (lib/review-queue QueueKind): which approval it waits for, or where it stands. */
export function suggestionQueueKind(status: SuggestionStatus, missing: readonly ApprovalRole[] = []): 'needs-design' | 'needs-tech' | 'needs-approval' | 'changes-requested' | 'conflict' | 'ready-to-apply' | 'applying' | null {
  switch (status) {
    case 'needs-review':
      if (missing.includes('design')) return 'needs-design';
      if (missing.includes('tech')) return 'needs-tech';
      return 'needs-approval';
    case 'changes-requested':
      return 'changes-requested';
    case 'outdated':
      return 'conflict';
    case 'approved':
      return 'ready-to-apply';
    case 'applying':
      return 'applying';
    default:
      return null;
  }
}

const norm = (l: string) => l.trim().replace(/^@/, '').toLowerCase();
const same = (a?: string | null, b?: string | null) => Boolean(a && b && norm(a) === norm(b));

/** The roles the viewer approves as: design, tech, and "approval" (tier 1) when they are in either list. */
export function viewerRoles(viewer: string | null | undefined, owners: Owners): ApprovalRole[] {
  if (!viewer) return [];
  const roles: ApprovalRole[] = [];
  if (owners.design.some((l) => same(l, viewer))) roles.push('design');
  if (owners.tech.some((l) => same(l, viewer))) roles.push('tech');
  if (roles.length) roles.push('approval');
  return roles;
}

/** Nobody is listed in either role: then repository collaborators approve (the core rule, suggestion-review.ts). */
export const noOwners = (owners: Owners) => owners.design.length === 0 && owners.tech.length === 0;

/** The roles still missing on the current version, from the counted approvals (empty while not read). */
export function missingRoles(tier: 1 | 2 | 3, approvals: SuggestionApprovals | undefined): ApprovalRole[] {
  return approvals ? pendingApprovals(tier, approvals) : [];
}

/**
 * Whether a suggestion waits on the viewer: open for review, a role they hold is missing, and they did not write it;
 * or approved and the viewer is a developer (a tech owner), who applies it.
 */
export function waitsOnViewer(x: {
  status: SuggestionStatus;
  missing: readonly ApprovalRole[];
  viewer: string | null;
  author: string;
  owners: Owners;
  /** No owner configured: the viewer can push to the repository. */
  collaborator?: boolean;
  /** The viewer already reviewed this version (approved or asked for changes). */
  reviewed?: boolean;
}): boolean {
  if (!x.viewer) return false;
  const roles = noOwners(x.owners) ? (x.collaborator ? (['design', 'tech', 'approval'] as ApprovalRole[]) : []) : viewerRoles(x.viewer, x.owners);
  // Approved: it waits on a developer (a tech owner) to apply it, never on a designer.
  if (x.status === 'approved') return roles.includes('tech');
  if (x.status !== 'needs-review' || same(x.viewer, x.author) || x.reviewed) return false;
  return x.missing.length === 0 ? roles.length > 0 : x.missing.some((m) => roles.includes(m));
}

/** One Home and queue row for a suggestion that waits on the viewer. */
export function suggestionNeed(s: { number: number; title: string; createdAt: string; thumb?: ThumbSpec | null; apply?: boolean }, author: Person, now: number): NeedRow {
  return {
    key: suggestionKey(s.number),
    kind: 'review',
    title: s.title,
    href: suggestionHref(s.number),
    person: author,
    line: s.apply ? SUGGESTION_WORDS.toApply(author.name) : SUGGESTION_WORDS.asks(author.name),
    ...(s.apply ? { action: 'Apply' } : {}),
    since: s.createdAt,
    waitsOnYou: true,
    pill: { label: waitingLabel(s.createdAt, now), tone: 'warning' },
    thumb: s.thumb ?? { kind: 'icon', icon: 'token' },
  };
}

/** "Tokens: raise color.action.primary.bg contrast" reads "Raise color.action.primary.bg contrast" in Studio. */
export function shortTitle(title: string): string {
  const t = title.replace(/^[A-Z][\w .-]{0,40}?:\s+/, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title;
}

// ---------------------------------------------------------------------------------------------------------------
// What changes: token rows from the payload (before, after, the mode the file is)

export interface SuggestionTokenRow {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before: ShownValue | null;
  after: ShownValue | null;
  contexts: string[];
}

const ALIAS = /^\{([^}]+)\}$/;

function hexOf(css: string | undefined, raw: unknown): string | null {
  if (raw && typeof raw === 'object' && typeof (raw as { hex?: unknown }).hex === 'string') return ((raw as { hex: string }).hex).toLowerCase();
  const m = css ? /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(css.trim()) : null;
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

function shownOf(raw: unknown, css: string | undefined): ShownValue | null {
  if (raw === undefined && css === undefined) return null;
  const alias = typeof raw === 'string' ? (ALIAS.exec(raw)?.[1] ?? null) : null;
  const literal = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : raw && typeof raw === 'object' && 'hex' in raw ? String((raw as { hex: unknown }).hex) : null;
  return { alias, css: css ?? (alias ? null : literal), hex: hexOf(css ?? literal ?? undefined, raw) };
}

/** The mode a token file is ("light", "dark"), from its name; empty for files without one. */
export function modeOfFile(file: string): string {
  const m = /(?:^|[/._-])(light|dark)(?=[/._-]|$)/i.exec(file);
  return m ? m[1]!.toLowerCase() : '';
}

const tierOfFile = (file: string) => (/semantic/.test(file) ? 'semantic' : /component/.test(file) ? 'component' : 'primitive');

/** One row per token and value: the same token changed the same way in two modes reads once, with both modes. */
export function tokenRows(p: Pick<SuggestionPayloadV1, 'tokens'>): SuggestionTokenRow[] {
  const rows: SuggestionTokenRow[] = [];
  for (const c of p.tokens?.changes ?? []) {
    const kind = c.kind === 'renamed' ? 'changed' : c.kind;
    const path = c.kind === 'renamed' && c.from ? `${c.from} → ${c.path}` : c.path;
    const before = kind === 'added' ? null : shownOf(c.before, c.beforeCss);
    const after = kind === 'removed' ? null : shownOf(c.after, c.afterCss);
    const mode = modeOfFile(c.file);
    const twin = rows.find((r) => r.path === path && JSON.stringify([r.before, r.after]) === JSON.stringify([before, after]));
    if (twin) {
      if (mode && !twin.contexts.includes(mode)) twin.contexts.push(mode);
      continue;
    }
    rows.push({ path, kind, before, after, contexts: mode ? [mode] : [] });
  }
  return rows;
}

/** The Home and queue thumbnail: the main token before and after, as for a branch (lib/branch-thumb). */
export function suggestionThumb(p: Pick<SuggestionPayloadV1, 'kind' | 'tokens'>, theme: 'light' | 'dark' = 'light'): ThumbSpec {
  if (p.kind === 'docs') return { kind: 'text' };
  if (p.kind === 'component-spec') return { kind: 'icon', icon: 'component' };
  const tokens: ThumbToken[] = (p.tokens?.changes ?? []).map((c) => ({
    path: c.path,
    kind: c.kind === 'renamed' ? 'changed' : c.kind,
    tier: tierOfFile(c.file),
    context: modeOfFile(c.file),
    before: c.kind === 'added' ? null : { css: c.beforeCss ?? null, hex: hexOf(c.beforeCss, c.before) },
    after: c.kind === 'removed' ? null : { css: c.afterCss ?? null, hex: hexOf(c.afterCss, c.after) },
  }));
  return branchThumb({ tokens, theme });
}

// ---------------------------------------------------------------------------------------------------------------
// Proof: the checks, at a glance (chips), with today's re-run when it is read

export interface ProofChip {
  key: 'checks' | 'contrast' | 'usage';
  label: string;
  tone: 'success' | 'danger' | 'warning' | 'neutral';
  /** The longer sentence, for the details and the tooltip. */
  detail: string;
}

/** What the re-run on today's main found (scripts/suggestions.ts, planSuggestionApply). */
export interface TodayChecks {
  newErrors: number;
  /** Contrast pairs that pass today and would fail with the suggestion. */
  newFailures: { pair: string; mode?: string | undefined }[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const listModes = (modes: string[]) => (modes.length === 2 && modes.includes('light') && modes.includes('dark') ? 'light and dark' : modes.join(', '));

/**
 * The three proofs of the decide card: design system checks, contrast (in the modes it was checked in) and where the
 * changed tokens are used. Today's re-run wins over the checks recorded when it was suggested.
 */
export function proofChips(p: Pick<SuggestionPayloadV1, 'checks' | 'kind'>, today?: TodayChecks | null): ProofChip[] {
  const errors = today ? today.newErrors : p.checks.newErrors;
  const when = today ? "on today's main" : 'when it was suggested';
  const chips: ProofChip[] = [
    errors
      ? { key: 'checks', label: `${errors} design system ${errors === 1 ? 'error' : 'errors'}`, tone: 'danger', detail: `The token checks found ${errors} new ${errors === 1 ? 'error' : 'errors'} ${when}.` }
      : { key: 'checks', label: 'Design system checks', tone: 'success', detail: `The token checks pass ${when}.` },
  ];
  if (p.kind === 'token-change' || p.kind === 'brand' || p.kind === 'revert' || p.checks.contrast.length) {
    const failing = today ? today.newFailures.map((f) => f.pair) : p.checks.contrast.filter((c) => !c.pass).map((c) => c.pair);
    // A mode is a theme ("light"), or a combo key ("brand=bridge,theme=light,density=comfortable"): its theme reads.
    const modes = [...new Set(p.checks.contrast.map((c) => c.mode).filter((m): m is string => Boolean(m)).map((m) => /(?:^|,)theme=([^,]+)/.exec(m)?.[1] ?? m))].sort();
    if (failing.length) chips.push({ key: 'contrast', label: `${failing.length} contrast ${failing.length === 1 ? 'pair fails' : 'pairs fail'}`, tone: 'danger', detail: `Below the minimum ${when}: ${failing.slice(0, 3).join(', ')}${failing.length > 3 ? ` and ${failing.length - 3} more` : ''}.` });
    else if (p.checks.contrast.length) chips.push({ key: 'contrast', label: modes.length ? `Contrast ${listModes(modes)}` : 'Contrast', tone: 'success', detail: `${p.checks.contrast.length} contrast ${p.checks.contrast.length === 1 ? 'pair moves and passes' : 'pairs move and pass'} ${when}.` });
    else chips.push({ key: 'contrast', label: 'No contrast pair moves', tone: 'neutral', detail: 'None of the text and background pairs the library checks uses these tokens.' });
  }
  const n = p.checks.impact;
  if (p.kind === 'token-change' || n > 0) chips.push({ key: 'usage', label: n ? `Used in ${n} ${n === 1 ? 'place' : 'places'}` : 'Not used yet', tone: 'neutral', detail: n ? `${cap(String(n))} tokens and components resolve through what changes.` : 'Nothing in the library resolves through these tokens yet.' });
  return chips;
}

// ---------------------------------------------------------------------------------------------------------------
// Stale: approved for an older version, or main moved under it

export interface StaleView {
  tone: 'warning' | 'danger' | 'success';
  title: string;
  text: string;
}

/**
 * The lines above the decision, at most two: approvals given on an older version of the suggestion (they no longer
 * count, the core binds them to the payload sha), and what main did since it was suggested (from the dry run).
 */
export function staleLines(x: {
  stale: readonly string[];
  names?: Record<string, string>;
  /** The default branch moved since the suggestion was computed. */
  mainMoved?: boolean;
  /** The dry run against today's main: its conflicting changes (empty when it still applies). Undefined: not run. */
  conflicts?: Pick<SuggestionApplyOp, 'path' | 'detail' | 'now'>[] | undefined;
}): StaleView[] {
  const out: StaleView[] = [];
  const who = x.stale.map((l) => x.names?.[l.toLowerCase()] ?? `@${l}`);
  if (who.length) {
    const list = who.length <= 2 ? who.join(' and ') : `${who[0]} and ${who.length - 1} others`;
    out.push({
      tone: 'warning',
      title: 'Approved for an older version',
      text: `${list} approved it before it changed. That approval no longer counts: the new version needs ${who.length === 1 ? 'a new look' : 'new looks'}.`,
    });
  }
  if (x.conflicts?.length) {
    const first = x.conflicts[0]!;
    out.push({ tone: 'danger', title: 'Main changed since it was suggested', text: `${first.detail}${x.conflicts.length > 1 ? ` And ${x.conflicts.length - 1} more.` : ''} Ask the author to send it again on today's main.` });
  } else if (x.mainMoved && x.conflicts) {
    out.push({ tone: 'success', title: 'Still applies cleanly', text: 'Main changed since it was suggested, and every change still applies.' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Who decides: the gate on the buttons, and the sentence for everyone else

export interface SuggestionGate {
  canApprove: boolean;
  canRequestChanges: boolean;
  canDecline: boolean;
  /** The role the viewer's approval counts for. */
  role: ApprovalRole | null;
  /**
   * The missing roles the viewer's approval fills: one role, since one person who holds design and tech never covers
   * both alone (core summarizeApprovals), except the only owner when governance.soloOwnerCanApproveBoth is on.
   */
  covers: ApprovalRole[];
  /** Why the viewer cannot approve, in one sentence; null when they can. */
  why: string | null;
}

const ROLE_WORD: Record<ApprovalRole, string> = { design: 'design', tech: 'tech', approval: 'an' };

const people = (logins: readonly string[], names: Record<string, string> = {}) => {
  const who = logins.map((l) => names[l.toLowerCase()] ?? `@${l.replace(/^@/, '')}`);
  return who.length <= 2 ? who.join(' or ') : `${who.slice(0, 2).join(', ')} or ${who.length - 2} more`;
};

/** What the viewer may do on a suggestion, and when they may not, why (shown in place of the buttons). */
export function suggestionGate(x: {
  status: SuggestionStatus;
  viewer: string | null;
  author: string;
  owners: Owners;
  tier: 1 | 2 | 3;
  approvals: SuggestionApprovals | undefined;
  /** The viewer can push (counts when no owner is configured). */
  collaborator?: boolean;
  names?: Record<string, string>;
  /** "Sign in to review" or "Connect GitHub to review" (lib/gh-wording ghAction). */
  signInLine: string;
  /** The only owner whose approval covers design and tech (core soloOwnerOf), null when the rule is off. */
  soloOwner?: string | null;
}): SuggestionGate {
  const none: SuggestionGate = { canApprove: false, canRequestChanges: false, canDecline: false, role: null, covers: [], why: null };
  if (!x.viewer) return { ...none, why: `${x.signInLine}.` };
  if (x.status === 'applied') return { ...none, why: 'It is applied: the library has it.' };
  if (x.status === 'declined') return { ...none, why: 'It was declined.' };
  if (x.status === 'applying') return { ...none, why: 'A developer is applying it. The review is done.' };
  const open = noOwners(x.owners);
  const roles = open ? (x.collaborator ? (['design', 'tech', 'approval'] as ApprovalRole[]) : []) : viewerRoles(x.viewer, x.owners);
  const listed = [...new Set([...x.owners.design, ...x.owners.tech])];
  // Approved: its author has nothing left to do, a developer applies it.
  if (x.status === 'approved' && same(x.viewer, x.author)) return { ...none, why: 'Approved. A developer applies it next: nothing more for you to do.' };
  if (same(x.viewer, x.author)) return { ...none, why: `You suggested it, so someone else approves it${listed.length ? `: ${people(listed, x.names)}` : ''}.` };
  if (!roles.length) {
    return { ...none, why: open ? 'Only people who can edit the library approve suggestions.' : `Only the design system owners approve suggestions: ${people(listed, x.names)}.` };
  }
  const missing = missingRoles(x.tier, x.approvals);
  const mine = x.approvals?.approvers.some((l) => same(l, x.viewer)) ?? false;
  const role = missing.find((m) => roles.includes(m)) ?? null;
  const base = { ...none, canRequestChanges: x.status !== 'outdated', canDecline: true };
  if (x.status === 'outdated') return { ...base, why: 'Main changed under it: ask the author to send it again before anyone approves it.' };
  if (mine) {
    const left = missing[0];
    const others = (left === 'design' ? x.owners.design : left === 'tech' ? x.owners.tech : listed).filter((l) => !same(l, x.viewer));
    const rest = left ? ` It waits for ${left === 'approval' ? 'an approval' : `a ${left} approval`}${others.length ? ` from ${people(others, x.names)}` : ' from someone else'}.` : '';
    return { ...base, why: `You approved this version.${rest || (x.status === 'approved' ? ' A developer applies it.' : '')}` };
  }
  if (x.status === 'approved') return { ...base, why: 'It has every approval it needs. A developer applies it.' };
  if (!role) {
    const other = missing[0];
    const who = other === 'design' ? x.owners.design : other === 'tech' ? x.owners.tech : listed;
    return { ...base, why: other ? `Your part is done. It waits for ${other === 'approval' ? 'an approval' : `a ${other} approval`}${who.length ? ` from ${people(who, x.names)}` : ''}.` : 'It has every approval it needs.' };
  }
  // The only owner, when the team opted in: one approval covers both parts (core summarizeApprovals).
  const parts = missing.filter((m) => m !== 'approval');
  if (x.soloOwner && same(x.viewer, x.soloOwner) && parts.length > 1) return { ...base, canApprove: true, role, covers: parts, why: soloOwnerSentence(x.soloOwner, true) };
  return { ...base, canApprove: true, role, covers: [role] };
}

/** "Approve for design", "Approve": the big button says which part the viewer signs, when it is only one part. */
export function approveLabel(gate: Pick<SuggestionGate, 'role' | 'covers'>, tier: 1 | 2 | 3): string {
  const parts = gate.covers.filter((c) => c !== 'approval');
  if (!gate.role || tier === 1 || parts.length !== 1) return SUGGESTION_WORDS.approve;
  return `${SUGGESTION_WORDS.approve} for ${ROLE_WORD[parts[0]!]}`;
}

/** The approvals it needs, as checklist rows: who approved, who asked for changes, who is still expected. */
export function approvalRows(x: { tier: 1 | 2 | 3; approvals: SuggestionApprovals | undefined; owners: Owners; names?: Record<string, string> }): { label: string; state: 'approved' | 'changes' | 'waiting'; text: string }[] {
  const a = x.approvals;
  const by = (logins: readonly string[]) => logins.map((l) => x.names?.[l.toLowerCase()] ?? `@${l}`).join(', ');
  const changes = a?.changesRequested ?? [];
  const row = (label: string, done: boolean, who: readonly string[]) => {
    if (changes.length) return { label, state: 'changes' as const, text: `Changes asked by ${by(changes)}` };
    if (done) return { label, state: 'approved' as const, text: a?.approvers.length ? `Approved by ${by(a.approvers)}` : 'Approved' };
    return { label, state: 'waiting' as const, text: who.length ? `Waiting for ${people(who, x.names)}` : 'Waiting for someone who can edit the library' };
  };
  if (x.tier === 1) return [row('One approval', Boolean(a && (a.design || a.tech)), [...new Set([...x.owners.design, ...x.owners.tech])])];
  return [row('Design approval', Boolean(a?.design), x.owners.design), row('Tech approval', Boolean(a?.tech), x.owners.tech)];
}

/** How a developer applies it: the "For developers" fold of the approved panel, never shown to a designer. */
export function applyLines(n: number): { label: string; value: string }[] {
  return [
    { label: 'In a terminal', value: `npx bridge apply ${n}` },
    { label: 'With Claude', value: `Apply Bridge suggestion #${n}` },
  ];
}

/** The toast after a review. */
export function reviewedLine(event: 'approve' | 'request-changes' | 'decline', title: string, status?: SuggestionStatus): string {
  if (event === 'decline') return `Declined ${title}`;
  if (event === 'request-changes') return `Suggested changes on ${title}`;
  return status === 'approved' ? `Approved ${title}. ${SUGGESTION_WORDS.ready}.` : `Approved ${title}`;
}

/** Who reads the decline reason: the author, notified by GitHub. */
export function declineAudience(author: string, names: Record<string, string> = {}): string {
  return `${names[author.toLowerCase()] ?? `@${author}`} gets a GitHub notification with your reason. The suggestion closes and nothing reaches the library.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The author's own suggestions on their home: what waits on others, said calmly, never as a task

/** Where the author's own open suggestion stands, in their words (the card line on their home). */
export const OWN_SUGGESTION_WORDS: Partial<Record<SuggestionStatus, string>> = {
  'needs-review': 'waiting for a review',
  'changes-requested': 'changes requested, send a new version',
  approved: 'approved, a developer applies it',
  applying: 'a developer is applying it',
  outdated: 'outdated, send it again',
};

/**
 * The card of a suggestion the viewer sent, next to their branches on Home: "Suggestion · waiting for a review". Null
 * once it is applied or declined (History and the suggestion's page keep it).
 */
export function ownSuggestionCard(s: { number: number; title: string; createdAt: string; status: SuggestionStatus }): BranchCard | null {
  const detail = OWN_SUGGESTION_WORDS[s.status];
  if (!detail) return null;
  return {
    number: s.number,
    title: shortTitle(s.title),
    href: suggestionHref(s.number),
    stage: 'ready',
    updated: s.createdAt,
    reviewer: null,
    thumb: { kind: 'icon', icon: 'token' },
    statusLine: { stage: 'Suggestion', detail },
  };
}
