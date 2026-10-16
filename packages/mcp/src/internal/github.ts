// Small GitHub REST client on fetch. No SDK, no backend: the user's own token, straight to api.github.com.
// TO BE REPLACED by the fetch GitHub client in @bridge/core at merge time (see ../core-adapter.ts).

export interface GitHubOptions {
  owner: string;
  repo: string;
  token?: string;
  apiUrl?: string;
  /** Raw file host for token-less reads (no API rate limit on public repos). */
  rawUrl?: string;
  /** Branches no write may target. Checked on every ref write, whatever the caller asks. */
  protectedBranches: string[];
  /** New branches must start with this. */
  branchPrefix: string;
  fetch?: typeof fetch;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PullSummary {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author: string;
  head: string;
  headSha: string;
  base: string;
  labels: string[];
  url: string;
  updatedAt: string;
}

export class GitHubClient {
  readonly owner: string;
  readonly repo: string;
  private readonly f: typeof fetch;
  constructor(private readonly o: GitHubOptions) {
    this.owner = o.owner;
    this.repo = o.repo;
    this.f = o.fetch ?? fetch;
  }

  get canWrite() {
    return Boolean(this.o.token);
  }

  private async req<T>(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<T> {
    const url = `${this.o.apiUrl ?? 'https://api.github.com'}${path.startsWith('/repos') || path.startsWith('/user') ? path : `/repos/${this.owner}/${this.repo}${path}`}`;
    const headers: Record<string, string> = { accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'bridge-mcp' };
    if (this.o.token) headers.authorization = `Bearer ${this.o.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.f(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const hint = res.status === 401 ? ' (check GITHUB_TOKEN)' : res.status === 403 || res.status === 429 ? ' (rate limited or token lacks permission; set GITHUB_TOKEN)' : res.status === 404 ? ' (not found, or private repo without a token)' : '';
      throw new GitHubError(`GitHub ${method} ${path} failed: ${res.status}${hint} ${text.slice(0, 200)}`, res.status);
    }
    if (accept.includes('raw')) return (await res.text()) as T;
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  private assertWritable(op: string) {
    if (!this.o.token) throw new GitHubError(`${op} needs a GitHub token. Set GITHUB_TOKEN (fine-grained, contents + pull requests on this repo only). Without it Bridge is read-only.`, 401);
  }

  /** The only guard between an agent and a protected branch. Never relax it. */
  assertSafeBranch(branch: string, base: string) {
    const protectedSet = new Set([...this.o.protectedBranches, base]);
    if (protectedSet.has(branch)) throw new GitHubError(`Refusing to write to protected branch "${branch}". Bridge only creates new branches and pull requests.`, 403);
    if (!branch.startsWith(this.o.branchPrefix)) throw new GitHubError(`Branch "${branch}" must start with "${this.o.branchPrefix}".`, 403);
  }

  // --- reads ---
  async getDefaultBranch(): Promise<string> {
    return (await this.req<{ default_branch: string }>('GET', '')).default_branch;
  }
  async getTree(ref: string): Promise<string[]> {
    const r = await this.req<{ tree: { path: string; type: string }[]; truncated: boolean }>('GET', `/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    return r.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  }
  async getFile(path: string, ref: string): Promise<string | null> {
    if (!this.o.token) {
      // Public repo, no token: raw.githubusercontent.com does not count against the 60 requests/hour API limit.
      const res = await this.f(`${this.o.rawUrl ?? 'https://raw.githubusercontent.com'}/${this.owner}/${this.repo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'user-agent': 'bridge-mcp' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new GitHubError(`GitHub raw ${path}@${ref} failed: ${res.status}`, res.status);
      return res.text();
    }
    try {
      return await this.req<string>('GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw+json');
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }
  async getBranchSha(branch: string): Promise<string> {
    return (await this.req<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  }
  async listPulls(state: 'open' | 'closed' | 'all' = 'open'): Promise<PullSummary[]> {
    const r = await this.req<Record<string, any>[]>('GET', `/pulls?state=${state}&per_page=50&sort=updated&direction=desc`);
    return r.map(toPull);
  }
  async getPull(n: number): Promise<PullSummary & { body: string; mergeable: boolean | null }> {
    const r = await this.req<Record<string, any>>('GET', `/pulls/${n}`);
    return { ...toPull(r), body: r.body ?? '', mergeable: r.mergeable ?? null };
  }
  async listPullFiles(n: number): Promise<{ filename: string; status: string; previous_filename?: string }[]> {
    return this.req('GET', `/pulls/${n}/files?per_page=100`);
  }
  async getChecks(sha: string): Promise<{ state: string; checks: { name: string; status: string; conclusion: string | null }[] }> {
    const [combined, runs] = await Promise.all([
      this.req<{ state: string; statuses: { context: string; state: string }[] }>('GET', `/commits/${sha}/status`).catch(() => ({ state: 'unknown', statuses: [] })),
      this.req<{ check_runs: { name: string; status: string; conclusion: string | null }[] }>('GET', `/commits/${sha}/check-runs?per_page=50`).catch(() => ({ check_runs: [] })),
    ]);
    const checks = [...runs.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })), ...combined.statuses.map((s) => ({ name: s.context, status: 'completed', conclusion: s.state }))];
    const failing = checks.some((c) => c.conclusion && !['success', 'neutral', 'skipped'].includes(c.conclusion));
    const pending = checks.some((c) => c.status !== 'completed');
    return { state: !checks.length ? 'none' : failing ? 'failure' : pending ? 'pending' : 'success', checks };
  }
  async listReviews(n: number): Promise<{ user: string; state: string; submittedAt: string }[]> {
    const r = await this.req<Record<string, any>[]>('GET', `/pulls/${n}/reviews`);
    return r.map((x) => ({ user: x.user?.login ?? '?', state: x.state, submittedAt: x.submitted_at }));
  }

  // --- writes (token required, never to a protected branch) ---
  async commitToNewBranch(args: { base: string; branch: string; message: string; files: { path: string; content: string | null }[] }): Promise<{ sha: string; branch: string }> {
    this.assertWritable('Creating a branch');
    this.assertSafeBranch(args.branch, args.base);
    const baseSha = await this.getBranchSha(args.base);
    const baseCommit = await this.req<{ tree: { sha: string } }>('GET', `/git/commits/${baseSha}`);
    const tree = await this.req<{ sha: string }>('POST', '/git/trees', {
      base_tree: baseCommit.tree.sha,
      tree: args.files.map((f) => (f.content === null ? { path: f.path, mode: '100644', type: 'blob', sha: null } : { path: f.path, mode: '100644', type: 'blob', content: f.content })),
    });
    const commit = await this.req<{ sha: string }>('POST', '/git/commits', { message: args.message, tree: tree.sha, parents: [baseSha] });
    // Creating a new ref only: no update of an existing ref, so nothing can be overwritten.
    await this.req('POST', '/git/refs', { ref: `refs/heads/${args.branch}`, sha: commit.sha });
    return { sha: commit.sha, branch: args.branch };
  }
  async openPull(args: { base: string; head: string; title: string; body: string; draft: boolean; labels: string[] }): Promise<{ number: number; url: string }> {
    this.assertWritable('Opening a pull request');
    this.assertSafeBranch(args.head, args.base);
    const pr = await this.req<{ number: number; html_url: string }>('POST', '/pulls', { base: args.base, head: args.head, title: args.title, body: args.body, draft: args.draft });
    if (args.labels.length) await this.req('POST', `/issues/${pr.number}/labels`, { labels: args.labels }).catch(() => undefined);
    return { number: pr.number, url: pr.html_url };
  }
  async review(n: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body: string): Promise<{ id: number; state: string }> {
    this.assertWritable('Reviewing a pull request');
    return this.req('POST', `/pulls/${n}/reviews`, { event, body });
  }
}

function toPull(r: Record<string, any>): PullSummary {
  return {
    number: r.number,
    title: r.title,
    state: r.merged_at ? 'merged' : r.state,
    draft: Boolean(r.draft),
    author: r.user?.login ?? '?',
    head: r.head?.ref,
    headSha: r.head?.sha,
    base: r.base?.ref,
    labels: (r.labels ?? []).map((l: { name: string }) => l.name),
    url: r.html_url,
    updatedAt: r.updated_at,
  };
}

export function parseRepo(s: string): { owner: string; repo: string } {
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(s.trim());
  if (!m) throw new Error(`Not a GitHub repo: "${s}". Use owner/name.`);
  return { owner: m[1]!, repo: m[2]! };
}
