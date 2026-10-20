// The review queue: which open pull requests wait for a review, and the words a designer reads about them. One
// source for every count in the Studio (Overview hero, the nav badge, the In review tab and History), so they never
// disagree. Pure: no DOM, no fetch. Unit tested in review-queue.test.ts.
//
// Left out of the queue:
//   - running explorations (Changes > Explorations: tried, never merged as is);
//   - GitHub automation: the changesets release pull request (branch changeset-release/*, opened by
//     github-actions[bot]). It is the release step, shown as the "Next release" card in History.
import { effectiveTier as coreEffectiveTier, isAutomationPull, isReleasePull, releasePull, reviewQueue, type QueuePull } from '@bridge-ds/core';
import { type LabelLike, type ReviewStatusKind, type Tier } from './review-rules';
import { branchCount } from './vocabulary';

// The queue rules live in @bridge-ds/core (review-gate.ts), shared with the MCP server and the CLI.
export { isAutomationPull, isReleasePull, releasePull, reviewQueue, type QueuePull };

// ---------------------------------------------------------------------------------------------------------------
// What approval a change needs, in words (no tier numbers on designer surfaces)

/** The approval a change needs (core effectiveTier): the tier the author set or the one the shared classifier computes, highest wins. */
export const effectiveTier = (labels: LabelLike[], body: string | null | undefined, files: { filename: string; status?: string }[] | null): Tier | null => coreEffectiveTier(labels, body, files);

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
  ready: ['is ready to merge', 'are ready to merge'],
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
 * "3 branches wait for design approval. 1 is blocked on the developer side." The first sentence names the noun,
 * the next ones only the count. At most three sentences; the rest folds into the last one ("2 more are ...").
 */
export function queueSentence(kinds: (ReviewStatusKind | null | undefined)[]): string {
  if (!kinds.length) return 'Nothing waits for a review.';
  const parts = queueBuckets(kinds);
  const shown = parts.length > 3 ? parts.slice(0, 2) : parts;
  const out = shown.map(({ bucket, n }, i) => {
    const verb = VERB[bucket][n === 1 ? 0 : 1];
    return i === 0 ? `${branchCount(n)} ${verb}.` : `${n} ${verb}.`;
  });
  if (parts.length > 3) {
    const rest = parts.slice(2).reduce((s, p) => s + p.n, 0);
    out.push(`${rest} more ${rest === 1 ? 'is' : 'are'} on the way.`);
  }
  return out.join(' ');
}

/** "4 branches in review." The count line, the same number as the nav badge and the In review tab. */
export function queueCountLine(n: number): string {
  return n === 0 ? 'Nothing waits for a review.' : `${branchCount(n)} in review.`;
}
