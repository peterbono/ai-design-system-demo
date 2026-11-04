// Add a product (components/ds/studio/AddProduct.tsx): what Bridge can see on GitHub to pick from, and what the
// product's Vercel statuses say about its previews. Words and rules: lib/add-product.ts. The pull request:
// scripts/roles.ts proposeNewProduct.
import type { PreviewCheckRun, ProductConfig } from '@bridge-ds/core';
import { installationToAdjust, type AppInstallation } from '../lib/access-view';
import {
  ownerAccountKey,
  ownsAccount,
  parseOwnerAccount,
  pickableRepos,
  previewsFromCheckRuns,
  previewsFromStatuses,
  type OwnerAccount,
  type ProductRepoChoice,
  type RepoLike,
  type StatusLike,
} from '../lib/add-product';
import { canonicalOwner, canonicalRepo } from '../lib/team-path';
import { currentViewer, ghGet, GitHubError, RateLimitError, readRepo, sessionMode, type Fetched } from './github-session';

/** What the dialog reads when it opens: the products it can pick, and the installation an admin adjusts on GitHub. */
export interface ProductAccess {
  repos: ProductRepoChoice[];
  /** The Bridge app's installation to open on GitHub ("Give Bridge access"), null when there is none to adjust. */
  installation: AppInstallation | null;
  /** The GitHub account that installation is on (else the team's), for "the owners of <account>". */
  account: string;
  /**
   * GitHub's id of `account` (the installation's, else the team's own: readOwnerAccount). With no installation, the
   * GitHub step opens the app's install page for that account, never GitHub's "Where do you want to install?". Null
   * when GitHub did not say.
   */
  accountId: number | null;
  /** How many products Bridge sees, the ones the team already lists included (never the design system itself). */
  seen: number;
}

/** The team's GitHub account under its current name (an old address keeps working: lib/team-path canonicalOwner). */
const ds = () => canonicalRepo(`${readRepo().owner}/${readRepo().repo}`);
const teamOwner = () => ds().split('/')[0]!;

// Asked once per account per page; the id is also kept in this browser (it never changes, a rename keeps it).
const accounts = new Map<string, Promise<OwnerAccount | null>>();

/**
 * The team's GitHub account: its id and type, from this browser's copy, else GitHub's answer for the library itself
 * (GET /repos/{owner}/{repo}, its `owner`: a read the page already makes, so usually no new request), else the public
 * organization (GET /orgs/{owner}). Not GET /users/{login}: Bridge answers that one with names and photos only.
 * Null when GitHub does not say; never throws.
 */
export function readOwnerAccount(): Promise<OwnerAccount | null> {
  const name = teamOwner();
  if (!name) return Promise.resolve(null);
  const k = ownerAccountKey(name);
  let p = accounts.get(k);
  if (p) return p;
  try {
    const kept = parseOwnerAccount(JSON.parse(localStorage.getItem(k) ?? 'null'));
    if (kept) return Promise.resolve(kept);
  } catch {
    /* storage blocked or a broken copy: ask GitHub */
  }
  const fromRepo = () => ghGet<{ owner?: unknown }>(`/repos/${ds()}`).then((r) => parseOwnerAccount(r.data?.owner));
  const fromOrg = () => ghGet<unknown>(`/orgs/${encodeURIComponent(name)}`).then((r) => parseOwnerAccount(r.data));
  p = fromRepo()
    .catch(() => null)
    .then((a) => a ?? fromOrg().catch(() => null))
    .then((a) => {
      if (!a) {
        // Not kept as a failure: the next ask reads again.
        accounts.delete(k);
        return null;
      }
      try {
        localStorage.setItem(k, JSON.stringify(a));
      } catch {
        /* storage full or blocked: kept for this page only */
      }
      return a;
    });
  accounts.set(k, p);
  return p;
}

/** The account the GitHub step opens when Bridge could not read its installation: the team's, with its id when known. */
export async function teamAccount(): Promise<{ account: string; accountId: number | null }> {
  return { account: teamOwner(), accountId: (await readOwnerAccount())?.id ?? null };
}

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
  const owner = teamOwner();
  // The team's account id, asked alongside (kept in this browser after the first time): it finds the installation even
  // when its name changed, and gives the GitHub step its account when there is no installation.
  const ownerAccount = readOwnerAccount();
  if (sessionMode() === 'app') {
    const [data, acct] = await Promise.all([ghGet<{ installations?: AppInstallation[] }>('/user/installations?per_page=100', opts).then(take), ownerAccount]);
    const list = data.installations ?? [];
    installation = installationToAdjust(list, owner, acct?.id);
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
  const login = installation?.account?.login;
  const account = login ? canonicalOwner(login) : owner;
  const accountId = (installation ? installation.account?.id : null) ?? (account.toLowerCase() === owner.toLowerCase() ? ((await ownerAccount)?.id ?? null) : null);
  return { repos: pickableRepos(repos, listed, ds()), installation, account, accountId, seen: pickableRepos(repos, [], ds()).length };
}

// Whether the viewer owns the account, per account for this page: asked once, GitHub's answer kept by ghGet too.
const owned = new Map<string, Promise<boolean | null>>();

/**
 * Whether the viewer can give Bridge access on `account` themselves (lib/add-product ownsAccount): their own account,
 * or an organization they own (one light read, GET /user/memberships/orgs/{org}). Null when Bridge cannot tell.
 */
export function readOwnership(account: string, installation: AppInstallation | null): Promise<boolean | null> {
  const login = currentViewer()?.login ?? null;
  const type = installation?.account?.type ?? null;
  const known = ownsAccount({ login, account, type });
  if (known !== null || !login || !account) return Promise.resolve(known);
  const key = `${login}|${account}`.toLowerCase();
  let p = owned.get(key);
  if (!p) {
    p = ghGet<{ role?: string; state?: string }>(`/user/memberships/orgs/${encodeURIComponent(account)}`).then(
      (r) => ownsAccount({ login, account, type, membership: r.data }),
      // 404: not a member of that organization (or it is a person's account): they can only request. Anything else:
      // Bridge cannot tell, the dialog keeps its usual words.
      (err: unknown) => (err instanceof GitHubError && err.status === 404 ? ownsAccount({ login, account, type, membership: null }) : null),
    );
    owned.set(key, p);
  }
  return p;
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
