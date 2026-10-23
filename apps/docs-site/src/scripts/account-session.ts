// The browser side of /api/account (lib/account.ts says what an account is). It reads who is signed in (one GET per
// page, shared by every island), sends and checks the 6-digit code, signs in with a GitHub token, renames, signs out
// and deletes. The session is an httpOnly cookie this page never sees. When the site has no account server (an older
// deploy, a fork, `astro dev`) the GET says unavailable and the screens fall back to GitHub; never a fake success.
// Signed in, <html data-account> is set so the GitHub-only account blocks step aside (styles/account.css).
import { ACCOUNT_API, ACCOUNT_HEADER, ACCOUNT_WORDS, accountErrorText, GITHUB_PENDING_KEY, isPersonalKey, parseAccount, parseBlocked, signInHref, type Account, type AccountInfo, type BlockedTeam, type SignedIn } from '../lib/account';
import { forgetContributors, seedContributors } from './contribute-session';
import { isContribAuth } from '../lib/contribute';
import { noteAccountTeamNames } from '../lib/recent-teams';

/** The site has no account server, or it is not set up. */
export class AccountUnavailable extends Error {
  constructor() {
    super(ACCOUNT_WORDS.unavailable);
    this.name = 'AccountUnavailable';
  }
}

/** The server refused or failed, with a sentence a designer can act on. */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    /** The rest of the answer: `triesLeft` on a wrong code. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: Fetch = (input, init) => fetch(input, init);
let info: Promise<AccountInfo> | null = null;
const listeners = new Set<(a: Account | null) => void>();

/** Tests swap the network. Also forgets what this page read. */
export function setAccountFetch(f: Fetch | null) {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
  info = null;
}

/** Called with the account whenever this page learns who is signed in, or that nobody is. Returns the unsubscribe. */
export function onAccountChange(fn: (a: Account | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function publish(a: Account | null) {
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-account', Boolean(a));
  // Each of the account's email teams knows its member at once, even one this browser never opened.
  if (a) seedContributors(a, a.teams);
  listeners.forEach((fn) => fn(a));
}

async function call<T>(method: 'GET' | 'POST', query: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers[ACCOUNT_HEADER] = '1';
  let res: Response;
  try {
    res = await fetchImpl(`${ACCOUNT_API}${query}`, { method, headers, credentials: 'same-origin', cache: 'no-store', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new AccountError(ACCOUNT_WORDS.network, 'network', 0);
  }
  // No function at this address (404, or the static host's HTML page): this site has no accounts yet.
  const json = /json/i.test(res.headers.get('content-type') ?? '');
  if (res.status === 404 || res.status === 405 || !json) throw new AccountUnavailable();
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 503) throw new AccountUnavailable();
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : 'failed';
    const message = typeof data.message === 'string' && data.message ? data.message : null;
    throw new AccountError(accountErrorText(res.status, code, message), code, res.status, data);
  }
  return data as T;
}

/** Who is signed in, and whether the site has accounts at all. One GET per page unless `fresh`. */
export function getAccount(fresh = false): Promise<AccountInfo> {
  if (info && !fresh) return info;
  info = call<{ available?: boolean; account?: unknown }>('GET', '').then(
    (r) => {
      const a = parseAccount(r.account);
      // The server answered: its team names name each team from the first paint of the next page.
      noteAccountTeamNames(a?.teams ?? null);
      publish(a);
      return { available: r.available !== false, account: a };
    },
    () => {
      publish(null);
      return { available: false, account: null };
    },
  );
  return info;
}

function signedIn(r: { account?: unknown; created?: unknown; next?: unknown }): SignedIn {
  const account = parseAccount(r.account);
  if (!account) throw new AccountError(ACCOUNT_WORDS.failed, 'failed', 500);
  info = Promise.resolve({ available: true, account });
  noteAccountTeamNames(account.teams);
  publish(account);
  return { account, created: r.created === true, next: typeof r.next === 'string' ? r.next : '' };
}

/** Who a code is for: an email typed, or an invite link's token (the code goes to the invited address, never shown). */
export type CodeFor = string | { invite: string };

const codeTarget = (to: CodeFor) => (typeof to === 'string' ? { email: to.trim() } : { invite: to.invite });

/** Emails a 6-digit code. The server answers the same whether or not the email has an account. */
export async function sendCode(to: CodeFor): Promise<void> {
  await call('POST', '', { action: 'code', ...codeTarget(to) });
}

/** Checks the code; sets the session cookie. */
export async function verifyCode(to: CodeFor, code: string, name?: string): Promise<SignedIn> {
  return signedIn(await call('POST', '', { action: 'verify', ...codeTarget(to), code, ...(name ? { name } : {}) }));
}

/** Signs in with (or links) the GitHub account of a GitHub sign-in token; the token is not kept by the server. */
export async function signInWithGitHub(token: string): Promise<SignedIn> {
  return signedIn(await call('POST', '', { action: 'github', token }));
}

async function update(body: Record<string, unknown>): Promise<Account | null> {
  const r = await call<{ account?: unknown }>('POST', '', body);
  const a = parseAccount(r.account);
  if (a) {
    info = Promise.resolve({ available: true, account: a });
    publish(a);
  }
  return a;
}

export const renameAccount = (name: string) => update({ action: 'rename', name: name.trim() });

/**
 * Forgets what this browser keeps about the person (lib/account.ts isPersonalKey): email memberships, teams, roles,
 * counts and cached reads, and the private bodies kept in IndexedDB.
 */
export async function forgetPersonalData(): Promise<void> {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const s = store();
      for (const k of Object.keys(s)) if (isPersonalKey(k)) s.removeItem(k);
    } catch {
      /* storage blocked: nothing kept */
    }
  }
  forgetContributors();
  try {
    const { clearPrivateRepoCaches } = await import('./repo-cache');
    await clearPrivateRepoCaches();
  } catch {
    /* no IndexedDB here */
  }
}

async function ended() {
  info = Promise.resolve({ available: true, account: null });
  await forgetPersonalData();
  publish(null);
}

export async function signOut(): Promise<void> {
  await call('POST', '', { action: 'sign-out' });
  await ended();
}

export async function signOutEverywhere(): Promise<void> {
  await call('POST', '', { action: 'sign-out-everywhere' });
  await ended();
}

/**
 * Before the confirm field: the teams the person is the only admin of while others are on them, each with who could
 * take over. Empty when deleting would go through. With GitHub linked, the GitHub sign-in goes along, as for delete.
 */
export async function deleteCheck(): Promise<BlockedTeam[]> {
  const token = await workingGitHubToken().catch(() => null);
  const r = await call<{ blocked?: unknown }>('POST', '', { action: 'delete-check' }, token ? { Authorization: `Bearer ${token}` } : {});
  return parseBlocked(r.blocked);
}

/**
 * Deletes the account. Refused with code last-admin (409) when the person is a team's only admin. With GitHub linked,
 * the GitHub sign-in of this browser goes along, so the server can check the GitHub teams too.
 */
export async function deleteAccount(): Promise<void> {
  const token = await workingGitHubToken().catch(() => null);
  await call('POST', '', { action: 'delete' }, token ? { Authorization: `Bearer ${token}` } : {});
  await ended();
}

/** The GitHub sign-in token this browser holds and GitHub still takes; never an email contributor's stand-in. */
export async function workingGitHubToken(): Promise<string | null> {
  const s = await import('./github-session');
  const token = s.hasWorkingToken() ? s.getToken() : null;
  return token && !isContribAuth(token) ? token : null;
}

/**
 * Link GitHub to the signed-in account: at once with the GitHub sign-in this browser already has, else through GitHub
 * and back to the sign-in screen, which links it and returns to `returnTo`. True when linked here and now.
 */
export async function linkGitHub(returnTo: string): Promise<boolean> {
  const token = await workingGitHubToken();
  if (token) {
    await signInWithGitHub(token);
    return true;
  }
  try {
    sessionStorage.setItem(GITHUB_PENDING_KEY, '1');
  } catch {
    /* storage blocked: startSignIn says so */
  }
  const { startSignIn } = await import('./github-session');
  await startSignIn(signInHref(returnTo));
  return false;
}
