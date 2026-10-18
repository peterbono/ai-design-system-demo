// Try several changes together, the Studio rules and words: which open changes can be combined (token changes only;
// code would need a real combined build), the selection on the Changes list (2 to 4), the conflict rows ("Use
// <change>'s"), the contrast guardrail of the combination, and the two ways to open it: the admin demo with the
// Bridge toolbar (`?bridge=101,118,120`) and the library views (`?change=101,118`, lib/view-scope). Pure, tested in
// combine-changes.test.ts; the reads live in scripts/combine-read.ts and the UI in components/ds/studio/CombineChanges.
import { buildTokenSet, combineChanges, encodePicks, type CombineConflict, type CombinePicks, type LayoutOptions, type CombineEdit, type TokenSet } from '@bridge-ds/core';
import { fileContext, sideValue } from './library-sync';
import type { ShownValue, TokenReview } from './token-review';
import { viewTitle } from './view-scope';

export const MIN_TOGETHER = 2;

/** The Changes list announces each paint: the open rows it shows, each with a checkbox slot (data-together-slot). */
export const ROWS_EVENT = 'bridge:together-rows';

export interface RowsDetail {
  /** False under another status than Open, or with fewer than 2 rows: nothing to combine. */
  show: boolean;
  listed: { number: number; title: string; sha: string }[];
}
export const MAX_TOGETHER = 4;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Said on the row of a change that edits more than tokens. */
export const CODE_LINE = "This one changes code, so it can't be combined here.";

/**
 * Whether a change only edits tokens: token files under the tokens root, the contrast gate and release notes
 * (changesets). Anything else is code. No file read yet (or none) is not a token change.
 */
export function onlyTokens(files: string[], tokensRoot: string): boolean {
  const root = `${tokensRoot.replace(/^\/+|\/+$/g, '')}/`;
  return files.length > 0 && files.every((f) => (f.startsWith(root) && f.endsWith('.tokens.json')) || /contrast\.checks\.json$/.test(f) || f.startsWith('.changeset/'));
}

/** Token files a change edits, relative to the tokens root. */
export function tokenFilesOf(files: string[], tokensRoot: string): string[] {
  const root = `${tokensRoot.replace(/^\/+|\/+$/g, '')}/`;
  return files.filter((f) => f.startsWith(root) && f.endsWith('.tokens.json')).map((f) => f.slice(root.length));
}

// ---------------------------------------------------------------------------------------------------------------
// Selection on the Changes list

export type Toggle = { selected: number[]; refused: null } | { selected: number[]; refused: 'full' };

/** Checks or unchecks a change, in the order they were picked; a fifth is refused (the bar says why). */
export function toggleChange(selected: number[], n: number, on: boolean): Toggle {
  if (!on) return { selected: selected.filter((x) => x !== n), refused: null };
  if (selected.includes(n)) return { selected, refused: null };
  if (selected.length >= MAX_TOGETHER) return { selected, refused: 'full' };
  return { selected: [...selected, n], refused: null };
}

/** Only changes still in the list stay selected (one shipped or closed meanwhile goes). */
export const keepListed = (selected: number[], listed: number[]) => selected.filter((n) => listed.includes(n));

export const tryLabel = (n: number) => `Try ${n} changes together`;
export const VIEW_LABEL = 'View the library with them';

/** The bar's sentence before the combination is read: what to do next. */
export function selectionLine(count: number, refused: boolean): string {
  if (refused) return `Up to ${MAX_TOGETHER} changes at a time. Uncheck one to add another.`;
  if (count === 0) return `Check 2 to ${MAX_TOGETHER} token changes to try them together.`;
  if (count === 1) return 'Check one more token change to try them together.';
  return `Combining ${count} changes.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The combination, in words

export interface TogetherChange {
  number: number;
  title: string;
}

/** "Darker default background and Rounder buttons", "A, B and 1 other". */
export function namesOf(changes: TogetherChange[]): string {
  const names = changes.map((c) => viewTitle(c.title));
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}`;
}

/** "Combines 5 token edits from 3 changes." What the combination does, from its own numbers. */
export function combineSummary(x: { changes: number; edits: number; conflicts: number; missing: number }): string {
  const base = `Combines ${plural(x.edits, 'token edit')} from ${plural(x.changes, 'change')}.`;
  if (!x.conflicts) return base;
  if (x.missing) return `${base} ${x.missing === 1 ? '1 token has' : `${x.missing} tokens have`} different values in these changes: pick which one to use.`;
  return `${base} You picked the value of ${plural(x.conflicts, 'token')} they set differently.`;
}

export interface TogetherGuardrail {
  ok: boolean;
  sentence: string;
  failing: { pair: string; where: string; ratio: string; min: string }[];
}

/** The contrast checks of the combined tokens, counted on the combination itself (never one change's numbers). */
export function togetherGuardrail(review: Pick<TokenReview, 'contrast' | 'checked' | 'problems'>, max = 4): TogetherGuardrail {
  const fails = review.contrast.filter((p) => p.after < p.min);
  const failing = fails.slice(0, max).map((p) => ({ pair: `${p.fg} on ${p.bg}`, where: p.where, ratio: `${p.after.toFixed(2)}:1`, min: `${p.min}:1` }));
  if (review.problems.length) return { ok: false, sentence: `These changes do not build together: ${review.problems[0]}`, failing };
  if (fails.length) return { ok: false, sentence: `${plural(fails.length, 'contrast check')} ${fails.length === 1 ? 'fails' : 'fail'} with these changes together. The token build would block ${fails.length === 1 ? 'it' : 'them'}: try another pick, or fix it in one of the changes.`, failing };
  const checked = review.checked ?? 0;
  return { ok: true, sentence: checked ? `All ${checked} contrast checks pass with these changes together.` : 'No contrast check depends on these tokens.', failing };
}

// ---------------------------------------------------------------------------------------------------------------
// Conflict rows: one per token two changes set differently, one choice per change ("Use Darker canvas's").

export interface TogetherOption {
  change: number;
  /** "Use Darker canvas's". */
  label: string;
  value: ShownValue | null;
}

export interface TogetherRow {
  key: string;
  /** Token name. */
  name: string;
  /** Mode of the file: "Light", "Ocean dark", or ''. */
  context: string;
  options: TogetherOption[];
}

/** "Darker default background" cut at a word to fit a radio label. */
export function shortTitle(title: string, max = 32): string {
  const t = viewTitle(title);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 8)).replace(/[\s,.:;]+$/, '')}…`;
}

/** The radio label of one change's value. */
export const useLabel = (title: string) => `Use ${shortTitle(title)}'s`;

/**
 * The rows the designer picks in. Each option's value is resolved in the latest library with only that edit applied
 * (an alias shows its swatch). `edits` gives each change's version of the token.
 */
export function togetherRows(conflicts: CombineConflict[], ctx: { latest: Record<string, string>; options: LayoutOptions; titles: Map<number, string> }): TogetherRow[] {
  const latestSet = buildTokenSet(ctx.latest, ctx.options);
  return conflicts.map((c) => ({
    key: c.key,
    name: c.path,
    context: fileContext(latestSet, c.file),
    options: c.options.flatMap((o) =>
      o.changes.map((change) => {
        const edit: CombineEdit = { key: c.key, file: c.file, path: c.path, change, token: o.token };
        const set: TokenSet = buildTokenSet(combineChanges(ctx.latest, [{ number: change, edits: [edit], problems: [] }]).files, ctx.options);
        return { change, label: useLabel(ctx.titles.get(change) ?? `change #${change}`), value: sideValue(set, c.file, o.token) };
      }),
    ),
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Where the combination opens

/** A list of changes in an address: "101,118,120" (commas stay readable). */
export const changeList = (numbers: number[]) => numbers.join(',');

/**
 * The admin demo with the Bridge toolbar on the combination: production (no preview holds all of them), the tokens
 * applied live. `bridge-use` carries the picks.
 */
export function tryTogetherUrl(admin: string, numbers: number[], picks: CombinePicks): string {
  const url = new URL(admin);
  url.pathname = '/';
  url.hash = '';
  const use = encodePicks(picks);
  url.search = `?bridge=${changeList(numbers)}${use ? `&bridge-use=${encodeURIComponent(use)}` : ''}`;
  return url.href;
}
