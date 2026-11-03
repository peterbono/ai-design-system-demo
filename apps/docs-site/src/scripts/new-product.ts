// Start a new product (components/ds/studio/StartNewProduct.tsx): Bridge starts the product's code on GitHub from its
// product starter, with the viewer's own GitHub sign-in, waits until GitHub has it, then links it to the team's library
// (.bridge/product.json, what `bridge connect` writes) when it may. Words and rules: lib/new-product.ts. The review:
// scripts/roles.ts proposeNewProduct, the same as Add product.
//
// GitHub: POST /repos/{template_owner}/{template_repo}/generate with the user access token. It needs the app's
// Repository "Administration: Read and write" (docs.github.com, Permissions required for GitHub Apps), and the person
// must be allowed to create repositories in that account. A repository an app creates is one the app can open right
// away (docs.github.com, Installing a GitHub App from a third party), so no "Give Bridge access" step follows.
import type { ProductRepoChoice } from '../lib/add-product';
import { productPointer, READY_MAX_MS, READY_TICK_MS, TEMPLATE_REPO } from '../lib/new-product';
import { ghGet, ghWrite, readRepo } from './github-session';

interface GeneratedRepo {
  full_name: string;
  name: string;
  default_branch?: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts `owner/slug` from Bridge's product starter (private, its main branch only) and waits until GitHub answers for
 * it, at most READY_MAX_MS. Throws GitHub's refusal (lib/new-product startRefusal reads it).
 */
export async function startProductCode(x: { owner: string; slug: string; name: string }, opts: { now?: () => number; sleep?: (ms: number) => Promise<unknown> } = {}): Promise<ProductRepoChoice> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? wait;
  const made = await ghWrite<GeneratedRepo>('POST', `/repos/${TEMPLATE_REPO}/generate`, {
    owner: x.owner,
    name: x.slug,
    description: `${x.name}, started from Bridge.`,
    private: true,
    include_all_branches: false,
  });
  const full = made.full_name || `${x.owner}/${x.slug}`;
  const until = now() + READY_MAX_MS;
  // GitHub fills the new code in the background: ready once its default branch answers.
  for (;;) {
    try {
      const r = await ghGet<{ default_branch?: string }>(`/repos/${full}/branches/${encodeURIComponent(made.default_branch ?? 'main')}`, { fresh: true });
      if (r.data) break;
    } catch {
      /* not there yet */
    }
    if (now() >= until) break;
    await sleep(READY_TICK_MS);
  }
  return { full, name: made.name || x.slug, defaultBranch: made.default_branch ?? 'main' };
}

/**
 * Links the new product to the team's library: `.bridge/product.json` in it, so its toolbar, Claude and the CLI know
 * the library and the product's key. Best effort: false when GitHub refused (the starter's own notes say how to link it).
 */
export async function linkProductCode(repo: ProductRepoChoice, key: string): Promise<boolean> {
  const ds = `${readRepo().owner}/${readRepo().repo}`;
  const path = '.bridge/product.json';
  try {
    let sha: string | undefined;
    try {
      sha = (await ghGet<{ sha?: string }>(`/repos/${repo.full}/contents/${path}?ref=${encodeURIComponent(repo.defaultBranch)}`, { fresh: true })).data.sha;
    } catch {
      sha = undefined;
    }
    await ghWrite('PUT', `/repos/${repo.full}/contents/${path}`, {
      message: 'chore: link this product to its Bridge library',
      content: btoa(productPointer(ds, key)),
      branch: repo.defaultBranch,
      ...(sha ? { sha } : {}),
    });
    return true;
  } catch {
    return false;
  }
}
