// One lifecycle, the same states and the same words on every Studio page (the exploration page, Being built, Changes,
// the home): Exploring, Waiting for code (Done exploring, nobody pushed), Being built (developers pushed, still a
// draft), In review (developers asked for a review, or changes were requested), Shipped (merged; a library change
// reads In the next release until the library version is published), Archived.
//
// The review is read from the pull request: who is asked (the requested reviewers, else the team's design approvers),
// each reviewer's last say (approved or changes requested; changes requested wins, as on GitHub), and the draft flag.
// The reviews themselves (GET pulls/{n}/reviews) are read only for open, handed-off pull requests that are not drafts
// (needsReviewRead): a few per page, never one per row. Pure: no DOM, no fetch. Tested in review-state.test.ts.
import { DESIGN_TASK_BACK_COMMENT, explorationStatus, isArchivedExploration, isExplorationPull, parseExplorationBody, type ExplorationStatus } from '@bridge-ds/core';

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
export type LifecycleStage = 'exploring' | 'waiting-for-code' | 'being-built' | 'in-review' | 'approved' | 'next-release' | 'shipped' | 'archived' | 'closed' | 'not-planned';

/** The words of each stage: the tab, the tag and the line say the same. */
export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  exploring: 'Exploring',
  'waiting-for-code': 'Waiting to be picked up',
  'being-built': 'Being built',
  'in-review': 'In review',
  // A design copy exploration the designer said looks right on: the developers ship it next.
  approved: 'Approved, waiting to ship',
  'next-release': 'In the next release',
  shipped: 'Shipped',
  archived: 'Archived',
  closed: 'Closed',
  // The developers closed their task without building it (a design copy exploration still handed off).
  'not-planned': 'Not planned',
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

/** The developers' task Done exploring opened from the design team's copy, as one read of the issue returns it. */
export interface DesignTaskRead {
  assignees: readonly { login: string }[];
  state: string;
  stateReason: string | null;
  closedAt: string | null;
  /** The developers' open pull request that links the task (devPullOfTimeline), when one was read. */
  devPull?: DevPull | null;
  /** The task's label names (a `needs-design` label asks the designer something). */
  labels?: readonly string[];
  /** The comments on the task since Done exploring, oldest first: read once, only when the task has any. */
  comments?: readonly TaskCommentLike[] | null;
  /**
   * Shipped: who said it looks right on the developers' merged pull request (Bridge's design review comment), read
   * once and kept, so the Reviewed step still names them.
   */
  shippedAnswer?: { kind: 'looks-right' | 'changes'; login: string } | null;
}

/** A comment on the developers' task, the fields Bridge reads (GET issues/{n}/comments). */
export interface TaskCommentLike {
  body?: string | null;
  user?: { login?: string; type?: string } | null;
  created_at?: string;
}

/** The label developers put on their task when they need the designer's input. */
export const NEEDS_DESIGN_LABEL = 'needs-design';

/** A reply Bridge posted for someone without GitHub (api/contribute prefixes it with their name). */
const VIA_BRIDGE = /^\*\*[^*\n]{1,120}\*\* \(via Bridge\):/;

/** Bridge's own words on the task (an app or bot account, a design review, a member's reply, taking it back). */
const fromBridge = (c: TaskCommentLike) => {
  const login = c.user?.login ?? '';
  const body = (c.body ?? '').trim();
  return isBot(login) || c.user?.type === 'Bot' || body.startsWith(DESIGN_REVIEW_PREFIX) || VIA_BRIDGE.test(body) || body === DESIGN_TASK_BACK_COMMENT;
};

/** What the developers asked the designer on their task, and whether the designer answered since. */
export interface DevQuestion {
  /** Their words, as plain text; null when only the `needs-design` label asks. */
  text: string | null;
  /** Who asked (a GitHub login), and when; null for the label alone. */
  login: string | null;
  at: string | null;
  /** The designer (or Bridge for them) wrote on the task after it. */
  answered: boolean;
}

/**
 * The developers' question on an open design task: the latest comment posted after Done exploring by someone who is
 * neither Bridge (its app, a bot, a reply it posted for a member) nor the designer (`designers`: logins). Answered once
 * a later comment is there (by construction the designer's, or Bridge's for them). A `needs-design` label with no
 * such comment asks too, with no words. Null when nothing asks.
 */
export function devQuestionOf(t: Pick<DesignTaskRead, 'state' | 'labels' | 'comments'>, opts: { doneAt?: string | null; designers?: readonly (string | null | undefined)[] } = {}): DevQuestion | null {
  if (t.state !== 'open') return null;
  const designers = new Set((opts.designers ?? []).filter((l): l is string => Boolean(l)).map(lower));
  const since = opts.doneAt ?? '';
  const after = (t.comments ?? []).filter((c) => !since || (c.created_at ?? '') > since);
  const isQuestion = (c: TaskCommentLike) => !fromBridge(c) && Boolean(c.user?.login) && !designers.has(lower(c.user!.login!)) && Boolean((c.body ?? '').trim());
  let i = after.length - 1;
  while (i >= 0 && !isQuestion(after[i]!)) i--;
  if (i >= 0) {
    const c = after[i]!;
    return { text: plainText(c.body ?? ''), login: c.user!.login!, at: c.created_at ?? null, answered: i < after.length - 1 };
  }
  if ((t.labels ?? []).some((l) => l.toLowerCase() === NEEDS_DESIGN_LABEL)) return { text: null, login: null, at: null, answered: after.length > 0 };
  return null;
}

/**
 * The asker's part on the team, when Bridge knows it from the team's settings: a design lead (governance.owners.design)
 * or a tech lead (owners.tech), teams expanded by the caller (scripts/teams siteApprovers). Null otherwise: Bridge never
 * guesses a role from where someone wrote, so a question on the developers' task is not "the developers'" by default.
 */
export function askerRole(login: string | null | undefined, owners: { design?: readonly string[]; tech?: readonly string[] } | null | undefined): 'design lead' | 'tech lead' | null {
  if (!login || !owners) return null;
  const k = lower(login.trim());
  const has = (list?: readonly string[]) => (list ?? []).some((e) => !e.includes('/') && lower(e.trim()) === k);
  if (has(owners.design)) return 'design lead';
  if (has(owners.tech)) return 'tech lead';
  return null;
}

/**
 * The line for a question on a design task, naming who asked: "Florian, design lead, asked a question" when Bridge
 * knows their part, "Florian asked a question" otherwise. A `needs-design` label alone names nobody: "Your input is
 * needed". Never "the developers" by default: the asker may be anyone on the team.
 */
export function questionLine(by: { name: string } | null | undefined, role?: string | null): string {
  const name = by?.name?.trim();
  if (!name) return 'Your input is needed';
  return role ? `${name}, ${role}, asked a question` : `${name} asked a question`;
}

/**
 * The developers' last word on a task they closed without building it: their latest comment that is neither Bridge's
 * nor the designer's (plain text, who and when). Null when they closed it without a word.
 */
export function declineNoteOf(t: Pick<DesignTaskRead, 'comments'>, opts: { designers?: readonly (string | null | undefined)[] } = {}): { text: string; login: string; at: string | null } | null {
  const designers = new Set((opts.designers ?? []).filter((l): l is string => Boolean(l)).map(lower));
  const list = t.comments ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    const login = c.user?.login;
    if (!login || fromBridge(c) || designers.has(lower(login)) || !(c.body ?? '').trim()) continue;
    return { text: plainText(c.body ?? ''), login, at: c.created_at ?? null };
  }
  return null;
}

/**
 * A comment as plain words: no HTML comments or tags, no Markdown images, links kept as their words, code fences and
 * emphasis marks dropped, at most two line breaks in a row. React renders it as text: nothing here is ever HTML.
 */
export function plainText(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Whether the developers closed their task without building it (any close but done). */
export const taskDeclined = (t: Pick<DesignTaskRead, 'state' | 'stateReason'>): boolean => t.state === 'closed' && t.stateReason !== 'completed';

/** The developers' pull request for a design task: in their repository, linked to the task. */
export interface DevPull {
  number: number;
  url: string;
  /** Its branch, once the pull request itself was read: its preview is built from it. */
  headRef?: string | null;
  draft?: boolean;
  /** The deployment GitHub lists for its head (environment_url), when Vercel reported one. */
  deployedUrl?: string | null;
  /** The designer's last answer Bridge posted on it (designReviewOf), when it was read. */
  answer?: { kind: 'looks-right' | 'changes'; login: string } | null;
}

/**
 * Where the developers' version opens: the deployment GitHub lists for their head first, else the product's own preview
 * pattern (the developers' repository, never the design team's copy) filled with their branch.
 */
export function devVersionUrl(pull: Pick<DevPull, 'headRef' | 'deployedUrl'>, productPreview: string | undefined, fill: (template: string | undefined, branch: string) => string | null): string | null {
  const deployed = pull.deployedUrl?.trim();
  if (deployed && /^https:\/\//.test(deployed)) return deployed;
  return pull.headRef ? fill(productPreview, pull.headRef) : null;
}

/** One event of an issue's timeline, the fields devPullOfTimeline reads (GitHub's cross-referenced shape). */
export interface TimelineEventLike {
  event?: string;
  source?: {
    type?: string;
    issue?: { number?: number; html_url?: string; state?: string; draft?: boolean; pull_request?: { merged_at?: string | null } | null; repository?: { full_name?: string } | null } | null;
  } | null;
}

/**
 * The developers' pull request that links a design task, from the task's timeline: the newest open pull request of
 * the developers' repository that mentions the task ("Closes #7" or its URL). Null when none is open.
 */
export function devPullOfTimeline(events: readonly TimelineEventLike[], devRepo: string, opts: { merged?: boolean } = {}): DevPull | null {
  const repo = devRepo.trim().toLowerCase();
  let found: DevPull | null = null;
  for (const e of events) {
    if (e.event !== 'cross-referenced') continue;
    const i = e.source?.issue;
    // `merged`: the one that shipped it instead (a shipped task's review, read once).
    if (!i?.pull_request || (opts.merged ? !i.pull_request.merged_at : i.state !== 'open' || i.pull_request.merged_at)) continue;
    if ((i.repository?.full_name ?? '').toLowerCase() !== repo || !i.number || !i.html_url) continue;
    found = { number: i.number, url: i.html_url, ...(i.draft !== undefined ? { draft: i.draft } : {}) };
  }
  return found;
}

/**
 * Where a design copy exploration stands from its task, in the lifecycle's words: closed as done = Shipped, closed
 * otherwise = Not planned (the developers declined it; Bridge's own Back to exploring also closes it so, but then the
 * exploration runs again and every caller reads that first), an open pull request of the developers on it = In review
 * (their version is ready for the designer's eyes; a draft stays Being built; once the designer said it looks right,
 * Approved, waiting to ship), someone assigned = Being built, else Waiting to be picked up.
 */
export function taskStage(t: DesignTaskRead): LifecycleStage {
  const s = taskStatus(t);
  if (s === 'shipped') return 'shipped';
  if (s === 'closed') return 'not-planned';
  if (t.devPull) return t.devPull.draft ? 'being-built' : t.devPull.answer?.kind === 'looks-right' ? 'approved' : 'in-review';
  return s === 'building' ? 'being-built' : 'waiting-for-code';
}

/** The Review step of a design copy exploration, while the developers' version waits for the designer's eyes. */
export const DEV_VERSION_READY = "The developers' version is ready for your eyes";

/** The Review line of a design copy exploration in lists: the designer's answer once given, else the version waits. */
export function devReviewLine(pull: Pick<DevPull, 'answer'>, nameOf: (login: string) => string): string {
  const a = pull.answer;
  if (!a?.login) return DEV_VERSION_READY;
  return `${nameOf(a.login)} ${a.kind === 'looks-right' ? 'said it looks right' : 'asked for changes'}`;
}

/** The designer's answer on the developers' version, as Bridge posts it on their pull request. */
export type DesignAnswer = { kind: 'looks-right' } | { kind: 'changes'; text: string };

/** The first words of every design review Bridge posts: how Bridge finds the last answer again. */
export const DESIGN_REVIEW_PREFIX = 'Design review from Bridge:';

/** The comment Bridge posts on the developers' pull request, in their words. */
export function designReviewComment(a: DesignAnswer): string {
  return a.kind === 'looks-right' ? `${DESIGN_REVIEW_PREFIX} looks right.` : `${DESIGN_REVIEW_PREFIX} needs changes: ${a.text.trim()}`;
}

/** The last design review Bridge posted on a pull request (its comments, oldest first): who answered what, and when. */
export function designReviewOf(comments: readonly { body?: string | null; user?: { login?: string } | null; created_at?: string }[]): { kind: 'looks-right' | 'changes'; login: string; text: string | null; at: string } | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i]!;
    const body = (c.body ?? '').trim();
    if (!body.startsWith(DESIGN_REVIEW_PREFIX)) continue;
    const rest = body.slice(DESIGN_REVIEW_PREFIX.length).trim();
    const login = c.user?.login ?? '';
    const at = c.created_at ?? '';
    if (/^looks right\.?$/i.test(rest)) return { kind: 'looks-right', login, text: null, at };
    const m = /^needs changes:\s*([\s\S]*)$/i.exec(rest);
    if (m) return { kind: 'changes', login, text: m[1]!.trim() || null, at };
  }
  return null;
}

/**
 * Where a design copy exploration stands from its task in the developers' repository: closed as done = shipped,
 * closed otherwise = closed (not planned), someone assigned = building, else ready (waiting to be picked up).
 */
export function taskStatus(t: DesignTaskRead): 'ready' | 'building' | 'shipped' | 'closed' {
  if (t.state === 'closed') return t.stateReason === 'completed' ? 'shipped' : 'closed';
  return t.assignees.length ? 'building' : 'ready';
}
