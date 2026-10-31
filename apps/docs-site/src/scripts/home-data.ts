// What the Studio home and the review queue read from GitHub, in one place, so both show the same rows. Reads the
// open branches once, the suggestions that wait on the viewer (scripts/suggestions.ts, the same list the nav badge
// counts), their statuses (scripts/pr-status, the same rules as the change detail), then for the rows that
// wait on the viewer who asked and since when (the timeline), the display names (GET /users), and for what is shown
// the before/after (the token diff, else the visual impact run). Paints progressively through `onUpdate`. The rules
// are pure in lib/home-model.ts and lib/branch-thumb.ts. Admins of a real team on the hosted site also get the people
// asking to join it (board E7b, GET /api/entry?requests=), first in the list.
import { isGuardedExploration, isHandedOff, productsOf, requesterOf, type ProductConfig } from '@bridge-ds/core';
import { siteConfig } from './repo-context';
import { homeExplorations, isHomeExploration, isOwnExploration, type ExplorationCard } from '../lib/home-explorations';
import { currentAccess, currentContributor, currentViewer, ghGet, hasWorkingToken, readRepo, RateLimitError, resolveAccess } from './github-session';
import { loadStatuses, owners, rowWho, shippers, type PullStatus } from './pr-status';
import { loadTeams } from './teams';
import { loadOwnSuggestions, loadSuggestionNeeds } from './suggestions';
import { todoChange, viewerRole, type QueuePullFull } from './needs-you';
import { reviewQueue } from '../lib/review-queue';
import { isDraft } from '../lib/review-rules';
import { byUrgency, statusPill } from '../lib/changes';
import { isReviewTask, waitingOn } from '../lib/waiting-on';
import { analyzeTokenFiles, isTokenFile } from './reviews/token-review';
import type { ChangedFile } from '../lib/blob-batch';
import { manifestPublished } from './reviews/visual-impact';
import { touchesVisuals, visualBase, visualState, type VisualManifest } from '../lib/visual-impact';
import { branchThumb, type ThumbInput, type ThumbSpec } from '../lib/branch-thumb';
import {
  CLAUDE,
  changeNeed,
  joinNeed,
  contrastNeed,
  guidanceChangeOf,
  guidanceNeed,
  isOnlyReviewer,
  person,
  requesterPerson,
  sortNeeds,
  waitingSince,
  type BranchCard,
  type ChangeFacts,
  type GuidanceDraft,
  type NeedRow,
  type Person,
  type TimelineEvent,
} from '../lib/home-model';
import { isHosted, studioHref } from '../lib/team-path';
import { busyText } from '../lib/team-load';
import { isDemoRepo } from '../lib/demo';

export interface HomePull extends QueuePullFull {
  html_url: string;
  created_at: string;
  draft?: boolean;
  requested_reviewers?: { login: string }[] | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  /** Closed ones only: when it was merged (a kept exploration). */
  merged_at?: string | null;
  /** Bridge armed its merge (a lead published it): it ships by itself once the checks pass. */
  auto_merge?: unknown;
  /** Read in a product's own repository (scripts/product-repos.ts): the product key. Only explorations come from there. */
  product?: string;
}

/** Build-time facts the page passes in (repo data, not GitHub). */
export interface HomeStatic {
  guidance: GuidanceDraft[];
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
  /** The viewer's own library changes and suggestions: the home counts them under the explorations (Changes lists them). */
  branches: BranchCard[];
  /** The viewer's own explorations (lib/home-explorations): the home's cards. */
  explorations: ExplorationCard[];
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

const fileLists = new Map<string, Promise<ChangedFile[] | null>>();

/** The files a branch changes (first 100) as GitHub lists them, with their blob shas, read once per head commit. */
function changedFilesOf(n: number, sha: string): Promise<ChangedFile[] | null> {
  const key = `${n}@${sha}`;
  let f = fileLists.get(key);
  if (!f) {
    const { owner, repo } = readRepo();
    f = ghGet<ChangedFile[]>(`/repos/${owner}/${repo}/pulls/${n}/files?per_page=100`)
      .then((r) => r.data)
      .catch(() => null);
    fileLists.set(key, f);
  }
  return f;
}

/** The files a branch changes (first 100), read once per head commit; null when GitHub cannot be read. */
export function filesOf(n: number, sha: string): Promise<string[] | null> {
  return changedFilesOf(n, sha).then((list) => list?.map((x) => x.filename) ?? null);
}

/** The before/after of a branch, read once per head commit. */
export function thumbOf(p: Pick<HomePull, 'number' | 'head' | 'base'>, guidance: boolean): Promise<ThumbSpec> {
  const key = `${p.number}@${p.head.sha}@${theme()}`;
  let t = thumbs.get(key);
  if (!t) {
    const { owner, repo } = readRepo();
    t = (async () => {
      const changed = await changedFilesOf(p.number, p.head.sha);
      if (!changed) return branchThumb({ guidance });
      const files = changed.map((x) => x.filename);
      const tokenFiles = files.filter(isTokenFile);
      if (tokenFiles.length) {
        // The change's own file list stands for its head (no head tree read), and every card's blobs share one batch.
        const review = await analyzeTokenFiles({ owner, repo, baseSha: p.base.sha, headSha: p.head.sha, files: tokenFiles.map((filename) => ({ filename })), changed }).catch(() => null);
        return branchThumb({ files, tokens: review?.changes ?? null, guidance, theme: theme() });
      }
      const visual = files.some((f) => f.startsWith('packages/react/src/')) ? await visualTop(p.number, p.head.sha) : null;
      return branchThumb({ files, visual, guidance, theme: theme() });
    })();
    thumbs.set(key, t);
  }
  return t;
}

const screens = new Map<string, Promise<ThumbSpec | null>>();

/**
 * The explored screen of an exploration: the after side of the top change its visual impact run captured (the same
 * capture its product branch page shows), read once per head commit. Null while there is none (no run, no screen).
 */
export function previewOf(p: Pick<HomePull, 'number' | 'head'>): Promise<ThumbSpec | null> {
  const key = `screen:${p.number}@${p.head.sha}`;
  let t = screens.get(key);
  if (!t) {
    t = (async () => {
      const files = (await changedFilesOf(p.number, p.head.sha))?.map((x) => x.filename) ?? [];
      if (!touchesVisuals(files)) return null;
      const top = await visualTop(p.number, p.head.sha);
      return top ? ({ kind: 'screen', src: top.after } as const) : null;
    })();
    screens.set(key, t);
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
  const { owner, repo } = readRepo();
  const full = `${owner}/${repo}`;
  if (!isHosted() || isDemoRepo(full)) return [];
  // The access may still be on its way (an email admin's is known without GitHub): wait for it, never fail on it.
  const a = currentAccess() ?? (await resolveAccess({ owner, repo }, { anonymous: true }).catch(() => null));
  if (!a?.admin && !a?.repoAdmin) return [];
  try {
    // Join requests are Bridge's own: a GitHub admin without a Bridge account has none to read (the server would
    // answer 401). The account is read once a page, so asking costs nothing more.
    const { getAccount } = await import('./account-session');
    if (!(await getAccount()).account) return [];
    const { listJoinRequests } = await import('./entry-session');
    const { teamNameSoon } = await import('./members');
    const [rows, team] = await Promise.all([listJoinRequests(full), teamNameSoon(full)]);
    return rows.map((r) => joinNeed(r, team, now));
  } catch {
    return [];
  }
}

/**
 * Loads everything, painting as it goes. Signed out (or no working token) it reads nothing: the page asks to sign in.
 * `stat` is read on every paint: a team page passes a getter, so the repo facts (contrast, guidance drafts) fill in
 * when its design system is read, without reading GitHub again (`onRepaint` hands back the way to repaint). Join
 * requests are Bridge's own (api/entry): they paint as soon as they are read, whatever GitHub does.
 */
export async function loadHome(stat: HomeStatic | (() => HomeStatic), onUpdate: (d: HomeData) => void, onRepaint?: (repaint: () => void) => void): Promise<void> {
  const facts = typeof stat === 'function' ? stat : () => stat;
  const viewer = currentViewer()?.login ?? null;
  const now = Date.now();
  // An email contributor is known at once; a GitHub account once the owner teams are read (below). The same role as
  // the nav badge and Branches (needs-you viewerRole).
  const rightNow = () => viewerRole() === 'reviewer';
  let reviewer = rightNow();
  // People asking to join: admins only, read next to the branches.
  let joins: NeedRow[] = [];
  // The open changes, once read: a guidance draft someone already sent (published or in review) no longer waits on you.
  let open: HomePull[] = [];
  let onItsWay: (n: number) => boolean | undefined = () => undefined;
  // Library checks and guidance drafts wait on the reviewers, not on someone who cannot approve them.
  const staticNeeds = (): NeedRow[] => {
    const f = facts();
    return [...joins, ...(reviewer ? [...(contrastNeed(f.contrastFail) ? [contrastNeed(f.contrastFail)!] : []), ...f.guidance.map((g) => guidanceNeed(g, now, guidanceChangeOf(g, open, onItsWay)))] : [])];
  };
  const empty: HomeData = { viewer, loading: true, settled: false, failed: null, needs: [], branches: [], explorations: [], decisions: 0, reviewer };
  if (!viewer || !hasWorkingToken()) {
    onUpdate({ ...empty, loading: false, settled: true });
    return;
  }
  // What is on screen now, so a join request or the repo facts landing repaint the same state: still reading the
  // branches, GitHub failed (the requests stay), or the full home (paint, below).
  let failed: string | null = null;
  let repaint = () => (failed === null ? onUpdate({ ...empty, needs: sortNeeds(staticNeeds()) }) : onUpdate({ ...empty, loading: false, settled: true, needs: sortNeeds(staticNeeds()), reviewer, failed }));
  onRepaint?.(() => repaint());
  repaint();
  const joinsRead = loadJoinNeeds(now)
    .catch(() => [] as NeedRow[])
    .then((rows) => {
      joins = rows;
      if (rows.length) repaint();
    });
  const { owner, repo } = readRepo();
  // The explorations in products' own repositories, one read each in parallel; an unreachable one adds nothing.
  let productOpen: HomePull[] = [];
  const productRead = import('./product-repos')
    .then((m) => m.productPulls())
    .then((list) => (productOpen = list.map((p) => ({ ...p, user: p.user ?? { login: 'unknown' }, created_at: p.updated_at, base: { ref: p.base?.ref ?? '', sha: '' }, labels: p.labels.map((l) => ({ name: typeof l === 'string' ? l : (l.name ?? '') })) }) as unknown as HomePull)))
    .catch(() => (productOpen = []));
  let pulls: HomePull[];
  try {
    pulls = (await ghGet<HomePull[]>(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`)).data;
  } catch (err) {
    failed = err instanceof RateLimitError ? busyText(err.resetAt ? (err.resetAt.getTime() - Date.now()) / 1000 : null) : 'GitHub could not be reached. Reload the page to try again.';
    repaint();
    return;
  }
  open = pulls;
  await loadTeams();
  reviewer = rightNow();
  // Suggestions wait next to branches: read in parallel, painted when they land.
  let suggestions: NeedRow[] = [];
  const suggestionsRead = loadSuggestionNeeds(personOf)
    .then((rows) => (suggestions = rows))
    .catch(() => (suggestions = []));
  // The viewer's own open suggestions sit with their branches: they wait on the reviewers, calmly. An email member's
  // are filed by Bridge for them (the server's list says which).
  let ownSuggestions: BranchCard[] = [];
  const ownSuggestionsRead = (async () => {
    const mine = currentContributor() ? await import('./contribute-session').then((m) => m.contributeMine(`${owner}/${repo}`)).catch(() => null) : null;
    ownSuggestions = await loadOwnSuggestions(viewer, mine);
  })().catch(() => undefined);
  const queue = reviewQueue(pulls);
  const products = homeProducts();
  // The explorations kept lately: merged ones among the recently closed (the same read Changes makes), painted when read.
  let closed: HomePull[] = [];
  const closedRead = ghGet<HomePull[]>(`/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`)
    .then((r) => (closed = r.data.filter((p) => p.merged_at)))
    .catch(() => (closed = []));
  const shots = new Map<number, ThumbSpec>();
  // The changed files of each running exploration: its card says "Not started" or "Exploring", as its page.
  const xpFiles = new Map<string, string[] | null>();
  const xpAsked = new Set<string>();
  const xpKey = (p: HomePull) => `${p.product ?? ''}#${p.number}@${p.head.sha}`;
  const readXpFiles = (list: HomePull[]) => {
    for (const p of list) {
      const k = xpKey(p);
      // Running ones (Not started or Exploring), and the ones handed to developers: their card names the changed screen.
      if (xpFiles.has(k) || xpAsked.has(k) || !(isGuardedExploration(p) || isHandedOff({ labels: p.labels ?? [], body: p.body }))) continue;
      xpAsked.add(k);
      void import('./product-repos')
        .then((m) => m.explorationFiles({ number: p.number, headSha: p.head.sha, product: p.product }))
        .then((files) => {
          xpFiles.set(k, files);
          repaint();
        });
    }
  };
  const statuses = new Map<number, PullStatus | null>(queue.map((p) => [p.number, null]));
  // Read once the change's status is: it ships by itself until a check fails (PullStatus autoShip).
  onItsWay = (n) => {
    const st = statuses.get(n);
    return st ? Boolean(st.autoShip) : undefined;
  };
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
    // Who acts now, by the one rule of every "waiting on me" surface (lib/waiting-on.ts).
    const role = reviewer ? 'reviewer' : 'contributor';
    const { design, tech } = owners();
    return changes.map(({ pull, c }): Classified => {
      const requested = (pull.requested_reviewers ?? []).map((r) => r.login);
      const base = { pull, agent: Boolean(c.agent), guidance: Boolean(c.guidance), onlyReviewer: false, task: null as ChangeFacts['task'] | null };
      const task = waitingOn(
        { author: pull.user.login, draft: pull.draft, labels: pull.labels, nature: c.nature, guidance: c.guidance, lifecycle: c.lifecycle, who: c.who, requested, changesRequested: c.changesBy, autoShip: c.autoShip },
        { login: viewer, role },
      );
      if (!task) return base;
      if (task === 'own-changes') return { ...base, task, changesBy: c.changesBy ?? [] };
      return { ...base, task, onlyReviewer: isReviewTask(task) && isOnlyReviewer({ eligible: task === 'tech' ? tech : design, requested, author: pull.user.login, viewer }) };
    });
  };

  const pick = (login: string | null | undefined): Person | null => (login ? (persons.get(login.toLowerCase()) ?? person(login, null, `https://github.com/${login}.png?size=64`)) : null);

  const paint = () => {
    const cls = classify();
    const needs: NeedRow[] = [...staticNeeds()];
    const asked = new Set<number>();
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
      asked.add(p.number);
    }
    // A guidance draft whose change already has its own row (a review waits on you) shows once, as that change.
    for (let i = needs.length - 1; i >= 0; i--) if (needs[i]!.kind === 'guidance' && needs[i]!.number && asked.has(needs[i]!.number!)) needs.splice(i, 1);
    // Explorations are the home's cards; the viewer's library changes are counted under them (Changes lists them).
    // The team's: a contributor's home keeps only their own (home by role, lib/home-explorations explorationsFor).
    readXpFiles([...pulls, ...productOpen, ...closed]);
    const explorations = homeExplorations([...pulls, ...productOpen, ...closed], {
      products,
      viewer,
      files: (p) => (xpFiles.has(xpKey(p)) ? xpFiles.get(xpKey(p)) : undefined),
      author: (p) => {
        const r = requesterOf(p.body);
        return (r && requesterPerson(r, (l) => pick(l)!)) ?? pick(p.user.login)!;
      },
      // Screens are captured in the design system repository only: a product's own exploration keeps its sketch.
      preview: (p) => (p.product ? undefined : shots.get(p.number)),
    });
    const branches: BranchCard[] = queue
      .filter((p) => same(p.user.login, viewer) && !isHomeExploration(p, products))
      .map((p) => {
        const st = statuses.get(p.number);
        const c = todoChange(p, st);
        const stage = c.lifecycle === 'waiting' ? 'waiting' : isDraft(p) || c.lifecycle === 'draft' ? 'draft' : 'ready';
        // The same pill as the branch's row in Branches and its page header (lib/changes statusPill).
        const status = st && stage === 'ready' ? statusPill(st.kind, rowWho(st.kind, { author: p.user.login, labels: p.labels, approvers: st.approvers, changesRequested: st.changesRequested, lookAgain: st.lookAgain, failing: st.failing, failingChecks: st.failingChecks, pending: st.pending, autoShip: st.autoShip })).label : null;
        return { number: p.number, title: c.title, href: studioHref(`changes/?pr=${p.number}`), stage, updated: p.updated_at, reviewer: pick(reviewerLogin(p, st)), thumb: resolved.get(p.number) ?? { kind: 'icon', icon: 'branch' }, status };
      });
    // Suggestions wait on their reviewers only.
    if (reviewer) needs.push(...suggestions);
    const sorted = sortNeeds(needs);
    onUpdate({ viewer, loading, settled, failed: null, needs: sorted, branches: [...branches, ...ownSuggestions], explorations, decisions: sorted.filter((r) => r.kind === 'review').length, reviewer });
  };

  repaint = paint;
  paint();
  await Promise.all([
    loadStatuses(queue, (p, st) => {
      statuses.set(p.number, st);
    }),
    suggestionsRead,
    joinsRead,
    ownSuggestionsRead,
    productRead,
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
  // The people behind the exploration cards too: a card says "Florian", never the login.
  await closedRead;
  for (const p of [...pulls, ...productOpen, ...closed]) {
    const who = requesterOf(p.body)?.login ?? p.user.login;
    if (who !== 'unknown' && isHomeExploration(p, products)) logins.add(who);
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
  await closedRead;
  paint();
  // The explored screens of the first cards a lead sees, and of every one of the viewer's own: each costs reads.
  const all = [...pulls, ...closed].filter((p) => isHomeExploration(p, products));
  const firstShown = new Set(homeExplorations(all, { products, author: () => CLAUDE }).slice(0, 6).map((c) => c.number));
  const mine = all.filter((p) => firstShown.has(p.number) || isOwnExploration(p, viewer));
  await Promise.all([
    ...order.map(async (x) => {
      resolved.set(x.pull.number, await thumbOf(x.pull, x.guidance));
      later();
    }),
    // The explored screen of each exploration card.
    ...mine.map(async (p) => {
      const shot = await previewOf(p).catch(() => null);
      if (!shot) return;
      shots.set(p.number, shot);
      later();
    }),
  ]);
}

/** The products the team names (bridge.config.json "products"), for the exploration cards. */
function homeProducts(): ProductConfig[] {
  try {
    return productsOf(siteConfig() as { products?: ProductConfig[] });
  } catch {
    return productsOf(null);
  }
}
