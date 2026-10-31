// The product level of Studio, like a project folder in Figma: one page per product the team configures
// (bridge.config.json "products": a product app with its own repository, and the library itself, which is an
// exploration target too). No folder of one's own, no sub-folder: the product is the only grouping, since it maps to
// a real repository or app.
//   - The product page (pages/studio/products/[key].astro, team shell pages/team-shell/products/item.astro, island
//     components/ds/studio/ProductPage.tsx): its explorations grouped by where they stand.
//   - The side nav's Products group (components/ds/studio/ProductsNav.tsx).
//   - The Home's product folders under Recent explorations (components/ds/studio/ExplorationCards.tsx).
// Pure: no DOM, no fetch. Unit tested in product-page.test.ts.
import { defaultProduct, type ProductConfig } from '@bridge-ds/core';
import { STUDIO_ROOT, studioHref } from './team-path';
import type { ExplorationCard } from './home-explorations';
import type { ThumbSpec } from './branch-thumb';

/** A product key as bridge.config.json writes it, and as a product page address carries it. */
export const PRODUCT_KEY_PATTERN = '[A-Za-z0-9][A-Za-z0-9-]*';
const KEY = new RegExp(`^${PRODUCT_KEY_PATTERN}$`);

/** The Studio address of a product page: /studio/products/<key>/ (the team's own on a team shell). */
export const productHref = (key: string): string => studioHref(`products/${encodeURIComponent(key.toLowerCase())}/`);

/** The product key of a product page address (self-hosted or a team's), else null. */
export function productKeyFromPath(pathname: string): string | null {
  const m = /\/products\/([^/]+)\/?(?:index\.html)?$/.exec(pathname);
  if (!m || !pathname.startsWith(STUDIO_ROOT)) return null;
  let key: string;
  try {
    key = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  return KEY.test(key) ? key.toLowerCase() : null;
}

/** The product a card belongs to: its key, else the library (the default product). */
export const cardProductKey = (c: Pick<ExplorationCard, 'productKey'>, products: readonly ProductConfig[]): string => (c.productKey ?? defaultProduct(products).key).toLowerCase();

/** Where an exploration stands on a product page, in the order the page lists them. */
export type ProductStateKey = 'running' | 'review' | 'waiting' | 'building' | 'shipped';

/** The groups of a product page, in order, in the words of the exploration tags. */
export const PRODUCT_STATES: { key: ProductStateKey; label: string; count: (n: number) => string }[] = [
  { key: 'running', label: 'Running', count: (n) => `${n} exploring` },
  { key: 'review', label: 'In review', count: (n) => `${n} in review` },
  { key: 'waiting', label: 'Waiting for code', count: (n) => `${n} waiting for code` },
  { key: 'building', label: 'Being built', count: (n) => `${n} being built` },
  { key: 'shipped', label: 'Shipped', count: (n) => `${n} shipped` },
];

/** The group of a card, from its stage and its tag's words (lib/home-explorations explorationStage). */
export function stateOfCard(c: Pick<ExplorationCard, 'stage' | 'state'>): ProductStateKey {
  if (c.stage === 'exploring' || c.stage === 'found') return 'running';
  if (c.stage === 'kept') return 'shipped';
  if (c.stage === 'in-review') return 'review';
  return c.state === 'Being built' ? 'building' : 'waiting';
}

/** The cards in their state groups, in PRODUCT_STATES order, card order kept inside; empty groups left out. */
export function productGroups<C extends Pick<ExplorationCard, 'stage' | 'state'>>(cards: readonly C[]): { key: ProductStateKey; label: string; cards: C[] }[] {
  return PRODUCT_STATES.map((s) => ({ key: s.key, label: s.label, cards: cards.filter((c) => stateOfCard(c) === s.key) })).filter((g) => g.cards.length > 0);
}

/** How many cards stand in each state. */
export function productCounts(cards: readonly Pick<ExplorationCard, 'stage' | 'state'>[]): Record<ProductStateKey, number> {
  const out: Record<ProductStateKey, number> = { running: 0, review: 0, waiting: 0, building: 0, shipped: 0 };
  for (const c of cards) out[stateOfCard(c)] += 1;
  return out;
}

/** The work in progress of a product, in words: ["2 exploring", "1 waiting for code"]. Shipped is not in progress. */
function inProgress(cards: readonly Pick<ExplorationCard, 'stage' | 'state'>[]): string[] {
  const n = productCounts(cards);
  return PRODUCT_STATES.filter((s) => s.key !== 'shipped' && n[s.key] > 0).map((s) => s.count(n[s.key]));
}

/** A folder card's line: "2 exploring · 1 waiting for code", "3 shipped", or "Nothing in progress". */
export function folderLine(cards: readonly Pick<ExplorationCard, 'stage' | 'state'>[], sep = ' · '): string {
  const parts = inProgress(cards);
  if (parts.length) return parts.join(sep);
  const shipped = productCounts(cards).shipped;
  return shipped ? `${shipped} shipped` : 'Nothing in progress';
}

/** The product page header's summary: "2 exploring, 1 waiting for code.", or why the page is quiet. */
export function productSummary(cards: readonly Pick<ExplorationCard, 'stage' | 'state'>[]): string {
  const parts = inProgress(cards);
  if (parts.length) return `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.`;
  const shipped = productCounts(cards).shipped;
  if (shipped) return `${shipped} shipped, nothing in progress.`;
  return 'Nothing explored here yet.';
}

/** How many captures a folder card shows. */
export const FOLDER_SHOTS = 3;

export interface ProductFolder {
  key: string;
  name: string;
  href: string;
  /** The latest explorations' screens, newest first (capture, else its plate), FOLDER_SHOTS at most. */
  shots: { key: string; spec: ThumbSpec }[];
  /** "2 exploring · 1 waiting for code". */
  line: string;
  total: number;
}

/**
 * The Home's product folders: one per configured product, in the configured order, each with the screens of its
 * latest explorations and what is in progress. A product without any exploration keeps its folder (it is a real app).
 */
export function productFolders(products: readonly ProductConfig[], cards: readonly ExplorationCard[], shots = FOLDER_SHOTS): ProductFolder[] {
  return products.map((p) => {
    const mine = cards.filter((c) => cardProductKey(c, products) === p.key.toLowerCase());
    const latest = [...mine].sort((a, b) => b.updated.localeCompare(a.updated));
    return {
      key: p.key,
      name: p.name,
      href: productHref(p.key),
      shots: latest.slice(0, shots).map((c) => ({ key: c.key ?? String(c.number), spec: c.preview })),
      line: folderLine(mine),
      total: mine.length,
    };
  });
}

/** The facts line of a product page: where it is live, where its code lives, and whether Bridge reaches it. */
export interface ProductFacts {
  production: { href: string; label: string } | null;
  repo: { href: string; label: string } | null;
  /** "In the library repository": the product lives next to the design system. */
  inLibrary: string | null;
  /** "Connected", "Not connected yet", or null while unknown. */
  connection: { text: string; ok: boolean } | null;
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * `ownRepo`: the product's own repository ("owner/name"), null when it lives in the library repository. `reached`:
 * whether Studio could read that repository (true, false), null while unknown or for the library repository.
 */
export function productFacts(product: ProductConfig, ownRepo: string | null, reached: boolean | null): ProductFacts {
  const production = product.production ? { href: product.production, label: host(product.production) } : null;
  return {
    production,
    repo: ownRepo ? { href: `https://github.com/${ownRepo}`, label: ownRepo } : null,
    inLibrary: ownRepo ? null : 'In the library repository',
    connection: ownRepo && reached !== null ? (reached ? { text: 'Connected', ok: true } : { text: 'Not connected yet', ok: false }) : null,
  };
}

/** The empty product page: why it is worth starting, in one sentence, before the one action (the header says it is empty). */
export function emptyProductLine(product: ProductConfig, library: boolean): string {
  return library
    ? 'Try a token, a variant or a new component with Claude AI, in a safe copy of the library, before it goes to review.'
    : `Try one of the screens of ${product.name} with Claude AI. Bridge spots what the library does not have, and what works goes to review.`;
}
