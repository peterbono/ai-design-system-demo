// Changes > All changes: the status filter (All open, Draft, Ready for review, Approved waiting for code, Shipped,
// Closed) and the row chip of each lifecycle state (lib/change-status), in one DS Select (StatusFilterSelect). The filter lives
// in the address as ?status=. Shipped and Closed read the recently closed pull requests once, only when picked.
import { LIFECYCLE, lifecycleTone, PILL_OF, rowLifecycle, STATUS_FILTER_EVENT, STATUS_SYNC_EVENT, statusFilterParam, waitingSentence, type Lifecycle, type StatusFilter } from '../lib/change-status';
import { namesFor } from '../lib/changes';
import type { ReviewStatusKind, Tier } from '../lib/review-rules';
import type { WorkNature } from '../lib/work-nature';
import { esc } from './github-session';
import { teamPeople } from './pr-status';
import { siteApprovers } from './teams';

/** What a list row knows to place itself in the lifecycle. */
export interface LifecycleRow {
  kind: ReviewStatusKind | null;
  nature: WorkNature;
  tier: Tier | null;
  draft?: boolean;
  state?: string;
  merged_at?: string | null;
  design?: boolean;
  approvers?: string[];
  changesRequested?: string[];
  failing?: number;
  failingChecks?: string[];
}

export const lifecycleOfRow = (r: LifecycleRow): Lifecycle => rowLifecycle({ state: r.state ?? 'open', draft: r.draft, merged_at: r.merged_at }, r);

/**
 * The row chip of a state the review flow does not explain: Draft, Waiting for code, Shipped, Closed (same pill as the
 * other rows, the same words as the status line). Null for Ready for review: the who-acts chip says more.
 */
export function lifecycleChip(r: LifecycleRow): string | null {
  const l = lifecycleOfRow(r);
  if (l === 'ready') return null;
  let tip = '';
  if (l === 'waiting') {
    const tech = siteApprovers().tech.map((x) => x.replace(/^@/, ''));
    tip = waitingSentence({ failing: r.failing ?? r.failingChecks?.length ?? 0, techOwners: tech.length ? namesFor('tech', tech, teamPeople()) : null });
  }
  return `<span class="pill rv-status ${PILL_OF[lifecycleTone(l)]}" data-lifecycle="${l}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(LIFECYCLE[l].label)}</span>`;
}

const root = () => document.querySelector<HTMLElement>('.cg');

export const currentStatus = (): StatusFilter => (root()?.dataset.status as StatusFilter | undefined) ?? 'open';

function apply(f: StatusFilter) {
  const r = root();
  if (!r) return;
  if (f === 'open') delete r.dataset.status;
  else r.dataset.status = f;
  document.dispatchEvent(new CustomEvent(STATUS_SYNC_EVENT, { detail: f }));
}

/** Reads ?status= and follows the control. `repaint` paints the list again under the new filter. */
export function initStatusFilter(repaint: () => void) {
  apply(statusFilterParam(location.search));
  const pick = (value: string) => {
    const f = statusFilterParam(`?status=${value}`);
    apply(f);
    const url = new URL(location.href);
    if (f === 'open') url.searchParams.delete('status');
    else url.searchParams.set('status', f);
    history.replaceState(history.state, '', url);
    repaint();
  };
  document.addEventListener(STATUS_FILTER_EVENT, (e) => pick((e as CustomEvent<string>).detail));
}
