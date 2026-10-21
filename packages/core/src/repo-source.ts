// RepoSource: the one way repository files reach the repo model (repo-model.ts). Every data path reads a design
// system repo through it, so the same code runs at build time (fsSource in @bridge-ds/core/node), in the browser
// (a GitHub source: one tree call, file bodies by sha) and from a published snapshot. Pure: no Node, no DOM.

/** Which repository and commit a source reads. `sha` pins every read; a local checkout may say "working-tree". */
export interface RepoSourceRef {
  owner: string;
  repo: string;
  sha: string;
}

export interface RepoSource {
  ref: RepoSourceRef;
  /**
   * Repo-relative paths of every file under `prefix` (a directory, repo-relative, no trailing slash), at any depth,
   * sorted. Omitted or empty: the whole repository. A missing directory lists nothing.
   */
  list(prefix?: string): Promise<string[]>;
  /** Body of a repo-relative file as UTF-8 text, or null when the file does not exist. */
  text(path: string): Promise<string | null>;
}

/** "./a//b/" -> "a/b". Paths in a RepoSource are repo-relative and use "/". */
export function normalizeRepoPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
    .join('/');
}

/** True when `path` is `prefix` itself or a file below it. An empty prefix holds everything. */
export function isUnder(path: string, prefix: string | undefined): boolean {
  const p = normalizeRepoPath(prefix ?? '');
  return !p || path === p || path.startsWith(`${p}/`);
}

/** Parent directory of a repo-relative path ("" for a top-level file). */
export const parentDir = (path: string): string => {
  const p = normalizeRepoPath(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};

/** Joins repo-relative segments, dropping empty ones and "." ("packages", "", "a.json" -> "packages/a.json"). */
export const joinRepoPath = (...parts: (string | undefined)[]): string => normalizeRepoPath(parts.filter(Boolean).join('/'));

/**
 * A source over files held in memory, keyed by repo-relative path. Used by tests, by snapshots and by any caller
 * that already has the bodies (a browser cache).
 */
export function memorySource(files: Record<string, string>, ref: Partial<RepoSourceRef> = {}): RepoSource {
  const map = new Map(Object.entries(files).map(([k, v]) => [normalizeRepoPath(k), v]));
  const paths = [...map.keys()].sort();
  return {
    ref: { owner: ref.owner ?? '', repo: ref.repo ?? '', sha: ref.sha ?? 'memory' },
    list: async (prefix) => paths.filter((p) => isUnder(p, prefix)),
    text: async (path) => map.get(normalizeRepoPath(path)) ?? null,
  };
}

/**
 * Reads many files with a few requests in flight (4 by default, like loadRepoFiles), keyed by the path asked for.
 * A missing file maps to null. `onError` decides about a read that throws: return null to skip the file, or throw
 * (the default) to fail the whole read.
 */
export async function readRepoTexts(
  source: RepoSource,
  paths: string[],
  concurrency = 4,
  onError: (path: string, err: unknown) => null = (_path, err) => {
    throw err;
  },
): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths)];
  const out = new Map<string, string | null>();
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const path = unique[next++]!;
      let body: string | null;
      try {
        body = await source.text(path);
      } catch (err) {
        body = onError(path, err);
      }
      out.set(path, body);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, unique.length)) }, worker));
  return out;
}
