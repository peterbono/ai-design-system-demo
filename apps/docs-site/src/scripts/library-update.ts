// The library line of a product page (components/ds/studio/ProductPage.tsx): which library version the product's own
// repository installs, the latest published one, and the open "Update the library" pull request, read through the same
// cached reads as the rest of Studio (the team's read path, api/_lib/team-read.ts) and the server's registry check
// (GET /api/contribute?npm=). "Send the update to the developers" asks the server to open the pull request with
// Bridge's app (api/_lib/library-update.ts): never from the browser, never a merge. Rules: lib/library-update.ts.
import { productCodeRepoOf, type ProductConfig } from '@bridge-ds/core';
import { CONTRIBUTE_API, CONTRIBUTE_HEADER, isContribAuth } from '../lib/contribute';
import { productPullsPath } from '../lib/explorations-view';
import {
  isUpdatePull,
  libraryDepsOf,
  libraryDirsOf,
  libraryState,
  lockKindOf,
  updateVersionOf,
  type LibraryState,
  type OpenUpdate,
} from '../lib/library-update';
import { getToken, ghGet, readRepo } from './github-session';
import { siteConfig } from './repo-context';

export interface LibraryView {
  state: LibraryState;
  update: OpenUpdate | null;
}

const RAW = { accept: 'application/vnd.github.raw', raw: true } as const;

/** The team's own library package names (previews.packages), besides the Bridge scope. */
const extraPackages = (): string[] => {
  const list = (siteConfig() as { previews?: { packages?: unknown } }).previews?.packages;
  return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : [];
};

/** The latest published versions, from this site's server (kept there a few minutes). Null when it cannot say. */
async function latestOf(names: readonly string[]): Promise<Record<string, string | null> | null> {
  if (!names.length) return {};
  try {
    const res = await fetch(`${CONTRIBUTE_API}?npm=${names.map(encodeURIComponent).join(',')}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return null;
    const data = (await res.json()) as { latest?: Record<string, string | null> };
    return data.latest ?? null;
  } catch {
    return null;
  }
}

/**
 * What the product's own repository uses of the library, and its open update. Null for a product without a repository
 * of its own, one that asks for no library package, or when GitHub or the registry could not say (the page then says
 * nothing: never a wrong version).
 */
export async function readLibraryView(product: ProductConfig): Promise<LibraryView | null> {
  const ds = readRepo();
  const repo = productCodeRepoOf(product, `${ds.owner}/${ds.repo}`);
  if (!repo) return null;
  try {
    const extra = extraPackages();
    const [root, pkgText] = await Promise.all([
      ghGet<{ name: string; type: string }[]>(`/repos/${repo}/contents`),
      ghGet<string>(`/repos/${repo}/contents/package.json`, RAW),
    ]);
    const files = Array.isArray(root.data) ? root.data.filter((e) => e.type === 'file').map((e) => e.name) : [];
    const lockKind = lockKindOf(files);
    const pkg: unknown = JSON.parse(pkgText.data);
    let lock: unknown = null;
    if (lockKind === 'npm') {
      const name = files.includes('package-lock.json') ? 'package-lock.json' : 'npm-shrinkwrap.json';
      lock = JSON.parse((await ghGet<string>(`/repos/${repo}/contents/${name}`, RAW)).data);
    }
    const workspaces: Record<string, unknown> = {};
    for (const dir of lock ? libraryDirsOf(lock, extra) : []) {
      if (!dir) continue;
      workspaces[dir] = JSON.parse((await ghGet<string>(`/repos/${repo}/contents/${dir.split('/').map(encodeURIComponent).join('/')}/package.json`, RAW)).data);
    }
    const names = [...new Set([pkg, ...Object.values(workspaces)].flatMap((p) => libraryDepsOf(p, '', extra).map((d) => d.name)))];
    if (!names.length) return null;
    const [latest, pulls] = await Promise.all([latestOf(names), ghGet<Parameters<typeof isUpdatePull>[0][]>(productPullsPath(repo)).catch(() => null)]);
    if (!latest) return null;
    const open = (pulls?.data ?? []).find((p) => isUpdatePull(p, repo)) as (Parameters<typeof isUpdatePull>[0] & { number: number; html_url: string }) | undefined;
    return {
      state: libraryState({ pkg, lock, lockKind, latest, workspaces, extra }),
      update: open ? { number: open.number, url: open.html_url, version: updateVersionOf(open.body) } : null,
    };
  } catch (err) {
    console.warn('Bridge: the library version of the product could not be read.', err);
    return null;
  }
}

/** What the server answers once the update is sent. */
export interface SentUpdate {
  state: 'opened' | 'updated' | 'unchanged' | 'current';
  pr: { number: number; url: string; version: string } | null;
}

/** "Send the update to the developers": the server opens (or updates) the pull request. Throws with Bridge's words. */
export async function sendLibraryUpdate(product: ProductConfig): Promise<SentUpdate> {
  const ds = readRepo();
  const token = getToken();
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', [CONTRIBUTE_HEADER]: '1' };
  // A lead signed in with GitHub proves who they are with their own token; an email admin with the team's session.
  if (token && !isContribAuth(token)) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(CONTRIBUTE_API, { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ action: 'library-update', repo: `${ds.owner}/${ds.repo}`, product: product.key }) });
  const data = (await res.json().catch(() => ({}))) as Partial<SentUpdate> & { message?: string };
  if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : `Bridge answered ${res.status}`);
  return { state: data.state ?? 'current', pr: data.pr ?? null };
}
