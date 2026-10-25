// The browser side of /api/library-access (api/library-access/index.ts): a team's setting and the reader's session, the
// admin's change, the email sign-in, and a private Library's published files. The reader's session is an httpOnly
// cookie the page never sees; every rule is checked by the server, nothing here grants access.
// When the site has no such server (an older deploy, a fork, `astro dev`) or it is not set up yet, reads answer
// "not available" and the Library opens as before; writes fail with AccessUnavailable and the screens say so.
import type { AccessAnswer, AccessSetting, LibraryMode } from '../lib/library-access';
import { ACCESS_WORDS } from '../lib/library-access';
import { getToken } from './github-session';

export const LIBRARY_ACCESS_API = '/api/library-access';

/** The site cannot do this (no server piece, or not configured). */
export class AccessUnavailable extends Error {
  constructor() {
    super(ACCESS_WORDS.unavailable);
    this.name = 'AccessUnavailable';
  }
}

/** The server refused or failed, with a sentence a reader can act on. */
export class AccessError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AccessError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: Fetch = (input, init) => fetch(input, init);

/** Tests swap the network. */
export function setAccessFetch(f: Fetch | null) {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
  answers.clear();
}

async function call<T>(method: 'GET' | 'POST', query: string, body?: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (!token) throw new AccessError('Sign in with GitHub first.', 'signin', 401);
    headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetchImpl(`${LIBRARY_ACCESS_API}${query}`, { method, headers, credentials: 'same-origin', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new AccessError('Bridge did not answer. Check your connection and try again.', 'network', 0);
  }
  // No function at this address (404, or the static host's HTML page): this site has no such server yet.
  const json = /json/i.test(res.headers.get('content-type') ?? '');
  if (res.status === 404 || res.status === 405 || !json) throw new AccessUnavailable();
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 503 && data.error === 'not_configured') throw new AccessUnavailable();
  if (!res.ok) throw new AccessError(typeof data.message === 'string' && data.message ? data.message : 'Something went wrong. Try again in a minute.', typeof data.error === 'string' ? data.error : 'failed', res.status);
  return data as T;
}

const NOT_AVAILABLE: AccessAnswer = { available: false, setting: null, session: null };

const answers = new Map<string, Promise<AccessAnswer>>();

function toAnswer(r: Partial<AccessAnswer> | null | undefined): AccessAnswer {
  if (!r || r.available !== true) return NOT_AVAILABLE;
  const s = r.setting;
  const setting: AccessSetting | null = s && (['anyone', 'email', 'team'] as const).includes(s.mode) ? { mode: s.mode, domains: Array.isArray(s.domains) ? s.domains : [], ...(s.source ? { source: s.source } : {}) } : null;
  return { available: true, setting, session: r.session && typeof r.session.domain === 'string' ? { domain: r.session.domain } : null };
}

/**
 * A team's setting and this browser's session, asked once per page (`fresh` asks again). Never rejects: anything but a
 * clear answer reads as "not available", which keeps the Library as it was.
 */
export function libraryAccess(repo: string, fresh = false): Promise<AccessAnswer> {
  const k = repo.toLowerCase();
  if (fresh) answers.delete(k);
  let p = answers.get(k);
  if (!p) {
    p = call<Partial<AccessAnswer>>('GET', `?repo=${encodeURIComponent(repo)}`).then(toAnswer, () => NOT_AVAILABLE);
    answers.set(k, p);
  }
  return p;
}

/** An admin's change (checked on GitHub by the server). Returns the setting as saved. */
export async function saveLibraryAccess(repo: string, mode: LibraryMode, domains: string[]): Promise<AccessSetting> {
  const r = await call<{ setting: AccessSetting }>('POST', '', { action: 'set', repo, mode, domains }, true);
  answers.delete(repo.toLowerCase());
  return r.setting;
}

/** Emails a sign-in link. Rejects with the server's sentence (wrong domain, a cap) or AccessUnavailable. */
export async function requestSignIn(repo: string, email: string): Promise<void> {
  await call<{ sent: boolean }>('POST', '', { action: 'sign-in', repo, email });
}

/** Spends the link's token; the server sets the session cookie. */
export async function verifySignIn(repo: string, token: string): Promise<{ domain: string }> {
  const r = await call<{ session: { domain: string } }>('POST', '', { action: 'verify', repo, token });
  answers.delete(repo.toLowerCase());
  return r.session;
}

export async function signOutLibrary(repo: string): Promise<void> {
  await call('POST', '', { action: 'sign-out', repo });
  answers.delete(repo.toLowerCase());
}

/** The address of a private Library's published file, served after the session check (cookie, same origin). */
export const libraryFileUrl = (repo: string, file: 'snapshot' | 'llms') => `${LIBRARY_ACCESS_API}?repo=${encodeURIComponent(repo)}&file=${file}`;

/** A private Library's published file as text, or rejects with the server's sentence. */
export async function readLibraryFile(repo: string, file: 'snapshot' | 'llms'): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(libraryFileUrl(repo, file), { credentials: 'same-origin' });
  } catch {
    throw Object.assign(new Error('Bridge did not answer. Check your connection and try again.'), { status: 0, source: 'bridge' });
  }
  if (res.ok) return res.text();
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  throw Object.assign(new Error(data.message || 'Bridge could not open this library. Try again in a minute.'), { status: res.status, source: 'bridge' });
}
