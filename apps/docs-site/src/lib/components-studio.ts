// Studio Components: the sentence under the title and the one primary action, from the components' status and
// guidance state. Pure, tested in components-studio.test.ts.
import { defaultProduct, findProduct, productForPlace, type ProductConfig } from '@bridge-ds/core';
import type { GuidanceState } from './components';

export interface LeadInput {
  slug: string;
  status: 'stable' | 'beta' | 'deprecated';
  guidance: GuidanceState;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "48 components, all stable." then, when some lack guidance or wait for a review, "2 need usage guidance." (that
 * part filters the list). Statuses other than stable are counted out loud.
 */
export function componentsLead(list: LeadInput[]): { status: string; guidance: string | null; needing: number } {
  const n = list.length;
  const beta = list.filter((c) => c.status === 'beta').length;
  const deprecated = list.filter((c) => c.status === 'deprecated').length;
  const stable = n - beta - deprecated;
  const lifecycle =
    stable === n
      ? n === 1
        ? 'stable'
        : 'all stable'
      : [stable ? `${stable} stable` : '', beta ? `${beta} beta` : '', deprecated ? `${deprecated} deprecated` : ''].filter(Boolean).join(', ');
  const needing = list.filter((c) => c.guidance !== 'ok').length;
  return {
    status: `${plural(n, 'component')}, ${lifecycle}.`,
    guidance: needing ? `${needing} ${needing === 1 ? 'needs' : 'need'} usage guidance.` : null,
    needing,
  };
}

/**
 * The page's one primary: "Add guidance" while a component has none (opens the first one), else "Review guidance"
 * while a Claude draft waits, else nothing (the list is the page).
 */
export function componentsPrimary(list: LeadInput[], editHref: (slug: string) => string): { label: string; href: string } | null {
  const missing = list.find((c) => c.guidance === 'missing');
  if (missing) return { label: 'Add guidance', href: editHref(missing.slug) };
  const review = list.find((c) => c.guidance === 'review');
  if (review) return { label: 'Review guidance', href: editHref(review.slug) };
  return null;
}

/**
 * Open component change requests per component name (waiting or in progress), from the request rows Studio reads
 * (scripts/requests.ts). Names match case-insensitively; a request for a component that does not exist yet (a new
 * component) counts under its own name and simply matches no row.
 */
export function openRequestCounts(rows: { component: string; status: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'requested' && r.status !== 'in-progress') continue;
    const key = r.component.trim().toLowerCase();
    if (key) out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** One audited product and the DS component instances `bridge audit` counted in it, by exported name. */
export interface ProductAudit {
  product: string;
  components: Record<string, number>;
}

/** One adoption audit run as the snapshot or the committed reports carry it, with its DS component counts. */
export interface AuditRun {
  id: string;
  label?: string | undefined;
  /** bridge.config.json product key the run audited (`bridge snapshot` writes it; older snapshots lack it). */
  product?: string | undefined;
  /** The audited folder, repo-relative ("apps/admin/src"). */
  target?: { path: string } | undefined;
  generatedAt: string;
  components: Record<string, number>;
}

/** A run of the code before the move to the design system ("admin-before", "..., original MUI source"): never usage. */
export const isBaselineRun = (run: Pick<AuditRun, 'id' | 'label'>): boolean => /(^|-)before$/i.test(run.id) || /\b(before|original)\b/i.test(run.label ?? '');

/**
 * The team product an audit run measured: its `product` key, else the product whose folder (products[].path) holds
 * the audited folder. Undefined for anything else (another app of the repository, the design system itself).
 */
export function productOfRun(products: readonly ProductConfig[], run: Pick<AuditRun, 'product' | 'target'>): ProductConfig | undefined {
  let hit: ProductConfig | undefined;
  if (run.product) hit = findProduct(products, run.product);
  else if (run.target?.path) {
    const place = productForPlace(products, { relPath: run.target.path });
    if (place.how === 'path') hit = place.product;
  }
  return hit && hit.key !== defaultProduct(products).key ? hit : undefined;
}

/**
 * The run that stands for each product of a team's bridge.config.json: its latest one. Runs before the move to the
 * design system never count; runs of anything that is not a listed product are dropped, and the Library (the design
 * system itself) is never a product it is used in. In `products` order; empty when no run maps to a product.
 */
export function latestProductRuns<R extends Omit<AuditRun, 'components'>>(products: readonly ProductConfig[], runs: readonly R[]): { product: ProductConfig; run: R }[] {
  const latest = new Map<string, R>();
  for (const run of runs) {
    if (isBaselineRun(run)) continue;
    const p = productOfRun(products, run);
    if (!p) continue;
    const prev = latest.get(p.key);
    if (!prev || run.generatedAt > prev.generatedAt) latest.set(p.key, run);
  }
  return products.flatMap((product) => {
    const run = latest.get(product.key);
    return run ? [{ product, run }] : [];
  });
}

/**
 * The "Used in" audits of a team: one per product, named as Bridge names it, from its latest run
 * (latestProductRuns). Empty when no run maps to a product: the column is then left out.
 */
export function productAudits(products: readonly ProductConfig[], runs: readonly AuditRun[]): ProductAudit[] {
  return latestProductRuns(products, runs).map(({ product, run }) => ({ product: product.name, components: run.components }));
}

/**
 * Where each component is used, from the committed `bridge audit` reports (one per product): instances per product,
 * parts included (TableHeader counts for Table, CardBody for Card: the longest component name that starts the part
 * name wins). Products with no instance are left out.
 */
export function productUsage(audits: ProductAudit[], names: string[]): Map<string, { product: string; instances: number }[]> {
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const owner = (part: string) => (names.includes(part) ? part : byLength.find((n) => part.startsWith(n) && /^[A-Z]/.test(part.slice(n.length))));
  const out = new Map<string, { product: string; instances: number }[]>();
  for (const a of audits) {
    const counts = new Map<string, number>();
    for (const [part, n] of Object.entries(a.components)) {
      const c = owner(part);
      if (c && n > 0) counts.set(c, (counts.get(c) ?? 0) + n);
    }
    for (const [c, n] of counts) (out.get(c) ?? out.set(c, []).get(c)!).push({ product: a.product, instances: n });
  }
  return out;
}

const words = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Admin demo", "Admin demo and Bridge itself", "Admin demo, Docs and Bridge itself". */
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// Variants and tones that shout: never the sample a thumbnail shows when a calmer sibling exists.
const LOUD = new Set(['danger', 'destructive', 'error', 'critical']);
// Wrappers that lay several samples side by side or stacked: the thumbnail keeps one of them.
const SETS = new Set(['Row', 'Stack', 'Inline']);

type Sample = string | { c: string; p?: Record<string, unknown>; children?: Sample[] };

const isLoud = (n: Sample) => typeof n !== 'string' && [n.p?.variant, n.p?.tone].some((v) => typeof v === 'string' && LOUD.has(v));
/** Calm first: an explicit secondary or neutral, then the default look, then the rest, loud last. */
const calmRank = (n: Sample) => {
  if (typeof n === 'string') return 3;
  if (isLoud(n)) return 9;
  const v = n.p?.variant ?? n.p?.tone;
  if (v === 'secondary' || v === 'neutral') return 0;
  return v === undefined ? 1 : 2;
};

/**
 * The one sample a list thumbnail renders, from the component's Library preview: a set of variants (a Row, Stack or
 * Inline of siblings) keeps its calmest member, so a row never leads with a red destructive button or three samples
 * squeezed to a smudge. A lone loud sample (AlertDialog's "Delete" trigger) is shown in the secondary look. The
 * drawer keeps the full preview.
 */
export function thumbnailNode<T extends Sample>(preview: T | undefined): T | undefined {
  if (!preview || typeof preview === 'string') return preview;
  const set: Exclude<Sample, string> = preview;
  const kids = set.children ?? [];
  if (!SETS.has(set.c) || !kids.length) return preview;
  const pick = [...kids].sort((a, b) => calmRank(a) - calmRank(b))[0]!;
  const calm =
    typeof pick !== 'string' && isLoud(pick) ? { ...pick, p: { ...pick.p, ...(pick.p?.variant ? { variant: 'secondary' } : { tone: 'neutral' }) } } : pick;
  return { ...set, children: [calm] } as T;
}

/** The list cell for "Used in": one tag per product, the first two named and "+N" for the rest; none when no
 *  audited product renders the component. */
export function usedInCell(used: { product: string }[] | undefined): string[] {
  if (!used?.length) return [];
  return used.length > 2 ? [used[0]!.product, `+${used.length - 1}`] : used.map((u) => u.product);
}

/** "Used in Art print shop (12 places)." from the team's products, or that no audited product renders it. */
export function usedInFact(usedIn: { product: string; instances: number }[]): string {
  return usedIn.length ? `Used in ${andList(usedIn.map((u) => `${u.product} (${words(u.instances, 'place')})`))}.` : 'Not found in an audited product.';
}

/**
 * The facts the drawer says in one line, in words (open requests are added in the browser, see requestFact). Guidance
 * that is missing or waits for a review is not repeated here: its pill says it.
 */
export function drawerFacts(input: {
  guidance: GuidanceState;
  tokens: number;
  /** Products from the audit reports; undefined when no report exists (nothing is said about usage). */
  usedIn?: { product: string; instances: number }[] | undefined;
}): string[] {
  const out: string[] = [];
  if (input.usedIn) out.push(usedInFact(input.usedIn));
  out.push(input.tokens ? `${words(input.tokens, 'token')}.` : 'No token.');
  if (input.guidance === 'ok') out.push('Usage guidance written.');
  return out;
}

/** Sent on document by the drawer's request form once a request is filed, with `{ component }`: the line counts it at once. */
export const REQUEST_SENT_EVENT = 'bridge:request-sent';

/** The open request part of the drawer line: null while reading, undefined when GitHub could not be read (silent). */
export function requestFact(n: number | null | undefined): string {
  if (n === null) return 'Reading open requests.';
  if (n === undefined) return '';
  return n ? `${words(n, 'open request')}.` : 'No open request.';
}

export type DrawerAction = 'docs' | 'change';

/**
 * The drawer's actions, one primary: the guidance while it is missing or waits for a review (the Library page is
 * incomplete until then), else "Change this component" (the designer drives the change: its tokens, an exploration
 * a developer builds with Claude, or a mismatch report). The other one follows as secondary.
 */
export function drawerActions(input: { guidance: GuidanceState }): { primary: DrawerAction; secondary: DrawerAction[] } {
  const primary: DrawerAction = input.guidance === 'ok' ? 'change' : 'docs';
  return { primary, secondary: primary === 'change' ? ['docs'] : ['change'] };
}
