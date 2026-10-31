// Explorations in a product's own repository (bridge.config.json products[].repo), read by Changes, the home and the
// exploration page: one read of the open branches per product repository, through ghGet (cached and shared like the
// design system's list; an email member's reads go through the team's proxy). A repository Bridge cannot read is
// skipped here, silently: designers never see why, Settings says it (scripts/product-connections.ts).
import { DEFAULT_PRODUCTS, EXPLORATION_PREFIX, type GitHubClient, type ProductConfig } from '@bridge-ds/core';
import { productPullsPath, productReposOf, tagProductPulls, type ExplorationPullLike, type ProductRepo } from '../lib/explorations-view';
import { getToken, ghGet, readRepo, studioClient } from './github-session';
import { explorationsConfig } from './exploration-start';
import { siteConfig } from './repo-context';

/** bridge.config.json products (the same read as product-branch.ts siteProducts, without loading that page module). */
export function configuredProducts(): ProductConfig[] {
  try {
    const site = siteConfig() as { products?: ProductConfig[] };
    return site.products?.length ? site.products : DEFAULT_PRODUCTS;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

/** The site's products that have their own repository. */
export const siteProductRepos = (): ProductRepo[] => productReposOf(configuredProducts(), explorationsConfig());

/** The product repository of a product key, when the site gives it one. */
export const productRepoByKey = (key: string | null | undefined): ProductRepo | null => (key ? (siteProductRepos().find((x) => x.product.key === key.toLowerCase()) ?? null) : null);

/**
 * The files an exploration's branch changes (first 100), in the design system repository or its product's own one,
 * read once per head commit; null when GitHub cannot be read. Lists read it for the row's state ("Not started" while
 * only Bridge notes changed: core explorationStateLabel).
 */
const explorationFilesBy = new Map<string, Promise<string[] | null>>();
export function explorationFiles(x: { number: number; headSha: string; product?: string | null | undefined }): Promise<string[] | null> {
  const own = productRepoByKey(x.product);
  const key = `${own?.repo ?? ''}#${x.number}@${x.headSha}`;
  let files = explorationFilesBy.get(key);
  if (!files) {
    const ds = readRepo();
    const path = own ? `/repos/${own.repo}` : `/repos/${ds.owner}/${ds.repo}`;
    files = ghGet<{ filename: string }[]>(`${path}/pulls/${x.number}/files?per_page=100`)
      .then((f) => f.data.map((y) => y.filename))
      .catch(() => null);
    explorationFilesBy.set(key, files);
  }
  return files;
}

export type ProductPull = ExplorationPullLike & { repo: string; product: string };

let read: Promise<{ at: ProductRepo; pulls: ProductPull[] | null }[]> | null = null;

/**
 * The open explorations of every product repository, one read each, in parallel. `pulls` is null for a repository
 * that could not be read (not connected, GitHub busy): lists leave it out. Read once per page unless `fresh`.
 */
export function readProductPulls(fresh = false): Promise<{ at: ProductRepo; pulls: ProductPull[] | null }[]> {
  if (fresh) read = null;
  read ??= Promise.all(
    siteProductRepos().map((at) =>
      ghGet<ExplorationPullLike[]>(productPullsPath(at.repo)).then(
        (f) => ({ at, pulls: tagProductPulls(f.data, at) }),
        () => ({ at, pulls: null }),
      ),
    ),
  );
  return read;
}

/** Every open exploration read in product repositories, the unreachable ones left out. */
export const productPulls = async (fresh = false): Promise<ProductPull[]> => (await readProductPulls(fresh)).flatMap((x) => x.pulls ?? []);

/**
 * A client for a product repository with the viewer's token: it writes exploration branches only, never the product's
 * default branch (`base`, from the pull request) nor main or master.
 */
export const productClient = (repo: string, base?: string | null): GitHubClient =>
  studioClient(repo, getToken() ?? '', { protectedBranches: [...new Set(['main', 'master', ...(base ? [base] : [])])], branchPrefix: EXPLORATION_PREFIX });
