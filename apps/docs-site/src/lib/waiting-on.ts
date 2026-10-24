// The one rule for "waiting on me": what a change asks of the viewer now, if anything. Every surface that says
// something waits on the viewer reads it: the Home rows (scripts/home-data.ts), the Branches nav badge
// (scripts/needs-you.ts), the Branches "Waiting on me" filter (scripts/reviews.ts), the demo lead's queue
// (lib/demo-home.ts leadQueue) and the Review page, which lists the Home rows. Pure: no DOM, no fetch. Unit tested in
// waiting-on.test.ts.
//
// The rule, per viewer role:
//   - A reviewer (holds a review right: an owner, an approver, a shipper, or anyone who can write while the team names
//     nobody) is waited on for the design approval, the plain approval of Tier 1, usage guidance, the merge of an
//     approved change, a review GitHub asks of them, and the owner override when no other owner can approve and they
//     may use it. Never for the tech review: that is developer work.
//   - A contributor (an email member, or a GitHub account without a review right) is waited on only for their own
//     branches a reviewer sent back with changes.
//   - Everyone: their own branch approved and ready to merge (reviewers only, contributors never merge), their own
//     branch sent back with changes.
//   - Never on anyone in the Studio: technical blockers (failing tests, a conflict with main, a branch approved and
//     waiting for code), developer work, drafts, explorations, and a solo owner's own branch that only the owner
//     override can merge (it is theirs to merge when they choose, not a review someone waits for).
//   - A branch opened from Figma (decision RT-1, core claudeStage): labelled `waiting-for-claude` it waits on a
//     developer who builds it with Claude, never on anyone in the Studio; labelled `drafted-by-claude` it is ready for
//     review even while GitHub still calls it a draft, so it waits on the reviewers like any branch in review.
//   - The demo lead's seat (a visitor in the persona's place, statuses never read): every branch in review that is not
//     an exploration, a draft or developer work waits on the lead, as their home says.
import type { WhoActs } from './changes';
import { claudeStage, isDraft } from './review-rules';
import type { Lifecycle } from './change-status';
import type { WorkNature } from './work-nature';

/** What the change asks of the viewer: a review (design, guidance, requested), a merge, or their own branch's next step. */
export type WaitTask = 'design' | 'ship' | 'guidance' | 'requested' | 'own-changes' | 'own-ship';

/** Reviewer: holds a review right. Contributor: makes changes, never reviews. */
export type ViewerRole = 'reviewer' | 'contributor';

export interface WaitViewer {
  /** GitHub login, or the email of an email contributor. Null: nobody is connected, nothing waits on them. */
  login: string | null;
  role: ViewerRole;
  /** The demo lead's seat: statuses are never read, a branch in review waits on the seat. */
  seat?: boolean;
}

export interface WaitChange {
  /** Login of the account that opened it. */
  author: string;
  draft?: boolean;
  /** GitHub labels: `waiting-for-claude` and `drafted-by-claude` (core claudeStage) decide a branch opened from Figma. */
  labels?: readonly ({ name?: string } | string)[] | null;
  /** A running exploration (label or explore/ branch): tried, never reviewed as is. */
  exploration?: boolean;
  /** Design or developer work (lib/work-nature). Absent: design. */
  nature?: WorkNature;
  /** Only usage guidance changes. */
  guidance?: boolean;
  /** Draft, ready, waiting for code, shipped, closed (lib/change-status rowLifecycle). Absent: not known. */
  lifecycle?: Lifecycle;
  /** Who acts now (lib/changes whoActs) for this viewer. Null while the status is not read. */
  who: WhoActs | null;
  /** Reviewers GitHub asks for a review. */
  requested?: string[];
  /** Reviewers whose latest review asks for changes (known before who acts, and for an email contributor). */
  changesRequested?: string[];
}

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && norm(a) === norm(b));

/** The review tasks: someone else waits for the viewer's decision. The other tasks are the viewer's own branches. */
export const isReviewTask = (t: WaitTask | null | undefined): t is 'design' | 'ship' | 'guidance' | 'requested' => t === 'design' || t === 'ship' || t === 'guidance' || t === 'requested';

/** Whether the viewer may be waited on for a review at all: a reviewer, connected or in the demo seat. */
const reviews = (v: WaitViewer) => v.role === 'reviewer' && (Boolean(v.login) || Boolean(v.seat));

/** What the change asks of the viewer now, or null when it waits on someone else (or on nobody in the Studio). */
export function waitingOn(c: WaitChange, v: WaitViewer): WaitTask | null {
  if (c.exploration || c.lifecycle === 'shipped' || c.lifecycle === 'closed') return null;
  // Spec only, no code yet: a developer builds it with Claude. Nobody in the Studio is waited on, the designer least.
  if (claudeStage(c.labels) === 'waiting') return null;
  // Claude drafted the code: ready for review, whatever GitHub's draft flag says (core isDraft).
  const draft = isDraft(c);
  // Code only: no design decision waits on anyone in the Studio.
  if (c.nature === 'developer') return null;
  if (v.seat) {
    if (!reviews(v) || draft || c.lifecycle === 'draft' || c.lifecycle === 'waiting' || same(c.author, v.login)) return null;
    return c.guidance ? 'guidance' : 'requested';
  }
  const who = c.who;
  if (!v.login) return null;
  const author = same(c.author, v.login);
  if (author) {
    if (draft || c.lifecycle === 'draft') return null;
    if (who?.action === 'address-changes' || (c.changesRequested?.length ?? 0) > 0) return 'own-changes';
    // Contributors never merge; a reviewer's own approved branch is theirs to merge.
    if (who?.action === 'merge' && who.yourTurn && reviews(v)) return 'own-ship';
    // Anything else on the viewer's own branch waits on someone else: a reviewer, a developer for a technical
    // blocker, or the owner override, which the solo owner uses when they choose (never a review waiting on them).
    return null;
  }
  if (!who || !reviews(v)) return null;
  if (draft || c.lifecycle === 'draft' || c.lifecycle === 'waiting') return null;
  if (who.yourTurn) {
    if (who.action === 'merge') return 'ship';
    if (who.action === 'approve-design' || who.action === 'approve') return c.guidance ? 'guidance' : 'design';
    // Only someone the override names, and only when no other owner can approve (lib/changes whoActs).
    if (who.action === 'override' && who.logins.some((l) => same(l, v.login))) return c.guidance ? 'guidance' : 'design';
  }
  // Technical blockers and the tech review are developer work: never a designer's row, even when GitHub asks them.
  const technical = ['fix-checks', 'resolve-conflict', 'address-changes', 'mark-ready', 'promote', 'approve-tech', 'wait'];
  if (technical.includes(who.action)) return null;
  if ((c.requested ?? []).some((l) => same(l, v.login))) return 'requested';
  return null;
}

/** Whether the change waits on the viewer: the Branches "Waiting on me" filter. */
export const waitsOnMe = (c: WaitChange, v: WaitViewer): boolean => waitingOn(c, v) !== null;

/** How many changes wait on the viewer's review (not their own branches): the review count of the nav badge. */
export const reviewCount = (changes: WaitChange[], v: WaitViewer): number => changes.filter((c) => isReviewTask(waitingOn(c, v))).length;
