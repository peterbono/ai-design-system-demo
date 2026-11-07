// The browser side of /api/contribute (lib/contribute.ts says what an email contributor is). It reads whether this
// visitor has an email session on a team (GET, once per team and page), signs in with an email, spends the link from
// the email (#contribute=<token>, out of the address at once), signs out, accepts a "Can edit" invite with a name, and
// sends GitHub calls through the proxy. The session itself is an httpOnly cookie this page never sees: only the
// member (email, name) is kept in this browser, so a team page knows at once that someone is signed in, and it is
// checked with the server on every page.
// scripts/github-session.ts uses it: getToken() gives the stand-in token (lib/contribute CONTRIB_TOKEN) to every
// feature, and the session's fetch sends each call that carries it here (contributeFetch). No feature changes.
import { GitHubError } from '@bridge-ds/core';
import { mineIn } from '../lib/branches-page';
import { CONTRIB_REFUSAL, CONTRIBUTE_API, GITHUB_API, CONTRIBUTE_HEADER, CONTRIBUTE_WORDS, contributeHashToken, FRESH_HEADER, localDevHost, MISSING_HEADER, parseMember, proxyUrl, restoreMissing, wantsFresh, type ContributeMember } from '../lib/contribute';
import { isDemoRepo } from '../lib/demo';

/** The site cannot sign in with an email (no server piece, or not set up). */
export class ContributeUnavailable extends Error {
  constructor() {
    super(CONTRIBUTE_WORDS.unavailable);
    this.name = 'ContributeUnavailable';
  }
}

/** The server refused or failed, with a sentence a designer can act on. */
export class ContributeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ContributeError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: Fetch = (input, init) => fetch(input, init);

/** Tests swap the network. Also forgets what this page read. */
export function setContributeFetch(f: Fetch | null) {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
  infos.clear();
  mines.clear();
  reviews.clear();
  publicReads.clear();
  profiles.clear();
  askProfiles = new Map();
  forgetRecent(null);
}

const HINT_PREFIX = 'bridge.contribute.member:';
const key = (repo: string) => repo.toLowerCase();

/** The storage key of `repo`'s member: another tab removing it means the session ended there. */
export const contributorKey = (repo: string) => HINT_PREFIX + key(repo);

/** The member this browser last saw signed in on `repo`, or null. Synchronous: the server confirms it on each page. */
export function contributorFor(repo: string): ContributeMember | null {
  try {
    const raw = localStorage.getItem(HINT_PREFIX + key(repo));
    return raw ? parseMember(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const listeners: ((repo: string, m: ContributeMember | null) => void)[] = [];

/** "owner/repo" (lowercase) of every team this browser last saw its person signed in to by email. */
export function contributorRepos(): string[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(HINT_PREFIX))
      .map((k) => k.slice(HINT_PREFIX.length))
      .filter((r) => /^[^/\s]+\/[^/\s]+$/.test(r));
  } catch {
    return [];
  }
}

/** Called when a team's email session starts or ends on this page. */
export function onContributeChange(fn: (repo: string, m: ContributeMember | null) => void) {
  listeners.push(fn);
}

function remember(repo: string, m: ContributeMember | null) {
  const before = contributorFor(repo);
  if (!m || before?.email !== m.email) forgetRecent(repo);
  try {
    if (m) localStorage.setItem(HINT_PREFIX + key(repo), JSON.stringify(m));
    else localStorage.removeItem(HINT_PREFIX + key(repo));
  } catch {
    /* storage blocked: the page asks the server each time */
  }
  infos.set(key(repo), Promise.resolve({ available: infoAvailable.get(key(repo)) ?? true, member: m }));
  if (Boolean(before) !== Boolean(m) || before?.email !== m?.email || before?.name !== m?.name) listeners.forEach((fn) => fn(repo, m));
}

/**
 * A Bridge account signed in with its code is a member of its email teams already (api/contribute reads the account
 * session too): each team page of theirs knows it at once, even one never opened in this browser. Only the hint is
 * written (the server confirms it on the page); a team whose hint is there already is left as it is.
 */
export function seedContributors(account: { email: string; name: string | null }, teams: readonly { repo: string; role: string; via: string }[]) {
  for (const t of teams) {
    if (t.via !== 'email' || !/^[^/\s]+\/[^/\s]+$/.test(t.repo)) continue;
    if (contributorFor(t.repo)) continue;
    const m = parseMember({ email: account.email, name: account.name ?? '', role: t.role === 'admin' ? 'admin' : t.role === 'view' ? 'view' : 'edit' });
    if (!m) continue;
    try {
      localStorage.setItem(HINT_PREFIX + key(t.repo), JSON.stringify(m));
    } catch {
      return;
    }
    listeners.forEach((fn) => fn(t.repo, m));
  }
}

/** Forgets every team's email member in this browser (sign-out, account deleted). */
export function forgetContributors() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(HINT_PREFIX)) localStorage.removeItem(k);
  } catch {
    /* storage blocked: nothing kept */
  }
  infos.clear();
  mines.clear();
  reviews.clear();
  forgetRecent(null);
}

/** The server's one refusal of a write on a demo team (api/contribute demoWriteRefusal): the demo dialog says why. */
export const DEMO_REFUSAL = 'demo';
const openDemoDialog = () => void import('./demo-gate').then(({ openMakeItYours }) => openMakeItYours()).catch(() => undefined);

async function call<T>(method: 'GET' | 'POST', query: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // The server refuses any action without it (CSRF).
  if (method !== 'GET') headers[CONTRIBUTE_HEADER] = '1';
  let res: Response;
  try {
    res = await fetchImpl(`${CONTRIBUTE_API}${query}`, { method, headers, credentials: 'include', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new ContributeError(CONTRIBUTE_WORDS.network, 'network', 0);
  }
  // No function at this address (404, or the static host's HTML page): this site has no email sign-in yet.
  const json = /json/i.test(res.headers.get('content-type') ?? '');
  if (res.status === 404 || res.status === 405 || !json) throw new ContributeUnavailable();
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 503) throw new ContributeUnavailable();
  if (!res.ok) {
    if (data.error === DEMO_REFUSAL) openDemoDialog();
    const message = typeof data.message === 'string' && data.message ? data.message : 'Something went wrong. Try again in a minute.';
    throw new ContributeError(message, typeof data.error === 'string' ? data.error : 'failed', res.status);
  }
  return data as T;
}

export interface ContributeInfo {
  /** This site can sign people in with an email on this team. */
  available: boolean;
  member: ContributeMember | null;
}

const infos = new Map<string, Promise<ContributeInfo>>();
const infoAvailable = new Map<string, boolean>();

/** Whether this site offers email sign-in, and who is signed in with an email on `repo` (one GET per team and page). */
export function contributeInfo(repo: string): Promise<ContributeInfo> {
  const k = key(repo);
  const held = infos.get(k);
  if (held) return held;
  const p = call<{ available?: boolean; member?: unknown }>('GET', `?repo=${encodeURIComponent(repo)}`).then(
    (r) => {
      const info = { available: r.available === true, member: parseMember(r.member) };
      infoAvailable.set(k, info.available);
      remember(repo, info.member);
      return info;
    },
    // Unreachable or not set up: nobody is signed in with an email here, and the page keeps what it showed.
    (err) => {
      if (err instanceof ContributeUnavailable) remember(repo, null);
      infoAvailable.set(k, false);
      return { available: false, member: err instanceof ContributeUnavailable ? null : contributorFor(repo) };
    },
  );
  infos.set(k, p);
  return p;
}

/** A GitHub person of the team, as /api/contribute?members=1 lists them (no email). */
export interface TeamCollaborator {
  login: string;
  avatar_url?: string;
  role_name?: string;
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean };
}

export interface TeamPeople {
  collaborators: TeamCollaborator[];
  /** Email members by name and role; `you` marks the signed-in one. Never another member's email. */
  /** 'admin' only in `npm run dev:full`, for a member seeded as admin (api/_lib/local-admin.ts). */
  /** `ref`: their member reference (blocks name them by it); `lead`: asked to review explorations. */
  members: { name: string; role: 'view' | 'edit' | 'admin'; ref?: string; you?: boolean; lead?: boolean }[];
  /** Each product's product manager (Settings > Products): a GitHub person by login, an email member by reference. */
  pms: Record<string, TeamPm>;
  /** Who looks after the design system (api/_lib/review-mode.ts). */
  reviewMode?: ReviewMode;
}

/** Who looks after the design system: one person, shared with review, shared with no review. */
export type ReviewMode = 'one' | 'shared' | 'shared-none';
const REVIEW_MODES: readonly ReviewMode[] = ['one', 'shared', 'shared-none'];
export const asReviewMode = (v: unknown): ReviewMode => (REVIEW_MODES.includes(v as ReviewMode) ? (v as ReviewMode) : 'one');

/** The team's review facts for Done exploring: its mode, and the member references asked to review (email members). */
export interface TeamReview {
  mode: ReviewMode;
  asked: { ref: string; name: string }[];
  /** Each product's product manager (Settings > Products), by product key. */
  pms?: Record<string, TeamPm>;
}
const reviews = new Map<string, Promise<TeamReview>>();

/**
 * The review facts of `repo`, read once per page (GET ?members=1). Anything that fails reads as before this setting:
 * one person, no email lead known, so the design owners decide as they always did.
 */
export function teamReview(repo: string, githubToken: string | null = null): Promise<TeamReview> {
  const k = key(repo);
  let p = reviews.get(k);
  if (!p) {
    p = contributeTeam(repo, githubToken).then(
      (t) => ({ mode: asReviewMode(t.reviewMode), asked: t.members.filter((m) => m.lead && m.ref).map((m) => ({ ref: m.ref!, name: m.name })), pms: t.pms }),
      () => ({ mode: 'one' as const, asked: [] }),
    );
    reviews.set(k, p);
  }
  return p;
}

/** A product manager as Studio reads them: never an email. */
export type TeamPm = { name: string; login: string } | { name: string; ref: string };

const parsePms = (v: unknown): Record<string, TeamPm> => {
  const out: Record<string, TeamPm> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const p = x as { name?: unknown; login?: unknown; ref?: unknown };
    if (typeof p?.name !== 'string') continue;
    if (typeof p.login === 'string') out[k] = { name: p.name, login: p.login };
    else if (typeof p.ref === 'string') out[k] = { name: p.name, ref: p.ref };
  }
  return out;
};

/**
 * The team's people for a member who cannot list them on GitHub: an email contributor (their session cookie) or a
 * GitHub reader (`githubToken`, checked by the server with GitHub). Settings > Members, read only.
 */
export async function contributeTeam(repo: string, githubToken: string | null = null): Promise<TeamPeople> {
  const r = await call<Partial<TeamPeople>>('GET', `?repo=${encodeURIComponent(repo)}&members=1`, undefined, githubToken ? { Authorization: `Bearer ${githubToken}` } : {});
  const collaborators = Array.isArray(r.collaborators) ? r.collaborators.filter((c): c is TeamCollaborator => Boolean(c && typeof c.login === 'string')) : [];
  const members = Array.isArray(r.members)
    ? r.members
        .filter((m) => m && typeof m.name === 'string')
        .map((m) => ({
          name: m.name.trim() || 'Contributor',
          role: localDevHost() && m.role === 'admin' ? ('admin' as const) : m.role === 'view' ? ('view' as const) : ('edit' as const),
          ...(m.you ? { you: true } : {}),
          ...(typeof m.ref === 'string' && /^[0-9a-f]{16}$/.test(m.ref) ? { ref: m.ref } : {}),
          ...(m.lead === true ? { lead: true } : {}),
        }))
    : [];
  return { collaborators, members, pms: parsePms((r as { pms?: unknown }).pms), reviewMode: asReviewMode(r.reviewMode) };
}

/** Who is the product manager of `product`, or nobody: a lead or an admin of the team (checked by the server). */
export async function setProductPm(repo: string, product: string, pm: { ref: string } | { login: string; name?: string } | null, githubToken: string | null = null): Promise<TeamPm | null> {
  const r = await call<{ pm?: unknown }>('POST', '', { action: 'set-pm', repo, product, pm }, githubToken ? { Authorization: `Bearer ${githubToken}` } : {});
  return parsePms({ x: r.pm }).x ?? null;
}

/** The PM's word on an exploration of their product, or its designer's word that the PM agreed in a call. */
export async function sayPmWord(repo: string, x: { product: string; copy: string; number: number; kind: 'pm-ok' | 'pm-changes' | 'pm-call'; text?: string }, githubToken: string | null = null): Promise<void> {
  await call('POST', '', { action: 'pm-word', repo, ...x }, githubToken ? { Authorization: `Bearer ${githubToken}` } : {});
}

/** Asks for a sign-in link. The server answers the same whether or not the email is on the team. */
export async function requestEmailSignIn(repo: string, email: string): Promise<void> {
  await call('POST', '', { action: 'sign-in', repo, email: email.trim() });
}

/** Spends the link from the email: the server sets the session, and this page is signed in. */
export async function verifyEmailSignIn(repo: string, token: string): Promise<ContributeMember> {
  const r = await call<{ member?: unknown }>('POST', '', { action: 'verify', repo, token });
  const m = parseMember(r.member);
  if (!m) throw new ContributeError(CONTRIBUTE_WORDS.expired, 'expired', 410);
  remember(repo, m);
  return m;
}

/** Ends the email session on `repo`, on the server and in this browser. */
export async function signOutEmail(repo: string): Promise<void> {
  remember(repo, null);
  await call('POST', '', { action: 'sign-out', repo }).catch(() => undefined);
}

/** The session ended on the server (removed from the team, or re-invited): forget it here too. */
export function endedEmailSession(repo: string) {
  remember(repo, null);
}

/** The token of `#contribute=<token>`, taken out of the address at once (never in the history or a shared link). */
export function takeContributeHash(): string | null {
  if (typeof location === 'undefined') return null;
  const token = contributeHashToken(location.hash);
  if (token) history.replaceState(history.state, '', location.pathname + location.search);
  return token;
}

export interface Mine {
  branches: string[];
  issues: number[];
  /** The same, in each product repository of the team (its design copy, its developers' tasks), by repo, lower case. */
  products?: Record<string, { branches: string[]; issues: number[] }>;
}

/** What the member owns in `repo`: the team's own list, or one product repository's (lib/branches-page mineIn). */
export { mineIn };

const mines = new Map<string, Promise<Mine>>();

/** What the signed-in member made through Bridge on `repo` and still owns (one GET per team and page). */
export function contributeMine(repo: string, authorization?: string): Promise<Mine> {
  // A designer signed in with GitHub is known by their token (the server asks GitHub who it is).
  const k = authorization ? `${key(repo)}#gh` : key(repo);
  const held = mines.get(k);
  if (held) return held;
  const p = call<{ branches?: unknown; issues?: unknown; products?: unknown }>('GET', `?repo=${encodeURIComponent(repo)}&mine=1`, undefined, authorization ? { Authorization: authorization } : {}).then(
    (r) => parseMine(r),
    () => ({ branches: [], issues: [] }),
  );
  mines.set(k, p);
  return p;
}

/** The server's "mine" answer, anything malformed left out. */
export function parseMine(r: { branches?: unknown; issues?: unknown; products?: unknown }): Mine {
  const list = (v: { branches?: unknown; issues?: unknown }) => ({
    branches: Array.isArray(v.branches) ? v.branches.filter((b): b is string => typeof b === 'string') : [],
    issues: Array.isArray(v.issues) ? v.issues.filter((n): n is number => typeof n === 'number') : [],
  });
  const products: Record<string, { branches: string[]; issues: number[] }> = {};
  if (r.products && typeof r.products === 'object' && !Array.isArray(r.products)) {
    for (const [repo, v] of Object.entries(r.products as Record<string, unknown>)) {
      if (/^[\w.-]+\/[\w.-]+$/.test(repo) && v && typeof v === 'object') products[repo.toLowerCase()] = list(v as { branches?: unknown; issues?: unknown });
    }
  }
  return { ...list(r), ...(Object.keys(products).length ? { products } : {}) };
}

/** Forgets what was read about "mine" on this page (a new branch or pull request was just made). */
const forgetMine = (repo: string) => {
  mines.delete(key(repo));
  mines.delete(`${key(repo)}#gh`);
};

type Authored = { number?: unknown; user?: { login?: unknown; avatar_url?: unknown } | null; head?: { ref?: unknown } | null };

/**
 * The member's own pull requests and issues, written as theirs: GitHub shows Bridge's app as their author, so every
 * "mine" in Studio (author compared with the viewer: Request review on a draft, your branches, your turn) would miss
 * them. The author becomes the member's login, their email, which is what the session gives as the viewer's login.
 */
export function asMine<T>(data: T, mine: Mine, login: string): T {
  const own = (x: Authored) => (typeof x.number === 'number' && mine.issues.includes(x.number)) || (typeof x.head?.ref === 'string' && mine.branches.includes(x.head.ref));
  const fix = (x: unknown) => {
    if (!x || typeof x !== 'object') return x;
    const a = x as Authored;
    if (!own(a)) return x;
    return { ...a, user: { ...(a.user ?? {}), login, avatar_url: '' } };
  };
  return (Array.isArray(data) ? data.map(fix) : fix(data)) as T;
}

// --- A member's recent reads -------------------------------------------------------------------------------------
// Home, Branches and History read the same pull requests, reviews, files and trees: each one counts against the
// member's read budget on the server (api/_lib/team-read.ts). This tab keeps what it read through the proxy a short
// while, in memory and in sessionStorage (so the next page of the same team reuses it), and shares a read still in
// flight. An answer that cannot change (a tree, blob or commit by its sha, a file at a commit sha) is kept longer.
// Forgotten on any write to the team, on sign-out and when the member changes; never shared between tabs or people.

/** How long a read is reused: most answers, and the ones addressed by a commit or blob sha. */
export const RECENT_MS = 20_000;
export const RECENT_SHA_MS = 10 * 60_000;
const RECENT_PREFIX = 'bridge.read.recent:';
/** Larger bodies stay in memory only (sessionStorage holds a few MB per site). */
const RECENT_MAX_STORED = 200_000;

interface RecentRead {
  at: number;
  status: number;
  headers: [string, string][];
  body: string;
}

const recent = new Map<string, Promise<RecentRead | null>>();
const recentAt = new Map<string, number>();

const SHA40 = '[0-9a-f]{40}';
const UNCHANGING = [new RegExp(`/git/(trees|blobs|commits)/${SHA40}(\\?|$)`), new RegExp(`/commits/${SHA40}$`), new RegExp(`/contents/[^?]+\\?(.*&)?ref=${SHA40}(&|$)`)];

/** How long the answer to `path` (under /repos/owner/name, with its query) may be reused, 0 when never. */
export function recentFor(path: string): number {
  const q = path.indexOf('?');
  if (q >= 0 && new URLSearchParams(path.slice(q + 1)).has('t')) return 0;
  return UNCHANGING.some((r) => r.test(path)) ? RECENT_SHA_MS : RECENT_MS;
}

/** Whose reads these are: the email member, or the login of someone signed in with GitHub (never shared between people). */
const readerOfTab = (repo: string, login?: string) => contributorFor(repo)?.email ?? (login ? `gh:${login.toLowerCase()}` : '');
const recentKey = (repo: string, target: string, accept: string, login?: string) => `${RECENT_PREFIX}${key(repo)}:${readerOfTab(repo, login)}:${accept}|${target}`;

/** Forgets what this tab kept of `repo` (null: of every team). */
export function forgetRecent(repo: string | null) {
  forgetChangeReads(repo);
  const prefix = repo === null ? RECENT_PREFIX : `${RECENT_PREFIX}${key(repo)}:`;
  for (const k of [...recent.keys()]) if (k.startsWith(prefix)) {
    recent.delete(k);
    recentAt.delete(k);
  }
  try {
    if (typeof sessionStorage !== 'undefined') for (const k of Object.keys(sessionStorage)) if (k.startsWith(prefix)) sessionStorage.removeItem(k);
  } catch {
    /* storage blocked: memory only */
  }
}

/** What a new page of the tab starts with: this page's memory gone, the tab's sessionStorage kept (tests). */
export function clearRecentMemory() {
  recent.clear();
  recentAt.clear();
}

function storedRecent(k: string, ttl: number): RecentRead | null {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(k) : null;
    if (!raw) return null;
    const v = JSON.parse(raw) as RecentRead;
    if (!v || typeof v.body !== 'string' || !Array.isArray(v.headers) || Date.now() - v.at > ttl) {
      sessionStorage.removeItem(k);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

const toResponse = (r: RecentRead) => new Response(r.body, { status: r.status, headers: r.headers });

/** A GET of the team through the proxy: this tab's recent answer, a read in flight, or `send` (kept when it is a 200). */
async function recentRead(repo: string, target: string, path: string, headers: Record<string, string>, send: () => Promise<Response>, login?: string): Promise<Response> {
  const ttl = recentFor(path);
  if (!ttl) return send();
  const accept = Object.entries(headers).find(([h]) => h.toLowerCase() === 'accept')?.[1] ?? '';
  const k = recentKey(repo, target, accept, login);
  const at = recentAt.get(k);
  const inMemory = recent.get(k);
  if (inMemory && (at === undefined || Date.now() - at <= ttl)) {
    const r = await inMemory;
    if (r) return toResponse(r);
  }
  const stored = storedRecent(k, ttl);
  if (stored) return toResponse(stored);
  let first: Response | null = null;
  const p = send().then(async (res) => {
    first = res;
    if (res.status !== 200) return null;
    const body = await res.clone().text();
    const kept: RecentRead = { at: Date.now(), status: res.status, headers: [...res.headers.entries()], body };
    recentAt.set(k, kept.at);
    if (body.length <= RECENT_MAX_STORED) {
      try {
        sessionStorage.setItem(k, JSON.stringify(kept));
      } catch {
        /* full or blocked: memory only */
      }
    }
    return kept;
  });
  recent.set(k, p);
  p.then(
    (r) => {
      if (!r && recent.get(k) === p) recent.delete(k);
    },
    () => {
      if (recent.get(k) === p) recent.delete(k);
    },
  );
  const r = await p;
  // The caller that sent it reads its own answer (any status); the others share the kept copy.
  return first && !r ? first : r ? toResponse(r) : send();
}

// --- Change statuses through Bridge -------------------------------------------------------------------------------
// The status of each open change takes five reads (scripts/pr-status.ts pullStatus: the pull request, its reviews and
// files, the check runs and commit status of its head). For a member, the page asks the server once for all its open
// changes (api/_lib/team-read.ts onChanges, which reads each change once and shares it with the team's members for
// 30 s), then those five reads are answered here, for RECENT_MS, in this page's memory only. Forgotten with the rest
// on any write to the team. The nav badge and Home ask for the same changes: one request per batch is in flight per
// page and shared, and a change whose reads are still kept here is not asked again.

const STATUS_ACCEPT = 'application/vnd.github+json';
/** Change reads answered by the server: `<team>|<path under the repository, with its query>`. */
const changeReads = new Map<string, { at: number; status: number; body: string }>();
const CHANGES_PER_REQUEST = 20;
/** Status batches in flight: `<team>|<number:sha,...>`, the request's promise (false: stop asking for this page load). */
const changeBatches = new Map<string, Promise<boolean>>();

function forgetChangeReads(repo: string | null) {
  if (repo === null) {
    changeBatches.clear();
    return changeReads.clear();
  }
  for (const m of [changeReads, changeBatches]) for (const k of [...m.keys()]) if (k.startsWith(`${key(repo)}|`)) m.delete(k);
}

/** Whether the server's reads of change `c` (at its head) are still kept on this page. */
function changeKept(repo: string, c: { number: number; head: { sha: string } }): boolean {
  const recent = (path: string) => {
    const kept = changeReads.get(`${key(repo)}|${path}`);
    return Boolean(kept && Date.now() - kept.at <= RECENT_MS);
  };
  return recent(`/pulls/${c.number}`) && recent(`/commits/${c.head.sha.toLowerCase()}/status`);
}

/** The path of a call under /repos/<repo> (with its query), or null when it is not the team's repository. */
function repoPath(repo: string, path: string): string | null {
  const base = `/repos/${key(repo)}`;
  return path.toLowerCase().startsWith(base) && /^(\/|\?|$)/.test(path.slice(base.length)) ? path.slice(base.length) : null;
}

/** A read the server already answered for this page, as GitHub's answer; null when there is none (or it is old). */
function changeRead(repo: string, path: string, headers: Record<string, string>): Response | null {
  if (!changeReads.size) return null;
  const accept = Object.entries(headers).find(([h]) => h.toLowerCase() === 'accept')?.[1] ?? STATUS_ACCEPT;
  const rel = accept === STATUS_ACCEPT ? repoPath(repo, path) : null;
  const kept = rel === null ? undefined : changeReads.get(`${key(repo)}|${rel.toLowerCase()}`);
  if (!kept || Date.now() - kept.at > RECENT_MS) return null;
  return new Response(kept.body, { status: kept.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/**
 * Asks Bridge for the status reads of these open changes at once, for a member of `repo`: their email session, or
 * `auth`, the Authorization of a GitHub sign-in that reads the team through Bridge (scripts/github-session.ts
 * bridgeReadAuth). Nothing for anyone else. Never throws: a change the server left out is read on its own, as before.
 */
export async function prefetchChangeStatuses(repo: string, changes: readonly { number: number; head: { sha: string } }[], auth0: string | null = null): Promise<void> {
  const email = Boolean(contributorFor(repo));
  const auth = email ? null : auth0;
  if (!email && !auth) return;
  const list = changes.filter((c) => /^[0-9a-f]{40}$/.test(c.head.sha) && !changeKept(repo, c));
  for (let i = 0; i < list.length; i += CHANGES_PER_REQUEST) {
    const part = list.slice(i, i + CHANGES_PER_REQUEST);
    const id = `${key(repo)}|${part.map((c) => `${c.number}:${c.head.sha}`).join(',')}`;
    let going = changeBatches.get(id);
    if (!going) {
      const p: Promise<boolean> = sendChangeBatch(repo, part, auth, email).finally(() => {
        if (changeBatches.get(id) === p) changeBatches.delete(id);
      });
      changeBatches.set(id, p);
      going = p;
    }
    if (!(await going)) return;
  }
}

/** One status request; false when the server said no (the page then reads each change on its own). Never throws. */
async function sendChangeBatch(repo: string, part: readonly { number: number; head: { sha: string } }[], auth: string | null, email: boolean): Promise<boolean> {
  try {
    const res = await fetchImpl(`${CONTRIBUTE_API}?repo=${encodeURIComponent(repo)}&changes=${part.map((c) => `${c.number}:${c.head.sha}`).join(',')}`, { headers: { Accept: 'application/json', ...(auth ? { Authorization: auth } : {}) }, credentials: 'same-origin' });
    if (res.status === 401 && email) endedEmailSession(repo);
    if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return false;
    const data = (await res.json()) as { changes?: Record<string, Record<string, { status?: unknown; body?: unknown }>> };
    const at = Date.now();
    for (const reads of Object.values(data.changes ?? {})) {
      for (const [path, r] of Object.entries(reads ?? {})) {
        if (!path.startsWith('/') || (r?.status !== 200 && r?.status !== 404) || typeof r.body !== 'string') continue;
        changeReads.set(`${key(repo)}|${path.toLowerCase()}`, { at, status: r.status, body: r.body });
      }
    }
    return true;
  } catch {
    return false;
  }
}

// --- People through Bridge -----------------------------------------------------------------------------------------
// An email member has no GitHub account: their page used to read the builders' and reviewers' profiles from GitHub
// anonymously (60 an hour per address, shared with the office), so names fell back to logins. The server answers the
// public name and avatar for members (api/_lib/team-read.ts onUsers), several logins per request, kept a day there.

const USER_URL = /^https:\/\/api\.github\.com\/users\/([^/?#]+)$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
/** Per team and login on this page: the profile answer (null: ask GitHub as before). */
const profiles = new Map<string, Promise<Response | null>>();
let askProfiles = new Map<string, Map<string, (r: Response | null) => void>>();

async function sendProfiles(repo: string, wanted: Map<string, (r: Response | null) => void>, auth?: string) {
  const logins = [...wanted.keys()];
  for (let i = 0; i < logins.length; i += 30) {
    const part = logins.slice(i, i + 30);
    let users: Record<string, unknown> | null = null;
    try {
      const res = await fetchImpl(`${CONTRIBUTE_API}?repo=${encodeURIComponent(repo)}&users=${part.map(encodeURIComponent).join(',')}`, { headers: { Accept: 'application/json', ...(auth ? { Authorization: auth } : {}) }, credentials: 'same-origin' });
      if (res.status === 401 && !auth) endedEmailSession(repo);
      if (res.ok && /json/i.test(res.headers.get('content-type') ?? '')) users = ((await res.json()) as { users?: Record<string, unknown> }).users ?? null;
    } catch {
      users = null;
    }
    for (const l of part) {
      const done = wanted.get(l)!;
      if (!users || !(l in users)) done(null);
      else if (users[l] === null) done(Response.json({ message: 'Not Found' }, { status: 404 }));
      else done(Response.json(users[l]));
    }
  }
}

/**
 * The public profile of `login` as GitHub's /users answer, read through Bridge with the other logins of this tick.
 * `auth`: a GitHub sign-in's Authorization, proof of who reads (an email member's session cookie needs none).
 */
function memberProfile(repo: string, login: string, auth?: string): Promise<Response | null> {
  if (!LOGIN.test(login)) return Promise.resolve(null);
  const k = `${key(repo)}:${login.toLowerCase()}`;
  const kept = profiles.get(k);
  if (kept) return kept.then((r) => r?.clone() ?? null);
  const p = new Promise<Response | null>((resolve) => {
    let team = askProfiles.get(key(repo));
    if (!team) {
      team = new Map();
      askProfiles.set(key(repo), team);
      queueMicrotask(() => {
        const wanted = askProfiles.get(key(repo));
        askProfiles.delete(key(repo));
        if (wanted) void sendProfiles(repo, wanted, auth);
      });
    }
    team.set(login.toLowerCase(), resolve);
  });
  // A login the server could not answer for is asked again next time.
  profiles.set(k, p);
  void p.then((r) => {
    if (!r) profiles.delete(k);
  });
  return p.then((r) => r?.clone() ?? null);
}

/** Calls whose answer holds pull requests or issues: their authors may be the member's. */
const AUTHORED = /^\/repos\/[^/]+\/[^/]+\/(pulls|issues)(\/\d+)?(\?|$)/;

/** The repository an api.github.com path is under ("owner/name", lower case), or null. */
const repoOfPath = (path: string): string | null => {
  const m = /^\/repos\/([^/]+)\/([^/?#]+)/.exec(path);
  return m ? `${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}`.toLowerCase() : null;
};

/** Strips the stand-in Authorization header (any case) from a header record. */
/** A designer signed in with GitHub, for contributeFetch: their `Authorization` header and their login. */
export interface DesignerAuth {
  authorization: string;
  login: string;
  /**
   * Someone on the team who only reads the products through Bridge (a lead or an admin: lib/write-route
   * productReadRoute). Bridge writes nothing for them, so nothing is "theirs" to mark.
   */
  reader?: boolean;
}

function withoutAuth(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() !== 'authorization') out[k] = v;
  return out;
}

/**
 * fetch for an email contributor on `repo`: a call to the team's repository on api.github.com goes to the proxy, same
 * method and body, with the session cookie; any other call goes out as a guest. A 401 from the proxy means the
 * session ended: it is forgotten here and the page shows the signed-out state.
 */
export async function contributeFetch(repo: string, url: string, init: RequestInit = {}, products: readonly string[] = [], as?: DesignerAuth): Promise<Response> {
  // A designer signed in with GitHub (lib/write-route productRouteFor): their GitHub token goes along as proof of who
  // they are; the proxy asks GitHub, then writes with the Bridge app under the designers' policy.
  const headers = { ...withoutAuth((init.headers ?? {}) as Record<string, string>), ...(as ? { Authorization: as.authorization } : {}) };
  // A call in one of the team's product repositories goes through the team's proxy too: reads under its allow-list,
  // writes only where the proxy lets an email designer explore (their exploration in the design copy, its task).
  const target = proxyUrl(url, repo, products);
  if (!target) {
    // A person's public profile (names on Being built, History, branch pages): through Bridge, as a member.
    const user = (init.method ?? 'GET').toUpperCase() === 'GET' ? USER_URL.exec(url) : null;
    if (user) {
      const answer = await memberProfile(repo, decodeURIComponent(user[1]!), as?.authorization);
      if (answer) return answer;
    }
    return fetchImpl(url, { ...init, headers });
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.slice(GITHUB_API.length);
  const authored = method === 'GET' && !as?.reader && AUTHORED.test(path);
  // A new branch, pull request or issue: "mine" is read again next time.
  if (method === 'POST' && /\/(git\/refs|pulls|issues)(\?|$)/.test(path)) forgetMine(repo);
  // Any write: what this tab kept of the team is read again.
  if (method !== 'GET') forgetRecent(repo);
  // A GitHub sign-in's read shortly after this tab wrote to GitHub itself (lib/token-session readCacheMode): neither
  // this tab's copy nor Bridge's fresh one; Bridge checks with GitHub again (FRESH_HEADER, members only). An email
  // member's writes go through Bridge, which forgets its copies by itself (api/_lib/team-read.ts noteWrite).
  const fresh = Boolean(as) && method === 'GET' && wantsFresh(init.cache);
  const send = () => fetchImpl(target, { ...init, headers: { ...headers, [CONTRIBUTE_HEADER]: '1', ...(method === 'GET' ? { [MISSING_HEADER]: '1' } : {}), ...(fresh ? { [FRESH_HEADER]: '1' } : {}) }, credentials: 'same-origin' });
  // The status reads of an open change the server answered for the whole list (prefetchChangeStatuses).
  const answered = method === 'GET' && !fresh ? changeRead(repo, path, headers) : null;
  const [res, mine] = await Promise.all([
    answered ? Promise.resolve(answered) : (method === 'GET' && !fresh ? recentRead(repo, target, path, headers, send, as?.login) : send()).then(restoreMissing),
    authored ? contributeMine(repo, as?.authorization) : Promise.resolve(null),
  ]);
  if (res.status === 401 && !as) endedEmailSession(repo);
  const login = as ? as.login : contributorFor(repo)?.email;
  // A read in a product repository counts the member's work there (their copy explorations, their tasks), not the
  // team's: the same numbers mean other things in another repository.
  const own = mine ? mineIn(mine, repoOfPath(path) ?? repo, repo) : null;
  if (res.ok && own && login && (own.issues.length || own.branches.length)) {
    const data = (await res
      .clone()
      .json()
      .catch(() => undefined)) as unknown;
    if (data !== undefined) return new Response(JSON.stringify(asMine(data, own, login)), { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  // Bridge's own refusals ({ error, message }: a file outside design files, the app missing a permission, the daily
  // limit, an ended session) are said in the server's words, as they are: a GitHubError the core client keeps, so no
  // GitHub wording replaces them.
  // GitHub's own answers never carry `error` and pass through unchanged.
  if (!res.ok && /json/i.test(res.headers.get('content-type') ?? '')) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { error?: unknown; message?: unknown; retryAfter?: unknown } | null;
    // Bridge busy: when it is back (retryAfter), so the page says the time and reads again then (lib/github-busy).
    const wait = body?.error === 'busy' ? (typeof body.retryAfter === 'number' ? body.retryAfter : Number(res.headers.get('retry-after'))) : NaN;
    const busy = Number.isFinite(wait) && wait > 0 ? { resetsAt: new Date(Date.now() + wait * 1000) } : {};
    if (body?.error === DEMO_REFUSAL) openDemoDialog();
    if (body && typeof body.error === 'string' && typeof body.message === 'string' && body.message) throw new GitHubError(res.status, body.message, `${CONTRIB_REFUSAL}${body.error}`, busy);
  }
  return res;
}

// --- Reads through Bridge (api/_lib/team-read.ts) -----------------------------------------------------------------
// A member's reads already go through the proxy above (contributeFetch). Two more pieces: many blobs at once for a
// member (the design system loads in a few requests instead of one per file), and the public demo teams for a visitor
// without GitHub (Bridge's GitHub App reads them, cached, instead of this browser's 60 anonymous reads an hour).

/**
 * Reads blobs of `repo` in one request through Bridge, for an email member (their session cookie): the text of each
 * sha, null for one GitHub does not have; shas the server left for later are not in the answer (read them alone).
 * Throws when the server refuses (the caller reads each blob on its own then).
 */
export function contributeBlobs(repo: string): (shas: string[]) => Promise<Record<string, string | null>> {
  return async (shas) => {
    const res = await fetchImpl(`${CONTRIBUTE_API}?repo=${encodeURIComponent(repo)}&blobs=${shas.join(',')}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (res.status === 401) endedEmailSession(repo);
    if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) throw new ContributeError(CONTRIBUTE_WORDS.network, 'blobs', res.status);
    const data = (await res.json()) as { blobs?: Record<string, unknown> };
    const out: Record<string, string | null> = {};
    for (const [sha, text] of Object.entries(data.blobs ?? {})) if (typeof text === 'string' || text === null) out[sha] = text;
    return out;
  };
}

/** Per team on this page: Bridge cannot read it for visitors (not set up, the app missing): go to GitHub directly. */
const publicReads = new Map<string, 'down'>();

/**
 * A visitor's read of a public demo team (lib/demo.ts DEMO_REPOS) through Bridge: the server's answer, or null when
 * this read should go to GitHub as before (another team, another call, or Bridge cannot read it here). Bridge's own
 * limit throws a GitHubError with its sentence ("Bridge is busy, try again in N min."), never GitHub's token advice.
 */
export async function publicTeamRead(repo: string, url: string, accept: string, products: readonly string[] = []): Promise<Response | null> {
  if (!isDemoRepo(repo) || publicReads.get(key(repo)) === 'down') return null;
  const target = proxyUrl(url, repo, products);
  if (!target) return null;
  // A product repository Bridge said is private, for a visitor: GitHub would not show it either. Answer as GitHub
  // would, without asking anyone again (no refusal, then no missing page, on every page a visitor opens).
  const product = repoOfPath(url.slice(GITHUB_API.length));
  const ownRead = !product || product === key(repo);
  if (!ownRead && closedForVisitors(product)) return closedAnswer();
  let res: Response;
  try {
    res = restoreMissing(await fetchImpl(target, { headers: { Accept: accept || 'application/vnd.github+json', [MISSING_HEADER]: '1' }, credentials: 'same-origin' }));
  } catch {
    return null;
  }
  // No function here (the static host's page, an older deploy): GitHub directly for the rest of the page.
  if (!/json|vnd\.github|text\/plain/i.test(res.headers.get('content-type') ?? '') || res.status === 405) {
    publicReads.set(key(repo), 'down');
    return null;
  }
  if (res.ok || res.status === 304) return res;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: unknown; message?: unknown; retryAfter?: unknown } | null;
  const code = typeof body?.error === 'string' ? body.error : null;
  // GitHub's own answer (a 404 of a missing file): as it is.
  if (!code) return res;
  if (code === 'busy') {
    const wait = typeof body?.retryAfter === 'number' ? body.retryAfter : null;
    throw new GitHubError(429, typeof body?.message === 'string' ? body.message : 'Bridge is busy, try again in a few minutes.', `${CONTRIB_REFUSAL}busy`, wait ? { resetsAt: new Date(Date.now() + wait * 1000) } : {});
  }
  // A product repository that is not public: a visitor cannot read it on GitHub either, so no second try there.
  if (code === 'not-allowed' && !ownRead) {
    noteClosedForVisitors(product);
    return closedAnswer();
  }
  // The app missing on one product repository leaves that product out, never the team's other reads.
  if (code !== 'not-allowed' && code !== 'product_missing') publicReads.set(key(repo), 'down');
  return null;
}

/** How long this browser remembers that a demo's product repository is closed to visitors. */
export const CLOSED_PRODUCT_MS = 24 * 60 * 60 * 1000;
const CLOSED_KEY = 'bridge.guest.closed-products';

function closedProducts(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** A demo's product repository Bridge said visitors cannot read, in the last day. */
export function closedForVisitors(repo: string, now = Date.now()): boolean {
  const at = closedProducts()[repo.toLowerCase()];
  return typeof at === 'number' && now - at < CLOSED_PRODUCT_MS;
}

function noteClosedForVisitors(repo: string) {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify({ ...closedProducts(), [repo.toLowerCase()]: Date.now() }));
  } catch {
    /* storage blocked: this page asks again next time */
  }
}

/** GitHub's own answer for a repository the reader cannot see. */
const closedAnswer = () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Bridge-Source': 'closed' } });

/** What Bridge's server says about the check of the developers' build (board R4), and the Design check it keeps. */
export interface BuildStateRead {
  state: 'pending' | 'success' | 'failure';
  rows: { role: 'designer' | 'pm' | 'lead'; required: boolean; state: 'looks-right' | 'changes' | 'waiting'; byName?: string; text?: string; why?: 'build' | 'design' }[];
  role: 'designer' | 'pm' | 'lead' | null;
  pull: { number: number; url: string };
}

type BuildTarget = { product: string; copy: string; number: number };

export async function buildState(repo: string, x: BuildTarget, githubToken: string | null = null): Promise<BuildStateRead> {
  return call<BuildStateRead>('POST', '', { action: 'build-state', repo, ...x }, githubToken ? { Authorization: `Bearer ${githubToken}` } : {});
}

export async function sayBuild(repo: string, x: BuildTarget & { kind: 'looks-right' | 'changes'; why?: 'build' | 'design'; text?: string }, githubToken: string | null = null): Promise<BuildStateRead> {
  return call<BuildStateRead>('POST', '', { action: 'build-word', repo, ...x }, githubToken ? { Authorization: `Bearer ${githubToken}` } : {});
}

/** Where the check of each developers' build stands, for the lists (keys "owner/repo#number"); null when not opened yet. */
export async function buildChecks(repo: string, pulls: readonly { code: string; number: number }[], githubToken: string | null = null): Promise<Record<string, { state: 'pending' | 'success' | 'failure'; waiting: string[]; changesBy: string | null } | null>> {
  const r = await call<{ checks?: Record<string, unknown> }>('POST', '', { action: 'build-checks', repo, pulls }, githubToken ? { Authorization: `Bearer ${githubToken}` } : {});
  return (r.checks ?? {}) as Record<string, { state: 'pending' | 'success' | 'failure'; waiting: string[]; changesBy: string | null } | null>;
}
