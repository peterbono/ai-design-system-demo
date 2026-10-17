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
