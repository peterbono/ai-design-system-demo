// Three-way diff per token.
//
//   base  = tokens at the commit the Figma file was last pulled from (stored baseSha)
//   figma = tokens read from Figma variables now
//   head  = tokens on the main branch now
//
// A side "changed" a token when it differs from base. Figma-only changes are local edits (they go
// into the PR). Main-only changes are upstream edits (a pull brings them in; a push keeps them).
// When both sides changed the same token differently, it is a conflict and the user decides.
// Without a base (first sync), every difference between Figma and main is a conflict.

import { effectiveScopes, sameScopes } from './scopes';
import type { LogicalToken } from './types';
import { valuesEqual } from './values';

export type ChangeKind = 'added' | 'changed' | 'renamed' | 'removed';

export interface FieldChange {
  field: 'path' | 'type' | 'value' | 'description' | 'scopes';
  /** Mode key for value changes. */
  mode?: string;
  before: unknown;
  after: unknown;
}

export interface SideChange {
  kind: ChangeKind;
  fields: FieldChange[];
}

export interface DiffEntry {
  id: string;
  /** Display path: the newest name on the side that changed. */
  path: string;
  base?: LogicalToken | undefined;
  figma?: LogicalToken | undefined;
  head?: LogicalToken | undefined;
  /** Change made in Figma (base -> figma). */
  local?: SideChange | undefined;
  /** Change made on main (base -> head). */
  remote?: SideChange | undefined;
  conflict: boolean;
}

export interface ThreeWayResult {
  /** Figma-side changes that main did not touch: candidates for the PR. */
  local: DiffEntry[];
  /** Main-side changes that Figma did not touch: candidates for a pull. */
  remote: DiffEntry[];
  /** Both sides changed the same token differently. */
  conflicts: DiffEntry[];
  unchanged: number;
}

const normDesc = (d: string | undefined) => (d ?? '').trim();

export function fieldChanges(a: LogicalToken, b: LogicalToken): FieldChange[] {
  const out: FieldChange[] = [];
  if (a.path !== b.path) out.push({ field: 'path', before: a.path, after: b.path });
  if (a.type !== b.type) out.push({ field: 'type', before: a.type, after: b.type });
  const modes = [...new Set([...Object.keys(a.values), ...Object.keys(b.values)])];
  for (const mode of modes) {
    if (!valuesEqual(b.type, a.values[mode], b.values[mode])) out.push({ field: 'value', mode, before: a.values[mode], after: b.values[mode] });
  }
  if (normDesc(a.description) !== normDesc(b.description)) out.push({ field: 'description', before: a.description, after: b.description });
  const sa = effectiveScopes(a);
  const sb = effectiveScopes(b);
  if (!sameScopes(sa, sb)) out.push({ field: 'scopes', before: sa, after: sb });
  return out;
}

export function sameToken(a: LogicalToken | undefined, b: LogicalToken | undefined): boolean {
  if (!a || !b) return a === b;
  return fieldChanges(a, b).length === 0;
}

function sideChange(from: LogicalToken | undefined, to: LogicalToken | undefined): SideChange | undefined {
  if (!from && !to) return undefined;
  if (!from) return { kind: 'added', fields: [] };
  if (!to) return { kind: 'removed', fields: [] };
  const fields = fieldChanges(from, to);
  if (!fields.length) return undefined;
  return { kind: fields.some((f) => f.field === 'path') ? 'renamed' : 'changed', fields };
}

/** `base` is undefined when the file was never pulled. Maps are keyed by token id. */
export function threeWayDiff(
  base: Map<string, LogicalToken> | undefined,
  figma: Map<string, LogicalToken>,
  head: Map<string, LogicalToken>,
): ThreeWayResult {
  const ids = new Set<string>([...(base?.keys() ?? []), ...figma.keys(), ...head.keys()]);
  const result: ThreeWayResult = { local: [], remote: [], conflicts: [], unchanged: 0 };
  for (const id of [...ids].sort()) {
    const b = base?.get(id);
    const f = figma.get(id);
    const h = head.get(id);
    const local = sideChange(b, f);
    const remote = sideChange(b, h);
    if ((!local && !remote) || (f && h && sameToken(f, h)) || (!f && !h)) {
      result.unchanged++;
      continue;
    }
    const entry: DiffEntry = { id, path: (f ?? h ?? b)!.path, base: b, figma: f, head: h, local, remote, conflict: false };
    if (local && !remote) {
      entry.path = (f ?? b)!.path;
      result.local.push(entry);
    } else if (remote && !local) {
      entry.path = (h ?? b)!.path;
      result.remote.push(entry);
    } else {
      entry.conflict = true;
      result.conflicts.push(entry);
    }
  }
  const byPath = (a: DiffEntry, b: DiffEntry) => a.path.localeCompare(b.path);
  result.local.sort(byPath);
  result.remote.sort(byPath);
  result.conflicts.sort(byPath);
  return result;
}

export const toMap = (tokens: Iterable<LogicalToken>) => new Map([...tokens].map((t) => [t.id, t]));

export type ConflictChoice = 'figma' | 'main';
