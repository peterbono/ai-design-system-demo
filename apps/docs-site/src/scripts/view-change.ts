// View the library as a change, the browser side (rules and words: lib/view-scope.ts).
//   - The top bar Select ("Viewing: Latest library"): the open changes with their status, from the one open-changes
//     read the Studio shell already makes on every page.
//   - The persistent banner at the top of the page.
//   - Links between Studio pages keep the view.
//   - changeLibrary(): the change's token files at its current version, anonymous-safe. One tree read on the GitHub
//     API (60 reads an hour for visitors), then only the files whose content differs from this build, read from
//     raw.githubusercontent.com (no API read) or, signed in, from the API. Kept in this browser per version, so the
//     next page and the next visit read nothing again until the change gets new edits.
//   - scopeLibrary(): the same for 2 to 4 changes shown together (?change=N,M): the latest library plus each one's
//     own token edits (scripts/combine-read, @bridge-ds/core token-combine), with the picks the address carries.
import { combineChanges, decodePicks, GitHubError } from '@bridge-ds/core';
import {
  bannerTitle,
  changePageHref,
  editInChangeHref,
  gitBlobSha,
  isTogether,
  keepScopeHref,
  LATEST,
  optionValue,
  pageOf,
  parseOptionValue,
  planFiles,
  readError,
  scopeHref,
  scopeChanges,
  scopeOf,
  staleKeys,
  togetherOption,
  togetherTitle,
  togetherValue,
  VIEW_CACHE_PREFIX,
  VIEW_OPTIONS_EVENT,
  VIEW_PICK_EVENT,
  VIEW_READY_EVENT,
  viewCacheKey,
  viewOptions,
  viewTitle,
  type LibraryScope,
  type TreeEntry,
  type ViewOptionsDetail,
  type ViewPull,
} from '../lib/view-scope';
import { changeLifecycle, type Lifecycle } from '../lib/change-status';
import { pullState } from '../lib/review-rules';
import { isTokenChange } from '../lib/continue-change';
import { ghVerb } from '../lib/gh-wording';
import { API, getToken, ghGet, hasWorkingToken, prefersSignIn, RateLimitError, readRepo, studioFetch } from './github-session';
import { readCached, type PullForStatus, type PullStatus } from './pr-status';
import { readTogetherSource } from './combine-read';
import { CODE_LINE } from '../lib/combine-changes';
import { todoChange, type QueuePullFull } from './needs-you';

export interface OpenPull extends ViewPull {
  labels?: { name: string }[];
  body?: string | null;
  user: { login: string };
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
}

let openRead: ReturnType<typeof ghGet<OpenPull[]>> | null = null;

/** The open changes, read once per page (the shell's nav count, the selector and the banner share it). */
export function readOpenPulls() {
  const { owner, repo } = readRepo();
  openRead ??= ghGet<OpenPull[]>(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
  return openRead;
}

export const pageScope = (): LibraryScope => scopeOf(location.search, location.pathname);

/** A change's status for the selector: the one the Changes list read for this version in this tab, else its state alone. */
function lifecycleOf(p: ViewPull): Lifecycle {
  const cached = readCached(p as unknown as PullForStatus);
  if (cached) {
    const l = todoChange(p as unknown as QueuePullFull, cached.status as PullStatus).lifecycle;
    if (l) return l;
  }
  return changeLifecycle({ state: pullState(p), waiting: false });
}

// ---------------------------------------------------------------------------------------------------------------
// The change being shown

let current: Promise<OpenPull> | null = null;

/** The change in the address: from the open list, else read on its own (it may have shipped or closed since). */
export function currentPull(): Promise<OpenPull> | null {
  const scope = pageScope();
  if (scope.kind === 'latest') return null;
  const n = scope.change;
  current ??= readOpenPulls()
    .then((f) => f.data.find((p) => p.number === n))
    .catch(() => undefined)
    .then(async (p) => {
      if (p) return p;
      const { owner, repo } = readRepo();
      return (await ghGet<OpenPull>(`/repos/${owner}/${repo}/pulls/${n}`)).data;
    });
  return current;
}

let currentAll: Promise<OpenPull[]> | null = null;

/** Every change the address shows (one, or the 2 to 4 shown together), in the address order. */
export function currentPulls(): Promise<OpenPull[]> | null {
  const scope = pageScope();
  if (scope.kind === 'latest') return null;
  const numbers = scopeChanges(scope);
  currentAll ??= readOpenPulls()
    .then((f) => f.data)
    .catch(() => [] as OpenPull[])
    .then((open) =>
      Promise.all(
        numbers.map(async (n) => {
          const p = open.find((x) => x.number === n);
          if (p) return p;
          const { owner, repo } = readRepo();
          return (await ghGet<OpenPull>(`/repos/${owner}/${repo}/pulls/${n}`)).data;
        }),
      ),
    );
  return currentAll;
}

/** Why a read failed, in words that say how to fix it. */
export function readFailure(err: unknown, title: string): string {
  const reset = err instanceof RateLimitError && err.resetAt ? err.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  if (err instanceof TogetherError) return err.message;
  const kind = err instanceof RateLimitError ? 'rate' : err instanceof GitHubError && err.status === 404 ? 'missing' : 'other';
  return readError(kind, title, ghVerb(prefersSignIn()), reset);
}

// ---------------------------------------------------------------------------------------------------------------
// The change's files

export interface ChangeLibrary {
  pull: OpenPull;
  sha: string;
  /** Token files at the change's version, relative to the token root. */
  files: Record<string, string>;
  /** Files of the change's tree under `extraRoots` (component guidance), path -> blob id. */
  extra: Record<string, string>;
}

interface CacheEntry {
  at: number;
  tree: TreeEntry[];
  texts: Record<string, string>;
}

const sha1Hex = async (bytes: Uint8Array) => {
  const buf = await crypto.subtle.digest('SHA-1', bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

function readCache(key: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, entry: CacheEntry) {
  try {
    const entries = Object.keys(localStorage)
      .filter((k) => k.startsWith(VIEW_CACHE_PREFIX) && k !== key)
      .map((k) => ({ key: k, at: readCache(k)?.at ?? 0 }));
    for (const k of staleKeys(entries, 5)) localStorage.removeItem(k);
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* private mode or quota: the change is read again next time */
  }
}

const authHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = getToken();
  if (token && hasWorkingToken()) h.Authorization = `Bearer ${token}`;
  return h;
};

async function apiGet(url: string, accept?: string): Promise<Response> {
  // studioFetch drops a token GitHub refused and reads anonymously; it answers with the browser's Response.
  const res = (await studioFetch(url, { headers: { ...authHeaders(), ...(accept ? { Accept: accept } : {}) } })) as unknown as Response;
  if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429)) {
    const reset = res.headers.get('x-ratelimit-reset');
    throw new RateLimitError(reset ? new Date(Number(reset) * 1000) : null);
  }
  if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status}.`);
  return res;
}

/** The change's tree: only the token files and the extra roots are kept. One API read. */
async function readTree(sha: string, keep: (path: string) => boolean): Promise<TreeEntry[]> {
  const { owner, repo } = readRepo();
  const res = await apiGet(`${API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const body = (await res.json()) as { tree: TreeEntry[]; truncated?: boolean };
  if (body.truncated) throw new Error('The repository is too large to read in one request.');
  return body.tree.filter((e) => e.type === 'blob' && keep(e.path)).map((e) => ({ path: e.path, sha: e.sha, type: 'blob' }));
}

/** One file's text at the change's version: raw.githubusercontent.com for visitors (no API read), the API when signed in. */
async function readText(path: string, blob: string, sha: string): Promise<string> {
  const { owner, repo } = readRepo();
  if (hasWorkingToken()) return (await apiGet(`${API}/repos/${owner}/${repo}/git/blobs/${blob}`, 'application/vnd.github.raw')).text();
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status}.`);
  return res.text();
}

const libraries = new Map<string, Promise<ChangeLibrary>>();

/**
 * The change's token files. `main`: this build's token files (relative to `root`), whose content is reused where the
 * change did not touch it. `extraRoots`: other directories whose blob ids the page compares (component guidance).
 */
export function changeLibrary(pull: OpenPull, main: Record<string, string>, root: string, extraRoots: string[] = []): Promise<ChangeLibrary> {
  const sha = pull.head.sha;
  const memo = libraries.get(sha);
  if (memo) return memo;
  const p = (async () => {
    const { owner, repo } = readRepo();
    const key = viewCacheKey(`${owner}/${repo}`, sha);
    const prefix = `${root.replace(/^\/+|\/+$/g, '')}/`;
    const extras = extraRoots.map((r) => `${r.replace(/^\/+|\/+$/g, '')}/`);
    const cached = readCache(key);
    const tree = cached?.tree ?? (await readTree(sha, (path) => (path.startsWith(prefix) && path.endsWith('.tokens.json')) || extras.some((x) => path.startsWith(x))));
    const mainShas: Record<string, string> = {};
    await Promise.all(Object.entries(main).map(async ([rel, text]) => (mainShas[rel] = await gitBlobSha(text, sha1Hex))));
    const plan = planFiles(mainShas, tree, root);
    const texts: Record<string, string> = { ...(cached?.texts ?? {}) };
    const bySha = new Map(tree.map((e) => [e.path, e.sha]));
    const missing = plan.fetch.filter((rel) => texts[rel] === undefined);
    // A few at a time: friendly to GitHub, quick for the handful of files a change touches.
    const queue = [...missing];
    const worker = async () => {
      for (let rel = queue.shift(); rel; rel = queue.shift()) texts[rel] = await readText(prefix + rel, bySha.get(prefix + rel)!, sha);
    };
    await Promise.all([worker(), worker(), worker()]);
    if (!cached || missing.length) writeCache(key, { at: Date.now(), tree, texts: Object.fromEntries(plan.fetch.map((rel) => [rel, texts[rel]!])) });
    const files: Record<string, string> = {};
    for (const rel of plan.reuse) files[rel] = main[rel]!;
    for (const rel of plan.fetch) files[rel] = texts[rel]!;
    const extra = Object.fromEntries(tree.filter((e) => extras.some((x) => e.path.startsWith(x))).map((e) => [e.path, e.sha]));
    return { pull, sha, files, extra };
  })();
  libraries.set(sha, p);
  p.catch(() => libraries.delete(sha));
  return p;
}

/** What a page shows: the token files, the component guidance ids (one change only), and where each token comes from. */
export interface ScopeLibrary {
  files: Record<string, string>;
  /** Files of the change's tree under the extra roots (one change only: a combination has no tree). */
  extra: Record<string, string> | null;
  /** Changes shown together: token path -> the changes whose value it takes. Null for one change. */
  from: Record<string, number[]> | null;
}

/**
 * The library a page shows for its address. One change: its token files (changeLibrary). Several together: the latest
 * library plus each one's own token edits, with the picks of the address. A code change, or a token they set
 * differently with no pick, stops with a sentence that says how to fix it (never a guess).
 */
export async function scopeLibrary(main: Record<string, string>, root: string, extraRoots: string[] = []): Promise<ScopeLibrary> {
  const scope = pageScope();
  if (!isTogether(scope)) {
    const pull = currentPull();
    if (!pull) return { files: main, extra: null, from: null };
    const lib = await changeLibrary(await pull, main, root, extraRoots);
    return { files: lib.files, extra: lib.extra, from: null };
  }
  const pulls = (await currentPulls())!;
  const sources = await Promise.all(pulls.map((p) => readTogetherSource(p, root)));
  const code = sources.find((x) => !x.tokens);
  if (code) throw new TogetherError(`${viewTitle(code.title)}: ${CODE_LINE.charAt(0).toLowerCase()}${CODE_LINE.slice(1)} Go back to Changes and check token changes only.`);
  const combo = combineChanges(main, sources.map((x) => x.edits!), decodePicks(scope.kind === 'view' ? scope.use : null));
  if (combo.problems.length) throw new TogetherError(`These changes cannot be combined here: ${combo.problems[0]}.`);
  if (combo.missing.length) {
    const n = combo.missing.length;
    throw new TogetherError(`${n === 1 ? '1 token has' : `${n} tokens have`} different values in these changes. Pick which one to use in Changes, then view them again.`);
  }
  return { files: combo.files, extra: null, from: combo.from };
}

/** A combination that cannot be shown as asked: its message is the banner's text. */
export class TogetherError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Banner

interface BannerState {
  title: string;
  /** Changes shown together: their titles, in the address order. */
  titles?: string[];
  body: string;
  error?: boolean;
  editable?: boolean;
}

let bannerState: BannerState | null = null;
/** The banner of a view, created on first use (page scripts may run before the shell). */
function bannerOf(): BannerState | null {
  const scope = pageScope();
  if (scope.kind !== 'view') return null;
  const together = isTogether(scope);
  bannerState ??= {
    title: together ? scopeChanges(scope).map((n) => `#${n}`).join(', ') : `change #${scope.change}`,
    body: pageOf(location.pathname) === 'quality' ? '' : together ? 'Reading their tokens.' : 'Reading its tokens.',
  };
  return bannerState;
}

function paintBanner() {
  // React and the DS Alert load only on a view (the shell ships on every page). The props are read when the module is
  // in, so the last state always wins whatever order the loads finish in.
  void import('../components/ds/studio/ViewBanner').then((m) => {
    const props = bannerProps();
    if (props) m.mountViewBanner(props.slot, props.props);
  });
}

function bannerProps() {
  const banner = bannerOf();
  const slot = document.querySelector<HTMLElement>('[data-view-banner]');
  const scope = pageScope();
  if (!slot || scope.kind !== 'view' || !banner) return null;
  slot.hidden = false;
  const page = pageOf(location.pathname);
  const together = isTogether(scope);
  const props = {
    title: banner.error ? banner.title : together ? togetherTitle(banner.titles ?? []) : bannerTitle(banner.title),
    body: banner.body,
    error: banner.error,
    latestHref: scopeHref(location, LATEST),
    // Changes shown together have no one change page: the way back is the latest library (and Changes, in the nav).
    changeHref: together || (page === 'quality' && !banner.error) ? null : changePageHref(scope.change),
    editHref: !together && page === 'tokens' && banner.editable && !banner.error ? editInChangeHref(scope.change) : null,
  };
  return { slot, props };
}

/** What the page shows of the change, in one sentence. Pages call it once their data is in. */
export function setBannerBody(body: string) {
  const banner = bannerOf();
  if (!banner || banner.error) return;
  banner.body = body;
  paintBanner();
}

/** The page could not read the change: the banner says why and how to fix it. */
export function setBannerError(text: string) {
  const banner = bannerOf();
  if (!banner) return;
  Object.assign(banner, { title: isTogether(pageScope()) ? 'These changes could not be shown together' : 'This change could not be shown', body: text, error: true });
  paintBanner();
}

// ---------------------------------------------------------------------------------------------------------------

function sendOptions(detail: ViewOptionsDetail) {
  last = detail;
  document.dispatchEvent(new CustomEvent(VIEW_OPTIONS_EVENT, { detail }));
}
let last: ViewOptionsDetail | null = null;

/** Studio shell: the selector, the banner and the links on the pages that can show a change. */
export function initViewChange() {
  const scope = pageScope();
  const { defaultBranch, owner, repo } = readRepo();

  // Keep the view while moving between Studio pages (never the edit, which belongs to Tokens).
  if (scope.kind !== 'latest') {
    const view: LibraryScope = scope.kind === 'edit' ? { kind: 'view', change: scope.change } : scope;
    document.querySelectorAll<HTMLAnchorElement>('a[data-keep-branch]').forEach((a) => (a.href = keepScopeHref(a.getAttribute('href') ?? '', view, location.href)));
    document.querySelectorAll<HTMLAnchorElement>('a[data-change-href]').forEach((a) => (a.href = changePageHref(scope.change)));
  }

  if (!document.querySelector('[data-view-pick]')) return;
  const together = isTogether(scope);
  const value = together ? togetherValue(scopeChanges(scope)) : optionValue(scope.kind === 'latest' ? null : scope.change);
  const placeholder = scope.kind === 'latest' ? [] : together ? [togetherOption(scopeChanges(scope), [])] : [{ value, label: `Change #${scope.change}`, description: 'Reading it', group: 'Open changes' }];
  /** The options with the changes shown together first, as the selector's current value. */
  const withTogether = (options: ReturnType<typeof viewOptions>, titles: string[]) => (together ? [options[0]!, togetherOption(scopeChanges(scope), titles), ...options.slice(1)] : options);
  let titles: string[] = [];
  sendOptions({ options: [...viewOptions([], { defaultBranch, lifecycleOf })].concat(placeholder), value });
  document.addEventListener(VIEW_READY_EVENT, () => last && sendOptions(last));
  document.addEventListener(VIEW_PICK_EVENT, (e) => {
    if ((e as CustomEvent<string>).detail === value) return;
    const n = parseOptionValue((e as CustomEvent<string>).detail);
    location.href = scopeHref(location, n ? { kind: 'view', change: n } : LATEST);
  });

  paintBanner();
  const pull = currentPull();
  readOpenPulls()
    .then(async (f) => {
      const cur = pull ? await pull.catch(() => null) : null;
      const all = together ? await (currentPulls() ?? Promise.resolve([])).catch(() => []) : [];
      titles = all.map((p) => viewTitle(p.title));
      sendOptions({ options: withTogether(viewOptions(f.data, { defaultBranch, lifecycleOf, current: together ? null : cur }), titles), value, note: f.stale ? 'GitHub could not be reached: the changes listed are from your last visit.' : undefined });
    })
    .catch(async () => {
      const cur = pull ? await pull.catch(() => null) : null;
      sendOptions({ options: withTogether(viewOptions([], { defaultBranch, lifecycleOf, current: together ? null : cur }), titles), value, note: `GitHub could not be reached, so no change is listed. ${ghVerb(prefersSignIn())} or try again in a minute.` });
    });
  if (together) {
    currentPulls()!
      .then((pulls) => {
        const banner = bannerOf();
        if (!banner || banner.error) return;
        banner.titles = pulls.map((p) => viewTitle(p.title));
        paintBanner();
      })
      .catch((err) => setBannerError(readFailure(err, 'These changes')));
  } else if (scope.kind === 'view' && pull) {
    pull
      .then((p) => {
        const banner = bannerOf();
        if (!banner || banner.error) return;
        banner.title = viewTitle(p.title);
        banner.editable = isTokenChange({ ...p, state: p.state ?? 'open' }, `${owner}/${repo}`);
        paintBanner();
      })
      .catch((err) => setBannerError(readFailure(err, `Change #${scope.change}`)));
  }
}
