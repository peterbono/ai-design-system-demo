// What the audit compares product code against: the design system's tokens (resolved in every mode),
// its CSS variables, its component names and its package names.
import type { Rgba } from '../values';
import { comboKey, type Combo, type LayeredTokenSet } from '../layered';
import { deltaE, parseCssColor } from './color';
import type { Confidence, FindingCategory, TokenSuggestion } from './types';

export interface AuditDsOptions {
  /** Packages the DS components are imported from, e.g. ["@bridge/react"]. */
  packages: string[];
  /** DS component names (PascalCase). */
  components: string[];
  /** Extra module prefixes counted as foreign UI libraries. */
  foreignLibraries?: string[];
  /** Native elements that should be DS components. */
  nativeElements?: string[];
}

interface Entry {
  path: string;
  cssVar: string;
  type: string;
  tier: string;
  css: string;
  combo?: string;
  rgba?: Rgba;
  num?: number;
}

const TIER_RANK_COLOR: Record<string, number> = { semantic: 0, base: 1, component: 2, brand: 3, density: 3, primitive: 4 };
const TIER_RANK_SCALE: Record<string, number> = { semantic: 0, base: 0, brand: 1, density: 2, primitive: 3, component: 5 };

// CSS property -> token paths that fit its intent (a background wants a bg/surface token, not a text one).
const COLOR_HINTS: [RegExp, RegExp][] = [
  [/^(color|fill|stroke|-webkit-text-fill-color|caret-color|text-decoration(-color)?)$/, /(^|\.)(text|fg|icon|foreground|link)(\.|-|$)/],
  [/background|bgcolor/, /(^|\.)(bg|surface|background|fill|solid|scrim|overlay)(\.|-|$)/],
  [/border|outline|divider|column-rule/, /(^|\.)(border|outline|ring|divider|line|separator)(\.|-|$)/],
];

const PATH_FOR: Partial<Record<FindingCategory, RegExp>> = {
  spacing: /(^|\.)space(\.|$)/,
  size: /(^|\.)size(\.|$)/,
  radius: /(^|\.)radius(\.|$)|-radius$|\.radius$/,
  'border-width': /border-width|border\.width|(^|\.)stroke(\.|$)/,
  'font-size': /font\.size|font-size|text\.size/,
  'line-height': /line-height|leading/,
  duration: /duration/,
  'z-index': /^(z|layer|z-index|zindex)\./,
  'font-weight': /weight/,
};

const toPx = (css: string): number | undefined => {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(css.trim());
  if (!m) return undefined;
  return m[2] === 'rem' || m[2] === 'em' ? Number(m[1]) * 16 : Number(m[1]);
};
const toMs = (css: string): number | undefined => {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(css.trim());
  return m ? (m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1])) : undefined;
};
const EASE_KEYWORDS: Record<string, number[]> = { ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1], linear: [0, 0, 1, 1] };
const bezier = (css: string): number[] | undefined => {
  const k = EASE_KEYWORDS[css.trim()];
  if (k) return k;
  const m = /cubic-bezier\(([^)]*)\)/.exec(css);
  const n = m?.[1]!.split(',').map(Number);
  return n && n.length === 4 && n.every(Number.isFinite) ? n : undefined;
};
const WEIGHT_WORDS: Record<string, number> = { normal: 400, bold: 700, bolder: 700, lighter: 300 };
const firstFamily = (css: string) => css.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();
const shadowNums = (css: string) => [...css.replace(/rgba?\([^)]*\)|#[0-9a-f]+|hsla?\([^)]*\)/gi, '').matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));

function level(conf: number): Confidence {
  return conf >= 0.999 ? 'exact' : conf >= 0.75 ? 'high' : conf >= 0.5 ? 'medium' : 'low';
}
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export class DesignSystemIndex {
  readonly cssVars = new Set<string>();
  readonly packages: string[];
  readonly components: Set<string>;
  readonly foreignLibraries: string[];
  readonly nativeElements: string[];
  readonly tokenCount: number;
  readonly modes: string[];
  private colors: Entry[] = [];
  private byType = new Map<string, Entry[]>();
  private defaultCombo: Combo;

  constructor(set: LayeredTokenSet, opts: AuditDsOptions) {
    this.packages = opts.packages;
    this.components = new Set(opts.components);
    this.foreignLibraries = opts.foreignLibraries ?? [];
    this.nativeElements = opts.nativeElements ?? ['button', 'input', 'select', 'textarea', 'dialog', 'table'];
    this.defaultCombo = set.defaultCombo;
    this.modes = set.combos().map(comboKey);
    const paths = set.allPaths();
    this.tokenCount = paths.length;
    const defKey = comboKey(this.defaultCombo);
    const seenColor = new Set<string>();
    for (const combo of set.combos()) {
      const key = this.modeLabel(combo);
      const isDefault = comboKey(combo) === defKey;
      const view = set.view(combo);
      for (const p of view.keys()) {
        const r = set.resolve(p, combo);
        if (r.error || !r.css) continue;
        const base = { path: p, cssVar: set.cssVarName(p), type: r.type ?? '', tier: set.tierOf(p) ?? 'primitive', css: r.css };
        if (r.type === 'color') {
          const rgba = parseCssColor(r.css);
          const id = `${p}|${r.css}`;
          if (!rgba || seenColor.has(id)) continue;
          seenColor.add(id);
          this.colors.push({ ...base, rgba, ...(key ? { combo: key } : {}) });
        } else if (isDefault) {
          const list = this.byType.get(base.type) ?? [];
          list.push(base);
          this.byType.set(base.type, list);
        }
      }
    }
    for (const p of paths) this.cssVars.add(set.cssVarName(p));
  }

  private modeLabel(combo: Combo): string | undefined {
    const diff = Object.entries(combo).filter(([k, v]) => this.defaultCombo[k] !== v);
    return diff.length ? diff.map(([k, v]) => `${k}=${v}`).join(',') : undefined;
  }

  isDsVar(name: string): boolean {
    return this.cssVars.has(name);
  }

  isDsModule(mod: string): boolean {
    return this.packages.some((p) => mod === p || mod.startsWith(`${p}/`));
  }

  private entries(types: string[], pathRe?: RegExp): Entry[] {
    const all = types.flatMap((t) => this.byType.get(t) ?? []);
    if (!pathRe) return all;
    const narrowed = all.filter((e) => pathRe.test(e.path));
    return narrowed.length ? narrowed : all;
  }

  private make(e: Entry, distance: number, confidence: number): TokenSuggestion {
    return { token: e.path, cssVar: e.cssVar, value: e.css, ...(e.combo ? { mode: e.combo } : {}), distance: round(distance), confidence: round(confidence), level: level(confidence) };
  }

  /** Nearest color by deltaE OK across every mode; semantic tokens and tokens that fit the property win near-ties. */
  suggestColor(value: string, property?: string): TokenSuggestion | undefined {
    const target = parseCssColor(value);
    if (!target || !this.colors.length) return undefined;
    const hint = COLOR_HINTS.find(([re]) => property && re.test(property))?.[1];
    const scored = this.colors.map((e) => ({ e, d: deltaE(target, e.rgba!) }));
    const min = Math.min(...scored.map((s) => s.d));
    const tolerance = min <= 0.5 ? 0.5 : min + 2;
    const pick = scored
      .filter((s) => s.d <= Math.max(tolerance, min))
      .sort((a, b) => Number(hint ? !hint.test(a.e.path) : 0) - Number(hint ? !hint.test(b.e.path) : 0) || (TIER_RANK_COLOR[a.e.tier] ?? 5) - (TIER_RANK_COLOR[b.e.tier] ?? 5) || Number(Boolean(a.e.combo)) - Number(Boolean(b.e.combo)) || a.d - b.d)[0];
    if (!pick || pick.d > 15) return undefined;
    const conf = pick.d <= 0.5 ? 1 : pick.d <= 2 ? 0.85 : pick.d <= 5 ? 0.6 : 0.3;
    return this.make(pick.e, pick.d, conf);
  }

  private nearestNumber(cands: Entry[], target: number, read: (e: Entry) => number | undefined, rank = TIER_RANK_SCALE): { e: Entry; d: number } | undefined {
    const scored = cands.map((e) => ({ e, n: read(e) })).filter((s): s is { e: Entry; n: number } => s.n !== undefined).map((s) => ({ e: s.e, d: Math.abs(s.n - target) }));
    if (!scored.length) return undefined;
    const min = Math.min(...scored.map((s) => s.d));
    return scored.filter((s) => s.d === min).sort((a, b) => (rank[a.e.tier] ?? 5) - (rank[b.e.tier] ?? 5) || a.e.path.length - b.e.path.length)[0];
  }

  private ratioConfidence(d: number, target: number): number {
    if (d === 0) return 1;
    const rel = d / Math.max(Math.abs(target), 1);
    return d <= 1 || rel <= 0.05 ? 0.8 : rel <= 0.15 ? 0.55 : rel <= 0.4 ? 0.3 : 0;
  }

  /** Suggest a token for a hardcoded value of a category. Undefined when nothing is close. */
  suggest(category: FindingCategory, value: string, property?: string): TokenSuggestion | undefined {
    switch (category) {
      case 'color':
        return this.suggestColor(value, property);
      case 'spacing':
      case 'size':
      case 'radius':
      case 'border-width':
      case 'font-size': {
        const px = toPx(value);
        if (px === undefined) return undefined;
        const best = this.nearestNumber(this.entries(['dimension'], PATH_FOR[category]), Math.abs(px), (e) => toPx(e.css));
        if (!best) return undefined;
        let conf = this.ratioConfidence(best.d, px);
        if (conf && /em$/.test(value) && !/rem$/.test(value)) conf = Math.min(conf, 0.55); // em depends on the font size
        return conf ? this.make(best.e, best.d, conf) : undefined;
      }
      case 'line-height': {
        const n = Number(value);
        if (!Number.isFinite(n)) return undefined;
        const best = this.nearestNumber(this.entries(['number', 'dimension'], PATH_FOR['line-height']).filter((e) => PATH_FOR['line-height']!.test(e.path)), n, (e) => Number(e.css));
        if (!best) return undefined;
        const conf = best.d < 0.001 ? 1 : best.d <= 0.05 ? 0.8 : best.d <= 0.15 ? 0.5 : 0.25;
        return this.make(best.e, best.d, conf);
      }
      case 'duration': {
        const ms = toMs(value);
        if (ms === undefined) return undefined;
        const cands = this.entries(['duration']).filter((e) => toMs(e.css) !== 0 || ms === 0);
        const best = this.nearestNumber(cands, ms, (e) => toMs(e.css));
        const conf = best ? this.ratioConfidence(best.d, ms) || 0.25 : 0;
        return best ? this.make(best.e, best.d, conf) : undefined;
      }
      case 'easing': {
        const target = bezier(value);
        if (!target) return undefined;
        const scored = this.entries(['cubicBezier'])
          .map((e) => ({ e, b: bezier(e.css) }))
          .filter((s) => s.b)
          .map((s) => ({ e: s.e, d: s.b!.reduce((acc, x, i) => acc + Math.abs(x - target[i]!), 0) }))
          .sort((a, b) => a.d - b.d || (TIER_RANK_SCALE[a.e.tier] ?? 5) - (TIER_RANK_SCALE[b.e.tier] ?? 5));
        const best = scored.find((s) => s.d === scored[0]!.d && /motion/.test(s.e.path)) ?? scored[0];
        if (!best) return undefined;
        return this.make(best.e, best.d, best.d < 0.011 ? 1 : best.d <= 0.3 ? 0.55 : 0.3);
      }
      case 'z-index': {
        const n = Number(value);
        const cands = [...this.entries(['number']), ...this.entries([''])].filter((e) => PATH_FOR['z-index']!.test(e.path));
        const best = this.nearestNumber(cands, n, (e) => Number(e.css));
        if (!best) return undefined;
        return this.make(best.e, best.d, best.d === 0 ? 1 : best.d <= 10 ? 0.5 : 0.25);
      }
      case 'font-weight': {
        const n = WEIGHT_WORDS[value.toLowerCase()] ?? Number(value);
        if (!Number.isFinite(n)) return undefined;
        const cands = [...this.entries(['fontWeight']), ...this.entries(['number'])].filter((e) => PATH_FOR['font-weight']!.test(e.path));
        const best = this.nearestNumber(cands, n, (e) => Number(e.css));
        if (!best) return undefined;
        const conf = best.d === 0 ? (String(n) === value ? 1 : 0.9) : best.d <= 100 ? 0.6 : 0.3;
        return this.make(best.e, best.d / 100, conf);
      }
      case 'font-family': {
        const fam = firstFamily(value);
        const cands = this.entries(['fontFamily']);
        const exact = cands.filter((e) => firstFamily(e.css) === fam).sort((a, b) => (TIER_RANK_SCALE[a.tier] ?? 5) - (TIER_RANK_SCALE[b.tier] ?? 5))[0];
        if (exact) return this.make(exact, 0, value.replace(/\s/g, '') === exact.css.replace(/\s/g, '') ? 1 : 0.9);
        const mono = /mono|courier|consol|menlo/.test(value.toLowerCase());
        const generic = cands.filter((e) => (mono ? /mono/.test(e.path) : /sans/.test(e.path))).sort((a, b) => (TIER_RANK_SCALE[a.tier] ?? 5) - (TIER_RANK_SCALE[b.tier] ?? 5))[0];
        return generic ? this.make(generic, 1, 0.3) : undefined;
      }
      case 'shadow': {
        const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toLowerCase();
        const cands = this.entries(['shadow']);
        const exact = cands.find((e) => norm(e.css) === norm(value));
        if (exact) return this.make(exact, 0, 1);
        const t = shadowNums(value);
        const scored = cands
          .map((e) => {
            const n = shadowNums(e.css);
            const len = Math.max(n.length, t.length);
            let d = 0;
            for (let i = 0; i < len; i++) d += Math.abs((n[i] ?? 0) - (t[i] ?? 0));
            return { e, d };
          })
          .sort((a, b) => a.d - b.d || Number(!/elevation/.test(a.e.path)) - Number(!/elevation/.test(b.e.path)));
        const best = scored[0];
        if (!best) return undefined;
        return this.make(best.e, best.d, best.d <= 2 ? 0.75 : best.d <= 8 ? 0.5 : 0.25);
      }
    }
  }

  /** Same value as the token (safe to replace): exact level and, for lengths, the same unit. */
  static isExact(s: TokenSuggestion | undefined): boolean {
    return Boolean(s && s.level === 'exact');
  }
}
