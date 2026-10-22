// The Branches page (/studio/changes/), the rules and the words: all the work, not a second triage page. One
// segmented control says whose work shows (Mine, Waiting on me, All), the rows are grouped by the product they belong
// to, merged and closed branches stay behind one muted line, and token branches can be checked to preview them
// together (lib/combine-changes holds the combination itself). Pure: no DOM, no fetch. Unit tested in
// branches-page.test.ts; the page is components/ds/studio/BranchesList.tsx, fed by scripts/reviews.ts.
import { DEFAULT_PRODUCTS, productOfBranch, type ProductConfig } from '@bridge-ds/core';
import { MAX_TOGETHER } from './combine-changes';
import type { Lifecycle } from './change-status';
import { VOCAB } from './vocabulary';

// ---------------------------------------------------------------------------------------------------------------
// Whose work

export type WhoFilter = 'mine' | 'waiting' | 'all';

export const WHO_FILTERS: { value: WhoFilter; label: string }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'waiting', label: 'Waiting on me' },
  { value: 'all', label: 'All' },
];

/**
 * The filter the page opens on: the address first (?who=mine), else All. All is the default on purpose: this page is
 * all the work (triage lives on Home and the review queue), and the rows never jump under the viewer once the
 * statuses that would decide "waits on me" finish loading.
 */
export function whoFilterParam(search: string): WhoFilter {
  const v = new URLSearchParams(search).get('who');
  return v === 'mine' || v === 'waiting' ? v : 'all';
}

export interface WhoFacts {
  author: string;
  /** The status read says the next step is the viewer's (scripts/pr-status rowWho yourTurn). */
  yourTurn: boolean;
  /** The viewer made it, when the page knows it otherwise than by the author (an email contributor's own, ownedBy). */
  mine?: boolean;
}

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase());

/** Whether a row shows under the filter. Signed out, Mine and Waiting on me hold nothing. */
export function showsForWho(filter: WhoFilter, row: WhoFacts, viewer: string | null): boolean {
  if (filter === 'all') return true;
  if (!viewer) return false;
  return filter === 'mine' ? (row.mine ?? same(row.author, viewer)) : row.yourTurn;
}

/**
 * What an email contributor made: GitHub names Bridge's app as the author, so their own branches are the ones the
 * server lists as theirs (contribute-session contributeMine: branch names and pull request numbers), or the ones
 * already written as theirs (author = their email).
 */
export function ownedBy(row: { author: string; number: number; headRef?: string | null }, viewer: string | null, mine: { branches: string[]; issues: number[] } | null): boolean {
  if (same(row.author, viewer)) return true;
  if (!mine) return false;
  return mine.issues.includes(row.number) || Boolean(row.headRef && mine.branches.includes(row.headRef));
}

/**
 * Waiting on me for an email contributor: they approve nothing, so only their own branches a reviewer sent back with
 * changes to make wait on them.
 */
export const contributorTurn = (row: { own: boolean; changesRequested?: string[] | null; open: boolean }): boolean => row.own && row.open && Boolean(row.changesRequested?.length);

/** The quiet line when the filter leaves nothing. */
export function emptyWhoLine(filter: WhoFilter, signedIn: boolean): string {
  if (filter !== 'all' && !signedIn) return `Sign in to see your ${VOCAB.branches}.`;
  if (filter === 'mine') return `You have no open ${VOCAB.branch}.`;
  if (filter === 'waiting') return `No ${VOCAB.branch} waits on you.`;
  return `No open ${VOCAB.branch}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Groups: the product a branch belongs to

/** A product key from bridge.config.json `products` ("admin", "library", or any configured key). */
export type ProductKey = string;

/** Group headings of the default products, in page order: a product first, the library after. */
export const PRODUCTS: { key: ProductKey; label: string }[] = headingsOf(DEFAULT_PRODUCTS);

/** Group headings of a product list, in its order. */
export function headingsOf(products: readonly ProductConfig[]): { key: ProductKey; label: string }[] {
  return products.map((p) => ({ key: p.key, label: p.name }));
}

/**
 * The product a branch belongs to (core productOfBranch): a `product: <key>` label wins, else the first product whose
 * folder holds a changed file (apps/admin for the Admin demo), else the default product, the library (files not read
 * yet included, since every branch of this repository starts from the library).
 */
export function productOf(
  files: readonly string[] | null | undefined,
  products: readonly ProductConfig[] = DEFAULT_PRODUCTS,
  labels?: readonly (string | { name: string })[] | null,
): ProductKey {
  return productOfBranch(products, { files: files ?? null, labels: labels ?? null }).key;
}

export interface Group<R> {
  key: ProductKey;
  label: string;
  rows: R[];
}

/** Rows into product groups, in the products' order, keeping row order inside each group; empty groups are left out. */
export function groupByProduct<R extends { product: ProductKey }>(rows: R[], products: readonly ProductConfig[] = DEFAULT_PRODUCTS): Group<R>[] {
  return headingsOf(products)
    .map((p) => ({ key: p.key, label: p.label, rows: rows.filter((r) => r.product === p.key) }))
    .filter((g) => g.rows.length > 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Finished branches: hidden behind one line

/** How the address asks for finished or one-status lists (the old status filter's ?status= links keep working). */
export type FinishedView = { finished: boolean; only: Exclude<Lifecycle, 'shipped' | 'closed'> | null };

export function finishedParam(search: string): FinishedView {
  const v = new URLSearchParams(search).get('status');
  if (v === 'merged' || v === 'shipped' || v === 'closed') return { finished: true, only: null };
  if (v === 'draft' || v === 'ready' || v === 'waiting') return { finished: false, only: v };
  return { finished: false, only: null };
}

/** Merged since the first day of the viewer's current month. */
export function mergedThisMonth(rows: { merged_at?: string | null }[], now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return rows.filter((r) => r.merged_at && new Date(r.merged_at).getTime() >= start).length;
}

/**
 * "12 merged this month." The closed list GitHub gives is the most recent `limit` only: when every one of them merged
 * this month the count is a floor, and the line says so.
 */
export function mergedLine(count: number, read: number, limit: number): string {
  if (count === 0) return `Nothing merged this month.`;
  return `${count >= limit && read >= limit ? `${count}+` : count} merged this month.`;
}

/** The muted line under a one-status list ("Showing drafts only."). */
export function onlyLine(only: FinishedView['only']): string | null {
  if (only === 'draft') return 'Showing drafts only.';
  if (only === 'ready') return `Showing ${VOCAB.branches} in review only.`;
  if (only === 'waiting') return `Showing ${VOCAB.branches} waiting for code only.`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Selection: preview token branches together

/** Only token branches combine here (code would need a real combined build). Unknown files: not selectable yet. */
export const selectable = (r: { tokenOnly: boolean | null }) => r.tokenOnly === true;

/** A checkbox is disabled once the selection is full, unless it is one of the checked ones. */
export const boxDisabled = (selected: readonly number[], n: number) => selected.length >= MAX_TOGETHER && !selected.includes(n);

export const FULL_TIP = `Up to ${MAX_TOGETHER} ${VOCAB.branches} at a time. Uncheck one to pick this one.`;

export interface BarCopy {
  title: string;
  hint: string | null;
  /** 1 checked: open it alone. 2 to 4: preview them together. */
  action: 'alone' | 'together';
  label: string;
}

/** What the floating bar says and offers for a selection of `n` (null: no bar). */
export function barCopy(n: number): BarCopy | null {
  if (n <= 0) return null;
  if (n === 1) {
    const more = MAX_TOGETHER - 1;
    return { title: `1 ${VOCAB.branch} selected`, hint: `Select up to ${more} more to preview them together`, action: 'alone', label: 'Try it alone' };
  }
  return { title: `${n} ${VOCAB.branches} selected`, hint: null, action: 'together', label: 'Preview together' };
}

// ---------------------------------------------------------------------------------------------------------------
// The kind and designer filters: one bar on every tab

/** The designer filter shows on Waiting on me and All; Mine is the viewer's own work, so it has none. */
export const showsDesignerFilter = (filter: WhoFilter): boolean => filter !== 'mine';

/**
 * The filters a tab applies, from the ones picked (kept across tabs): the kind always, the designer where the tab
 * shows it and only while someone listed matches it (an address naming nobody listed keeps everyone).
 */
export function tabFilters<F extends { kind: string; by: string | null }>(filter: WhoFilter, picked: F, designers: readonly string[]): F {
  const by = showsDesignerFilter(filter) && picked.by && designers.includes(picked.by) ? picked.by : null;
  return { ...picked, by };
}
