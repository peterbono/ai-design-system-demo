// The one status of an exploration, on every screen and in every count: the Home cards, the quiet greeting, the Home
// product folders, the product page groups and header, the Changes tabs and their counts, Being built and its tabs,
// and the exploration page. Each of them reads the stage here and only maps it to its own words or bucket; none of
// them derives a status of its own. Pure: no DOM, no fetch. Unit tested in exploration-state.test.ts.
//
// Precedence, first match wins:
//   1. The design pull request is merged: Shipped (In the next release while the library release lists it).
//   2. It is closed without merging: Closed (given up; lists leave it out).
//   3. It carries the `archived` label: Archived (out of the lists, its preview still alive).
//   4. It runs (the `exploration` label, Back to exploring, or a running one whose label is missing): Exploring. Back
//      to exploring closes the developers' task as not planned, so a running exploration never reads its task.
//   5. Done exploring was said and the developers' task (design copy explorations) was read: the task decides.
//      Closed as completed = Shipped, even while the design pull request stays open (it stays open on purpose: its
//      preview is how people come back to the prototype). Closed otherwise = Not planned. An open pull request of
//      the developers on it = In review (a draft one: Being built; the designer said it looks right: Approved,
//      waiting to ship). Someone assigned = Being built. Else Waiting to be picked up.
//   6. Done exploring without a task (the library, or a product in the library repository): the pull request decides.
//      Waiting to be picked up until developers push; then Being built while it is a draft nobody was asked to
//      review, In review once reviewers are asked or changes were requested.
//   7. Never handed off: a draft is still being tried (Exploring); otherwise it was promoted or sent: In review.
//
// The task's stage is read once per task (scripts/design-task.ts designTaskStages, cached a minute and shared) and
// passed in; before it is read, rule 6 stands in for it.
import { explorationStatus, isArchivedExploration, isHandedOff } from '@bridge-ds/core';
import { explorationLifecycle, reviewStateOf, type LifecyclePull, type LifecycleStage, type PullReviewLike } from './review-state';

export interface ExplorationStateInput {
  /** The design pull request, as GitHub lists it. */
  pull: LifecyclePull;
  /** The stage of the developers' task (lib/review-state taskStage), when the exploration has one and it was read. */
  task?: LifecycleStage | null;
  /** Reviews of the pull request, when read (lib/review-state needsReviewRead). */
  reviews?: readonly PullReviewLike[] | null;
  /** The design approvers, and who builds it: who a review waits on when nobody was asked by name. */
  approvers?: readonly string[];
  builders?: readonly string[];
  /** A merged library exploration the library release lists: In the next release. */
  nextRelease?: boolean;
}

/** The stages during which the developers have the exploration: the ones the task may replace (rule 5). */
const WITH_DEVELOPERS: ReadonlySet<LifecycleStage> = new Set<LifecycleStage>(['waiting-for-code', 'being-built', 'in-review', 'approved', 'not-planned']);

/**
 * Rule 5 on its own: the stage the pull request gives (`base`), replaced by the task's while the developers have the
 * exploration. Merged, closed, archived and running explorations keep their own stage whatever the task says.
 */
export function withDevTask(base: LifecycleStage, task: LifecycleStage | null | undefined): LifecycleStage {
  if (!task || !WITH_DEVELOPERS.has(base)) return base;
  // A task never runs, is never archived, and a closed one is either Shipped or Not planned (taskStage).
  if (task === 'exploring' || task === 'archived' || task === 'closed') return base;
  return task;
}

/** The one status of an exploration: the rules at the top of this file. */
export function explorationState(x: ExplorationStateInput): LifecycleStage {
  const p = x.pull;
  const merged = Boolean(p.merged_at) || p.state === 'merged';
  if (merged) return x.nextRelease ? 'next-release' : 'shipped';
  if (p.state !== 'open') return 'closed';
  const labels = (p.labels ?? []) as ({ name?: string } | string)[];
  const body = p.body ?? '';
  const status = explorationStatus({ state: p.state, merged_at: null, labels, headRef: p.head?.ref ?? undefined, headSha: p.head?.sha ?? undefined, body, draft: p.draft ?? undefined });
  // Rule 7: a draft never handed off and not running (a product branch started outside an exploration) is being tried.
  if (status === 'promoted' && p.draft && !isHandedOff({ labels, body }) && !isArchivedExploration(labels)) return 'exploring';
  const review = reviewStateOf({ draft: p.draft ?? null, requested: p.requested_reviewers ?? [], approvers: x.approvers ?? [], builders: x.builders ?? [], reviews: x.reviews ?? null });
  const base = explorationLifecycle({ status, archived: isArchivedExploration(labels), review });
  return withDevTask(base, x.task);
}

/** Done: shipped, in the next release, closed or not planned. Everything else is open work. */
export const isDoneStage = (s: LifecycleStage): boolean => s === 'shipped' || s === 'next-release' || s === 'closed' || s === 'not-planned';

/** Shipped, by a merge or by the developers' task. */
export const isShippedStage = (s: LifecycleStage): boolean => s === 'shipped' || s === 'next-release';
