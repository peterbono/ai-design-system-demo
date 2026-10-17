// Studio Changes: the pure rules behind the "In review" list, the pull request opener and the undo panel. No DOM,
// no fetch: shared by scripts/changes and scripts/reviews, unit tested in changes.test.ts.
//
// Color means status, never risk. Four groups, one tone each, everywhere in the Studio:
//   blocked  red     CI failing, changes requested, merge conflict
//   waiting  violet  waiting for an approval
//   ready    green   ready to merge
//   neutral  grey    draft, unknown, checks running, merged, closed
// Risk tiers are plain grey labels ("Tier 2"), so a Tier 3 change that is ready reads green, not red.
import type { CiSummary, MergeGate, ReviewStatusKind, Tier } from './review-rules';
import type { TokenReview } from './token-review';

export type StatusGroup = 'blocked' | 'waiting' | 'ready' | 'neutral';

export const STATUS_GROUP: Record<ReviewStatusKind, StatusGroup> = {
  'ci-failing': 'blocked',
  'changes-requested': 'blocked',
  conflict: 'blocked',
  'needs-design': 'waiting',
  'needs-tech': 'waiting',
  'needs-approval': 'waiting',
  ready: 'ready',
  'ci-running': 'neutral',
  draft: 'neutral',
  unknown: 'neutral',
  merged: 'neutral',
  closed: 'neutral',
};

/** Pill class of each group (site.css `.pill.is-*`). */
export const GROUP_TONE: Record<StatusGroup, string> = { blocked: 'is-fail', waiting: 'is-info', ready: 'is-pass', neutral: '' };

export const statusGroup = (kind: ReviewStatusKind | null | undefined): StatusGroup => (kind ? STATUS_GROUP[kind] : 'neutral');
export const statusTone = (kind: ReviewStatusKind | null | undefined): string => GROUP_TONE[statusGroup(kind)];

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
  if (kind === 'ci-running' || kind === 'unknown' || !kind) return URGENCY.neutral;
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
}

export interface Opener {
  /** "3 changes open. #3 is blocked by a failing check." */
  sentence: string;
  /** The one primary action: review the most urgent pull request. Null when nothing is open. */
  action: { label: string; pr: number } | null;
}

const WHY: Partial<Record<ReviewStatusKind, string>> = {
  'ci-failing': 'is blocked by a failing check',
  conflict: 'is blocked by a merge conflict',
  'changes-requested': 'is blocked: a reviewer requested changes',
  'needs-design': 'waits for a design approval',
  'needs-tech': 'waits for a tech approval',
  'needs-approval': 'waits for an approval',
  ready: 'is ready to merge',
  'ci-running': 'is waiting for its checks',
  draft: 'is still a draft',
};

/** The In review opener: how many are open, the state of the most urgent one, and "Review #N". */
export function openerFor(rows: OpenerRow[]): Opener {
  const n = rows.length;
  if (!n) return { sentence: 'Nothing to review.', action: null };
  const first = byUrgency(rows)[0]!;
  const count = `${n} ${n === 1 ? 'change' : 'changes'} open.`;
  const why = first.kind ? WHY[first.kind] : undefined;
  return { sentence: why ? `${count} #${first.number} ${why}.` : `${count} Open one to see its checks and approvals.`, action: { label: `Review #${first.number}`, pr: first.number } };
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
  if (s.state === 'draft') return `Draft: mark it ready for review on GitHub first.${after}`;
  if (s.ci.state === 'fail') {
    const many = s.ci.failed.length > 1;
    return `Blocked: the ${names(s.ci.failed)} check${many ? 's fail' : ' fails'}.${after}`;
  }
  if (s.changesRequestedBy.length) return `Blocked: @${s.changesRequestedBy.join(', @')} requested changes.${after}`;
  if (s.gate.reasons.some((r) => /merge conflict/.test(r))) return `Blocked: GitHub reports a merge conflict.${after}`;
  if (s.ci.state === 'pending') return `Checks are still running.${after}`;
  if (needs) return `Waiting for ${needs}. Checks pass.`;
  if (s.gate.allowed) return 'Ready to merge: checks pass and the approvals are in.';
  return s.ci.state === 'none' ? `No checks reported for this commit yet.${after}` : 'Open the checks and the conversation to see what it needs.';
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
}): { kind: PrimaryKind; label: string; url?: string } {
  if (input.state === 'merged' || input.state === 'closed') return { kind: 'github', label: 'Open on GitHub' };
  const failed = input.ci.state === 'fail' ? input.ci.failed.find((f) => f.url) : undefined;
  if (failed) return { kind: 'open-run', label: 'Open failing run', url: failed.url };
  if (!input.connected) return { kind: 'connect', label: 'Connect GitHub to review' };
  if (input.gate.allowed && input.canWrite) return { kind: 'merge', label: 'Merge' };
  const green = input.ci.state === 'pass' || input.ci.state === 'none';
  if (green && input.gate.missing.length && !input.isAuthor && input.state === 'open') return { kind: 'approve', label: 'Approve' };
  return { kind: 'github', label: 'Open on GitHub' };
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
