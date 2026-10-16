// Alias resolution: follows "{a.b.c}" chains per mode, detects cycles and broken references.

import { type LogicalToken, PRIMITIVE_MODE } from './types';
import { aliasTarget, collectRefs, isAlias } from './values';

export interface Resolution {
  /** Final literal value, when resolution succeeded. */
  value?: unknown;
  /** Token paths visited, starting with the requested token. */
  chain: string[];
  error?: 'cycle' | 'broken' | 'missing-mode';
  /** Path that could not be found (broken) or that closes the loop (cycle). */
  at?: string;
}

export type PathIndex = Map<string, LogicalToken>;

const valueIn = (t: LogicalToken, mode: string) => (t.tier === 'primitive' ? t.values[PRIMITIVE_MODE] : t.values[mode]);

/** Resolve the value of `path` in `mode` (a theme mode key; ignored for primitives). */
export function resolve(index: PathIndex, path: string, mode: string): Resolution {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = path;
  for (;;) {
    if (seen.has(current)) return { chain: [...chain, current], error: 'cycle', at: current };
    seen.add(current);
    chain.push(current);
    const t = index.get(current);
    if (!t) return { chain, error: 'broken', at: current };
    const v = valueIn(t, mode);
    if (v === undefined) return { chain, error: 'missing-mode', at: current };
    if (!isAlias(v)) return { value: v, chain };
    current = aliasTarget(v);
  }
}

export interface ReferenceProblem {
  path: string;
  mode: string;
  kind: 'broken' | 'cycle';
  target: string;
  chain: string[];
}

/** Every broken reference and cycle in the set, one entry per token and mode. */
export function findReferenceProblems(index: PathIndex, modes: string[]): ReferenceProblem[] {
  const out: ReferenceProblem[] = [];
  for (const t of index.values()) {
    const tokenModes = t.tier === 'primitive' ? [PRIMITIVE_MODE] : modes.filter((m) => t.values[m] !== undefined);
    for (const mode of tokenModes) {
      const v = t.values[mode];
      for (const ref of collectRefs(v)) {
        if (!index.has(ref)) out.push({ path: t.path, mode, kind: 'broken', target: ref, chain: [t.path, ref] });
      }
      if (isAlias(v)) {
        const r = resolve(index, t.path, mode);
        if (r.error === 'cycle') out.push({ path: t.path, mode, kind: 'cycle', target: r.at ?? '', chain: r.chain });
      }
    }
  }
  return out;
}
