// Fetches the token files of a pull request at its base and head commits and hands them to the pure review
// (lib/token-review.ts). One git-trees API call per commit (none for the head when the change's file list stands for
// it, lib/blob-batch.ts headFilesOf); file contents by blob sha through scripts/blob-reads.ts: an email member's in
// batches through Bridge (/api/contribute?blobs=), shared with every other read of the page, anyone else's from
// raw.githubusercontent.com, which does not count against the API rate limit. Each blob is read once per page.
import { buildTokenSet, DEFAULT_TOKEN_PATHS, layoutOptions, loadConfig, parseContrastChecks, type BridgeConfig, type TokenSet } from '@bridge-ds/core';
import { reviewTokenChange, type TokenReview } from '../../lib/token-review';
import { headFilesOf, type ChangedFile } from '../../lib/blob-batch';
import { blobText, treeAt, type Files } from '../blob-reads';
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

/** Reads files of the change's commits by blob sha (scripts/blob-reads.ts). */
function reader(owner: string, repo: string) {
  return (sha: string, path: string, blob: string): Promise<string> => blobText(owner, repo, sha, path, blob);
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
export async function readTokenFiles(input: { owner: string; repo: string; baseSha: string; headSha: string; changed?: readonly ChangedFile[] | null }) {
  const { owner, repo, baseSha, headSha } = input;
  const read = reader(owner, repo);
  // One git-trees call per commit tells which optional files exist, so nothing 404s. The head's files come from the
  // base's and the change's own list when that list is whole (the home's cards): no head tree read.
  const headRead = input.changed ? null : treeAt(owner, repo, headSha);
  const baseTree = await treeAt(owner, repo, baseSha);
  const headTree = (input.changed && headFilesOf(baseTree, input.changed)) || (await (headRead ?? treeAt(owner, repo, headSha)));
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

export async function analyzeTokenFiles(input: { owner: string; repo: string; baseSha: string; headSha: string; files: { filename: string }[]; changed?: readonly ChangedFile[] | null }): Promise<TokenReview> {
  const { baseFiles, headFiles, checks, options } = await readTokenFiles(input);
  // Repos (or older commits) without contrast.checks.json fall back to the checks this site was built with.
  const fallback = document.getElementById('bridge-contrast')?.textContent || undefined;
  return reviewTokenChange(baseFiles, headFiles, parseContrastChecks(checks || fallback), options);
}
