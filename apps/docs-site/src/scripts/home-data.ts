// What the Studio home and the review queue read from GitHub, in one place, so both show the same rows. Reads the
// open branches once, the suggestions that wait on the viewer (scripts/suggestions.ts, the same list the nav badge
// counts), their statuses (scripts/pr-status, the same rules as the change detail), then for the rows that
// wait on the viewer who asked and since when (the timeline), the display names (GET /users), and for what is shown
// the before/after (the token diff, else the visual impact run). Paints progressively through `onUpdate`. The rules
// are pure in lib/home-model.ts and lib/branch-thumb.ts. Admins of a real team on the hosted site also get the people
// asking to join it (board E7b, GET /api/entry?requests=), first in the list.
import { requesterOf } from '@bridge-ds/core';
import { currentAccess, currentContributor, currentViewer, ghGet, hasWorkingToken, readRepo, RateLimitError } from './github-session';
import { loadStatuses, owners, rowWho, shippers, type PullStatus } from './pr-status';
import { loadTeams } from './teams';
import { loadSuggestionNeeds } from './suggestions';
import { siteOwners, todoChange, type QueuePullFull } from './needs-you';
import { reviewQueue } from '../lib/review-queue';
import { byUrgency, statusPill } from '../lib/changes';
import { overviewTodo } from '../lib/overview-todo';
import { analyzeTokenFiles, isTokenFile } from './reviews/token-review';
import { manifestPublished } from './reviews/visual-impact';
import { visualBase, visualState, type VisualManifest } from '../lib/visual-impact';
import { branchThumb, type ThumbInput, type ThumbSpec } from '../lib/branch-thumb';
import {
  CLAUDE,
  changeNeed,
  joinNeed,
  contrastNeed,
  guidanceNeed,
  holdsReviewRight,
  isOnlyReviewer,
  person,
  requesterPerson,
  sortNeeds,
  waitingSince,
  waitsOnContributor,
  type BranchCard,
  type ChangeFacts,
  type NeedRow,
  type Person,
  type TimelineEvent,
} from '../lib/home-model';
import { isHosted, studioHref } from '../lib/team-path';
import { isDemoRepo, teamDisplayName } from '../lib/demo';

export interface HomePull extends QueuePullFull {
  html_url: string;
  created_at: string;
  draft?: boolean;
  requested_reviewers?: { login: string }[] | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
}

/** Build-time facts the page passes in (repo data, not GitHub). */
export interface HomeStatic {
  guidance: { name: string; href: string; since: string | null }[];
  contrastFail: number;
}

export interface HomeData {
  viewer: string | null;
  /** The statuses are still being read. */
  loading: boolean;
  /** Who asked and since when are read too: the order of the rows will not move any more (thumbnails may still land). */
  settled: boolean;
  /** GitHub could not be read: what to tell the viewer. */
  failed: string | null;
  needs: NeedRow[];
  branches: BranchCard[];
  /** Review decisions among the needs, for the Branches nav badge. */
  decisions: number;
  /**
   * The viewer holds a review right (home-model holdsReviewRight). Without one, the needs are only what waits on them
   * (their branches sent back with changes), never the review queue, and the home tells them how their work moves.
   */
  reviewer: boolean;
}

const theme = (): 'light' | 'dark' => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

// ---------------------------------------------------------------------------------------------------------------
// People: display names from the GitHub profile, read once per login.

const people = new Map<string, Promise<Person>>();
export function personOf(login: string, avatar?: string | null): Promise<Person> {
  const k = login.toLowerCase();
  let p = people.get(k);
  if (!p) {
    p = ghGet<{ login: string; name?: string | null; avatar_url?: string }>(`/users/${encodeURIComponent(login)}`)
      .then((f) => person(f.data.login, f.data.name, f.data.avatar_url ?? avatar))
      .catch(() => person(login, null, avatar));
    people.set(k, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// Thumbnails: the token diff for token branches, the visual impact crops for component branches.

const thumbs = new Map<string, Promise<ThumbSpec>>();

async function visualTop(n: number, sha: string): Promise<ThumbInput['visual']> {
  const { owner, repo } = readRepo();
  try {
    if (!(await manifestPublished(owner, repo, n, sha))) return null;
    const base = visualBase(owner, repo, n, sha);
    const m = JSON.parse((await ghGet<string>(`${base}/manifest.json`, { raw: true })).data) as VisualManifest;
    const st = visualState(m);
    const top = st.kind === 'changes' ? st.shots[0] : null;
    return top?.images.before && top.images.after ? { before: `${base}/${top.images.before}`, after: `${base}/${top.images.after}`, label: top.label } : null;
  } catch {
    return null;
  }
}

const fileLists = new Map<string, Promise<string[] | null>>();

/** The files a branch changes (first 100), read once per head commit; null when GitHub cannot be read. */
export function filesOf(n: number, sha: string): Promise<string[] | null> {
  const key = `${n}@${sha}`;
  let f = fileLists.get(key);
  if (!f) {
    const { owner, repo } = readRepo();
    f = ghGet<{ filename: string }[]>(`/repos/${owner}/${repo}/pulls/${n}/files?per_page=100`)
      .then((r) => r.data.map((x) => x.filename))
      .catch(() => null);
    fileLists.set(key, f);
  }
  return f;
}

/** The before/after of a branch, read once per head commit. */
export function thumbOf(p: Pick<HomePull, 'number' | 'head' | 'base'>, guidance: boolean): Promise<ThumbSpec> {
  const key = `${p.number}@${p.head.sha}@${theme()}`;
  let t = thumbs.get(key);
  if (!t) {
    const { owner, repo } = readRepo();
    t = (async () => {
      const files = await filesOf(p.number, p.head.sha);
      if (!files) return branchThumb({ guidance });
      const tokenFiles = files.filter(isTokenFile);
      if (tokenFiles.length) {
        const review = await analyzeTokenFiles({ owner, repo, baseSha: p.base.sha, headSha: p.head.sha, files: tokenFiles.map((filename) => ({ filename })) }).catch(() => null);
        return branchThumb({ files, tokens: review?.changes ?? null, guidance, theme: theme() });
      }
      const visual = files.some((f) => f.startsWith('packages/react/src/')) ? await visualTop(p.number, p.head.sha) : null;
      return branchThumb({ files, visual, guidance, theme: theme() });
    })();
    thumbs.set(key, t);
  }
  return t;
}

// ---------------------------------------------------------------------------------------------------------------

/** Who reviews a branch: the first reviewer asked, else the first who approved. */
function reviewerLogin(p: HomePull, st: PullStatus | null | undefined): string | null {
  return p.requested_reviewers?.[0]?.login ?? st?.approvers?.[0] ?? null;
}

interface Classified {
  pull: HomePull;
  task: ChangeFacts['task'] | null;
  blocker?: string;
  changesBy?: string[];
  agent: boolean;
  guidance: boolean;
  onlyReviewer: boolean;
}

/**
 * The people asking to join the team, for its admins only (the server checks it again): none on the demo, on a
 * self-hosted site, or when the account cannot manage requests (no GitHub admin linked).
 */
export async function loadJoinNeeds(now: number): Promise<NeedRow[]> {
  const a = currentAccess();
  if (!a?.admin && !a?.repoAdmin) return [];
  const { owner, repo } = readRepo();
  const full = `${owner}/${repo}`;
  if (!isHosted() || isDemoRepo(full)) return [];
  try {
    const { listJoinRequests } = await import('./entry-session');
    const { siteConfig } = await import('./repo-context');
    const team = teamDisplayName(full, siteConfig());
    return (await listJoinRequests(full)).map((r) => joinNeed(r, team, now));
  } catch {
    return [];
  }
}

/**
 * Loads everything, painting as it goes. Signed out (or no working token) it reads nothing: the page asks to sign in.
 */
export async function loadHome(stat: HomeStatic, onUpdate: (d: HomeData) => void): Promise<void> {
  const viewer = currentViewer()?.login ?? null;
  const now = Date.now();
  // An email contributor is known at once; a GitHub account once the owner teams are read (below).
  const contributor = Boolean(currentContributor()) || currentAccess()?.contributor === true;
  const rightNow = () => holdsReviewRight({ viewer, contributor, approvers: [...owners().design, ...owners().tech], shippers: shippers(), write: currentAccess()?.write ?? null });
  let reviewer = rightNow();
  // People asking to join: admins only, read next to the branches.
  let joins: NeedRow[] = [];
  // Library checks and guidance drafts wait on the reviewers, not on someone who cannot approve them.
  const staticNeeds = (): NeedRow[] => [...joins, ...(reviewer ? [...(contrastNeed(stat.contrastFail) ? [contrastNeed(stat.contrastFail)!] : []), ...stat.guidance.map((g) => guidanceNeed(g, now))] : [])];
  const empty: HomeData = { viewer, loading: true, settled: false, failed: null, needs: [], branches: [], decisions: 0, reviewer };
  if (!viewer || !hasWorkingToken()) {
    onUpdate({ ...empty, loading: false, settled: true });
    return;
  }
  onUpdate({ ...empty, needs: sortNeeds(staticNeeds()) });
  const joinsRead = loadJoinNeeds(now).then((rows) => (joins = rows));
  const { owner, repo } = readRepo();
  let pulls: HomePull[];
  try {
    pulls = (await ghGet<HomePull[]>(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`)).data;
  } catch (err) {
    onUpdate({
      ...empty,
      loading: false,
      settled: true,
      needs: sortNeeds(staticNeeds()),
      reviewer,
      failed: err instanceof RateLimitError ? 'GitHub is busy right now. Your branches come back in a few minutes.' : 'GitHub could not be reached. Reload the page to try again.',
    });
    return;
  }
  await loadTeams();
  reviewer = rightNow();
  // Suggestions wait next to branches: read in parallel, painted when they land.
  let suggestions: NeedRow[] = [];
  const suggestionsRead = loadSuggestionNeeds(personOf)
    .then((rows) => (suggestions = rows))
    .catch(() => (suggestions = []));
  const queue = reviewQueue(pulls);
  const statuses = new Map<number, PullStatus | null>(queue.map((p) => [p.number, null]));
  const timelines = new Map<number, TimelineEvent[] | null>();
  const resolved = new Map<number, ThumbSpec>();
  const persons = new Map<string, Person>();
  let loading = true;
  let settled = false;

  const classify = (): Classified[] => {
    const urgent = byUrgency(queue.map((p) => ({ number: p.number, kind: statuses.get(p.number)?.kind ?? null, updated_at: p.updated_at })));
    const byNum = new Map(queue.map((p) => [p.number, p]));
    const changes = urgent.map((u) => {
      const p = byNum.get(u.number)!;
      return { pull: p, c: todoChange(p, statuses.get(p.number)) };
    });
    const todo = overviewTodo({ changes: changes.map((x) => x.c), requests: [], viewer, owners: siteOwners(), loading });
    const mine = new Map(todo.mine.map((r) => [r.key, r]));
    const design = owners().design;
    return changes.map(({ pull, c }): Classified => {
      const row = mine.get(`change-${pull.number}`);
      const author = same(pull.user.login, viewer);
      const requested = (pull.requested_reviewers ?? []).map((r) => r.login);
      const base = { pull, agent: Boolean(c.agent), guidance: Boolean(c.guidance), onlyReviewer: false, task: null as ChangeFacts['task'] | null };
      const only = isOnlyReviewer({ eligible: design, requested, author: pull.user.login, viewer });
      if (!c.who || c.nature === 'developer') return base;
      if (!author && row && (row.task === 'design' || row.task === 'ship' || row.task === 'guidance')) return { ...base, task: row.task, onlyReviewer: only };
      if (author && row?.task === 'ship') return { ...base, task: 'own-ship' };
      if (author && c.who.action === 'address-changes') return { ...base, task: 'own-changes', changesBy: c.changesBy ?? [] };
      // Failing tests and conflicts are technical: a developer fixes them in GitHub, the home never shows them.
      if (author && (c.who.action === 'fix-checks' || c.who.action === 'resolve-conflict')) return base;
      if (!author && !pull.draft && requested.some((l) => same(l, viewer))) return { ...base, task: 'requested', onlyReviewer: only };
      return base;
    }).map((x): Classified => (reviewer || waitsOnContributor(x.task) ? x : { ...x, task: null }));
  };

  const pick = (login: string | null | undefined): Person | null => (login ? (persons.get(login.toLowerCase()) ?? person(login, null, `https://github.com/${login}.png?size=64`)) : null);

  const paint = () => {
    const cls = classify();
    const needs: NeedRow[] = [...staticNeeds()];
    for (const x of cls) {
      if (!x.task) continue;
      const p = x.pull;
      const tl = timelines.get(p.number);
      const w = x.task.startsWith('own') ? null : waitingSince(tl, p, viewer);
      const authorP = x.agent ? CLAUDE : pick(p.user.login)!;
      // Who asked, as Bridge recorded it in the body ("Requested by Ann Leroy."), before the GitHub author: the
      // account that opened it is often an agent or a lead acting for someone.
      const requested = requesterOf(p.body);
      const requesterP = requested ? requesterPerson(requested, (l) => pick(l)!) : null;
      const askerP = !w || same(w.asker, p.user.login) ? (requesterP ?? authorP) : pick(w.asker)!;
      const facts: ChangeFacts = {
        number: p.number,
        title: todoChange(p, statuses.get(p.number)).title,
        author: authorP,
        asker: askerP,
        // The wait shows once the timeline is read, so "Oldest" never jumps back.
        since: w && tl !== undefined ? w.since : null,
        task: x.task,
        blocker: x.blocker,
        changesBy: (x.changesBy ?? []).map((l) => pick(l)!),
        thumb: resolved.get(p.number) ?? { kind: 'icon', icon: x.guidance ? 'guidance' : 'branch' },
        onlyReviewer: x.onlyReviewer,
      };
      needs.push(changeNeed(facts, now));
    }
    const branches: BranchCard[] = queue
      .filter((p) => same(p.user.login, viewer))
      .map((p) => {
        const st = statuses.get(p.number);
        const c = todoChange(p, st);
        const stage = c.lifecycle === 'waiting' ? 'waiting' : p.draft || c.lifecycle === 'draft' ? 'draft' : 'ready';
        // The same pill as the branch's row in Branches and its page header (lib/changes statusPill).
        const status = st && stage === 'ready' ? statusPill(st.kind, rowWho(st.kind, { author: p.user.login, approvers: st.approvers, changesRequested: st.changesRequested, failing: st.failing, failingChecks: st.failingChecks, pending: st.pending })).label : null;
        return { number: p.number, title: c.title, href: studioHref(`changes/?pr=${p.number}`), stage, updated: p.updated_at, reviewer: pick(reviewerLogin(p, st)), thumb: resolved.get(p.number) ?? { kind: 'icon', icon: 'branch' }, status };
      });
    // Suggestions wait on their reviewers only.
    if (reviewer) needs.push(...suggestions);
    const sorted = sortNeeds(needs);
    onUpdate({ viewer, loading, settled, failed: null, needs: sorted, branches, decisions: sorted.filter((r) => r.kind === 'review').length, reviewer });
  };

  paint();
  await Promise.all([
    loadStatuses(queue, (p, st) => {
      statuses.set(p.number, st);
    }),
    suggestionsRead,
    joinsRead,
  ]);
  loading = false;
  paint();

  // Who asked and since when, for the rows that wait on the viewer; display names for everyone shown.
  const cls = classify();
  const waiting = cls.filter((x) => x.task && !x.task.startsWith('own'));
  await Promise.all(
    waiting.map((x) =>
      ghGet<TimelineEvent[]>(`/repos/${owner}/${repo}/issues/${x.pull.number}/timeline?per_page=100`)
        .then((f) => timelines.set(x.pull.number, f.data))
        .catch(() => timelines.set(x.pull.number, null)),
    ),
  );
  const logins = new Set<string>();
  for (const x of cls) {
    if (!x.task && !same(x.pull.user.login, viewer)) continue;
    logins.add(x.pull.user.login);
    const req = requesterOf(x.pull.body)?.login;
    if (req) logins.add(req);
    for (const l of x.changesBy ?? []) logins.add(l);
    const r = reviewerLogin(x.pull, statuses.get(x.pull.number));
    if (r) logins.add(r);
    const tl = timelines.get(x.pull.number);
    if (tl) logins.add(waitingSince(tl, x.pull, viewer).asker);
  }
  await Promise.all([...logins].map(async (l) => persons.set(l.toLowerCase(), await personOf(l, `https://github.com/${l}.png?size=64`))));
  settled = true;
  paint();

  // Before/after: every row and card at once, painted once a frame as they land.
  const order = cls.filter((x) => x.task || same(x.pull.user.login, viewer));
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };
  await Promise.all(
    order.map(async (x) => {
      resolved.set(x.pull.number, await thumbOf(x.pull, x.guidance));
      later();
    }),
  );
}
