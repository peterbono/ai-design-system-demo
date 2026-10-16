// Minimal GitHub REST client over fetch. The token is passed in; nothing is read from the
// environment. Talks to api.github.com (the Figma plugin manifest allows nothing else) and, for
// token-less reads of public repos, raw.githubusercontent.com, which has no hourly API limit.
// Bulk reads go through the git trees and blobs endpoints; single files can use the contents API.
//
// Writes refuse protected branches (main, master and whatever the caller adds) whatever the caller
// asks: the client is the last guard between an agent and the default branch.

import { type BridgeConfig, CONFIG_FILE, ConfigError, DEFAULT_TOKEN_PATHS, loadConfig } from './config';
import { assertSafeBranch, DEFAULT_PROTECTED_BRANCHES, ProtectedBranchError } from './governance';

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

export interface Review {
  id: number;
  user: string | undefined;
  state: string;
  body: string;
  submittedAt?: string | undefined;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  /** "open", "closed" or "merged". */
  state: string;
  draft: boolean;
  author: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  labels: string[];
  url: string;
  updatedAt: string;
}

export interface ClientOptions {
  /** API base, for GitHub Enterprise or tests. */
  apiUrl?: string;
  /** Raw file host used for token-less reads. */
  rawUrl?: string;
  /** Branches no write may target. Default main and master; the repo's default branch belongs here too. */
  protectedBranches?: string[];
  /** When set, branches this client creates must start with it (agents use "bridge/"). */
  branchPrefix?: string;
}

/** A file in a new commit: text content, or null to delete it. */
export interface CommitFile {
  path: string;
  content: string | null;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string | undefined;
}

export interface CommitSummary {
  sha: string;
  parents: string[];
  /** ISO date the commit landed (committer date). */
  date: string;
  /** GitHub login when known, else the git author name. */
  author: string;
  message: string;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
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
const RAW = 'https://raw.githubusercontent.com';

/** "owner/name", a github.com URL or an SSH remote. */
export function parseRepo(repo: string): { owner: string; name: string } {
  const m = /^\s*(?:https?:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?\s*$/.exec(repo);
  if (!m) throw new Error(`"${repo}" is not a repository. Use the form owner/name.`);
  return { owner: m[1]!, name: m[2]! };
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

export class GitHubClient {
  readonly owner: string;
  readonly name: string;
  private readonly blobCache = new Map<string, string>();
  private readonly api: string;
  private readonly protectedBranches: string[];

  constructor(
    repo: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
    private readonly options: ClientOptions = {},
  ) {
    const r = parseRepo(repo);
    this.owner = r.owner;
    this.name = r.name;
    this.api = (options.apiUrl ?? API).replace(/\/$/, '');
    this.protectedBranches = options.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;
  }

  /** "owner/name". */
  get fullName() {
    return `${this.owner}/${this.name}`;
  }

  /** Whether a token was given (without one, every write is refused before any request). */
  get canWrite() {
    return Boolean(this.token);
  }

  /** Throws unless `branch` may be written: not protected, not the base, and with the agent prefix when set. */
  assertWritableBranch(branch: string, base?: string): void {
    try {
      assertSafeBranch(branch, { protectedBranches: this.protectedBranches, base, branchPrefix: this.options.branchPrefix });
    } catch (err) {
      if (err instanceof ProtectedBranchError) throw new GitHubError(403, err.message, 'protected-branch');
      throw err;
    }
  }

  private assertToken(what: string): void {
    if (!this.token) throw new GitHubError(401, `${what} needs a GitHub token (contents and pull requests, read and write, on this repository only). Without one Bridge is read-only.`);
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
      res = await this.fetchImpl(`${this.api}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
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

  // --- History (read only) ----------------------------------------------------------------------

  /** Commits on a ref, newest first, optionally only those touching `path` (a file or directory). */
  async listCommits(opts: { sha?: string; path?: string; perPage?: number; page?: number } = {}): Promise<CommitSummary[]> {
    const q = new URLSearchParams();
    if (opts.sha) q.set('sha', opts.sha);
    if (opts.path) q.set('path', opts.path);
    q.set('per_page', String(Math.min(100, opts.perPage ?? 30)));
    if (opts.page) q.set('page', String(opts.page));
    const r = await this.request<Record<string, any>[]>('GET', `${this.repoPath}/commits?${q}`);
    return r.map(toCommitSummary);
  }

  /** One commit: message, author, date and parents. */
  async getCommitInfo(sha: string): Promise<CommitSummary> {
    return toCommitSummary(await this.request<Record<string, any>>('GET', `${this.repoPath}/commits/${encodeRef(sha)}`));
  }

  /** Pull requests a commit belongs to (merged ones first): how a commit on main finds its PR. */
  async listPullRequestsForCommit(sha: string): Promise<(PullRequestSummary & { body: string; mergedAt?: string; mergeCommitSha?: string })[]> {
    const r = await this.request<Record<string, any>[]>('GET', `${this.repoPath}/commits/${encodeRef(sha)}/pulls`);
    return r
      .map((p) => ({ ...toSummary(p), body: p.body ?? '', ...(p.merged_at ? { mergedAt: p.merged_at as string } : {}), ...(p.merge_commit_sha ? { mergeCommitSha: p.merge_commit_sha as string } : {}) }))
      .sort((a, b) => Number(Boolean(b.mergedAt)) - Number(Boolean(a.mergedAt)));
  }

  /** Tags with the commit they point to, newest first as GitHub lists them. */
  async listTags(perPage = 30): Promise<{ name: string; sha: string }[]> {
    const r = await this.request<{ name: string; commit: { sha: string } }[]>('GET', `${this.repoPath}/tags?per_page=${Math.min(100, perPage)}`);
    return r.map((t) => ({ name: t.name, sha: t.commit.sha }));
  }

  async createBlob(content: string): Promise<string> {
    // Blobs, trees and commits are content-addressed: retrying a create is harmless.
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath}/git/blobs`, { content, encoding: 'utf-8' }, true);
    return r.sha;
  }

  /** A tree on top of `baseTree`. Each file gives a blob `sha`, inline `content`, or `sha: null` to delete. */
  async createTree(baseTree: string, files: ({ path: string; sha: string | null } | { path: string; content: string })[]): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath}/git/trees`, {
      base_tree: baseTree,
      tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', ...('content' in f ? { content: f.content } : { sha: f.sha }) })),
    }, true);
    return r.sha;
  }

  async createCommit(message: string, tree: string, parents: string[]): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath}/git/commits`, { message, tree, parents }, true);
    return r.sha;
  }

  /** Create a new branch. Refuses protected branches; GitHub refuses existing ones, so nothing is overwritten. */
  async createBranch(branch: string, sha: string): Promise<void> {
    this.assertWritableBranch(branch);
    await this.request('POST', `${this.repoPath}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  /** Fast-forward a branch. Never forces: a concurrent push makes this fail instead of losing work. */
  async updateBranch(branch: string, sha: string): Promise<void> {
    this.assertWritableBranch(branch);
    await this.request('PATCH', `${this.repoPath}/git/refs/heads/${encodeRef(branch)}`, { sha, force: false });
  }

  /**
   * One commit with `files` on top of `base`, on the new branch `branch`. The branch is created, never
   * moved, so an existing branch is never overwritten. Refuses protected branches and the base itself.
   */
  async commitToNewBranch(input: { base: string; branch: string; message: string; files: CommitFile[] }): Promise<{ sha: string; branch: string }> {
    this.assertToken('Creating a branch');
    this.assertWritableBranch(input.branch, input.base);
    const baseSha = await this.getBranchSha(input.base);
    if (!baseSha) throw new GitHubError(404, `Base branch "${input.base}" not found.`);
    const baseTree = await this.getCommitTree(baseSha);
    const tree = await this.createTree(baseTree, input.files.map((f) => (f.content === null ? { path: f.path, sha: null } : { path: f.path, content: f.content })));
    const sha = await this.createCommit(input.message, tree, [baseSha]);
    await this.createBranch(input.branch, sha);
    return { sha, branch: input.branch };
  }

  async createPullRequest(input: { title: string; head: string; base: string; body: string; draft: boolean }): Promise<PullRequest> {
    this.assertWritableBranch(input.head, input.base);
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

  // --- Contents API: single files -----------------------------------------------------------

  /** Text of one file at a ref (branch, tag or sha), or undefined when it does not exist. */
  async getFileText(path: string, ref?: string): Promise<string | undefined> {
    try {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const r = await this.request<{ content?: string; encoding?: string; sha: string; type: string }>('GET', `${this.repoPath}/contents/${encodeRef(path)}${q}`);
      if (r.type !== 'file') return undefined;
      if (r.encoding === 'base64' && r.content !== undefined) return base64ToUtf8(r.content);
      return r.content;
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return undefined;
      throw err;
    }
  }

  /** Create or update one file on a branch in its own commit (contents API). Returns the commit sha. */
  async putFile(input: { path: string; content: string; branch: string; message: string; sha?: string | undefined }): Promise<string> {
    this.assertWritableBranch(input.branch);
    const r = await this.request<{ commit: { sha: string } }>('PUT', `${this.repoPath}/contents/${encodeRef(input.path)}`, {
      message: input.message,
      content: utf8ToBase64(input.content),
      branch: input.branch,
      ...(input.sha ? { sha: input.sha } : {}),
    });
    return r.commit.sha;
  }

  /**
   * Text of a file at a ref, or undefined. Without a token, public repos are read from the raw host (no
   * hourly API limit); with one, through the contents API (private repos work).
   */
  async readFile(path: string, ref: string): Promise<string | undefined> {
    if (this.token) return this.getFileText(path, ref);
    const url = `${(this.options.rawUrl ?? RAW).replace(/\/$/, '')}/${this.owner}/${this.name}/${encodeRef(ref)}/${encodeRef(path)}`;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, {});
    } catch (err) {
      throw new GitHubError(0, 'Could not reach GitHub. Check your connection, then try again.', (err as Error).message);
    }
    if (res.status === 404) return undefined;
    if (!res.ok) throw new GitHubError(res.status, friendlyMessage(res.status, ''), `raw ${path}@${ref}`);
    return res.text();
  }

  /** The repository's default branch. */
  async getDefaultBranch(): Promise<string> {
    return (await this.getRepo()).defaultBranch;
  }

  /** Every file path at a ref (branch, tag or sha), one API call. */
  async listFiles(ref: string): Promise<string[]> {
    const r = await this.request<{ tree: { path: string; type: string }[]; truncated: boolean }>('GET', `${this.repoPath}/git/trees/${encodeRef(ref)}?recursive=1`);
    if (r.truncated) throw new GitHubError(413, 'The repository tree is too large to read in one request.');
    return r.tree.filter((e) => e.type === 'blob').map((e) => e.path);
  }

  // --- Pull requests, reviews, checks ---------------------------------------------------------

  async listPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullRequestSummary[]> {
    const r = await this.request<Record<string, any>[]>('GET', `${this.repoPath}/pulls?state=${state}&per_page=50&sort=updated&direction=desc`);
    return r.map(toSummary);
  }

  /** Commit statuses and check runs of a commit, folded into one state. */
  async getChecks(sha: string): Promise<{ state: 'success' | 'failure' | 'pending' | 'none'; checks: { name: string; status: string; conclusion: string | null }[] }> {
    const [combined, runs] = await Promise.all([
      this.request<{ statuses: { context: string; state: string }[] }>('GET', `${this.repoPath}/commits/${encodeRef(sha)}/status`).catch(() => ({ statuses: [] })),
      this.listCheckRuns(sha).catch(() => [] as CheckRun[]),
    ]);
    const checks = [
      ...runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })),
      ...combined.statuses.map((s) => ({ name: s.context, status: s.state === 'pending' ? 'in_progress' : 'completed', conclusion: s.state === 'pending' ? null : s.state })),
    ];
    const failing = checks.some((c) => c.conclusion && !['success', 'neutral', 'skipped'].includes(c.conclusion));
    const pending = checks.some((c) => c.status !== 'completed');
    return { state: !checks.length ? 'none' : failing ? 'failure' : pending ? 'pending' : 'success', checks };
  }

  async getPullRequest(n: number): Promise<PullRequest & PullRequestSummary & { body: string; mergeable: boolean | null }> {
    const r = await this.request<Record<string, any>>('GET', `${this.repoPath}/pulls/${n}`);
    return { ...toSummary(r), body: r.body ?? '', mergeable: r.mergeable ?? null };
  }

  async listPullRequestFiles(n: number): Promise<PullRequestFile[]> {
    const r = await this.request<{ filename: string; status: string; additions: number; deletions: number }[]>('GET', `${this.repoPath}/pulls/${n}/files?per_page=100`);
    return r.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }));
  }

  async updatePullRequest(n: number, patch: { title?: string; body?: string; state?: 'open' | 'closed' }): Promise<void> {
    await this.request('PATCH', `${this.repoPath}/pulls/${n}`, patch);
  }

  async listReviews(n: number): Promise<Review[]> {
    const r = await this.request<{ id: number; user?: { login: string }; state: string; body: string | null; submitted_at?: string }[]>('GET', `${this.repoPath}/pulls/${n}/reviews`);
    return r.map((x) => ({ id: x.id, user: x.user?.login, state: x.state, body: x.body ?? '', ...(x.submitted_at ? { submittedAt: x.submitted_at } : {}) }));
  }

  /** Submit a review. `COMMENT` works for any collaborator; approving your own PR is refused by GitHub. */
  async createReview(n: number, input: { event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body: string }): Promise<Review> {
    this.assertToken('Reviewing a pull request');
    const r = await this.request<{ id: number; user?: { login: string }; state: string; body: string | null }>('POST', `${this.repoPath}/pulls/${n}/reviews`, input);
    return { id: r.id, user: r.user?.login, state: r.state, body: r.body ?? '' };
  }

  async listCheckRuns(ref: string): Promise<CheckRun[]> {
    const r = await this.request<{ check_runs: { id: number; name: string; status: string; conclusion: string | null; html_url?: string }[] }>(
      'GET',
      `${this.repoPath}/commits/${encodeRef(ref)}/check-runs`,
    );
    return r.check_runs.map((c) => ({ id: c.id, name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url }));
  }

  /** Create a check run (needs a GitHub App token; personal tokens are refused by GitHub). */
  async createCheckRun(input: {
    name: string;
    headSha: string;
    status?: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
    output?: { title: string; summary: string; text?: string };
  }): Promise<CheckRun> {
    const r = await this.request<{ id: number; name: string; status: string; conclusion: string | null; html_url?: string }>('POST', `${this.repoPath}/check-runs`, {
      name: input.name,
      head_sha: input.headSha,
      ...(input.status ? { status: input.status } : {}),
      ...(input.conclusion ? { conclusion: input.conclusion } : {}),
      ...(input.output ? { output: input.output } : {}),
    });
    return { id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url };
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    await this.request('DELETE', `${this.repoPath}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`);
  }
}

function toCommitSummary(c: Record<string, any>): CommitSummary {
  return {
    sha: c.sha,
    parents: (c.parents ?? []).map((p: { sha: string }) => p.sha),
    date: c.commit?.committer?.date ?? c.commit?.author?.date ?? '',
    author: c.author?.login ?? c.commit?.author?.name ?? 'unknown',
    message: c.commit?.message ?? '',
  };
}

function toSummary(r: Record<string, any>): PullRequestSummary & PullRequest {
  return {
    number: r.number,
    title: r.title,
    state: r.merged_at || r.merged ? 'merged' : r.state,
    draft: Boolean(r.draft),
    author: r.user?.login ?? 'unknown',
    headRef: r.head?.ref,
    headSha: r.head?.sha,
    baseRef: r.base?.ref,
    labels: (r.labels ?? []).map((l: { name: string }) => l.name),
    url: r.html_url,
    updatedAt: r.updated_at,
  };
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
  /** Token files relative to the tokens root. */
  files: Record<string, string>;
  /** Contents of the contrast checks file (tokens.contrastChecks in the config), when present. */
  contrastChecks: string | undefined;
  /** bridge.config.json at the repository root, parsed; undefined when the repo has none. */
  config: BridgeConfig | undefined;
  /** Tokens root actually used (from the config when present, else the fallback). */
  tokensPath: string;
  /** Problems reading the config (it is then ignored and the fallback is used). */
  warnings: string[];
}

/**
 * Read every *.tokens.json under the tokens root, plus the contrast checks file, at a commit.
 * The tokens root and the checks file come from bridge.config.json at the repository root when it
 * exists; otherwise from `fallbackTokensPath` and the default layout.
 */
export async function loadRepoFiles(client: GitHubClient, commitSha: string, fallbackTokensPath: string): Promise<RepoFiles> {
  const treeSha = await client.getCommitTree(commitSha);
  const { entries, truncated } = await client.getTree(treeSha, true);
  if (truncated) throw new Error('The repository tree is too large to read in one request.');
  const warnings: string[] = [];
  let config: BridgeConfig | undefined;
  const configEntry = entries.find((e) => e.type === 'blob' && e.path === CONFIG_FILE);
  if (configEntry) {
    try {
      config = loadConfig(await client.getBlobText(configEntry.sha));
    } catch (err) {
      warnings.push(err instanceof ConfigError ? `${err.message}. Using ${fallbackTokensPath} instead.` : `${CONFIG_FILE} could not be read.`);
    }
  }
  const tokensPath = (config?.tokens.root ?? fallbackTokensPath).replace(/^\/+|\/+$/g, '');
  const checksFile = config?.tokens.contrastChecks ?? DEFAULT_TOKEN_PATHS.contrastChecks;
  const prefix = tokensPath + '/';
  const wanted = entries.filter(
    (e) => e.type === 'blob' && e.path.startsWith(prefix) && (e.path.endsWith('.tokens.json') || e.path === prefix + checksFile),
  );
  if (!wanted.some((e) => e.path.endsWith('.tokens.json'))) throw new Error(`No *.tokens.json files found under ${tokensPath} at ${commitSha.slice(0, 7)}.`);
  const files: Record<string, string> = {};
  let contrastChecks: string | undefined;
  // Small concurrency limit: friendly to rate limits, still quick for a handful of files.
  const queue = [...wanted];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const text = await client.getBlobText(e.sha);
      const rel = e.path.slice(prefix.length);
      if (rel === checksFile) contrastChecks = text;
      else files[rel] = text;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { commitSha, treeSha, files, contrastChecks, config, tokensPath, warnings };
}
