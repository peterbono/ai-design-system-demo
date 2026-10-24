// The branch review (Branches > a branch, and the review queue), as pure rules: what the change is (one change or
// several: token groups, components, guidance files), the guidance as it will read with new text highlighted, the
// conversation without bots, the one line about checks, which actions the decision bar and its "More actions" menu
// hold, and the "looked at" reading aid of a busy branch. components/ds/studio/BranchReview.tsx renders it;
// scripts/reviews.ts reads GitHub and calls in. No DOM. Tested in review-page.test.ts.
import { CI_STATE_LABEL, DEFAULT_PRODUCTS, type ProductConfig } from '@bridge-ds/core';
import type { CheckStory } from './check-explain';
import { headingsOf, PRODUCTS, productOf } from './branches-page';
import type { Lifecycle } from './change-status';
import { studioHref } from './team-path';

// ---------------------------------------------------------------------------------------------------------------
// Breadcrumb

/**
 * "Branches › Library › <title>": the group is the product the Branches page files the branch under (its
 * `product: <key>` label, else the folder of its files, among the site's products). A running exploration is filed
 * under Explorations, never under the library it does not change.
 */
export function reviewCrumbs(
  files: readonly string[] | null,
  title: string,
  opts: { products?: readonly ProductConfig[]; labels?: readonly (string | { name: string })[] | null; exploration?: boolean } = {},
): { label: string; href?: string }[] {
  const products = opts.products?.length ? opts.products : DEFAULT_PRODUCTS;
  const key = productOf(files, products, opts.labels ?? null);
  const group = opts.exploration ? 'Explorations' : (headingsOf(products).find((p) => p.key === key) ?? PRODUCTS.find((p) => p.key === key) ?? PRODUCTS[0]!).label;
  return [
    { label: 'Branches', href: studioHref('changes/') },
    { label: group, href: studioHref('changes/') },
    { label: title },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Product work: an exploration or a product branch, as a designer sees it

/** What a designer gets on an exploration or a product branch page: where it is, why, and how to see it. */
export interface ProductWorkView {
  kind: 'exploration' | 'product';
  /** The product it is built in ("Account app"); "the library" for an exploration of the library itself. */
  product: string;
  /** Why it exists, from the exploration block (or null). */
  purpose: string | null;
  /** The use case, in words ("Prototype for a user test"). */
  useCase: string | null;
  /** What is experimental, one line each, from the exploration block. */
  experimental: string[];
  /** Previews Vercel reported for the branch, by designer name (Component sandbox, Admin demo). */
  previews: { label: string; url: string }[];
  /** The product preview with the Bridge toolbar on (?bridge=N), when there is one. */
  tryUrl: string | null;
  /** Without a preview to open: none set up, none for this version, the latest did not build, or still building. */
  previewState: 'none' | 'missing' | 'failed' | 'building';
}

/**
 * The product work view of a branch, or null for a library branch: a running exploration, or a branch filed under a
 * product other than the library (its label or its files).
 */
export function productWorkOf(x: {
  exploration: boolean;
  files: readonly string[] | null;
  labels?: readonly (string | { name: string })[] | null;
  products?: readonly ProductConfig[];
  purpose?: string | null;
  useCase?: string | null;
  experimental?: string[] | null;
  previews?: { label: string; url: string | null; state?: string }[];
  tryUrl?: string | null;
}): ProductWorkView | null {
  const products = x.products?.length ? x.products : DEFAULT_PRODUCTS;
  const key = productOf(x.files, products, x.labels ?? null);
  const library = products.find((p) => p.default)?.key ?? 'library';
  if (!x.exploration && key === library) return null;
  const name = key === library ? 'the library' : (headingsOf(products).find((p) => p.key === key)?.label ?? key);
  const all = x.previews ?? [];
  const previews = all.filter((p) => p.url && p.state !== 'failed').map((p) => ({ label: p.label, url: p.url! }));
  const previewState = !all.length ? 'none' : all.some((p) => p.state === 'building') ? 'building' : all.some((p) => p.state === 'failed') ? 'failed' : 'missing';
  return { kind: x.exploration ? 'exploration' : 'product', product: name, purpose: x.purpose?.trim() || null, useCase: x.useCase && x.useCase.toLowerCase() !== 'other' ? x.useCase : null, experimental: (x.experimental ?? []).filter((e) => e.trim()), previews, tryUrl: x.tryUrl ?? null, previewState };
}

/**
 * The first paragraph a branch description gives under "What changed and why" (or "Why"), as plain text, for a
 * product branch without an exploration block. Null when the body has no such section. At most 280 characters.
 */
export function bodyWhy(body: string | null | undefined): string | null {
  const m = /^#{1,4}\s*(?:what changed(?: and why)?|why)\b[^\n]*\n+([\s\S]*?)(?:\n\s*\n|\n#|$)/im.exec(body ?? '');
  const text = m?.[1]
    ?.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > 280 ? `${text.slice(0, 279).replace(/\s+\S*$/, '')}...` : text;
}

/** The sentence under "See it": "An exploration in Account app, to try ..." or "A screen of Account app, built with the library." */
export function productWorkLine(v: Pick<ProductWorkView, 'kind' | 'product' | 'purpose' | 'useCase'>): string {
  const what = v.kind === 'exploration' ? `An exploration in ${v.product}, never merged as is.` : `A change to ${v.product}, built with the library.`;
  const why = v.purpose ? ` ${v.purpose.replace(/\s+/g, ' ').replace(/([^.!?])$/, '$1.')}` : '';
  return `${what}${why}`;
}

/** When nothing can be seen yet (no before and after, no preview): why, and what a designer can do about it. */
export function productWorkEmpty(v: Pick<ProductWorkView, 'product' | 'previewState'>): string {
  if (v.previewState === 'failed') return 'The preview of the latest version did not build. Ask a developer to run it again.';
  if (v.previewState === 'building') return 'Its preview is being built. It shows here in a few minutes.';
  if (v.previewState === 'missing') return 'No preview of this version yet. Ask a developer to publish one.';
  return `No preview of it yet. Once ${v.product} publishes a preview for each branch, you can try it from here. Ask a developer to turn previews on.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Word diff: what a reviewer sees highlighted

export interface Seg {
  text: string;
  added: boolean;
}

const words = (s: string) => s.split(/(\s+)/).filter((w) => w !== '');

/**
 * The new text, in pieces, with the words that were not in `before` marked added. No before: all of it is new. Only
 * insertions are marked: the page reads as it will read after the change, removed words are not shown.
 */
export function wordDiff(before: string | null | undefined, after: string): Seg[] {
  if (!after) return [];
  if (!before?.trim()) return [{ text: after, added: true }];
  if (before === after) return [{ text: after, added: false }];
  const a = words(before);
  const b = words(after);
  // Longest common subsequence over words (texts are a few sentences long).
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Seg[] = [];
  const push = (text: string, added: boolean) => {
    const last = out[out.length - 1];
    // Whitespace between two added words stays inside the highlight.
    if (last && (last.added === added || (/^\s+$/.test(text) && last.added))) last.text += text;
    else out.push({ text, added });
  };
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      push(b[j]!, false);
      i++;
      j++;
    } else if (i < a.length && dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else {
      push(b[j]!, /^\s+$/.test(b[j]!) ? false : true);
      j++;
    }
  }
  // A highlight never ends on a space.
  for (let k = 0; k < out.length; k++) {
    const s = out[k]!;
    const m = s.added ? /\s+$/.exec(s.text) : null;
    if (m && m[0] !== s.text) {
      s.text = s.text.slice(0, -m[0].length);
      const next = out[k + 1];
      if (next && !next.added) next.text = m[0] + next.text;
      else out.splice(k + 1, 0, { text: m[0], added: false });
    }
  }
  return out;
}

export const hasAdded = (segs: Seg[]) => segs.some((s) => s.added);

// ---------------------------------------------------------------------------------------------------------------
// Guidance, as it will read in the Library

export interface GuidanceEntry {
  title: string;
  text: string;
  example?: unknown;
}

/** The parts of a docs.json the review shows (the Library's Usage tab, plus the summary). */
export interface GuidanceDocs {
  summary?: string;
  whenToUse?: string[];
  whenNotToUse?: string[];
  dos?: GuidanceEntry[];
  donts?: GuidanceEntry[];
  accessibility?: string[];
  contentGuidelines?: string[];
  needsReview?: boolean;
  draftedBy?: string;
  /** The sections a Claude draft covers; missing means all of them. */
  draftedSections?: string[];
}

/** The sections of a Claude draft that wait for a person (needsReview), none once accepted. */
export function draftedKeys(d: GuidanceDocs): GuidanceKey[] {
  if (d.needsReview !== true) return [];
  const all: GuidanceKey[] = ['summary', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines'];
  return d.draftedSections?.length ? all.filter((k) => d.draftedSections!.includes(k)) : all;
}

/** Claude drafted it and nobody accepted it yet. */
export const isClaudeDraft = (d: GuidanceDocs | null | undefined) => Boolean(d && d.needsReview === true && /claude/i.test(d.draftedBy ?? ''));

export type GuidanceKey = 'summary' | 'whenToUse' | 'whenNotToUse' | 'dos' | 'donts' | 'accessibility' | 'contentGuidelines';

/** Section labels as the Library writes them. */
export const GUIDANCE_LABEL: Record<GuidanceKey, string> = {
  summary: 'Summary',
  whenToUse: 'When to use',
  whenNotToUse: 'When not to use',
  dos: 'Do',
  donts: "Don't",
  accessibility: 'Accessibility',
  contentGuidelines: 'Content guidelines',
};

export interface GuidanceItem {
  key: GuidanceKey;
  index: number;
  /** Do and don't entries have a title. */
  title?: Seg[];
  text: Seg[];
  changed: boolean;
  example?: unknown;
}

export interface GuidanceSection {
  key: GuidanceKey;
  label: string;
  items: GuidanceItem[];
  /** Items main has and the branch drops, as text. */
  removed: string[];
  changed: boolean;
}

const asText = (v: string | GuidanceEntry) => (typeof v === 'string' ? v : `${v.title}\n${v.text}`);

/** Sections in Library order. The summary shows only when it changes; empty sections are left out. */
export function guidanceView(base: GuidanceDocs | null, head: GuidanceDocs): GuidanceSection[] {
  // A Claude draft nobody accepted yet reads as new text, even when main already holds it: a person has not read it.
  const drafted = draftedKeys(head);
  const out: GuidanceSection[] = [];
  const keys: GuidanceKey[] = ['summary', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines'];
  for (const key of keys) {
    const was = drafted.includes(key) ? [] : (key === 'summary' ? (base?.summary ? [base.summary] : []) : ((base?.[key] as (string | GuidanceEntry)[] | undefined) ?? [])) as (string | GuidanceEntry)[];
    const now = (key === 'summary' ? (head.summary ? [head.summary] : []) : ((head[key] as (string | GuidanceEntry)[] | undefined) ?? [])) as (string | GuidanceEntry)[];
    const wasText = was.map(asText);
    const nowText = now.map(asText);
    const used = new Set<number>();
    const items: GuidanceItem[] = now.map((v, index) => {
      const same = wasText.findIndex((t, k) => !used.has(k) && t === nowText[index]);
      if (same >= 0) used.add(same);
      // The item at the same place on main, unless that one is kept as is elsewhere: an edit of it.
      const near = same < 0 && index < was.length && !used.has(index) && !nowText.includes(wasText[index]!) ? was[index] : undefined;
      if (same < 0 && near !== undefined) used.add(index);
      const prev = same >= 0 ? was[same] : near;
      if (typeof v === 'string') {
        const text = wordDiff(prev === undefined ? null : (prev as string), v);
        return { key, index, text, changed: hasAdded(text) || (prev !== undefined && prev !== v) };
      }
      const p = prev as GuidanceEntry | undefined;
      const title = wordDiff(p ? p.title : null, v.title);
      const text = wordDiff(p ? p.text : null, v.text);
      return { key, index, title, text, changed: hasAdded(title) || hasAdded(text), ...(v.example ? { example: v.example } : {}) };
    });
    const removed = wasText.filter((_, k) => !used.has(k)).map((t) => t.replace(/\n/g, ': '));
    const changed = items.some((i) => i.changed) || removed.length > 0;
    if (key === 'summary' && !changed) continue;
    if (!items.length && !removed.length) continue;
    out.push({ key, label: GUIDANCE_LABEL[key], items, removed, changed });
  }
  return out;
}

/** "2 sections with new text", for a one-line row. */
export function guidanceMeta(sections: GuidanceSection[]): string {
  const n = sections.filter((s) => s.changed).length;
  return n ? `${n} ${n === 1 ? 'section' : 'sections'} with new text` : 'no new text';
}

/** The docs with one item replaced (click-to-edit Save). Returns a new object; other keys are kept. */
export function withGuidanceEdit<T extends GuidanceDocs>(docs: T, key: GuidanceKey, index: number, value: string | { title: string; text: string }): T {
  if (key === 'summary') return { ...docs, summary: typeof value === 'string' ? value : value.text };
  const list = [...((docs[key] as (string | GuidanceEntry)[] | undefined) ?? [])];
  const cur = list[index];
  list[index] = typeof cur === 'object' && cur !== null ? { ...cur, ...(typeof value === 'string' ? { text: value } : value) } : typeof value === 'string' ? value : value.text;
  return { ...docs, [key]: list };
}

// ---------------------------------------------------------------------------------------------------------------
// One branch, several changes

export type ChangeKind = 'tokens' | 'component' | 'guidance';

export interface ReviewChange {
  /** Stable id for the outline, anchors and the looked-at store. */
  id: string;
  kind: ChangeKind;
  title: string;
  /** One short line: "3 new, 1 changed", "new component", "2 sections with new text". */
  meta: string;
  /** The files of this change. */
  paths: string[];
  /** Token changes: the token paths of the group. */
  tokens?: string[];
  /** Component and guidance changes: the component name. */
  component?: string;
}

export const CHANGE_GROUP: Record<ChangeKind, string> = { tokens: 'Tokens', component: 'Components', guidance: 'Guidance' };

const COMPONENT_DIR = /(?:^|\/)components\/([A-Z][A-Za-z0-9]*)\//;
const DOCS_FILE = /(?:^|\/)([A-Z]\w*)\.docs\.json$/;
const TOKEN_FILE = /\.tokens\.json$/;

/** A token belongs to its parent group: "color.bg.default" to "color.bg", "avatar.agent-bg" to "avatar". */
export const tokenGroup = (path: string) => path.split('.').slice(0, -1).join('.') || path;

const counts = (kinds: string[]) => {
  const n = (k: string) => kinds.filter((x) => x === k).length;
  return [n('added') && `${n('added')} new`, n('changed') && `${n('changed')} changed`, n('removed') && `${n('removed')} removed`].filter(Boolean).join(', ');
};

/**
 * Splits a branch into the changes a designer reviews: one per token group (from the token review, else one for all
 * token files), one per component (its folder, docs.json aside), one per guidance file. Code a designer does not
 * review (apps, scripts, release notes, tests) is not a change here: developers review it on GitHub.
 */
export function splitChanges(x: {
  files: { filename: string; status?: string }[];
  /** The token review rows (path and kind), or null when it is not read or failed. */
  tokens?: { path: string; kind: 'added' | 'removed' | 'changed' }[] | null;
  /** Guidance meta per docs.json path, once read. */
  guidanceMeta?: Record<string, string>;
}): ReviewChange[] {
  const out: ReviewChange[] = [];
  const tokenFiles = x.files.filter((f) => TOKEN_FILE.test(f.filename)).map((f) => f.filename);
  if (tokenFiles.length) {
    if (x.tokens?.length) {
      const groups = new Map<string, { path: string; kind: string }[]>();
      for (const t of x.tokens) {
        const g = tokenGroup(t.path);
        groups.set(g, [...(groups.get(g) ?? []), t]);
      }
      for (const [g, rows] of groups) {
        const paths = [...new Set(rows.map((r) => r.path))];
        // A token shows once per mode in the review: count tokens, by their most telling kind.
        const kinds = paths.map((p) => {
          const k = rows.filter((r) => r.path === p).map((r) => r.kind);
          return k.includes('added') ? 'added' : k.includes('removed') ? 'removed' : 'changed';
        });
        out.push({ id: `tokens:${g}`, kind: 'tokens', title: g, meta: counts(kinds), paths: tokenFiles, tokens: paths });
      }
    } else out.push({ id: 'tokens:all', kind: 'tokens', title: 'Tokens', meta: `${tokenFiles.length} token ${tokenFiles.length === 1 ? 'file' : 'files'}`, paths: tokenFiles, tokens: [] });
  }
  const components = new Map<string, { filename: string; status?: string }[]>();
  for (const f of x.files) {
    if (DOCS_FILE.test(f.filename) || /\.(test|stories)\.tsx?$/.test(f.filename)) continue;
    const m = COMPONENT_DIR.exec(f.filename);
    if (m && f.filename.includes('packages/react/')) components.set(m[1]!, [...(components.get(m[1]!) ?? []), f]);
  }
  for (const [name, fs] of [...components].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push({ id: `component:${name}`, kind: 'component', title: name, meta: fs.every((f) => f.status === 'added') ? 'new component' : 'changed', paths: fs.map((f) => f.filename), component: name });
  }
  for (const f of x.files) {
    const m = DOCS_FILE.exec(f.filename);
    if (!m || f.status === 'removed') continue;
    out.push({ id: `guidance:${m[1]}`, kind: 'guidance', title: `${m[1]} guidance`, meta: x.guidanceMeta?.[f.filename] ?? (f.status === 'added' ? 'new guidance' : 'changed'), paths: [f.filename], component: m[1] });
  }
  return out;
}

/**
 * A token value in words, as the mockups show it ("White" becomes "Ink 50"): an alias by its last two parts without
 * the palette or color prefix ("{palette.neutral.50}" is "Neutral 50", "{color.agent.surface}" is "Agent surface"),
 * else the value as written. The full value stays in the tooltip.
 */
export function valueName(v: { alias?: string | null; css?: string | null }): string {
  if (!v.alias) return v.css ?? '';
  const parts = v.alias.split('.').filter((p) => !['palette', 'color', 'colors'].includes(p));
  const words = parts.slice(-2).join(' ').replace(/[-_]/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : v.alias;
}

/** Changes grouped for the outline, in the order Tokens, Components, Guidance; empty groups left out. */
export function changeGroups(changes: ReviewChange[]): { kind: ChangeKind; label: string; changes: ReviewChange[] }[] {
  return (['tokens', 'component', 'guidance'] as ChangeKind[]).map((kind) => ({ kind, label: CHANGE_GROUP[kind], changes: changes.filter((c) => c.kind === kind) })).filter((g) => g.changes.length > 0);
}

/** The component a visual impact shot shows, from its story key ("components-badge--default"), else null. */
export function shotComponent(key: string, components: string[]): string | null {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hits = components.filter((c) => k.includes(c.toLowerCase()));
  // The longest name wins: "ButtonGroup" over "Button".
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Looked at: a reading aid on a busy branch, per viewer, never an approval

export const LOOKED_KEY = 'bridge.review.looked.v1';

type LookedStore = Record<string, string[]>;

function parseLooked(raw: string | null): LookedStore {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, ids]) => Array.isArray(ids)).map(([k, ids]) => [k, (ids as unknown[]).filter((i): i is string => typeof i === 'string')]));
  } catch {
    return {};
  }
}

/** The changes of branch `pr` the viewer marked as looked at. */
export const readLooked = (raw: string | null, pr: number): Set<string> => new Set(parseLooked(raw)[String(pr)] ?? []);

/** The store with branch `pr` set to `ids` (an empty set removes the branch). */
export function writeLooked(raw: string | null, pr: number, ids: Set<string>): string {
  const all = parseLooked(raw);
  if (ids.size) all[String(pr)] = [...ids];
  else delete all[String(pr)];
  return JSON.stringify(all);
}

export interface LookedProgress {
  total: number;
  looked: number;
  left: number;
  /** "2 of 5 looked at". */
  line: string;
  /** "3 changes left to look at", null when none is left. */
  leftLine: string | null;
}

export function lookedProgress(changes: ReviewChange[], looked: Set<string>): LookedProgress {
  const total = changes.length;
  const n = changes.filter((c) => looked.has(c.id)).length;
  const left = total - n;
  return { total, looked: n, left, line: `${n} of ${total} looked at`, leftLine: left ? `${left} ${left === 1 ? 'change' : 'changes'} left to look at` : null };
}

/** The change shown open: the one the viewer picked, else the first not looked at, else the first. */
export function currentChange(changes: ReviewChange[], looked: Set<string>, picked: string | null): string | null {
  if (picked && changes.some((c) => c.id === picked)) return picked;
  return (changes.find((c) => !looked.has(c.id)) ?? changes[0])?.id ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Conversation: people only

export type CommentRole = 'author' | 'reviewer' | null;

export interface ConvInput {
  login: string | null;
  at: string;
  body: string;
  /** COMMENT, APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, OVERRIDE, OVERRIDE_REFUSED. */
  kind: string;
  /** A comment on a file (a line comment): the change it belongs to. */
  path?: string | null;
}

export interface ConvEntry extends ConvInput {
  role: CommentRole;
  /** What shows as the text: the body, or what the review did when it says nothing. */
  text: string;
}

/** GitHub apps and bots ("vercel[bot]", "github-actions[bot]"): what they post shows elsewhere on the page. */
export const isBot = (login: string | null | undefined) => /\[bot\]$/i.test(login ?? '');

const SAID: Record<string, string> = {
  APPROVED: 'Approved.',
  CHANGES_REQUESTED: 'Suggested changes.',
  DISMISSED: 'Review dismissed.',
  OVERRIDE: 'Merged it as owner override.',
  OVERRIDE_REFUSED: 'Tried an owner override.',
};

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Author, reviewer (an approver of this branch or someone who reviewed it), or no role. */
export function commentRole(login: string | null, ctx: { author: string; reviewers: string[] }): CommentRole {
  if (same(login, ctx.author)) return 'author';
  if (ctx.reviewers.some((r) => same(r.replace(/^@/, ''), login))) return 'reviewer';
  return null;
}

/**
 * The conversation, oldest first, without bots and without empty "commented" reviews (their line comments are
 * listed on their own). `latest` shows inline; `earlier` stays behind "Show N earlier comments".
 */
export function conversation(entries: ConvInput[], ctx: { author: string; reviewers: string[] }): { count: number; latest: ConvEntry | null; earlier: ConvEntry[]; all: ConvEntry[] } {
  const reviewed = entries.filter((e) => e.kind !== 'COMMENT' && e.kind !== 'OVERRIDE' && e.kind !== 'OVERRIDE_REFUSED').map((e) => e.login ?? '');
  const people = { author: ctx.author, reviewers: [...ctx.reviewers, ...reviewed] };
  const all = entries
    .filter((e) => !isBot(e.login))
    .map((e) => ({ ...e, text: e.body.trim() || SAID[e.kind] || '', role: commentRole(e.login, people) }))
    .filter((e) => e.text)
    .sort((a, b) => a.at.localeCompare(b.at));
  return { count: all.length, latest: all[all.length - 1] ?? null, earlier: all.slice(0, -1), all };
}

export const ROLE_LABEL: Record<Exclude<CommentRole, null>, string> = { author: 'author', reviewer: 'reviewer' };

// ---------------------------------------------------------------------------------------------------------------
// Checks, in one line

export interface ChecksLine {
  state: 'pass' | 'fail' | 'pending' | 'none';
  text: string;
  /** The rows behind it, for the expandable details. */
  rows: { label: string; state: 'pass' | 'fail' | 'pending'; text: string }[];
}

/**
 * The checks of a change in one line, and the rows behind it. A designer (`forDesigner`) reads the design rules as they
 * are and the developer checks as who acts on them: "Code checks: a developer is on it.", never which tests fail
 * (that stays in the developers' part of the page).
 */
export function checksLine(story: CheckStory, opts: { forDesigner?: boolean } = {}): ChecksLine {
  const dev = story.developer && opts.forDesigner ? { ...story.developer, text: story.developer.state === 'fail' ? 'A developer is on it.' : story.developer.text } : story.developer;
  const devLabel = opts.forDesigner ? 'Code checks' : 'Developer tests';
  const rows = [story.design ? { label: 'Design rules', ...story.design } : null, dev ? { label: devLabel, ...dev } : null].filter((r): r is NonNullable<typeof r> => Boolean(r));
  // No automated checks is a calm state of its own (core CI_STATE_LABEL): the approvals still say where it stands.
  if (!rows.length) return { state: 'none', text: `${CI_STATE_LABEL.none}.`, rows };
  const fail = rows.filter((r) => r.state === 'fail');
  if (fail.length) return { state: 'fail', text: fail.map((r) => (opts.forDesigner && r.label === devLabel ? 'Code checks fail: a developer is on it.' : r.text)).join(' '), rows };
  if (rows.some((r) => r.state === 'pending')) return { state: 'pending', text: rows.find((r) => r.state === 'pending')!.text, rows };
  const contrast = story.design && /^(\d[\d,]*) contrast checks? still pass/.exec(story.design.text);
  return { state: 'pass', text: contrast ? `All ${contrast[1]} contrast checks pass` : 'All checks pass', rows };
}

// ---------------------------------------------------------------------------------------------------------------
// The who line under the title

/** "@ana" and "@ana-l" written in a sentence become names (never an @org/team). */
export function namesIn(text: string, nameOf: (login: string) => string): string {
  return text.replace(/(^|[^\w@./-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?)(?![\w/@.-])/g, (_m, pre: string, login: string) => `${pre}${nameOf(login)}`);
}

export function whoLine(x: {
  /** The author's display name. */
  author: string;
  /** Claude made it. */
  agent: boolean;
  /** The branch is guidance only. */
  guidanceOnly: boolean;
  /** The viewer can edit the guidance in place. */
  canEdit: boolean;
  /** The viewer is asked to review (their turn, not the author). */
  asked: boolean;
  lifecycle: Lifecycle;
  /** The status sentence (who acts now), names already in. */
  sentence: string;
}): { lead: string | null; rest: string } {
  if (x.lifecycle === 'ready' || x.lifecycle === 'draft') {
    if (x.agent && x.guidanceOnly) return { lead: 'Claude AI', rest: `drafted it from the code. New text is highlighted${x.canEdit ? '; click any part to edit it' : ''}.` };
    if (x.asked) return { lead: x.author, rest: 'asks for your review' };
  }
  return { lead: null, rest: x.sentence };
}

// ---------------------------------------------------------------------------------------------------------------
// The decision bar and "More actions"

export type PrimaryKind = 'approve' | 'approve-merge' | 'merge' | 'request-review' | 'reopen' | 'restart' | 'connect';

export interface ActionInput {
  lifecycle: Lifecycle;
  /** A GitHub account is connected. */
  connected: boolean;
  canWrite: boolean;
  isAuthor: boolean;
  /** The viewer can give a missing approval. */
  canApprove: boolean;
  /** Merging is allowed now (approvals, checks), and the viewer may merge. */
  canMerge: boolean;
  /** After the viewer's approval, merging would be allowed and the viewer may merge. */
  mergeAfterApprove: boolean;
  /** The owner override is the only way it ships: nobody else can give the missing approvals. */
  overrideOnly: boolean;
  /** The change shows on screen (visual impact). */
  visual: boolean;
  /** A product team can install it (preview packages). */
  shareable: boolean;
  exploration: boolean;
  /** The lifecycle action of a closed change (scripts/change-status): Reopen, Start again. */
  statusAction: 'reopen' | 'restart' | 'mark-ready' | null;
  /** A branch opened from Figma with the spec only (waiting-for-claude): a developer builds it, nothing to send yet. */
  claudeWaiting?: boolean;
  /** The review queue holds the view's primary (Approve and next): the bar's approval is secondary there. */
  inQueue?: boolean;
  /** False for an email contributor: no approve, suggest changes, merge or override (default true). */
  canReview?: boolean;
}

export interface ReviewActions {
  primary: { kind: PrimaryKind; label: string } | null;
  /** The bar shows the comment field. */
  comment: boolean;
  /** "Suggest changes" (request changes). */
  suggest: boolean;
  menu: {
    /** The one sentence that explains the owner override, when it is the only way. */
    override: string | null;
    share: boolean;
    draft: boolean;
    close: boolean;
  };
}

export const OVERRIDE_SENTENCE = 'Nobody else can give the missing approvals: merge it as owner, with a reason posted on the branch.';

const PRIMARY_LABEL: Record<PrimaryKind, string> = {
  approve: 'Approve',
  'approve-merge': 'Approve and merge',
  merge: 'Merge',
  'request-review': 'Send for review',
  reopen: 'Reopen',
  restart: 'Start again from this',
  connect: 'Connect GitHub to review',
};

export function reviewActions(x: ActionInput): ReviewActions {
  const open = x.lifecycle === 'ready' || x.lifecycle === 'waiting';
  const live = open || x.lifecycle === 'draft';
  const p = (kind: PrimaryKind) => ({ kind, label: PRIMARY_LABEL[kind] });
  let primary: ReviewActions['primary'] = null;
  const reviews = x.canReview !== false;
  if (!x.connected) primary = live ? p('connect') : null;
  else if (!live) primary = x.statusAction === 'reopen' ? p('reopen') : x.statusAction === 'restart' ? p('restart') : null;
  else if (x.lifecycle === 'draft') primary = x.isAuthor && x.canWrite && !x.exploration && !x.claudeWaiting ? p('request-review') : null;
  else if (!reviews) primary = null;
  else if (x.canApprove && !x.isAuthor) primary = x.mergeAfterApprove && x.canWrite ? p('approve-merge') : p('approve');
  else if (x.canMerge && x.canWrite) primary = p('merge');
  return {
    primary,
    comment: x.connected && live,
    suggest: x.connected && open && !x.isAuthor && reviews,
    menu: {
      override: x.connected && open && x.canWrite && reviews && x.overrideOnly && !x.canMerge ? OVERRIDE_SENTENCE : null,
      share: live && x.visual && x.shareable,
      draft: x.connected && x.isAuthor && open && !x.exploration && x.canWrite,
      close: x.connected && live && x.canWrite,
    },
  };
}

/** The Studio address of a branch review ("Link to this review"). */
export const reviewLink = (origin: string, pr: number) => `${origin}${studioHref(`changes/?pr=${pr}`)}`;
