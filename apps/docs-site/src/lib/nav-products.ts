// The side nav's two groups (owner-approved option A, 2026-11-04, boards NavTwo, NavMany, NavAllProducts, NavPhone):
//   Products        the team's products, the viewer's own first, at most NAV_PRODUCTS_MAX, then "All products" with
//                   the total when the team has more. The product open on screen always shows.
//   Design system   Components, Tokens, Quality, and Explorations (the library's own product page).
// And the All products page (pages/studio/products/index.astro): every product, the viewer's own first, a filter.
//
// "Own" is what this browser knows, never a guess about roles: products where the viewer has explorations in progress
// or recently (noted when Home reads the explorations, scripts/home-data.ts), then the products opened lately in this
// browser (noted by the product page), then the rest by name. Kept per team in localStorage.
// Pure: no DOM, the storage is passed in. Unit tested in nav-products.test.ts.
import type { ProductConfig } from '@bridge-ds/core';
import { cardProductKey, PRODUCT_STATES, stateOfCard } from './product-page';
import type { ExplorationCard } from './home-explorations';

/** How many products the side nav lists before "All products". */
export const NAV_PRODUCTS_MAX = 5;

/** How many rows the All products page shows at first, and adds on each "Show more". */
export const ALL_PRODUCTS_PAGE = 8;

/** An exploration counts as recent for this long after its last update, even once it is done. */
export const RECENT_DAYS = 30;

/** How many products each signal keeps per team (the oldest go first). */
const KEEP = 50;

export interface NavProduct {
  key: string;
  name: string;
  /** The library itself (the default product): Explorations under Design system, never in Products. */
  library?: boolean;
}

/** What this browser knows of the viewer and a team's products: key -> when (ms since epoch). */
export interface ProductSignals {
  /** Products where the viewer has explorations in progress or recently: the latest one's update. */
  mine: Record<string, number>;
  /** Products whose page this browser opened: when, last. */
  opened: Record<string, number>;
}

export const NO_SIGNALS: ProductSignals = { mine: {}, opened: {} };

/** The products the nav lists, in the configured order, keys lowercased. */
export const navProducts = (products: readonly ProductConfig[]): NavProduct[] => products.map((p) => ({ key: p.key.toLowerCase(), name: p.name, ...(p.default ? { library: true } : {}) }));

const byName = (a: NavProduct, b: NavProduct) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key);

/**
 * The team's products (the library left out), the viewer's own first: the ones they explore in, latest first; then
 * the ones opened in this browser, latest first; then the rest by name.
 */
export function orderProducts(products: readonly NavProduct[], signals: ProductSignals = NO_SIGNALS): NavProduct[] {
  const list = products.filter((p) => !p.library);
  const mine = list.filter((p) => signals.mine[p.key] !== undefined).sort((a, b) => signals.mine[b.key]! - signals.mine[a.key]! || byName(a, b));
  const opened = list.filter((p) => signals.mine[p.key] === undefined && signals.opened[p.key] !== undefined).sort((a, b) => signals.opened[b.key]! - signals.opened[a.key]! || byName(a, b));
  const rest = list.filter((p) => signals.mine[p.key] === undefined && signals.opened[p.key] === undefined).sort(byName);
  return [...mine, ...opened, ...rest];
}

export interface NavProductRows {
  /** The rows under Products, at most `max`. */
  shown: NavProduct[];
  /** How many products the team has (the library left out): the count on "All products". */
  total: number;
  /** "All products" shows: the team has more products than the nav lists. */
  all: boolean;
}

/**
 * The Products group: the first `max` of orderProducts, and "All products" when there are more. The product open on
 * screen (`active`, a key) always shows: beyond the first `max`, it takes the last row.
 */
export function navProductRows(products: readonly NavProduct[], signals: ProductSignals = NO_SIGNALS, active: string | null = null, max = NAV_PRODUCTS_MAX): NavProductRows {
  const ordered = orderProducts(products, signals);
  const total = ordered.length;
  let shown = ordered.slice(0, max);
  const here = active ? ordered.find((p) => p.key === active.toLowerCase()) : undefined;
  if (here && !shown.includes(here)) shown = [...shown.slice(0, Math.max(0, max - 1)), here];
  return { shown, total, all: total > max };
}

/** The library's own product (Explorations under Design system), or null when the team lists none. */
export const libraryOf = (products: readonly NavProduct[]): NavProduct | null => products.find((p) => p.library) ?? null;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The All products filter: products whose name holds what was typed, whatever the case or accents. */
export function filterProducts<P extends { name: string }>(products: readonly P[], query: string): P[] {
  const q = fold(query);
  if (!q) return [...products];
  return products.filter((p) => fold(p.name).includes(q));
}

/** The All products page's summary: "15 products. Yours come first." */
export function allProductsLine(total: number): string {
  if (total === 0) return 'No products yet.';
  if (total === 1) return '1 product.';
  return `${total} products. Yours come first.`;
}

/** The filter found nothing: what was typed, and the way back. */
export const noMatchLine = (query: string): string => `No product called "${query.trim()}". Check the name or clear the filter.`;

/** "Show 7 more", the next page at most. */
export const moreLabel = (left: number, page = ALL_PRODUCTS_PAGE): string => `Show ${Math.min(left, page)} more`;

/** The quiet marker on a row of the viewer's own product. */
export const OWN_MARKER = 'You explore here';

// ---------------------------------------------------------------------------------------------------------------
// What the viewer explores: from the explorations Home reads.

const OPEN_STATES = new Set(PRODUCT_STATES.filter((s) => s.open).map((s) => s.key));

/**
 * The products the viewer explores in, from the cards Home read: their own explorations still in progress, or
 * updated within RECENT_DAYS. key -> the latest update (ms).
 */
export function mineFromCards(cards: readonly Pick<ExplorationCard, 'own' | 'lifecycle' | 'updated' | 'productKey'>[], products: readonly ProductConfig[], now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) {
    if (!c.own) continue;
    const at = Date.parse(c.updated);
    const state = stateOfCard(c);
    const running = state !== null && OPEN_STATES.has(state);
    const recent = Number.isFinite(at) && now - at <= RECENT_DAYS * 24 * 60 * 60 * 1000;
    if (!running && !recent) continue;
    const key = cardProductKey(c, products);
    const when = Number.isFinite(at) ? at : now;
    out[key] = Math.max(out[key] ?? 0, when);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Kept in this browser, per team ("owner/repo").

export const mineKey = (team: string) => `bridge:products-mine:${team.toLowerCase()}`;
export const openedKey = (team: string) => `bridge:products-opened:${team.toLowerCase()}`;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function readMap(storage: Store | null, key: string): Record<string, number> {
  try {
    const raw = JSON.parse(storage?.getItem(key) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k.toLowerCase()] = v;
    return out;
  } catch {
    return {};
  }
}

function writeMap(storage: Store | null, key: string, map: Record<string, number>) {
  const kept = Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP),
  );
  try {
    storage?.setItem(key, JSON.stringify(kept));
  } catch {
    /* private mode or blocked storage: the nav falls back to names */
  }
}

/** What this browser knows for a team; nothing when storage is unavailable. */
export function readSignals(team: string | null, storage: Store | null): ProductSignals {
  if (!team) return NO_SIGNALS;
  return { mine: readMap(storage, mineKey(team)), opened: readMap(storage, openedKey(team)) };
}

/** The product page opened: it moves up among the ones opened lately. */
export function noteOpened(team: string | null, key: string, now: number, storage: Store | null) {
  if (!team || !key) return;
  writeMap(storage, openedKey(team), { ...readMap(storage, openedKey(team)), [key.toLowerCase()]: now });
}

/** Home read the explorations: the products the viewer explores in now replace what was kept. */
export function noteMine(team: string | null, mine: Record<string, number>, storage: Store | null) {
  if (!team) return;
  writeMap(storage, mineKey(team), mine);
}
