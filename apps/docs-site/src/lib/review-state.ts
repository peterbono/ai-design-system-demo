// One lifecycle, the same states and the same words on every Studio page (the exploration page, Being built, Changes,
// the home): Exploring, Waiting for code (Done exploring, nobody pushed), Being built (developers pushed, still a
// draft), In review (developers asked for a review, or changes were requested), Shipped (merged; a library change
// reads In the next release until the library version is published), Archived.
//
// The review is read from the pull request: who is asked (the requested reviewers, else the team's design approvers),
// each reviewer's last say (approved or changes requested; changes requested wins, as on GitHub), and the draft flag.
// The reviews themselves (GET pulls/{n}/reviews) are read only for open, handed-off pull requests that are not drafts
// (needsReviewRead): a few per page, never one per row. Pure: no DOM, no fetch. Tested in review-state.test.ts.
import { explorationStatus, isArchivedExploration, isExplorationPull, parseExplorationBody, type ExplorationStatus } from '@bridge-ds/core';

/** A review of the pull request as GitHub lists it (GET pulls/{n}/reviews). */
export interface PullReviewLike {
  user?: { login?: string } | null;
  state: string;
  submitted_at?: string | null;
}

const lower = (s: string) => s.replace(/^@/, '').toLowerCase();
const isBot = (login: string) => /\[bot\]$/i.test(login);

/** Each reviewer's last say that counts: approved or changes requested. A dismissal clears it, a comment changes nothing. */
export function lastSays(reviews: readonly PullReviewLike[]): Map<string, { state: 'APPROVED' | 'CHANGES_REQUESTED'; login: string }> {
  const last = new Map<string, { state: 'APPROVED' | 'CHANGES_REQUESTED'; login: string }>();
  for (const r of reviews) {
    const login = r.user?.login;
    if (!login || isBot(login)) continue;
    const key = lower(login);
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') last.set(key, { state: r.state, login });
    else if (r.state === 'DISMISSED') last.delete(key);
  }
  return last;
}

/**
 * Where the review stands from the pull request's reviews: each reviewer's last say that counts. Changes requested by
 * anyone wins over an approval, as on GitHub. Null when nobody has decided yet.
 */
export function reviewVerdictOf(reviews: readonly PullReviewLike[]): { kind: 'approved' | 'changes'; login: string } | null {
  const all = [...lastSays(reviews).values()];
  const changes = all.filter((x) => x.state === 'CHANGES_REQUESTED').pop();
  if (changes) return { kind: 'changes', login: changes.login };
  const ok = all.filter((x) => x.state === 'APPROVED').pop();
  return ok ? { kind: 'approved', login: ok.login } : null;
}

/**
 * Who is asked to review: the pull request's requested reviewers, else the design approvers of the team (logins,
 * deduplicated, never the person who built it alone or a bot).
 */
export function reviewersAsked(input: { requested?: readonly { login?: string }[] | null; approvers: readonly string[]; builders?: readonly string[] }): string[] {
  const out: string[] = [];
  const add = (l: string | null | undefined) => {
    if (l && !isBot(l) && !out.some((x) => lower(x) === lower(l))) out.push(l.replace(/^@/, ''));
  };
  for (const r of input.requested ?? []) add(r.login);
  if (out.length) return out;
  const built = new Set((input.builders ?? []).map(lower));
  // A team the directory could not expand ("org/team") names nobody yet.
  for (const a of input.approvers) if (!a.includes('/') && !built.has(lower(a))) add(a);
  return out;
}

/** The review of one pull request, as every page reads it. */
export interface ReviewState {
  /** Still a draft: the developers are building it. */
  draft: boolean;
  /** Who is asked (logins): the requested reviewers, else the design approvers. */
  asked: string[];
  /** The requested reviewers only (GitHub drops a reviewer from this list once they have reviewed). */
  requested: string[];
  /** The decision so far, or null. */
  verdict: { kind: 'approved' | 'changes'; login: string } | null;
  /** Each reviewer's last say, by lower-case login. */
  says: Map<string, 'APPROVED' | 'CHANGES_REQUESTED'>;
}

/** The review state of a pull request from what was read: its draft flag, requested reviewers and reviews (none read: []). */
export function reviewStateOf(input: { draft?: boolean | null; requested?: readonly { login?: string }[] | null; approvers: readonly string[]; builders?: readonly string[]; reviews?: readonly PullReviewLike[] | null }): ReviewState {
  const reviews = input.reviews ?? [];
  const says = new Map([...lastSays(reviews).entries()].map(([k, v]) => [k, v.state]));
  return {
    draft: input.draft !== false,
    asked: reviewersAsked(input),
    requested: (input.requested ?? []).map((r) => r.login ?? '').filter((l) => l && !isBot(l)),
    verdict: reviewVerdictOf(reviews),
    says,
  };
}

/** Developers asked for a review: the pull request is ready for review, or reviewers were requested on it. */
export const reviewAsked = (s: Pick<ReviewState, 'draft' | 'requested'>) => !s.draft || s.requested.length > 0;

/**
 * Whether the review waits on the viewer: GitHub asks them by name (a requested reviewer), or nobody is named and they
 * are one of the design approvers who has not decided yet. A reviewer who approved, or who asked for changes and was
 * not asked again, waits no more. Only once developers asked for a review.
 */
export function waitsOnViewer(s: ReviewState, viewer: string | null | undefined): boolean {
  if (!viewer || !reviewAsked(s)) return false;
  const v = lower(viewer);
  if (s.requested.some((l) => lower(l) === v)) return true;
  if (s.requested.length) return false;
  if (s.verdict?.kind === 'changes') return false;
  return s.asked.some((l) => lower(l) === v) && !s.says.has(v);
}

const listNames = (xs: readonly string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs[0]} and ${xs.length - 1} more`);

/**
 * The review in one line, the same words on every page: "Changes requested by Lee", "Approved by Lee", "Waiting for
 * your review", "Waiting for Florian's review", "Waiting for a review from Florian and Lee", "Waiting for a reviewer".
 */
export function reviewLine(s: ReviewState, opts: { viewer?: string | null; nameOf?: (login: string) => string } = {}): string {
  const nameOf = opts.nameOf ?? ((l: string) => l);
  if (s.verdict?.kind === 'changes') return `Changes requested by ${nameOf(s.verdict.login)}`;
  if (s.verdict?.kind === 'approved' && !s.requested.length) return `Approved by ${nameOf(s.verdict.login)}`;
  if (waitsOnViewer(s, opts.viewer)) return 'Waiting for your review';
  const pending = s.requested.length ? s.requested : s.asked.filter((l) => !s.says.has(lower(l)));
  if (!pending.length) return 'Waiting for a reviewer';
  if (pending.length === 1) return `Waiting for ${nameOf(pending[0]!)}'s review`;
  return `Waiting for a review from ${listNames(pending.map(nameOf))}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The lifecycle

/** Where a piece of work stands, on every page. */
export type LifecycleStage = 'exploring' | 'waiting-for-code' | 'being-built' | 'in-review' | 'next-release' | 'shipped' | 'archived' | 'closed';

/** The words of each stage: the tab, the tag and the line say the same. */
export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  exploring: 'Exploring',
  'waiting-for-code': 'Waiting for code',
  'being-built': 'Being built',
  'in-review': 'In review',
  'next-release': 'In the next release',
  shipped: 'Shipped',
  archived: 'Archived',
  closed: 'Closed',
};

/**
 * The stage of an exploration from core's status (explorationStatus), its archived label, the review read and, once
 * merged, whether it waits for the library release. Core's "building" splits here: still a draft with nobody asked is
 * Being built; ready for review, reviewers asked, or changes requested is In review.
 */
export function explorationLifecycle(input: { status: ExplorationStatus; archived?: boolean; review?: Pick<ReviewState, 'draft' | 'requested' | 'verdict'> | null; nextRelease?: boolean }): LifecycleStage {
  const { status } = input;
  if (input.archived && status !== 'shipped' && status !== 'closed') return 'archived';
  if (status === 'active') return 'exploring';
  if (status === 'ready') return 'waiting-for-code';
  if (status === 'building') {
    const r = input.review;
    return r && (reviewAsked(r) || r.verdict?.kind === 'changes') ? 'in-review' : 'being-built';
  }
  if (status === 'shipped') return input.nextRelease ? 'next-release' : 'shipped';
  if (status === 'promoted') return 'in-review';
  return 'closed';
}

/** The fields of a pull request the lifecycle reads (GitHub's list shape). */
export interface LifecyclePull {
  state: string;
  draft?: boolean | null;
  merged_at?: string | null;
  labels?: readonly ({ name?: string } | string)[] | null;
  head?: { ref?: string; sha?: string } | null;
  body?: string | null;
  requested_reviewers?: readonly { login?: string }[] | null;
}

const coreOf = (p: LifecyclePull) => ({
  state: p.merged_at ? 'merged' : p.state,
  merged_at: p.merged_at ?? null,
  labels: (p.labels ?? []) as ({ name?: string } | string)[],
  headRef: p.head?.ref,
  headSha: p.head?.sha,
  body: p.body ?? '',
  draft: p.draft ?? undefined,
});

/**
 * Whether the reviews of a pull request are worth one read: an exploration handed to developers (Being built in
 * core), open and no longer a draft. Everything else reads its stage without it.
 */
export function needsReviewRead(p: LifecyclePull): boolean {
  if (p.state !== 'open' || p.draft !== false || p.merged_at) return false;
  const c = coreOf(p);
  return isExplorationPull(c) && !isArchivedExploration(c.labels) && explorationStatus(c) === 'building';
}

/** The stage of an exploration pull request, with its reviews when they were read (needsReviewRead). */
export function pullLifecycle(p: LifecyclePull, ctx: { approvers?: readonly string[]; reviews?: readonly PullReviewLike[] | null; nextRelease?: boolean } = {}): { stage: LifecycleStage; review: ReviewState } {
  const c = coreOf(p);
  const review = reviewStateOf({ draft: p.draft ?? null, requested: p.requested_reviewers ?? [], approvers: ctx.approvers ?? [], reviews: ctx.reviews ?? null });
  return { stage: explorationLifecycle({ status: explorationStatus(c), archived: isArchivedExploration(c.labels), review, nextRelease: Boolean(ctx.nextRelease) }), review };
}

/** An exploration's name as people read it: the name in its Bridge block, else its title without "Exploration:". */
export function explorationNameOf(p: { number: number; title?: string | null; body?: string | null }): string {
  const raw = parseExplorationBody(p.body)?.name?.trim() || (p.title ?? '').replace(/^Exploration:\s*/i, '').trim() || `Exploration #${p.number}`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * The review state from what a status read already knows (who approved, who asked for changes): the home reads it
 * without another call to GitHub.
 */
export const reviewsFromStatus = (st: { approvers?: readonly string[] | null; changesRequested?: readonly string[] | null } | null | undefined): PullReviewLike[] => [
  ...(st?.approvers ?? []).map((login) => ({ user: { login }, state: 'APPROVED' })),
  ...(st?.changesRequested ?? []).map((login) => ({ user: { login }, state: 'CHANGES_REQUESTED' })),
];
