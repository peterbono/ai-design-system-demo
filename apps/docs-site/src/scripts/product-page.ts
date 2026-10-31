// What a product page reads (components/ds/studio/ProductPage.tsx): only that product's explorations, through the
// same cached reads the home and Changes make, so opening a product after the home costs no new list read.
//   - A product with its own repository (bridge.config.json products[].repo): that repository's open pull requests
//     (the read scripts/product-repos.ts makes for every list) and its recently closed ones (Shipped).
//   - The library, or a product that lives in the library repository: the design system's open and recently closed
//     pull requests (the home's two reads), kept to the explorations of this product.
// Then, once per person, their display name (the home's personOf), and each card's screen from the preview captures
// (one raw file for all, no API call). Rules: lib/product-page.ts and lib/home-explorations.ts.
import { findProduct, requesterOf, type ProductConfig } from '@bridge-ds/core';
import { currentViewer, ghGet, limitLine, readRepo, RateLimitError } from './github-session';
import { configuredProducts, productRepoByKey } from './product-repos';
import { homeExplorations, type ExplorationCard, type ExplorationPull } from '../lib/home-explorations';
import { productPullsPath, tagProductPulls, type ExplorationPullLike } from '../lib/explorations-view';
import { cardProductKey } from '../lib/product-page';
import { person, requesterPerson, type Person } from '../lib/home-model';
import type { ThumbSpec } from '../lib/branch-thumb';
import { busyText } from '../lib/team-load';

export interface ProductPageData {
  product: ProductConfig | null;
  products: ProductConfig[];
  /** The product's own repository ("owner/name"), null when it lives in the library repository. */
  ownRepo: string | null;
  /** Studio could read the product's own repository; null while unknown or for the library repository. */
  reached: boolean | null;
  loading: boolean;
  failed: string | null;
  cards: ExplorationCard[];
  archived: ExplorationCard[];
}

type Pull = ExplorationPullLike & { user: { login: string; avatar_url?: string; type?: string } | null };

const closedPath = (repo: string) => `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`;
const avatarOf = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=64`;

const failure = (err: unknown) =>
  err instanceof RateLimitError ? (limitLine(err) ?? busyText(err.resetAt ? (err.resetAt.getTime() - Date.now()) / 1000 : null)) : 'GitHub could not be reached. Reload the page to try again.';

/** Reads the product `key`'s explorations and paints through `onUpdate` as they come. */
export async function loadProductPage(key: string, onUpdate: (d: ProductPageData) => void): Promise<void> {
  const products = configuredProducts();
  const product = findProduct(products, key) ?? null;
  const own = product ? productRepoByKey(product.key) : null;
  const base: ProductPageData = { product, products, ownRepo: own?.repo ?? null, reached: null, loading: true, failed: null, cards: [], archived: [] };
  onUpdate(base);
  if (!product) {
    onUpdate({ ...base, loading: false });
    return;
  }
  const ds = readRepo();
  const repo = own?.repo ?? `${ds.owner}/${ds.repo}`;
  let open: Pull[];
  let reached: boolean | null = null;
  try {
    const read = (await ghGet<Pull[]>(own ? productPullsPath(own.repo) : `/repos/${repo}/pulls?state=open&per_page=100`)).data;
    open = own ? (tagProductPulls(read, own) as Pull[]) : read;
    if (own) reached = true;
  } catch (err) {
    // A product repository Bridge cannot read: the page says so in its facts, quietly (Settings says why).
    if (own && !(err instanceof RateLimitError)) {
      onUpdate({ ...base, reached: false, loading: false });
      return;
    }
    onUpdate({ ...base, loading: false, failed: failure(err) });
    return;
  }
  let closed: Pull[] = [];
  const persons = new Map<string, Person>();
  const shots = new Map<string, ThumbSpec>();
  const pick = (login: string) => persons.get(login.toLowerCase()) ?? person(login, null, avatarOf(login));
  const author = (p: ExplorationPull) => {
    const r = requesterOf(p.body);
    return (r && requesterPerson(r, pick)) ?? pick(p.user?.login ?? 'unknown');
  };
  const shotKey = (p: { number: number; product?: string | null | undefined }) => `${p.product ?? ''}#${p.number}`;
  const viewer = currentViewer()?.login ?? null;
  const all = (): ExplorationPull[] => [...open, ...closed].map((p) => ({ ...p, user: p.user ?? { login: 'unknown' } }));
  const mineOnly = (cards: ExplorationCard[]) => cards.filter((c) => cardProductKey(c, products) === product.key.toLowerCase());
  const cardsOf = (archived: 'exclude' | 'only') => mineOnly(homeExplorations(all(), { products, viewer, archived, author, preview: (p) => shots.get(shotKey(p)) }));
  let loading = true;
  const paint = () => onUpdate({ ...base, reached, loading, cards: cardsOf('exclude'), archived: cardsOf('only') });

  paint();
  try {
    const read = (await ghGet<Pull[]>(closedPath(repo))).data.filter((p) => p.merged_at);
    closed = own ? (tagProductPulls(read, own) as Pull[]) : read;
  } catch {
    closed = [];
  }
  loading = false;
  paint();

  // Display names, once per person (the home's cache), then the screens.
  const listed = [...cardsOf('exclude'), ...cardsOf('only')];
  const { personOf } = await import('./home-data');
  const logins = new Set<string>();
  for (const p of all()) {
    const who = requesterOf(p.body)?.login ?? p.user?.login;
    if (who && who !== 'unknown' && listed.some((c) => c.number === p.number)) logins.add(who);
  }
  await Promise.all([...logins].map(async (l) => persons.set(l.toLowerCase(), await personOf(l, avatarOf(l)))));
  paint();
  const [{ previewShotOf }, { shotThumb }] = await Promise.all([import('./preview-shots'), import('../lib/preview-shots')]);
  await Promise.all(
    all()
      .filter((p) => listed.some((c) => c.number === p.number))
      .map(async (p) => {
        const shot = await previewShotOf({ number: p.number, product: p.product ?? null }).catch(() => null);
        if (!shot) return;
        shots.set(shotKey(p), shotThumb(shot, { product: product.name, seed: shotKey(p) }));
        paint();
      }),
  );
}
