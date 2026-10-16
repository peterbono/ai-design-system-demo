// Alias resolution: follows "{a.b.c}" chains across tiers, detects cycles and broken references.
//
// Each tier varies along its own axis (types.ts): brand tokens per brand, semantic tokens per
// theme, density tokens per density. A context picks one mode on every axis, so
// semantic -> palette -> primitive resolves to the value for, say, ocean x dark. A semantic token
// that a brand overrides for a theme (brands/<brand>.<theme>.tokens.json) takes the override.

import { type Axis, type LogicalToken, SINGLE_MODE, TIER_AXIS } from './types';
import { aliasTarget, collectRefs, isAlias } from './values';

export interface ResolveContext {
  brand?: string | undefined;
  theme?: string | undefined;
  density?: string | undefined;
  /** overrideKey(brand, theme, path) -> value, from TokenSet.overrideIndex. */
  overrides?: Map<string, unknown> | undefined;
}

export type StepSource = 'token' | 'override';

export interface Resolution {
  /** Final literal value, when resolution succeeded. */
  value?: unknown;
  /** Token paths visited, starting with the requested token. */
  chain: string[];
  /** Where each visited value came from (parallel to `chain`; shorter when resolution stopped). */
  via: StepSource[];
  error?: 'cycle' | 'broken' | 'missing-mode';
  /** Path that could not be found (broken) or that closes the loop (cycle). */
  at?: string;
}

export type PathIndex = Map<string, LogicalToken>;

/** Value of a token in a context, and whether a brand override supplied it. */
export function valueIn(t: LogicalToken, ctx: ResolveContext): { value: unknown; via: StepSource } {
  const axis = TIER_AXIS[t.tier];
  if (!axis) return { value: t.values[SINGLE_MODE], via: 'token' };
  if (t.tier === 'semantic' && ctx.overrides && ctx.brand && ctx.theme) {
    const o = ctx.overrides.get(`${ctx.brand}|${ctx.theme}|${t.path}`);
    if (o !== undefined) return { value: o, via: 'override' };
  }
  const mode = ctx[axis];
  return { value: mode === undefined ? undefined : t.values[mode], via: 'token' };
}

/** Resolve the value of `path` in a brand x theme x density context. */
export function resolve(index: PathIndex, path: string, ctx: ResolveContext): Resolution {
  const chain: string[] = [];
  const via: StepSource[] = [];
  const seen = new Set<string>();
  let current = path;
  for (;;) {
    if (seen.has(current)) return { chain: [...chain, current], via, error: 'cycle', at: current };
    seen.add(current);
    chain.push(current);
    const t = index.get(current);
    if (!t) return { chain, via, error: 'broken', at: current };
    const v = valueIn(t, ctx);
    if (v.value === undefined) return { chain, via, error: 'missing-mode', at: current };
    via.push(v.via);
    if (!isAlias(v.value)) return { value: v.value, chain, via };
    current = aliasTarget(v.value);
  }
}

export interface ReferenceProblem {
  path: string;
  mode: string;
  kind: 'broken' | 'cycle';
  target: string;
  chain: string[];
}

/** Mode keys per axis (from the repo layout); the first one is the default. */
export type AxisModes = Partial<Record<Axis, string[]>>;

/** Every broken reference and cycle in the set, one entry per token and mode of its tier. */
export function findReferenceProblems(index: PathIndex, axes: AxisModes): ReferenceProblem[] {
  const out: ReferenceProblem[] = [];
  const base: ResolveContext = { brand: axes.brand?.[0], theme: axes.theme?.[0], density: axes.density?.[0] };
  for (const t of index.values()) {
    const axis = TIER_AXIS[t.tier];
    const modes = axis ? (axes[axis] ?? Object.keys(t.values)).filter((m) => t.values[m] !== undefined) : [SINGLE_MODE];
    for (const mode of modes) {
      const v = t.values[mode];
      for (const ref of collectRefs(v)) {
        if (!index.has(ref)) out.push({ path: t.path, mode, kind: 'broken', target: ref, chain: [t.path, ref] });
      }
      if (isAlias(v)) {
        const r = resolve(index, t.path, axis ? { ...base, [axis]: mode } : base);
        if (r.error === 'cycle') out.push({ path: t.path, mode, kind: 'cycle', target: r.at ?? '', chain: r.chain });
      }
    }
  }
  return out;
}
