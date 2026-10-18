// Try several changes together: the latest library plus the token edits of 2 to 4 open changes, combined in the
// browser. Nothing is written anywhere: no branch, no commit. Each change's own edits are what it did to its token
// files since it started (its start against its current version), so a change that is behind the library never
// undoes the library's newer values. Edits to the same token that agree are applied once; edits that disagree are a
// conflict the designer settles ("Use <change>'s"). Pure: no fetch, no DOM. Studio (Changes, the library views) and
// the admin's Bridge toolbar both run it.

import { emptyTokenFile, flattenTokens, parseTokenFile, serializeTokenFile, type TokenDocument } from './dtcg-codec';
import { takeMine } from './token-merge';
import { pathId } from './token-set';
import { EXT_ID, type FlatToken } from './types';

/** What one change brings: its token files where it started and now, and the token files it edits. */
export interface CombineSource {
  number: number;
  /** Token file texts where the change started (relative to the tokens root). Undefined: the file did not exist. */
  base: Record<string, string | undefined>;
  /** Token file texts in the change now. Undefined: the change removes the file. */
  head: Record<string, string | undefined>;
  /** Token files the change edits, relative to the tokens root. */
  files: string[];
}

export interface CombineEdit {
  /** `<file>#<token id>`: the same token in the same file across changes. */
  key: string;
  file: string;
  /** The token's path in the change (its old path when the change removes it). */
  path: string;
  change: number;
  /** The change's version of the token; undefined when the change removes it. */
  token: FlatToken | undefined;
}

export interface ChangeEdits {
  number: number;
  edits: CombineEdit[];
  /** Files that could not be read (not JSON). */
  problems: string[];
}

const idOf = (f: FlatToken) => {
  const id = f.extensions?.[EXT_ID];
  return typeof id === 'string' && id ? id : pathId(f.path);
};

function tokensOf(file: string, text: string | undefined, problems: string[], label: string): Map<string, FlatToken> {
  const out = new Map<string, FlatToken>();
  if (text === undefined) return out;
  try {
    for (const t of flattenTokens(parseTokenFile(file, text))) out.set(idOf(t), t);
  } catch (err) {
    problems.push(`${file} (${label}) is not valid JSON: ${(err as Error).message}`);
  }
  return out;
}

/** What a token is, for comparing two versions of it: its path, type, value and description. */
const shape = (t: FlatToken | undefined) => (t ? JSON.stringify([t.path, t.type ?? null, t.value, t.description ?? null]) : 'removed');
/** What a token shows, for comparing two changes' edits: removed, or its type and value. */
const look = (t: FlatToken | undefined) => (t ? JSON.stringify([t.path, t.type ?? null, t.value]) : 'removed');

/** The token edits of one change: every token whose version differs between where the change started and now. */
export function changeEdits(src: CombineSource): ChangeEdits {
  const problems: string[] = [];
  const edits: CombineEdit[] = [];
  for (const file of [...new Set(src.files)].sort()) {
    const before = tokensOf(file, src.base[file], problems, 'start');
    const after = tokensOf(file, src.head[file], problems, `change ${src.number}`);
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(id);
      const b = after.get(id);
      if (shape(a) === shape(b)) continue;
      edits.push({ key: `${file}#${id}`, file, path: (b ?? a)!.path, change: src.number, token: b });
    }
  }
  return { number: src.number, edits, problems };
}

/** One value a conflicting token can take, and the changes that set it. */
export interface CombineOption {
  changes: number[];
  token: FlatToken | undefined;
}

/** A token two or more changes set differently: the designer picks one change's value. */
export interface CombineConflict {
  key: string;
  file: string;
  path: string;
  /** Distinct values, in the order of the changes. */
  options: CombineOption[];
}

/** The pick of each conflict: the change whose value the combination uses. */
export type CombinePicks = Record<string, number>;

export interface Combination {
  /** Every token file of the latest library, with the combined edits applied (unchanged files as they are). */
  files: Record<string, string>;
  /** The changes combined, in order. */
  included: number[];
  /** Tokens the combination edits (one per token and file). */
  edits: number;
  conflicts: CombineConflict[];
  /** Conflicts without a pick that counts: left at the library's value ('skip') or given the first change's ('first'). */
  missing: CombineConflict[];
  /** Token path -> the changes whose value the combination uses for it. */
  from: Record<string, number[]>;
  problems: string[];
}

/** Edits grouped by token, in the order of the changes. */
function byToken(changes: ChangeEdits[]): Map<string, CombineEdit[]> {
  const out = new Map<string, CombineEdit[]>();
  for (const c of changes) for (const e of c.edits) out.set(e.key, [...(out.get(e.key) ?? []), e]);
  return out;
}

function optionsOf(edits: CombineEdit[]): CombineOption[] {
  const out: { look: string; option: CombineOption }[] = [];
  for (const e of edits) {
    const l = look(e.token);
    const hit = out.find((o) => o.look === l);
    if (hit) hit.option.changes.push(e.change);
    else out.push({ look: l, option: { changes: [e.change], token: e.token } });
  }
  return out.map((o) => o.option);
}

/** Tokens that two or more of these changes set differently. */
export function combineConflicts(changes: ChangeEdits[]): CombineConflict[] {
  const out: CombineConflict[] = [];
  for (const [key, edits] of byToken(changes)) {
    const options = optionsOf(edits);
    if (options.length > 1) out.push({ key, file: edits[0]!.file, path: edits[0]!.path, options });
  }
  return out;
}

/** The option a pick selects, or null when the picked change is not among them (not picked, or switched off). */
export function pickedOption(c: CombineConflict, picks: CombinePicks): CombineOption | null {
  const n = picks[c.key];
  return n === undefined ? null : (c.options.find((o) => o.changes.includes(n)) ?? null);
}

/** Conflicts that still need a pick. */
export const unpicked = (conflicts: CombineConflict[], picks: CombinePicks) => conflicts.filter((c) => !pickedOption(c, picks));

/**
 * The latest library plus the edits of the included changes (all of them by default, in their order). A conflict
 * uses the picked change's value. Without a pick that counts, `unpicked: 'skip'` (Studio, before opening) leaves the
 * token at the library's value and lists it in `missing`; `'first'` (the toolbar, when a picked change is switched
 * off) uses the first included change's value and still lists it.
 */
export function combineChanges(latest: Record<string, string>, changes: ChangeEdits[], picks: CombinePicks = {}, opts: { include?: number[]; unpicked?: 'skip' | 'first' } = {}): Combination {
  const on = opts.include ? changes.filter((c) => opts.include!.includes(c.number)) : changes;
  const problems = on.flatMap((c) => c.problems);
  const groups = byToken(on);
  const conflicts: CombineConflict[] = [];
  const missing: CombineConflict[] = [];
  const from: Record<string, number[]> = {};
  const docs = new Map<string, TokenDocument>();
  const docOf = (file: string): TokenDocument | null => {
    if (docs.has(file)) return docs.get(file)!;
    const text = latest[file];
    let doc: TokenDocument;
    try {
      doc = text === undefined ? emptyTokenFile(file) : parseTokenFile(file, text);
    } catch (err) {
      problems.push(`${file} (latest library) is not valid JSON: ${(err as Error).message}`);
      return null;
    }
    docs.set(file, doc);
    return doc;
  };
  for (const [key, edits] of groups) {
    const options = optionsOf(edits);
    let use: CombineOption | null = options[0]!;
    if (options.length > 1) {
      const conflict: CombineConflict = { key, file: edits[0]!.file, path: edits[0]!.path, options };
      conflicts.push(conflict);
      use = pickedOption(conflict, picks);
      if (!use) {
        missing.push(conflict);
        use = opts.unpicked === 'first' ? options[0]! : null;
      }
    }
    if (!use) continue;
    const doc = docOf(edits[0]!.file);
    if (!doc) continue;
    const existing = flattenTokens(doc).find((t) => idOf(t) === key.slice(key.indexOf('#') + 1));
    // A removal removes the library's token; an edit replaces it (or adds it when the library does not have it).
    takeMine(doc, use.token, existing);
    const path = use.token?.path ?? edits[0]!.path;
    from[path] = [...new Set([...(from[path] ?? []), ...use.changes])];
  }
  const files: Record<string, string> = { ...latest };
  for (const [file, doc] of docs) {
    if (latest[file] === undefined && flattenTokens(doc).length === 0) continue;
    files[file] = serializeTokenFile(doc);
  }
  return { files, included: on.map((c) => c.number), edits: groups.size, conflicts, missing, from, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Picks in an address: `118:semantic/light.tokens.json#path:color.bg.default~120:...`. The change number first, then
// the conflict key; entries joined by "~" (keys hold ":" and "#", never "~").

export function encodePicks(picks: CombinePicks): string {
  return Object.entries(picks)
    .filter(([, n]) => Number.isSafeInteger(n) && n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, n]) => `${n}:${key}`)
    .join('~');
}

export function decodePicks(raw: string | null | undefined): CombinePicks {
  const out: CombinePicks = {};
  for (const part of (raw ?? '').split('~')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const n = Number(part.slice(0, i));
    const key = part.slice(i + 1);
    if (/^\d{1,7}$/.test(part.slice(0, i)) && n > 0 && key.includes('#')) out[key] = n;
  }
  return out;
}
