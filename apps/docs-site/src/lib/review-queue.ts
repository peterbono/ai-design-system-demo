// The review queue: which open pull requests wait for a review, and the words a designer reads about them. One
// source for every count in the Studio (Overview hero, the nav badge, the In review tab and History), so they never
// disagree. Pure: no DOM, no fetch. Unit tested in review-queue.test.ts.
//
// Left out of the queue:
//   - running explorations (Changes > Explorations: tried, never merged as is);
//   - GitHub automation: the changesets release pull request (branch changeset-release/*, opened by
//     github-actions[bot]). It is the release step, shown as the "Next release" card in History.
import { classifyRisk } from '@bridge-ds/core';
import { isRunningExploration } from './explorations-view';
import { openPulls, parseTier, type LabelLike, type PullStateLike, type ReviewStatusKind, type Tier } from './review-rules';

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

/** The open pull requests that wait for a review, in the order given. Every count in the Studio comes from here. */
export function reviewQueue<P extends QueuePull>(pulls: P[]): P[] {
  return openPulls(pulls).filter((p) => !isAutomationPull(p) && !isRunningExploration({ state: p.state, labels: (p.labels ?? []) as never }));
}

/** The open release pull request, if the changesets action opened one. */
export function releasePull<P extends QueuePull>(pulls: P[]): P | null {
  return openPulls(pulls).find((p) => isReleasePull(p)) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// What approval a change needs, in words (no tier numbers on designer surfaces)

/**
 * The approval a change needs, the same rule everywhere (list and detail): the tier the author set (label, PR
 * template checkbox or "Risk tier" line) or the one the shared classifier computes from the changed files, highest
 * wins. Without files (not read yet) only a label counts, and a missing label stays unknown.
 */
export function effectiveTier(labels: LabelLike[], body: string | null | undefined, files: { filename: string; status?: string }[] | null): Tier | null {
  const labelled = parseTier(labels, body);
  if (!files) return labelled;
  const computed = classifyRisk({ files: files.map((f) => ({ path: f.filename, status: f.status })) }).tier;
  return Math.max(labelled ?? 0, computed) as Tier;
}

/** Plain words for the approval a tier needs. Never colored: color is for status. Empty while unknown. */
export function approvalNeedLabel(tier: Tier | null | undefined): string {
  if (tier === 2 || tier === 3) return 'Design + tech';
  if (tier === 1) return 'One approval';
  return '';
}

/** The longer form, for filters: what kind of change and what it needs. */
export function approvalNeedLong(tier: Tier | null | undefined): string {
  if (tier === 3) return 'Token changes, design + tech approval';
  if (tier === 2) return 'Component changes, design + tech approval';
  if (tier === 1) return 'Docs fixes, one approval';
  return 'Any change';
}

// ---------------------------------------------------------------------------------------------------------------
// The queue in one or two sentences (Overview hero)

type Bucket = 'design' | 'tech' | 'approval' | 'ready' | 'author' | 'developer' | 'draft' | 'checking';

const BUCKET: Partial<Record<ReviewStatusKind, Bucket>> = {
  'needs-design': 'design',
  'needs-tech': 'tech',
  'needs-approval': 'approval',
  ready: 'ready',
  'changes-requested': 'author',
  'ci-failing': 'developer',
  conflict: 'developer',
  draft: 'draft',
};

const ORDER: Bucket[] = ['design', 'tech', 'approval', 'ready', 'author', 'developer', 'draft', 'checking'];

const VERB: Record<Bucket, [one: string, many: string]> = {
  design: ['waits for design approval', 'wait for design approval'],
  tech: ['waits for tech approval', 'wait for tech approval'],
  approval: ['waits for one approval', 'wait for one approval'],
  ready: ['is ready to ship', 'are ready to ship'],
  author: ['waits for its author to answer a review', 'wait for their authors to answer a review'],
  developer: ['is blocked on the developer side', 'are blocked on the developer side'],
  draft: ['is still a draft', 'are still drafts'],
  checking: ['is still being checked', 'are still being checked'],
};

/** How many changes sit in each state, from their status kinds (null: not read yet). */
export function queueBuckets(kinds: (ReviewStatusKind | null | undefined)[]): { bucket: Bucket; n: number }[] {
  const counts = new Map<Bucket, number>();
  for (const k of kinds) {
    const b = (k && BUCKET[k]) || 'checking';
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return ORDER.filter((b) => counts.has(b)).map((bucket) => ({ bucket, n: counts.get(bucket)! }));
}

/**
 * "3 changes wait for design approval. 1 is blocked on the developer side." The first sentence names the noun,
 * the next ones only the count. At most three sentences; the rest folds into the last one ("2 more are ...").
 */
export function queueSentence(kinds: (ReviewStatusKind | null | undefined)[]): string {
  if (!kinds.length) return 'Nothing waits for a review.';
  const parts = queueBuckets(kinds);
  const shown = parts.length > 3 ? parts.slice(0, 2) : parts;
  const out = shown.map(({ bucket, n }, i) => {
    const verb = VERB[bucket][n === 1 ? 0 : 1];
    return i === 0 ? `${n} ${n === 1 ? 'change' : 'changes'} ${verb}.` : `${n} ${verb}.`;
  });
  if (parts.length > 3) {
    const rest = parts.slice(2).reduce((s, p) => s + p.n, 0);
    out.push(`${rest} more ${rest === 1 ? 'is' : 'are'} on the way.`);
  }
  return out.join(' ');
}

/** "4 changes in review." The count line, the same number as the nav badge and the In review tab. */
export function queueCountLine(n: number): string {
  return n === 0 ? 'Nothing waits for a review.' : `${n} ${n === 1 ? 'change' : 'changes'} in review.`;
}
