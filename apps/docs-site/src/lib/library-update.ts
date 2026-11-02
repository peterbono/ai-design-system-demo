// The library update of a product (Florian's decision, 2026-11-02): after the library publishes a new version, Bridge
// sends the developers of each product an "Update the library" pull request, and the product page says how far behind
// the product is. This file is pure (no DOM, no Node API): the product page (scripts/library-update.ts) and the server
// (api/_lib/library-update.ts) share it.
//   - Versions: a small semver (parse, compare, satisfies for the ranges package.json uses), versionsBehind.
//   - Detection: what a product installs, from its package.json and its npm lockfile (package-lock.json v2 or v3).
//     Another lockfile (pnpm, yarn, bun): the package.json range only, and the page says Bridge cannot tell.
//   - The change: the new package.json ranges (only when the range does not already take the new version) and the
//     lockfile entries of the library packages, patched only when their dependency trees are unchanged (version,
//     resolved and integrity from the registry). Anything else: package.json only, and the developers run npm install.
//   - The pull request: branch, title, body (Bridge's marker, so Bridge knows its own), and the page's words.

// ---------------------------------------------------------------------------------------------------------------
// Versions

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const VERSION = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** A full version ("1.8.4", "2.0.0-next.1"), or null. */
export function parseVersion(v: string | null | undefined): SemVer | null {
  const m = VERSION.exec((v ?? '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

const comparePre = (a: string[], b: string[]): number => {
  if (!a.length || !b.length) return a.length ? -1 : b.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

/** -1, 0 or 1; null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return comparePre(x.pre, y.pre);
}

type Op = '>=' | '>' | '<=' | '<' | '=';
type Comparator = { op: Op; v: SemVer };

const PARTIAL = /^v?(\d{1,9}|[xX*])(?:\.(\d{1,9}|[xX*]))?(?:\.(\d{1,9}|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const wild = (s: string | undefined) => s === undefined || s === 'x' || s === 'X' || s === '*';
const sv = (major: number, minor: number, patch: number, pre: string[] = []): SemVer => ({ major, minor, patch, pre });

/** The comparators of one range part ("^1.8.2", ">=18", "1.x", "*"), or null when Bridge does not read it. */
function comparatorsOf(part: string): Comparator[] | null {
  const m = /^(\^|~>?|>=|<=|>|<|=)?\s*(.+)$/.exec(part.trim());
  if (!m) return null;
  const op = m[1] ?? '';
  const p = PARTIAL.exec(m[2]!);
  if (!p) return null;
  const [, a, b, c, pre] = p;
  if (wild(a)) return op === '<' || op === '>' ? null : [];
  const M = Number(a);
  const mi = wild(b) ? null : Number(b);
  const pa = mi === null || wild(c) ? null : Number(c);
  const preParts = pre ? pre.split('.') : [];
  const low = sv(M, mi ?? 0, pa ?? 0, pa === null ? [] : preParts);
  if (op === '^') {
    const upper = M > 0 || mi === null ? sv(M + 1, 0, 0) : mi > 0 || pa === null ? sv(0, mi + 1, 0) : sv(0, 0, pa + 1);
    return [{ op: '>=', v: low }, { op: '<', v: { ...upper, pre: ['0'] } }];
  }
  if (op === '~' || op === '~>') {
    const upper = mi === null ? sv(M + 1, 0, 0) : sv(M, mi + 1, 0);
    return [{ op: '>=', v: low }, { op: '<', v: { ...upper, pre: ['0'] } }];
  }
  if (op === '' || op === '=') {
    if (mi === null) return [{ op: '>=', v: low }, { op: '<', v: sv(M + 1, 0, 0, ['0']) }];
    if (pa === null) return [{ op: '>=', v: low }, { op: '<', v: sv(M, mi + 1, 0, ['0']) }];
    return [{ op: '=', v: low }];
  }
  if (op === '>') {
    if (mi === null) return [{ op: '>=', v: sv(M + 1, 0, 0) }];
    if (pa === null) return [{ op: '>=', v: sv(M, mi + 1, 0) }];
    return [{ op: '>', v: low }];
  }
  if (op === '<=') {
    if (mi === null) return [{ op: '<', v: sv(M + 1, 0, 0, ['0']) }];
    if (pa === null) return [{ op: '<', v: sv(M, mi + 1, 0, ['0']) }];
    return [{ op: '<=', v: low }];
  }
  return [{ op: op as Op, v: low }];
}

const cmp = (x: SemVer, y: SemVer) => {
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return comparePre(x.pre, y.pre);
};

const holds = (c: Comparator, v: SemVer) => {
  const r = cmp(v, c.v);
  return c.op === '>=' ? r >= 0 : c.op === '>' ? r > 0 : c.op === '<=' ? r <= 0 : c.op === '<' ? r < 0 : r === 0;
};

/**
 * Whether `version` is in `range`, as npm reads the ranges a package.json uses (^ ~ >= > <= < =, x-ranges, spaces for
 * "and", || for "or"). A prerelease is only in a range that names a prerelease of the same version. Null when Bridge
 * does not read the range (a tag, a URL, a workspace or file reference, a hyphen range).
 */
export function satisfies(version: string, range: string): boolean | null {
  const v = parseVersion(version);
  if (!v) return null;
  const r = range.trim();
  if (!r || r === '*' || r === 'x') return v.pre.length === 0;
  if (/\s-\s|:|\//.test(r)) return null;
  let any = false;
  for (const alt of r.split('||')) {
    const parts = alt.trim().replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean);
    const comps: Comparator[] = [];
    for (const p of parts) {
      const c = comparatorsOf(p);
      if (!c) return null;
      comps.push(...c);
    }
    if (!comps.every((c) => holds(c, v))) continue;
    // A prerelease only matches a comparator that names a prerelease of the same major.minor.patch.
    if (v.pre.length && !comps.some((c) => c.v.pre.length && c.v.pre[0] !== '0' && c.v.major === v.major && c.v.minor === v.minor && c.v.patch === v.patch)) continue;
    any = true;
  }
  return any;
}

/** The lowest version a simple range names ("^1.8.2" is 1.8.2, ">=18" is 18.0.0), or null. */
export function rangeFloor(range: string): string | null {
  const m = /^\s*(?:\^|~>?|>=|=)?\s*v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?\s*$/.exec(range);
  return m ? `${m[1]}.${m[2] ?? 0}.${m[3] ?? 0}` : null;
}

/**
 * The package.json range after the update to `latest`: the same range when it already takes `latest` (nothing to
 * change); ^ and ~ keep their prefix, an exact version becomes `latest`. Null when Bridge does not rewrite that range.
 */
export function rangeFor(range: string, latest: string): string | null {
  const r = range.trim();
  if (satisfies(latest, r) === true) return range;
  if (/^\^\d+(\.\d+){0,2}$/.test(r)) return `^${latest}`;
  if (/^~\d+(\.\d+){0,2}$/.test(r)) return `~${latest}`;
  if (VERSION.test(r)) return latest;
  return null;
}

export type Bump = 'major' | 'minor' | 'patch' | 'prerelease';

export interface Behind {
  name: string;
  installed: string;
  latest: string;
  bump: Bump;
}

/**
 * The packages whose installed version is older than the latest published one, in the order the page names them
 * (lib packages first: components, then tokens, then the rest by name). Anything not a version on either side is left out.
 */
export function versionsBehind(installed: Readonly<Record<string, string | null | undefined>>, latest: Readonly<Record<string, string | null | undefined>>): Behind[] {
  const out: Behind[] = [];
  for (const [name, have] of Object.entries(installed)) {
    const want = latest[name];
    if (!have || !want) continue;
    const a = parseVersion(have);
    const b = parseVersion(want);
    if (!a || !b || cmp(a, b) >= 0) continue;
    const bump: Bump = a.major !== b.major ? 'major' : a.minor !== b.minor ? 'minor' : a.patch !== b.patch ? 'patch' : 'prerelease';
    out.push({ name, installed: have, latest: want, bump });
  }
  return out.sort((x, y) => packageRank(x.name) - packageRank(y.name) || x.name.localeCompare(y.name));
}

/** The order the page names library packages in: the components first (what "the library" means to designers). */
export function packageRank(name: string): number {
  const short = name.replace(/^@[^/]+\//, '');
  return short === 'react' ? 0 : short === 'tokens' ? 1 : 2;
}

// ---------------------------------------------------------------------------------------------------------------
// What a product installs

/** The npm scope of the library. A team's bridge.config.json previews.packages adds its own names. */
export const LIBRARY_SCOPE = '@bridge-ds/';

/** Whether `name` is a library package: the Bridge scope, or one the team's settings list. */
export const isLibraryName = (name: string, extra: readonly string[] = []) => name.startsWith(LIBRARY_SCOPE) || extra.includes(name);

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]{0,213}\/)?[a-z0-9][a-z0-9._~-]{0,213}$/;
/** A name npm accepts (lower case, optional scope): the only ones Bridge asks the registry about. */
export const validPackageName = (name: string) => name.length <= 214 && NPM_NAME.test(name);

export type LockKind = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'none';

/** The lockfile at the root of a product, from the names of its root files (package-lock.json wins). */
export function lockKindOf(rootFiles: readonly string[]): LockKind {
  const has = (f: string) => rootFiles.includes(f);
  if (has('package-lock.json') || has('npm-shrinkwrap.json')) return 'npm';
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'none';
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** One library package a product asks for: where (the folder of its package.json, '' for the root), with which range. */
export interface LibraryDep {
  name: string;
  /** Folder of the package.json that lists it ('' the root, "apps/web" a workspace). */
  dir: string;
  field: (typeof DEP_FIELDS)[number];
  range: string;
}

/** The library packages a package.json asks for (dependencies, devDependencies, optionalDependencies). */
export function libraryDepsOf(pkg: unknown, dir = '', extra: readonly string[] = []): LibraryDep[] {
  const out: LibraryDep[] = [];
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(obj(obj(pkg)[field]))) {
      if (typeof range === 'string' && isLibraryName(name, extra)) out.push({ name, dir, field, range });
    }
  }
  return out;
}

/**
 * The folders whose package.json asks for a library package, from an npm lockfile (v2 and v3 list each workspace's
 * own dependencies under packages["<folder>"]): the root first. Only the root when the lockfile says nothing.
 */
export function libraryDirsOf(lock: unknown, extra: readonly string[] = []): string[] {
  const packages = obj(obj(lock).packages);
  const dirs = Object.keys(packages).filter((k) => !/(^|\/)node_modules\//.test(k) && libraryDepsOf(packages[k], k, extra).length > 0 && !obj(packages[k]).link);
  return dirs.length ? dirs.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))) : [''];
}

/** The version npm installed of `name` for the package in `dir`: its own node_modules first, then the root's. */
export function installedVersion(lock: unknown, name: string, dir = ''): string | null {
  const packages = obj(obj(lock).packages);
  const keys = [dir ? `${dir}/node_modules/${name}` : null, `node_modules/${name}`].filter((k): k is string => k !== null);
  for (const k of keys) {
    const v = obj(packages[k]).version;
    if (typeof v === 'string') return v;
  }
  return null;
}

/** One library package as the page tells it. */
export interface LibraryPackageState {
  name: string;
  range: string;
  /** What the lockfile says is installed; null without an npm lockfile (another lockfile, or none). */
  installed: string | null;
  latest: string | null;
}

export interface LibraryState {
  lock: LockKind;
  packages: LibraryPackageState[];
  behind: Behind[];
  /** The package the page names ("the library"): the components, else the first one behind, else the first. */
  headline: LibraryPackageState | null;
}

/**
 * What a product uses of the library: its package.json (and the workspaces its npm lockfile names), the versions the
 * lockfile installed, and the latest published ones. Without an npm lockfile, `installed` is null: the range only.
 */
export function libraryState(x: { pkg: unknown; lock: unknown | null; lockKind: LockKind; latest: Readonly<Record<string, string | null>>; workspaces?: Readonly<Record<string, unknown>>; extra?: readonly string[] }): LibraryState {
  const extra = x.extra ?? [];
  const deps = [...libraryDepsOf(x.pkg, '', extra), ...Object.entries(x.workspaces ?? {}).flatMap(([dir, p]) => libraryDepsOf(p, dir, extra))];
  const lock = x.lockKind === 'npm' ? x.lock : null;
  const seen = new Map<string, LibraryPackageState>();
  for (const d of deps) {
    if (seen.has(d.name)) continue;
    seen.set(d.name, { name: d.name, range: d.range, installed: lock ? installedVersion(lock, d.name, d.dir) : null, latest: x.latest[d.name] ?? null });
  }
  const packages = [...seen.values()].sort((a, b) => packageRank(a.name) - packageRank(b.name) || a.name.localeCompare(b.name));
  const behind = versionsBehind(Object.fromEntries(packages.map((p) => [p.name, p.installed])), Object.fromEntries(packages.map((p) => [p.name, p.latest])));
  const headline = packages.find((p) => packageRank(p.name) === 0) ?? packages.find((p) => behind.some((b) => b.name === p.name)) ?? packages[0] ?? null;
  return { lock: x.lockKind, packages, behind, headline };
}

// ---------------------------------------------------------------------------------------------------------------
// The change

/** The registry's manifest of one version (GET registry.npmjs.org/<name>/<version>): what the lockfile entry holds. */
export interface RegistryManifest {
  name: string;
  version: string;
  dist: { tarball: string; integrity?: string; shasum?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, unknown>;
  bin?: unknown;
  os?: unknown;
  cpu?: unknown;
  license?: unknown;
  engines?: unknown;
  funding?: unknown;
}

export const REGISTRY = 'https://registry.npmjs.org/';

/** Deep equality of JSON values, object keys in any order; a missing object equals an empty one. */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o = v as Json;
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .map((k) => [k, norm(o[k])]),
      );
    }
    return v;
  };
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as Json).length === 0);
  if (empty(a) && empty(b)) return true;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** The indent and final newline of a JSON file, so a rewrite keeps how the developers wrote it. */
export function jsonStyle(text: string): { indent: string | number; newline: boolean } {
  const m = /^[{[]\r?\n([ \t]+)\S/.exec(text);
  return { indent: m ? (m[1]!.includes('\t') ? '\t' : m[1]!.length) : 2, newline: /\n$/.test(text) };
}

const writeJson = (v: unknown, style: { indent: string | number; newline: boolean }) => JSON.stringify(v, null, style.indent) + (style.newline ? '\n' : '');

/** One package to update: its latest manifest, and the new range of each package.json that asks for it. */
export interface PackageUpdate {
  name: string;
  manifest: RegistryManifest;
}

export type LockPatch = { ok: true; text: string } | { ok: false; reason: 'lockfile-version' | 'not-json' | 'not-found' | 'several-copies' | 'other-source' | 'dependencies-changed' | 'dependents' | 'unknown-range' };

/**
 * The npm lockfile (v2 or v3) with the library packages at their new version, when that is safe without npm: each
 * package has one copy in the tree, from the public registry, and its new version has the same dependencies (and peer
 * and optional ones, its bin, os and cpu) as the installed one; every package and workspace that depends on it takes
 * the new version (with the new package.json ranges of `ranges`, "<dir>\u0000<name>" to range). Then only version,
 * resolved, integrity (and license, engines, funding) change, plus the workspaces' ranges. Otherwise why not: the
 * developers run npm install.
 */
export function patchLockfile(text: string, updates: readonly PackageUpdate[], ranges: ReadonlyMap<string, string> = new Map()): LockPatch {
  let lock: Json;
  try {
    lock = obj(JSON.parse(text));
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  const version = lock.lockfileVersion;
  if (version !== 3 && version !== 2) return { ok: false, reason: 'lockfile-version' };
  const packages = obj(lock.packages);
  // v2 also keeps the v1 tree under `dependencies`: Bridge does not rewrite it.
  if (version === 2 && Object.keys(obj(lock.dependencies)).length) return { ok: false, reason: 'lockfile-version' };
  // The workspaces' declared ranges first (the lockfile mirrors each package.json under packages["<dir>"]).
  for (const [key, range] of ranges) {
    const [dir, name] = key.split('\u0000') as [string, string];
    const entry = packages[dir];
    if (!entry || typeof entry !== 'object') continue;
    for (const field of DEP_FIELDS) {
      const deps = (entry as Json)[field];
      if (deps && typeof deps === 'object' && typeof (deps as Json)[name] === 'string') (deps as Json)[name] = range;
    }
  }
  for (const u of updates) {
    const keys = Object.keys(packages).filter((k) => k === `node_modules/${u.name}` || k.endsWith(`/node_modules/${u.name}`));
    if (!keys.length) return { ok: false, reason: 'not-found' };
    if (keys.length > 1) return { ok: false, reason: 'several-copies' };
    const entry = obj(packages[keys[0]!]);
    if (entry.link || typeof entry.resolved !== 'string' || !entry.resolved.startsWith(REGISTRY) || typeof u.manifest.dist?.tarball !== 'string' || !u.manifest.dist.tarball.startsWith(REGISTRY) || !u.manifest.dist.integrity) {
      return { ok: false, reason: 'other-source' };
    }
    const m = u.manifest;
    const same =
      sameJson(entry.dependencies, m.dependencies) &&
      sameJson(entry.optionalDependencies, m.optionalDependencies) &&
      sameJson(entry.peerDependencies, m.peerDependencies) &&
      sameJson(entry.peerDependenciesMeta, m.peerDependenciesMeta) &&
      sameJson(entry.bin, m.bin) &&
      sameJson(entry.os, m.os) &&
      sameJson(entry.cpu, m.cpu);
    if (!same) return { ok: false, reason: 'dependencies-changed' };
    // Everyone that asks for it (the root, a workspace, another package, as a peer too) must take the new version.
    for (const [k, e] of Object.entries(packages)) {
      if (k === keys[0]) continue;
      for (const field of [...DEP_FIELDS, 'peerDependencies'] as const) {
        const want = obj(obj(e)[field])[u.name];
        if (typeof want !== 'string') continue;
        const ok = satisfies(m.version, want);
        if (ok === null) return { ok: false, reason: 'unknown-range' };
        if (!ok) return { ok: false, reason: 'dependents' };
      }
    }
    entry.version = m.version;
    entry.resolved = m.dist.tarball;
    entry.integrity = m.dist.integrity;
    for (const k of ['license', 'engines', 'funding'] as const) {
      if (m[k] !== undefined && m[k] !== null) entry[k] = m[k];
      else delete entry[k];
    }
  }
  return { ok: true, text: writeJson(lock, jsonStyle(text)) };
}

/** A package.json with new ranges for some of its library packages (`ranges`: name to range), in its own style. */
export function patchPackageJson(text: string, ranges: ReadonlyMap<string, string>): string {
  const pkg = obj(JSON.parse(text));
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of ranges) if (typeof (deps as Json)[name] === 'string') (deps as Json)[name] = range;
  }
  return writeJson(pkg, jsonStyle(text));
}

// ---------------------------------------------------------------------------------------------------------------
// The pull request

/** Every update pull request's branch starts with this; the version follows. */
export const UPDATE_BRANCH_PREFIX = 'bridge/update-library-';
export const updateBranch = (version: string) => `${UPDATE_BRANCH_PREFIX}${version}`;
/** The update branch Bridge may write: its prefix and a version, nothing else. */
export const UPDATE_BRANCH = /^bridge\/update-library-\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]{1,40})?$/;

/** Bridge's marker in the body: Bridge recognizes its own update pull request, and the version it sends. */
export const UPDATE_MARKER = '<!-- bridge:library-update -->';
const MARKER_VERSION = /<!-- bridge:library-update version=(\S+) -->/;

export const updateTitle = (version: string) => `Update the Bridge library to ${version}`;

/** Whether a pull request is Bridge's library update (its marker, on an update branch of the same repository). */
export function isUpdatePull(p: { body?: string | null; head?: { ref?: string; repo?: { full_name?: string } | null } | null; state?: string }, repo: string): boolean {
  const ref = p.head?.ref ?? '';
  return ref.startsWith(UPDATE_BRANCH_PREFIX) && (p.body ?? '').includes(UPDATE_MARKER) && (p.head?.repo?.full_name ?? '').toLowerCase() === repo.toLowerCase();
}

/** The version an update pull request sends, from its marker. */
export const updateVersionOf = (body: string | null | undefined): string | null => MARKER_VERSION.exec(body ?? '')?.[1] ?? null;

export interface UpdateBodyInput {
  /** The product, as people read it ("Art print shop"). */
  product: string;
  version: string;
  packages: { name: string; from: string | null; to: string; rangeFrom: string; rangeTo: string }[];
  /** The library's changelog page on Bridge. */
  changelog: string | null;
  lockfile: 'patched' | 'install' | 'other' | 'none';
  /** Who asked, in Bridge ("Florian"); null when Bridge sent it on its own. */
  requestedBy: string | null;
}

/** The pull request's body: what changed per package, what the developers do, the marker. No em dash. */
export function updateBody(x: UpdateBodyInput): string {
  const rows = x.packages.map((p) => {
    const from = p.from ?? p.rangeFrom;
    const range = p.rangeFrom === p.rangeTo ? '' : ` (package.json ${p.rangeFrom} to ${p.rangeTo})`;
    return `| \`${p.name}\` | ${from} | ${p.to}${range} | ${x.changelog ? `[What changed](${x.changelog})` : 'See the package changelog'} |`;
  });
  const lock =
    x.lockfile === 'patched'
      ? 'package-lock.json changes only for these packages: same dependencies, with the version, resolved URL and integrity from the npm registry. Nothing else in the tree moves.'
      : x.lockfile === 'install'
        ? 'The new versions change their dependencies, so Bridge updated package.json only. Run `npm install` on this branch and push the lockfile before you merge.'
        : x.lockfile === 'other'
          ? 'This repository uses another lockfile than package-lock.json, so Bridge updated package.json only. Run your install on this branch and push the lockfile before you merge.'
          : 'This repository has no lockfile: Bridge updated package.json only.';
  return [
    UPDATE_MARKER,
    `<!-- bridge:library-update version=${x.version} -->`,
    `The Bridge library ${x.version} is out. This updates ${x.product} to it.`,
    '',
    '| Package | From | To | Changes |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `**Lockfile:** ${lock}`,
    '',
    'Bridge never merges this pull request. Run your checks, review it and merge it when you are ready. When a newer version comes out before then, Bridge updates this pull request instead of opening another one.',
    ...(x.requestedBy ? ['', `Requested by ${x.requestedBy} through Bridge.`] : []),
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// The product page's words (designers never read a package name, a lockfile or a pull request)

export const LIBRARY_UPDATE_WORDS = {
  behind: (product: string, from: string, latest: string) => `${product} uses the library from ${from}. The latest is ${latest}.`,
  current: (product: string, version: string) => `${product} uses the latest library, ${version}.`,
  unknown: (product: string, latest: string) => `The latest library is ${latest}. Bridge cannot tell which one ${product} uses yet.`,
  send: 'Send the update to the developers',
  sent: 'Update sent to the developers.',
  open: 'Open their update',
  failed: 'Bridge could not send the update. Try again in a minute.',
};

/** An update pull request of the product, open now. */
export interface OpenUpdate {
  number: number;
  url: string;
  version: string | null;
}

export interface LibraryLine {
  text: string;
  /** "Send the update to the developers": the product behind, no update open for the latest. */
  send: boolean;
  /** "Update sent to the developers." */
  sent: boolean;
  /** "Open their update", for people signed in with GitHub only. */
  link: string | null;
}

/**
 * The product page's library line: how far behind the product is, and what the viewer may do. Only for the people
 * who can send the update (a lead or an admin, `canSend`): for everyone else it is a fact they cannot act on, so null.
 * Null too when the product asks for no library package or the latest version is not known.
 */
export function libraryLine(product: string, state: LibraryState | null, x: { update: OpenUpdate | null; canSend: boolean; github: boolean }): LibraryLine | null {
  const h = state?.headline;
  if (!x.canSend || !state || !h?.latest) return null;
  const behind = state.behind.length > 0;
  // Without an npm lockfile, the range only: behind for sure when it cannot take the latest, else not known.
  const rangeOnly = h.installed === null;
  const rangeTakesLatest = satisfies(h.latest, h.range);
  const knownBehind = behind || (rangeOnly && rangeTakesLatest === false);
  const from = h.installed ?? rangeFloor(h.range);
  const text = knownBehind && from ? LIBRARY_UPDATE_WORDS.behind(product, from, h.latest) : rangeOnly ? LIBRARY_UPDATE_WORDS.unknown(product, h.latest) : LIBRARY_UPDATE_WORDS.current(product, h.installed!);
  const latestSent = Boolean(x.update && (x.update.version === null || compareVersions(x.update.version, h.latest) !== -1));
  return { text, send: knownBehind && !latestSent, sent: knownBehind && latestSent, link: knownBehind && latestSent && x.github && x.update ? x.update.url : null };
}
