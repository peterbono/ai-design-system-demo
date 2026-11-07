// Who looks after the design system (Settings > Review, the validated board R2 "Review flow"): how a team approves an
// exploration before the developers. One setting per team, kept server side, read on every write that needs it.
//   one          "One person": the design leads approve (members made Design lead, and the design owners of
//                bridge.config.json). An admin may decide too, but is never asked: no email, no Needs you.
//   shared       "Shared, with review": every designer (Can edit) reviews the others' explorations, never their own.
//   shared-none  "Shared, no review": no lead step, explorations go to the developers (the PM gate comes with the
//                product manager). A change to the design system itself still needs another designer.
// Nobody approves their own exploration, in every mode. A team with nobody else to ask has no lead step: it would
// wait forever.
//
// Key (Upstash Redis, no expiry): bridge:review-mode:<owner/repo lower case>  one of the modes; absent reads `one`.

import type { Redis } from './redis.js';
import type { EmailMember } from './members.js';

export type ReviewMode = 'one' | 'shared' | 'shared-none';
export const REVIEW_MODES: readonly ReviewMode[] = ['one', 'shared', 'shared-none'];
export const DEFAULT_REVIEW_MODE: ReviewMode = 'one';

export const reviewModeKey = (repo: string) => `bridge:review-mode:${repo.toLowerCase()}`;
export const isReviewMode = (v: unknown): v is ReviewMode => typeof v === 'string' && (REVIEW_MODES as readonly string[]).includes(v);

export async function reviewModeOf(redis: Redis, repo: string): Promise<ReviewMode> {
  const v = await redis.cmd('GET', reviewModeKey(repo)).catch(() => null);
  return isReviewMode(v) ? v : DEFAULT_REVIEW_MODE;
}

export async function setReviewMode(redis: Redis, repo: string, mode: ReviewMode): Promise<void> {
  await redis.cmd('SET', reviewModeKey(repo), mode);
}

type Who = Pick<EmailMember, 'role' | 'lead'> | null | undefined;

/** An email member asked to review explorations (emails, Needs you, reminders): a design lead, or any designer when shared. Never an admin as such. */
export const askedToReview = (m: Who, mode: ReviewMode): boolean => Boolean(m && (m.lead || (mode === 'shared' && m.role === 'edit')));

/** An email member who may decide on someone else's exploration: whoever is asked, and an admin (super power, never asked). */
export const decidesOnExplorations = (m: Who, mode: ReviewMode): boolean => Boolean(m && (askedToReview(m, mode) || m.role === 'admin'));

/**
 * Whether an exploration goes through a review before the developers: there is someone other than its author to ask.
 * `designOwners` are the GitHub design owners (bridge.config.json) other than the author, `members` the email members
 * other than the author.
 */
export function needsReview(x: { mode: ReviewMode; designOwners: number; members: readonly Who[] }): boolean {
  if (x.mode === 'shared-none') return false;
  return x.designOwners > 0 || x.members.some((m) => askedToReview(m, x.mode));
}
