// In-memory GitHub used by the flow tests. Implements only what DS Bridge calls.

import type { GitHubClient, PullRequest, TreeEntry } from '@bridge/core';

export class FakeGitHub {
  commits = new Map<string, { files: Record<string, string>; parents: string[]; message: string }>();
  branches = new Map<string, string>();
  blobs = new Map<string, string>();
  trees = new Map<string, Record<string, string>>();
  prs: (PullRequest & { body: string; base: string; labels: string[] })[] = [];
  private n = 0;

  constructor(files: Record<string, string>, branch = 'main') {
    const sha = this.commit(files, [], 'initial');
    this.branches.set(branch, sha);
  }

  commit(files: Record<string, string>, parents: string[], message: string): string {
    const sha = `c${String(++this.n).padStart(39, '0')}`;
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
      async addComment() {},
    };
    return api as unknown as GitHubClient;
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
