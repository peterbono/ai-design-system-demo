// What waits on the connected viewer among the changes in review, shared by the Overview (Needs you, In flight) and
// the Changes nav badge in the shell, so both read the same rule (lib/overview-todo reviewNeedsYou) from the same
// statuses. Who acts now: lib/changes whoActs, with the owners, ship rights, teams and override from the config.
import { needFromStatus, whoActs, type WhoActs } from '../lib/changes';
import { oneLineTitle } from '../lib/markdown';
import { humanTitle } from '../lib/pr-title';
import { isGuidanceChange, reviewNeedsYou, type TodoChange } from '../lib/overview-todo';
import { reviewQueue } from '../lib/review-queue';
import { currentViewer, hasWorkingToken } from './github-session';
import { loadStatuses, owners, shippers, teamPeople, type PullForStatus, type PullStatus } from './pr-status';
import { loadTeams } from './teams';

export interface QueuePullFull extends PullForStatus {
  state: string;
  title: string;
  updated_at: string;
  assignees?: { login: string }[] | null;
}

/** Where the badge count is kept between pages, so the nav does not jump while GitHub answers. */
export const MINE_COUNT_KEY = 'bridge.reviews.mine';

const overrideBy = (): string[] => {
  try {
    return (JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { override?: { allowed?: string[] } }).override?.allowed ?? [];
  } catch {
    return [];
  }
};

/** Every owner login, both roles, teams expanded once read. */
export const siteOwners = () => {
  const o = owners();
  return [...new Set([...o.design, ...o.tech])];
};

/** Who acts now on a change, for the connected viewer (same rules as the change detail). */
export function whoFor(p: PullForStatus, st: PullStatus | null | undefined): WhoActs | null {
  return st
    ? whoActs(needFromStatus(st.kind, { failing: st.failing, changesRequestedBy: st.changesRequested }), {
        owners: owners(),
        shippers: shippers(),
        ...teamPeople(),
        overrideBy: overrideBy(),
        author: p.user.login,
        viewer: currentViewer()?.login ?? null,
        approvers: st.approvers,
      })
    : null;
}

/** A change of the queue as the to-do and the board read it. */
export function todoChange(p: QueuePullFull, st: PullStatus | null | undefined, visual: 'ready' | null = null): TodoChange & { author: string; assignees: string[] } {
  return {
    number: p.number,
    author: p.user.login,
    assignees: (p.assignees ?? []).map((a) => a.login),
    title: oneLineTitle(humanTitle(p.title)),
    who: whoFor(p, st),
    failing: st?.failing,
    failingChecks: st?.failingChecks,
    changesBy: st?.changesRequested,
    visual: st?.touchesVisuals === false ? 'none' : visual,
    guidance: isGuidanceChange(p.head.ref, st?.guidanceOnly),
  };
}

/** Remembers the badge count for the next page. */
export function rememberMine(n: number) {
  try {
    localStorage.setItem(MINE_COUNT_KEY, JSON.stringify({ n, at: new Date().toISOString(), viewer: currentViewer()?.login ?? null }));
  } catch {
    /* private mode: the badge waits for GitHub on the next page */
  }
}

/** The last count this browser saw, for the same viewer (undefined: whoever it was, before the check answers). */
export function rememberedMine(viewer?: string | null): number | null {
  if (viewer === null) return null;
  try {
    const v = JSON.parse(localStorage.getItem(MINE_COUNT_KEY) || 'null') as { n?: unknown; viewer?: unknown } | null;
    return v && typeof v.n === 'number' && (viewer === undefined || v.viewer === viewer) ? v.n : null;
  } catch {
    return null;
  }
}

/** Reads the statuses of the queue and counts what waits on the viewer. 0 signed out (nothing is read then). */
export async function loadReviewNeedsYou(pulls: QueuePullFull[]): Promise<number> {
  const viewer = currentViewer()?.login ?? null;
  if (!viewer || !hasWorkingToken()) return 0;
  await loadTeams();
  const queue = reviewQueue(pulls);
  const statuses = new Map<number, PullStatus | null>();
  await loadStatuses(queue, (p, st) => statuses.set(p.number, st));
  const n = reviewNeedsYou({ changes: queue.map((p) => todoChange(p, statuses.get(p.number))), viewer, owners: siteOwners() });
  rememberMine(n);
  return n;
}
