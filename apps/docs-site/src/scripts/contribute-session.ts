// The browser side of /api/contribute (lib/contribute.ts says what an email contributor is). It reads whether this
// visitor has an email session on a team (GET, once per team and page), signs in with an email, spends the link from
// the email (#contribute=<token>, out of the address at once), signs out, accepts a "Can edit" invite with a name, and
// sends GitHub calls through the proxy. The session itself is an httpOnly cookie this page never sees: only the
// member (email, name) is kept in this browser, so a team page knows at once that someone is signed in, and it is
// checked with the server on every page.
// scripts/github-session.ts uses it: getToken() gives the stand-in token (lib/contribute CONTRIB_TOKEN) to every
// feature, and the session's fetch sends each call that carries it here (contributeFetch). No feature changes.
import { GitHubError } from '@bridge-ds/core';
import { CONTRIB_REFUSAL, CONTRIBUTE_API, GITHUB_API, CONTRIBUTE_HEADER, CONTRIBUTE_WORDS, contributeHashToken, localDevHost, parseMember, proxyUrl, type ContributeMember } from '../lib/contribute';

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
export async function contributeFetch(repo: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = withoutAuth((init.headers ?? {}) as Record<string, string>);
  const target = proxyUrl(url, repo);
  if (!target) return fetchImpl(url, { ...init, headers });
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.slice(GITHUB_API.length);
  const authored = method === 'GET' && AUTHORED.test(path);
  // A new branch, pull request or issue: "mine" is read again next time.
  if (method === 'POST' && /\/(git\/refs|pulls|issues)(\?|$)/.test(path)) forgetMine(repo);
  const [res, mine] = await Promise.all([
    fetchImpl(target, { ...init, headers: { ...headers, [CONTRIBUTE_HEADER]: '1' }, credentials: 'same-origin' }),
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
