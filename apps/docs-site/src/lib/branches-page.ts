// The Branches page (/studio/changes/), the rules and the words: all the work, not a second triage page. One
// segmented control says where the work stands (All, Waiting on me, each state, Archived), one select says whose it is
// (Everyone, You, each designer), another its kind; the rows are grouped by the product they belong
// to, and token branches can be checked to preview them
// together (lib/combine-changes holds the combination itself). What shipped has its own tab (Shipped: newest first,
// by month), the history of the work; the library's token changelog lives in the Library (Changelog). Pure: no DOM, no fetch. Unit tested in
// branches-page.test.ts; the page is components/ds/studio/BranchesList.tsx, fed by scripts/reviews.ts.
import { DEFAULT_PRODUCTS, productOfBranch, type ProductConfig } from '@bridge-ds/core';
import { MAX_TOGETHER } from './combine-changes';
import { STATUS_WORDS, VOCAB } from './vocabulary';

// ---------------------------------------------------------------------------------------------------------------
// The state tabs and the people filter

/**
 * The tabs of the page: where each change stands, in the words its tag shows. All (every open change, the default),
 * Waiting on me (the one rule of every surface, lib/waiting-on), then each state, Shipped (what was added to the
 * library or to a product, newest first: the history of the work), Archived last. Whose work it is
 * belongs to the people filter only (You, then each designer by name), so the tabs never mix people and states.
 * Being built has its own page (Studio > Being built): those rows stay under All.
 */
export type StateTab = 'all' | 'waiting' | 'not-started' | 'exploring' | 'draft' | 'review' | 'code' | 'shipped' | 'archived';

export const STATE_TABS: { value: StateTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'waiting', label: 'Waiting on me' },
  { value: 'not-started', label: 'Not started' },
  { value: 'exploring', label: 'Exploring' },
  { value: 'draft', label: STATUS_WORDS.draft },
  { value: 'review', label: STATUS_WORDS.inReview },
  { value: 'code', label: STATUS_WORDS.waitingShort },
  { value: 'shipped', label: 'Shipped' },
  { value: 'archived', label: 'Archived' },
];

const TAB_VALUES = new Set<string>(STATE_TABS.map((t) => t.value));

/** Tabs that stay even at 0, so people always know where to look. The others show only while they hold something. */
export const STABLE_TABS: readonly StateTab[] = ['all', 'waiting'];

/**
 * The state of a listed row, the tab it belongs to (null: All only). An exploration follows its tag ("Not started",
 * "Exploring", "Waiting for code"; not read yet: Exploring, as its page says while its files load); a branch follows
 * its lifecycle, a Figma branch waiting for a developer under Waiting for code.
 */
export function stateOf(r: { lifecycle: string; pill: { label: string } | null }): Exclude<StateTab, 'all' | 'waiting' | 'shipped' | 'archived'> | null {
  if (r.lifecycle === 'exploration') {
    const l = r.pill?.label ?? null;
    if (l === 'Not started') return 'not-started';
    if (l === null || l === 'Exploring') return 'exploring';
    if (l === STATUS_WORDS.waitingShort) return 'code';
    return null;
  }
  if (r.lifecycle === 'waiting') return 'code';
  if (r.lifecycle === 'draft') return r.pill?.label === 'Waiting for a developer' ? 'code' : 'draft';
  if (r.lifecycle === 'ready') return 'review';
  return null;
}

/** The tabs to show, from their counts: All and Waiting on me always, the others with something in them or picked. */
export function visibleTabs(counts: Partial<Record<StateTab, number>>, current: StateTab): { value: StateTab; label: string; count: number }[] {
  return STATE_TABS.map((t) => ({ ...t, count: counts[t.value] ?? 0 })).filter((t) => STABLE_TABS.includes(t.value) || t.count > 0 || t.value === current);
}

/** The people filter's value for the signed-in viewer (a key designerKey never makes: it strips "~"). */
export const YOU = '~you';

/** What the address holds: the tab, the kind and the person (null: everyone). */
export interface ChangesFilters {
  state: StateTab;
  kind: 'all' | 'product' | 'library' | 'docs';
  by: string | null;
}

/**
 * The filters the page opens on, from the address: ?state=, ?kind=, ?people= (a designer key, or "you"). Old links
 * keep working: ?who=waiting opens Waiting on me, ?who=mine and ?view=mine open on You, ?by= is the old people
 * parameter, ?archived=1 opens Archived, ?status=draft|ready|waiting the matching state, and the old merged line
 * (?status=merged|shipped|closed) and History (?view=history) open Shipped.
 */
export function changesFiltersParam(search: string): ChangesFilters {
  const q = new URLSearchParams(search);
  const k = q.get('kind');
  const kind = k === 'product' || k === 'library' || k === 'docs' ? k : 'all';
  const st = q.get('state');
  const status = q.get('status');
  const state: StateTab =
    st && TAB_VALUES.has(st)
      ? (st as StateTab)
      : q.get('who') === 'waiting'
        ? 'waiting'
        : q.get('archived') === '1'
          ? 'archived'
          : status === 'merged' || status === 'shipped' || status === 'closed' || q.get('view') === 'history'
            ? 'shipped'
            : status === 'draft'
            ? 'draft'
            : status === 'ready'
              ? 'review'
              : status === 'waiting'
                ? 'code'
                : 'all';
  const raw = (q.get('people') ?? q.get('by'))?.trim().toLowerCase() || null;
  const mine = q.get('who') === 'mine' || q.get('view') === 'mine';
  const by = raw === 'you' || (!raw && mine) ? YOU : raw && raw !== '~everyone' && raw !== 'everyone' ? raw : null;
  return { state, kind, by };
}

/** The address query for the filters, other parameters kept; the defaults (All, all kinds, everyone) leave it. */
export function withChangesFilters(search: string, f: ChangesFilters): string {
  const q = new URLSearchParams(search);
  for (const old of ['who', 'by', 'archived']) q.delete(old);
  if (q.get('view') === 'mine') q.delete('view');
  const status = q.get('status');
  if (status && ['draft', 'ready', 'waiting', 'merged', 'shipped', 'closed'].includes(status)) q.delete('status');
  if (f.state === 'all') q.delete('state');
  else q.set('state', f.state);
  if (f.kind === 'all') q.delete('kind');
  else q.set('kind', f.kind);
  if (f.by) q.set('people', f.by === YOU ? 'you' : f.by);
  else q.delete('people');
  const s = q.toString();
  return s ? `?${s}` : '';
}

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase());

const folded = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');

/**
 * Whether the person a row shows is the viewer (the people filter's You). The person is who asked for the change when
 * Bridge recorded it, else the author; Claude's own work is Claude's. An email contributor's own branches come from the
 * server's list (ownedBy), whatever GitHub names as the author.
 */
export function isYours(
  r: { author: string; agent?: boolean; mine?: boolean; requester?: { name: string | null; login: string | null } | null },
  viewer: string | null,
  viewerName?: string | null,
): boolean {
  if (!viewer) return false;
  if (r.mine !== undefined) return r.mine;
  if (r.requester?.login) return same(r.requester.login, viewer);
  if (r.requester?.name) return Boolean(viewerName && folded(viewerName) === folded(r.requester.name));
  if (r.agent) return false;
  return same(r.author, viewer);
}

/**
 * The people options: Everyone, then the viewer as You (always listed once signed in, even at 0), then the others by
 * display name. `options` is review-categories designerOptions over the rows, where the viewer's rows carry YOU.
 */
export function peopleOptions<O extends { value: string; label: string; count: number }>(options: readonly O[], signedIn: boolean): O[] {
  const [everyone, ...rest] = options;
  const you = rest.find((o) => o.value === YOU);
  const others = rest.filter((o) => o.value !== YOU);
  const youOpt = signedIn ? [{ ...(you ?? ({ value: YOU, count: 0 } as O)), label: 'You' }] : [];
  return [...(everyone ? [everyone] : []), ...youOpt, ...others];
}

/**
 * A display name for every login a row can show: who asked for a change is often written with a name on one row
 * ("Requested by Florian (@peterbono).") and as a login only on another; the viewer's own profile name counts too.
 * Keys are lower case logins.
 */
export function knownNames(rows: readonly { requester?: { name: string | null; login: string | null } | null }[], viewer?: { login: string; name?: string | null } | null): Map<string, string> {
  const m = new Map<string, string>();
  if (viewer?.login && viewer.name?.trim()) m.set(viewer.login.replace(/^@/, '').toLowerCase(), viewer.name.trim());
  for (const r of rows) {
    const q = r.requester;
    if (q?.login && q.name?.trim() && !m.has(q.login.toLowerCase())) m.set(q.login.toLowerCase(), q.name.trim());
  }
  return m;
}

/** The quiet line when a tab holds nothing, in designer words. */
export function emptyTabLine(tab: StateTab, signedIn: boolean): string {
  switch (tab) {
    case 'waiting':
      return signedIn ? 'Nothing waits on you. When someone asks for your review, it lands here.' : 'Sign in to see what waits on you.';
    case 'not-started':
      return 'Every exploration has started. New ones wait here until something is built in them.';
    case 'exploring':
      return 'Nothing is being explored right now. Start an exploration to try an idea on real screens.';
    case 'draft':
      return 'No draft. A change stays here until it is sent for review.';
    case 'review':
      return `No ${VOCAB.branch} in review.`;
    case 'code':
      return 'Nothing waits for code. Approved changes land here until a developer builds them.';
    case 'shipped':
      return 'Nothing shipped yet. Changes and explorations land here once they are in the library or in a product.';
    case 'archived':
      return 'No archived exploration.';
    default:
      return `No open ${VOCAB.branch}.`;
  }
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
// Shipped: the history of the work, newest first, by month

/** What was shipped: merged rows only (a branch closed without merging never reached anyone), newest first. */
export function shippedRows<R extends { merged_at?: string | null }>(rows: readonly R[]): R[] {
  const at = (r: R) => (r.merged_at ? new Date(r.merged_at).getTime() : NaN);
  return rows.filter((r) => !Number.isNaN(at(r))).sort((a, b) => at(b) - at(a));
}

/** "October 2026": the month heading of a shipped row, in the viewer's time zone (UTC when `utc`, for tests). */
export function shippedMonth(iso: string, utc = false): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', ...(utc ? { timeZone: 'UTC' } : {}) });
}

/** "Shipped Oct 30": when a row shipped, on its line. */
export function shippedOn(iso: string, utc = false): string {
  return `Shipped ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(utc ? { timeZone: 'UTC' } : {}) })}`;
}

export interface MonthGroup<R> {
  key: string;
  label: string;
  rows: R[];
}

/**
 * Shipped rows into one group per month, newest month first, newest row first in each. `at` reads when a row shipped
 * (default: its merged_at); rows that never shipped are left out.
 */
export function groupByMonth<R>(rows: readonly R[], at: (r: R) => string | null | undefined = (r) => (r as { merged_at?: string | null }).merged_at, utc = false): MonthGroup<R>[] {
  const groups: MonthGroup<R>[] = [];
  const dated = shippedRows(rows.map((r) => ({ r, merged_at: at(r) ?? null })));
  for (const { r, merged_at } of dated) {
    const label = shippedMonth(merged_at!, utc);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(r);
    else groups.push({ key: `m-${groups.length}`, label, rows: [r] });
  }
  return groups;
}

/**
 * Under the Shipped tab when the read was capped (one read gives the most recent `limit` finished ones): it shows
 * the most recent only. Null when everything was read.
 */
export function shippedCapLine(read: number, limit: number): string | null {
  return read >= limit ? 'Showing the most recent ones.' : null;
}

/** The line on the Archived tab: what an archived exploration still is. */
export const ARCHIVED_NOTE = 'Archived explorations stay out of the other tabs. Their previews still work.';

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
