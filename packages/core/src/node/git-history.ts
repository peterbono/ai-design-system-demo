// History from a local git repository (Node only): first-parent commits of a ref that touched the tokens
// root, so a merged branch is one entry (the merge commit against the base it merged into). PR numbers come
// from merge and squash subjects. Blobs are read once per sha.
import { type BridgeConfig } from '../config';
import { type HistoryBackend, type HistoryCommit, type HistoryReport, buildReport, collectHistory, mergeReleases, packageDirCandidates, parseChangelog, prNumberFromSubject, releasesFromTags } from '../history';
import { selectTokenFiles } from '../layered';
import { git, showFile } from './git-local';

const US = '\u001f';
const RS = '\u001e';

export function localGitHistoryBackend(root: string, config: BridgeConfig): HistoryBackend {
  const trees = new Map<string, Promise<{ path: string; sha: string }[]>>();
  const blobs = new Map<string, Promise<string>>();
  const tokenRoot = config.tokens.root.replace(/\/$/, '');
  const prefix = tokenRoot === '.' || !tokenRoot ? '' : `${tokenRoot}/`;
  const lsTree = (sha: string, path: string) => {
    const k = `${sha}:${path}`;
    let t = trees.get(k);
    if (!t) {
      t = git(root, ['ls-tree', '-r', sha, '--', path || '.']).then((out) =>
        out
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const [meta, p] = l.split('\t');
            return { path: p!, sha: meta!.split(' ')[2]! };
          }),
      );
      trees.set(k, t);
    }
    return t;
  };
  const blob = (sha: string) => {
    let b = blobs.get(sha);
    if (!b) {
      b = git(root, ['cat-file', 'blob', sha]);
      blobs.set(sha, b);
    }
    return b;
  };
  return {
    async listCommits({ ref, paths, limit }) {
      const fmt = ['%H', '%P', '%cI', '%an', '%s', '%b'].join(US) + RS;
      const out = await git(root, ['log', '--first-parent', `-n${limit}`, `--format=${fmt}`, ref, '--', ...(paths.length ? paths : ['.'])]);
      return out
        .split(RS)
        .map((r) => r.replace(/^\n/, ''))
        .filter((r) => r.trim())
        .map((r): HistoryCommit => {
          const [sha, parents, date, author, subject, body] = r.split(US);
          const n = prNumberFromSubject(subject ?? '');
          return { sha: sha!, parents: (parents ?? '').split(' ').filter(Boolean), date: date!, author: author!, subject: subject ?? '', body: (body ?? '').trim(), ...(n ? { pr: { number: n, title: '' } } : {}) };
        })
        .map((c) => (c.pr && !c.pr.title ? { ...c, pr: undefined } : c))
        .map((c) => {
          const { pr, ...rest } = c;
          return pr ? c : rest;
        });
    },
    async tokenFiles(sha) {
      const entries = await lsTree(sha, tokenRoot === '.' ? '' : tokenRoot);
      const picked = new Set(selectTokenFiles(config, entries.map((e) => e.path)));
      const wanted = entries.filter((e) => picked.has(prefix ? e.path.slice(prefix.length) : e.path));
      return new Map(await Promise.all(wanted.map(async (e) => [prefix ? e.path.slice(prefix.length) : e.path, await blob(e.sha)] as const)));
    },
    async changesetPaths(sha) {
      const dir = config.changesets?.dir.replace(/\/$/, '');
      return dir ? (await lsTree(sha, dir)).map((e) => e.path) : [];
    },
    async readFile(sha, path) {
      return showFile(root, sha, path);
    },
  };
}

/** Tags with their commit and date: `v1.2.0`, `@scope/pkg@1.2.0`. */
export async function localTags(root: string): Promise<{ name: string; sha: string; date: string }[]> {
  const out = await git(root, ['for-each-ref', 'refs/tags', '--format=%(refname:short)%09%(*objectname)%09%(objectname)%09%(creatordate:iso-strict)']).catch(() => '');
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, peeled, obj, date] = l.split('\t');
      return { name: name!, sha: peeled || obj!, date: date! };
    });
}

/** The whole history report for a local repo at `ref` (default HEAD). */
export async function loadLocalHistory(root: string, config: BridgeConfig, opts: { ref?: string; limit?: number } = {}): Promise<HistoryReport> {
  const ref = opts.ref ?? 'HEAD';
  const limit = opts.limit ?? 40;
  const backend = localGitHistoryBackend(root, config);
  let listed = 0;
  const counted: HistoryBackend = {
    ...backend,
    listCommits: async (o) => {
      const r = await backend.listCommits(o);
      listed = r.length;
      return r;
    },
  };
  // A shallow clone (CI, Vercel) has a cut history: read what is there.
  const entries = await collectHistory(config, counted, { ref, limit });
  let changelog: ReturnType<typeof parseChangelog> = [];
  let currentVersion: string | undefined;
  for (const dir of packageDirCandidates(config)) {
    const p = (f: string) => (dir ? `${dir}/${f}` : f);
    const [cl, pkg] = await Promise.all([showFile(root, ref, p('CHANGELOG.md')), showFile(root, ref, p('package.json'))]);
    if (cl === null && pkg === null) continue;
    if (cl) changelog = parseChangelog(cl);
    if (pkg) {
      try {
        const json = JSON.parse(pkg) as { name?: string; version?: string };
        if (!config.changesets || json.name === config.changesets.package) currentVersion = json.version;
      } catch {
        /* not JSON */
      }
    }
    break;
  }
  const releases = mergeReleases(changelog, releasesFromTags(await localTags(root), config.changesets?.package));
  return buildReport({ source: 'git', label: `${root}@${ref}`, ref, entries, releases, ...(currentVersion ? { currentVersion } : {}), truncated: listed >= limit });
}
