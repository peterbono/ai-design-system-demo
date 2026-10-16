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

/** GET with cache fallback. `path` is relative to api.github.com, or an absolute URL. */
export async function ghGet<T>(path: string, opts: { accept?: string; raw?: boolean } = {}): Promise<Fetched<T>> {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const key = `${url}|${opts.accept ?? ''}`;
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
  const input = document.getElementById('gh-token') as HTMLInputElement | null;
  const error = document.getElementById('gh-error');
  const forget = document.getElementById('gh-forget');
  const save = document.getElementById('gh-save') as HTMLButtonElement | null;
  if (!dialog || !input || !save) return;
  wired = true;

  const paint = () => {
    document.querySelectorAll<HTMLElement>('[data-gh-connect]').forEach((block) => {
      block.dataset.state = viewer ? 'connected' : !checked && getToken() ? 'checking' : 'readonly';
      const text = block.querySelector('[data-gh-status-text]');
      if (text) text.textContent = viewer ? `Connected as @${viewer.login}` : 'Read only';
      const label = block.querySelector('[data-gh-open-label]');
      if (label) label.textContent = viewer ? 'Token' : 'Connect GitHub';
    });
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
      if (error) error.hidden = true;
      input.value = '';
      dialog.showModal();
      input.focus();
    }
  });
  save.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
      if (error) {
        error.textContent = 'Paste a token first.';
        error.hidden = false;
      }
      return;
    }
    save.disabled = true;
    save.textContent = 'Checking';
    const previous = getToken();
    setToken(value);
    try {
      viewer = await check();
      dialog.close();
      paint();
      notify(viewer);
    } catch (err) {
      setToken(previous);
      if (error) {
        error.textContent = (err as Error).message;
        error.hidden = false;
      }
    } finally {
      save.disabled = false;
      save.textContent = 'Check and connect';
    }
  });
  forget?.addEventListener('click', () => {
    setToken(null);
    viewer = null;
    dialog.close();
    paint();
    notify(null);
  });

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
}
