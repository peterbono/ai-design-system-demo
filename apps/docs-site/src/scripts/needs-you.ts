// What waits on the connected viewer among the changes in review, shared by the Overview (Needs you, In flight) and
// the Branches nav badge in the shell, so both read the one rule of lib/waiting-on from the same statuses. Who acts
// now: pr-status rowWho (lib/changes whoActs), with the owners, ship rights, teams, solo owner and override.
import { type WhoActs } from '../lib/changes';
import { oneLineTitle } from '../lib/markdown';
import { humanTitle } from '../lib/pr-title';
import { isGuidanceChange, type TodoChange } from '../lib/overview-todo';
import { reviewCount, type ViewerRole, type WaitChange } from '../lib/waiting-on';
import { holdsReviewRight } from '../lib/home-model';
import { reviewQueue } from '../lib/review-queue';
import { currentAccess, currentContributor, currentViewer, hasWorkingToken } from './github-session';
import { loadStatuses, owners, rowWho, shippers, type PullForStatus, type PullStatus } from './pr-status';
import { loadTeams } from './teams';
import { loadSuggestionNeeds } from './suggestions';
import { agentMade, workNature, type VisualSignal } from '../lib/work-nature';
import { rowLifecycle } from '../lib/change-status';

export interface QueuePullFull extends PullForStatus {
  state: string;
  title: string;
  updated_at: string;
  assignees?: { login: string }[] | null;
}

/** Where the badge count is kept between pages, so the nav does not jump while GitHub answers. */
export const MINE_COUNT_KEY = 'bridge.reviews.mine';

/** Every owner login, both roles, teams expanded once read. */
export const siteOwners = () => {
  const o = owners();
  return [...new Set([...o.design, ...o.tech])];
};

/** Who acts now on a change, for the connected viewer: the same people as the change detail and the Branches rows (rowWho). */
export function whoFor(p: PullForStatus, st: PullStatus | null | undefined): WhoActs | null {
  return st ? rowWho(st.kind, { author: p.user.login, labels: p.labels, approvers: st.approvers, changesRequested: st.changesRequested, failing: st.failing, failingChecks: st.failingChecks, pending: st.pending }) : null;
}

/**
 * Whether the connected viewer holds a review right (lib/home-model holdsReviewRight): the role every "waiting on me"
 * surface passes to lib/waiting-on. An email contributor never does.
 */
export function viewerRole(): ViewerRole {
  const viewer = currentViewer()?.login ?? null;
  const contributor = Boolean(currentContributor()) || currentAccess()?.contributor === true;
  return holdsReviewRight({ viewer, contributor, approvers: [...owners().design, ...owners().tech], shippers: shippers(), write: currentAccess()?.write ?? null }) ? 'reviewer' : 'contributor';
}

/** A change as lib/waiting-on reads it. */
export function waitChange(p: QueuePullFull & { draft?: boolean; requested_reviewers?: { login: string }[] | null }, c: TodoChange): WaitChange {
  return { author: p.user.login, draft: p.draft, labels: p.labels, nature: c.nature, guidance: c.guidance, lifecycle: c.lifecycle, who: c.who, requested: (p.requested_reviewers ?? []).map((r) => r.login), changesRequested: c.changesBy, autoShip: c.autoShip };
}

/**
 * A change of the queue as the to-do and the board read it. `impact`: what the visual impact run says for the latest
 * version, when read; the nature (design or developer work, lib/work-nature) reads it with the title, labels and files.
 */
export function todoChange(p: QueuePullFull, st: PullStatus | null | undefined, visual: 'ready' | null = null, impact: VisualSignal = null): TodoChange & { author: string; assignees: string[] } {
  const title = oneLineTitle(humanTitle(p.title));
  const guidance = isGuidanceChange(p.head.ref, st?.guidanceOnly);
  const nature = workNature({ title, labels: p.labels ?? null, files: st?.files ?? null, visual: impact ?? (st?.touchesVisuals ? 'pending' : null), guidance }).nature;
  return {
    number: p.number,
    ...(st?.autoShip ? { autoShip: true } : {}),
    author: p.user.login,
    assignees: (p.assignees ?? []).map((a) => a.login),
    title,
    nature,
    // The same lifecycle as the Changes list and the change status line, once the status is read.
    lifecycle: st ? rowLifecycle(p, { ...st, nature, tier: st.tier ?? null }) : undefined,
    agent: agentMade({ body: p.body ?? null, labels: p.labels ?? null }),
    who: whoFor(p, st),
    failing: st?.failing,
    failingChecks: st?.failingChecks,
    changesBy: st?.changesRequested,
    visual: st?.touchesVisuals === false ? 'none' : visual,
    guidance,
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

/**
 * Reads the statuses of the queue and counts what waits on the viewer, suggestions included (the same list as Home
 * and the review queue, scripts/suggestions.ts). 0 signed out (nothing is read then).
 */
export async function loadReviewNeedsYou(pulls: QueuePullFull[]): Promise<number> {
  const viewer = currentViewer()?.login ?? null;
  if (!viewer || !hasWorkingToken()) return 0;
  await loadTeams();
  const queue = reviewQueue(pulls);
  const statuses = new Map<number, PullStatus | null>();
  const suggestions = loadSuggestionNeeds().catch(() => []);
  await loadStatuses(queue, (p, st) => statuses.set(p.number, st));
  // The one rule (lib/waiting-on): the same count as the Home's review rows and the Review page.
  const role = viewerRole();
  const branches = reviewCount(
    queue.map((p) => waitChange(p, todoChange(p, statuses.get(p.number)))),
    { login: viewer, role },
  );
  const n = branches + (role === 'reviewer' ? (await suggestions).length : 0);
  rememberMine(n);
  return n;
}
