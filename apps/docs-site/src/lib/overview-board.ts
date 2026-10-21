// The Studio Overview, below the greeting: what moves (a board in four columns) and the library health figures.
// Pure: no DOM, no fetch. Unit tested in overview-board.test.ts.
//
// Columns, from real data only:
//   - Exploring: running explorations (open exploration pull requests, lib/explorations-view).
//   - In review: the review queue (lib/review-queue), minus what is ready to ship.
//   - Ready to ship: changes approved with green tests (who acts now: merge).
//   - Next release: design system changes approved since the last release (pending changesets that touch components
//     or tokens). Bridge's own app updates and the release automation stay out: they are not the design system.
// A card says what in designer words, what holds it (one status pattern, icon plus label: Blocked or You) and who is
// on it. The viewer's own avatar never shows: "Needs a developer" rather than "A developer is on it" next to you.
// Who comes from real markers (lib/work-nature makerOf): Claude when an agent made it, "You" only for what the viewer
// started from Studio. Developer work (lib/work-nature) leaves the columns for one quiet line under the board.
import { branchCount } from './vocabulary';
import type { WhoActs } from './changes';
import { blockerOf, type TodoChange } from './overview-todo';
import { isDsChange } from './release-view';
import { explorationMakerLine, makerOf, type Maker, type WorkNature } from './work-nature';
import { studioHref } from './team-path';

export type ColumnId = 'exploring' | 'review' | 'ready' | 'release';

/** One status pattern for every card: an icon and a label. Blocked is danger, You is neutral. */
export interface CardStatus {
  tone: 'blocked' | 'you';
  label: string;
}

export interface BoardCard {
  key: string;
  title: string;
  /** GitHub login of the person on it; null when nobody is known or it is the viewer. */
  who: string | null;
  /** One sentence: what holds it or what happens next. */
  note: string;
  status: CardStatus | null;
  href: string;
}

export interface BoardColumn {
  id: ColumnId;
  label: string;
  /** Where the column header leads in Changes. */
  href: string;
  cards: BoardCard[];
  /** How many cards are blocked, for the stage count ("3, all blocked"). */
  blocked: number;
  /** The quiet line of an empty stage. */
  empty: string;
}

/** Cards shown per column before "+N more": the board stays short so health stays on the first screen. */
export const CARDS_MAX = 2;

export interface BoardExploration {
  number: number;
  /** Sentence case, without the "Exploration:" prefix (explorationRows name). */
  name: string;
  author: string;
  /** Who made it (lib/work-nature makerOf). Absent: from the author alone, never "You" without a Studio marker. */
  maker?: Maker;
  /** Design or developer work. Absent: design. */
  nature?: WorkNature;
}

export interface BoardChange extends TodoChange {
  author: string;
  /** Assignees of the change on GitHub: who a blocked change waits for. */
  assignees?: string[];
}

export interface BoardRelease {
  /** Changeset file, unique. */
  ref: string;
  title: string;
  packages: string[];
  bump: 'major' | 'minor' | 'patch' | null;
  /** Who wrote the change (git author of the changeset), null when git has no answer. */
  author: string | null;
}

export interface BoardInput {
  explorations: BoardExploration[];
  /** The review queue, most urgent first. */
  changes: BoardChange[];
  release: BoardRelease[];
  viewer: string | null;
  /** Statuses still loading: a change without one is being checked. */
  loading?: boolean;
}

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && norm(a) === norm(b));
const handle = (x: string) => `@${x.replace(/^@/, '')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The person shown on a card: never the viewer. */
const other = (login: string | null | undefined, viewer: string | null) => (login && !same(login, viewer) ? login : null);

const LABEL: Record<ColumnId, string> = { exploring: 'Exploring', review: 'In review', ready: 'Ready to merge', release: 'Next release' };
const HREF: Record<ColumnId, string> = {
  exploring: studioHref('changes/?view=explorations'),
  review: studioHref('changes/'),
  ready: studioHref('changes/'),
  release: studioHref('changes/?view=history'),
};
const EMPTY: Record<ColumnId, string> = {
  exploring: 'No exploration running.',
  review: 'Nothing in review.',
  ready: 'Nothing approved yet.',
  release: 'Nothing approved since the last release.',
};
const BLOCKED: CardStatus = { tone: 'blocked', label: 'Blocked' };
const YOU: CardStatus = { tone: 'you', label: 'You' };

/** The card of a change in review: the blocker on the card, else who acts now. */
function reviewCard(c: BoardChange, viewer: string | null, loading: boolean): BoardCard {
  const base = { key: `change-${c.number}`, title: c.title, who: other(c.author, viewer), href: studioHref(`changes/?pr=${c.number}`) };
  const who: WhoActs | null = c.who;
  if (!who) return { ...base, note: loading ? 'Checking what it needs.' : 'Open it to see what it needs.', status: null };
  // Approved, waiting for code (lib/change-status): not blocked for designers, a developer finishes it.
  if (c.lifecycle === 'waiting') return { ...base, note: 'Approved, waiting for code.', status: null };
  // A draft is not blocked: its author marks it ready when it is done.
  if (c.lifecycle === 'draft') return { ...base, note: 'Draft. Nobody is asked to review it yet.', status: null };
  const block = blockerOf(c, who, viewer);
  if (block) {
    const author = other(who.logins[0], viewer);
    // The viewer wrote it (often with Claude): the developer who fixes it is whoever GitHub assigns.
    const assignee = (c.assignees ?? []).find((a) => !same(a, viewer));
    const nobody = c.agent ? 'Claude drafted it, no developer is on it yet.' : 'No developer yet.';
    const actor = author && who.who !== 'you' ? `${handle(author)} is on it.` : assignee ? `Waiting for ${handle(assignee)}.` : nobody;
    return { ...base, note: `${cap(block.what)}. ${actor}`, status: BLOCKED };
  }
  if (who.action === 'wait') return { ...base, note: who.sentence, status: null };
  if (viewer && who.yourTurn) return { ...base, note: who.action === 'approve-tech' ? 'Design is approved. Your tech review is next.' : 'Your design review is next.', status: YOU };
  return { ...base, note: who.sentence, status: null };
}

function readyCard(c: BoardChange, viewer: string | null): BoardCard {
  const yours = Boolean(viewer) && Boolean(c.who?.yourTurn);
  return {
    key: `change-${c.number}`,
    title: c.title,
    who: other(c.author, viewer),
    href: studioHref(`changes/?pr=${c.number}`),
    note: yours ? 'Approved and tested. Merge it to put it in the next release.' : `Approved and tested. ${c.who?.sentence.replace(/^Ready to merge: /, '') ?? ''}`.trim(),
    status: yours ? YOU : null,
  };
}

type Natured = BoardCard & { nature: WorkNature };

/** The note of an exploration card: who is on it, then what happens next. */
export function explorationNote(e: BoardExploration, viewer: string | null): string {
  const m = e.maker ?? makerOf({ author: e.author, viewer });
  // Whoever started it with the viewer's account (Claude, the viewer, a tool) waits for the viewer to send it on.
  return `${explorationMakerLine(m)} ${m.kind === 'person' ? 'Goes to review once it holds up.' : 'Request a review once it holds up.'}`;
}

/** Every card of the board with its nature, column by column. */
function allCards(input: BoardInput): [ColumnId, Natured[]][] {
  const { viewer } = input;
  const loading = Boolean(input.loading);
  const ready: Natured[] = [];
  const review: Natured[] = [];
  for (const c of input.changes) {
    const nature = c.nature ?? 'design';
    if (c.who?.action === 'merge') ready.push({ ...readyCard(c, viewer), nature });
    else review.push({ ...reviewCard(c, viewer, loading), nature });
  }
  const exploring = input.explorations.map<Natured>((e) => ({
    key: `exploration-${e.number}`,
    title: e.name,
    who: other(e.author, viewer),
    // Developer work: who is on it, no next step for a designer.
    note: e.nature === 'developer' ? explorationMakerLine(e.maker ?? makerOf({ author: e.author, viewer })) : explorationNote(e, viewer),
    status: null,
    href: studioHref(`changes/?exploration=${e.number}`),
    nature: e.nature ?? 'design',
  }));
  const release = input.release
    .filter((r) => isDsChange(r.packages))
    .map<Natured>((r) => ({
      key: `release-${r.ref}`,
      title: releaseTitle(r.title),
      who: other(r.author, viewer),
      note: 'Merged, goes out in the next release.',
      status: null,
      href: studioHref('changes/?view=history'),
      nature: 'design',
    }));
  return [
    ['exploring', exploring],
    ['review', review],
    ['ready', ready],
    ['release', release],
  ];
}

const strip = ({ nature: _n, ...card }: Natured): BoardCard => card;

/** The four columns, in the order work moves, design work only. Release cards keep only what product teams install. */
export function boardColumns(input: BoardInput): BoardColumn[] {
  const cols = allCards(input).map(([id, cards]) => [id, cards.filter((c) => c.nature === 'design').map(strip)] as const);
  // Avatars only tell people apart: with one author on the whole board they repeat the same face on every card.
  const authors = new Set(cols.flatMap(([, cards]) => cards.flatMap((c) => (c.who ? [norm(c.who)] : []))));
  const show = (cards: BoardCard[]) => (authors.size > 1 ? cards : cards.map((c) => ({ ...c, who: null })));
  return cols.map(([id, cards]) => ({ id, label: LABEL[id], href: HREF[id], cards: show(cards), blocked: cards.filter((c) => c.status?.tone === 'blocked').length, empty: EMPTY[id] }));
}

/** A developer task under the board: the card, and the stage it is in ("Exploring"). */
export interface DevWorkItem extends BoardCard {
  stage: string;
}

/** Developer work in flight, in board order: one quiet line under the board opens it (lib/work-nature devWorkLine). */
export function developerWork(input: BoardInput): DevWorkItem[] {
  return allCards(input).flatMap(([id, cards]) => cards.filter((c) => c.nature === 'developer').map((c) => ({ ...strip(c), who: null, stage: LABEL[id] })));
}

/** "In review, 3": the column header, also its accessible name. */
export const columnHeading = (c: Pick<BoardColumn, 'label' | 'cards'>) => `${c.label}, ${c.cards.length}`;

/** The count after a stage name: "3", or "3, 3 blocked" when some are blocked. */
export const columnMeta = (c: Pick<BoardColumn, 'cards' | 'blocked'>) =>
  !c.blocked ? `${c.cards.length}` : c.blocked === c.cards.length ? `${c.cards.length}, all blocked` : `${c.cards.length}, ${c.blocked} blocked`;

/** The cards a column shows and the "Show all 3" link under them (empty when they all fit). */
export function visibleCards<C>(cards: C[], max = CARDS_MAX): { shown: C[]; more: string } {
  return { shown: cards.slice(0, max), more: cards.length > max ? `Show all ${cards.length}` : '' };
}

/**
 * A title split into plain text and token names (dotted lowercase paths like "focus.ring.offset"), so the page sets
 * token names in Plex Mono.
 */
export function splitTokens(title: string): { text: string; token: boolean }[] {
  const out: { text: string; token: boolean }[] = [];
  const re = /\b[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\b/g;
  let at = 0;
  for (const m of title.matchAll(re)) {
    if (m.index! > at) out.push({ text: title.slice(at, m.index), token: false });
    out.push({ text: m[0], token: true });
    at = m.index! + m[0].length;
  }
  if (at < title.length) out.push({ text: title.slice(at), token: false });
  return out;
}
/** "4 changes in flight." The board's one summary line. */
export function inFlightLine(cols: BoardColumn[]): string {
  const n = cols.filter((c) => c.id !== 'release').reduce((s, c) => s + c.cards.length, 0);
  const shipped = cols.find((c) => c.id === 'release')?.cards.length ?? 0;
  const moving = n === 0 ? 'Nothing in flight' : `${branchCount(n)} in flight`;
  return shipped ? `${moving}, ${shipped} approved for the next release.` : `${moving}.`;
}

/**
 * A release note title in designer words: the first clause of the summary, code spans read as words. A prop with a
 * value (`appearance="inline"`) reads "a new appearance option"; other code keeps its text without the backticks.
 * "Textarea gets `appearance="inline"` for editing ... in place: no border" -> "Textarea gets a new appearance option
 * for editing existing text in place".
 */
export function releaseTitle(summary: string): string {
  let t = summary.replace(/\s+/g, ' ').trim();
  t = t.replace(/`(\w[\w-]*)=["'][^"'`]*["']`/g, (_m, prop: string) => `a new ${prop} option`);
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // First clause: up to the first colon, semicolon or sentence end.
  const cut = t.match(/^(.+?)(?::\s|;\s|\.\s|\.$|$)/)?.[1] ?? t;
  const clean = cut.replace(/\s*\(#\d+\)\s*$/, '').trim();
  const short = clean.length > 90 ? `${clean.slice(0, 87).replace(/\s+\S*$/, '')}...` : clean;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

// ---------------------------------------------------------------------------------------------------------------
// Start a change: where each choice of the Overview menu leads.

export type StartChoice = 'look' | 'variant' | 'wrong' | 'new';

/**
 * Adjust the look opens Tokens; a variant or a mismatch opens the picked component's drawer on that intent; a new
 * component opens the exploration start form.
 */
export function startChangeHref(choice: StartChoice, slug?: string): string {
  if (choice === 'look') return studioHref('tokens/');
  if (choice === 'new') return studioHref('changes/?view=explorations&start=new');
  const p = new URLSearchParams({ ...(slug ? { c: slug } : {}), intent: choice });
  return studioHref(`components/?${p.toString()}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Library health: three figures, each from data the repo already holds, each a door to Quality.

export interface HealthFigure {
  id: 'contrast' | 'adoption' | 'guidance';
  /** The figure itself: "296", "94.5%", "46 of 48". */
  value: string;
  /** What it counts: "contrast checks pass". */
  label: string;
  /** One quiet line: the trend or what is left. Null when there is nothing to add. */
  detail: string | null;
  /** The split per product under a total: "Admin demo 90.2%, Bridge itself 100%." */
  split: string | null;
  /** Danger only when something fails. */
  tone: 'fail' | null;
  href: string;
}

export interface AdoptionMetrics {
  dsComponentInstances: number;
  uiComponentInstances: number;
}

export interface HealthInput {
  contrast: { total: number; fail: number; brands: number };
  /** Per product: the current run and, when it exists, the run before the move to Bridge. */
  adoption: { now: AdoptionMetrics; before?: AdoptionMetrics | null; label?: string }[];
  guidance: { total: number; reviewed: number; drafted: number; missing: number };
}

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

/**
 * Component adoption across products: instances from Bridge over every UI component instance, summed over the
 * latest run of each product. The value before Bridge sums the earlier runs the same way, only when every product
 * has one. Null when no product has a report.
 */
export function combinedAdoption(apps: HealthInput['adoption']): { now: number; before: number | null; products: number } | null {
  const withData = apps.filter((a) => a.now.uiComponentInstances > 0);
  if (!withData.length) return null;
  const sum = (xs: AdoptionMetrics[]) => xs.reduce((s, m) => ({ ds: s.ds + m.dsComponentInstances, ui: s.ui + m.uiComponentInstances }), { ds: 0, ui: 0 });
  const now = sum(withData.map((a) => a.now));
  const befores = withData.map((a) => a.before).filter((b): b is AdoptionMetrics => Boolean(b && b.uiComponentInstances > 0));
  const before = befores.length === withData.length ? sum(befores) : null;
  return { now: (now.ds / now.ui) * 100, before: before ? (before.ds / before.ui) * 100 : null, products: withData.length };
}

export function healthFigures(input: HealthInput): HealthFigure[] {
  const { contrast, guidance } = input;
  const out: HealthFigure[] = [];
  const passing = contrast.total - contrast.fail;
  const where = `in ${contrast.brands} ${contrast.brands === 1 ? 'brand' : 'brands'}, light and dark`;
  // Failures lead: "0 failing" says the gate holds, a number above 0 says what blocks the token build.
  out.push({
    id: 'contrast',
    value: `${contrast.fail} failing`,
    label: 'contrast checks',
    detail: contrast.fail ? `${passing} of ${contrast.total} pass. The token build waits until every pair passes.` : `${contrast.total} checked ${where}.`,
    split: null,
    tone: contrast.fail ? 'fail' : null,
    href: studioHref('quality/'),
  });
  const a = combinedAdoption(input.adoption);
  if (a) {
    const across = `${a.products} ${a.products === 1 ? 'product' : 'products'}`;
    const parts = input.adoption.filter((x) => x.now.uiComponentInstances > 0 && x.label).map((x) => `${x.label} ${pct((x.now.dsComponentInstances / x.now.uiComponentInstances) * 100)}`);
    out.push({
      id: 'adoption',
      value: pct(a.now),
      label: 'of components come from Bridge',
      detail: a.before === null ? `Across ${across}.` : `Up from ${pct(a.before)} before Bridge, across ${across}.`,
      split: parts.length > 1 ? `${parts.join(', ')}.` : null,
      tone: null,
      href: studioHref('quality/#ql-adoption'),
    });
  }
  const left: string[] = [];
  if (guidance.drafted) left.push(`${guidance.drafted} drafted by Claude to review`);
  if (guidance.missing) left.push(`${guidance.missing} not written yet`);
  out.push({
    id: 'guidance',
    value: `${guidance.reviewed} of ${guidance.total}`,
    label: 'components have reviewed guidance',
    detail: left.length ? `${left.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()) : 'Every component is documented.',
    split: null,
    tone: null,
    href: studioHref('quality/#ql-findings'),
  });
  return out;
}
