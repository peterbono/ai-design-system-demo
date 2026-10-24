// Fetches the token files of a pull request at its base and head commits and hands them to the pure review
// (lib/token-review.ts). One git-trees API call per commit; file contents come from raw.githubusercontent.com,
// which does not count against the API rate limit. An email member reads through Bridge instead: every body by its
// blob sha in one batch (/api/contribute?blobs=), each file the base and head share read once.
import { buildTokenSet, DEFAULT_TOKEN_PATHS, layoutOptions, loadConfig, parseContrastChecks, type BridgeConfig, type TokenSet } from '@bridge-ds/core';
import { reviewTokenChange, type TokenReview } from '../../lib/token-review';
import { isContribAuth } from '../../lib/contribute';
import { contributeBlobs } from '../contribute-session';
import { getToken, ghGet } from '../github-session';
import { siteConfig } from '../repo-context';

const siteRoot = (): string | undefined => {
  try {
    return (siteConfig() as { tokensRoot?: string }).tokensRoot;
  } catch {
    return undefined;
  }
};

export type { TokenReview };
export const isTokenFile = (f: string) => f.endsWith('.tokens.json') || /contrast\.checks\.json$/.test(f);

interface Tree {
  tree: { path: string; type: string; sha?: string }[];
}

/** A commit's files: path to blob sha. */
type Files = Map<string, string>;

const raw = (owner: string, repo: string, sha: string, path: string) =>
  ghGet<string>(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`, { raw: true }).then((r) => r.data);

const treeAt = (owner: string, repo: string, sha: string): Promise<Files> =>
  ghGet<Tree>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`).then((t) => new Map(t.data.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha ?? ''])));

/** Batch size of a blob read through Bridge (the server takes at most 100). */
const BATCH = 80;

/**
 * Reads files of the two commits. Through Bridge (an email member): the bodies by blob sha, deduplicated, in batches;
 * a blob the batch left out is read on its own. Otherwise each file from the raw host.
 */
function reader(owner: string, repo: string) {
  if (!isContribAuth(getToken())) return (sha: string, path: string, _blob: string) => raw(owner, repo, sha, path);
  const batch = contributeBlobs(`${owner}/${repo}`);
  /** Blob shas asked for since the last batch went out, each with how to hand its text back. */
  let wanted = new Map<string, (t: string | null | undefined) => void>();
  const flush = async () => {
    const now = wanted;
    wanted = new Map();
    const shas = [...now.keys()];
    for (let i = 0; i < shas.length; i += BATCH) {
      const part = shas.slice(i, i + BATCH);
      const got: Record<string, string | null> = await batch(part).catch(() => ({}));
      for (const s of part) now.get(s)!(s in got ? got[s] : undefined);
    }
  };
  const bodies = new Map<string, Promise<string>>();
  return (sha: string, path: string, blob: string): Promise<string> => {
    const kept = bodies.get(blob);
    if (kept) return kept;
    // Not a blob sha (an odd tree): read the file on its own.
    if (!/^[0-9a-f]{40}$/.test(blob)) return raw(owner, repo, sha, path);
    if (!wanted.size) queueMicrotask(() => void flush());
    const text = new Promise<string | null | undefined>((resolve) => wanted.set(blob, resolve));
    // Left out of the batch, or the batch refused: read on its own.
    const body = text.then((t) => (typeof t === 'string' ? t : raw(owner, repo, sha, path)));
    bodies.set(blob, body);
    return body;
  };
}

async function configAt(read: ReturnType<typeof reader>, sha: string, tree: Files): Promise<BridgeConfig | null> {
  if (!tree.has('bridge.config.json')) return null;
  try {
    return loadConfig(await read(sha, 'bridge.config.json', tree.get('bridge.config.json')!));
  } catch {
    return null;
  }
}

async function filesAt(read: ReturnType<typeof reader>, sha: string, root: string, tree: Files): Promise<Record<string, string>> {
  const prefix = root ? `${root}/` : '';
  const paths = [...tree.keys()].filter((p) => p.startsWith(prefix) && p.endsWith('.tokens.json'));
  const entries = await Promise.all(paths.map(async (p) => [p.slice(prefix.length), await read(sha, p, tree.get(p)!)] as const));
  return Object.fromEntries(entries);
}

/** The token files of a change at its base and head commits, with the layout options and the contrast checks. */
export async function readTokenFiles(input: { owner: string; repo: string; baseSha: string; headSha: string }) {
  const { owner, repo, baseSha, headSha } = input;
  const read = reader(owner, repo);
  // One git-trees call per commit tells which optional files exist, so nothing 404s.
  const [baseTree, headTree] = await Promise.all([treeAt(owner, repo, baseSha), treeAt(owner, repo, headSha)]);
  const config = (await configAt(read, headSha, headTree)) ?? (await configAt(read, baseSha, baseTree));
  const root = config?.tokens.root ?? siteRoot() ?? DEFAULT_TOKEN_PATHS.root;
  const checksPath = `${root}/${config?.tokens.contrastChecks ?? DEFAULT_TOKEN_PATHS.contrastChecks}`;
  const [baseFiles, headFiles, checks] = await Promise.all([
    filesAt(read, baseSha, root, baseTree),
    filesAt(read, headSha, root, headTree),
    headTree.has(checksPath) ? read(headSha, checksPath, headTree.get(checksPath)!) : baseTree.has(checksPath) ? read(baseSha, checksPath, baseTree.get(checksPath)!) : Promise.resolve(''),
  ]);
  return { baseFiles, headFiles, checks, options: config ? layoutOptions(config) : {} };
}

/** The token sets of a change at its base and head commits (Start again reads its edits from them). */
export async function tokenSetsOf(input: { owner: string; repo: string; baseSha: string; headSha: string }): Promise<{ base: TokenSet; head: TokenSet }> {
  const f = await readTokenFiles(input);
  return { base: buildTokenSet(f.baseFiles, f.options), head: buildTokenSet(f.headFiles, f.options) };
}

export async function analyzeTokenFiles(input: { owner: string; repo: string; baseSha: string; headSha: string; files: { filename: string }[] }): Promise<TokenReview> {
  const { baseFiles, headFiles, checks, options } = await readTokenFiles(input);
  // Repos (or older commits) without contrast.checks.json fall back to the checks this site was built with.
  const fallback = document.getElementById('bridge-contrast')?.textContent || undefined;
  return reviewTokenChange(baseFiles, headFiles, parseContrastChecks(checks || fallback), options);
}
