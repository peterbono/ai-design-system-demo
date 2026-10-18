// Designer-friendly diff of two token sets (base and head of a pull request, or main and a draft), built on
// @bridge-ds/core so the Reviews page, the token editor and the Figma plugin agree on values and contrast.
// Pure: no fetch, no DOM. Unit tested in token-review.test.ts.
import {
  buildTokenSet,
  contextFor,
  contextLabel,
  contrastScope,
  evaluatePairs,
  formatValue,
  isAlias,
  aliasTarget,
  modesOf,
  pairKey,
  parseColor,
  rgbaToHex,
  resolve,
  type ContrastPair,
  type ContrastResult,
  type LayoutOptions,
  type LogicalToken,
  type TokenSet,
} from '@bridge-ds/core';

export interface ShownValue {
  /** Alias target when the raw value is an alias. */
  alias: string | null;
  /** Resolved value, formatted. */
  css: string | null;
  /** Resolved color as #rrggbb, for swatches. */
  hex: string | null;
}

export interface TokenChangeRow {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  tier: string;
  /** Mode the row describes ("light", "ocean", "compact"); empty for single-mode tiers. */
  context: string;
  before: ShownValue | null;
  after: ShownValue | null;
}

export interface ContrastDelta {
  fg: string;
  bg: string;
  /** "Bridge light", "Ocean dark". */
  where: string;
  before: number;
  after: number;
  min: number;
  fgHexAfter: string;
  bgHexAfter: string;
}

export interface TokenReview {
  changes: TokenChangeRow[];
  contrast: ContrastDelta[];
  /** Contrast checks below their minimum after the change. */
  failing: number;
  /** Contrast checks evaluated after the change, in every brand and theme (the token build counts the same set). */
  checked?: number;
  /** Of those, the ones at or above their minimum. */
  passing?: number;
  problems: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A token value as the review shows it: alias, resolved value and swatch hex. */
export function shown(set: TokenSet, t: LogicalToken, mode: string): ShownValue {
  const raw = t.values[mode];
  const r = resolve(set.byPath, t.path, contextFor(set, t.tier, mode));
  const color = r.value !== undefined && t.type === 'color' ? parseColor(r.value) : undefined;
  const hexField = r.value && typeof r.value === 'object' ? (r.value as { hex?: unknown }).hex : undefined;
  const hex = typeof hexField === 'string' ? hexField.toLowerCase() : color ? rgbaToHex(color) : null;
  return {
    alias: isAlias(raw) ? aliasTarget(raw) : null,
    css: r.value === undefined ? (r.error ? `unresolved (${r.error}${r.at ? `: ${r.at}` : ''})` : null) : t.type === 'color' && hex ? hex : formatValue(t.type, r.value),
    hex,
  };
}

/** Rows for every token whose raw value differs between the two sets, one per changed mode. */
export function diffTokenSets(base: TokenSet, head: TokenSet): TokenChangeRow[] {
  const rows: TokenChangeRow[] = [];
  const paths = [...new Set([...base.byPath.keys(), ...head.byPath.keys()])].sort();
  for (const path of paths) {
    const a = base.byPath.get(path);
    const b = head.byPath.get(path);
    const t = (b ?? a)!;
    const modes = [...new Set([...Object.keys(a?.values ?? {}), ...Object.keys(b?.values ?? {})])];
    const multi = modesOf((b ? head : base).layout, t.tier).length > 1 || modes.length > 1;
    for (const mode of modes) {
      const va = a?.values[mode];
      const vb = b?.values[mode];
      if (a && b && same(va, vb)) continue;
      rows.push({
        path,
        kind: !a ? 'added' : !b ? 'removed' : 'changed',
        tier: t.tier,
        context: multi ? mode : '',
        before: a && va !== undefined ? shown(base, a, mode) : null,
        after: b && vb !== undefined ? shown(head, b, mode) : null,
      });
    }
  }
  // Brand x theme overrides (brands/<brand>.<theme>.tokens.json) are code-only values of semantic tokens.
  const okey = (o: { brand: string; theme: string; path: string }) => `${o.brand}|${o.theme}|${o.path}`;
  const ob = new Map(base.overrides.map((o) => [okey(o), o]));
  const oh = new Map(head.overrides.map((o) => [okey(o), o]));
  for (const k of [...new Set([...ob.keys(), ...oh.keys()])].sort()) {
    const x = ob.get(k);
    const y = oh.get(k);
    if (x && y && same(x.value, y.value)) continue;
    const o = (y ?? x)!;
    const view = (set: TokenSet, v: typeof o | undefined): ShownValue | null => {
      if (!v) return null;
      const r = resolve(set.byPath, o.path, { brand: o.brand, theme: o.theme, overrides: set.overrideIndex, density: set.layout.densities[0]?.mode });
      const c = r.value !== undefined ? parseColor(r.value) : undefined;
      return { alias: isAlias(v.value) ? aliasTarget(v.value) : null, css: c ? rgbaToHex(c) : r.value !== undefined ? String(r.value) : null, hex: c ? rgbaToHex(c) : null };
    };
    rows.push({
      path: o.path,
      kind: !x ? 'added' : !y ? 'removed' : 'changed',
      tier: 'semantic',
      context: `${o.brand} ${o.theme} override`,
      before: view(base, x),
      after: view(head, y),
    });
  }
  return rows;
}

/**
 * Contrast pairs affected by the change: a pair is listed when either color resolves through a changed token
 * (directly or through aliases, in base or head), or when its ratio moved. This is the fix for the empty
 * "Contrast (before -> after)" column seen in PR #4, where only pairs naming the changed token were looked up.
 */
export function contrastDeltas(base: TokenSet, head: TokenSet, pairs: ContrastPair[], changedPaths: Set<string>): ContrastDelta[] {
  const before = new Map(evaluatePairs(base.byPath, pairs, contrastScope(base)).map((r) => [pairKey(r), r]));
  const after = evaluatePairs(head.byPath, pairs, contrastScope(head));
  const touches = (r: ContrastResult | undefined) => Boolean(r?.steps.some((s) => changedPaths.has(s.path)));
  const out: ContrastDelta[] = [];
  for (const a of after) {
    const b = before.get(pairKey(a));
    if (a.ratio === undefined) continue;
    const moved = b?.ratio !== a.ratio;
    // Listed when the ratio moved, or when it runs through a changed token and fails (a known problem stays visible).
    if (!moved && !((touches(a) || touches(b)) && a.ratio < a.pair.min)) continue;
    const ctx = { brand: a.brand, theme: a.theme, density: head.layout.densities[0]?.mode, overrides: head.overrideIndex };
    const hexOf = (path: string) => {
      const r = resolve(head.byPath, path, ctx);
      const c = r.value !== undefined ? parseColor(r.value) : undefined;
      return c ? rgbaToHex(c) : 'transparent';
    };
    out.push({
      fg: a.pair.foreground,
      bg: a.pair.background,
      where: contextLabel(a),
      before: b?.ratio ?? a.ratio,
      after: a.ratio,
      min: a.pair.min,
      fgHexAfter: hexOf(a.pair.foreground),
      bgHexAfter: hexOf(a.pair.background),
    });
  }
  // Failing first, then the biggest drops.
  return out.sort((x, y) => Number(y.after < y.min) - Number(x.after < x.min) || x.after - x.before - (y.after - y.before));
}

export function reviewTokenChange(
  baseFiles: Record<string, string>,
  headFiles: Record<string, string>,
  pairs: ContrastPair[],
  options: LayoutOptions = {},
): TokenReview {
  const base = buildTokenSet(baseFiles, options);
  const head = buildTokenSet(headFiles, options);
  const changes = diffTokenSets(base, head);
  const changed = new Set(changes.map((c) => c.path));
  const contrast = contrastDeltas(base, head, pairs, changed);
  const all = evaluatePairs(head.byPath, pairs, contrastScope(head)).filter((r) => r.ratio !== undefined);
  const passing = all.filter((r) => r.ratio! >= r.pair.min).length;
  return { changes, contrast, failing: contrast.filter((c) => c.after < c.min).length, checked: all.length, passing, problems: [...head.problems] };
}
