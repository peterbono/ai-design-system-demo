// GitHub access from the browser. Reads are unauthenticated when no token is set (public repos, 60 requests an
// hour per IP); every successful GET is cached in localStorage so a rate-limited visitor still sees the last data.
// Writes (reviews, merges, token proposals) need a fine-grained token the user pastes once. It stays in this
// browser's localStorage, is only ever sent to api.github.com, and is never part of the build.

export interface RepoRef {
  owner: string;
  repo: string;
  defaultBranch: string;
}

const TOKEN_KEY = 'bridge.github.token';
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

export class RateLimitError extends Error {
  constructor(public resetAt: Date | null) {
    super('GitHub rate limit reached');
  }
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
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
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Identical GETs started on the same page load share one request (the header count and the page list read the
// same open pull requests): anonymous visitors only have 60 reads an hour.
const inflight = new Map<string, Promise<Fetched<unknown>>>();

/** GET with cache fallback. `path` is relative to api.github.com, or an absolute URL. */
export function ghGet<T>(path: string, opts: { accept?: string; raw?: boolean } = {}): Promise<Fetched<T>> {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const key = `${url}|${opts.accept ?? ''}|${opts.raw ? 'raw' : ''}|${getToken() ? 'auth' : 'anon'}`;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<Fetched<T>>;
  const p = ghGetOnce<T>(url, path, `${url}|${opts.accept ?? ''}`, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function ghGetOnce<T>(url: string, path: string, key: string, opts: { accept?: string; raw?: boolean }): Promise<Fetched<T>> {
  try {
    // raw.githubusercontent.com: no custom headers, so no CORS preflight (and no API rate limit).
    const res = await fetch(url, url.startsWith(API) ? { headers: headers(opts.accept ? { Accept: opts.accept } : {}) } : {});
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

/** Authenticated write. Throws when no token is set. */
export async function ghWrite<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (!getToken()) throw new GitHubError(401, 'Connect a GitHub token first.');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
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
    throw new GitHubError(res.status, message);
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
  if (!dialog || !input || !save) return;
  wired = true;

  const paint = () => {
    const state = viewer ? 'connected' : !checked && getToken() ? 'checking' : 'readonly';
    document.querySelectorAll<HTMLElement>('[data-gh-connect]').forEach((block) => {
      block.dataset.state = state;
      const text = block.querySelector('[data-gh-status-text]');
      if (text) text.textContent = viewer ? `Connected as @${viewer.login}` : 'Read only';
      const label = block.querySelector('[data-gh-open-label]');
      if (label) label.textContent = viewer ? 'Token' : 'Connect GitHub';
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
    if (forget) forget.hidden = !viewer;
  };

  const check = async (): Promise<Viewer | null> => {
    if (!getToken()) return null;
    const res = await fetch(`${API}/user`, { headers: headers() });
    if (!res.ok) throw new GitHubError(res.status, res.status === 401 ? 'GitHub did not accept this token.' : `GitHub answered ${res.status}.`);
    return (await res.json()) as Viewer;
  };

  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-gh-open]')) {
      showError(null);
      input.value = '';
      dialog.showModal();
      input.focus();
    }
  });
  save.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      showError('Paste a token first.');
      return;
    }
    setButtonBusy(save, true, 'Checking');
    const previous = getToken();
    setToken(value);
    try {
      viewer = await check();
      dialog.close();
      paint();
      notify(viewer);
    } catch (err) {
      setToken(previous);
      showError((err as Error).message);
    } finally {
      setButtonBusy(save, false, 'Check and connect');
    }
  });
  const disconnect = () => {
    setToken(null);
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
  // Gated actions (data-gh-gate): without a connection a click opens the Connect dialog instead of acting.
  document.addEventListener(
    'click',
    (e) => {
      const gated = (e.target as HTMLElement).closest<HTMLElement>('[data-gh-gate][aria-disabled="true"]');
      if (!gated) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      showError(null);
      input.value = '';
      dialog.showModal();
      input.focus();
    },
    true,
  );

  paint();
  check()
    .then((v) => {
      viewer = v;
    })
    .catch(() => {
      viewer = null;
    })
    .finally(() => {
      checked = true;
      paint();
      notify(viewer);
    });
  listeners.push(() => void readAccess().then(paintAccess));
}

/** What the connected token may do on this repository: null until known, or without a token. */
let access: { write: boolean } | null = null;

async function readAccess(): Promise<{ write: boolean } | null> {
  if (!viewer || !getToken()) return (access = null);
  try {
    const r = readRepo();
    const res = await fetch(`${API}/repos/${r.owner}/${r.repo}`, { headers: headers() });
    if (!res.ok) return (access = null);
    const info = (await res.json()) as { permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } };
    const p = info.permissions;
    return (access = { write: Boolean(p && (p.admin || p.maintain || p.push)) });
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
}

/** Marks every [data-gh-gate="verb phrase"] action as unavailable until GitHub is connected, with a tooltip. */
export function paintGates(root: ParentNode = document) {
  const on = Boolean(viewer);
  root.querySelectorAll<HTMLElement>('[data-gh-gate]').forEach((el) => {
    if (on) {
      el.removeAttribute('aria-disabled');
      if (el.dataset.tip?.startsWith('Connect GitHub')) delete el.dataset.tip;
    } else {
      el.setAttribute('aria-disabled', 'true');
      el.dataset.tip = `Connect GitHub to ${el.dataset.ghGate}.`;
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
