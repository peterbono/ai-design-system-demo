// In-memory GitHub used by the flow tests. Implements only what DS Bridge calls.

import type { GitHubClient, IssueSummary, PullRequest, TreeEntry } from '@bridge-ds/core';

export class FakeGitHub {
  commits = new Map<string, { files: Record<string, string>; parents: string[]; message: string }>();
  branches = new Map<string, string>();
  blobs = new Map<string, string>();
  trees = new Map<string, Record<string, string>>();
  prs: (PullRequest & { body: string; base: string; labels: string[] })[] = [];
  issues: (IssueSummary & { assignees: string[] })[] = [];
  /** Binary files written through the contents API (putBase64File): branch -> path -> base64. */
  binaries = new Map<string, Map<string, string>>();
  /** Files through the contents API (getFile, putFile, deleteFile, listDirectory): "branch:path" -> text and sha. */
  contents = new Map<string, { text: string; sha: string }>();
  /** Contents API calls, in order ("PUT path", "DELETE path"). */
  contentLog: string[] = [];
  /** Comments on issues and pull requests, in order. */
  comments: { number: number; body: string }[] = [];
  /** Commit statuses by sha, newest first (Vercel reports each project as "Vercel – <project>"). */
  statuses = new Map<string, { context: string; state: string; target_url: string | null; description: string | null }[]>();
  readonly owner = 'o';
  readonly name = 'r';
  n = 0;

  constructor(files: Record<string, string>, branch = 'main') {
    const sha = this.commit(files, [], 'initial');
    this.branches.set(branch, sha);
  }

  commit(files: Record<string, string>, parents: string[], message: string): string {
    // The counter leads, so short shas (7 characters, like the preview comment's) differ from commit to commit.
    const sha = `c${String(++this.n).padStart(6, '0')}`.padEnd(40, '0');
    this.commits.set(sha, { files: { ...files }, parents, message });
    this.trees.set(`t-${sha}`, { ...files });
    return sha;
  }

  /** Simulate someone merging a change on main. */
  pushToMain(edit: (files: Record<string, string>) => void): string {
    const head = this.branches.get('main')!;
    const files = { ...this.commits.get(head)!.files };
    edit(files);
    const sha = this.commit(files, [head], 'upstream change');
    this.branches.set('main', sha);
    return sha;
  }

  filesAt(branch: string): Record<string, string> {
    return this.commits.get(this.branches.get(branch)!)!.files;
  }

  client(): GitHubClient {
    const self = this;
    const api = {
      owner: self.owner,
      name: self.name,
      async createIssue(input: { title: string; body: string; labels?: string[]; assignees?: string[] }) {
        const n = self.issues.length + self.prs.length + 1;
        const issue = { number: n, title: input.title, body: input.body, url: `https://github.com/o/r/issues/${n}`, state: 'open' as const, stateReason: null, labels: input.labels ?? [], assignees: input.assignees ?? [], author: 'designer', createdAt: '', updatedAt: '' };
        self.issues.push(issue);
        return issue;
      },
      async putBase64File(input: { path: string; base64: string; branch: string; message: string }) {
        if (!self.branches.has(input.branch)) throw Object.assign(new Error(`No branch ${input.branch}`), { status: 404 });
        const files = self.binaries.get(input.branch) ?? new Map<string, string>();
        files.set(input.path, input.base64);
        self.binaries.set(input.branch, files);
        self.contents.set(`${input.branch}:${input.path}`, { text: input.base64, sha: `f${++self.n}` });
        self.contentLog.push(`PUT ${input.path}`);
        return `c-put-${files.size}`;
      },
      async getFile(path: string, ref = 'main') {
        const f = self.contents.get(`${ref}:${path}`);
        return f ? { text: f.text, sha: f.sha } : undefined;
      },
      async putFile(input: { path: string; content: string; branch: string; message: string; sha?: string }) {
        if (!self.branches.has(input.branch)) throw Object.assign(new Error(`No branch ${input.branch}`), { status: 404 });
        const key = `${input.branch}:${input.path}`;
        const cur = self.contents.get(key);
        if (cur && cur.sha !== input.sha) throw Object.assign(new Error('conflict'), { status: 409 });
        self.contents.set(key, { text: input.content, sha: `f${++self.n}` });
        self.contentLog.push(`PUT ${input.path}`);
        return `c-file-${self.n}`;
      },
      async deleteFile(input: { path: string; branch: string; message: string; sha: string }) {
        const key = `${input.branch}:${input.path}`;
        const cur = self.contents.get(key);
        if (!cur) throw Object.assign(new Error('not found'), { status: 404 });
        if (cur.sha !== input.sha) throw Object.assign(new Error('conflict'), { status: 409 });
        self.contents.delete(key);
        self.contentLog.push(`DELETE ${input.path}`);
        return `c-del-${++self.n}`;
      },
      async listDirectory(path: string, ref = 'main') {
        const prefix = `${ref}:${path}/`;
        return [...self.contents.entries()]
          .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
          .map(([k, f]) => ({ name: k.slice(prefix.length), path: k.slice(ref.length + 1), type: 'file', sha: f.sha, size: f.text.length }));
      },
      async listIssueComments(n: number) {
        return self.comments.filter((c) => c.number === n).map((c, i) => ({ id: i + 1, body: c.body, author: 'github-actions[bot]', updatedAt: '' }));
      },
      async listCommitStatuses(sha: string) {
        return self.statuses.get(sha) ?? [];
      },
      async listDeployments() {
        return [];
      },
      async getBranchSha(branch: string) {
        return self.branches.get(branch);
      },
      async getCommitTree(sha: string) {
        if (!self.commits.has(sha)) throw Object.assign(new Error('not found'), { status: 404 });
        return `t-${sha}`;
      },
      async getTree(treeSha: string) {
        const files = self.trees.get(treeSha)!;
        const entries: TreeEntry[] = Object.entries(files).map(([path, content]) => {
          const sha = `b-${path}-${content.length}-${hash(content)}`;
          self.blobs.set(sha, content);
          return { path, type: 'blob', sha, mode: '100644' };
        });
        return { entries, truncated: false };
      },
      async getBlobText(sha: string) {
        return self.blobs.get(sha)!;
      },
      async compare() {
        return { status: 'ahead', aheadBy: 1, behindBy: 0, files: [] };
      },
      async createBlob(content: string) {
        const sha = `b-new-${hash(content)}`;
        self.blobs.set(sha, content);
        return sha;
      },
      async createTree(baseTree: string, files: { path: string; sha: string }[]) {
        const next = { ...self.trees.get(baseTree)! };
        for (const f of files) next[f.path] = self.blobs.get(f.sha)!;
        const id = `t-new-${++self.n}`;
        self.trees.set(id, next);
        return id;
      },
      async createCommit(message: string, tree: string, parents: string[]) {
        const sha = self.commit(self.trees.get(tree)!, parents, message);
        return sha;
      },
      async createBranch(branch: string, sha: string) {
        if (self.branches.has(branch)) throw new Error('exists');
        self.branches.set(branch, sha);
      },
      async updateBranch(branch: string, sha: string) {
        self.branches.set(branch, sha);
      },
      async createPullRequest(input: { title: string; head: string; base: string; body: string; draft: boolean }) {
        const pr = { number: self.prs.length + 1, url: `https://github.com/o/r/pull/${self.prs.length + 1}`, title: input.title, draft: input.draft, headRef: input.head, body: input.body, base: input.base, labels: [] as string[] };
        self.prs.push(pr);
        return pr;
      },
      async findOpenPullRequest(branch: string) {
        return self.prs.find((p) => p.headRef === branch);
      },
      async addLabels(n: number, labels: string[]) {
        self.prs[n - 1]!.labels.push(...labels);
        return true;
      },
      async addComment(n: number, body: string) {
        self.comments.push({ number: n, body });
      },
      // Explorations (core explorations-github.ts): open pull requests, one commit on a new branch, body updates.
      canWrite: true,
      fullName: `${self.owner}/${self.name}`,
      withBranchPrefix() {
        return api;
      },
      async listPullRequests() {
        return self.prs.map((p) => ({ number: p.number, title: p.title, state: 'open', draft: p.draft, author: 'designer', headRef: p.headRef, headSha: self.branches.get(p.headRef) ?? '', baseRef: p.base, labels: p.labels, url: p.url, updatedAt: '', body: p.body }));
      },
      async getPullRequest(n: number) {
        const p = self.prs[n - 1]!;
        return { ...p, state: 'open', author: 'designer', headSha: self.branches.get(p.headRef) ?? '', baseRef: p.base, updatedAt: '', mergeable: null };
      },
      async updatePullRequest(n: number, patch: { title?: string; body?: string }) {
        const p = self.prs[n - 1]!;
        if (patch.title) p.title = patch.title;
        if (patch.body) p.body = patch.body;
      },
      async commitToNewBranch(input: { base: string; branch: string; message: string; files: { path: string; content: string | null }[] }) {
        const files = { ...self.filesAt(input.base) };
        for (const f of input.files) (f.content === null ? delete files[f.path] : (files[f.path] = f.content));
        const sha = self.commit(files, [self.branches.get(input.base)!], input.message);
        self.branches.set(input.branch, sha);
        return { sha, branch: input.branch };
      },
    };
    return api as unknown as GitHubClient;
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
