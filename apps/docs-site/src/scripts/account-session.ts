// The browser side of /api/account (lib/account.ts says what an account is). It reads who is signed in (one GET per
// page, shared by every island), sends and checks the 6-digit code, signs in with a GitHub token, renames, signs out
// and deletes. The session is an httpOnly cookie this page never sees. When the site has no account server (an older
// deploy, a fork, `astro dev`) the GET says unavailable and the screens fall back to GitHub; never a fake success.
// Signed in, <html data-account> is set so the GitHub-only account blocks step aside (styles/account.css).
import { ACCOUNT_API, ACCOUNT_HEADER, ACCOUNT_WORDS, accountErrorText, GITHUB_PENDING_KEY, parseAccount, signInHref, type Account, type AccountInfo, type SignedIn } from '../lib/account';
import { isContribAuth } from '../lib/contribute';

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
    throw new AccountError(accountErrorText(res.status, code, message), code, res.status);
  }
  return data as T;
}

/** Who is signed in, and whether the site has accounts at all. One GET per page unless `fresh`. */
export function getAccount(fresh = false): Promise<AccountInfo> {
  if (info && !fresh) return info;
  info = call<{ available?: boolean; account?: unknown }>('GET', '').then(
    (r) => {
      const a = parseAccount(r.account);
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
  publish(account);
  return { account, created: r.created === true, next: typeof r.next === 'string' ? r.next : '' };
}

/** Emails a 6-digit code. The server answers the same whether or not the email has an account. */
export async function sendCode(email: string): Promise<void> {
  await call('POST', '', { action: 'code', email: email.trim() });
}

/** Checks the code; sets the session cookie. */
export async function verifyCode(email: string, code: string, name?: string): Promise<SignedIn> {
  return signedIn(await call('POST', '', { action: 'verify', email: email.trim(), code, ...(name ? { name } : {}) }));
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

function ended() {
  info = Promise.resolve({ available: true, account: null });
  publish(null);
}

export async function signOut(): Promise<void> {
  await call('POST', '', { action: 'sign-out' });
  ended();
}

export async function signOutEverywhere(): Promise<void> {
  await call('POST', '', { action: 'sign-out-everywhere' });
  ended();
}

/**
 * Deletes the account. Refused with code last-admin (409) when the person is a team's only admin. With GitHub linked,
 * the GitHub sign-in of this browser goes along, so the server can check the GitHub teams too.
 */
export async function deleteAccount(): Promise<void> {
  const token = await workingGitHubToken().catch(() => null);
  await call('POST', '', { action: 'delete' }, token ? { Authorization: `Bearer ${token}` } : {});
  ended();
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
