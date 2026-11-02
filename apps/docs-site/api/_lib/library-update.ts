// The library update of a product (src/lib/library-update.ts has the rules): Bridge opens, or updates in place, one
// "Update the Bridge library to <version>" pull request in the developers' repository of a product (bridge.config.json
// products[].repo, never the design team's copy), with an installation token of the Bridge app on that repository.
// api/contribute wires it: POST { action: 'library-update', repo: <team>, product: <key> } from a lead or an admin of
// the team, and GET ?npm=<names> for the latest versions the product page compares with.
//
// Policy (updateCallAllowed, deny by default), every GitHub call of the update goes through it:
//   GET    the product repository: the repository, contents, git refs and commits, pull requests
//   POST   git/trees        base_tree set; 1 to 8 entries, each a regular file (100644 blob with its content) named
//                           package.json or package-lock.json at the root or in a workspace folder (no dot folder, no
//                           node_modules, never .github), and only the files this update computed
//   POST   git/commits      a tree this update made, one parent
//   POST   git/refs         refs/heads/bridge/update-library-<version>, never the default branch, at a commit this
//                           update made
//   PATCH  git/refs/heads/bridge/update-library-<version>   to a commit this update made, never force
//   POST   pulls            head an update branch, base the default branch, the body with Bridge's marker
//   PATCH  pulls/<n>        the update pull request found open (Bridge's marker), title and body only
// Never: merges, reviews, labels, deleting a ref, contents writes, another repository, the default branch.
//
// Registry: GET https://registry.npmjs.org/<name>/latest, kept NPM_KEEP_S in Redis (bridge:npm:latest:<name>), only
// the fields a lockfile entry holds.

import { HttpError, GITHUB_DOWN, type FetchLike } from './http.js';
import type { Redis } from './redis.js';
import {
  REGISTRY,
  UPDATE_BRANCH,
  UPDATE_MARKER,
  isUpdatePull,
  libraryDepsOf,
  libraryDirsOf,
  libraryState,
  lockKindOf,
  packageRank,
  patchLockfile,
  patchPackageJson,
  rangeFor,
  satisfies,
  updateBody,
  updateBranch,
  updateTitle,
  updateVersionOf,
  validPackageName,
  type LibraryDep,
  type PackageUpdate,
  type RegistryManifest,
} from '../../src/lib/library-update.js';

export const NPM_KEEP_S = 5 * 60;
export const MAX_NPM_NAMES = 12;
export const npmKey = (name: string) => `bridge:npm:latest:${name}`;

const API = 'https://api.github.com';
const UA = 'bridge-library-update';
const SHA = /^[0-9a-f]{40}$/;

// ---------------------------------------------------------------------------------------------------------------
// The registry

const KEEP_FIELDS = ['name', 'version', 'dist', 'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'bin', 'os', 'cpu', 'license', 'engines', 'funding'] as const;

const trimManifest = (m: Record<string, unknown>): RegistryManifest => {
  const out: Record<string, unknown> = {};
  for (const k of KEEP_FIELDS) if (m[k] !== undefined) out[k] = m[k];
  const dist = (m.dist ?? {}) as Record<string, unknown>;
  out.dist = { tarball: dist.tarball, ...(typeof dist.integrity === 'string' ? { integrity: dist.integrity } : {}) };
  return out as unknown as RegistryManifest;
};

/** The manifest of the latest published version of `name`, from Redis while fresh; null when npm has no such package. */
export async function latestManifest(f: FetchLike, redis: Redis | null, name: string): Promise<RegistryManifest | null> {
  if (!validPackageName(name)) return null;
  const kept = redis ? await redis.cmd('GET', npmKey(name)).catch(() => null) : null;
  if (typeof kept === 'string') {
    try {
      return JSON.parse(kept) as RegistryManifest | null;
    } catch {
      /* read again */
    }
  }
  let res: Response;
  try {
    res = await f(`${REGISTRY}${name}/latest`, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': UA } });
  } catch {
    throw new HttpError(502, 'unreachable', NPM_DOWN);
  }
  if (res.status === 404) {
    await redis?.cmd('SET', npmKey(name), 'null', 'EX', NPM_KEEP_S).catch(() => undefined);
    return null;
  }
  if (!res.ok) throw new HttpError(502, 'unreachable', NPM_DOWN);
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || typeof data.version !== 'string' || data.name !== name) throw new HttpError(502, 'unreachable', NPM_DOWN);
  const m = trimManifest(data);
  await redis?.cmd('SET', npmKey(name), JSON.stringify(m), 'EX', NPM_KEEP_S).catch(() => undefined);
  return m;
}

export const NPM_DOWN = 'The package registry did not answer. Try again in a minute.';

/** The names of a ?npm= list: valid npm names, at most MAX_NPM_NAMES, else 400. */
export function parseNpmNames(v: string | null): string[] {
  const names = [...new Set((v ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (!names.length || names.length > MAX_NPM_NAMES || !names.every(validPackageName)) throw new HttpError(400, 'bad_request', 'Name up to 12 packages.');
  return names;
}

/** GET ?npm=: the latest version of each package (null for one npm does not know). Public data, kept NPM_KEEP_S. */
export async function npmLatest(f: FetchLike, redis: Redis | null, names: readonly string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  await Promise.all(names.map(async (n) => (out[n] = (await latestManifest(f, redis, n))?.version ?? null)));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The policy

/** What the update may write, learned as it goes: the repository, its default branch, the files, its own objects. */
export interface UpdateScope {
  /** "owner/name", the developers' repository. */
  repo: string;
  defaultBranch: string | null;
  /** The paths this update computed (package.json and package-lock.json files). */
  files: Set<string>;
  trees: Set<string>;
  commits: Set<string>;
  /** The update pull request found open (Bridge's marker), the only one it may edit. */
  pull: number | null;
}

export const newScope = (repo: string): UpdateScope => ({ repo, defaultBranch: null, files: new Set(), trees: new Set(), commits: new Set(), pull: null });

/** A package.json or package-lock.json at the root or in a workspace folder: no dot folder, no node_modules. */
export function isUpdateFile(path: string): boolean {
  const parts = path.split('/');
  const file = parts[parts.length - 1]!;
  if (file !== 'package.json' && file !== 'package-lock.json') return false;
  return parts.slice(0, -1).every((p) => /^[A-Za-z0-9_@][\w.@-]{0,99}$/.test(p) && p !== 'node_modules' && !p.startsWith('.'));
}

const READS: RegExp[] = [/^$/, /^contents(\/.*)?$/, /^git\/ref\/heads\/.+$/, /^git\/commits\/[0-9a-f]{40}$/, /^pulls$/, /^pulls\/\d{1,10}$/];
const onlyKeys = (b: Record<string, unknown>, keys: readonly string[]) => Object.keys(b).every((k) => keys.includes(k));

/**
 * Whether the update may make this GitHub call (null) or why not. `path` is the API path (from /repos/), without the
 * query; `body` the JSON body. Deny by default.
 */
export function updateCallAllowed(scope: UpdateScope, method: string, path: string, body: unknown): string | null {
  const base = `/repos/${scope.repo.toLowerCase()}`;
  const p = path.split('?')[0]!;
  if (p.toLowerCase() !== base && !p.toLowerCase().startsWith(`${base}/`)) return 'another repository';
  const rest = p.slice(base.length + 1);
  if (rest.split('/').some((s) => s === '..' || s === '.')) return 'a dot segment';
  const m = method.toUpperCase();
  if (m === 'GET') return READS.some((r) => r.test(rest)) ? null : 'a read the update does not need';
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const isDefault = (branch: string) => scope.defaultBranch === null || branch === scope.defaultBranch;
  if (m === 'POST' && rest === 'git/trees') {
    if (typeof b.base_tree !== 'string' || !SHA.test(b.base_tree) || !onlyKeys(b, ['base_tree', 'tree'])) return 'a tree without its base';
    const tree = Array.isArray(b.tree) ? b.tree : [];
    if (!tree.length || tree.length > 8) return 'a tree of no file or too many';
    for (const e of tree as Record<string, unknown>[]) {
      if (!e || typeof e !== 'object' || !onlyKeys(e, ['path', 'mode', 'type', 'content'])) return 'a tree entry with other fields';
      if (e.mode !== '100644' || e.type !== 'blob' || typeof e.content !== 'string' || typeof e.path !== 'string') return 'not a regular file';
      if (!isUpdateFile(e.path) || !scope.files.has(e.path)) return `a file the update does not change: ${String(e.path)}`;
    }
    return null;
  }
  if (m === 'POST' && rest === 'git/commits') {
    if (typeof b.tree !== 'string' || !scope.trees.has(b.tree)) return 'a commit of a tree the update did not make';
    if (!Array.isArray(b.parents) || b.parents.length !== 1 || !SHA.test(String(b.parents[0]))) return 'a commit without one parent';
    return onlyKeys(b, ['message', 'tree', 'parents']) ? null : 'a commit with other fields';
  }
  if (m === 'POST' && rest === 'git/refs') {
    const ref = typeof b.ref === 'string' ? b.ref : '';
    const branch = ref.replace(/^refs\/heads\//, '');
    if (!ref.startsWith('refs/heads/') || !UPDATE_BRANCH.test(branch) || isDefault(branch)) return 'not an update branch';
    return typeof b.sha === 'string' && scope.commits.has(b.sha) && onlyKeys(b, ['ref', 'sha']) ? null : 'a branch at a commit the update did not make';
  }
  const refMatch = /^git\/refs\/heads\/(.+)$/.exec(rest);
  if (m === 'PATCH' && refMatch) {
    const branch = decodeURIComponent(refMatch[1]!);
    if (!UPDATE_BRANCH.test(branch) || isDefault(branch)) return 'not an update branch';
    if (b.force === true) return 'a forced move';
    return typeof b.sha === 'string' && scope.commits.has(b.sha) && onlyKeys(b, ['sha', 'force']) ? null : 'a move to a commit the update did not make';
  }
  if (m === 'POST' && rest === 'pulls') {
    const head = typeof b.head === 'string' ? b.head.replace(/^[^:]+:/, '') : '';
    if (!UPDATE_BRANCH.test(head) || isDefault(head)) return 'not an update branch';
    if (b.base !== scope.defaultBranch) return 'not to the default branch';
    if (typeof b.body !== 'string' || !b.body.includes(UPDATE_MARKER)) return 'without Bridge’s marker';
    return onlyKeys(b, ['title', 'head', 'base', 'body', 'maintainer_can_modify']) ? null : 'a pull request with other fields';
  }
  const pullMatch = /^pulls\/(\d{1,10})$/.exec(rest);
  if (m === 'PATCH' && pullMatch) {
    if (scope.pull === null || Number(pullMatch[1]) !== scope.pull) return 'not the update pull request';
    if (typeof b.body === 'string' && !b.body.includes(UPDATE_MARKER)) return 'without Bridge’s marker';
    return onlyKeys(b, ['title', 'body']) ? null : 'only the title and body';
  }
  return 'not part of a library update';
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub, through the policy

interface Gh {
  scope: UpdateScope;
  get<T = any>(rest: string, raw?: boolean): Promise<{ status: number; data: T }>;
  send<T = any>(method: 'POST' | 'PATCH', rest: string, body: unknown): Promise<T>;
}

function guardedGitHub(f: FetchLike, token: string, scope: UpdateScope): Gh {
  const call = async (method: string, rest: string, body?: unknown, raw = false) => {
    const path = `/repos/${scope.repo}${rest ? `/${rest}` : ''}`;
    const why = updateCallAllowed(scope, method, path, body);
    if (why) throw new HttpError(403, 'not-allowed', UPDATE_FAILED, { reason: why });
    let res: Response;
    try {
      res = await f(`${API}${path}`, {
        method,
        headers: {
          Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': UA,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new HttpError(502, 'unreachable', GITHUB_DOWN);
    }
    if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
    return res;
  };
  return {
    scope,
    async get(rest, raw = false) {
      const res = await call('GET', rest, undefined, raw);
      const data = res.status === 200 ? (raw ? await res.text() : await res.json().catch(() => null)) : null;
      return { status: res.status, data };
    },
    async send(method, rest, body) {
      const res = await call(method, rest, body);
      const data = await res.json().catch(() => null);
      if (res.status !== 200 && res.status !== 201) throw new HttpError(res.status === 403 || res.status === 404 ? 409 : 502, 'github', UPDATE_FAILED, { status: res.status });
      return data;
    },
  };
}

export const UPDATE_FAILED = 'Bridge could not send the update. Try again in a minute.';

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

// ---------------------------------------------------------------------------------------------------------------
// The update

export interface UpdateInput {
  f: FetchLike;
  /** An installation token of the Bridge app on `repo` (contents and pull requests write). */
  token: string;
  /** The developers' repository, "owner/name". */
  repo: string;
  /** The product's name as people read it. */
  product: string;
  /** The library packages the team's settings list besides the Bridge scope (previews.packages). */
  extra?: readonly string[];
  /** The library's changelog page on Bridge. */
  changelog: string | null;
  requestedBy: string | null;
  redis: Redis | null;
}

export interface UpdateResult {
  /** opened: a new pull request; updated: the open one moved to this version; unchanged: it already had it; current: nothing to send. */
  state: 'opened' | 'updated' | 'unchanged' | 'current';
  pr: { number: number; url: string; version: string } | null;
  lockfile: 'patched' | 'install' | 'other' | 'none' | null;
}

/** Opens or updates the product's library update pull request. Never merges, never writes the default branch. */
export async function sendLibraryUpdate(x: UpdateInput): Promise<UpdateResult> {
  const scope = newScope(x.repo);
  const gh = guardedGitHub(x.f, x.token, scope);
  const extra = x.extra ?? [];

  const repoInfo = await gh.get<{ default_branch?: string }>('');
  if (repoInfo.status !== 200 || typeof repoInfo.data?.default_branch !== 'string') throw new HttpError(409, 'product_missing', UPDATE_FAILED);
  const def = repoInfo.data.default_branch;
  scope.defaultBranch = def;
  const at = `?ref=${encodeURIComponent(def)}`;

  const root = await gh.get<{ name: string; type: string }[]>(`contents${at}`);
  const rootFiles = Array.isArray(root.data) ? root.data.filter((e) => e.type === 'file').map((e) => e.name) : [];
  const lockKind = lockKindOf(rootFiles);
  const lockName = rootFiles.includes('package-lock.json') ? 'package-lock.json' : 'npm-shrinkwrap.json';
  const pkgText = (await gh.get<string>(`contents/package.json${at}`, true)).data;
  if (typeof pkgText !== 'string') return { state: 'current', pr: null, lockfile: null };
  const lockText = lockKind === 'npm' ? (await gh.get<string>(`contents/${lockName}${at}`, true)).data : null;
  let lock: unknown = null;
  try {
    lock = typeof lockText === 'string' ? JSON.parse(lockText) : null;
  } catch {
    lock = null;
  }

  // The package.json files that ask for the library: the root, and the workspaces the npm lockfile names.
  const texts = new Map<string, string>([['', pkgText]]);
  for (const dir of lock ? libraryDirsOf(lock, extra) : ['']) {
    if (dir === '' || !isUpdateFile(`${dir}/package.json`)) continue;
    const t = (await gh.get<string>(`contents/${encPath(dir)}/package.json${at}`, true)).data;
    if (typeof t === 'string') texts.set(dir, t);
  }
  const deps: LibraryDep[] = [];
  for (const [dir, t] of texts) {
    try {
      deps.push(...libraryDepsOf(JSON.parse(t), dir, extra));
    } catch {
      /* not JSON: left alone */
    }
  }
  const names = [...new Set(deps.map((d) => d.name))];
  const manifests = new Map<string, RegistryManifest>();
  await Promise.all(names.map(async (n) => {
    const m = await latestManifest(x.f, x.redis, n);
    if (m) manifests.set(n, m);
  }));
  const state = libraryState({
    pkg: JSON.parse(pkgText),
    lock,
    lockKind,
    latest: Object.fromEntries(names.map((n) => [n, manifests.get(n)?.version ?? null])),
    workspaces: Object.fromEntries([...texts].filter(([d]) => d !== '').map(([d, t]) => [d, JSON.parse(t)])),
    extra,
  });

  // What moves: with an npm lockfile, what it installed older than the latest; else what the range cannot take.
  const moving = state.packages.filter((p) => {
    if (!p.latest) return false;
    if (p.installed !== null) return state.behind.some((b) => b.name === p.name);
    return satisfies(p.latest, p.range) === false;
  });
  // Each package.json range that must change to take the latest (a range Bridge does not rewrite: that package stays).
  const ranges = new Map<string, string>();
  const updates: PackageUpdate[] = [];
  for (const p of moving) {
    const own = deps.filter((d) => d.name === p.name);
    const next = own.map((d) => ({ d, to: rangeFor(d.range, p.latest!) }));
    if (next.some((n) => n.to === null)) continue;
    for (const n of next) if (n.to !== n.d.range) ranges.set(`${n.d.dir}\u0000${p.name}`, n.to!);
    updates.push({ name: p.name, manifest: manifests.get(p.name)! });
  }
  if (!updates.length) return { state: 'current', pr: null, lockfile: null };
  const version = [...updates].sort((a, b) => packageRank(a.name) - packageRank(b.name))[0]!.manifest.version;

  // The files: the lockfile patched when that is safe; else package.json only, its ranges moved to the new versions so
  // that the developers' install takes them.
  let lockfile: UpdateResult['lockfile'] = lockKind === 'npm' ? 'install' : lockKind === 'none' ? 'none' : 'other';
  const files = new Map<string, string>();
  let patchedLock: string | null = null;
  if (lockKind === 'npm' && typeof lockText === 'string') {
    const r = patchLockfile(lockText, updates, ranges);
    if (r.ok) {
      patchedLock = r.text;
      lockfile = 'patched';
    }
  }
  if (!patchedLock) {
    for (const u of updates) {
      for (const d of deps.filter((y) => y.name === u.name)) {
        const pinned = d.range.trim().startsWith('~') ? `~${u.manifest.version}` : /^\d/.test(d.range.trim()) ? u.manifest.version : `^${u.manifest.version}`;
        ranges.set(`${d.dir}\u0000${u.name}`, pinned);
      }
    }
  }
  for (const [dir, t] of texts) {
    const mine = new Map([...ranges].filter(([k]) => k.split('\u0000')[0] === dir).map(([k, v]) => [k.split('\u0000')[1]!, v]));
    if (!mine.size) continue;
    const next = patchPackageJson(t, mine);
    if (next !== t) files.set(dir ? `${dir}/package.json` : 'package.json', next);
  }
  if (patchedLock && patchedLock !== lockText) files.set(lockName, patchedLock);
  for (const p of files.keys()) scope.files.add(p);
  if (!files.size) return { state: 'current', pr: null, lockfile: null };

  const changelog = x.changelog;
  const body = updateBody({
    product: x.product,
    version,
    packages: updates.map((u) => {
      const d = deps.find((y) => y.name === u.name)!;
      const s = state.packages.find((p) => p.name === u.name)!;
      return { name: u.name, from: s.installed, to: u.manifest.version, rangeFrom: d.range, rangeTo: ranges.get(`${d.dir}\u0000${u.name}`) ?? d.range };
    }),
    changelog,
    lockfile: lockfile!,
    requestedBy: x.requestedBy,
  });
  const title = updateTitle(version);
  const message = `${title}\n\n${updates.map((u) => `${u.name} ${state.packages.find((p) => p.name === u.name)?.installed ?? ''} -> ${u.manifest.version}`.replace('  ', ' ')).join('\n')}`;

  // One open update per product: found by Bridge's marker on an update branch of this repository.
  const open = await gh.get<any[]>('pulls?state=open&per_page=100');
  const mine = (Array.isArray(open.data) ? open.data : []).find((p) => isUpdatePull(p, x.repo));

  const commitOn = async (parent: string, branch: string, move: 'create' | 'move') => {
    const c = await gh.get<{ tree?: { sha?: string } }>(`git/commits/${parent}`);
    const baseTree = c.data?.tree?.sha;
    if (c.status !== 200 || typeof baseTree !== 'string') throw new HttpError(502, 'unreachable', UPDATE_FAILED);
    const tree = await gh.send<{ sha: string }>('POST', 'git/trees', { base_tree: baseTree, tree: [...files].map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) });
    scope.trees.add(tree.sha);
    const commit = await gh.send<{ sha: string }>('POST', 'git/commits', { message, tree: tree.sha, parents: [parent] });
    scope.commits.add(commit.sha);
    if (move === 'create') await gh.send('POST', 'git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
    else await gh.send('PATCH', `git/refs/heads/${encPath(branch)}`, { sha: commit.sha, force: false });
  };

  /** Whether `branch` already holds every file of this update. */
  const holds = async (branch: string) => {
    for (const [path, content] of files) {
      const r = await gh.get<string>(`contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`, true);
      if (r.data !== content) return false;
    }
    return true;
  };

  if (mine) {
    scope.pull = mine.number;
    const branch: string = mine.head.ref;
    if (!UPDATE_BRANCH.test(branch)) throw new HttpError(409, 'github', UPDATE_FAILED);
    const same = await holds(branch);
    if (!same) await commitOn(mine.head.sha, branch, 'move');
    const changed = !same || mine.title !== title || updateVersionOf(mine.body) !== version;
    if (changed) await gh.send('PATCH', `pulls/${mine.number}`, { title, body });
    return { state: changed ? 'updated' : 'unchanged', pr: { number: mine.number, url: mine.html_url, version }, lockfile };
  }

  const branch = updateBranch(version);
  const existing = await gh.get<{ object?: { sha?: string } }>(`git/ref/heads/${encPath(branch)}`);
  if (existing.status === 200 && typeof existing.data?.object?.sha === 'string') {
    // The branch is left from an update that was closed: the new commit goes on top of it (never forced).
    if (!(await holds(branch))) await commitOn(existing.data.object.sha, branch, 'move');
  } else {
    const head = await gh.get<{ object?: { sha?: string } }>(`git/ref/heads/${encPath(def)}`);
    const sha = head.data?.object?.sha;
    if (head.status !== 200 || typeof sha !== 'string') throw new HttpError(502, 'unreachable', UPDATE_FAILED);
    await commitOn(sha, branch, 'create');
  }
  const pr = await gh.send<{ number: number; html_url: string }>('POST', 'pulls', { title, head: branch, base: def, body, maintainer_can_modify: true });
  return { state: 'opened', pr: { number: pr.number, url: pr.html_url, version }, lockfile };
}
