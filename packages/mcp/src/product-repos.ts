// Explorations and product branches that live in a product's own repository (bridge.config.json products[].repo),
// for Claude and the CLI: a client per product repository with the same token, and which repository a reference
// means. "admin-app#12", "peterbono/bridge-product-admin#12", "admin-app:checkout-flow" and a pull request link name one in a
// product's repository; "12", "#12" and a plain name stay in the design system repository, and a plain name not found
// there is looked up in the product repositories too. Run inside a connected product repository (.bridge/product.json),
// "12", "#12" and a name mean that product's own explorations first. The reference rules are @bridge-ds/core's (parseExplorationRef).
import {
  EXPLORATION_PREFIX,
  explorationSlug,
  findProduct,
  parseExplorationRef,
  productOfRepo,
  productRepoOf,
  productRepos,
  productsOf,
  type GitHubClient,
  type ProductConfig,
} from '@bridge-ds/core';
import type { BridgeContext } from './context.js';

/** Branches Bridge never writes to in a product repository: its usual default branches (the real one is read on start). */
const PRODUCT_PROTECTED = ['main', 'master'];

/** A client for a product's own repository with this context's token: new branches need the explore/ prefix. */
export const productClient = (ctx: BridgeContext, repo: string): GitHubClient => ctx.githubFor(repo, { protectedBranches: PRODUCT_PROTECTED, branchPrefix: EXPLORATION_PREFIX });

/** Every product with its own repository, and a client for it. */
export async function productRepoClients(ctx: BridgeContext, ds: GitHubClient): Promise<{ product: ProductConfig; repo: string; client: GitHubClient }[]> {
  const { config } = await ctx.config();
  return productRepos(productsOf(config), ds.fullName).map((x) => ({ ...x, client: productClient(ctx, x.repo) }));
}

/** Where a reference points: the client to read and write it with, the number or name there, and its product. */
export interface Located {
  gh: GitHubClient;
  ref: number | string;
  /** Set for a product's own repository: the product and "owner/name". */
  product?: ProductConfig | undefined;
  repo?: string | undefined;
}

/**
 * Which repository an exploration or product branch reference means (see the file comment). `ds` is the design
 * system repository's client. Throws in plain words for a product or repository bridge.config.json does not list.
 */
export async function locate(ctx: BridgeContext, input: string | number, ds: GitHubClient): Promise<Located> {
  const { config } = await ctx.config();
  const products = productsOf(config);
  const r = parseExplorationRef(input);
  const inProduct = (p: ProductConfig, repo: string): Located => ({ gh: productClient(ctx, repo), ref: r.ref, product: p, repo });
  if (r.product) {
    const p = findProduct(products, r.product);
    if (!p) throw new Error(`Unknown product "${r.product}". Products: ${products.map((x) => x.key).join(', ')} (bridge.config.json "products").`);
    const repo = productRepoOf(p, ds.fullName);
    return repo ? inProduct(p, repo) : { gh: ds, ref: r.ref };
  }
  if (r.repo) {
    if (r.repo.toLowerCase() === ds.fullName.toLowerCase()) return { gh: ds, ref: r.ref };
    const p = productOfRepo(products, r.repo, ds.fullName);
    if (!p) throw new Error(`${r.repo} is neither the design system repository (${ds.fullName}) nor a product repository in bridge.config.json "products".`);
    return inProduct(p, productRepoOf(p, ds.fullName)!);
  }
  // Run inside a connected product repository (.bridge/product.json): "#12" and a name mean that product's own ones.
  const here = ctx.product ? findProduct(products, ctx.product) : undefined;
  const hereRepo = here ? productRepoOf(here, ds.fullName) : null;
  if (here && hereRepo) {
    if (typeof r.ref === 'number') return inProduct(here, hereRepo);
    const at = productClient(ctx, hereRepo);
    if (await at.findOpenPullRequest(`${EXPLORATION_PREFIX}${explorationSlug(r.ref)}`).catch(() => undefined)) return { gh: at, ref: r.ref, product: here, repo: hereRepo };
  }
  if (typeof r.ref === 'string') {
    // A name: the design system repository first, then each product repository (one read each, unreachable ones skipped).
    const branch = `${EXPLORATION_PREFIX}${explorationSlug(r.ref)}`;
    if (await ds.findOpenPullRequest(branch).catch(() => undefined)) return { gh: ds, ref: r.ref };
    for (const x of await productRepoClients(ctx, ds)) {
      if (await x.client.findOpenPullRequest(branch).catch(() => undefined)) return { gh: x.client, ref: r.ref, product: x.product, repo: x.repo };
    }
  }
  return { gh: ds, ref: r.ref };
}

/** The number of a located pull request, or how to name one. */
export function locatedNumber(l: Located, input: string | number): number {
  if (typeof l.ref === 'number') return l.ref;
  throw new Error(`"${input}" is not a branch number. Pass the number Studio shows (#12, or shop#12 for a product with its own repository) or the pull request link.`);
}
