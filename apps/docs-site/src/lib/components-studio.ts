// Studio Components: the sentence under the title and the one primary action, from the components' status and
// guidance state. Pure, tested in components-studio.test.ts.
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
