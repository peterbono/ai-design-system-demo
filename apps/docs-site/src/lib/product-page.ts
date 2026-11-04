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
import { LIFECYCLE_LABEL, type LifecycleStage } from './review-state';
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
export type ProductStateKey = 'running' | 'review' | 'waiting' | 'building' | 'shipped' | 'not-planned';

/**
 * The groups of a product page, in the lifecycle's order and words (lib/review-state LIFECYCLE_LABEL): Exploring,
 * Waiting to be picked up, Being built, In review, Shipped, Not planned. Archived ones are folded apart.
 */
export const PRODUCT_STATES: { key: ProductStateKey; label: string; count: (n: number) => string; open: boolean }[] = [
  { key: 'running', label: LIFECYCLE_LABEL.exploring, count: (n) => `${n} exploring`, open: true },
  { key: 'waiting', label: LIFECYCLE_LABEL['waiting-for-code'], count: (n) => `${n} waiting to be picked up`, open: true },
  { key: 'building', label: LIFECYCLE_LABEL['being-built'], count: (n) => `${n} being built`, open: true },
  { key: 'review', label: LIFECYCLE_LABEL['in-review'], count: (n) => `${n} in review`, open: true },
  { key: 'shipped', label: LIFECYCLE_LABEL.shipped, count: (n) => `${n} shipped`, open: false },
  { key: 'not-planned', label: LIFECYCLE_LABEL['not-planned'], count: (n) => `${n} not planned`, open: false },
];

/** The group of each status (lib/exploration-state): the one status decides, never the words on the card. */
const GROUP_OF: Record<LifecycleStage, ProductStateKey | null> = {
  exploring: 'running',
  'waiting-for-code': 'waiting',
  'being-built': 'building',
  'in-review': 'review',
  approved: 'review',
  'next-release': 'shipped',
  shipped: 'shipped',
  'not-planned': 'not-planned',
  // Archived cards are folded apart; closed ones are not listed.
  archived: null,
  closed: null,
};

/** The group of a card, from its one status; null for the ones a product page does not group (archived, closed). */
export const stateOfCard = (c: Pick<ExplorationCard, 'lifecycle'>): ProductStateKey | null => GROUP_OF[c.lifecycle];

/** The cards in their state groups, in PRODUCT_STATES order, card order kept inside; empty groups left out. */
export function productGroups<C extends Pick<ExplorationCard, 'lifecycle'>>(cards: readonly C[]): { key: ProductStateKey; label: string; cards: C[] }[] {
  return PRODUCT_STATES.map((s) => ({ key: s.key, label: s.label, cards: cards.filter((c) => stateOfCard(c) === s.key) })).filter((g) => g.cards.length > 0);
}

/** How many cards stand in each state. */
export function productCounts(cards: readonly Pick<ExplorationCard, 'lifecycle'>[]): Record<ProductStateKey, number> {
  const out: Record<ProductStateKey, number> = { running: 0, review: 0, waiting: 0, building: 0, shipped: 0, 'not-planned': 0 };
  for (const c of cards) {
    const k = stateOfCard(c);
    if (k) out[k] += 1;
  }
  return out;
}

/** The work in progress of a product, in words: ["2 exploring", "1 waiting to be picked up"]. Done work is not in progress. */
function inProgress(cards: readonly Pick<ExplorationCard, 'lifecycle'>[]): string[] {
  const n = productCounts(cards);
  return PRODUCT_STATES.filter((s) => s.open && n[s.key] > 0).map((s) => s.count(n[s.key]));
}

/** A folder card's line: "2 exploring · 1 waiting to be picked up", "3 shipped", or "Nothing in progress". */
export function folderLine(cards: readonly Pick<ExplorationCard, 'lifecycle'>[], sep = ' · '): string {
  const parts = inProgress(cards);
  if (parts.length) return parts.join(sep);
  const shipped = productCounts(cards).shipped;
  return shipped ? `${shipped} shipped` : 'Nothing in progress';
}

/** The product page header's summary: "2 exploring, 1 waiting to be picked up.", or why the page is quiet. */
export function productSummary(cards: readonly Pick<ExplorationCard, 'lifecycle'>[]): string {
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
  /** The latest explorations' screens, newest first (capture, else its plate), FOLDER_SHOTS at most, with who explores each. */
  shots: { key: string; spec: ThumbSpec; who: ExplorationCard['author'] }[];
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
      shots: latest.slice(0, shots).map((c) => ({ key: c.key ?? String(c.number), spec: c.preview, who: c.author })),
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

/**
 * The empty product page: why it is worth starting, in one sentence, under the one action (the header says it is
 * empty). The library is a lead's to change (create-branch libraryLead): a designer of the team (`lead` false) gets no
 * start action there, so the line is the page's lead instead: what the page is for, and where their asks go.
 */
export function emptyProductLine(product: ProductConfig, library: boolean, lead = true): string {
  if (library && !lead) return 'The library your products use. Leads change it, so ask them for what you need.';
  return library
    ? 'Try a token, a variant or a new component with Claude AI, in a safe copy of the library, before it goes to review.'
    : `Try one of the screens of ${product.name} with Claude AI. Bridge spots what the library does not have, and what works goes to review.`;
}

/** A visitor on a product Bridge cannot read for them (its repository is private): the one thing they can do. */
export const signedOutProductLine = (name: string): string => `Sign in to see what your team explores in ${name}.`;

/**
 * A designer of the team on the library's page (no start action there): the two ways to ask, each a card to its page
 * with its Field Guide drawing. A component change from Components, a token change from Tokens; both reach a lead.
 */
export const LIBRARY_ASKS = [
  { key: 'component', title: 'Ask for a component change', line: 'Open a component and say what should change. A lead picks it up.', path: 'components/', drawing: 'components' },
  { key: 'token', title: 'Suggest a token change', line: 'Adjust a color, size or spacing. A lead reviews it before it ships.', path: 'tokens/', drawing: 'tokens' },
] as const;

/** The quiet line at the end of a product page: "1 archived.", "2 archived.". */
export const archivedLine = (n: number): string => `${n} archived.`;

/** "See archived": Changes' Archived tab, kept to this product. */
export const archivedHref = (key: string): string => studioHref(`changes/?state=archived&product=${encodeURIComponent(key.toLowerCase())}`);
