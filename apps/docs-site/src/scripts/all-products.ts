// What the All products page reads (components/ds/studio/AllProducts.tsx): the team's explorations, through the same
// cached reads Home and the product pages make (the design system's open and recently closed pull requests, and each
// product repository's open ones), so opening it after Home costs no new list read. Only what the rows say: one status
// line per product (lib/product-page.ts folderLine) and which ones the viewer explores in (lib/nav-products.ts).
// No display names, no screens. Signed out on a private team, nothing is read: the rows keep their names.
// The one status (lib/exploration-state): a design copy exploration handed to developers says what its task says, as on
// Home and the product page (the same cached task reads, scripts/design-task.ts), so a task closed as done is Shipped
// here too, never "waiting to be picked up". The counts are the whole team's, which the page's summary says
// (lib/nav-products allProductsLine); Home's sentence counts only the viewer's own.
import { configuredProducts } from './product-repos';
import { currentContributor, currentViewer, ghGet, readRepo } from './github-session';
import { repoContext } from './repo-context';
import { designTaskStages, taskUrlOf } from './design-task';
import type { LifecycleStage } from '../lib/review-state';
import { homeExplorations, type ExplorationCard, type ExplorationPull } from '../lib/home-explorations';
import { CLAUDE } from '../lib/home-model';
import { mineFromCards, noteMine } from '../lib/nav-products';
import { githubBusy, type GitHubBusy } from '../lib/github-busy';

export interface AllProductsRead {
  cards: ExplorationCard[];
  busy: GitHubBusy | null;
}

const closedPath = (repo: string) => `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`;

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Reads the team's explorations; null when GitHub could not be read at all (the rows then show names only). */
export async function readAllProducts(): Promise<AllProductsRead | null> {
  const products = configuredProducts();
  const { owner, repo } = readRepo();
  const ds = `${owner}/${repo}`;
  let open: ExplorationPull[];
  try {
    open = (await ghGet<ExplorationPull[]>(`/repos/${ds}/pulls?state=open&per_page=100`)).data;
  } catch (err) {
    const busy = githubBusy(err);
    return busy ? { cards: [], busy } : null;
  }
  const [closed, inProducts] = await Promise.all([
    ghGet<(ExplorationPull & { merged_at?: string | null })[]>(closedPath(ds)).then(
      (r) => r.data.filter((p) => p.merged_at),
      () => [] as ExplorationPull[],
    ),
    import('./product-repos').then(
      (m) => m.productPulls() as unknown as Promise<ExplorationPull[]>,
      () => [] as ExplorationPull[],
    ),
  ]);
  const viewer = currentViewer()?.login ?? null;
  const viewerRef = currentContributor()?.ref ?? null;
  const pulls = [...open, ...inProducts, ...closed].map((p) => ({ ...p, user: p.user ?? { login: 'unknown' } }));
  // The developers' tasks of the handed-off design copy explorations: Home's read, cached for a minute.
  const stages = await designTaskStages(inProducts).catch(() => new Map<string, LifecycleStage>());
  const taskStage = (p: ExplorationPull) => {
    const u = taskUrlOf(p.body);
    return u ? (stages.get(u) ?? null) : null;
  };
  const cards = homeExplorations(pulls, { products, viewer, viewerRef, taskStage, author: () => CLAUDE });
  // Signed in, what the viewer explores in is known now: the side nav lists those first from the next page on.
  if (viewer || viewerRef) {
    const r = repoContext();
    noteMine(`${r.owner}/${r.repo}`, mineFromCards(cards, products, Date.now()), storage());
  }
  return { cards, busy: null };
}
