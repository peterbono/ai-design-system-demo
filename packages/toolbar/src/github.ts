// What the toolbar knows about a change, read from the public repository through Bridge's read proxy (reads.ts; GitHub
// directly when Bridge refuses): its title and head commit, its files (token change or code change, and which themes
// and brands its tokens touch), how far live has moved on since it started, and the visual impact manifest of that
// commit. At most six API reads per change and session, kept in sessionStorage. The manifest is looked up in the tree
// first, so a change without one never shows a failed request.
import { DEFAULT_PROXY, githubReads, type Reads } from './reads';
import { changedScreens, changeMode, readableTitle, tokenChanges, type BridgeBuild, type ChangeMode, type ManifestShot, type Screen, type TokenChange } from './session';

export interface ChangeFacts {
  number: number;
  title: string;
  url: string;
  sha: string;
  mode: ChangeMode;
  /** Every file the change edits (token layers tell which themes and brands can differ). */
  files: string[];
  /** Commits live (the default branch) gained since the change started; null when GitHub could not say. */
  behind: number | null;
  /** The tokens whose value the change edits, from its token files before and after (raw files, no API read). */
  tokens: TokenChange[];
  /** Admin screens this change alters, most changed first. Null when the visual impact has not run for this commit. */
  screens: Screen[] | null;
}

const VISUAL_BRANCH = 'bridge-visual';
const cacheKey = (n: number) => `bridge-admin:facts:v3:${n}`;

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The reads of a build: Bridge's proxy for its design system (the product's repository is one it lists), else GitHub. */
export function readsOf(build: Pick<BridgeBuild, 'owner' | 'repo' | 'ds' | 'proxy'>): Reads {
  return githubReads({ team: build.ds ?? `${build.owner}/${build.repo}`, proxy: build.proxy === undefined ? DEFAULT_PROXY : build.proxy });
}

type Tree = { tree: { path: string; type: string; sha: string }[] };

/** The manifest of pr-<n>/<sha>/ on the visual impact branch, or null when that folder does not exist. */
async function readManifest(gh: Reads, build: Pick<BridgeBuild, 'owner' | 'repo'>, R: string, n: number, sha: string): Promise<{ shots?: ManifestShot[] } | null> {
  const root = await gh.api<Tree>(`${R}/git/trees/${VISUAL_BRANCH}`).catch(() => null);
  const pr = root?.tree.find((e) => e.path === `pr-${n}` && e.type === 'tree');
  if (!pr) return null;
  const commits = await gh.api<Tree>(`${R}/git/trees/${pr.sha}`).catch(() => null);
  if (!commits?.tree.some((e) => e.path === sha && e.type === 'tree')) return null;
  return gh
    .file(build.owner, build.repo, VISUAL_BRANCH, `pr-${n}/${sha}/manifest.json`)
    .then((t) => JSON.parse(t) as { shots?: ManifestShot[] })
    .catch(() => null);
}

export async function loadChange(build: Pick<BridgeBuild, 'owner' | 'repo' | 'ds' | 'proxy'>, n: number, gh: Reads = readsOf(build)): Promise<ChangeFacts> {
  const store = session();
  try {
    const cached = store?.getItem(cacheKey(n));
    if (cached) return JSON.parse(cached) as ChangeFacts;
  } catch {
    // A broken cache entry is read again from GitHub.
  }
  const R = `/repos/${build.owner}/${build.repo}`;
  const [pull, files] = await Promise.all([
    gh.api<{ number: number; title: string; html_url: string; head: { sha: string }; base: { ref: string; sha: string } }>(`${R}/pulls/${n}`),
    gh.api<{ filename: string; status: string; previous_filename?: string }[]>(`${R}/pulls/${n}/files?per_page=100`),
  ]);
  // Token files at the base and the head of the change: the real diff, token by token. Added files have no base and
  // removed ones no head, so neither is asked for.
  const tokenFiles = files.filter((f) => f.filename.endsWith('.tokens.json')).slice(0, 8);
  const version = (sha: string, path: string) =>
    gh
      .file(build.owner, build.repo, sha, path)
      .then((t) => JSON.parse(t) as unknown)
      .catch(() => null);
  const tokenReads = Promise.all(
    tokenFiles.map(async (f) =>
      tokenChanges(
        f.filename,
        f.status === 'added' ? null : await version(pull.base.sha, f.previous_filename ?? f.filename),
        f.status === 'removed' ? null : await version(pull.head.sha, f.filename),
      ),
    ),
  );
  const [compare, manifest, tokens] = await Promise.all([
    gh.api<{ behind_by?: number }>(`${R}/compare/${encodeURIComponent(pull.base.ref)}...${pull.head.sha}`).catch(() => null),
    readManifest(gh, build, R, n, pull.head.sha),
    tokenReads,
  ]);
  const names = files.map((f) => f.filename);
  const facts: ChangeFacts = {
    number: pull.number,
    title: readableTitle(pull.title),
    url: pull.html_url,
    sha: pull.head.sha,
    mode: changeMode(names),
    files: names,
    tokens: tokens.flat(),
    behind: typeof compare?.behind_by === 'number' ? compare.behind_by : null,
    screens: manifest ? changedScreens(manifest.shots) : null,
  };
  try {
    store?.setItem(cacheKey(n), JSON.stringify(facts));
  } catch {
    // Storage blocked: the next page load reads GitHub again.
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------------------------
// Changes tried together (`?bridge=101,118,120`): no preview holds all of them, so the toolbar runs on the production
// admin and applies their token edits live. For each change: its title and version (one read), one compare against
// the library (the files it edits since it started, and where it started), then its token files at its start and now
// (contents at a commit, kept for good by Bridge). Two API reads per change.

export interface TogetherFacts {
  number: number;
  title: string;
  url: string;
  sha: string;
  mode: ChangeMode;
  /** Its token files where it started and now (relative to the tokens root); null for a code change. */
  source: { number: number; base: Record<string, string | undefined>; head: Record<string, string | undefined>; files: string[] } | null;
}

const togetherKey = (n: number) => `bridge-admin:together:v1:${n}`;

export async function loadTogetherChange(build: Pick<BridgeBuild, 'owner' | 'repo' | 'defaultBranch' | 'tokensRoot' | 'ds' | 'proxy'>, n: number, gh: Reads = readsOf(build)): Promise<TogetherFacts> {
  const store = session();
  try {
    const cached = store?.getItem(togetherKey(n));
    if (cached) return JSON.parse(cached) as TogetherFacts;
  } catch {
    // A broken cache entry is read again from GitHub.
  }
  const R = `/repos/${build.owner}/${build.repo}`;
  const pull = await gh.api<{ number: number; title: string; html_url: string; head: { sha: string }; base: { ref: string } }>(`${R}/pulls/${n}`);
  const compare = await gh.api<{ merge_base_commit?: { sha: string } | null; files?: { filename: string; status: string; previous_filename?: string }[] }>(
    `${R}/compare/${encodeURIComponent(build.defaultBranch ?? pull.base.ref)}...${pull.head.sha}`,
  );
  const files = compare.files ?? [];
  const names = files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));
  const root = `${(build.tokensRoot ?? 'packages/tokens/src').replace(/^\/+|\/+$/g, '')}/`;
  // Only token files under the root (and release notes) can be applied live; anything else is code.
  const tokenOnly = files.length > 0 && files.length < 300 && names.every((f) => (f.startsWith(root) && f.endsWith('.tokens.json')) || /contrast\.checks\.json$/.test(f) || f.startsWith('.changeset/'));
  const start = compare.merge_base_commit?.sha;
  let source: TogetherFacts['source'] = null;
  if (tokenOnly && start) {
    const text = (sha: string, path: string) => gh.file(build.owner, build.repo, sha, path);
    const mine = files.filter((f) => f.filename.startsWith(root) && f.filename.endsWith('.tokens.json'));
    const src = { number: n, base: {} as Record<string, string | undefined>, head: {} as Record<string, string | undefined>, files: mine.map((f) => f.filename.slice(root.length)) };
    await Promise.all(
      mine.map(async (f) => {
        const rel = f.filename.slice(root.length);
        src.base[rel] = f.status === 'added' ? undefined : await text(start, f.previous_filename ?? f.filename);
        src.head[rel] = f.status === 'removed' ? undefined : await text(pull.head.sha, f.filename);
      }),
    );
    source = src;
  }
  const facts: TogetherFacts = { number: pull.number, title: readableTitle(pull.title), url: pull.html_url, sha: pull.head.sha, mode: tokenOnly ? 'tokens' : 'code', source };
  try {
    store?.setItem(togetherKey(n), JSON.stringify(facts));
  } catch {
    // Storage blocked: the next page load reads GitHub again.
  }
  return facts;
}
