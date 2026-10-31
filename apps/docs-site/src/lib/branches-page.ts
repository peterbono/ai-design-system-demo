// The Branches page (/studio/changes/), the rules and the words: all the work, not a second triage page. One
// segmented control says where the work stands (All, Waiting on me, each state, Archived), one select says whose it is
// (Everyone, You, each designer), another its kind; the rows are grouped by the product they belong
// to, and token branches can be checked to preview them
// together (lib/combine-changes holds the combination itself). What shipped has its own tab (Shipped: newest first,
// by month), the history of the work; the library's token changelog lives in the Library (Changelog). Pure: no DOM, no fetch. Unit tested in
// branches-page.test.ts; the page is components/ds/studio/BranchesList.tsx, fed by scripts/reviews.ts.
import { DEFAULT_PRODUCTS, isToolingPull, productOfBranch, type ProductConfig, type ToolingConfig } from '@bridge-ds/core';
import { MAX_TOGETHER } from './combine-changes';
import { VOCAB } from './vocabulary';
import { LIFECYCLE_LABEL, type LifecycleStage } from './review-state';

// ---------------------------------------------------------------------------------------------------------------
// The state tabs and the people filter

/**
 * The tabs of the page: the one lifecycle of every Studio page (lib/review-state), in the words its tags show. All
 * (every open change, the default), Waiting on me (the one rule of every surface, lib/waiting-on, and the reviews
 * asked of the viewer), then Exploring, Waiting for code, Being built, In review, Shipped (what was added to the
 * library or to a product, newest first: the history of the work), Archived last. Whose work it is belongs to the
 * people filter only (You, then each designer by name), so the tabs never mix people and states.
 */
export type StateTab = 'all' | 'waiting' | 'exploring' | 'code' | 'building' | 'review' | 'shipped' | 'archived';

/** The lifecycle tabs a listed open row can sit in. */
export type StageTab = 'exploring' | 'code' | 'building' | 'review';

export const STATE_TABS: { value: StateTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'waiting', label: 'Waiting on me' },
  { value: 'exploring', label: LIFECYCLE_LABEL.exploring },
  { value: 'code', label: LIFECYCLE_LABEL['waiting-for-code'] },
  { value: 'building', label: LIFECYCLE_LABEL['being-built'] },
  { value: 'review', label: LIFECYCLE_LABEL['in-review'] },
  { value: 'shipped', label: LIFECYCLE_LABEL.shipped },
  { value: 'archived', label: LIFECYCLE_LABEL.archived },
];

const TAB_VALUES = new Set<string>(STATE_TABS.map((t) => t.value));

/** Every tab stays, even at 0, so the lifecycle stays readable and people always know where to look. */
export const STABLE_TABS: readonly StateTab[] = STATE_TABS.map((t) => t.value);

const STAGE_TAB: Partial<Record<LifecycleStage, StageTab>> = { exploring: 'exploring', 'waiting-for-code': 'code', 'being-built': 'building', 'in-review': 'review' };
const LABEL_TAB: Record<string, StageTab> = {
  'Not started': 'exploring',
  [LIFECYCLE_LABEL.exploring]: 'exploring',
  [LIFECYCLE_LABEL['waiting-for-code']]: 'code',
  [LIFECYCLE_LABEL['being-built']]: 'building',
  [LIFECYCLE_LABEL['in-review']]: 'review',
};

/**
 * The lifecycle tab of a listed row (null: All only). An exploration follows its stage once read (lib/review-state),
 * else its tag ("Not started" and "Exploring" are both Exploring; not read yet: Exploring, as its page says while its
 * files load); a branch follows its lifecycle: a draft is Being built, a Figma branch waiting for a developer is
 * Waiting for code, a branch sent for review is In review.
 */
export function stateOf(r: { lifecycle: string; pill: { label: string } | null; stage?: LifecycleStage | null }): StageTab | null {
  if (r.lifecycle === 'exploration') {
    if (r.stage) return STAGE_TAB[r.stage] ?? null;
    const l = r.pill?.label ?? null;
    return l === null ? 'exploring' : (LABEL_TAB[l] ?? null);
  }
  if (r.lifecycle === 'waiting') return 'code';
  if (r.lifecycle === 'draft') return r.pill?.label === LIFECYCLE_LABEL['waiting-for-code'] || r.pill?.label === 'Waiting for a developer' ? 'code' : 'building';
  if (r.lifecycle === 'ready') return 'review';
  return null;
}

/** The tabs with their counts: every one of them, in the lifecycle's order. */
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
  // The tabs before the one lifecycle: Not started is Exploring now, Draft is Being built.
  const renamed = st === 'not-started' ? 'exploring' : st === 'draft' ? 'building' : st;
  const state: StateTab =
    renamed && TAB_VALUES.has(renamed)
      ? (renamed as StateTab)
      : q.get('who') === 'waiting'
        ? 'waiting'
        : q.get('archived') === '1'
          ? 'archived'
          : status === 'merged' || status === 'shipped' || status === 'closed' || q.get('view') === 'history'
            ? 'shipped'
            : status === 'draft'
            ? 'building'
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
    case 'exploring':
      return 'Nothing is being explored right now. Start an exploration to try an idea on real screens.';
    case 'code':
      return 'Nothing waits for code. An exploration lands here when you say Done exploring, until a developer picks it up.';
    case 'building':
      return 'Nothing is being built right now. Work lands here once developers start on it.';
    case 'review':
      return `No ${VOCAB.branch} in review. Work lands here when developers ask for a review.`;
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
// Bridge's own work: out of the list

/**
 * The rows designers see: pull requests that only change the tool around the design system (bridge.config.json
 * `tooling`, core isToolingPull: Studio, the core, the CLI in Bridge's own repository) stay out of every tab, count and
 * filter, as the release card keeps "Bridge tool updates" apart. The changed files decide once read (`files`), the
 * title's scope before. Explorations and product repositories' rows always stay. No `tooling` (a team's DS
 * repository): every row stays.
 */
export function designRows<R extends { opens: 'pr' | 'exploration'; rawTitle?: string | null; title: string; head: { ref: string }; labels?: { name: string }[] | null; product?: string | null }>(
  rows: readonly R[],
  files: (r: R) => readonly string[] | null | undefined,
  tooling: ToolingConfig | null | undefined,
  neverPrefixes: readonly string[] = [],
): R[] {
  if (!tooling?.paths.length && !tooling?.scopes?.length) return [...rows];
  return rows.filter((r) => r.opens === 'exploration' || Boolean(r.product) || !isToolingPull({ title: r.rawTitle ?? r.title, headRef: r.head.ref, labels: r.labels ?? null, files: files(r) ?? null }, tooling, neverPrefixes));
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
