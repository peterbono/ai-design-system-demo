// History from GitHub over REST, in the browser or Node: commits that touched the tokens root on a ref,
// the pull request each one belongs to, token files at each side of the change (blobs cached by sha, so
// files that did not change are read once), changesets the change added, tags and the CHANGELOG.

import type { BridgeConfig } from './config';
import type { GitHubClient, TreeEntry } from './github-client';
import { type HistoryBackend, type HistoryCommit, type HistoryReport, buildReport, collectHistory, mergeReleases, packageDirCandidates, parseChangelog, releasesFromTags } from './history';
import { selectTokenFiles } from './layered';

export function gitHubHistoryBackend(client: GitHubClient, config: BridgeConfig, opts: { concurrency?: number } = {}): HistoryBackend & { tree(sha: string): Promise<TreeEntry[]> } {
  const trees = new Map<string, Promise<TreeEntry[]>>();
  const tree = (sha: string) => {
    let t = trees.get(sha);
    if (!t) {
      t = client.getCommitTree(sha).then((ts) => client.getTree(ts, true)).then((r) => r.entries);
      trees.set(sha, t);
    }
    return t;
  };
  // Without a token (a guest on a public repository) bodies come from the raw host by commit and path, which costs no
  // API request; a private or missing file there falls back to the blobs API.
  const body = async (sha: string, e: TreeEntry): Promise<string> => (!client.canWrite ? await client.readRawFile(e.path, sha).catch(() => undefined) : undefined) ?? client.getBlobText(e.sha);
  const root = config.tokens.root.replace(/\/$/, '');
  const prefix = root === '.' || !root ? '' : `${root}/`;
  const limit = Math.max(1, opts.concurrency ?? 4);
  const pool = async <T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let k = i++; k < items.length; k = i++) out[k] = await fn(items[k]!);
    }));
    return out;
  };

  return {
    tree,
    async listCommits({ ref, paths, limit: max }) {
      const commits: HistoryCommit[] = [];
      for (let page = 1; commits.length < max && page <= 10; page++) {
        const batch = await client.listCommits({ sha: ref, path: paths[0], perPage: Math.min(100, max), page });
        for (const c of batch) {
          const [subject, ...rest] = c.message.split('\n');
          commits.push({ sha: c.sha, parents: c.parents, date: c.date, author: c.author, subject: subject ?? '', body: rest.join('\n').trim() });
        }
        if (batch.length < Math.min(100, max)) break;
      }
      const list = commits.slice(0, max);
      // The pull request of each commit. A branch commit of a merged PR is replaced by the PR's merge commit,
      // so the entry diffs the whole PR as it landed.
      const merges = new Map<string, Promise<HistoryCommit | undefined>>();
      const enriched = await pool(list, async (c) => {
        const prs = await client.listPullRequestsForCommit(c.sha).catch(() => []);
        const pr = prs.find((p) => p.mergedAt && p.baseRef === ref) ?? prs.find((p) => p.mergedAt);
        if (!pr) return c;
        const prInfo = { number: pr.number, title: pr.title, url: pr.url, author: pr.author, ...(pr.mergedAt ? { mergedAt: pr.mergedAt } : {}), body: pr.body };
        if (pr.mergeCommitSha && pr.mergeCommitSha !== c.sha) {
          let m = merges.get(pr.mergeCommitSha);
          if (!m) {
            m = client.getCommitInfo(pr.mergeCommitSha).then(
              (info) => {
                const [subject, ...rest] = info.message.split('\n');
                return { sha: info.sha, parents: info.parents, date: pr.mergedAt ?? info.date, author: info.author, subject: subject ?? '', body: rest.join('\n').trim() };
              },
              () => undefined,
            );
            merges.set(pr.mergeCommitSha, m);
          }
          const merge = await m;
          if (merge) return { ...merge, pr: prInfo };
        }
        return { ...c, ...(pr.mergedAt ? { date: pr.mergedAt } : {}), pr: prInfo };
      });
      return enriched;
    },
    async tokenFiles(sha) {
      const entries = await tree(sha);
      const blobs = entries.filter((e) => e.type === 'blob' && e.path.startsWith(prefix));
      const picked = new Set(selectTokenFiles(config, blobs.map((e) => e.path)));
      const wanted = blobs.filter((e) => picked.has(prefix ? e.path.slice(prefix.length) : e.path));
      const texts = await pool(wanted, async (e) => [prefix ? e.path.slice(prefix.length) : e.path, await body(sha, e)] as const);
      return new Map(texts);
    },
    async changesetPaths(sha) {
      const dir = config.changesets?.dir.replace(/\/$/, '');
      if (!dir) return [];
      return (await tree(sha)).filter((e) => e.type === 'blob' && e.path.startsWith(`${dir}/`)).map((e) => e.path);
    },
    async readFile(sha, path) {
      const e = (await tree(sha)).find((x) => x.type === 'blob' && x.path === path);
      return e ? body(sha, e) : null;
    },
  };
}

/** The whole history report for a GitHub repo: entries, releases (tags and CHANGELOG), timeline. */
export async function loadGitHubHistory(client: GitHubClient, config: BridgeConfig, opts: { ref?: string; limit?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<HistoryReport> {
  const ref = opts.ref ?? config.repo?.defaultBranch ?? (await client.getDefaultBranch());
  const limit = opts.limit ?? 30;
  const backend = gitHubHistoryBackend(client, config);
  let listed = 0;
  const counted: HistoryBackend = { ...backend, listCommits: async (o) => {
    const r = await backend.listCommits(o);
    listed = r.length;
    return r;
  } };
  const entries = await collectHistory(config, counted, { ref, limit, ...(opts.onProgress ? { onProgress: opts.onProgress } : {}) });
  const head = await client.getBranchSha(ref).catch(() => undefined);
  let changelog: ReturnType<typeof parseChangelog> = [];
  let currentVersion: string | undefined;
  if (head) {
    const files = await backend.tree(head).catch(() => [] as TreeEntry[]);
    for (const dir of packageDirCandidates(config)) {
      const p = (f: string) => (dir ? `${dir}/${f}` : f);
      const cl = files.find((e) => e.path === p('CHANGELOG.md'));
      const pkg = files.find((e) => e.path === p('package.json'));
      if (!cl && !pkg) continue;
      if (cl) changelog = parseChangelog(await client.getBlobText(cl.sha));
      if (pkg) {
        try {
          const json = JSON.parse(await client.getBlobText(pkg.sha)) as { name?: string; version?: string };
          if (!config.changesets || json.name === config.changesets.package) currentVersion = json.version;
        } catch {
          /* not JSON: no version */
        }
      }
      break;
    }
  }
  const tagList = await client.listTags(30).catch(() => []);
  const tagReleases = releasesFromTags(tagList, config.changesets?.package);
  // Tag dates cost one request each: only the ten newest.
  await Promise.all(
    tagReleases.slice(0, 10).map(async (r) => {
      if (!r.sha) return;
      const info = await client.getCommitInfo(r.sha).catch(() => undefined);
      if (info?.date) r.date = info.date;
    }),
  );
  const releases = mergeReleases(changelog, tagReleases);
  return buildReport({ source: 'github', label: `${client.fullName}@${ref}`, ref, entries, releases, ...(currentVersion ? { currentVersion } : {}), truncated: listed >= limit });
}
