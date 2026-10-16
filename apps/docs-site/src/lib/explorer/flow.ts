// Token flow for the detail panel, as pure functions: the upstream alias chain per mode column (with the color each
// hop resolves to), the downstream tokens that alias a token and the components that end up reading it, the
// contrast pairs it takes part in with AA badges, and the version that introduced it. Tested in flow.test.ts.
import { aliasTarget, isAlias, resolve, type ContrastResult, type Tier, type TokenSet } from '@bridge-ds/core';
import { colorHex, cssText } from './format';
import type { Column, ComponentLink, UsageMap } from './model';

export interface FlowNode {
  path: string;
  tier?: Tier | undefined;
  /** Resolved value at this hop, per column key. */
  values: Record<string, { css: string; hex?: string | undefined }>;
  /** The hop came from a brand x theme override in at least one column. */
  override: boolean;
}

export interface FlowLane {
  /** Columns this lane applies to (several when they share the same chain). */
  columns: Column[];
  nodes: FlowNode[];
  error?: string | undefined;
}

/**
 * Upstream chains, token first, literal value last. Columns with the same chain share a lane, so a component token
 * shows one lane with a swatch per mode while a semantic token whose light and dark chains differ shows two.
 */
export function upstreamLanes(set: TokenSet, path: string, columns: Column[]): FlowLane[] {
  const perColumn = columns.map((col) => {
    const r = resolve(set.byPath, path, { ...col.ctx, overrides: set.overrideIndex });
    return { col, r };
  });
  const lanes: FlowLane[] = [];
  for (const { col, r } of perColumn) {
    const sig = r.chain.join('>') + (r.error ? `!${r.error}` : '');
    let lane = lanes.find((l) => l.nodes.map((n) => n.path).join('>') + (l.error ? `!${l.error}` : '') === sig);
    if (!lane) {
      lane = {
        columns: [],
        nodes: r.chain.map((p) => ({ path: p, tier: set.byPath.get(p)?.tier, values: {}, override: false })),
        error: r.error,
      };
      lanes.push(lane);
    }
    lane.columns.push(col);
    r.chain.forEach((p, i) => {
      const node = lane!.nodes[i]!;
      const t = set.byPath.get(p);
      const hop = resolve(set.byPath, p, { ...col.ctx, overrides: set.overrideIndex });
      node.values[col.key] = { css: hop.value === undefined ? '' : cssText(t?.type ?? '', hop.value), hex: t?.type === 'color' ? colorHex(hop.value) : undefined };
      if (r.via[i] === 'override') node.override = true;
    });
  }
  return lanes;
}

export interface Dependent {
  path: string;
  tier: Tier;
  /** Mode keys in which it points here ("value" for single-mode tokens, brand x theme for overrides). */
  modes: string[];
}

/** Tokens whose value (in any mode, or any brand x theme override) is an alias to `path`. */
export function directDependents(set: TokenSet, path: string): Dependent[] {
  const out = new Map<string, Dependent>();
  const add = (p: string, mode: string) => {
    const t = set.byPath.get(p);
    if (!t) return;
    const d = out.get(p) ?? out.set(p, { path: p, tier: t.tier, modes: [] }).get(p)!;
    if (!d.modes.includes(mode)) d.modes.push(mode);
  };
  for (const t of set.byPath.values()) {
    for (const [mode, v] of Object.entries(t.values)) if (isAlias(v) && aliasTarget(v) === path) add(t.path, mode);
  }
  for (const o of set.overrides) if (isAlias(o.value) && aliasTarget(o.value) === path) add(o.path, `${o.brand}.${o.theme}`);
  return [...out.values()];
}

/** Every token that reaches `path` through one or more aliases. */
export function transitiveDependents(set: TokenSet, path: string): string[] {
  const seen = new Set<string>();
  const queue = [path];
  while (queue.length) {
    const p = queue.shift()!;
    for (const d of directDependents(set, p)) {
      if (seen.has(d.path) || d.path === path) continue;
      seen.add(d.path);
      queue.push(d.path);
    }
  }
  return [...seen];
}

/** Components that read the token itself or any token aliasing it, sorted by name. */
export function componentsUsing(path: string, dependents: string[], usage: UsageMap): ComponentLink[] {
  const all = new Map<string, ComponentLink>();
  for (const p of [path, ...dependents]) for (const c of usage[p]?.usedBy ?? []) all.set(c.name, c);
  return [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------------------------
// Contrast

export type Badge = 'AA' | 'AA large' | 'Fail';

/**
 * WCAG badge for a ratio. Text pairs: AA from 4.5:1, AA large from 3:1 (18pt or 14pt bold), else Fail. UI pairs
 * (WCAG 1.4.11): AA from 3:1, else Fail.
 */
export function badgeFor(ratio: number | undefined, kind: string): Badge {
  if (ratio === undefined) return 'Fail';
  if (kind === 'ui') return ratio >= 3 ? 'AA' : 'Fail';
  if (ratio >= 4.5) return 'AA';
  return ratio >= 3 ? 'AA large' : 'Fail';
}

export interface PairCell {
  brand: string | undefined;
  theme: string;
  ratio?: number | undefined;
  badge: Badge;
  /** Meets the minimum the pair is gated on in contrast.checks.json. */
  passes: boolean;
  /** Ratio before the draft, in edit mode. */
  before?: number | undefined;
}

export interface PairRow {
  fg: string;
  bg: string;
  min: number;
  kind: string;
  /** The token is the pair's foreground or background. */
  role: 'fg' | 'bg';
  other: string;
  cells: PairCell[];
  failing: number;
}

const pairKey = (r: ContrastResult) => `${r.pair.foreground}|${r.pair.background}`;
const cellKey = (r: { brand: string | undefined; theme: string }) => `${r.brand ?? ''}/${r.theme}`;

/**
 * Pairs that involve a token. Direct: the token is the foreground or background. Through: the pair resolves through
 * it (a palette role or primitive under a semantic pair). `before` adds the ratios before a draft.
 */
export function contrastFor(path: string, results: ContrastResult[], before: ContrastResult[] = []): { direct: PairRow[]; through: PairRow[] } {
  const prev = new Map(before.map((r) => [`${pairKey(r)}@${cellKey(r)}`, r.ratio]));
  const rows = new Map<string, PairRow>();
  for (const r of results) {
    const direct = r.pair.foreground === path || r.pair.background === path;
    if (!direct && !r.steps.some((s) => s.path === path)) continue;
    const k = pairKey(r);
    // Steps list the foreground chain first, then the background chain (starting at the background token).
    const bgStart = r.steps.findIndex((s) => s.path === r.pair.background);
    const role: 'fg' | 'bg' =
      r.pair.foreground === path ? 'fg' : r.pair.background === path ? 'bg' : bgStart < 0 || r.steps.findIndex((s) => s.path === path) < bgStart ? 'fg' : 'bg';
    const row =
      rows.get(k) ??
      rows
        .set(k, {
          fg: r.pair.foreground,
          bg: r.pair.background,
          min: r.pair.min,
          kind: r.pair.kind,
          role,
          other: role === 'fg' ? r.pair.background : r.pair.foreground,
          cells: [],
          failing: 0,
        })
        .get(k)!;
    const passes = r.ratio !== undefined && r.ratio >= r.pair.min;
    row.cells.push({ brand: r.brand, theme: r.theme, ratio: r.ratio, badge: badgeFor(r.ratio, r.pair.kind), passes, before: prev.get(`${k}@${cellKey(r)}`) });
    if (!passes) row.failing++;
  }
  const all = [...rows.values()].sort((a, b) => b.failing - a.failing);
  return {
    direct: all.filter((r) => r.fg === path || r.bg === path),
    through: all.filter((r) => r.fg !== path && r.bg !== path),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// History

/** "Introduced in v1.2.0": the version of the change that added the token (renames followed), when known. */
export function introducedIn(items: { kind: string; version?: string | undefined; date: string }[]): string | undefined {
  const added = items.filter((i) => i.kind === 'added').sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  if (!added?.version) return undefined;
  return added.version.replace(/^v/, '');
}
