// Minimal GitHub REST client over fetch. Talks to api.github.com only (the plugin manifest allows
// nothing else): file contents are read through the git trees and blobs endpoints.

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  permissions: { admin?: boolean; push?: boolean; pull?: boolean } | undefined;
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  mode: string;
}

export interface CompareResult {
  status: string;
  aheadBy: number;
  behindBy: number;
  files: { filename: string; status: string }[];
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  draft: boolean;
  headRef: string;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface RetryPolicy {
  /** Attempts for idempotent calls (GET, and content-addressed blob/tree/commit creation). */
  attempts: number;
  /** First backoff in ms; doubles each retry. */
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 600, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** Transient failures worth retrying: network errors, 5xx, and secondary rate limits. */
const isTransient = (status: number, detail: string) => status === 0 || status >= 500 || status === 429 || (status === 403 && /secondary rate limit/i.test(detail));

const API = 'https://api.github.com';

export function parseRepo(repo: string): { owner: string; name: string } {
  const m = /^\s*([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\s*$/.exec(repo);
  if (!m) throw new Error(`"${repo}" is not a repository. Use the form owner/name.`);
  return { owner: m[1]!, name: m[2]! };
}

export function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

export class GitHubClient {
  private readonly owner: string;
  private readonly name: string;
  private readonly blobCache = new Map<string, string>();

  constructor(
    repo: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
  ) {
    const r = parseRepo(repo);
    this.owner = r.owner;
    this.name = r.name;
  }

  private get repoPath() {
    return `/repos/${this.owner}/${this.name}`;
  }

  private async request<T>(method: string, path: string, body?: unknown, retryable = method === 'GET'): Promise<T> {
    const attempts = retryable ? Math.max(1, this.retry.attempts) : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once<T>(method, path, body);
      } catch (err) {
        const e = err as GitHubError;
        if (attempt >= attempts || !(e instanceof GitHubError) || !isTransient(e.status, e.detail ?? '')) throw err;
        await this.retry.sleep(this.retry.baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  private async once<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${API}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (err) {
      throw new GitHubError(0, 'Could not reach GitHub. Check your connection, then try again.', (err as Error).message);
    }
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      let detail = '';
      try {
        const data = (await res.json()) as { message?: string; errors?: ({ message?: string } | string)[] };
        detail = [data.message, ...(data.errors ?? []).map((e) => (typeof e === 'string' ? e : e.message))].filter(Boolean).join(' ');
      } catch {
        detail = '';
      }
      const remaining = res.headers?.get('x-ratelimit-remaining');
      const reset = res.headers?.get('x-ratelimit-reset');
      if ((res.status === 403 || res.status === 429) && remaining === '0') {
        const when = reset ? new Date(Number(reset) * 1000) : undefined;
        throw new GitHubError(
          429,
          `GitHub's hourly request limit for this token is used up.${when ? ` It resets at ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''} Try again after that.`,
          detail,
        );
      }
      throw new GitHubError(res.status, friendlyMessage(res.status, detail), detail);
    }
    return (await res.json()) as T;
  }

  async getRepo(): Promise<RepoInfo> {
    const r = await this.request<{ full_name: string; default_branch: string; private: boolean; permissions?: RepoInfo['permissions'] }>(
      'GET',
      this.repoPath,
    );
    return { fullName: r.full_name, defaultBranch: r.default_branch, private: r.private, permissions: r.permissions };
  }

  /** Commit sha a branch points to, or undefined when the branch does not exist. */
  async getBranchSha(branch: string): Promise<string | undefined> {
    try {
      const r = await this.request<{ object: { sha: string } }>('GET', `${this.repoPath}/git/ref/heads/${encodeRef(branch)}`);
      return r.object.sha;
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return undefined;
      throw err;
    }
  }

  async getCommitTree(commitSha: string): Promise<string> {
    const r = await this.request<{ tree: { sha: string } }>('GET', `${this.repoPath}/git/commits/${commitSha}`);
    return r.tree.sha;
  }

  async getTree(treeSha: string, recursive = true): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const r = await this.request<{ tree: TreeEntry[]; truncated: boolean }>(
      'GET',
      `${this.repoPath}/git/trees/${treeSha}${recursive ? '?recursive=1' : ''}`,
    );
    return { entries: r.tree, truncated: r.truncated };
  }

  async getBlobText(sha: string): Promise<string> {
    const cached = this.blobCache.get(sha);
    if (cached !== undefined) return cached;
    const r = await this.request<{ content: string; encoding: string }>('GET', `${this.repoPath}/git/blobs/${sha}`);
    const text = r.encoding === 'base64' ? base64ToUtf8(r.content) : r.content;
    this.blobCache.set(sha, text);
    return text;
  }

  async compare(base: string, head: string): Promise<CompareResult> {
    const r = await this.request<{ status: string; ahead_by: number; behind_by: number; files?: { filename: string; status: string }[] }>(
      'GET',
      `${this.repoPath}/compare/${base}...${head}`,
    );
    return { status: r.status, aheadBy: r.ahead_by, behindBy: r.behind_by, files: (r.files ?? []).map((f) => ({ filename: f.filename, status: f.status })) };
  }

  async createBlob(content: string): Promise<string> {
    // Blobs, trees and commits are content-addressed: retrying a create is harmless.
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath}/git/blobs`, { content, encoding: 'utf-8' }, true);
    return r.sha;
  }

  async createTree(baseTree: string, files: { path: string; sha: string }[]): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath}/git/trees`, {
      base_tree: baseTree,
      tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha })),
    }, true);
    return r.sha;
  }

  async createCommit(message: string, tree: string, parents: string[]): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath}/git/commits`, { message, tree, parents }, true);
    return r.sha;
  }

  async createBranch(branch: string, sha: string): Promise<void> {
    await this.request('POST', `${this.repoPath}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  /** Fast-forward a branch. Never forces: a concurrent push makes this fail instead of losing work. */
  async updateBranch(branch: string, sha: string): Promise<void> {
    await this.request('PATCH', `${this.repoPath}/git/refs/heads/${encodeRef(branch)}`, { sha, force: false });
  }

  async createPullRequest(input: { title: string; head: string; base: string; body: string; draft: boolean }): Promise<PullRequest> {
    const r = await this.request<{ number: number; html_url: string; title: string; draft?: boolean; head: { ref: string } }>(
      'POST',
      `${this.repoPath}/pulls`,
      input,
    );
    return { number: r.number, url: r.html_url, title: r.title, draft: !!r.draft, headRef: r.head.ref };
  }

  async findOpenPullRequest(branch: string): Promise<PullRequest | undefined> {
    const r = await this.request<{ number: number; html_url: string; title: string; draft?: boolean; head: { ref: string } }[]>(
      'GET',
      `${this.repoPath}/pulls?state=open&head=${encodeURIComponent(`${this.owner}:${branch}`)}`,
    );
    const pr = r[0];
    return pr ? { number: pr.number, url: pr.html_url, title: pr.title, draft: !!pr.draft, headRef: pr.head.ref } : undefined;
  }

  /** Best effort: labels need the repo to allow it; failure is not fatal. */
  async addLabels(issueNumber: number, labels: string[]): Promise<boolean> {
    try {
      await this.request('POST', `${this.repoPath}/issues/${issueNumber}/labels`, { labels });
      return true;
    } catch {
      return false;
    }
  }

  async addComment(issueNumber: number, body: string): Promise<void> {
    await this.request('POST', `${this.repoPath}/issues/${issueNumber}/comments`, { body });
  }
}

export function friendlyMessage(status: number, detail: string): string {
  switch (status) {
    case 401:
      return 'GitHub rejected the token. It may be expired or mistyped: create a new one and save it in Settings.';
    case 403:
      if (/rate limit/i.test(detail)) return 'GitHub is limiting requests right now. Wait a minute, then try again.';
      if (/archived/i.test(detail)) return 'This repository is archived and read-only.';
      return 'The token does not have permission for this. It needs "Contents: read and write" and "Pull requests: read and write" on this repository.';
    case 404:
      return 'Repository, branch or file not found, or the token cannot see this repository.';
    case 409:
      return 'GitHub reported a conflict (the branch moved while saving). Scan again, then retry.';
    case 429:
      return 'GitHub is limiting requests right now. Wait a minute, then try again.';
    case 422:
      return `GitHub refused the request${detail ? `: ${detail}` : '.'}`;
    default:
      return `GitHub error ${status}${detail ? `: ${detail}` : ''}`;
  }
}

export interface RepoFiles {
  commitSha: string;
  treeSha: string;
  /** Token files relative to the tokens path. */
  files: Record<string, string>;
  /** Contents of contrast-pairs.json in the tokens path, when present. */
  contrastPairs: string | undefined;
}

export const CONTRAST_PAIRS_FILE = 'contrast-pairs.json';

/** Read every *.tokens.json under `tokensPath` (plus contrast-pairs.json) at a commit. */
export async function loadRepoFiles(client: GitHubClient, commitSha: string, tokensPath: string): Promise<RepoFiles> {
  const prefix = tokensPath.replace(/^\/+|\/+$/g, '') + '/';
  const treeSha = await client.getCommitTree(commitSha);
  const { entries, truncated } = await client.getTree(treeSha, true);
  if (truncated) throw new Error('The repository tree is too large to read in one request.');
  const wanted = entries.filter(
    (e) => e.type === 'blob' && e.path.startsWith(prefix) && (e.path.endsWith('.tokens.json') || e.path === prefix + CONTRAST_PAIRS_FILE),
  );
  if (!wanted.some((e) => e.path.endsWith('.tokens.json'))) throw new Error(`No *.tokens.json files found under ${tokensPath} at ${commitSha.slice(0, 7)}.`);
  const files: Record<string, string> = {};
  let contrastPairs: string | undefined;
  // Small concurrency limit: friendly to rate limits, still quick for a handful of files.
  const queue = [...wanted];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const text = await client.getBlobText(e.sha);
      const rel = e.path.slice(prefix.length);
      if (rel === CONTRAST_PAIRS_FILE) contrastPairs = text;
      else files[rel] = text;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { commitSha, treeSha, files, contrastPairs };
}
