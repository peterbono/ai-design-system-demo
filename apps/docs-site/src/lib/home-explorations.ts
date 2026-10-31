// The explorations of the Studio home (components/ds/studio/StudioHome.tsx, "Explorations", or "Your explorations" for
// a contributor): what the product
// promises ("Explore with AI. Keep what works in your design system."), shown as work, not as a list of branches.
// An exploration is a product screen tried with Claude AI: a pull request that is or was an exploration (core
// isExplorationPull: the `exploration` label, an `explore/*` branch or the Bridge block), or a branch started for a
// product ("product: account", any product but the library). Library changes (a token, a component, guidance) are
// not explorations: they live on Changes, in the review queue for reviewers, and in "Your changes" for their author.
//
// Each card shows the explored screen (a capture, never a generic icon when one exists), the title, the product, who
// explores it and where it stands in designer words: "Exploring", "2 new pieces found", "In review", "Kept in the
// library". Pure: no DOM, no fetch. Unit tested in home-explorations.test.ts.
import { defaultProduct, EXPLORATION_STATUS_LABEL, explorationStateLabel, explorationStatus, findProduct, isActiveExploration, isArchivedExploration, isExplorationPull, isHandedOff, parseExplorationBody, parsePiecesRecord, PRODUCT_LABEL_PREFIX, requesterOf, type ProductConfig } from '@bridge-ds/core';
import { oneLineTitle } from './markdown';
import { humanTitle } from './pr-title';
import { studioHref } from './team-path';
import type { Person } from './home-model';
import type { ThumbSpec } from './branch-thumb';
import { changedScreenOf, explorationTag, type TagTone } from './exploration-page';
import { LIFECYCLE_LABEL } from './review-state';
import { changesSummary } from './page-summary';

/** The fields of an open (or closed) pull request the home reads. */
export interface ExplorationPull {
  number: number;
  title: string;
  body?: string | null;
  draft?: boolean;
  state?: string;
  merged_at?: string | null;
  labels?: ({ name?: string } | string)[] | null;
  head?: { ref: string; sha?: string };
  user: { login: string; avatar_url?: string; type?: string } | null;
  updated_at: string;
  /** Read in a product's own repository (bridge.config.json products[].repo): that product's key. */
  product?: string;
}

/** Where an exploration stands. */
export type ExplorationStage = 'exploring' | 'found' | 'with-devs' | 'in-review' | 'kept';

export interface ExplorationCard {
  number: number;
  /** "12", or "shop#12" for an exploration in the shop's own repository: the card's one key. */
  key?: string;
  title: string;
  /** The exploration page (the product branch page for a product), or the change page once it is a plain change. */
  href: string;
  /** "Account": the product it was tried in, when it names one. */
  product: string | null;
  /** The key of the product it belongs to (bridge.config.json products), the library's for a library exploration. */
  productKey?: string;
  /** Who explores it: the person who asked, before the account (often Claude AI) that opened it. */
  author: Person;
  stage: ExplorationStage;
  /** The stage in designer words: "Exploring", "2 new pieces found", "In review", "Kept in the library". */
  state: string;
  /** The DS tag of the state: the same tone as the exploration page's title row. */
  tone?: TagTone;
  /** A dot before the word (a state that moves: Exploring, Being built). */
  dot?: boolean;
  updated: string;
  /** The explored screen ({ kind: 'screen' }), or its sketch while no capture exists. */
  preview: ThumbSpec;
  /** The viewer's own (isOwnExploration): a contributor's home shows only these. */
  own: boolean;
}

const labelNames = (p: Pick<ExplorationPull, 'labels'>) => (p.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase());

/** The product a "product: account" label names, any product but the library: its configured name, else the key in words. */
export function explorationProduct(p: Pick<ExplorationPull, 'labels'> & { product?: string | undefined }, products: readonly ProductConfig[]): string | null {
  const lib = defaultProduct(products);
  // Read in the product's own repository: that product, whatever its labels say.
  if (p.product) return findProduct(products, p.product)?.name ?? p.product.charAt(0).toUpperCase() + p.product.slice(1);
  for (const l of labelNames(p)) {
    if (!l.toLowerCase().startsWith(PRODUCT_LABEL_PREFIX)) continue;
    const key = l.slice(PRODUCT_LABEL_PREFIX.length).trim();
    if (!key) continue;
    const hit = findProduct(products, key);
    if (hit) {
      if (hit.key === lib.key) continue;
      return hit.name;
    }
    if (key.toLowerCase() === lib.key.toLowerCase() || key.toLowerCase() === 'library') continue;
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  return null;
}

/**
 * The key of the product an exploration belongs to: the product repository it was read in, else its "product: <key>"
 * label, else the default product (the library). Lower case; a label naming no configured product keeps its key.
 */
export function explorationProductKey(p: Pick<ExplorationPull, 'labels'> & { product?: string | undefined }, products: readonly ProductConfig[]): string {
  const lib = defaultProduct(products);
  if (p.product) return p.product.toLowerCase();
  for (const l of labelNames(p)) {
    if (!l.toLowerCase().startsWith(PRODUCT_LABEL_PREFIX)) continue;
    const key = l.slice(PRODUCT_LABEL_PREFIX.length).trim();
    if (!key) continue;
    return (findProduct(products, key)?.key ?? key).toLowerCase();
  }
  return lib.key.toLowerCase();
}

/** An exploration, or a branch started for a product: what the home's section shows. Library changes are not. */
export function isHomeExploration(p: ExplorationPull, products: readonly ProductConfig[]): boolean {
  if (p.user?.type === 'Bot') return false;
  // A product repository's other branches are not Bridge's: only its explorations.
  if (p.product) return isExplorationPull({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body });
  return isExplorationPull({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body }) || explorationProduct(p, products) !== null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Where it stands, in designer words. Merged: kept in the library. Still being tried (a draft, or the exploration label
 * on): exploring, or "2 new pieces found" once Bridge found pieces the library does not have. Done exploring and
 * still a draft: with the developers ("Waiting for code", then "Being built"), shipped once merged. Otherwise: in review.
 */
export function explorationStage(
  p: Pick<ExplorationPull, 'draft' | 'state' | 'merged_at' | 'labels' | 'body'> & { head?: { ref: string; sha?: string } | undefined },
  /**
   * The changed files of a running exploration, when the caller reads them: then it says what its page says, "Not
   * started" (only Bridge notes changed) or "Exploring", and nothing while they are read (undefined). Omitted: "Exploring".
   */
  files?: () => readonly string[] | null | undefined,
): { stage: ExplorationStage; state: string } {
  // Done exploring is read from the body first (core explorationStatus): a label that could not be removed does not
  // make a handed-off exploration read as running again.
  const handed = isHandedOff({ labels: p.labels ?? [], body: p.body }) && explorationStatus({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body, headSha: p.head?.sha, draft: p.draft }) !== 'active';
  if (p.merged_at || p.state === 'merged') return { stage: 'kept', state: handed ? EXPLORATION_STATUS_LABEL.shipped : 'Kept in the library' };
  if (handed && p.draft !== false) {
    const s = explorationStatus({ state: p.state ?? 'open', labels: p.labels ?? [], body: p.body, headSha: p.head?.sha, draft: p.draft });
    return { stage: 'with-devs', state: EXPLORATION_STATUS_LABEL[s] };
  }
  if (p.draft || isActiveExploration(p.labels ?? [])) {
    const pieces = parsePiecesRecord(p.body)?.pieces.length ?? 0;
    if (pieces) return { stage: 'found', state: `${plural(pieces, 'new piece', 'new pieces')} found` };
    const status = explorationStatus({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body, headSha: p.head?.sha, draft: p.draft });
    if (files && status === 'active') return { stage: 'exploring', state: explorationStateLabel({ status, files: files() }) ?? '' };
    return { stage: 'exploring', state: 'Exploring' };
  }
  return { stage: 'in-review', state: 'In review' };
}

/** Its name: the exploration block's ("Profile page"), else the pull request title for people. */
export function explorationTitle(p: Pick<ExplorationPull, 'title' | 'body'>): string {
  const name = parseExplorationBody(p.body)?.name?.trim();
  if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  return oneLineTitle(humanTitle(p.title));
}

/** Where its card opens: the exploration (or product branch) page while it is one, the change page once kept or a plain change. */
export function explorationHref(p: ExplorationPull): string {
  // In a product's own repository it is always the exploration page: Studio reviews no branch there.
  if (p.product) return studioHref(`changes/?exploration=${p.number}&product=${encodeURIComponent(p.product)}`);
  const kept = Boolean(p.merged_at) || p.state === 'merged';
  const exploration = !kept && isExplorationPull({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body });
  return studioHref(exploration ? `changes/?exploration=${p.number}` : `changes/?pr=${p.number}`);
}

/** The viewer's own: they opened it, asked for it ("Requested by"), or started it (the exploration block's author). */
export function isOwnExploration(p: Pick<ExplorationPull, 'user' | 'body'>, viewer: string | null | undefined): boolean {
  if (!viewer) return false;
  return same(p.user?.login, viewer) || same(requesterOf(p.body)?.login, viewer) || same(parseExplorationBody(p.body)?.author, viewer);
}

/** The plate of a screen, while no capture of it exists. */
export const SCREEN_SKETCH: ThumbSpec = { kind: 'screen', src: null };

/** The tag of a card's state: the exploration page's words and tones (lib/exploration-page explorationTag). */
export function cardTag(stage: ExplorationStage, state: string): { tone: TagTone; dot: boolean } {
  const byWord: Record<string, string> = { 'Not started': 'active', Exploring: 'active', 'Waiting for code': 'ready', 'Being built': 'building', Shipped: 'shipped', 'In review': 'promoted', 'Kept in the library': 'kept' };
  const status = byWord[state];
  if (status) {
    const t = explorationTag(status, { notStarted: state === 'Not started' });
    return { tone: t.tone, dot: t.dot };
  }
  // "2 new pieces found": still exploring, with news.
  return { tone: 'info', dot: stage === 'found' };
}

const ORDER: Record<ExplorationStage, number> = { exploring: 0, found: 0, 'with-devs': 1, 'in-review': 1, kept: 2 };

export interface HomeExplorationsOptions<P extends ExplorationPull = ExplorationPull> {
  products: readonly ProductConfig[];
  /** Who looks: marks their own (`own`). Omitted on the demo, where the visitor has none. */
  viewer?: string | null;
  /** Only the viewer's own: the home of a contributor (home by role). Leads and reviewers see the team's. */
  onlyOwn?: boolean;
  /** Who explores it (the asker, Claude AI for agent work without one). */
  author: (p: P) => Person;
  /** The explored screen, once known. */
  preview?: (p: P) => ThumbSpec | null | undefined;
  /**
   * The changed files of a running exploration (undefined while read, null when unreadable): its card then says
   * "Not started" or "Exploring", as its page. Omitted: "Exploring".
   */
  files?: (p: P) => readonly string[] | null | undefined;
  /** Archived explorations: left out (the default), or the only ones kept (a product page's Archived fold). */
  archived?: 'exclude' | 'only';
}

/**
 * A card's screen: its capture when there is one, with what the plate would say kept beside it (the plate comes back
 * if the image does not load); no capture: the plate, with the changed screen's name (from its files, once read), the
 * product and the card's key, which picks its drawing (lib/branch-thumb plateDrawing).
 */
export function previewOf(shot: ThumbSpec | null | undefined, plate: { product: string; screen: string | null; seed: string }): ThumbSpec {
  if (!shot) return { kind: 'screen', src: null, ...plate };
  if (shot.kind !== 'screen') return shot;
  return { ...shot, product: shot.product ?? plate.product, screen: shot.screen ?? plate.screen, seed: shot.seed ?? plate.seed };
}

/** Closed without being kept: an exploration given up, not one the home shows. */
const givenUp = (p: Pick<ExplorationPull, 'state' | 'merged_at'>) => p.state === 'closed' && !p.merged_at;

/**
 * The home's exploration cards, from the open pull requests and the recently closed ones (a merged one is kept): still
 * being tried first, then in review, then kept; newest activity first inside. Library changes, automation and
 * explorations closed without merging are left out.
 */
export function homeExplorations<P extends ExplorationPull>(pulls: P[], opts: HomeExplorationsOptions<P>): ExplorationCard[] {
  const seen = new Set<string>();
  const keyOf = (p: P) => (p.product ? `${p.product}#${p.number}` : String(p.number));
  return pulls
    .filter((p) => {
      if (seen.has(keyOf(p))) return false;
      seen.add(keyOf(p));
      return !givenUp(p) && isArchivedExploration(p.labels) === (opts.archived === 'only') && isHomeExploration(p, opts.products) && (!opts.onlyOwn || isOwnExploration(p, opts.viewer));
    })
    .map((p): ExplorationCard => {
      const files = opts.files;
      const read = explorationStage(p, files ? () => files(p) : undefined);
      // Archived: out of the lists, never "Exploring". Its tag says what it is (the Archived tab of Changes).
      const archived = isArchivedExploration(p.labels) && read.stage !== 'kept';
      const { stage, state } = archived ? { stage: read.stage, state: LIFECYCLE_LABEL.archived } : read;
      const product = explorationProduct(p, opts.products);
      const tag = archived ? { tone: 'neutral' as const, dot: false } : cardTag(stage, state);
      return {
        number: p.number,
        key: keyOf(p),
        title: explorationTitle(p),
        href: explorationHref(p),
        product,
        productKey: explorationProductKey(p, opts.products),
        author: opts.author(p),
        stage,
        state,
        tone: tag.tone,
        dot: tag.dot,
        updated: p.updated_at,
        preview: previewOf(opts.preview?.(p), { product: product ?? 'Library', screen: changedScreenOf(files?.(p)), seed: keyOf(p) }),
        own: isOwnExploration(p, opts.viewer),
      };
    })
    .sort((a, b) => ORDER[a.stage] - ORDER[b.stage] || b.updated.localeCompare(a.updated) || b.number - a.number);
}

/** The pull requests the home leaves to Changes: library changes, the ones that are not explorations. */
export const libraryChangesOf = <P extends ExplorationPull>(pulls: P[], products: readonly ProductConfig[]): P[] => pulls.filter((p) => !isHomeExploration(p, products));

/** "You have 2 library changes in progress." under the explorations, with the way to them on Changes. */
export function libraryChangesLine(n: number): string | null {
  if (n <= 0) return null;
  return `You have ${plural(n, 'library change', 'library changes')} in progress.`;
}

/** Changes, on the viewer's own work. */
export const YOUR_CHANGES_HREF = () => studioHref('changes/?who=mine');

/**
 * The section by role (home by role): a contributor sees only their own explorations, under "Your explorations", and
 * "See all" opens their own work; a lead or reviewer sees the team's, under "Explorations", and "See all" opens Changes.
 */
export function explorationsFor(cards: ExplorationCard[], contributor: boolean): { cards: ExplorationCard[]; title: string; seeAll: string } {
  return contributor
    ? { cards: cards.filter((c) => c.own), title: 'Your explorations', seeAll: YOUR_CHANGES_HREF() }
    : { cards, title: 'Recent explorations', seeAll: studioHref('changes/') };
}

/** Explorations on the quiet team Home: at most this many cards, under the ways to start. */
export const RECENT_CARDS = 4;

/** "Recent explorations" under the ways to start: newest activity first, RECENT_CARDS at most, and how many in all. */
export function recentExplorations(cards: readonly ExplorationCard[], n = RECENT_CARDS): { cards: ExplorationCard[]; total: number } {
  const sorted = [...cards].sort((a, b) => b.updated.localeCompare(a.updated) || b.number - a.number);
  return { cards: sorted.slice(0, n), total: cards.length };
}

/** A library change of the viewer's (home-model BranchCard): where it stands, as Changes files it (lib/branches-page stateOf). */
type OwnBranch = { stage: 'draft' | 'waiting' | 'ready' };

/**
 * What is open of the viewer's own work, in the lifecycle's words of the Changes header (lib/page-summary
 * changesSummary): their explorations by stage (shipped and kept ones are not open), and their library changes (a
 * draft is being built, one waiting for a developer waits for code, one sent is in review). Null when nothing is open.
 */
export function ownOpenWork(cards: readonly Pick<ExplorationCard, 'stage' | 'state' | 'own'>[], branches: readonly OwnBranch[] = []): string | null {
  const c = { exploring: 0, code: 0, building: 0, review: 0 };
  for (const x of cards) {
    if (!x.own || x.state === LIFECYCLE_LABEL.archived) continue;
    if (x.stage === 'exploring' || x.stage === 'found') c.exploring += 1;
    else if (x.stage === 'in-review') c.review += 1;
    else if (x.stage === 'with-devs') c[x.state === LIFECYCLE_LABEL['being-built'] ? 'building' : 'code'] += 1;
  }
  for (const b of branches) c[b.stage === 'waiting' ? 'code' : b.stage === 'draft' ? 'building' : 'review'] += 1;
  return c.exploring + c.code + c.building + c.review ? changesSummary(c) : null;
}

/**
 * The quiet Home's sentence after the greeting: "Nothing needs you." then what is open of the viewer's own work
 * ("1 waiting for code."), or "Nothing needs you, and you have nothing in progress." only when truly nothing is.
 * `failed`: GitHub could not be read, so Bridge does not claim there is nothing.
 */
export function quietSentence(open: string | null, failed = false): string {
  if (open) return `Nothing needs you. ${open}`;
  return failed ? 'Nothing needs you.' : 'Nothing needs you, and you have nothing in progress.';
}
