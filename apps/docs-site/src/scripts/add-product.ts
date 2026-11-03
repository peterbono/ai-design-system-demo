// Add a product (components/ds/studio/AddProduct.tsx): what Bridge can see on GitHub to pick from, and what the
// product's Vercel statuses say about its previews. Words and rules: lib/add-product.ts. The pull request:
// scripts/roles.ts proposeNewProduct.
import type { PreviewCheckRun, ProductConfig } from '@bridge-ds/core';
import { installationToAdjust, type AppInstallation } from '../lib/access-view';
import { pickableRepos, previewsFromCheckRuns, previewsFromStatuses, type ProductRepoChoice, type RepoLike, type StatusLike } from '../lib/add-product';
import { ghGet, RateLimitError, readRepo, sessionMode, type Fetched } from './github-session';

/** What the dialog reads when it opens: the products it can pick, and the installation an admin adjusts on GitHub. */
export interface ProductAccess {
  repos: ProductRepoChoice[];
  /** The Bridge app's installation to open on GitHub ("Give Bridge access"), null when there is none to adjust. */
  installation: AppInstallation | null;
  /** The GitHub account that installation is on (else the team's), for "the owners of <account>". */
  account: string;
}

const ds = () => `${readRepo().owner}/${readRepo().repo}`;

/** A read GitHub answered from this browser's copy because it refused it: busy, never "nothing new". */
function live<T>(r: Fetched<T>): T {
  if (r.stale) throw new RateLimitError(r.resetAt ?? null);
  return r.data;
}

/**
 * The products Bridge can see: the repositories of the GitHub App's installations (signed in with the app), else the
 * viewer's own and their organizations'. Never the design system itself, a copy of a product already listed, an
 * archived one or a product Bridge already lists. `fresh`: ask GitHub again, not the browser's copy.
 */
export async function readProductAccess(listed: readonly ProductConfig[], opts: { fresh?: boolean } = {}): Promise<ProductAccess> {
  // A fresh read never takes the browser's copy for an answer; the first read of the dialog may.
  const take = <T,>(r: Fetched<T>): T => (opts.fresh ? live(r) : r.data);
  const repos: RepoLike[] = [];
  let installation: AppInstallation | null = null;
  if (sessionMode() === 'app') {
    const data = take(await ghGet<{ installations?: AppInstallation[] }>('/user/installations?per_page=100', opts));
    const list = data.installations ?? [];
    installation = installationToAdjust(list, readRepo().owner);
    const lists = await Promise.all(
      list.slice(0, 10).map((i) =>
        ghGet<{ repositories?: RepoLike[] }>(`/user/installations/${i.id}/repositories?per_page=100`, opts).then((r) => take(r).repositories ?? [], (err: unknown) => {
          if (err instanceof RateLimitError) throw err;
          return [] as RepoLike[];
        }),
      ),
    );
    repos.push(...lists.flat());
  } else {
    repos.push(...take(await ghGet<RepoLike[]>('/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member', opts)));
  }
  return { repos: pickableRepos(repos, listed, ds()), installation, account: installation?.account?.login || readRepo().owner };
}

/** The pick list only (kept for callers that do not open GitHub). */
export const listProductRepos = async (listed: readonly ProductConfig[]): Promise<ProductRepoChoice[]> => (await readProductAccess(listed)).repos;

/**
 * One light read while the dialog waits on GitHub: the products of the installation the admin is adjusting (one
 * request, asked again, not the browser's copy), else the whole list. Throws RateLimitError when GitHub is busy.
 */
export async function pollProductRepos(listed: readonly ProductConfig[], installationId: number | null): Promise<ProductRepoChoice[]> {
  if (installationId && sessionMode() === 'app') {
    const data = live(await ghGet<{ repositories?: RepoLike[] }>(`/user/installations/${installationId}/repositories?per_page=100`, { fresh: true }));
    return pickableRepos(data.repositories ?? [], listed, ds());
  }
  return (await readProductAccess(listed, { fresh: true })).repos;
}

/**
 * The previews of a product, from what its host reports on its default branch: Vercel or Netlify commit statuses, else
 * a Cloudflare Pages check run. Null when there are none yet.
 */
export async function detectPreviews(repo: ProductRepoChoice): Promise<{ preview: string; production: string } | null> {
  const ref = `/repos/${repo.full}/commits/${encodeURIComponent(repo.defaultBranch)}`;
  const [statuses, runs] = await Promise.all([
    ghGet<{ statuses?: StatusLike[] }>(`${ref}/status`).then((r) => r.data.statuses ?? []).catch(() => [] as StatusLike[]),
    ghGet<{ check_runs?: { name: string; status: string; conclusion?: string | null; app?: { slug?: string } | null; output?: { summary?: string | null; text?: string | null } | null }[] }>(`${ref}/check-runs?per_page=100`)
      .then((r) => (r.data.check_runs ?? []).map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion ?? null, app: c.app?.slug ?? null, summary: c.output?.summary ?? null, text: c.output?.text ?? null })))
      .catch(() => [] as PreviewCheckRun[]),
  ]);
  return previewsFromStatuses(statuses) ?? previewsFromCheckRuns(runs);
}
