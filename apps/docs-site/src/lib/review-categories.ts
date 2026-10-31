// What waits on the viewer, sorted the way a design system lead reads it (Branches > Waiting on me): three kinds of
// change, then who asked. Pure: no DOM, no fetch. Unit tested in review-categories.test.ts; the page is
// components/ds/studio/BranchesList.tsx.
//
// The three kinds, from what the change touches:
//   - In a product: a component changed inside a product that uses the library (a `product: <key>` label, or changed
//     files under a configured product's folder, core productOfBranch).
//   - Library components and tokens: a component or a token changed in the library itself; it can reach every
//     product that uses the library.
//   - Documentation: usage guidance and docs only (a `docs` label, a docs/ branch, or only guidance files changed).
// Claude AI opens many of these for someone (the MCP server, a request): the designer is the requester Bridge
// records in the body ("Requested by Ann Leroy."), else the author.
import { defaultProduct, productOfBranch, type ProductConfig, type SuggestionKind } from '@bridge-ds/core';
import type { FileSignals } from './work-nature';
import type { NeedRow } from './home-model';

export type ReviewCategory = 'product' | 'library' | 'docs';

/** The headings, in page order: what a product changes first, the shared library next, the words last. */
export const REVIEW_CATEGORIES: { value: ReviewCategory; label: string }[] = [
  { value: 'product', label: 'In a product' },
  { value: 'library', label: 'Library components and tokens' },
  { value: 'docs', label: 'Documentation' },
];

export const categoryLabel = (c: ReviewCategory): string => REVIEW_CATEGORIES.find((x) => x.value === c)!.label;

/** Files that never decide the kind: release notes, exploration notes, review drafts. */
const NEUTRAL = /^\.changeset\/|^\.bridge\/explorations\/|^docs\/pr-drafts\//;
/** Documentation files: a component's usage guidance (Name.docs.json) or a Markdown page. */
const DOC_FILE = /(^|\/)[A-Z]\w*\.docs\.json$|\.mdx?$/i;

const labelNames = (labels: readonly (string | { name: string })[] | null | undefined) => (labels ?? []).map((l) => (typeof l === 'string' ? l : l.name).trim().toLowerCase());

export interface CategoryFacts {
  /** Changed files, when read. */
  files?: readonly string[] | null;
  labels?: readonly (string | { name: string })[] | null;
  /** The branch name ("docs/slider-..."). */
  headRef?: string | null;
  /** What the status read says about the files, when the files themselves are not read. */
  signals?: Pick<FileSignals, 'tokens' | 'guidance' | 'visual'> | null;
  /** The status read says only usage guidance changed. */
  guidanceOnly?: boolean;
  /** A suggestion's kind (core suggestionKindFromLabels), for suggestions. */
  suggestionKind?: SuggestionKind | null;
}

/** Whether a change is documentation only. */
function docsOnly(x: CategoryFacts): boolean {
  if (x.suggestionKind === 'docs') return true;
  if (x.suggestionKind) return false;
  if (x.guidanceOnly) return true;
  const labels = labelNames(x.labels);
  if (labels.includes('docs') || labels.includes('suggestion: docs')) return true;
  if (/^docs\//.test(x.headRef ?? '')) return true;
  const real = (x.files ?? []).filter((f) => !NEUTRAL.test(f));
  if (x.files && real.length > 0) return real.every((f) => DOC_FILE.test(f));
  const s = x.signals;
  return Boolean(s && s.guidance && !s.tokens && !s.visual);
}

/**
 * The kind of a change and, in a product, which one. A product label or a product folder wins (a product screen
 * that also edits its docs is still product work); then documentation only; everything else is the library.
 */
export function categoryOf(x: CategoryFacts, products: readonly ProductConfig[]): { category: ReviewCategory; product: ProductConfig | null } {
  const p = productOfBranch(products, { files: x.files ?? null, labels: x.labels ?? null });
  if (p.key !== defaultProduct(products).key) return { category: 'product', product: p };
  return { category: docsOnly(x) ? 'docs' : 'library', product: null };
}

/**
 * The products a library change can reach: every configured product but the library itself. Empty when the team
 * lists none (then the heading names no product rather than guessing).
 */
export function productsUsingLibrary(products: readonly ProductConfig[]): ProductConfig[] {
  const lib = defaultProduct(products);
  return products.filter((p) => p.key !== lib.key);
}

/** The muted line under the library heading: "Can reach Account app." / "Can reach Admin demo and Account app." */
export function reachLine(products: readonly ProductConfig[]): string | null {
  const names = productsUsingLibrary(products).map((p) => p.name);
  if (!names.length) return null;
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Can reach ${list}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Filters: the kind and the designer, kept in the address (?kind=library&by=ann-leroy)

export type KindFilter = ReviewCategory | 'all';

export interface QueueFilters {
  kind: KindFilter;
  /** A designer key (designerKey), or null for everyone. */
  by: string | null;
}

export function queueFiltersParam(search: string): QueueFilters {
  const q = new URLSearchParams(search);
  const k = q.get('kind');
  const raw = q.get('by')?.trim().toLowerCase() || null;
  const by = raw && raw !== EVERYONE ? raw : null;
  return { kind: k === 'product' || k === 'library' || k === 'docs' ? k : 'all', by };
}

/** The address query for the filters, other parameters kept: "all" and everyone leave the address. */
export function withQueueFilters(search: string, f: QueueFilters): string {
  const q = new URLSearchParams(search);
  if (f.kind === 'all') q.delete('kind');
  else q.set('kind', f.kind);
  if (f.by) q.set('by', f.by);
  else q.delete('by');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** A stable key for a designer, from a login (a persona's "~ann-leroy" too) or else a name: "ann-leroy", "annleroy". */
export function designerKey(who: { login?: string | null; name?: string | null }): string {
  const raw = who.login || who.name || '';
  return raw
    .replace(/^[~@]/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

export interface QueueItem {
  category: ReviewCategory;
  designer: { key: string; name: string };
}

export const passes = (x: QueueItem, f: QueueFilters): boolean => (f.kind === 'all' || x.category === f.kind) && (!f.by || x.designer.key === f.by);

/** The kind options with their counts (over what the designer filter keeps), every kind listed even at 0. */
export function kindOptions(items: readonly QueueItem[], by: string | null): { value: KindFilter; label: string; count: number }[] {
  const kept = items.filter((x) => !by || x.designer.key === by);
  return [
    { value: 'all' as const, label: 'All kinds', count: kept.length },
    ...REVIEW_CATEGORIES.map((c) => ({ value: c.value, label: c.label, count: kept.filter((x) => x.category === c.value).length })),
  ];
}

/** The designer option that keeps everyone (a key designerKey never makes: it strips "~"). */
export const EVERYONE = '~everyone';

/**
 * The designers who wait, by name, with their counts (over what the kind filter, and `keep` when given, keep).
 * Everyone first.
 */
export function designerOptions<I extends QueueItem>(items: readonly I[], kind: KindFilter, keep?: (x: I) => boolean): { value: string; label: string; count: number }[] {
  const kept = items.filter((x) => (kind === 'all' || x.category === kind) && (!keep || keep(x)));
  const by = new Map<string, { name: string; count: number }>();
  for (const x of items) if (!by.has(x.designer.key)) by.set(x.designer.key, { name: x.designer.name, count: 0 });
  for (const x of kept) by.get(x.designer.key)!.count++;
  const people = [...by.entries()].map(([value, v]) => ({ value, label: v.name, count: v.count })).sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: EVERYONE, label: 'Everyone', count: kept.length }, ...people];
}

export interface CategoryGroup<R> {
  key: ReviewCategory;
  label: string;
  rows: R[];
}

/** Items into the three kinds, in page order, keeping their order inside each. Every kind is returned, even empty. */
export function groupByCategory<R extends { category: ReviewCategory }>(rows: readonly R[]): CategoryGroup<R>[] {
  return REVIEW_CATEGORIES.map((c) => ({ key: c.value, label: c.label, rows: rows.filter((r) => r.category === c.value) }));
}

/** The summary sentence over the groups: "15 changes wait on you." / "3 of 15 changes, filtered." */
export function queueSummary(shown: number, total: number, filtered: boolean): string {
  const word = (n: number) => (n === 1 ? 'change' : 'changes');
  if (!filtered) return total === 0 ? 'Nothing waits on you.' : `${total} ${word(total)} ${total === 1 ? 'waits' : 'wait'} on you.`;
  return `${shown} of ${total} ${word(total)}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// What waits besides branches

/** A suggestion or a usage guidance draft that waits on the viewer, as a row of Waiting on me. */
export interface WaitingExtra {
  /** The row as Home words it (the asker, the title, where it opens). */
  need: NeedRow;
  category: ReviewCategory;
  /** The product, for a change in a product. */
  product?: ProductConfig | null;
  /** The suggestion number: the row opens it in place. */
  suggestion?: number | null;
}

/** A suggestion as a Waiting on me row: its kind and product from its labels. */
export function suggestionExtra(need: NeedRow, number: number, labels: readonly string[], products: readonly ProductConfig[]): WaitingExtra {
  const kind = labels.map((l) => /^suggestion: (.+)$/.exec(l.trim().toLowerCase())?.[1]).find((k): k is SuggestionKind => k === 'docs' || k === 'token-change' || k === 'component-spec' || k === 'brand' || k === 'revert' || k === 'config');
  const c = categoryOf({ labels, suggestionKind: kind ?? null }, products);
  return { need, category: c.category, product: c.product, suggestion: number };
}

/** A usage guidance draft waiting for review (Claude AI drafted it from the code): documentation. */
export const guidanceExtra = (need: NeedRow): WaitingExtra => ({ need, category: 'docs' });
