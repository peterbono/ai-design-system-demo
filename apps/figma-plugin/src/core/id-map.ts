// Stable identity of tokens across renames.
//
// Every variable DS Bridge writes carries a token id in its plugin data. The id is the token's
// `$extensions["com.dsbridge.id"]` when the file declares one, otherwise "path:<path>". Matching is
// by id first, so renaming a variable in Figma is a rename, not a delete plus an add. Only renamed
// (or re-identified) tokens get the extension written into Git, which keeps the files lean.
//
// Variables created in Figma have no id. They are matched by name, then, as a last resort, a
// heuristic proposes "this looks like a rename" (same type, same values, similar path). Heuristic
// matches are suggestions only: the user confirms each one.

import { pathId } from './token-set';
import type { LogicalToken } from './types';
import { valuesEqual } from './values';

export interface RenameSuggestion {
  /** Id the Figma variable currently has (derived from its new name). */
  figmaId: string;
  /** Id of the Git token it probably is. */
  gitId: string;
  fromPath: string;
  toPath: string;
  similarity: number;
}

export interface ReconcileResult {
  tokens: LogicalToken[];
  /** Figma tokens that adopted a Git id because their names matched (no plugin data yet). */
  adoptedByName: string[];
  suggestions: RenameSuggestion[];
}

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export function pathSimilarity(a: string, b: string): number {
  const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
  const leafA = a.slice(a.lastIndexOf('.') + 1);
  const leafB = b.slice(b.lastIndexOf('.') + 1);
  return leafA === leafB ? Math.max(ratio, 0.75) : ratio;
}

export const SIMILARITY_THRESHOLD = 0.5;

function sameContent(a: LogicalToken, b: LogicalToken): boolean {
  if (a.type !== b.type || a.tier !== b.tier) return false;
  const modes = new Set([...Object.keys(a.values), ...Object.keys(b.values)]);
  for (const m of modes) if (!valuesEqual(a.type, a.values[m], b.values[m])) return false;
  return true;
}

/**
 * Align Figma token ids with Git ids. `git` is every token known on the Git side (base and head).
 * Heuristic candidates are restricted to Git tokens that no Figma variable claims.
 */
export function reconcileIds(figma: LogicalToken[], git: LogicalToken[]): ReconcileResult {
  const gitById = new Map<string, LogicalToken>();
  const gitByPath = new Map<string, LogicalToken>();
  for (const t of git) {
    if (!gitById.has(t.id)) gitById.set(t.id, t);
    if (!gitByPath.has(t.path)) gitByPath.set(t.path, t);
  }
  const claimed = new Set(figma.filter((t) => gitById.has(t.id)).map((t) => t.id));
  const adoptedByName: string[] = [];
  const tokens = figma.map((t) => ({ ...t }));

  for (const t of tokens) {
    if (gitById.has(t.id)) continue;
    const byName = gitByPath.get(t.path);
    if (byName && !claimed.has(byName.id) && byName.type === t.type) {
      t.id = byName.id;
      claimed.add(byName.id);
      adoptedByName.push(t.id);
    }
  }

  const suggestions: RenameSuggestion[] = [];
  const unclaimedGit = [...gitById.values()].filter((g) => !claimed.has(g.id));
  for (const t of tokens) {
    if (gitById.has(t.id)) continue;
    let best: RenameSuggestion | undefined;
    for (const g of unclaimedGit) {
      if (!sameContent(t, g)) continue;
      const similarity = pathSimilarity(t.path, g.path);
      if (similarity < SIMILARITY_THRESHOLD) continue;
      if (!best || similarity > best.similarity) {
        best = { figmaId: t.id, gitId: g.id, fromPath: g.path, toPath: t.path, similarity: Math.round(similarity * 100) / 100 };
      }
    }
    if (best) suggestions.push(best);
  }
  // One suggestion per Git token: keep the most similar.
  const byGit = new Map<string, RenameSuggestion>();
  for (const s of suggestions) {
    const prev = byGit.get(s.gitId);
    if (!prev || s.similarity > prev.similarity) byGit.set(s.gitId, s);
  }
  return { tokens, adoptedByName, suggestions: [...byGit.values()] };
}

/** Apply the rename suggestions the user confirmed: the Figma token takes the Git id. */
export function applyConfirmedRenames(tokens: LogicalToken[], confirmed: RenameSuggestion[]): LogicalToken[] {
  const map = new Map(confirmed.map((s) => [s.figmaId, s.gitId]));
  return tokens.map((t) => (map.has(t.id) ? { ...t, id: map.get(t.id)! } : t));
}

/**
 * Id to write into `$extensions["com.dsbridge.id"]`: only needed when the id no longer matches
 * the default derived from the path (after a rename). Undefined means "do not write".
 */
export function idExtensionFor(t: LogicalToken): string | undefined {
  return t.id === pathId(t.path) ? undefined : t.id;
}
