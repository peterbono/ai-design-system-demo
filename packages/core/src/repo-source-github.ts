// A RepoSource over GitHub, pinned to one commit sha: one recursive tree call lists every file with its blob sha,
// then each body is read by that blob sha. Signed in, bodies come from the git blobs API with the raw media type
// (the raw host refuses any request that carries a token: its CORS preflight answers 403). Anonymous, bodies of a
// public repository come from raw.githubusercontent.com at the commit sha, sent without headers (a simple CORS
// request, no API quota). Blobs are content-addressed: cached forever, never revalidated.

import { GitHubClient, GitHubError } from './github-client';
import { isUnder, normalizeRepoPath, type RepoSource } from './repo-source';

/** Where blob bodies are kept between sources (IndexedDB in the browser). Keyed by blob sha; may be async. */
export interface BlobCache {
  get(sha: string): string | undefined | Promise<string | undefined>;
  set(sha: string, text: string): void | Promise<void>;
}

export interface GitHubSourceOptions {
  /** Files larger than this are refused (status 413) instead of read. Default 1 MB. */
  maxFileBytes?: number;
  /** Body reads in flight at once. Default 4 (friendly to GitHub's secondary limits). */
  concurrency?: number;
  /**
   * A cache that outlives the source, keyed by blob sha. Bodies of private repositories land in it, so the caller
   * scopes it per repository and account and clears it on sign-out (plan 6.8).
   */
  blobCache?: BlobCache;
  /**
   * Hears what the source does: the tree once it is read (how many files the commit holds), then each body as it
   * lands, saying whether it came from the blob cache (no request) or from GitHub.
   */
  onProgress?: (event: GitHubSourceProgress) => void;
}

/** What a GitHub source reports through `onProgress`. */
export type GitHubSourceProgress = { kind: 'tree'; files: number } | { kind: 'file'; path: string; cached: boolean };

/** How bodies are read: the blobs API with the token, or the raw host without one. */
export type GitHubSourceMode = 'api' | 'raw';

export interface GitHubSource extends RepoSource {
  /** Where body reads go: 'api' when the client has a token, 'raw' otherwise. */
  readonly mode: GitHubSourceMode;
}

const FULL_SHA = /^[0-9a-f]{40}$/i;

/** A concurrency limiter: at most `n` tasks run at once, the rest wait in order. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * A source over `client`'s repository at commit `sha` (a full 40-character sha: a branch name would move under the
 * cache). The first `list` or `text` call reads the tree; `text` of a path the tree does not list costs no request.
 */
export function gitHubSource(client: GitHubClient, sha: string, opts: GitHubSourceOptions = {}): GitHubSource {
  if (!FULL_SHA.test(sha)) throw new Error(`gitHubSource needs a full commit sha, got "${sha}". Resolve the branch head first.`);
  const maxBytes = opts.maxFileBytes ?? 1_000_000;
  const run = limiter(Math.max(1, opts.concurrency ?? 4));
  const mode: GitHubSourceMode = client.canWrite ? 'api' : 'raw';

  let tree: Promise<Map<string, { sha: string; size: number | undefined }>> | undefined;
  const readTree = () => {
    tree ??= client.getTree(sha, true).then(
      ({ entries, truncated }) => {
        if (truncated) throw new GitHubError(413, 'The repository tree is too large to read in one request.');
        const files = new Map<string, { sha: string; size: number | undefined }>();
        for (const e of entries) if (e.type === 'blob') files.set(e.path, { sha: e.sha, size: e.size });
        opts.onProgress?.({ kind: 'tree', files: files.size });
        return files;
      },
      (err: unknown) => {
        tree = undefined; // A failed read (rate limit, network) is retried by the next call.
        throw err;
      },
    );
    return tree;
  };

  const bodies = new Map<string, Promise<string>>();

  const readBody = async (path: string, blobSha: string): Promise<string> => {
    const kept = await opts.blobCache?.get(blobSha);
    if (kept !== undefined) {
      opts.onProgress?.({ kind: 'file', path, cached: true });
      return kept;
    }
    const text = mode === 'api' ? await client.getBlobRaw(blobSha) : await client.readRawFile(path, sha);
    if (text === undefined) {
      const hint = mode === 'raw' ? ' Sign in with GitHub to read a private repository.' : '';
      throw new GitHubError(404, `${path} is listed at ${sha.slice(0, 7)} but GitHub did not return it.${hint}`);
    }
    try {
      await opts.blobCache?.set(blobSha, text);
    } catch {
      // A full or blocked cache only costs a read next time.
    }
    opts.onProgress?.({ kind: 'file', path, cached: false });
    return text;
  };

  return {
    ref: { owner: client.owner, repo: client.name, sha },
    mode,
    async list(prefix?: string) {
      // Sorted, like every RepoSource.
      return [...(await readTree()).keys()].filter((f) => isUnder(f, prefix)).sort();
    },
    async text(path: string) {
      const p = normalizeRepoPath(path);
      const entry = (await readTree()).get(p);
      if (!entry) return null;
      if (entry.size !== undefined && entry.size > maxBytes) {
        throw new GitHubError(413, `${p} is ${Math.round(entry.size / 1000)} KB; Bridge reads files up to ${Math.round(maxBytes / 1000)} KB.`);
      }
      let body = bodies.get(entry.sha);
      if (!body) {
        body = run(() => readBody(p, entry.sha));
        bodies.set(entry.sha, body);
        body.catch(() => bodies.delete(entry.sha));
      }
      return body;
    },
  };
}
