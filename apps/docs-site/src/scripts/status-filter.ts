// The lifecycle of a list row (lib/change-status), for the status pill on Branches (scripts/reviews.ts).
import { rowLifecycle, type Lifecycle } from '../lib/change-status';
import type { ReviewStatusKind, Tier } from '../lib/review-rules';
import type { WorkNature } from '../lib/work-nature';

/** What a list row knows to place itself in the lifecycle. */
export interface LifecycleRow {
  kind: ReviewStatusKind | null;
  nature: WorkNature;
  tier: Tier | null;
  draft?: boolean;
  /** `drafted-by-claude` reads a GitHub draft as ready for review (core isDraft). */
  labels?: { name: string }[];
  state?: string;
  merged_at?: string | null;
  design?: boolean;
  approvers?: string[];
  changesRequested?: string[];
  failing?: number;
  failingChecks?: string[];
}

export const lifecycleOfRow = (r: LifecycleRow): Lifecycle => rowLifecycle({ state: r.state ?? 'open', draft: r.draft, labels: r.labels, merged_at: r.merged_at }, r);
