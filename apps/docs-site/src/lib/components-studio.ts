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

/** The list cell for "Used in": product names in words, empty when no audited product renders the component. */
export function usedInCell(used: { product: string }[] | undefined): string {
  if (!used?.length) return '';
  return used.length > 2 ? words(used.length, 'product') : andList(used.map((u) => u.product));
}

/** Where a component's tokens come from, in a sentence: "1 token of its own and 39 from Button." */
export function tokenOrigin(own: number, inherited: { from: string; paths: string[] }[]): string {
  const via = inherited.filter((i) => i.paths.length);
  if (!via.length) return own ? `${words(own, 'token')}, all its own.` : 'No token.';
  const ownPart = own ? `${words(own, 'token')} of its own` : 'No token of its own';
  return `${ownPart} and ${andList(via.map((i) => `${i.paths.length} from ${i.from}`))}.`;
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
  if (input.usedIn) {
    out.push(
      input.usedIn.length ? `Used in ${andList(input.usedIn.map((u) => `${u.product} (${words(u.instances, 'place')})`))}.` : 'Not found in an audited product.',
    );
  }
  out.push(input.tokens ? `${words(input.tokens, 'token')}.` : 'No token.');
  if (input.guidance === 'ok') out.push('Usage guidance written.');
  return out;
}

/** The open request part of the drawer line: null while reading, undefined when GitHub could not be read (silent). */
export function requestFact(n: number | null | undefined): string {
  if (n === null) return 'Reading open requests.';
  if (n === undefined) return '';
  return n ? `${words(n, 'open request')}.` : 'No open request.';
}

export type DrawerAction = 'docs' | 'tokens' | 'request';

/**
 * The drawer's actions, one primary: the guidance while it is missing or waits for a review (the Library page is
 * incomplete until then), else the tokens (the change a designer makes herself), else the docs (a layout component
 * paints with no token). The others follow as secondary, the request always last and never primary: a developer
 * builds it.
 */
export function drawerActions(input: { guidance: GuidanceState; hasTokens: boolean }): { primary: DrawerAction; secondary: DrawerAction[] } {
  const available = (['docs', 'tokens', 'request'] as DrawerAction[]).filter((a) => a !== 'tokens' || input.hasTokens);
  const primary: DrawerAction = input.guidance === 'ok' && input.hasTokens ? 'tokens' : 'docs';
  return { primary, secondary: available.filter((a) => a !== primary) };
}
