// Minimal GitHub REST client over fetch. The token is passed in; nothing is read from the
// environment. Talks to api.github.com (the Figma plugin manifest allows nothing else) and, for
// token-less reads of public repos, raw.githubusercontent.com, which has no hourly API limit.
// Bulk reads go through the git trees and blobs endpoints; single files can use the contents API.
//
// Writes refuse protected branches (main, master and whatever the caller adds) whatever the caller
// asks: the client is the last guard between an agent and the default branch.

import { type BridgeConfig, CONFIG_FILE, ConfigError, DEFAULT_TOKEN_PATHS, loadConfig } from './config';
import { assertSafeBranch, DEFAULT_PROTECTED_BRANCHES, ProtectedBranchError } from './governance';
import type { ClassicProtection, Ruleset, RulesetPayload } from './protection';

/**
 * What an auth failure means for the token:
 * - "rejected": GitHub refused the token itself (401). It was revoked, regenerated or has expired; every call
 *   with it will fail until it is replaced.
 * - "missing-permission": the token works but lacks a permission this call needs (403 "Resource not accessible
 *   by personal access token", or a permission GitHub names in X-Accepted-GitHub-Permissions).
 * Undefined for everything else, including rate limits and a missing token.
 */
export type GitHubAuthState = 'rejected' | 'missing-permission';

/** Fine-grained token permission names, as GitHub spells them (issues, pull_requests, contents...). */
export type GitHubPermission = string;

export interface GitHubErrorInfo {
  auth?: GitHubAuthState | undefined;
  /** The permission the call needed, when GitHub or the endpoint tells (only with auth "missing-permission"). */
  permission?: GitHubPermission | undefined;
}

export class GitHubError extends Error {
  /** Set when the failure is about the token: rejected (401) or missing a permission (403). */
  readonly auth: GitHubAuthState | undefined;
  /** With auth "missing-permission": the permission the call needed, when known. */
  readonly permission: GitHubPermission | undefined;

  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
    info: GitHubErrorInfo = {},
  ) {
    super(message);
    this.name = 'GitHubError';
    this.auth = info.auth;
    this.permission = info.permission;
  }
}

/** True when `err` says GitHub refused the token itself (revoked, regenerated or expired). */
export const isTokenRejected = (err: unknown): boolean => err instanceof GitHubError && err.auth === 'rejected';

/** True when `err` says the token works but lacks a permission for that call. */
export const isMissingPermission = (err: unknown): boolean => err instanceof GitHubError && err.auth === 'missing-permission';

const PERMISSION_LABELS: Record<string, string> = {
  issues: 'Issues',
  pull_requests: 'Pull requests',
  contents: 'Contents',
  checks: 'Checks',
  statuses: 'Commit statuses',
  metadata: 'Metadata',
  actions: 'Actions',
  deployments: 'Deployments',
  workflows: 'Workflows',
  administration: 'Administration',
};

/** "pull_requests" -> "Pull requests", as GitHub labels it on the token page. */
export function permissionLabel(permission: GitHubPermission): string {
  return PERMISSION_LABELS[permission] ?? permission.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Where a fine-grained token's permissions are edited. */
export const TOKEN_SETTINGS_URL = 'https://github.com/settings/personal-access-tokens';

/** The one sentence for a token GitHub no longer accepts. */
export const TOKEN_REJECTED_MESSAGE = 'Your GitHub token stopped working. It was revoked, regenerated or has expired: replace it with a new one.';

/**
 * "This token cannot create issues. Add Issues: Read and write on GitHub." `action` is a verb phrase
 * ("create issues"); without it the sentence names only the permission.
 */
export function missingPermissionMessage(permission: GitHubPermission | undefined, action?: string): string {
  const what = action ? `This token cannot ${action}.` : 'This token is missing a permission for this.';
  if (!permission) return `${what} Check its repository permissions on GitHub (Contents and Pull requests need Read and write).`;
  return `${what} Add ${permissionLabel(permission)}: Read and write on GitHub.`;
}

/**
 * The permission a refused call needed. GitHub names it in X-Accepted-GitHub-Permissions ("issues=write",
 * alternatives split by ";"); otherwise the endpoint says it (/issues, /pulls, /contents, /git...).
 */
export function requiredPermission(path: string, acceptedHeader?: string | null): GitHubPermission | undefined {
  if (acceptedHeader) {
    const first = acceptedHeader.split(';')[0]!.split(',').map((p) => p.trim().split('=')[0]!.trim()).filter((p) => p && p !== 'metadata');
    if (first.length) return first[0];
  }
  const p = path.replace(/[?#].*$/, '');
  if (/\/repos\/[^/]+\/[^/]+\/(issues|labels|milestones)(\/|$)/.test(p)) return 'issues';
  if (/\/repos\/[^/]+\/[^/]+\/pulls(\/|$)/.test(p)) return 'pull_requests';
  if (/\/repos\/[^/]+\/[^/]+\/(rulesets(\/|$)|branches\/.+\/protection$)/.test(p)) return 'administration';
  if (/\/repos\/[^/]+\/[^/]+\/(contents|git|commits|branches|merges)(\/|$)/.test(p)) return 'contents';
  if (/\/repos\/[^/]+\/[^/]+\/(check-runs|check-suites)(\/|$)/.test(p)) return 'checks';
  if (/\/repos\/[^/]+\/[^/]+\/statuses(\/|$)/.test(p)) return 'statuses';
  if (/\/repos\/[^/]+\/[^/]+\/deployments(\/|$)/.test(p)) return 'deployments';
  if (/\/repos\/[^/]+\/[^/]+\/actions(\/|$)/.test(p)) return 'actions';
  return undefined;
}

const PERMISSION_DENIED = /not accessible by (personal access token|integration)|must have (admin|push|write) (rights|access)|write access to repository not granted|permission to .* denied/i;

/**
 * Classifies a GitHub error response for the token. 401 with a token sent = rejected. 403 (not a rate limit,
 * not archived) where GitHub names a permission or says the resource is not accessible = missing permission.
 */
export function classifyAuth(
  status: number,
  detail: string,
  opts: { path?: string; acceptedPermissions?: string | null; withToken?: boolean } = {},
): GitHubErrorInfo {
  if (status === 401 && opts.withToken !== false) return { auth: 'rejected' };
  if (status !== 403 || /rate limit|archived/i.test(detail)) return {};
  if (opts.acceptedPermissions || PERMISSION_DENIED.test(detail)) {
    return { auth: 'missing-permission', permission: requiredPermission(opts.path ?? '', opts.acceptedPermissions) };
  }
  return {};
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
  /** Description, when the list endpoint returns it (component change requests read "Closes #n" from it). */
  body?: string | undefined;
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
  /**
   * How a person adds a token where this client runs, for the rate-limit message without one ("set GITHUB_TOKEN in
   * the MCP server config"). Default: "add a GitHub token".
   */
  tokenHint?: string;
}

/**
 * The sentence for GitHub's exhausted hourly limit. With a token, the token's own limit is used up: wait. Without one,
 * the shared limit for anonymous reads is (60 an hour per address): say how to get a higher one.
 */
export function rateLimitMessage(x: { withToken: boolean; resetsAt?: Date; tokenHint?: string }): string {
  const when = x.resetsAt ? ` It resets at ${x.resetsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
  if (x.withToken) return `GitHub's hourly request limit for this token is used up.${when} Try again after that.`;
  const hint = x.tokenHint ?? 'add a GitHub token';
  return `GitHub's hourly limit for requests without a token (60 an hour) is used up.${when} To keep going now, ${hint}: a token gets 5,000 requests an hour.`;
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
  /** Slug of the GitHub App that reported it ("github-actions", "vercel"), when GitHub says. */
  app?: string | undefined;
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
    if (!this.token) throw new GitHubError(401, `${what} needs a GitHub token (contents and pull requests, read and write, on this repository only). Without one Bridge is read-only.`, 'no-token');
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
        const resetsAt = reset ? new Date(Number(reset) * 1000) : undefined;
        throw new GitHubError(429, rateLimitMessage({ withToken: Boolean(this.token), resetsAt, tokenHint: this.options.tokenHint }), detail);
      }
      const info = classifyAuth(res.status, detail, {
        path,
        acceptedPermissions: res.headers?.get('x-accepted-github-permissions'),
        withToken: Boolean(this.token),
      });
      throw new GitHubError(res.status, friendlyMessage(res.status, detail, info), detail, info);
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

  /** The same client (token, fetch, retry, protected branches) with another required branch prefix (`explore/`). */
  withBranchPrefix(branchPrefix: string | undefined): GitHubClient {
    return new GitHubClient(this.fullName, this.token, this.fetchImpl, this.retry, { ...this.options, protectedBranches: this.protectedBranches, branchPrefix });
  }

  /**
   * One commit with `files` on top of an existing branch, fast-forwarded (never forced). Refuses protected
   * branches and, with a branch prefix, branches without it: explorations take token edits this way.
   */
  async commitToBranch(input: { branch: string; message: string; files: CommitFile[] }): Promise<{ sha: string; branch: string }> {
    this.assertToken('Committing to a branch');
    this.assertWritableBranch(input.branch);
    const head = await this.getBranchSha(input.branch);
    if (!head) throw new GitHubError(404, `Branch "${input.branch}" not found. Start it first.`);
    const baseTree = await this.getCommitTree(head);
    const tree = await this.createTree(baseTree, input.files.map((f) => (f.content === null ? { path: f.path, sha: null } : { path: f.path, content: f.content })));
    const sha = await this.createCommit(input.message, tree, [head]);
    await this.updateBranch(input.branch, sha);
    return { sha, branch: input.branch };
  }

  /**
   * Marks a draft pull request ready for review. REST cannot unset `draft`, so this is the GraphQL mutation
   * markPullRequestReadyForReview, with the same token (pull requests: write).
   */
  async markReadyForReview(n: number): Promise<void> {
    this.assertToken('Marking a pull request ready for review');
    const pr = await this.request<{ node_id?: string; draft?: boolean }>('GET', `${this.repoPath}/pulls/${n}`);
    if (pr.draft === false) return;
    if (!pr.node_id) throw new GitHubError(422, `Pull request #${n} has no node id: mark it ready for review on GitHub.`);
    const r = await this.request<{ data?: unknown; errors?: { message?: string }[] }>('POST', '/graphql', {
      query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }',
      variables: { id: pr.node_id },
    });
    if (r?.errors?.length) {
      const detail = r.errors.map((e) => e.message).filter(Boolean).join(' ');
      throw new GitHubError(422, `GitHub refused to mark #${n} ready for review${detail ? `: ${detail}` : '.'} Use "Ready for review" on GitHub instead.`, detail);
    }
  }

  /**
   * Turns an open pull request back into a draft: the GraphQL mutation convertPullRequestToDraft (REST cannot set
   * `draft` either), same token. No-op when it is already a draft.
   */
  async convertToDraft(n: number): Promise<void> {
    this.assertToken('Turning a pull request back into a draft');
    const pr = await this.request<{ node_id?: string; draft?: boolean; state?: string }>('GET', `${this.repoPath}/pulls/${n}`);
    if (pr.draft === true) return;
    if (pr.state && pr.state !== 'open') throw new GitHubError(422, `Pull request #${n} is ${pr.state}: only an open one can go back to draft.`);
    if (!pr.node_id) throw new GitHubError(422, `Pull request #${n} has no node id: convert it to draft on GitHub.`);
    const r = await this.request<{ data?: unknown; errors?: { message?: string }[] }>('POST', '/graphql', {
      query: 'mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }',
      variables: { id: pr.node_id },
    });
    if (r?.errors?.length) {
      const detail = r.errors.map((e) => e.message).filter(Boolean).join(' ');
      throw new GitHubError(422, `GitHub refused to turn #${n} back into a draft${detail ? `: ${detail}` : '.'} Use "Convert to draft" on GitHub instead.`, detail);
    }
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

  /**
   * Comments on an issue or pull request, oldest first (first 100: the sticky preview comment is posted early).
   * `authorAssociation` is GitHub's OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE... (suggestion approvals read it).
   */
  async listIssueComments(issueNumber: number): Promise<{ id: number; body: string; author: string; updatedAt: string; createdAt: string; authorAssociation: string }[]> {
    const r = await this.request<{ id: number; body?: string | null; user?: { login: string } | null; updated_at: string; created_at?: string; author_association?: string }[]>(
      'GET',
      `${this.repoPath}/issues/${issueNumber}/comments?per_page=100`,
    );
    return r.map((c) => ({ id: c.id, body: c.body ?? '', author: c.user?.login ?? 'unknown', updatedAt: c.updated_at, createdAt: c.created_at ?? c.updated_at, authorAssociation: c.author_association ?? 'NONE' }));
  }

  // --- Issues (component change requests) ---------------------------------------------------

  async createIssue(input: { title: string; body: string; labels?: string[]; assignees?: string[] }): Promise<IssueSummary> {
    const r = await this.request<RawIssue>('POST', `${this.repoPath}/issues`, {
      title: input.title,
      body: input.body,
      ...(input.labels?.length ? { labels: input.labels } : {}),
      ...(input.assignees?.length ? { assignees: input.assignees } : {}),
    });
    return toIssue(r);
  }

  /** Issues (not pull requests) with a label, newest first. */
  async listIssues(opts: { label?: string; state?: 'open' | 'closed' | 'all'; perPage?: number } = {}): Promise<IssueSummary[]> {
    const q = new URLSearchParams({ state: opts.state ?? 'all', per_page: String(opts.perPage ?? 50), sort: 'created', direction: 'desc' });
    if (opts.label) q.set('labels', opts.label);
    const r = await this.request<RawIssue[]>('GET', `${this.repoPath}/issues?${q}`);
    return r.filter((i) => !i.pull_request).map(toIssue);
  }

  async getIssue(n: number): Promise<IssueSummary> {
    return toIssue(await this.request<RawIssue>('GET', `${this.repoPath}/issues/${n}`));
  }

  /** Edits an issue: its body, or closes it with a reason ("not_planned" for a declined request). */
  async updateIssue(n: number, patch: { body?: string; state?: 'open' | 'closed'; state_reason?: 'completed' | 'not_planned' | 'reopened' }): Promise<IssueSummary> {
    this.assertToken('Editing an issue');
    return toIssue(await this.request<RawIssue>('PATCH', `${this.repoPath}/issues/${n}`, patch));
  }

  /** Adds people to an issue's assignees (GitHub ignores logins that cannot be assigned: the result says who is). */
  async addAssignees(n: number, logins: string[]): Promise<string[]> {
    this.assertToken('Assigning an issue');
    const r = await this.request<{ assignees?: { login: string }[] | null }>('POST', `${this.repoPath}/issues/${n}/assignees`, { assignees: logins });
    return (r.assignees ?? []).map((a) => a.login);
  }

  /** People with at least `permission` on the repository (reading the list needs push access). First 100. */
  async listCollaborators(permission: 'pull' | 'triage' | 'push' | 'maintain' | 'admin' = 'push'): Promise<{ login: string; avatarUrl: string }[]> {
    const r = await this.request<{ login: string; avatar_url?: string }[]>('GET', `${this.repoPath}/collaborators?permission=${permission}&per_page=100`);
    return r.map((c) => ({ login: c.login, avatarUrl: c.avatar_url ?? '' }));
  }

  /** Whether a token is sent with each request (TeamReader). */
  get hasToken(): boolean {
    return Boolean(this.token);
  }

  /** Every page of a list endpoint (per_page 100), up to `maxPages`. */
  private async paginate<T>(path: string, maxPages = 20): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.request<T[]>('GET', `${path}${sep}per_page=100&page=${page}`);
      out.push(...r);
      if (r.length < 100) break;
    }
    return out;
  }

  /** Every member login of an organization team (needs read:org, or Members: Read on a fine-grained token). */
  async listTeamMembers(org: string, slug: string): Promise<string[]> {
    const r = await this.paginate<{ login: string }>(`/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(slug)}/members`);
    return r.map((m) => m.login);
  }

  /** A user's membership of a team: "active", "pending", or null when GitHub says they are not a member (404). */
  async getTeamMembership(org: string, slug: string, login: string): Promise<'active' | 'pending' | null> {
    try {
      const r = await this.request<{ state: string }>('GET', `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(slug)}/memberships/${encodeURIComponent(login)}`);
      return r.state === 'active' ? 'active' : 'pending';
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null;
      throw err;
    }
  }

  /** "User" or "Organization" for a login, null when GitHub does not know it. */
  async getAccountType(login: string): Promise<'User' | 'Organization' | null> {
    try {
      const r = await this.request<{ type?: string }>('GET', `/users/${encodeURIComponent(login)}`);
      return r.type === 'Organization' ? 'Organization' : r.type === 'User' ? 'User' : null;
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null;
      throw err;
    }
  }

  /** The organization's teams this token can see. */
  async listOrgTeams(org: string): Promise<{ slug: string; name: string }[]> {
    const r = await this.paginate<{ slug: string; name: string }>(`/orgs/${encodeURIComponent(org)}/teams`);
    return r.map((t) => ({ slug: t.slug, name: t.name }));
  }

  /** Create or update a binary file (base64 content) on a branch, e.g. a Figma export attached to a request. */
  async putBase64File(input: { path: string; base64: string; branch: string; message: string }): Promise<string> {
    this.assertWritableBranch(input.branch);
    const r = await this.request<{ commit: { sha: string } }>('PUT', `${this.repoPath}/contents/${encodeRef(input.path)}`, {
      message: input.message,
      content: input.base64,
      branch: input.branch,
    });
    return r.commit.sha;
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

  /**
   * Text and blob sha of one file at a ref, or undefined when it does not exist. The sha is what an update or a
   * delete must send back (optimistic concurrency: GitHub answers 409 when the file changed since).
   */
  async getFile(path: string, ref?: string): Promise<{ text: string; sha: string } | undefined> {
    try {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const r = await this.request<{ content?: string; encoding?: string; sha: string; type: string }>('GET', `${this.repoPath}/contents/${encodeRef(path)}${q}`);
      if (r.type !== 'file') return undefined;
      const text = r.encoding === 'base64' && r.content !== undefined ? base64ToUtf8(r.content) : (r.content ?? '');
      return { text, sha: r.sha };
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return undefined;
      throw err;
    }
  }

  /**
   * Base64 content of a binary file at a ref (an image), or undefined when it does not exist or is too large for the
   * contents API to inline (over 1 MB).
   */
  async getFileBase64(path: string, ref?: string): Promise<{ base64: string; size: number } | undefined> {
    try {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const r = await this.request<{ content?: string; encoding?: string; size?: number; type: string }>('GET', `${this.repoPath}/contents/${encodeRef(path)}${q}`);
      if (r.type !== 'file' || r.encoding !== 'base64' || !r.content) return undefined;
      return { base64: r.content.replace(/\s+/g, ''), size: r.size ?? 0 };
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return undefined;
      throw err;
    }
  }

  /** Entries of one folder at a ref (contents API), or an empty list when the folder does not exist. */
  async listDirectory(path: string, ref?: string): Promise<{ name: string; path: string; type: string; sha: string; size: number }[]> {
    try {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const r = await this.request<unknown>('GET', `${this.repoPath}/contents/${encodeRef(path)}${q}`);
      if (!Array.isArray(r)) return [];
      return (r as { name: string; path: string; type: string; sha: string; size?: number }[]).map((e) => ({ name: e.name, path: e.path, type: e.type, sha: e.sha, size: e.size ?? 0 }));
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return [];
      throw err;
    }
  }

  /** Deletes one file on a branch in its own commit (contents API). `sha` is the file's blob sha. */
  async deleteFile(input: { path: string; branch: string; message: string; sha: string }): Promise<string> {
    this.assertToken('Deleting a file');
    this.assertWritableBranch(input.branch);
    const r = await this.request<{ commit: { sha: string } }>('DELETE', `${this.repoPath}/contents/${encodeRef(input.path)}`, {
      message: input.message,
      branch: input.branch,
      sha: input.sha,
    });
    return r.commit.sha;
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

  /** Commit statuses of a commit, newest first (Vercel reports each project as "Vercel – <project>"). */
  async listCommitStatuses(sha: string): Promise<{ context: string; state: string; target_url: string | null; description: string | null }[]> {
    const r = await this.request<{ context: string; state: string; target_url?: string | null; description?: string | null }[]>('GET', `${this.repoPath}/commits/${encodeRef(sha)}/statuses?per_page=100`);
    return r.map((s) => ({ context: s.context, state: s.state, target_url: s.target_url ?? null, description: s.description ?? null }));
  }

  /**
   * GitHub deployments of a commit with their latest status (environment "Preview – <project>", environment_url the
   * preview). Latest per environment only, so it costs one read plus one per environment.
   */
  async listDeployments(sha: string): Promise<{ id: number; environment: string; state: string | null; environmentUrl: string | null }[]> {
    const list = await this.request<{ id: number; environment: string; created_at?: string }[]>('GET', `${this.repoPath}/deployments?sha=${encodeURIComponent(sha)}&per_page=30`);
    const latest = new Map<string, { id: number; environment: string }>();
    for (const d of list) if (!latest.has(d.environment)) latest.set(d.environment, d);
    return Promise.all(
      [...latest.values()].map(async (d) => {
        const st = await this.request<{ state: string; environment_url?: string | null; target_url?: string | null }[]>('GET', `${this.repoPath}/deployments/${d.id}/statuses?per_page=1`).catch(() => []);
        const s = st[0];
        return { id: d.id, environment: d.environment, state: s?.state ?? null, environmentUrl: s?.environment_url || null };
      }),
    );
  }

  async getPullRequest(n: number): Promise<PullRequest & PullRequestSummary & { body: string; mergeable: boolean | null; requestedReviewers: string[] }> {
    const r = await this.request<Record<string, any>>('GET', `${this.repoPath}/pulls/${n}`);
    return { ...toSummary(r), body: r.body ?? '', mergeable: r.mergeable ?? null, requestedReviewers: ((r.requested_reviewers ?? []) as { login: string }[]).map((x) => x.login) };
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
    const r = await this.request<{ check_runs: { id: number; name: string; status: string; conclusion: string | null; html_url?: string; app?: { slug?: string } | null }[] }>(
      'GET',
      `${this.repoPath}/commits/${encodeRef(ref)}/check-runs`,
    );
    return r.check_runs.map((c) => ({ id: c.id, name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url, ...(c.app?.slug ? { app: c.app.slug } : {}) }));
  }

  /** Rulesets that apply to the repository, without their rules (GET /rulesets; read access is enough). */
  async listRulesets(): Promise<Ruleset[]> {
    const r = await this.request<(Ruleset & { _links?: { html?: { href?: string } } })[]>('GET', `${this.repoPath}/rulesets?includes_parents=true&per_page=100`);
    return r.map(withRulesetUrl);
  }

  /** One ruleset with its rules. */
  async getRuleset(id: number): Promise<Ruleset> {
    return withRulesetUrl(await this.request<Ruleset>('GET', `${this.repoPath}/rulesets/${id}`));
  }

  /** Creates a repository ruleset. Needs admin on the repo (fine-grained token: Administration read and write). */
  async createRuleset(payload: RulesetPayload): Promise<Ruleset> {
    this.assertToken('Protecting the library');
    return withRulesetUrl(await this.request<Ruleset>('POST', `${this.repoPath}/rulesets`, payload));
  }

  /** Replaces a repository ruleset (same permissions as createRuleset). */
  async updateRuleset(id: number, payload: RulesetPayload): Promise<Ruleset> {
    this.assertToken('Protecting the library');
    return withRulesetUrl(await this.request<Ruleset>('PUT', `${this.repoPath}/rulesets/${id}`, payload));
  }

  /**
   * Classic branch protection of `branch`: the settings, null when the branch has none (404), undefined when this
   * token cannot read them (403: the endpoint needs admin). On a 403 the public branch summary still tells
   * whether the branch is protected at all: `protected: false` means there is nothing to read, so null.
   */
  async getBranchProtection(branch: string): Promise<ClassicProtection | null | undefined> {
    try {
      return await this.request<ClassicProtection>('GET', `${this.repoPath}/branches/${encodeRef(branch)}/protection`);
    } catch (err) {
      if (!(err instanceof GitHubError)) throw err;
      if (err.status === 404) return null;
      if (err.status === 403 || err.status === 401) {
        const b = await this.request<{ protected?: boolean }>('GET', `${this.repoPath}/branches/${encodeRef(branch)}`).catch(() => undefined);
        return b?.protected === false ? null : undefined;
      }
      throw err;
    }
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

  // --- branch actions shared by Studio, the MCP server and the CLI (branch-actions.ts) ---

  /** The account the token belongs to (GET /user). Needs a token. */
  async getViewer(): Promise<{ login: string }> {
    this.assertToken('Reading who you are on GitHub');
    const r = await this.request<{ login: string }>('GET', '/user');
    return { login: r.login };
  }

  /** The repository's merge settings and the viewer's permissions (unknown settings count as allowed). */
  async getMergeSettings(): Promise<{ allow_squash_merge?: boolean; allow_merge_commit?: boolean; allow_rebase_merge?: boolean; permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } }> {
    return this.request('GET', this.repoPath);
  }

  /**
   * Merges a pull request, only at `sha` (GitHub refuses when the branch moved meanwhile). The repository's branch
   * rules still apply: GitHub refuses a merge they block, whatever Bridge says.
   */
  async mergePullRequest(n: number, input: { method: 'squash' | 'merge' | 'rebase'; sha: string; commitMessage?: string | undefined }): Promise<{ sha: string; merged: boolean }> {
    this.assertToken('Merging a branch');
    const r = await this.request<{ sha: string; merged: boolean }>('PUT', `${this.repoPath}/pulls/${n}/merge`, {
      merge_method: input.method,
      sha: input.sha,
      ...(input.commitMessage !== undefined && input.method !== 'rebase' ? { commit_message: input.commitMessage } : {}),
    });
    return { sha: r?.sha ?? '', merged: r?.merged ?? true };
  }

  /** GitHub's "Update branch": merges the base into the pull request, only when its head is still `expectedHeadSha`. */
  async updatePullRequestBranch(n: number, expectedHeadSha: string): Promise<void> {
    this.assertToken('Updating a branch from main');
    await this.request('PUT', `${this.repoPath}/pulls/${n}/update-branch`, { expected_head_sha: expectedHeadSha });
  }

  /**
   * Merges the branch `head` into the branch `base` (GitHub's merges API): a merge commit on `base`, or nothing when
   * `base` already has every commit of `head`. A conflict throws a GitHubError with status 409. Refuses protected
   * branches and, with a branch prefix, a `base` without it.
   */
  async mergeIntoBranch(base: string, head: string, message: string): Promise<{ status: 'merged' | 'up-to-date'; sha: string | null }> {
    this.assertToken('Merging a branch into another');
    this.assertWritableBranch(base);
    const r = await this.request<{ sha?: string } | undefined>('POST', `${this.repoPath}/merges`, { base, head, commit_message: message });
    return r?.sha ? { status: 'merged', sha: r.sha } : { status: 'up-to-date', sha: null };
  }

  /** Posts a comment on an issue or pull request and returns its id and link. */
  async createIssueComment(n: number, body: string): Promise<{ id: number; url: string }> {
    this.assertToken('Commenting');
    const r = await this.request<{ id: number; html_url: string }>('POST', `${this.repoPath}/issues/${n}/comments`, { body });
    return { id: r.id, url: r.html_url };
  }

  /** Replaces the text of a comment. */
  async updateIssueComment(id: number, body: string): Promise<void> {
    this.assertToken('Editing a comment');
    await this.request('PATCH', `${this.repoPath}/issues/comments/${id}`, { body });
  }

  /** Submits a review on a given commit (the head the reviewer saw); the body may be empty for an approval. */
  async submitReview(n: number, input: { event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body?: string | undefined; commitId?: string | undefined }): Promise<Review> {
    this.assertToken('Reviewing a branch');
    const r = await this.request<{ id: number; user?: { login: string }; state: string; body: string | null }>('POST', `${this.repoPath}/pulls/${n}/reviews`, {
      event: input.event,
      ...(input.body ? { body: input.body } : {}),
      ...(input.commitId ? { commit_id: input.commitId } : {}),
    });
    return { id: r.id, user: r.user?.login, state: r.state, body: r.body ?? '' };
  }

  /** Line comments of a pull request (review threads), oldest first. */
  async listReviewComments(n: number): Promise<{ id: number; body: string; author: string; path: string; line: number | null; inReplyTo: number | null; url: string; createdAt: string }[]> {
    const r = await this.request<{ id: number; body?: string | null; user?: { login: string } | null; path: string; line?: number | null; in_reply_to_id?: number; html_url: string; created_at: string }[]>(
      'GET',
      `${this.repoPath}/pulls/${n}/comments?per_page=100`,
    );
    return r.map((c) => ({ id: c.id, body: c.body ?? '', author: c.user?.login ?? 'unknown', path: c.path, line: c.line ?? null, inReplyTo: c.in_reply_to_id ?? null, url: c.html_url, createdAt: c.created_at }));
  }

  /** Asks these people to review a pull request. */
  async requestReviewers(n: number, logins: string[]): Promise<void> {
    this.assertToken('Asking for a review');
    await this.request('POST', `${this.repoPath}/pulls/${n}/requested_reviewers`, { reviewers: logins });
  }

  /** Takes these people off the requested reviewers. */
  async removeRequestedReviewers(n: number, logins: string[]): Promise<void> {
    this.assertToken('Changing the requested reviewers');
    await this.request('DELETE', `${this.repoPath}/pulls/${n}/requested_reviewers`, { reviewers: logins });
  }

  /** Replies in the thread of a line comment. */
  async replyToReviewComment(n: number, commentId: number, body: string): Promise<{ id: number; url: string }> {
    this.assertToken('Replying to a comment');
    const r = await this.request<{ id: number; html_url: string }>('POST', `${this.repoPath}/pulls/${n}/comments/${commentId}/replies`, { body });
    return { id: r.id, url: r.html_url };
  }

  /**
   * What `head` adds on top of `base`, with what library sync needs: the shared start (merge base), the base
   * commit and its tree, how far behind, and the files with their previous names.
   */
  async compareDetailed(base: string, head: string): Promise<{
    behindBy: number;
    aheadBy: number;
    mergeBase: string | null;
    baseSha: string | null;
    baseTree: string | null;
    files: { filename: string; status: string; previous_filename?: string | undefined }[];
  }> {
    const r = await this.request<{
      ahead_by: number;
      behind_by: number;
      merge_base_commit?: { sha?: string };
      base_commit?: { sha?: string; commit?: { tree?: { sha?: string } } };
      files?: { filename: string; status: string; previous_filename?: string }[];
    }>('GET', `${this.repoPath}/compare/${encodeRef(base)}...${encodeRef(head)}`);
    return {
      behindBy: r.behind_by,
      aheadBy: r.ahead_by,
      mergeBase: r.merge_base_commit?.sha ?? null,
      baseSha: r.base_commit?.sha ?? null,
      baseTree: r.base_commit?.commit?.tree?.sha ?? null,
      files: (r.files ?? []).map((f) => ({ filename: f.filename, status: f.status, ...(f.previous_filename ? { previous_filename: f.previous_filename } : {}) })),
    };
  }

  /** A tree on top of `baseTree` from entries with their own file mode (blob sha, inline content, or sha null to delete). */
  async createTreeEntries(baseTree: string, entries: ({ path: string; mode: string; sha: string | null } | { path: string; mode: string; content: string })[]): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath}/git/trees`, { base_tree: baseTree, tree: entries.map((e) => ({ ...e, type: 'blob' })) }, true);
    return r.sha;
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
    ...(typeof r.body === 'string' ? { body: r.body } : {}),
  };
}

export function friendlyMessage(status: number, detail: string, info: GitHubErrorInfo = {}): string {
  if (info.auth === 'rejected') return TOKEN_REJECTED_MESSAGE;
  if (info.auth === 'missing-permission') return missingPermissionMessage(info.permission);
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
  /** bridge.config.json as written, for minimal-diff edits (a new brand); undefined when the repo has none. */
  configText?: string | undefined;
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
  let configText: string | undefined;
  const configEntry = entries.find((e) => e.type === 'blob' && e.path === CONFIG_FILE);
  if (configEntry) {
    try {
      configText = await client.getBlobText(configEntry.sha);
      config = loadConfig(configText);
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
  return { commitSha, treeSha, files, contrastChecks, config, ...(config ? { configText } : {}), tokensPath, warnings };
}

/** Lifts the ruleset's GitHub page (`_links.html.href`) to `html_url`. */
function withRulesetUrl(r: Ruleset): Ruleset {
  const href = r._links?.html?.href;
  return href && !r.html_url ? { ...r, html_url: href } : r;
}

export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  url: string;
  state: 'open' | 'closed';
  stateReason: string | null;
  labels: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
}

interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  state_reason?: string | null;
  labels: (string | { name?: string })[];
  user?: { login?: string } | null;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

function toIssue(r: RawIssue): IssueSummary {
  return {
    number: r.number,
    title: r.title,
    body: r.body ?? '',
    url: r.html_url,
    state: r.state,
    stateReason: r.state_reason ?? null,
    labels: r.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
    author: r.user?.login ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
