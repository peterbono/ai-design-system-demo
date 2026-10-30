// The browser side of /api/contribute (lib/contribute.ts says what an email contributor is). It reads whether this
// visitor has an email session on a team (GET, once per team and page), signs in with an email, spends the link from
// the email (#contribute=<token>, out of the address at once), signs out, accepts a "Can edit" invite with a name, and
// sends GitHub calls through the proxy. The session itself is an httpOnly cookie this page never sees: only the
// member (email, name) is kept in this browser, so a team page knows at once that someone is signed in, and it is
// checked with the server on every page.
// scripts/github-session.ts uses it: getToken() gives the stand-in token (lib/contribute CONTRIB_TOKEN) to every
// feature, and the session's fetch sends each call that carries it here (contributeFetch). No feature changes.
import { GitHubError } from '@bridge-ds/core';
import { CONTRIB_REFUSAL, CONTRIBUTE_API, GITHUB_API, CONTRIBUTE_HEADER, CONTRIBUTE_WORDS, contributeHashToken, localDevHost, MISSING_HEADER, parseMember, proxyUrl, restoreMissing, type ContributeMember } from '../lib/contribute';
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
    const m = parseMember({ email: account.email, name: account.name ?? '', role: t.role === 'admin' ? 'admin' : 'edit' });
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
  forgetRecent(null);
}

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
  members: { name: string; role: 'edit' | 'admin'; you?: boolean }[];
}

/**
 * The team's people for a member who cannot list them on GitHub: an email contributor (their session cookie) or a
 * GitHub reader (`githubToken`, checked by the server with GitHub). Settings > Members, read only.
 */
export async function contributeTeam(repo: string, githubToken: string | null = null): Promise<TeamPeople> {
  const r = await call<Partial<TeamPeople>>('GET', `?repo=${encodeURIComponent(repo)}&members=1`, undefined, githubToken ? { Authorization: `Bearer ${githubToken}` } : {});
  const collaborators = Array.isArray(r.collaborators) ? r.collaborators.filter((c): c is TeamCollaborator => Boolean(c && typeof c.login === 'string')) : [];
  const members = Array.isArray(r.members)
    ? r.members.filter((m) => m && typeof m.name === 'string').map((m) => ({ name: m.name.trim() || 'Contributor', role: localDevHost() && m.role === 'admin' ? ('admin' as const) : ('edit' as const), ...(m.you ? { you: true } : {}) }))
    : [];
  return { collaborators, members };
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
}

const mines = new Map<string, Promise<Mine>>();

/** What the signed-in member made through Bridge on `repo` and still owns (one GET per team and page). */
export function contributeMine(repo: string): Promise<Mine> {
  const k = key(repo);
  const held = mines.get(k);
  if (held) return held;
  const p = call<{ branches?: unknown; issues?: unknown }>('GET', `?repo=${encodeURIComponent(repo)}&mine=1`).then(
    (r) => ({
      branches: Array.isArray(r.branches) ? r.branches.filter((b): b is string => typeof b === 'string') : [],
      issues: Array.isArray(r.issues) ? r.issues.filter((n): n is number => typeof n === 'number') : [],
    }),
    () => ({ branches: [], issues: [] }),
  );
  mines.set(k, p);
  return p;
}

/** Forgets what was read about "mine" on this page (a new branch or pull request was just made). */
const forgetMine = (repo: string) => mines.delete(key(repo));

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

const recentKey = (repo: string, target: string, accept: string) => `${RECENT_PREFIX}${key(repo)}:${contributorFor(repo)?.email ?? ''}:${accept}|${target}`;

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
async function recentRead(repo: string, target: string, path: string, headers: Record<string, string>, send: () => Promise<Response>): Promise<Response> {
  const ttl = recentFor(path);
  if (!ttl) return send();
  const accept = Object.entries(headers).find(([h]) => h.toLowerCase() === 'accept')?.[1] ?? '';
  const k = recentKey(repo, target, accept);
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
// on any write to the team.

const STATUS_ACCEPT = 'application/vnd.github+json';
/** Change reads answered by the server: `<team>|<path under the repository, with its query>`. */
const changeReads = new Map<string, { at: number; status: number; body: string }>();
const CHANGES_PER_REQUEST = 20;

function forgetChangeReads(repo: string | null) {
  if (repo === null) return changeReads.clear();
  for (const k of [...changeReads.keys()]) if (k.startsWith(`${key(repo)}|`)) changeReads.delete(k);
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
 * Asks Bridge for the status reads of these open changes at once, for a member of `repo` (their session); nothing for
 * anyone else. Never throws: a change the server left out is read on its own, as before.
 */
export async function prefetchChangeStatuses(repo: string, changes: readonly { number: number; head: { sha: string } }[]): Promise<void> {
  if (!contributorFor(repo)) return;
  const list = changes.filter((c) => /^[0-9a-f]{40}$/.test(c.head.sha));
  for (let i = 0; i < list.length; i += CHANGES_PER_REQUEST) {
    const part = list.slice(i, i + CHANGES_PER_REQUEST);
    try {
      const res = await fetchImpl(`${CONTRIBUTE_API}?repo=${encodeURIComponent(repo)}&changes=${part.map((c) => `${c.number}:${c.head.sha}`).join(',')}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (res.status === 401) endedEmailSession(repo);
      if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return;
      const data = (await res.json()) as { changes?: Record<string, Record<string, { status?: unknown; body?: unknown }>> };
      const at = Date.now();
      for (const reads of Object.values(data.changes ?? {})) {
        for (const [path, r] of Object.entries(reads ?? {})) {
          if (!path.startsWith('/') || (r?.status !== 200 && r?.status !== 404) || typeof r.body !== 'string') continue;
          changeReads.set(`${key(repo)}|${path.toLowerCase()}`, { at, status: r.status, body: r.body });
        }
      }
    } catch {
      return;
    }
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

async function sendProfiles(repo: string, wanted: Map<string, (r: Response | null) => void>) {
  const logins = [...wanted.keys()];
  for (let i = 0; i < logins.length; i += 30) {
    const part = logins.slice(i, i + 30);
    let users: Record<string, unknown> | null = null;
    try {
      const res = await fetchImpl(`${CONTRIBUTE_API}?repo=${encodeURIComponent(repo)}&users=${part.map(encodeURIComponent).join(',')}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (res.status === 401) endedEmailSession(repo);
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

/** The public profile of `login` as GitHub's /users answer, read through Bridge with the other logins of this tick. */
function memberProfile(repo: string, login: string): Promise<Response | null> {
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
        if (wanted) void sendProfiles(repo, wanted);
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

/** Strips the stand-in Authorization header (any case) from a header record. */
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
export async function contributeFetch(repo: string, url: string, init: RequestInit = {}, products: readonly string[] = []): Promise<Response> {
  const headers = withoutAuth((init.headers ?? {}) as Record<string, string>);
  // A read of one of the team's product repositories goes through the team's proxy too; writes there never do.
  const target = proxyUrl(url, repo, (init.method ?? 'GET').toUpperCase() === 'GET' ? products : []);
  if (!target) {
    // A person's public profile (names on Being built, History, branch pages): through Bridge, as a member.
    const user = (init.method ?? 'GET').toUpperCase() === 'GET' ? USER_URL.exec(url) : null;
    if (user) {
      const answer = await memberProfile(repo, decodeURIComponent(user[1]!));
      if (answer) return answer;
    }
    return fetchImpl(url, { ...init, headers });
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.slice(GITHUB_API.length);
  const authored = method === 'GET' && AUTHORED.test(path);
  // A new branch, pull request or issue: "mine" is read again next time.
  if (method === 'POST' && /\/(git\/refs|pulls|issues)(\?|$)/.test(path)) forgetMine(repo);
  // Any write: what this tab kept of the team is read again.
  if (method !== 'GET') forgetRecent(repo);
  const send = () => fetchImpl(target, { ...init, headers: { ...headers, [CONTRIBUTE_HEADER]: '1', ...(method === 'GET' ? { [MISSING_HEADER]: '1' } : {}) }, credentials: 'same-origin' });
  // The status reads of an open change the server answered for the whole list (prefetchChangeStatuses).
  const answered = method === 'GET' ? changeRead(repo, path, headers) : null;
  const [res, mine] = await Promise.all([
    answered ? Promise.resolve(answered) : (method === 'GET' ? recentRead(repo, target, path, headers, send) : send()).then(restoreMissing),
    authored ? contributeMine(repo) : Promise.resolve(null),
  ]);
  if (res.status === 401) endedEmailSession(repo);
  const login = contributorFor(repo)?.email;
  if (res.ok && mine && login && (mine.issues.length || mine.branches.length)) {
    const data = (await res
      .clone()
      .json()
      .catch(() => undefined)) as unknown;
    if (data !== undefined) return new Response(JSON.stringify(asMine(data, mine, login)), { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  // Bridge's own refusals ({ error, message }: a file outside design files, the app missing a permission, the daily
  // limit, an ended session) are said in the server's words, as they are: a GitHubError the core client keeps, so no
  // GitHub wording replaces them.
  // GitHub's own answers never carry `error` and pass through unchanged.
  if (!res.ok && /json/i.test(res.headers.get('content-type') ?? '')) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { error?: unknown; message?: unknown } | null;
    if (body && typeof body.error === 'string' && typeof body.message === 'string' && body.message) throw new GitHubError(res.status, body.message, `${CONTRIB_REFUSAL}${body.error}`);
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
  // The app missing on one product repository leaves that product out, never the team's other reads.
  if (code !== 'not-allowed' && code !== 'product_missing') publicReads.set(key(repo), 'down');
  return null;
}
