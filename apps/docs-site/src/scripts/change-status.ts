// The status line of a change (Changes > a change): which lifecycle state it is in (lib/change-status), the sentence,
// and its one action: Mark as ready (GraphQL markPullRequestReadyForReview), Reopen this change (REST state: open),
// Start again from this change (its token edits into the draft, then Tokens proposes them as a new change). Back to
// draft (GraphQL convertPullRequestToDraft) sits in the More menu. scripts/reviews.ts paints the header and calls in.
import type { Root } from 'react-dom/client';
import { reopenOnGitHub } from '@bridge-ds/core';
import type { TokenReview } from '../lib/token-review';
import {
  changeLifecycle,
  designApprovalIn,
  draftFromTokenSets,
  LIFECYCLE,
  lifecycleSentence,
  lifecycleTone,
  reopenEligibility,
  restartLine,
  statusAction,
  ACTION_LABEL,
  waitingForCode,
  waitingSentence,
  type Lifecycle,
  type LifecycleTone,
  type ReopenEligibility,
} from '../lib/change-status';
import type { CheckStory, ClassifiedCheck } from '../lib/check-explain';
import { namesFor } from '../lib/changes';
import { pullState, type ApprovalSummary, type Tier } from '../lib/review-rules';
import { workNature } from '../lib/work-nature';
import { humanTitle } from '../lib/pr-title';
import { mdTitleText } from '../lib/markdown';
import { currentViewer, esc, GitHubError, ghGet, readRepo, studioClient } from './github-session';
import { siteApprovers } from './teams';
import { teamPeople } from './pr-status';
import { tokenSetsOf } from './reviews/token-review';
import { studioHref } from '../lib/team-path';

export interface StatusPull {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  labels: { name: string }[];
  user: { login: string };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string; sha: string };
  mergeable?: boolean | null;
}

export interface DetailStatus {
  lifecycle: Lifecycle;
  label: string;
  tone: LifecycleTone;
  sentence: string;
  yourTurn: boolean;
}

/**
 * The lifecycle of the open change and its sentence. `sentence` and `yourTurn` are what the review flow already says
 * (whoActs, failingSentence): Ready for review keeps them; waiting for code, draft, shipped and closed say their own.
 */
export function detailStatus(x: {
  pull: StatusPull;
  tier: Tier | null;
  approvals: ApprovalSummary;
  story: CheckStory;
  checks: ClassifiedCheck[];
  files: string[];
  exploration: boolean;
  isAuthor: boolean;
  sentence: string;
  yourTurn: boolean;
}): DetailStatus {
  const state = pullState(x.pull);
  const nature = workNature({ title: humanTitle(mdTitleText(x.pull.title)), labels: x.pull.labels, files: x.files }).nature;
  const waiting = waitingForCode({
    state,
    exploration: x.exploration,
    nature,
    designApproved: designApprovalIn(x.tier, x.approvals),
    changesRequested: x.approvals.changesRequested.length,
    failing: x.checks,
  });
  const lifecycle = changeLifecycle({ state, waiting });
  const base = { lifecycle, label: LIFECYCLE[lifecycle].label, tone: lifecycleTone(lifecycle) };
  if (lifecycle === 'waiting') {
    const tech = siteApprovers().tech.map((l) => l.replace(/^@/, ''));
    const names = tech.length ? namesFor('tech', tech, teamPeople()) : null;
    const viewer = currentViewer()?.login?.toLowerCase();
    const viewerIsTech = Boolean(viewer && tech.some((l) => l.toLowerCase() === viewer));
    return { ...base, sentence: waitingSentence({ failing: x.story.developerFailing, oldValue: x.story.oldValue, techOwners: names, viewerIsTech }), yourTurn: viewerIsTech };
  }
  const own = lifecycleSentence({ lifecycle, isAuthor: x.isAuthor, author: x.pull.user.login, mergedAt: x.pull.merged_at, closedAt: x.pull.closed_at, exploration: x.exploration });
  return { ...base, sentence: own ?? x.sentence, yourTurn: lifecycle === 'ready' || (lifecycle === 'draft' && x.exploration) ? x.yourTurn : false };
}

/** Server-free first paint of the status line, replaced by the DS island once it loads. */
export const statusFallback = (s: DetailStatus) => `<p class="cg-pr-who" data-who="${s.yourTurn ? 'you' : ''}">${esc(s.sentence)}</p>`;

/** Whether the head branch of a closed change is still there. A fork that is gone, or a 404, means it was removed. */
async function branchState(pull: StatusPull): Promise<'exists' | 'gone' | 'unknown'> {
  const { owner, repo } = readRepo();
  if (!pull.head.repo) return 'gone';
  if (pull.head.repo.full_name !== `${owner}/${repo}`) return 'unknown';
  try {
    await ghGet(`/repos/${owner}/${repo}/branches/${encodeURIComponent(pull.head.ref)}`);
    return 'exists';
  } catch (err) {
    return err instanceof GitHubError && err.status === 404 ? 'gone' : 'unknown';
  }
}

let root: Root | null = null;
/** A line to say after the detail repaints (the action reloads the change, which remounts the line). */
let pending = '';

export function unmountStatus() {
  root?.unmount();
  root = null;
}

const DRAFT_KEY = 'bridge.draft.v1';

function draftBusy(): boolean {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as { edits?: unknown[] } | null;
    return Boolean(d?.edits?.length);
  } catch {
    return false;
  }
}

/** Start again: the token edits of the closed change become the browser draft, then Tokens opens its review. */
async function restart(pull: StatusPull): Promise<string> {
  const { owner, repo } = readRepo();
  const sets = await tokenSetsOf({ owner, repo, baseSha: pull.base.sha, headSha: pull.head.sha });
  const r = draftFromTokenSets(sets.base, sets.head);
  const line = restartLine({ carried: r.carried, skipped: r.skipped, draftBusy: draftBusy() });
  if (!line.ok) throw new Error(line.text);
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(r.draft));
  } catch {
    throw new Error('This browser does not keep drafts (private mode or storage full). Allow site storage, then try again.');
  }
  document.dispatchEvent(new CustomEvent('bridge:draft'));
  setTimeout(() => location.assign(studioHref('tokens/#review')), 1200);
  return line.text;
}

/** The one lifecycle action of a change (Request review, Reopen, Start again), ready to run, and its sentence. */
export interface StatusActionRun {
  kind: Exclude<ReturnType<typeof statusAction>, null> | null;
  sentence: string;
  run: (() => Promise<string | void>) | null;
}

/**
 * What the status line used to mount, without mounting: the action of this state and how to run it. `reload`
 * repaints the change after a write. `review` is the token review of the change (Start again needs token edits).
 */
export async function statusActionFor(
  s: DetailStatus,
  x: { pull: StatusPull; isAuthor: boolean; canWrite: boolean; viewer: string | null; exploration: boolean; review: TokenReview | null; reload: () => Promise<void> },
): Promise<StatusActionRun> {
  const { pull } = x;
  let reopen: ReopenEligibility = { kind: 'none' };
  let sentence = s.sentence;
  if (s.lifecycle === 'closed' && x.viewer) {
    const o = siteApprovers();
    reopen = reopenEligibility({ state: 'closed', viewer: x.viewer, author: pull.user.login, owners: [...o.design, ...o.tech], canWrite: x.canWrite, branch: await branchState(pull) });
    sentence = lifecycleSentence({ lifecycle: 'closed', isAuthor: x.isAuthor, author: pull.user.login, closedAt: pull.closed_at, reopen }) ?? sentence;
  }
  const kind = statusAction({ lifecycle: s.lifecycle, isAuthor: x.isAuthor, canWrite: x.canWrite, exploration: x.exploration, reopen, tokenEdits: Boolean(x.review?.changes.length) });
  const { owner, repo } = readRepo();
  const runs: Record<Exclude<typeof kind, null>, () => Promise<string | void>> = {
    'mark-ready': async () => {
      await studioClient(`${owner}/${repo}`).markReadyForReview(pull.number);
      pending = 'Sent for review. Reviewers can see it now.';
      await x.reload();
    },
    reopen: async () => {
      await reopenOnGitHub(studioClient(`${owner}/${repo}`), pull.number);
      pending = 'Reopened. It is back in review with its earlier approvals and checks.';
      await x.reload();
    },
    restart: () => restart(pull),
  };
  return { kind, sentence, run: kind ? runs[kind] : null };
}

/** The line an action left to say after the repaint, said once. */
export function takeSaid(): string {
  const s = pending;
  pending = '';
  return s;
}

/**
 * Mounts the status line into `slot` and wires its one action. `reload` repaints the change after a write.
 * `review` is the token review of the change (Start again needs token edits to carry over).
 */
export async function mountStatus(
  slot: HTMLElement,
  s: DetailStatus,
  x: { pull: StatusPull; isAuthor: boolean; canWrite: boolean; viewer: string | null; exploration: boolean; review: TokenReview | null; reload: () => Promise<void>; isCurrent: () => boolean },
) {
  const a = await statusActionFor(s, x);
  if (!x.isCurrent() || !slot.isConnected) return;
  const { mountChangeStatus } = await import('../components/ds/studio/ChangeStatus');
  if (!x.isCurrent() || !slot.isConnected) return;
  unmountStatus();
  root = mountChangeStatus(slot, {
    lifecycle: s.lifecycle,
    label: s.label,
    tone: s.tone,
    sentence: a.sentence,
    yourTurn: s.yourTurn,
    action: a.kind && a.run ? { label: ACTION_LABEL[a.kind], run: a.run } : null,
    said: pending,
  });
  pending = '';
}

/** Back to draft, from the More menu: the author takes the change out of review. */
export async function backToDraft(n: number, reload: () => Promise<void>) {
  const { owner, repo } = readRepo();
  await studioClient(`${owner}/${repo}`).convertToDraft(n);
  pending = 'Back to draft. Reviewers are not asked until you request a review again.';
  await reload();
}
