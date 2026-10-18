// GitHub access from the browser. Reads are unauthenticated when no token is set (public repos, 60 requests an
// hour per IP); every successful GET is cached in localStorage so a rate-limited visitor still sees the last data.
// Writes (reviews, merges, token proposals) need a token: a user access token from "Sign in with GitHub" (when the
// site has a GitHub App, see docs/SIGN-IN.md and lib/github-signin.ts), or a fine-grained token the user pastes
// once. Either stays in this browser's localStorage, is only ever sent to api.github.com (and, for a refresh, to
// this site's own /api/github/token), and is never part of the build.

import { classifyAuth, type FetchLike, GitHubClient, GitHubError, type ClientOptions, friendlyMessage } from '@bridge-ds/core';
import {
  authFailure,
  type AuthFailure,
  type TokenCheck,
  checkFor,
  needsCheck,
  okCheck,
  rejectedCheck,
  sessionState,
  STUDIO_SIGNIN_EXPIRED,
  STUDIO_TOKEN_REJECTED,
  type SessionMode,
} from '../lib/token-session';
import {
  type AppSession,
  authorizeUrl,
  callbackUrl,
  canRefresh,
  encodeState,
  exchangeErrorText,
  installationFor,
  type InstallationLike,
  needsRefresh,
  noReachText,
  type PendingSignIn,
  pkceChallenge,
  randomString,
  readOnlyText,
  refreshDelay,
  safeReturnTo,
  sessionFrom,
  type SignInConfig,
  TOKEN_ENDPOINT,
  type TokenResponse,
} from '../lib/github-signin';

export { GitHubError };

export interface RepoRef {
  owner: string;
  repo: string;
  defaultBranch: string;
}

const TOKEN_KEY = 'bridge.github.token';
const CHECK_KEY = 'bridge.github.check';
/** The sign-in session (expiry, refresh token) next to its token. Absent for a pasted token. */
const APP_KEY = 'bridge.github.app';
/** The sign-in this tab started, until GitHub sends it back (sessionStorage). */
export const PENDING_KEY = 'bridge.github.signin';
const CACHE_PREFIX = 'bridge.gh.cache:';
export const API = 'https://api.github.com';

export function readRepo(): RepoRef {
  const el = document.getElementById('bridge-repo');
  const fallback = { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main' };
  try {
    return el ? { ...fallback, ...(JSON.parse(el.textContent || '{}') as Partial<RepoRef>) } : fallback;
  } catch {
    return fallback;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token.trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: token lives for this page only */
  }
  document.dispatchEvent(new CustomEvent('bridge:auth', { detail: { signedIn: Boolean(token) } }));
}

export function readAppSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(APP_KEY);
    const s = raw ? (JSON.parse(raw) as AppSession) : null;
    return s && s.kind === 'app' ? s : null;
  } catch {
    return null;
  }
}

function writeAppSession(s: AppSession | null) {
  try {
    if (s) localStorage.setItem(APP_KEY, JSON.stringify(s));
    else localStorage.removeItem(APP_KEY);
  } catch {
    /* private mode: the session lives for this page only */
  }
}

/** How this browser holds GitHub access: 'app' after Sign in with GitHub, 'token' for a pasted token (or none). */
export const sessionMode = (): SessionMode => (getToken() && readAppSession() ? 'app' : 'token');

/** Sign in with GitHub settings, written at build time on the Connect dialog. Null: the site has no GitHub App. */
export function readSignInConfig(): SignInConfig | null {
  const raw = document.getElementById('gh-dialog')?.dataset.signin;
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as SignInConfig | null;
    return c && typeof c.clientId === 'string' && c.clientId ? c : null;
  } catch {
    return null;
  }
}

/**
 * Sign in is the only way to connect when the site has a GitHub App: the designer UI then has no token paste (a token
 * pasted before keeps working until it is disconnected). Without a GitHub App the token paste is the way in.
 */
export const prefersSignIn = () => Boolean(readSignInConfig());

export class SignInError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Starts Sign in with GitHub: keeps a state and a PKCE verifier for this tab, then goes to GitHub. `returnTo` is the
 * Studio page to land on afterwards (this one by default).
 */
export async function startSignIn(returnTo = location.pathname + location.search + location.hash): Promise<void> {
  const cfg = readSignInConfig();
  if (!cfg) throw new SignInError('Sign in with GitHub is not set up on this site. Connect with a token from Settings instead.');
  if (!globalThis.crypto?.subtle) throw new SignInError('This browser cannot sign in safely here (no Web Crypto). Open Studio over https and sign in again.');
  const fill = (a: Uint8Array) => crypto.getRandomValues(a);
  const verifier = randomString(32, fill);
  const state = encodeState(randomString(24, fill), location.origin);
  const redirectUri = callbackUrl(location.origin, cfg);
  const challenge = await pkceChallenge(verifier, (d) => crypto.subtle.digest('SHA-256', d as Uint8Array<ArrayBuffer>));
  const pending: PendingSignIn = { state, verifier, redirectUri, returnTo: safeReturnTo(returnTo), at: Date.now() };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    throw new SignInError('This browser blocks site storage, so the sign-in could not finish. Allow site data for this site, then sign in again.');
  }
  location.assign(authorizeUrl({ clientId: cfg.clientId, redirectUri, state, challenge }));
}

/** POSTs to this site's token function. Throws a SignInError with the sentence to show. */
export async function postToken(
  body: { grant: 'code'; code: string; code_verifier: string; redirect_uri: string } | { grant: 'refresh'; refresh_token: string },
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new SignInError(exchangeErrorText(0), 'unreachable');
  }
  let data: (Partial<TokenResponse> & { error?: string }) | null = null;
  try {
    data = (await res.json()) as Partial<TokenResponse> & { error?: string };
  } catch {
    /* not JSON: a host error page */
  }
  if (!res.ok || !data || typeof data.access_token !== 'string') throw new SignInError(exchangeErrorText(res.status, data?.error), data?.error);
  return data as TokenResponse;
}

/** Saves a finished sign-in: the token like a pasted one, plus its expiry and refresh token. */
export function saveSignIn(r: TokenResponse, opts: { refresh?: boolean } = {}) {
  const previous = opts.refresh ? currentCheck() : null;
  writeAppSession(sessionFrom(r, Date.now()));
  // A refresh keeps the account: carry the last good check over to the new token (no extra call to GitHub). A new
  // sign-in may be another account: it is checked again.
  writeCheck(previous?.ok && previous.viewer ? { ...okCheck(r.access_token, previous.viewer, Date.now(), previous.write), ...(typeof previous.reach === 'boolean' ? { reach: previous.reach } : {}) } : null);
  setToken(r.access_token);
}

let refreshing: Promise<boolean> | null = null;

/** Renews the sign-in with its refresh token. True when a fresh token is saved. One refresh at a time. */
export function refreshSignIn(): Promise<boolean> {
  if (refreshing) return refreshing;
  const s = readAppSession();
  if (!s || !s.refreshToken || !canRefresh(s, Date.now())) return Promise.resolve(false);
  refreshing = postToken({ grant: 'refresh', refresh_token: s.refreshToken })
    .then((r) => {
      saveSignIn(r, { refresh: true });
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function readCheck(): TokenCheck | null {
  try {
    const raw = localStorage.getItem(CHECK_KEY);
    return raw ? (JSON.parse(raw) as TokenCheck) : null;
  } catch {
    return null;
  }
}

let memoryCheck: TokenCheck | null = null;
function writeCheck(check: TokenCheck | null) {
  memoryCheck = check;
  try {
    if (check) localStorage.setItem(CHECK_KEY, JSON.stringify(check));
    else localStorage.removeItem(CHECK_KEY);
  } catch {
    /* private mode: the check lives for this page only */
  }
}

/** The last check of the current token, from this page or from storage. */
const currentCheck = () => checkFor(memoryCheck ?? readCheck(), getToken()) ?? checkFor(readCheck(), getToken());

/** True when GitHub refused the saved token (revoked, regenerated or expired). The token is kept until replaced. */
export const tokenRejected = () => sessionState(getToken(), currentCheck()) === 'rejected';

/** A token is saved and GitHub has not refused it. Write actions use this, not getToken(). */
export const hasWorkingToken = () => Boolean(getToken()) && !tokenRejected();

let onRejected: (() => void) | null = null;
let onRefreshed: (() => void) | null = null;
/** A 401 may trigger one refresh per page: a refreshed token GitHub refuses again is really refused. */
let refreshedAfter401 = false;

/**
 * Marks the saved token as refused by GitHub: the account block switches to "Your GitHub token stopped working",
 * write actions say so, reads fall back to anonymous. Called by every GitHub call that gets a 401. A sign-in that
 * can still be refreshed is refreshed first (once per page).
 */
export function markTokenRejected() {
  const token = getToken();
  if (!token || tokenRejected()) return;
  if (!refreshedAfter401 && canRefresh(readAppSession(), Date.now())) {
    refreshedAfter401 = true;
    void refreshSignIn().then((ok) => (ok ? onRefreshed?.() : markTokenRejected()));
    return;
  }
  writeCheck(rejectedCheck(token, Date.now()));
  onRejected?.();
  document.dispatchEvent(new CustomEvent('bridge:auth', { detail: { signedIn: false, rejected: true } }));
}

/**
 * fetch for the core GitHubClient in the Studio: once the token is refused, reads go out anonymously (public repos
 * keep working) and writes fail at once with the same 401; any 401 to a call that carried the token marks it.
 */
export const studioFetch: FetchLike = async (url, init = {}) => {
  const method = (init.method ?? 'GET').toUpperCase();
  let headers = init.headers ?? {};
  // A write with a token GitHub already refused cannot succeed: answer for it, so the action shows the one message.
  if (method !== 'GET' && tokenRejected() && headers.Authorization) {
    return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (method === 'GET' && tokenRejected() && headers.Authorization) {
    const { Authorization: _drop, ...rest } = headers;
    headers = rest;
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && headers.Authorization) {
    markTokenRejected();
    if (method === 'GET') {
      const { Authorization: _drop, ...rest } = headers;
      return fetch(url, { ...init, headers: rest });
    }
  }
  return res;
};

/** The core GitHub client the Studio uses: the saved token, the session-aware fetch. */
export function studioClient(repo: string, token: string | null = getToken(), options?: ClientOptions): GitHubClient {
  return new GitHubClient(repo, token ?? '', studioFetch, undefined, options);
}

/** The auth sentence for an error (rejected token or missing permission), or null for any other failure. */
export function ghAuthFailure(err: unknown, action?: string): AuthFailure | null {
  return authFailure(err, action, sessionMode());
}

/**
 * Writes an error into `el`: for a refused token the one "stopped working" message with a Reconnect button, for a
 * missing permission the permission to add with a link to the token settings, else `fallback`.
 */
export function showGhError(el: HTMLElement, err: unknown, fallback: string, action?: string) {
  const mode = sessionMode();
  const a = authFailure(err, action, mode);
  if (!a) {
    el.textContent = fallback;
    return;
  }
  el.innerHTML =
    a.kind === 'rejected'
      ? `${esc(a.text)} <button type="button" class="gh-inline-link" data-gh-open data-gh-signin>${mode === 'app' || prefersSignIn() ? 'Sign in again' : 'Reconnect'}</button>`
      : a.href
        ? `${esc(a.text)} <a href="${esc(a.href)}" target="_blank" rel="noopener">Edit the token on GitHub</a>`
        : esc(a.text);
}

export class RateLimitError extends Error {
  constructor(public resetAt: Date | null) {
    super('GitHub rate limit reached');
  }
}

export interface Fetched<T> {
  data: T;
  /** True when the data comes from this browser's cache because GitHub refused the request. */
  stale: boolean;
  cachedAt?: string;
  resetAt?: Date | null;
}

function cacheGet<T>(url: string): { data: T; at: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + url);
    return raw ? (JSON.parse(raw) as { data: T; at: string }) : null;
  } catch {
    return null;
  }
}

function cacheSet(url: string, data: unknown) {
  try {
    localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ data, at: new Date().toISOString() }));
  } catch {
    /* quota: drop the oldest cache entries and move on */
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .slice(0, 20)
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
  const token = getToken();
  if (token && !tokenRejected()) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Headers that always carry the saved token (the token check itself, and writes). */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Identical GETs started on the same page load share one request (the header count and the page list read the
// same open pull requests): anonymous visitors only have 60 reads an hour.
const inflight = new Map<string, Promise<Fetched<unknown>>>();

/** GET with cache fallback. `path` is relative to api.github.com, or an absolute URL. */
export function ghGet<T>(path: string, opts: { accept?: string; raw?: boolean } = {}): Promise<Fetched<T>> {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const key = `${url}|${opts.accept ?? ''}|${opts.raw ? 'raw' : ''}|${hasWorkingToken() ? 'auth' : 'anon'}`;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<Fetched<T>>;
  const p = ghGetOnce<T>(url, path, `${url}|${opts.accept ?? ''}`, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function ghGetOnce<T>(url: string, path: string, key: string, opts: { accept?: string; raw?: boolean }): Promise<Fetched<T>> {
  try {
    // raw.githubusercontent.com: no custom headers, so no CORS preflight (and no API rate limit).
    const isApi = url.startsWith(API);
    let res = await fetch(url, isApi ? { headers: headers(opts.accept ? { Accept: opts.accept } : {}) } : {});
    // GitHub refused the token: mark it, then read anonymously (public repos keep working).
    if (res.status === 401 && isApi && hasWorkingToken()) {
      markTokenRejected();
      res = await fetch(url, { headers: headers(opts.accept ? { Accept: opts.accept } : {}) });
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      if (remaining === '0' || res.status === 429) throw new RateLimitError(reset ? new Date(Number(reset) * 1000) : null);
    }
    if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status} for ${path}`);
    const data = (opts.raw ? await res.text() : await res.json()) as T;
    cacheSet(key, data);
    return { data, stale: false };
  } catch (err) {
    const cached = cacheGet<T>(key);
    if (cached && (err instanceof RateLimitError || err instanceof TypeError)) {
      return { data: cached.data, stale: true, cachedAt: cached.at, resetAt: err instanceof RateLimitError ? err.resetAt : null };
    }
    throw err;
  }
}

/**
 * Authenticated write. Throws when no token is set, and with the one "stopped working" message once GitHub refused
 * the token (the error carries `auth`, so callers can show it with showGhError).
 */
export async function ghWrite<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (!getToken()) throw new GitHubError(401, 'Connect a GitHub token first.', 'no-token');
  if (tokenRejected()) throw new GitHubError(401, sessionMode() === 'app' ? STUDIO_SIGNIN_EXPIRED : STUDIO_TOKEN_REJECTED, 'Bad credentials', { auth: 'rejected' });
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `GitHub answered ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) message = j.message;
    } catch {
      /* no body */
    }
    const info = classifyAuth(res.status, message, { path, acceptedPermissions: res.headers.get('x-accepted-github-permissions') });
    if (info.auth === 'rejected') markTokenRejected();
    throw new GitHubError(res.status, info.auth ? friendlyMessage(res.status, message, info) : message, message, info);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diff < 60) return 'just now';
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Viewer {
  login: string;
  avatar_url: string;
  /** Profile name, when the user set one. */
  name?: string | null;
}

let viewer: Viewer | null = null;
export const currentViewer = () => viewer;

let wired = false;
let checked = false;
const listeners: ((v: Viewer | null) => void)[] = [];
const notify = (v: Viewer | null) => listeners.forEach((fn) => fn(v));

/**
 * Wires every [data-gh-connect] block and the shared dialog (once per page: the Studio layout and the page script
 * may both call it). Calls `onChange` after the first token check, and after every connect or disconnect.
 * The token is checked against GitHub at most once an hour (GET /user, cached with the result); a 401 from any
 * call in between marks it as stopped working.
 */
export function initGitHubConnect(onChange?: (v: Viewer | null) => void) {
  if (onChange) listeners.push(onChange);
  if (wired) {
    if (checked) onChange?.(viewer);
    return;
  }
  const dialog = document.getElementById('gh-dialog') as HTMLDialogElement | null;
  const input = dialog?.querySelector<HTMLInputElement>('[data-gh-token]') ?? null;
  const errorBox = dialog?.querySelector<HTMLElement>('[data-gh-error]') ?? null;
  const errorText = errorBox?.querySelector<HTMLElement>('[data-gh-error-text]') ?? errorBox;
  // The error is a DS Alert: its text goes in its own span so the tone icon stays.
  const showError = (message: string | null) => {
    if (!errorBox || !errorText) return;
    if (message !== null) errorText.textContent = message;
    errorBox.hidden = message === null;
  };
  const signInBox = dialog?.querySelector<HTMLElement>('[data-gh-signin-error]') ?? null;
  const signInText = signInBox?.querySelector<HTMLElement>('[data-gh-signin-error-text]') ?? signInBox;
  const showSignInError = (message: string | null) => {
    if (!signInBox || !signInText) return;
    if (message !== null) signInText.textContent = message;
    signInBox.hidden = message === null;
  };
  const forget = dialog?.querySelector<HTMLElement>('[data-gh-forget-dialog]') ?? null;
  const save = dialog?.querySelector<HTMLButtonElement>('[data-gh-save]') ?? null;
  const title = dialog?.querySelector<HTMLElement>('#gh-dialog-title') ?? null;
  const rejectedNote = dialog?.querySelector<HTMLElement>('[data-gh-rejected-note]') ?? null;
  const rejectedNoteText = rejectedNote?.querySelector<HTMLElement>('[data-gh-rejected-note-text]') ?? null;
  // With a GitHub App the dialog is Sign in with GitHub only; without one it is the token paste only.
  const signInView = dialog?.querySelector<HTMLElement>('[data-gh-view="signin"]') ?? null;
  const tokenView = dialog?.querySelector<HTMLElement>('[data-gh-view="token"]') ?? null;
  if (!dialog || (!signInView && (!input || !save))) return;
  wired = true;
  const saveLabel = () => (tokenRejected() || viewer ? 'Check and replace' : 'Check and connect');

  const showView = () => {
    showError(null);
    showSignInError(null);
    if (signInView) signInView.querySelector<HTMLElement>('[data-gh-signin]')?.focus();
    else input?.focus();
  };

  const paint = () => {
    const rejected = tokenRejected();
    const app = sessionMode() === 'app';
    const signIn = prefersSignIn();
    const state = viewer ? 'connected' : rejected ? 'rejected' : !checked && getToken() ? 'checking' : 'readonly';
    document.querySelectorAll<HTMLElement>('[data-gh-connect]').forEach((block) => {
      block.dataset.state = state;
      block.dataset.mode = app ? 'app' : 'token';
      const text = block.querySelector('[data-gh-status-text]');
      if (text) text.textContent = viewer ? `Connected as @${viewer.login}` : rejected ? (app ? 'Sign-in expired' : 'Token stopped working') : 'Read only';
      const label = block.querySelector('[data-gh-open-label]');
      if (label) label.textContent = viewer ? (app ? 'Account' : 'Token') : rejected ? (app || signIn ? 'Sign in again' : 'Reconnect') : signIn ? 'Sign in with GitHub' : 'Connect GitHub';
      block.querySelectorAll<HTMLElement>('[data-gh-rejected-text]').forEach((el) => (el.textContent = app ? 'Your GitHub sign-in expired' : 'Your GitHub token stopped working'));
      block.querySelectorAll<HTMLElement>('[data-gh-reconnect-label]').forEach((el) => (el.textContent = app ? 'Sign in again' : signIn ? 'Sign in with GitHub' : 'Reconnect'));
      // Change token only for a pasted token on a site without Sign in with GitHub.
      block.querySelectorAll<HTMLElement>('[data-gh-token-only]').forEach((el) => (el.hidden = app || signIn));
      block.querySelectorAll<HTMLElement>('[data-gh-forget-label]').forEach((el) => (el.textContent = app ? 'Sign out' : 'Disconnect'));
    });
    // Header account menu: login, avatar.
    document.querySelectorAll<HTMLElement>('[data-gh-acct]').forEach((acct) => {
      const login = viewer ? `@${viewer.login}` : '';
      acct.querySelectorAll('[data-gh-login], [data-gh-login-full]').forEach((el) => (el.textContent = viewer ? (el.hasAttribute('data-gh-login') ? viewer.login : login) : ''));
      const img = acct.querySelector<HTMLImageElement>('[data-gh-avatar]');
      if (img) {
        img.hidden = !viewer;
        if (viewer && !img.src.startsWith(viewer.avatar_url)) img.src = `${viewer.avatar_url}${viewer.avatar_url.includes('?') ? '&' : '?'}s=40`;
      }
      acct.querySelector('summary')?.setAttribute('aria-label', viewer ? `GitHub: connected as ${viewer.login}. Account menu` : 'GitHub account');
    });
    paintGates();
    if (forget) {
      forget.hidden = !viewer && !rejected;
      setButtonLabel(forget, app ? 'Sign out' : 'Disconnect');
    }
  };

  /** GET /user with the saved token, whatever the session state. 401 = the token was refused (after one refresh). */
  const check = async (): Promise<Viewer | null> => {
    if (!getToken()) return null;
    let res = await fetch(`${API}/user`, { headers: authHeaders() });
    if (res.status === 401 && (await refreshSignIn())) res = await fetch(`${API}/user`, { headers: authHeaders() });
    const token = getToken();
    if (!token) return null;
    if (res.status === 401) {
      writeCheck(rejectedCheck(token, Date.now()));
      return null;
    }
    if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status}.`);
    const v = (await res.json()) as Viewer;
    writeCheck(okCheck(token, v, Date.now()));
    return v;
  };

  const openDialog = () => {
    const rejected = tokenRejected();
    const app = sessionMode() === 'app';
    if (input) input.value = '';
    // Opened from Change token while connected: say so, the saved token stays until the new one is checked.
    if (title) title.textContent = rejected ? (app || signInView ? 'Sign in again' : 'Reconnect GitHub') : viewer && !app && !signInView ? 'Change GitHub token' : signInView ? 'Sign in with GitHub' : 'Connect GitHub';
    if (rejectedNote) rejectedNote.hidden = !rejected;
    if (rejectedNoteText) {
      rejectedNoteText.textContent = app
        ? 'Your GitHub sign-in expired and could not be renewed. Sign in again to keep editing.'
        : signInView
          ? 'GitHub no longer accepts the saved token. Sign in with GitHub to keep editing.'
        : 'GitHub no longer accepts the saved token: it was revoked, regenerated or has expired. Paste a new one to replace it.';
    }
    if (save) setButtonLabel(save, saveLabel());
    dialog.showModal();
    showView();
  };

  const signIn = async (from: HTMLElement | null) => {
    const btn = from instanceof HTMLButtonElement ? from : null;
    const label = btn?.textContent?.trim() || 'Sign in with GitHub';
    if (btn) setButtonBusy(btn, true, 'Opening GitHub');
    try {
      await startSignIn();
    } catch (err) {
      if (btn) setButtonBusy(btn, false, label);
      // Shown in the dialog, under its Sign in with GitHub button.
      if (!dialog.open) openDialog();
      showSignInError((err as Error).message);
    }
  };

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const start = target.closest<HTMLElement>('[data-gh-signin]');
    const opener = target.closest<HTMLElement>('[data-gh-open]');
    if (!start && !opener) return;
    target.closest('details')?.removeAttribute('open');
    // [data-gh-signin]: straight to GitHub when the site signs in with GitHub; else the dialog (sign in or token paste).
    if (start && (start.closest('#gh-dialog') || prefersSignIn())) void signIn(start);
    else openDialog();
  });
  save?.addEventListener('click', async () => {
    if (!input || !save) return;
    const value = input.value.trim();
    if (!value) {
      showError('Paste a token first.');
      return;
    }
    const label = saveLabel();
    setButtonBusy(save, true, 'Checking');
    const previous = getToken();
    const previousCheck = readCheck();
    const previousApp = readAppSession();
    // A pasted token replaces a sign-in: it never refreshes.
    writeAppSession(null);
    setToken(value);
    try {
      const v = await check();
      if (!v) throw new Error('GitHub did not accept this token. Check that you copied all of it, then try again.');
      viewer = v;
      access = null;
      dialog.close();
      paint();
      notify(viewer);
    } catch (err) {
      setToken(previous);
      writeCheck(previousCheck);
      writeAppSession(previousApp);
      showError((err as Error).message);
    } finally {
      setButtonBusy(save, false, label);
    }
  });
  const disconnect = () => {
    setToken(null);
    writeCheck(null);
    writeAppSession(null);
    viewer = null;
    access = null;
    if (dialog.open) dialog.close();
    paint();
    paintAccess();
    notify(null);
  };
  forget?.addEventListener('click', disconnect);
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-gh-forget]')) return;
    (e.target as HTMLElement).closest('details')?.removeAttribute('open');
    disconnect();
  });
  // Gated actions (data-gh-gate): without a working connection a click opens the Connect dialog instead of acting.
  document.addEventListener(
    'click',
    (e) => {
      const gated = (e.target as HTMLElement).closest<HTMLElement>('[data-gh-gate][aria-disabled="true"]');
      if (!gated) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openDialog();
    },
    true,
  );

  // Any call that gets a 401 later on lands here: same state as a failed check.
  onRejected = () => {
    viewer = null;
    access = null;
    checked = true;
    paint();
    paintAccess();
    notify(null);
  };
  // A sign-in renewed after a 401: same account, fresh token.
  onRefreshed = () => {
    paint();
    notify(viewer);
  };

  // Renew a sign-in shortly before it expires while the page stays open.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const wait = refreshDelay(readAppSession(), Date.now());
    if (wait === null || !getToken()) return;
    timer = setTimeout(() => void refreshSignIn().then((ok) => (ok ? (paint(), schedule()) : undefined)), Math.min(wait, 2 ** 31 - 1));
  };
  document.addEventListener('bridge:auth', schedule);

  listeners.push(() => void readAccess().then(paintAccess));
  const done = () => {
    checked = true;
    paint();
    notify(viewer);
    schedule();
  };
  const boot = () => {
    const token = getToken();
    const last = currentCheck();
    if (token && !needsCheck(last, token, Date.now())) {
      // Checked less than an hour ago: no call to GitHub.
      viewer = last?.ok && last.viewer ? last.viewer : null;
      if (last?.ok && typeof last.write === 'boolean') access = { write: last.write, ...(typeof last.reach === 'boolean' ? { reach: last.reach } : {}) };
      done();
    } else {
      paint();
      check()
        .then((v) => {
          viewer = v;
        })
        .catch(() => {
          // GitHub unreachable or limited: keep the last known account rather than looking signed out.
          viewer = last?.ok && last.viewer ? last.viewer : null;
        })
        .finally(done);
    }
  };
  const app = readAppSession();
  const token = getToken();
  if (token && app && needsRefresh(app, Date.now())) {
    // The sign-in expires soon (or has): renew it before the first call. If that fails and the token is already
    // past its expiry, it is refused without asking GitHub.
    paint();
    void refreshSignIn().then((ok) => {
      if (!ok && app.expiresAt !== null && app.expiresAt <= Date.now()) writeCheck(rejectedCheck(token, Date.now()));
      boot();
    });
  } else boot();
}

/**
 * What the signed-in account may do on this repository: null until known, or without a token. `reach` is false when
 * a Sign in with GitHub account cannot reach the repository through the app (not installed there, or the account
 * has no access: often the wrong account).
 */
export interface RepoAccess {
  write: boolean;
  reach?: boolean;
}
let access: RepoAccess | null = null;
const accessListeners: ((a: RepoAccess | null) => void)[] = [];

/** Calls `fn` each time the token's access to the repository is read (after connect) or cleared (disconnect). */
export function onAccess(fn: (a: RepoAccess | null) => void) {
  accessListeners.push(fn);
  if (access) fn(access);
}

/** Signed in with the app: true when an installation covers the repository, false when none does, null if unknown. */
async function readReach(owner: string, repo: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${API}/user/installations?per_page=100`, { headers: authHeaders() });
    if (!res.ok) return null;
    const list = ((await res.json()) as { installations?: InstallationLike[] }).installations ?? [];
    const found = installationFor(list, owner);
    if (found.reach !== 'check') return found.reach === 'yes';
    const r2 = await fetch(`${API}/user/installations/${found.id}/repositories?per_page=100`, { headers: authHeaders() });
    if (!r2.ok) return null;
    const repos = ((await r2.json()) as { repositories?: { name?: string }[] }).repositories ?? [];
    return repos.some((x) => x.name?.toLowerCase() === repo.toLowerCase());
  } catch {
    return null;
  }
}

async function readAccess(): Promise<RepoAccess | null> {
  const token = getToken();
  if (!viewer || !token || tokenRejected()) return (access = null);
  if (access) return access;
  try {
    const r = readRepo();
    const res = await fetch(`${API}/repos/${r.owner}/${r.repo}`, { headers: authHeaders() });
    if (res.status === 401) {
      markTokenRejected();
      return (access = null);
    }
    if (!res.ok) return (access = null);
    const info = (await res.json()) as { permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } };
    const p = info.permissions;
    const write = Boolean(p && (p.admin || p.maintain || p.push));
    const reach = sessionMode() === 'app' ? await readReach(r.owner, r.repo) : null;
    access = reach === false ? { write: false, reach: false } : { write, ...(reach === true ? { reach } : {}) };
    const last = currentCheck();
    if (last?.ok) writeCheck({ ...last, write: access.write, ...(typeof access.reach === 'boolean' ? { reach: access.reach } : {}) });
    return access;
  } catch {
    return (access = null);
  }
}

function paintAccess() {
  const r = readRepo();
  const app = sessionMode() === 'app';
  document.querySelectorAll<HTMLElement>('[data-gh-perm]').forEach((el) => {
    el.textContent = !viewer ? '' : !access ? 'Unknown' : access.reach === false ? 'No access' : access.write ? 'Read and write' : 'Read only';
    el.className = `gh-perm${access ? (access.write ? ' is-write' : ' is-read') : ''}`;
  });
  document.querySelectorAll<HTMLElement>('[data-gh-perm-help]').forEach((el) => {
    el.hidden = !viewer || !access || access.write;
    if (viewer && access && !access.write) el.textContent = access.reach === false ? noReachText(viewer.login, `${r.owner}/${r.repo}`) : readOnlyText(viewer.login, `${r.owner}/${r.repo}`, app);
  });
  accessListeners.forEach((fn) => fn(access));
}

/** Marks every [data-gh-gate="verb phrase"] action as unavailable until GitHub is connected (or reconnected), with a tooltip. */
export function paintGates(root: ParentNode = document) {
  const on = Boolean(viewer);
  const rejected = tokenRejected();
  const app = sessionMode() === 'app';
  const signIn = prefersSignIn();
  root.querySelectorAll<HTMLElement>('[data-gh-gate]').forEach((el) => {
    if (on) {
      el.removeAttribute('aria-disabled');
      if (/^(Connect GitHub|Sign in with GitHub|Your GitHub)/.test(el.dataset.tip ?? '')) delete el.dataset.tip;
    } else {
      el.setAttribute('aria-disabled', 'true');
      el.dataset.tip = rejected
        ? app
          ? `Your GitHub sign-in expired. Sign in again to ${el.dataset.ghGate}.`
          : `Your GitHub token stopped working. Reconnect to ${el.dataset.ghGate}.`
        : `${signIn ? 'Sign in with GitHub' : 'Connect GitHub'} to ${el.dataset.ghGate}.`;
      el.classList.add('has-tip');
    }
  });
}

/**
 * DS Button state from a vanilla script. A statically rendered DS Button styles its disabled look from
 * data-disabled (set once at render) and wraps its text in a label span next to the icon: keep both in sync.
 */
export function setButtonDisabled(btn: HTMLButtonElement, disabled: boolean) {
  btn.disabled = disabled;
  btn.toggleAttribute('data-disabled', disabled);
}

/** Sets a DS Button's visible text without removing its icon. */
export function setButtonLabel(btn: HTMLElement, text: string) {
  const label = btn.querySelector<HTMLElement>(':scope > span') ?? btn;
  label.textContent = text;
}

/** Disables a DS Button while work runs and shows what it does ("Checking"), then restores it. */
export function setButtonBusy(btn: HTMLButtonElement, busy: boolean, text: string) {
  setButtonDisabled(btn, busy);
  btn.toggleAttribute('aria-busy', busy);
  setButtonLabel(btn, text);
}
