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
import { defaultProduct, EXPLORATION_ARCHIVED_LABEL, explorationStateLabel, explorationStatus, findProduct, isArchivedExploration, isExplorationPull, isHandedOff, parseExplorationBody, parsePiecesRecord, PRODUCT_LABEL_PREFIX, requesterOf, type ProductConfig } from '@bridge-ds/core';
import { explorationTitle } from './pr-title';
import { studioHref } from './team-path';
import type { Person } from './home-model';
import type { ThumbSpec } from './branch-thumb';
import { changedScreenOf, explorationTag, type TagTone } from './exploration-page';
import { LIFECYCLE_LABEL, type LifecycleStage } from './review-state';
import { explorationState, withDevTask } from './exploration-state';

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
  /**
   * The one status (lib/exploration-state explorationState): every count and group reads this, never the words.
   * Archived for an archived card.
   */
  lifecycle: LifecycleStage;
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

/**
 * Opened by an app for a person: Bridge's app opens the explorations of a designer who works through Bridge (an email
 * member, or a designer whose writes go through the app since designers write through Bridge), with their name on it
 * (the "Requested by" line, or the exploration block's author). Other automation stays off the home.
 */
const openedForSomeone = (p: Pick<ExplorationPull, 'body'>) => {
  const e = parseExplorationBody(p.body);
  return Boolean(requesterOf(p.body) || e?.author || e?.member);
};

/** An exploration, or a branch started for a product: what the home's section shows. Library changes are not. */
export function isHomeExploration(p: ExplorationPull, products: readonly ProductConfig[]): boolean {
  if (p.user?.type === 'Bot' && !openedForSomeone(p)) return false;
  // A product repository's other branches are not Bridge's: only its explorations.
  if (p.product) return isExplorationPull({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body });
  return isExplorationPull({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body }) || explorationProduct(p, products) !== null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A card's stage and words from the one status (lib/exploration-state explorationState): the bucket every screen
 * shares, in the card's words. Exploring adds what only a card says: "2 new pieces found" once Bridge found pieces
 * the library does not have, else "Not started" or "Exploring" from its changed files (when the caller reads them;
 * nothing while they are read). Shipped reads "Kept in the library" for an exploration promoted and merged without a
 * hand-off, "Shipped" otherwise.
 */
export function cardOfLifecycle(
  p: Pick<ExplorationPull, 'draft' | 'state' | 'merged_at' | 'labels' | 'body'> & { head?: { ref: string; sha?: string } | undefined },
  lifecycle: LifecycleStage,
  files?: () => readonly string[] | null | undefined,
): { stage: ExplorationStage; state: string } {
  switch (lifecycle) {
    case 'exploring': {
      const pieces = parsePiecesRecord(p.body)?.pieces.length ?? 0;
      if (pieces) return { stage: 'found', state: `${plural(pieces, 'new piece', 'new pieces')} found` };
      const status = explorationStatus({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body, headSha: p.head?.sha, draft: p.draft });
      if (files && status === 'active') return { stage: 'exploring', state: explorationStateLabel({ status, files: files() }) ?? '' };
      return { stage: 'exploring', state: 'Exploring' };
    }
    case 'shipped':
    case 'next-release':
      return { stage: 'kept', state: isHandedOff({ labels: p.labels ?? [], body: p.body }) ? LIFECYCLE_LABEL[lifecycle] : 'Kept in the library' };
    case 'in-review':
      return { stage: 'in-review', state: LIFECYCLE_LABEL['in-review'] };
    case 'archived':
      return { stage: 'exploring', state: LIFECYCLE_LABEL.archived };
    default:
      // Waiting to be picked up, Being built, Approved, waiting to ship, Not planned, Closed: with the developers.
      return { stage: 'with-devs', state: LIFECYCLE_LABEL[lifecycle] };
  }
}

/** Where it stands, in designer words, from its pull request alone (no task read): cardOfLifecycle over explorationState. */
export function explorationStage(
  p: Pick<ExplorationPull, 'draft' | 'state' | 'merged_at' | 'labels' | 'body'> & { head?: { ref: string; sha?: string } | undefined },
  /**
   * The changed files of a running exploration, when the caller reads them: then it says what its page says, "Not
   * started" (only Bridge notes changed) or "Exploring", and nothing while they are read (undefined). Omitted: "Exploring".
   */
  files?: () => readonly string[] | null | undefined,
): { stage: ExplorationStage; state: string } {
  // A card shows an archived one as the stage it was archived in; its tag says Archived (homeExplorations).
  const labels = (p.labels ?? []).filter((l) => (typeof l === 'string' ? l : l.name) !== EXPLORATION_ARCHIVED_LABEL);
  return cardOfLifecycle(p, explorationState({ pull: { ...p, state: p.state ?? 'open', labels } }), files);
}

/** Its name: the exploration block's ("Profile page"), else the pull request title for people (lib/pr-title). */
export { explorationTitle };

/** Where its card opens: the exploration (or product branch) page while it is one, the change page once kept or a plain change. */
export function explorationHref(p: ExplorationPull): string {
  // In a product's own repository it is always the exploration page: Studio reviews no branch there.
  if (p.product) return studioHref(`changes/?exploration=${p.number}&product=${encodeURIComponent(p.product)}`);
  const kept = Boolean(p.merged_at) || p.state === 'merged';
  const exploration = !kept && isExplorationPull({ state: p.state ?? 'open', labels: p.labels ?? [], headRef: p.head?.ref, body: p.body });
  return studioHref(exploration ? `changes/?exploration=${p.number}` : `changes/?pr=${p.number}`);
}

/**
 * The viewer's own: they asked for it ("Requested by") or started it: the exploration block's author, or for a member
 * who joined by email its member reference (`member`, never their email; older blocks carried the email as author,
 * still matched). The account that opened it counts only when nobody is named: Bridge can open a member's
 * exploration with a lead's account, and "Requested by Dino" stays Dino's, never the lead's.
 */
export function isOwnExploration(p: Pick<ExplorationPull, 'user' | 'body'>, viewer: string | null | undefined, viewerRef?: string | null): boolean {
  if (!viewer && !viewerRef) return false;
  const e = parseExplorationBody(p.body);
  if (viewerRef && typeof e?.member === 'string' && e.member === viewerRef) return true;
  const asker = requesterOf(p.body);
  if (viewer && (same(asker?.login, viewer) || same(e?.author, viewer))) return true;
  // Someone else is named: theirs, whoever's account opened it.
  if (asker || e?.author || e?.member) return false;
  return Boolean(viewer) && same(p.user?.login, viewer);
}

/** The plate of a screen, while no capture of it exists. */
export const SCREEN_SKETCH: ThumbSpec = { kind: 'screen', src: null };

/** The tag of a card's state: the exploration page's words and tones (lib/exploration-page explorationTag). */
export function cardTag(stage: ExplorationStage, state: string): { tone: TagTone; dot: boolean } {
  const byWord: Record<string, string> = { 'Not started': 'active', Exploring: 'active', 'Waiting for code': 'ready', 'Waiting to be picked up': 'ready', 'Being built': 'building', Shipped: 'shipped', 'In review': 'promoted', 'Kept in the library': 'kept', 'Not planned': 'closed' };
  if (state === LIFECYCLE_LABEL.approved) return { tone: 'info', dot: false };
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
  /** A member who joined by email: their member reference, how exploration blocks name them (isOwnExploration). */
  viewerRef?: string | null;
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
  /**
   * Where a design copy exploration stands from its task in the developers' repository (taskStage), when read: its
   * card then says what Being built and its page say (Waiting to be picked up, Being built, In review, Shipped).
   */
  taskStage?: (p: P) => LifecycleStage | null | undefined;
}

/**
 * A handed-off card's words from its task's stage: the precedence of lib/exploration-state (withDevTask). Running,
 * in review without a hand-off and kept cards keep their own read.
 */
export function withTaskStage(read: { stage: ExplorationStage; state: string }, task: LifecycleStage | null | undefined): { stage: ExplorationStage; state: string } {
  if (read.stage !== 'with-devs' || !task) return read;
  const next = withDevTask('waiting-for-code', task);
  if (next === 'waiting-for-code' && task !== 'waiting-for-code') return read;
  return next === 'shipped' ? { stage: 'kept', state: LIFECYCLE_LABEL.shipped } : cardOfLifecycle({}, next);
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
      return !givenUp(p) && isArchivedExploration(p.labels) === (opts.archived === 'only') && isHomeExploration(p, opts.products) && (!opts.onlyOwn || isOwnExploration(p, opts.viewer, opts.viewerRef));
    })
    .map((p): ExplorationCard => {
      const files = opts.files;
      const fileRead = files ? () => files(p) : undefined;
      // The one status, with the developers' task when it was read (lib/exploration-state).
      const lifecycle = explorationState({ pull: { ...p, state: p.state ?? 'open' }, task: opts.taskStage?.(p) ?? null });
      // Archived: out of the lists, never "Exploring". Its tag says what it is (the Archived tab of Changes), its place
      // in the order is the stage it was archived in.
      const archived = lifecycle === 'archived';
      const read = archived ? explorationStage(p, fileRead) : cardOfLifecycle(p, lifecycle, fileRead);
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
        lifecycle,
        state,
        tone: tag.tone,
        dot: tag.dot,
        updated: p.updated_at,
        preview: previewOf(opts.preview?.(p), { product: product ?? 'Library', screen: changedScreenOf(files?.(p), { library: !product }), seed: keyOf(p) }),
        own: isOwnExploration(p, opts.viewer, opts.viewerRef),
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

/** Where a piece of open work stands: the lifecycle tabs of Changes (lib/branches-page StageTab). */
export type OpenStage = 'exploring' | 'code' | 'building' | 'review';

const OPEN_STAGES: readonly OpenStage[] = ['exploring', 'code', 'building', 'review'];

/** How many of the viewer's own explorations, and of their library changes, stand at each open stage. */
export interface OwnOpenWork {
  explorations: Record<OpenStage, number>;
  changes: Record<OpenStage, number>;
}

/**
 * Where a card stands while it is still open work, from its one status: running, waiting to be picked up, being built,
 * or in review (Approved, waiting to ship included, as on Changes and Being built). Shipped, in the next release, not
 * planned, closed and archived ones are done: null.
 */
export function openStageOf(c: Pick<ExplorationCard, 'lifecycle'>): OpenStage | null {
  switch (c.lifecycle) {
    case 'exploring':
      return 'exploring';
    case 'waiting-for-code':
      return 'code';
    case 'being-built':
      return 'building';
    case 'in-review':
    case 'approved':
      return 'review';
    default:
      return null;
  }
}

/**
 * What is open of the viewer's own work: their explorations by stage (openStageOf; someone else's, shipped, kept and
 * archived ones are not), and their library changes (a draft is being built, one waiting for a developer waits to be
 * picked up, one sent is in review). Null when nothing is open.
 */
export function ownOpenWork(cards: readonly Pick<ExplorationCard, 'lifecycle' | 'own'>[], branches: readonly OwnBranch[] = []): OwnOpenWork | null {
  const zero = (): Record<OpenStage, number> => ({ exploring: 0, code: 0, building: 0, review: 0 });
  const w: OwnOpenWork = { explorations: zero(), changes: zero() };
  for (const x of cards) {
    const at = x.own ? openStageOf(x) : null;
    if (at) w.explorations[at] += 1;
  }
  for (const b of branches) w.changes[b.stage === 'waiting' ? 'code' : b.stage === 'draft' ? 'building' : 'review'] += 1;
  return OPEN_STAGES.some((s) => w.explorations[s] || w.changes[s]) ? w : null;
}

/** A piece of the quiet sentence: words, or a count that opens where those things are. */
export interface QuietPart {
  text: string;
  href?: string;
}

/** What each stage says of its things, for one and for several. */
const STAGE_WORDS: Record<OpenStage, [string, string]> = {
  exploring: ['is still being explored', 'are still being explored'],
  code: ['waits for a developer to pick it up', 'wait for a developer to pick them up'],
  building: ['is being built', 'are being built'],
  review: ['is in review', 'are in review'],
};

/** Changes on the viewer's own work at one stage: where the counted things are. */
export const ownWorkHref = (stage: OpenStage) => studioHref(`changes/?state=${stage}&people=you`);

/**
 * One sentence for one kind of work: "2 of your explorations wait for a developer to pick them up, 1 is being built
 * and 1 is in review." The first count says what the things are and whose, the next ones follow it; each clause opens
 * Changes on the viewer's own work at that stage. Nothing open: no sentence.
 */
function workSentence(counts: Record<OpenStage, number>, things: string): QuietPart[] {
  const at = OPEN_STAGES.filter((s) => counts[s] > 0);
  const parts: QuietPart[] = [];
  at.forEach((s, i) => {
    const n = counts[s];
    if (i > 0) parts.push({ text: i === at.length - 1 ? ' and ' : ', ' });
    // The whole clause is the link: a lone "1" would be a target too small to hit.
    parts.push({ text: `${i === 0 ? `${n} of your ${things}` : n} ${STAGE_WORDS[s][n === 1 ? 0 : 1]}`, href: ownWorkHref(s) });
  });
  if (parts.length) parts.push({ text: '.' });
  return parts;
}

/**
 * The quiet Home's sentence after the greeting: "Nothing needs you." then what is open of the viewer's own work, in
 * designer words, each count a link ("2 of your explorations wait for a developer to pick them up."), or "Nothing
 * needs you, and you have nothing in progress." only when truly nothing is. `failed`: GitHub could not be read, so
 * Bridge does not claim there is nothing.
 */
export function quietParts(work: OwnOpenWork | null, failed = false): QuietPart[] {
  if (!work) return [{ text: failed ? 'Nothing needs you.' : 'Nothing needs you, and you have nothing in progress.' }];
  const sentences = [workSentence(work.explorations, 'explorations'), workSentence(work.changes, 'library changes')].filter((s) => s.length);
  return [{ text: 'Nothing needs you.' }, ...sentences.flatMap((s): QuietPart[] => [{ text: ' ' }, ...s])];
}

/** The quiet sentence as plain text: quietParts without the links. */
export function quietSentence(work: OwnOpenWork | null, failed = false): string {
  return quietParts(work, failed)
    .map((p) => p.text)
    .join('');
}
