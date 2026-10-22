// The Studio home (direction D): what the viewer does now. Pure: no DOM, no fetch. Unit tested in home-model.test.ts.
//
//   1. The Harbor zone answers "what do I do now": a time-of-day greeting, who waits on the viewer and for how long,
//      then the Needs you list (at most NEEDS_SHOWN rows, the rest in one grouped row that opens the review queue).
//      Order: someone is blocked by the viewer (oldest first), the health of the library on main, the viewer's own
//      branches that need them (changes requested, merge blocked, approved and ready to merge), then usage guidance
//      Claude drafted. A tertiary hint when the viewer is the only reviewer for many of them.
//   2. Your branches: open branches only, as cards (Draft, In review, Approved waiting for code), filtered by status.
//      What shipped lives in the Library changelog, not here.
//   3. Nothing waits and no branch is open: three ways to start.
//
// Every value comes from GitHub (pull requests, their timeline and reviews) or from the repo at build time (usage
// guidance, contrast, adoption, the changelog). Nothing here is guessed.
import type { ThumbSpec } from './branch-thumb';
import { VOCAB } from './vocabulary';
import { isClaudeLogin } from './people';
import { studioHref } from './team-path';

/** Rows of the Needs you list before the grouped row. */
export const NEEDS_SHOWN = 3;
/** Avatars of the people waiting before "+N". */
export const AVATARS_SHOWN = 3;
/** The "only reviewer" hint shows from this many items. */
export const ONLY_REVIEWER_MIN = 5;
/** "Not now" hides the hint for this long. */
export const HINT_SNOOZE_MS = 7 * 24 * 3600 * 1000;
/** An adoption drop above this many points since the last audit gets a line. */
export const ADOPTION_DROP_POINTS = 3;
const DAY = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------------------------------------------
// People

/** Someone shown on the home: by display name ("Ann"), never "@ann". Claude is "Claude AI". */
export interface Person {
  login: string;
  /** First word of the GitHub profile name, else the login. "Claude AI" for the agent. */
  name: string;
  avatar: string | null;
  agent?: boolean;
}

export const CLAUDE: Person = { login: 'claude', name: 'Claude AI', avatar: null, agent: true };

/** Articles a profile name may start with ("The Octocat", "La Poste"): never a first name on their own. */
const ARTICLES = new Set(['the', 'a', 'an', 'le', 'la', 'les']);

/**
 * What to call someone from their profile name: the first word when it reads as a first name ("Florian Gouloubi" gives
 * "Florian"), else the whole name when the first word is an article or shorter than 2 letters ("The Octocat",
 * "J. Doe"), else null (no profile name).
 */
export function shortName(profileName?: string | null): string | null {
  const full = profileName?.trim().replace(/\s+/g, ' ');
  if (!full) return null;
  const first = full.split(' ')[0]!;
  const letters = first.replace(/[^\p{L}]/gu, '');
  return letters.length < 2 || ARTICLES.has(first.toLowerCase()) ? full : first;
}

/** The display name of a GitHub account: its short name (shortName), else the login without "@". */
export function displayName(login: string, profileName?: string | null): string {
  return shortName(profileName) ?? login.replace(/^@/, '');
}

export function person(login: string, profileName?: string | null, avatar?: string | null): Person {
  if (isClaudeLogin(login)) return { ...CLAUDE, login };
  return { login, name: displayName(login, profileName), avatar: avatar ?? null };
}

/** Distinct people, first seen first (the oldest wait leads, since rows come sorted). */
export function uniquePeople(people: (Person | null | undefined)[]): Person[] {
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of people) {
    if (!p) continue;
    const k = p.agent ? '#agent' : p.login.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * Who waits on the viewer, in one sentence: "Ann is waiting on you.", "Ann and Dana are waiting on you.",
 * "Ann, Dana, Claude AI and 6 others are waiting on you." Empty without anyone.
 */
export function waitingSentence(people: Pick<Person, 'name'>[]): { names: string; rest: string } | null {
  const n = people.length;
  if (!n) return null;
  const names = people.map((p) => p.name);
  if (n === 1) return { names: names[0]!, rest: ' is waiting on you.' };
  if (n <= AVATARS_SHOWN) return { names: `${names.slice(0, -1).join(', ')} and ${names[n - 1]}`, rest: ' are waiting on you.' };
  const others = n - AVATARS_SHOWN;
  return { names: `${names.slice(0, AVATARS_SHOWN).join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`, rest: ' are waiting on you.' };
}

// ---------------------------------------------------------------------------------------------------------------
// Greeting

/** Morning from 5 to 11, afternoon from 12 to 17, evening otherwise, in the viewer's local time. */
export function partOfDay(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** "Good morning, Florian." from the short name (shortName); "Good morning." without a profile name. */
export function greeting(hour: number, profileName?: string | null): string {
  const first = shortName(profileName);
  return `Good ${partOfDay(hour)}${first ? `, ${first}` : ''}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Waiting time

/** The timeline events the waiting time reads (GET /repos/{o}/{r}/issues/{n}/timeline). */
export interface TimelineEvent {
  event: string;
  created_at?: string;
  actor?: { login: string } | null;
  review_requester?: { login: string } | null;
  requested_reviewer?: { login: string } | null;
  requested_team?: { slug: string } | null;
}

/**
 * Since when a branch waits for a review, and who asked: the latest review request (for the viewer when there is
 * one, else for anyone), else the moment it left draft, else its creation. The asker is who requested the review,
 * else the author.
 */
export function waitingSince(
  events: TimelineEvent[] | null | undefined,
  pull: { created_at: string; user: { login: string } },
  viewer: string | null,
): { since: string; asker: string } {
  const list = events ?? [];
  const requests = list.filter((e) => e.event === 'review_requested' && e.created_at);
  const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const forViewer = requests.filter((e) => same(e.requested_reviewer?.login, viewer));
  const req = (forViewer.length ? forViewer : requests).at(-1);
  if (req) return { since: req.created_at!, asker: req.review_requester?.login ?? req.actor?.login ?? pull.user.login };
  const ready = list.filter((e) => e.event === 'ready_for_review' && e.created_at).at(-1);
  if (ready) return { since: ready.created_at!, asker: pull.user.login };
  return { since: pull.created_at, asker: pull.user.login };
}

/** Whole days between two moments (0 under a day). */
export const daysSince = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY));

/** "Waiting 4 days", "Waiting 1 day", "New today". */
export function waitingLabel(iso: string, now: number): string {
  const d = daysSince(iso, now);
  return d === 0 ? 'New today' : `Waiting ${d} ${d === 1 ? 'day' : 'days'}`;
}

/** "Oldest: 4 days" over the rows that wait for someone, null under a day or without any. */
export function oldestLabel(rows: Pick<NeedRow, 'since' | 'waitsOnYou'>[], now: number): string | null {
  const times = rows.filter((r) => r.waitsOnYou && r.since).map((r) => new Date(r.since!).getTime());
  if (!times.length) return null;
  const d = daysSince(new Date(Math.min(...times)).toISOString(), now);
  return d ? `Oldest: ${d} ${d === 1 ? 'day' : 'days'}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Needs you

/**
 * What the row is: a review someone waits for, the library health on main, the viewer's own branch, usage guidance
 * Claude drafted, or a setup step for owners.
 */
export type NeedKind = 'review' | 'health' | 'own' | 'guidance' | 'setup';

export type PillTone = 'warning' | 'danger' | 'success' | 'neutral';

export interface NeedRow {
  key: string;
  kind: NeedKind;
  title: string;
  href: string;
  /** Who waits (the asker, Claude for its drafts); null for health and setup rows. */
  person: Person | null;
  /** After the title: "Ann asks for your review". */
  line: string;
  /** Since when it waits (ISO), when known. */
  since: string | null;
  /** Someone waits on the viewer: counts in the greeting's people and "Oldest". */
  waitsOnYou: boolean;
  /** Status on the right: "Waiting 4 days" (warning), what failed (danger). */
  pill: { label: string; tone: PillTone } | null;
  thumb: ThumbSpec;
  /** The branch number, for branch rows. */
  number?: number;
  /** The viewer is the only person who can review it. */
  onlyReviewer?: boolean;
}

/** The verb on a Needs you row's button. */
export function rowAction(kind: NeedKind): string {
  return { review: 'Review', health: 'Fix', own: 'Open', guidance: 'Review', setup: 'Set up' }[kind];
}

const RANK: Record<NeedKind, number> = { review: 0, health: 1, own: 2, guidance: 3, setup: 4 };

/** Blocked by you first (oldest first), then health, your own branches, guidance drafts (oldest first), setup. */
export function sortNeeds<R extends Pick<NeedRow, 'kind' | 'since' | 'key'>>(rows: R[]): R[] {
  const t = (r: R) => (r.since ? new Date(r.since).getTime() : Number.POSITIVE_INFINITY);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => RANK[a.r.kind] - RANK[b.r.kind] || t(a.r) - t(b.r) || a.i - b.i)
    .map((x) => x.r);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The rows shown and the grouped row after them: "17 more", "12 reviews · 5 documentation drafts". */
export function splitNeeds<R extends Pick<NeedRow, 'kind'>>(rows: R[], max = NEEDS_SHOWN): { shown: R[]; more: { count: number; label: string; parts: string } | null } {
  if (rows.length <= max) return { shown: rows, more: null };
  const rest = rows.slice(max);
  const n = (k: NeedKind[]) => rest.filter((r) => k.includes(r.kind)).length;
  const parts = [
    n(['review']) ? plural(n(['review']), 'review', 'reviews') : '',
    n(['own']) ? plural(n(['own']), `of your ${VOCAB.branches}`, `of your ${VOCAB.branches}`) : '',
    n(['guidance']) ? plural(n(['guidance']), 'documentation draft', 'documentation drafts') : '',
    n(['health', 'setup']) ? plural(n(['health', 'setup']), 'library check', 'library checks') : '',
  ].filter(Boolean);
  return { shown: rows.slice(0, max), more: { count: rest.length, label: `${rest.length} more`, parts: parts.join(' · ') } };
}

/** "You are the only reviewer for 12 of them." when at least ONLY_REVIEWER_MIN rows have no other reviewer. */
export function onlyReviewerLine(rows: Pick<NeedRow, 'onlyReviewer'>[], min = ONLY_REVIEWER_MIN): { count: number; text: string } | null {
  const count = rows.filter((r) => r.onlyReviewer).length;
  return count >= min ? { count, text: `You are the only reviewer for ${count} of them.` } : null;
}

/** Whether the viewer can be the only reviewer: the eligible approvers, without the author, are the viewer alone. */
export function isOnlyReviewer(x: { eligible: string[]; requested: string[]; author: string; viewer: string | null }): boolean {
  if (!x.viewer) return false;
  const v = x.viewer.toLowerCase();
  const others = [...x.eligible, ...x.requested].map((l) => l.toLowerCase()).filter((l) => l !== v && l !== x.author.toLowerCase());
  const viewerCan = [...x.eligible, ...x.requested].some((l) => l.toLowerCase() === v);
  return viewerCan && others.length === 0;
}

/** The hint stays hidden for HINT_SNOOZE_MS after "Not now" (the stored moment, in ms). */
export const hintSnoozed = (stored: number | null, now: number) => stored !== null && Number.isFinite(stored) && now - stored < HINT_SNOOZE_MS;

// ---------------------------------------------------------------------------------------------------------------
// Rows, from what the Studio already knows about a change

/** What a change row needs: the facts of lib/overview-todo, plus who asked and since when. */
export interface ChangeFacts {
  number: number;
  title: string;
  author: Person;
  /** The asker of the review (from the timeline), else the author. */
  asker: Person;
  since: string | null;
  /** lib/overview-todo task of the row (design, ship, guidance, finish...). Null when it is not the viewer's. */
  task: 'design' | 'ship' | 'guidance' | 'own-changes' | 'own-blocked' | 'own-ship' | 'requested';
  /** For own-blocked: what blocks it, in plain words ("2 checks fail", "it clashes with main"). */
  blocker?: string;
  /** For own-changes: who asked for changes. */
  changesBy?: Person[];
  thumb: ThumbSpec;
  onlyReviewer?: boolean;
}

const changeHref = (n: number) => studioHref(`changes/?pr=${n}`);

/** One Needs you row for a change. */
export function changeNeed(c: ChangeFacts, now: number): NeedRow {
  const base = { key: `change-${c.number}`, title: c.title, href: changeHref(c.number), number: c.number, thumb: c.thumb, since: c.since, onlyReviewer: c.onlyReviewer };
  const waiting = c.since ? { label: waitingLabel(c.since, now), tone: 'warning' as const } : null;
  switch (c.task) {
    case 'ship':
      return { ...base, kind: 'review', person: c.author, line: `${c.author.name} waits for you to merge it`, waitsOnYou: true, pill: waiting };
    case 'guidance':
      return { ...base, kind: 'review', person: c.asker, line: `${c.asker.name} asks you to check the usage guidance`, waitsOnYou: true, pill: waiting };
    case 'design':
    case 'requested':
      return { ...base, kind: 'review', person: c.asker, line: `${c.asker.name} asks for your review`, waitsOnYou: true, pill: waiting };
    case 'own-changes': {
      const by = c.changesBy?.length ? c.changesBy.map((p) => p.name).join(' and ') : 'A reviewer';
      return { ...base, kind: 'own', person: c.changesBy?.[0] ?? null, line: `${by} asked for changes`, waitsOnYou: false, pill: { label: 'Changes requested', tone: 'warning' } };
    }
    case 'own-blocked':
      return { ...base, kind: 'own', person: null, line: `Your ${VOCAB.branch} cannot be merged yet`, waitsOnYou: false, pill: { label: c.blocker ? capitalize(c.blocker) : 'Blocked', tone: 'danger' } };
    case 'own-ship':
      return { ...base, kind: 'own', person: null, line: 'Approved. Merge it to ship it with the next release', waitsOnYou: false, pill: { label: 'Ready to merge', tone: 'success' } };
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A usage guidance draft by Claude: one row per component, waiting since the draft landed on main. */
export function guidanceNeed(g: { name: string; href: string; since: string | null }, now: number): NeedRow {
  return {
    key: `guidance-${g.name}`,
    kind: 'guidance',
    title: `${g.name} usage guidance`,
    href: g.href,
    person: CLAUDE,
    line: `${CLAUDE.name} drafted it from the code`,
    since: g.since,
    waitsOnYou: true,
    pill: g.since ? { label: waitingLabel(g.since, now), tone: 'warning' } : null,
    thumb: { kind: 'text' },
  };
}

/** Contrast checks failing on main: a Needs you row for everyone (the token build waits on it). */
export function contrastNeed(fail: number): NeedRow | null {
  if (!fail) return null;
  return {
    key: 'health-contrast',
    kind: 'health',
    title: `${plural(fail, 'contrast check fails', 'contrast checks fail')} on ${VOCAB.main}`,
    href: studioHref('quality/'),
    person: null,
    line: 'The token build waits until every pair passes',
    since: null,
    waitsOnYou: false,
    pill: { label: plural(fail, 'check fails', 'checks fail'), tone: 'danger' },
    thumb: { kind: 'icon', icon: 'contrast' },
  };
}

/** Owners only, nothing protects the library: one setup row. */
export function protectNeed(): NeedRow {
  return {
    key: 'setup-protect',
    kind: 'setup',
    title: 'Protect your library',
    href: studioHref('settings/#safety'),
    person: null,
    line: 'Anyone can change it without a review',
    since: null,
    waitsOnYou: false,
    pill: null,
    thumb: { kind: 'icon', icon: 'branch' },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Health, when nothing degrades: one quiet line

/** The adoption drop since the last audit, in points, when it is above ADOPTION_DROP_POINTS. */
export function adoptionDrop(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null) return null;
  const drop = before - now;
  return drop > ADOPTION_DROP_POINTS ? Math.round(drop * 10) / 10 : null;
}

export function adoptionDropLine(points: number): string {
  return `Adoption dropped ${points} points since the last audit.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Your branches

export type BranchStage = 'draft' | 'ready' | 'waiting';

export interface BranchCard {
  number: number;
  title: string;
  href: string;
  stage: BranchStage;
  updated: string;
  /** The first reviewer asked (requested reviewers, else who approved). */
  reviewer: Person | null;
  thumb: ThumbSpec;
  /** In review: the status pill its row shows in Branches (lib/changes statusPill), once read. */
  status?: string | null;
}

export type BranchFilter = 'all' | 'draft' | 'ready';

export const BRANCH_FILTERS: { value: BranchFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'In review' },
];

/** In review keeps the approved ones waiting for code too: they are still in review on the code side. */
export const showsBranch = (filter: BranchFilter, stage: BranchStage) => filter === 'all' || (filter === 'draft' ? stage === 'draft' : stage !== 'draft');

/** Drafts the viewer is editing first, then in review, then waiting for code; newest first inside. */
export function sortBranches<B extends Pick<BranchCard, 'stage' | 'updated'>>(xs: B[]): B[] {
  const order: Record<BranchStage, number> = { draft: 0, ready: 1, waiting: 2 };
  return [...xs].sort((a, b) => order[a.stage] - order[b.stage] || b.updated.localeCompare(a.updated));
}

/** "2 h ago", "3 days ago", "just now": the age after "edited". */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/**
 * The status line of a card: "Draft · edited 2 h ago", "In review · Needs design approval", "Approved, waiting for
 * code". In review, the words are the branch's status pill (the same as its row in Branches and its page header) once
 * read; until then who reviews it.
 */
export function branchStatus(b: Pick<BranchCard, 'stage' | 'updated' | 'reviewer' | 'status'>, now: number): { stage: string; detail: string } {
  if (b.stage === 'draft') return { stage: 'Draft', detail: `edited ${ago(b.updated, now)}` };
  if (b.stage === 'waiting') return { stage: 'Approved', detail: 'waiting for code' };
  if (b.status) return { stage: 'In review', detail: b.status };
  return { stage: 'In review', detail: b.reviewer ? `${b.reviewer.name} reviews` : 'waiting for a reviewer' };
}

// ---------------------------------------------------------------------------------------------------------------
// The page state

export type HomeState = 'signed-out' | 'loading' | 'busy' | 'empty';

/** Signed out, still reading, something to show, or nothing at all (the three ways to start). */
export function homeState(x: { signedIn: boolean; loading: boolean; needs: number; branches: number }): HomeState {
  if (!x.signedIn) return 'signed-out';
  if (x.loading && !x.needs && !x.branches) return 'loading';
  return x.needs || x.branches ? 'busy' : 'empty';
}
