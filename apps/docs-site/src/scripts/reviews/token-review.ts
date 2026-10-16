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

async function configAt(owner: string, repo: string, sha: string): Promise<BridgeConfig | null> {
  try {
    return loadConfig(await raw(owner, repo, sha, 'bridge.config.json'));
  } catch {
    return null;
  }
}

export async function filesAt(owner: string, repo: string, sha: string, root: string): Promise<Record<string, string>> {
  const tree = await ghGet<Tree>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const prefix = root ? `${root}/` : '';
  const paths = tree.data.tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && e.path.endsWith('.tokens.json')).map((e) => e.path);
  const entries = await Promise.all(paths.map(async (p) => [p.slice(prefix.length), await raw(owner, repo, sha, p)] as const));
  return Object.fromEntries(entries);
}

export async function analyzeTokenFiles(input: { owner: string; repo: string; baseSha: string; headSha: string; files: { filename: string }[] }): Promise<TokenReview> {
  const { owner, repo, baseSha, headSha } = input;
  const config = (await configAt(owner, repo, headSha)) ?? (await configAt(owner, repo, baseSha));
  const root = config?.tokens.root ?? siteRoot() ?? DEFAULT_TOKEN_PATHS.root;
  const checksPath = `${root}/${config?.tokens.contrastChecks ?? DEFAULT_TOKEN_PATHS.contrastChecks}`;
  const [baseFiles, headFiles, checks] = await Promise.all([
    filesAt(owner, repo, baseSha, root),
    filesAt(owner, repo, headSha, root),
    raw(owner, repo, headSha, checksPath).catch(() => raw(owner, repo, baseSha, checksPath).catch(() => '')),
  ]);
  // Repos (or older commits) without contrast.checks.json fall back to the checks this site was built with.
  const fallback = document.getElementById('bridge-contrast')?.textContent || undefined;
  return reviewTokenChange(baseFiles, headFiles, parseContrastChecks(checks || fallback), config ? layoutOptions(config) : {});
}
