// The lifecycle of a branch, in designer words (Figma branching, lib/vocabulary), from GitHub data only. Pure: no DOM, no fetch. Unit tested in
// change-status.test.ts. Shared by the change detail (status line), the Changes list (status filter, row chip) and
// the Overview "For you" rows, so the three say the same thing.
//
//   Draft                       the change is a draft (GitHub draft flag, explorations included)
//   In review                   open and not a draft: the review flow says what it needs (lib/changes whoActs)
//   Approved, waiting for code  the design approval is in and only developer work stands between it and shipping
//   Merged                      merged ('shipped' is the internal id, kept for ?status=shipped links)
//   Closed                      closed without merging
//
// "Waiting for code" never guesses. It holds only when every one of these is read from GitHub or the repo: the work
// is design work (lib/work-nature), the design approval the tier needs is given (lib/review-rules summarizeApprovals),
// nobody asked for changes, and at least one check fails, every failing one a developer check (lib/check-explain).
// Who it waits on comes from governance.owners tech in bridge.config.json; without one it names the role.
import type { Draft, DraftEdit } from './editor-model';
import { classifyCheck, type CheckKind } from './check-explain';
import { pullState, type PullState, type ReviewStatusKind, type Tier } from './review-rules';
import { CLAUDE_DRAFTED_SENTENCE, CLAUDE_WAITING_SENTENCE, GROUP_TONE, openerFor, type Opener, type OpenerRow, type StatusTone } from './changes';
import type { WorkNature } from './work-nature';
import { hasOwnerApproval, reopenEligibility, type ReopenEligibility, type TokenSet } from '@bridge-ds/core';
import { branchCount, STATUS_WORDS, VOCAB } from './vocabulary';

export type Lifecycle = 'draft' | 'ready' | 'waiting' | 'shipped' | 'closed';

/** The DS Badge tones a lifecycle can take (status colour only, one tone per status group, lib/changes). */
export type LifecycleTone = StatusTone;

export const LIFECYCLE: Record<Lifecycle, { label: string; short: string }> = {
  draft: { label: STATUS_WORDS.draft, short: STATUS_WORDS.draft },
  ready: { label: STATUS_WORDS.inReview, short: STATUS_WORDS.inReview },
  waiting: { label: STATUS_WORDS.waiting, short: STATUS_WORDS.waitingShort },
  shipped: { label: STATUS_WORDS.merged, short: STATUS_WORDS.merged },
  closed: { label: STATUS_WORDS.closed, short: STATUS_WORDS.closed },
};

/**
 * The tone of the status badge: the lifecycle state alone, so the same words always wear the same colour. Ready for
 * review is the waiting tone (in review, waiting for its reviewers), whatever its checks say: a failing check is its
 * own signal (the checklist and the "Blocked by tests" chip), never a red "Ready for review". The other states are
 * grey: waiting for code is a quiet wait nobody in Studio acts on, the rest are done or not asked yet.
 */
export function lifecycleTone(l: Lifecycle): LifecycleTone {
  return l === 'ready' ? GROUP_TONE.waiting : 'neutral';
}

// ---------------------------------------------------------------------------------------------------------------
// Waiting for code

/** The design approval the tier needs: Tier 2 and 3 a design owner approval, Tier 1 one owner approval (mergeGate). */
export function designApprovalIn(tier: Tier | null, approvals: { design: boolean; approvers: string[]; owner?: boolean } | null | undefined): boolean {
  if (!approvals) return false;
  return (tier ?? 3) >= 2 ? approvals.design : hasOwnerApproval({ tech: false, changesRequested: [], ...approvals });
}

export interface WaitingInput {
  state: PullState;
  /** A running exploration is tried, never reviewed as is. */
  exploration?: boolean;
  nature: WorkNature;
  designApproved: boolean;
  /** Reviewers whose latest review asks for changes. */
  changesRequested: number;
  /** The failing checks, classified (lib/check-explain classifyCheck). */
  failing: { kind: CheckKind }[];
}

/** The rule at the top of this file. */
export function waitingForCode(x: WaitingInput): boolean {
  return (
    x.state === 'open' &&
    !x.exploration &&
    x.nature === 'design' &&
    x.designApproved &&
    x.changesRequested === 0 &&
    x.failing.length > 0 &&
    x.failing.every((c) => c.kind === 'developer')
  );
}

/** The failing checks of a list row, by name only (the row does not read the job steps): classifyCheck. */
export const failingByName = (names: string[] | undefined): { kind: CheckKind }[] => (names ?? []).map((name) => classifyCheck({ name }));

/** The lifecycle of a change from its pull request state and the waiting-for-code rule. */
export function changeLifecycle(x: { state: PullState; waiting: boolean }): Lifecycle {
  if (x.state === 'merged') return 'shipped';
  if (x.state === 'closed') return 'closed';
  if (x.state === 'draft') return 'draft';
  return x.waiting ? 'waiting' : 'ready';
}

/**
 * The lifecycle of a list row. The pull request alone says draft, shipped or closed; an open one is Ready for review
 * until its status is read and says it waits for code.
 */
export function rowLifecycle(
  pull: { state?: string; draft?: boolean; merged_at?: string | null; labels?: readonly ({ name?: string } | string)[] | null },
  st: { kind: ReviewStatusKind | null; nature: WorkNature; tier: Tier | null; design?: boolean; approvers?: string[]; changesRequested?: string[]; failingChecks?: string[]; exploration?: boolean },
): Lifecycle {
  const state = pullState(pull);
  const waiting =
    st.kind === 'ci-failing' &&
    waitingForCode({
      state,
      exploration: st.exploration,
      nature: st.nature,
      designApproved: designApprovalIn(st.tier, st.design === undefined ? null : { design: st.design, approvers: st.approvers ?? [] }),
      changesRequested: st.changesRequested?.length ?? 0,
      failing: failingByName(st.failingChecks),
    });
  return changeLifecycle({ state, waiting });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence of a change that waits for code: who it waits on, from the tech owners as the config names them
 * ("@a or @b", "@acme/web (4 people)"), else the role. `failing` counts the failing developer checks; `oldValue`
 * when they only expect the old token value (check-explain checkStory).
 */
export function waitingSentence(x: { failing: number; oldValue?: boolean; techOwners: string | null; viewerIsTech?: boolean }): string {
  const what = x.failing > 0 ? `${x.oldValue ? 'update' : 'fix'} ${plural(x.failing, 'developer test')}` : 'finish the code';
  if (x.viewerIsTech) return `Design is approved. Your turn as tech owner: ${what}.`;
  const who = x.techOwners ? `the tech owner (${x.techOwners})` : 'a developer';
  return `Design is approved. Waiting for ${who} to ${what}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Detail: the one status line and its one action

export type StatusAction = 'mark-ready' | 'reopen' | 'restart' | null;

// Who may reopen a closed branch: one rule with the MCP server and the CLI (@bridge-ds/core review-gate).
export { reopenEligibility, type ReopenEligibility };

/** The sentence a closed change shows when its branch is gone. */
export const GONE_SENTENCE = `This ${VOCAB.branch} can't be reopened: its work was removed.`;

/**
 * The one action of the status line. Draft: the author marks it ready (an exploration is promoted from its own flow,
 * never marked ready here). Closed: reopen, or start again when the work is gone and it changed tokens. Ready for
 * review keeps the review flow's action; waiting for code and shipped have none.
 */
export function statusAction(x: { lifecycle: Lifecycle; isAuthor: boolean; canWrite: boolean; exploration: boolean; reopen: ReopenEligibility; tokenEdits: boolean; claude?: 'waiting' | 'drafted' | null }): StatusAction {
  // A branch opened from Figma with the spec only: nothing to review until a developer builds it with Claude.
  if (x.lifecycle === 'draft') return x.isAuthor && x.canWrite && !x.exploration && x.claude !== 'waiting' ? 'mark-ready' : null;
  if (x.lifecycle === 'closed') {
    if (x.reopen.kind === 'reopen') return 'reopen';
    if (x.reopen.kind === 'gone' && x.tokenEdits) return 'restart';
  }
  return null;
}

export const ACTION_LABEL: Record<Exclude<StatusAction, null>, string> = {
  'mark-ready': VOCAB.requestReview,
  reopen: `Reopen this ${VOCAB.branch}`,
  restart: `Start again from this ${VOCAB.branch}`,
};

/**
 * The sentence of the status line for the states the review flow does not already explain. A branch opened from Figma
 * (decision RT-1, core claudeStage): before Claude drafted the code it waits on a developer, never on its designer;
 * once drafted it is ready for review, and while no owner has acted yet (`untouched`: no review, no failing check) it
 * says so in its own words.
 */
export function lifecycleSentence(x: {
  lifecycle: Lifecycle;
  isAuthor: boolean;
  author: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  reopen?: ReopenEligibility;
  exploration?: boolean;
  claude?: 'waiting' | 'drafted' | null;
  untouched?: boolean;
}): string | null {
  const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
  switch (x.lifecycle) {
    case 'draft':
      if (x.exploration) return null;
      if (x.claude === 'waiting') return CLAUDE_WAITING_SENTENCE;
      return x.isAuthor ? 'Request a review when it is ready. Until then nobody is asked to review it.' : `Waiting for @${x.author} to request a review.`;
    case 'shipped':
      return x.mergedAt ? `Merged into ${VOCAB.main} on ${day(x.mergedAt)}.` : `Merged into ${VOCAB.main}.`;
    case 'closed':
      if (x.reopen?.kind === 'gone') return GONE_SENTENCE;
      return x.closedAt ? `Closed without merging on ${day(x.closedAt)}.` : 'Closed without merging.';
    case 'ready':
      return x.claude === 'drafted' && x.untouched ? CLAUDE_DRAFTED_SENTENCE : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Overview "For you": the same badge on each change row

/**
 * The badge of a For you change row: its lifecycle in the same words and the same tone as the status line (the task
 * is said by the row's words and action, never by recolouring the lifecycle).
 */
export function todoBadge(l: Lifecycle): { label: string; tone: LifecycleTone } {
  return { label: LIFECYCLE[l].label, tone: lifecycleTone(l) };
}

// ---------------------------------------------------------------------------------------------------------------
// Changes list: the status filter

export type StatusFilter = 'open' | Lifecycle;

/**
 * The status filter of the Changes list: the lifecycle in the same words as the status line and the row chips (the
 * full labels, so "Approved, waiting for code" never reads as a review state), plus "All open", the three open states
 * together (the default).
 */
export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'All open' },
  { value: 'draft', label: LIFECYCLE.draft.label },
  { value: 'ready', label: LIFECYCLE.ready.label },
  { value: 'waiting', label: LIFECYCLE.waiting.label },
  { value: 'shipped', label: LIFECYCLE.shipped.label },
  { value: 'closed', label: LIFECYCLE.closed.label },
];

/** The status Select picks a filter (detail: the value); the page tells it the current one back. */
export const STATUS_FILTER_EVENT = 'bridge:status-filter';
export const STATUS_SYNC_EVENT = 'bridge:status-sync';

/** The filter from the address (?status=waiting), Open by default. ?status=merged reads as the Merged filter too. */
export function statusFilterParam(search: string): StatusFilter {
  const raw = new URLSearchParams(search).get('status');
  const v = raw === 'merged' ? 'shipped' : raw;
  return STATUS_FILTERS.some((f) => f.value === v) ? (v as StatusFilter) : 'open';
}

/** Whether a row shows under a filter. Open: everything not shipped or closed. */
export const showsUnderStatus = (filter: StatusFilter, l: Lifecycle) => (filter === 'open' ? l !== 'shipped' && l !== 'closed' : filter === l);

/** List order by lifecycle: work someone in Studio can move first (by urgency), then waiting for code, then drafts. */
const LIST_ORDER: Record<Lifecycle, number> = { ready: 0, waiting: 1, draft: 2, shipped: 3, closed: 3 };

/** Rows in list order, keeping the urgency order (lib/changes byUrgency) inside each lifecycle. */
export function byLifecycle<R extends { lifecycle: Lifecycle }>(rows: R[]): R[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => LIST_ORDER[a.r.lifecycle] - LIST_ORDER[b.r.lifecycle] || a.i - b.i).map((x) => x.r);
}

/**
 * The opener of All branches with the lifecycle. It counts the branches in review, waiting for code and in draft apart,
 * then names the most urgent branch someone in Studio can move (never one that waits for code: nobody in Studio acts
 * on it). Same urgency order and words as before (lib/changes openerFor).
 */
export function statusOpener(rows: (OpenerRow & { lifecycle: Lifecycle })[]): Opener {
  const drafts = rows.filter((r) => r.lifecycle === 'draft').length;
  const review = rows.filter((r) => r.lifecycle !== 'draft');
  const active = review.filter((r) => r.lifecycle !== 'waiting');
  const waiting = review.length - active.length;
  if (!drafts && !waiting) return openerFor(rows);
  if (!review.length) return { sentence: `${plural(drafts, 'draft')}, nothing in review yet.`, action: null };
  // Each status counted apart, in the words of its badge: "1 branch in review, 2 waiting for code and 1 draft."
  const parts = [
    active.length ? `${branchCount(active.length)} in review` : '',
    waiting ? `${active.length ? waiting : branchCount(waiting)} waiting for code` : '',
    drafts ? plural(drafts, 'draft') : '',
  ].filter(Boolean);
  const head = `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}.`;
  if (!active.length) return { sentence: head, action: null };
  const first = openerFor(active);
  const why = first.sentence.replace(/^\d+ branch(es)? in review\. /, '');
  return { sentence: `${head} ${why}`, action: first.action };
}

/** The filters that read finished changes (one more GitHub read, only when picked). */
export const needsClosed = (filter: StatusFilter) => filter === 'shipped' || filter === 'closed';

/** The quiet line when a filter leaves nothing. */
export function emptyFilterLine(filter: StatusFilter): string {
  switch (filter) {
    case 'draft':
      return `No ${VOCAB.branch} is a draft.`;
    case 'ready':
      return `No ${VOCAB.branch} is in review.`;
    case 'waiting':
      return `No approved ${VOCAB.branch} waits for code.`;
    case 'shipped':
      return `No ${VOCAB.branch} was merged recently.`;
    case 'closed':
      return `No ${VOCAB.branch} was closed recently.`;
    default:
      return 'Nothing to review.';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Start again: the token edits of a closed change, as a draft for the token editor

/**
 * The token edits a change made (head against its base), as draft value edits the token editor proposes again on
 * top of the latest library. Only value changes of tokens that exist on both sides carry over; added, removed and
 * renamed tokens and brand overrides are counted as skipped, so the screen can say so.
 */
export function draftFromTokenSets(base: TokenSet, head: TokenSet): { draft: Draft; carried: number; skipped: number } {
  const edits: DraftEdit[] = [];
  let skipped = 0;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const paths = [...new Set([...base.byPath.keys(), ...head.byPath.keys()])].sort();
  for (const path of paths) {
    const a = base.byPath.get(path);
    const b = head.byPath.get(path);
    if (!a || !b) {
      skipped++;
      continue;
    }
    for (const mode of [...new Set([...Object.keys(a.values), ...Object.keys(b.values)])]) {
      const before = a.values[mode];
      const after = b.values[mode];
      if (same(before, after)) continue;
      if (after === undefined) {
        skipped++;
        continue;
      }
      edits.push({ kind: 'value', id: b.id, path, mode, before, after });
    }
  }
  const okey = (o: { brand: string; theme: string; path: string }) => `${o.brand}|${o.theme}|${o.path}`;
  const ob = new Map(base.overrides.map((o) => [okey(o), o]));
  for (const o of head.overrides) {
    const x = ob.get(okey(o));
    if (!x || !same(x.value, o.value)) skipped++;
  }
  return { draft: { edits }, carried: edits.length, skipped };
}

/** What "Start again" says once the draft is ready, or why it could not be. */
export function restartLine(x: { carried: number; skipped: number; draftBusy: boolean }): { ok: boolean; text: string } {
  if (x.draftBusy) return { ok: false, text: 'You already have a draft in this browser. Request a review of it or clear it in Tokens, then start again.' };
  if (!x.carried) return { ok: false, text: `This ${VOCAB.branch} has no token value to carry over. Create a new ${VOCAB.branch} from Tokens instead.` };
  const skipped = x.skipped ? ` ${plural(x.skipped, 'other edit')} (new, removed or brand-only tokens) could not be carried over.` : '';
  return { ok: true, text: `${plural(x.carried, 'token edit')} copied into your draft.${skipped} Opening Tokens to request a review.` };
}
