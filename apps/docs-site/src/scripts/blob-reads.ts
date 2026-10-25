// File texts by blob sha, shared by every reader on the page (the home's token cards, the status of each change, a
// token review). An email member reads them through Bridge in batches (/api/contribute?blobs=, lib/blob-batch.ts): the
// cards and statuses of five token changes cost one or two requests instead of one per file. Anyone else reads each
// file from the raw host, once per blob on this page. A commit's tree (path to blob sha) is read once per commit.
import { blobBatcher, SHA40, type BlobRead } from '../lib/blob-batch';
import { isContribAuth } from '../lib/contribute';
import { contributeBlobs } from './contribute-session';
import { getToken, ghGet } from './github-session';

/** A commit's files: path to blob sha. */
export type Files = Map<string, string>;

interface Tree {
  tree: { path: string; type: string; sha?: string }[];
}

const trees = new Map<string, Promise<Files>>();

/** The files of a commit (one git-trees read per commit on this page; a failed read is asked again next time). */
export function treeAt(owner: string, repo: string, sha: string): Promise<Files> {
  const k = `${owner}/${repo}@${sha}`.toLowerCase();
  let t = trees.get(k);
  if (!t) {
    t = ghGet<Tree>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`).then((r) => new Map(r.data.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha ?? ''])));
    t.catch(() => trees.delete(k));
    trees.set(k, t);
  }
  return t;
}

/** A file at a commit from the raw host (free of the API limit; a private repository goes through the API). */
export const rawAt = (owner: string, repo: string, ref: string, path: string): Promise<string> =>
  ghGet<string>(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`, { raw: true }).then((r) => r.data);

const batchers = new Map<string, BlobRead>();
const bodies = new Map<string, Promise<string>>();

/** The batch reader of an email member's team, else null (no Bridge session: read the raw host). */
function batcher(owner: string, repo: string): BlobRead | null {
  if (!isContribAuth(getToken())) return null;
  const k = `${owner}/${repo}`.toLowerCase();
  let b = batchers.get(k);
  if (!b) {
    b = blobBatcher(contributeBlobs(`${owner}/${repo}`));
    batchers.set(k, b);
  }
  return b;
}

/**
 * The text of `path` at commit `ref`, whose blob is `blob`: once per blob on this page. Through Bridge's batch for an
 * email member; a blob the batch left out, a refused batch or an odd sha read the file on its own.
 */
export function blobText(owner: string, repo: string, ref: string, path: string, blob: string): Promise<string> {
  if (!SHA40.test(blob)) return rawAt(owner, repo, ref, path);
  const k = `${owner}/${repo}:${blob}`.toLowerCase();
  let p = bodies.get(k);
  if (!p) {
    const batch = batcher(owner, repo);
    p = (batch ? batch(blob) : Promise.resolve(undefined)).then((t) => (typeof t === 'string' ? t : rawAt(owner, repo, ref, path)));
    p.catch(() => bodies.delete(k));
    bodies.set(k, p);
  }
  return p;
}
