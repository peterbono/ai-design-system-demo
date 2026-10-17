// GitHub access from the browser. Reads are unauthenticated when no token is set (public repos, 60 requests an
// hour per IP); every successful GET is cached in localStorage so a rate-limited visitor still sees the last data.
// Writes (reviews, merges, token proposals) need a fine-grained token the user pastes once. It stays in this
// browser's localStorage, is only ever sent to api.github.com, and is never part of the build.

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
  STUDIO_TOKEN_REJECTED,
} from '../lib/token-session';

export { GitHubError };

export interface RepoRef {
  owner: string;
  repo: string;
  defaultBranch: string;
}

const TOKEN_KEY = 'bridge.github.token';
const CHECK_KEY = 'bridge.github.check';
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

/**
 * Marks the saved token as refused by GitHub: the account block switches to "Your GitHub token stopped working",
 * write actions say so, reads fall back to anonymous. Called by every GitHub call that gets a 401.
 */
export function markTokenRejected() {
  const token = getToken();
  if (!token || tokenRejected()) return;
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
  return authFailure(err, action);
}

/**
 * Writes an error into `el`: for a refused token the one "stopped working" message with a Reconnect button, for a
 * missing permission the permission to add with a link to the token settings, else `fallback`.
 */
export function showGhError(el: HTMLElement, err: unknown, fallback: string, action?: string) {
  const a = authFailure(err, action);
  if (!a) {
    el.textContent = fallback;
    return;
  }
  el.innerHTML =
    a.kind === 'rejected'
      ? `${esc(a.text)} <button type="button" class="gh-inline-link" data-gh-open>Reconnect</button>`
      : `${esc(a.text)} <a href="${esc(a.href!)}" target="_blank" rel="noopener">Edit the token on GitHub</a>`;
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
  if (tokenRejected()) throw new GitHubError(401, STUDIO_TOKEN_REJECTED, 'Bad credentials', { auth: 'rejected' });
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
  const forget = dialog?.querySelector<HTMLElement>('[data-gh-forget-dialog]') ?? null;
  const save = dialog?.querySelector<HTMLButtonElement>('[data-gh-save]') ?? null;
  const title = dialog?.querySelector<HTMLElement>('#gh-dialog-title') ?? null;
  const rejectedNote = dialog?.querySelector<HTMLElement>('[data-gh-rejected-note]') ?? null;
  if (!dialog || !input || !save) return;
  wired = true;
  const saveLabel = () => (tokenRejected() ? 'Check and replace' : 'Check and connect');

  const paint = () => {
    const rejected = tokenRejected();
    const state = viewer ? 'connected' : rejected ? 'rejected' : !checked && getToken() ? 'checking' : 'readonly';
    document.querySelectorAll<HTMLElement>('[data-gh-connect]').forEach((block) => {
      block.dataset.state = state;
      const text = block.querySelector('[data-gh-status-text]');
      if (text) text.textContent = viewer ? `Connected as @${viewer.login}` : rejected ? 'Token stopped working' : 'Read only';
      const label = block.querySelector('[data-gh-open-label]');
      if (label) label.textContent = viewer ? 'Token' : rejected ? 'Reconnect' : 'Connect GitHub';
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
    if (forget) forget.hidden = !viewer && !rejected;
  };

  /** GET /user with the saved token, whatever the session state. 401 = the token was refused. */
  const check = async (): Promise<Viewer | null> => {
    const token = getToken();
    if (!token) return null;
    const res = await fetch(`${API}/user`, { headers: authHeaders() });
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
    showError(null);
    input.value = '';
    if (title) title.textContent = rejected ? 'Reconnect GitHub' : 'Connect GitHub';
    if (rejectedNote) rejectedNote.hidden = !rejected;
    setButtonLabel(save, saveLabel());
    dialog.showModal();
    input.focus();
  };

  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-gh-open]')) {
      (e.target as HTMLElement).closest('details')?.removeAttribute('open');
      openDialog();
    }
  });
  save.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      showError('Paste a token first.');
      return;
    }
    const label = saveLabel();
    setButtonBusy(save, true, 'Checking');
    const previous = getToken();
    const previousCheck = readCheck();
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
      showError((err as Error).message);
    } finally {
      setButtonBusy(save, false, label);
    }
  });
  const disconnect = () => {
    setToken(null);
    writeCheck(null);
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

  listeners.push(() => void readAccess().then(paintAccess));
  const done = () => {
    checked = true;
    paint();
    notify(viewer);
  };
  const token = getToken();
  const last = currentCheck();
  if (token && !needsCheck(last, token, Date.now())) {
    // Checked less than an hour ago: no call to GitHub.
    viewer = last?.ok && last.viewer ? last.viewer : null;
    if (last?.ok && typeof last.write === 'boolean') access = { write: last.write };
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
}

/** What the connected token may do on this repository: null until known, or without a token. */
let access: { write: boolean } | null = null;
const accessListeners: ((a: { write: boolean } | null) => void)[] = [];

/** Calls `fn` each time the token's access to the repository is read (after connect) or cleared (disconnect). */
export function onAccess(fn: (a: { write: boolean } | null) => void) {
  accessListeners.push(fn);
  if (access) fn(access);
}

async function readAccess(): Promise<{ write: boolean } | null> {
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
    access = { write: Boolean(p && (p.admin || p.maintain || p.push)) };
    const last = currentCheck();
    if (last?.ok) writeCheck({ ...last, write: access.write });
    return access;
  } catch {
    return (access = null);
  }
}

function paintAccess() {
  document.querySelectorAll<HTMLElement>('[data-gh-perm]').forEach((el) => {
    el.textContent = !viewer ? '' : !access ? 'Unknown' : access.write ? 'Read and write' : 'Read only';
    el.className = `gh-perm${access ? (access.write ? ' is-write' : ' is-read') : ''}`;
  });
  document.querySelectorAll<HTMLElement>('[data-gh-perm-help]').forEach((el) => (el.hidden = !viewer || !access || access.write));
  accessListeners.forEach((fn) => fn(access));
}

/** Marks every [data-gh-gate="verb phrase"] action as unavailable until GitHub is connected (or reconnected), with a tooltip. */
export function paintGates(root: ParentNode = document) {
  const on = Boolean(viewer);
  const rejected = tokenRejected();
  root.querySelectorAll<HTMLElement>('[data-gh-gate]').forEach((el) => {
    if (on) {
      el.removeAttribute('aria-disabled');
      if (el.dataset.tip?.startsWith('Connect GitHub') || el.dataset.tip?.startsWith('Your GitHub token')) delete el.dataset.tip;
    } else {
      el.setAttribute('aria-disabled', 'true');
      el.dataset.tip = rejected ? `Your GitHub token stopped working. Reconnect to ${el.dataset.ghGate}.` : `Connect GitHub to ${el.dataset.ghGate}.`;
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
