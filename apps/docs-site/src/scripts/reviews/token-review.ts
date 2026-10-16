// Fetches the token files of a pull request at its base and head commits and hands them to the pure review
// (lib/token-review.ts). One git-trees API call per commit; file contents come from raw.githubusercontent.com,
// which does not count against the API rate limit.
import { DEFAULT_TOKEN_PATHS, layoutOptions, loadConfig, parseContrastChecks, type BridgeConfig } from '@bridge/core';
import { reviewTokenChange, type TokenReview } from '../../lib/token-review';
import { ghGet } from '../github-session';

const siteRoot = (): string | undefined => {
  try {
    return (JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { tokensRoot?: string }).tokensRoot;
  } catch {
    return undefined;
  }
};

export type { TokenReview };
export const isTokenFile = (f: string) => f.endsWith('.tokens.json') || /contrast\.checks\.json$/.test(f);

interface Tree {
  tree: { path: string; type: string }[];
}

const raw = (owner: string, repo: string, sha: string, path: string) =>
  ghGet<string>(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`, { raw: true }).then((r) => r.data);

const treeAt = (owner: string, repo: string, sha: string) =>
  ghGet<Tree>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`).then((t) => new Set(t.data.tree.filter((e) => e.type === 'blob').map((e) => e.path)));

async function configAt(owner: string, repo: string, sha: string, tree: Set<string>): Promise<BridgeConfig | null> {
  if (!tree.has('bridge.config.json')) return null;
  try {
    return loadConfig(await raw(owner, repo, sha, 'bridge.config.json'));
  } catch {
    return null;
  }
}

async function filesAt(owner: string, repo: string, sha: string, root: string, tree: Set<string>): Promise<Record<string, string>> {
  const prefix = root ? `${root}/` : '';
  const paths = [...tree].filter((p) => p.startsWith(prefix) && p.endsWith('.tokens.json'));
  const entries = await Promise.all(paths.map(async (p) => [p.slice(prefix.length), await raw(owner, repo, sha, p)] as const));
  return Object.fromEntries(entries);
}

export async function analyzeTokenFiles(input: { owner: string; repo: string; baseSha: string; headSha: string; files: { filename: string }[] }): Promise<TokenReview> {
  const { owner, repo, baseSha, headSha } = input;
  // One git-trees call per commit tells which optional files exist, so nothing 404s.
  const [baseTree, headTree] = await Promise.all([treeAt(owner, repo, baseSha), treeAt(owner, repo, headSha)]);
  const config = (await configAt(owner, repo, headSha, headTree)) ?? (await configAt(owner, repo, baseSha, baseTree));
  const root = config?.tokens.root ?? siteRoot() ?? DEFAULT_TOKEN_PATHS.root;
  const checksPath = `${root}/${config?.tokens.contrastChecks ?? DEFAULT_TOKEN_PATHS.contrastChecks}`;
  const [baseFiles, headFiles, checks] = await Promise.all([
    filesAt(owner, repo, baseSha, root, baseTree),
    filesAt(owner, repo, headSha, root, headTree),
    headTree.has(checksPath) ? raw(owner, repo, headSha, checksPath) : baseTree.has(checksPath) ? raw(owner, repo, baseSha, checksPath) : Promise.resolve(''),
  ]);
  // Repos (or older commits) without contrast.checks.json fall back to the checks this site was built with.
  const fallback = document.getElementById('bridge-contrast')?.textContent || undefined;
  return reviewTokenChange(baseFiles, headFiles, parseContrastChecks(checks || fallback), config ? layoutOptions(config) : {});
}
