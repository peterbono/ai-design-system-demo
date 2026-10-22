// The browser side of /api/contribute (lib/contribute.ts says what an email contributor is). It reads whether this
// visitor has an email session on a team (GET, once per team and page), signs in with an email, spends the link from
// the email (#contribute=<token>, out of the address at once), signs out, accepts a "Can edit" invite with a name, and
// sends GitHub calls through the proxy. The session itself is an httpOnly cookie this page never sees: only the
// member (email, name) is kept in this browser, so a team page knows at once that someone is signed in, and it is
// checked with the server on every page.
// scripts/github-session.ts uses it: getToken() gives the stand-in token (lib/contribute CONTRIB_TOKEN) to every
// feature, and the session's fetch sends each call that carries it here (contributeFetch). No feature changes.
import { CONTRIBUTE_API, CONTRIBUTE_HEADER, CONTRIBUTE_WORDS, contributeHashToken, parseMember, proxyUrl, type ContributeMember, type InvitePeek } from '../lib/contribute';

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
}

const HINT_PREFIX = 'bridge.contribute.member:';
const key = (repo: string) => repo.toLowerCase();

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

async function call<T>(method: 'GET' | 'POST', query: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
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

/** What an invite link is before it is accepted, or null when the server cannot say (the page then offers both ways). */
export async function peekInvite(token: string): Promise<InvitePeek | null> {
  try {
    const r = await call<Record<string, unknown>>('POST', '', { action: 'peek', token });
    const role = r.role;
    if (typeof r.repo !== 'string' || (role !== 'view' && role !== 'edit' && role !== 'reviewer' && role !== 'admin')) return null;
    return { repo: r.repo, role, ...(typeof r.team === 'string' ? { team: r.team } : {}), ...(typeof r.sentTo === 'string' ? { sentTo: r.sentTo } : {}) };
  } catch (err) {
    if (err instanceof ContributeError && err.status === 410) throw err;
    return null;
  }
}

/** Accepts a "Can edit" invite with a name: no GitHub. 409 github-required for a reviewer or admin invite. */
export async function acceptEmailInvite(token: string, name: string): Promise<{ repo: string; member: ContributeMember }> {
  const r = await call<{ repo?: unknown; member?: unknown }>('POST', '', { action: 'accept', token, name: name.trim() });
  const m = parseMember(r.member);
  if (typeof r.repo !== 'string' || !m) throw new ContributeError('Something went wrong. Try again in a minute.', 'failed', 500);
  remember(r.repo, m);
  return { repo: r.repo, member: m };
}

/** The token of `#contribute=<token>`, taken out of the address at once (never in the history or a shared link). */
export function takeContributeHash(): string | null {
  if (typeof location === 'undefined') return null;
  const token = contributeHashToken(location.hash);
  if (token) history.replaceState(history.state, '', location.pathname + location.search);
  return token;
}

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
  const res = await fetchImpl(target, { ...init, headers: { ...headers, [CONTRIBUTE_HEADER]: '1' }, credentials: 'same-origin' });
  if (res.status === 401) endedEmailSession(repo);
  return res;
}
