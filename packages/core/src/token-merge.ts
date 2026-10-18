// Three-way merge of token files: a change (mine) against the latest library (theirs), from the commit they share
// (base). Same rules as the Figma sync (diff-engine threeWayDiff): a token changed on one side only takes that side,
// a token changed on both sides the same way is unchanged, and a token changed on both sides differently is a
// conflict the designer decides ("Keep mine" or "Use the library's"). A token removed on one side and changed on the
// other has no default: the designer must pick.
//
// Works file by file on the DTCG text, so each mode (semantic/light, semantic/dark, a brand override file) is merged
// on its own, and edits go through the format-preserving codec: untouched tokens stay byte for byte as the library
// has them. Pure: no fetch, no DOM.

import { emptyTokenFile, flattenTokens, parseTokenFile, removeToken, serializeTokenFile, upsertToken, type TokenDocument } from './dtcg-codec';
import { threeWayDiff, type DiffEntry } from './diff-engine';
import { pathId } from './token-set';
import { EXT_ID, EXT_SCOPES, SINGLE_MODE, type FlatToken, type LogicalToken } from './types';

/** Which side a conflict keeps: this change ("Keep mine") or the latest library ("Use the library's"). */
export type MergeSide = 'mine' | 'theirs';

export interface TokenMergeConflict {
  /** Stable key for the choice: `<file>#<token id>`. */
  key: string;
  /** Token file, relative to the tokens root. */
  file: string;
  /** Display path: this change's name, else the library's, else the shared one. */
  path: string;
  base?: FlatToken | undefined;
  mine?: FlatToken | undefined;
  theirs?: FlatToken | undefined;
  /** The side that removed the token while the other changed it. Null when both sides kept it. */
  removedOn: MergeSide | null;
  /** "Keep mine" by default; null when the token was removed on one side and changed on the other. */
  defaultChoice: MergeSide | null;
}

export interface TokenMergePlan {
  /** Token files both sides changed, relative to the tokens root. */
  files: string[];
  conflicts: TokenMergeConflict[];
  /** Tokens only this change touched: applied on top of the library as they are. */
  mineOnly: number;
  /** Tokens only the library touched: kept as the library has them. */
  theirsOnly: number;
  /** Files that could not be read (not JSON): nothing can be merged while there is one. */
  problems: string[];
}

export interface TokenMergeInput {
  /** File texts at the commit both sides share. Undefined: the file did not exist there. */
  base: Record<string, string | undefined>;
  /** File texts in the change. */
  mine: Record<string, string | undefined>;
  /** File texts in the latest library. */
  theirs: Record<string, string | undefined>;
  /** Token files both sides changed (the others need no merge). */
  files: string[];
}

export type MergeChoices = Record<string, MergeSide | undefined>;

interface Side {
  doc: TokenDocument | undefined;
  flat: Map<string, FlatToken>;
  logical: Map<string, LogicalToken>;
}

const idOf = (f: FlatToken) => {
  const id = f.extensions?.[EXT_ID];
  return typeof id === 'string' && id ? id : pathId(f.path);
};

/** One flat token as a single-mode logical token, so threeWayDiff compares path, type, value, description and scopes. */
function logical(f: FlatToken): LogicalToken {
  const scopes = f.extensions?.[EXT_SCOPES];
  return {
    id: idOf(f),
    path: f.path,
    type: f.type ?? 'unknown',
    // One file holds one tier: the tier only feeds default scopes, the same on every side.
    tier: 'primitive',
    values: { [SINGLE_MODE]: f.value },
    description: f.description,
    scopes: Array.isArray(scopes) ? scopes.map(String) : undefined,
    files: { [SINGLE_MODE]: f.file },
  };
}

function readSide(file: string, text: string | undefined, problems: string[], label: string): Side {
  const side: Side = { doc: undefined, flat: new Map(), logical: new Map() };
  if (text === undefined) return side;
  try {
    side.doc = parseTokenFile(file, text);
  } catch (err) {
    problems.push(`${file} (${label}) is not valid JSON: ${(err as Error).message}`);
    return side;
  }
  for (const f of flattenTokens(side.doc)) {
    const id = idOf(f);
    side.flat.set(id, f);
    side.logical.set(id, logical(f));
  }
  return side;
}

interface FileDiff {
  file: string;
  base: Side;
  mine: Side;
  theirs: Side;
  local: DiffEntry[];
  remote: DiffEntry[];
  conflicts: DiffEntry[];
}

function diffFile(input: TokenMergeInput, file: string, problems: string[]): FileDiff {
  const base = readSide(file, input.base[file], problems, 'shared start');
  const mine = readSide(file, input.mine[file], problems, 'this change');
  const theirs = readSide(file, input.theirs[file], problems, 'latest library');
  const r = threeWayDiff(base.logical, mine.logical, theirs.logical);
  return { file, base, mine, theirs, local: r.local, remote: r.remote, conflicts: r.conflicts };
}

/** The side that removed a token the other side changed, or null. */
export function removedSide(c: { base?: unknown; mine?: unknown; theirs?: unknown }): MergeSide | null {
  if (!c.base) return null;
  if (!c.mine && c.theirs) return 'mine';
  if (!c.theirs && c.mine) return 'theirs';
  return null;
}

/** "Keep mine" by default, except for a token removed on one side and changed on the other: no default there. */
export const defaultChoiceFor = (c: { base?: unknown; mine?: unknown; theirs?: unknown }): MergeSide | null => (removedSide(c) ? null : 'mine');

/** What both sides did to the token files they both changed, and which tokens need a decision. */
export function planTokenMerge(input: TokenMergeInput): TokenMergePlan {
  const problems: string[] = [];
  const files = [...new Set(input.files)].sort();
  const conflicts: TokenMergeConflict[] = [];
  let mineOnly = 0;
  let theirsOnly = 0;
  for (const file of files) {
    const d = diffFile(input, file, problems);
    mineOnly += d.local.length;
    theirsOnly += d.remote.length;
    for (const e of d.conflicts) {
      const c = { base: d.base.flat.get(e.id), mine: d.mine.flat.get(e.id), theirs: d.theirs.flat.get(e.id) };
      conflicts.push({ key: `${file}#${e.id}`, file, path: (c.mine ?? c.theirs ?? c.base)!.path, ...c, removedOn: removedSide(c), defaultChoice: defaultChoiceFor(c) });
    }
  }
  return { files, conflicts, mineOnly, theirsOnly, problems };
}

/** The side a conflict keeps: the designer's pick, else its default (null: still to pick). */
export const choiceFor = (c: TokenMergeConflict, choices: MergeChoices): MergeSide | null => choices[c.key] ?? c.defaultChoice;

/** Conflicts that still need a pick: removed on one side, changed on the other, and not decided yet. */
export function missingChoices(plan: Pick<TokenMergePlan, 'conflicts'>, choices: MergeChoices): TokenMergeConflict[] {
  return plan.conflicts.filter((c) => choiceFor(c, choices) === null);
}

/** Puts this change's version of a token into the library's file: its value, type, description and extensions. Also used by token-combine. */
export function takeMine(doc: TokenDocument, mine: FlatToken | undefined, existing: FlatToken | undefined): boolean {
  if (!mine) return existing ? removeToken(doc, existing.path) : false;
  let changed = false;
  if (existing && existing.path !== mine.path) changed = removeToken(doc, existing.path) || changed;
  // Extension keys the library has and this change does not are removed, so the token reads as in the change.
  const extensions: Record<string, unknown> = {};
  for (const k of Object.keys(existing?.path === mine.path ? (existing.extensions ?? {}) : {})) extensions[k] = undefined;
  Object.assign(extensions, mine.extensions ?? {});
  return upsertToken(doc, mine.path, { type: mine.type, value: mine.value, description: mine.description, extensions }) || changed;
}

export interface TokenMergeResult {
  /** Merged text per file (relative to the tokens root); null when the merged file holds no token and is removed. */
  files: Record<string, string | null>;
  /** How many conflicts kept each side. */
  kept: Record<MergeSide, number>;
}

/**
 * The merged token files: the latest library's text, plus every token only this change touched, plus each conflict
 * as chosen. Throws when a file could not be read or a conflict still needs a pick.
 */
export function applyTokenMerge(input: TokenMergeInput, choices: MergeChoices): TokenMergeResult {
  const plan = planTokenMerge(input);
  if (plan.problems.length) throw new Error(plan.problems[0]);
  const missing = missingChoices(plan, choices);
  if (missing.length) throw new Error(`Pick a value for ${missing.map((c) => c.path).join(', ')} first.`);
  const byKey = new Map(plan.conflicts.map((c) => [c.key, c]));
  const kept: Record<MergeSide, number> = { mine: 0, theirs: 0 };
  const files: Record<string, string | null> = {};
  for (const file of plan.files) {
    const d = diffFile(input, file, []);
    const doc = d.theirs.doc ?? emptyTokenFile(file);
    for (const e of d.local) takeMine(doc, d.mine.flat.get(e.id), d.theirs.flat.get(e.id) ?? d.base.flat.get(e.id));
    for (const e of d.conflicts) {
      const side = choiceFor(byKey.get(`${file}#${e.id}`)!, choices)!;
      kept[side]++;
      if (side === 'mine') takeMine(doc, d.mine.flat.get(e.id), d.theirs.flat.get(e.id));
    }
    const empty = flattenTokens(doc).length === 0;
    files[file] = empty && (input.theirs[file] === undefined || input.mine[file] === undefined) ? null : serializeTokenFile(doc);
  }
  return { files, kept };
}
