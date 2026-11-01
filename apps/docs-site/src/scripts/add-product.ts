// Add a product (components/ds/studio/AddProduct.tsx): what Bridge can see on GitHub to pick from, and what the
// product's Vercel statuses say about its previews. Words and rules: lib/add-product.ts. The pull request:
// scripts/roles.ts proposeNewProduct.
import type { ProductConfig } from '@bridge-ds/core';
import { previewsFromStatuses, type ProductRepoChoice, type StatusLike } from '../lib/add-product';
import { ghGet, readRepo, sessionMode } from './github-session';

interface RepoLike {
  full_name: string;
  name: string;
  default_branch?: string;
  archived?: boolean;
  fork?: boolean;
}

/**
 * The products Bridge can see: the repositories of the GitHub App's installations (signed in with the app), else the
 * viewer's own and their organizations'. Never the design system itself, a copy of a product already listed, an
 * archived one or a product Bridge already lists.
 */
export async function listProductRepos(listed: readonly ProductConfig[]): Promise<ProductRepoChoice[]> {
  const repos: RepoLike[] = [];
  if (sessionMode() === 'app') {
    const { data } = await ghGet<{ installations?: { id: number }[] }>('/user/installations?per_page=100');
    const lists = await Promise.all(
      (data.installations ?? []).slice(0, 10).map((i) =>
        ghGet<{ repositories?: RepoLike[] }>(`/user/installations/${i.id}/repositories?per_page=100`).then((r) => r.data.repositories ?? [], () => [] as RepoLike[]),
      ),
    );
    repos.push(...lists.flat());
  } else {
    const { data } = await ghGet<RepoLike[]>('/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member');
    repos.push(...data);
  }
  const ds = `${readRepo().owner}/${readRepo().repo}`.toLowerCase();
  const taken = new Set(listed.flatMap((p) => [p.repo, p.design?.repo]).filter((r): r is string => Boolean(r)).map((r) => r.toLowerCase()));
  const seen = new Set<string>();
  return repos
    .filter((r) => {
      const full = r.full_name.toLowerCase();
      if (seen.has(full) || full === ds || taken.has(full) || r.archived) return false;
      seen.add(full);
      return true;
    })
    .map((r) => ({ full: r.full_name, name: r.name, defaultBranch: r.default_branch ?? 'main' }))
    .sort((a, b) => a.full.localeCompare(b.full));
}

/** The previews of a product, from the Vercel statuses on its default branch; null when there are none yet. */
export async function detectPreviews(repo: ProductRepoChoice): Promise<{ preview: string; production: string } | null> {
  try {
    const { data } = await ghGet<{ statuses?: StatusLike[] }>(`/repos/${repo.full}/commits/${encodeURIComponent(repo.defaultBranch)}/status`);
    return previewsFromStatuses(data.statuses ?? []);
  } catch {
    return null;
  }
}
