// How the toolbar reads GitHub: through Bridge's read proxy (GET <proxy>/api/contribute?repo=<design system>&gh=<path>,
// allow-listed, cached, with a read-only token on the server), so a visitor never meets GitHub's limit of 60 anonymous
// reads an hour per address. When Bridge refuses or cannot be reached (an older Bridge, a design system it does not
// serve, an origin its config does not name), the toolbar reads GitHub directly, as before, for the rest of the page.
// The requests stay "simple" (GET, Accept only, no credentials): no CORS preflight, no cookie sent.

/** Production Bridge: the read proxy the toolbar uses unless the product says otherwise. */
export const DEFAULT_PROXY = 'https://bridge.floriangouloubi.com';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export interface ReadsOptions {
  /** The design system repository ("owner/name"): Bridge serves its reads and those of the products it lists. */
  team: string;
  /** Bridge's origin, or null to read GitHub directly. */
  proxy: string | null;
  fetch?: typeof fetch;
}

export interface Reads {
  /** A GitHub REST read under /repos/<owner>/<name>/..., as JSON. */
  api<T>(path: string): Promise<T>;
  /** A file of a repository at a ref (a sha or a branch; none: the default branch), as text. */
  file(owner: string, repo: string, ref: string | null, path: string): Promise<string>;
}

export class ReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const LIMIT = 'GitHub limits reads without an account to 60 an hour. Try again later.';
const errorOf = (status: number) => new ReadError(status === 403 || status === 429 ? LIMIT : `GitHub answered ${status}.`, status);

/** Proxies that refused or did not answer on this page: every later read goes to GitHub directly. */
const down = new Set<string>();

/** Tests start fresh. */
export function resetReads() {
  down.clear();
}

/**
 * Bridge's answer is GitHub's when it read GitHub (any status but its own refusals). Its own: 400 (a path it does not
 * take), 401 (no reader), 403 (not allowed, origin), 409 (app missing), 429 (busy), 5xx; then GitHub directly.
 */
const proxyRefused = (r: Response) => r.status === 400 || r.status === 401 || r.status === 403 || r.status === 409 || r.status === 429 || r.status >= 500;

const segments = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function githubReads({ team, proxy, fetch: f = (...a) => fetch(...a) }: ReadsOptions): Reads {
  const base = proxy ? proxy.replace(/\/+$/, '') : null;

  /** Bridge first, then GitHub. `direct` is GitHub's own URL for the same read. */
  async function read(gh: string, accept: string, direct: string): Promise<Response> {
    if (base && !down.has(base)) {
      try {
        const r = await f(`${base}/api/contribute?repo=${encodeURIComponent(team)}&gh=${encodeURIComponent(gh)}`, { headers: { Accept: accept }, credentials: 'omit' });
        if (!proxyRefused(r)) return r;
      } catch {
        // Unreachable, or the browser refused the answer (CORS): GitHub directly.
      }
      down.add(base);
    }
    return f(direct, direct.startsWith(API) ? { headers: { Accept: accept } } : {});
  }

  return {
    async api<T>(path: string): Promise<T> {
      const r = await read(path, 'application/vnd.github+json', `${API}${path}`);
      if (!r.ok) throw errorOf(r.status);
      return (await r.json()) as T;
    },
    async file(owner, repo, ref, path) {
      const gh = `/repos/${owner}/${repo}/contents/${segments(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
      const r = await read(gh, 'application/vnd.github.raw', `${RAW}/${owner}/${repo}/${ref ?? 'HEAD'}/${segments(path)}`);
      if (!r.ok) throw errorOf(r.status);
      return r.text();
    },
  };
}
