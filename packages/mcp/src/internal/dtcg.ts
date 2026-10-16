// DTCG 2025.10 token model: flatten files, layer them per mode combination, resolve aliases, validate.
// TO BE REPLACED by DTCG resolve + validate in @bridge/core at merge time (see ../core-adapter.ts).
import type { BridgeConfig } from '../config.js';
import { compactJson } from './json-edit.js';

export interface TokenDef {
  path: string;
  type?: string;
  value: unknown;
  description?: string;
  extensions?: Record<string, unknown>;
  deprecated?: unknown;
  /** File relative to tokens.root. */
  file: string;
}

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
  file?: string;
  modes?: string[];
}

export type Combo = Record<string, string>;

export interface Resolved {
  path: string;
  type?: string;
  /** Raw DTCG value with every alias replaced. */
  value: unknown;
  /** CSS-ready string, the way the token build writes it. */
  css: string;
  /** Alias hops, starting with the token itself. */
  chain: string[];
  /** Files that define the winning value, highest layer last. */
  definedIn: string[];
  error?: string;
}

export const DTCG_TYPES = new Set(['color', 'dimension', 'fontFamily', 'fontWeight', 'duration', 'cubicBezier', 'number', 'strokeStyle', 'border', 'transition', 'shadow', 'gradient', 'typography', 'fontStyle', 'string', 'boolean']);

const ALIAS = /^\{([^{}]+)\}$/;
export const aliasTarget = (v: unknown): string | null => (typeof v === 'string' ? (ALIAS.exec(v)?.[1] ?? null) : null);

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const comboKey = (c: Combo) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join(',') || 'default';

export function flattenTokens(json: unknown, file: string, issues: Issue[]): TokenDef[] {
  const out: TokenDef[] = [];
  const walk = (node: unknown, path: string[], inheritedType?: string) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const n = node as Record<string, unknown>;
    const type = typeof n.$type === 'string' ? n.$type : inheritedType;
    if ('$value' in n) {
      out.push({
        path: path.join('.'),
        ...(type ? { type } : {}),
        value: n.$value,
        ...(typeof n.$description === 'string' ? { description: n.$description } : {}),
        ...(n.$extensions && typeof n.$extensions === 'object' ? { extensions: n.$extensions as Record<string, unknown> } : {}),
        ...(n.$deprecated !== undefined ? { deprecated: n.$deprecated } : {}),
        file,
      });
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k.startsWith('$')) continue;
      if (/[{}.]/.test(k)) issues.push({ level: 'error', code: 'invalid-name', message: `Name "${k}" contains {, } or . which DTCG forbids.`, path: [...path, k].join('.'), file });
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, [...path, k], type);
      else issues.push({ level: 'error', code: 'not-a-token', message: `"${[...path, k].join('.')}" is neither a token (no $value) nor a group.`, path: [...path, k].join('.'), file });
    }
  };
  walk(json, []);
  return out;
}

// --- value formatting (matches packages/tokens/build.mjs) -------------------------------------------------

const toHex2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');

export function colorToCss(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!c || typeof c !== 'object') return String(c);
  const o = c as { components?: unknown[]; alpha?: number; hex?: string };
  const [r, g, b] = (o.components ?? []).map((x) => (typeof x === 'number' ? x : 0));
  const alpha = o.alpha ?? 1;
  if (alpha < 1) return `rgb(${[r, g, b].map((x) => Math.round((x ?? 0) * 255)).join(' ')} / ${alpha})`;
  return o.hex ?? `#${[r, g, b].map((x) => toHex2(x ?? 0)).join('')}`;
}
const dimToCss = (d: unknown) => (d && typeof d === 'object' && 'value' in (d as object) ? `${(d as { value: number }).value}${(d as { unit: string }).unit}` : String(d));

export function valueToCss(type: string | undefined, v: unknown, ext?: Record<string, unknown>): string {
  if (v === undefined || v === null) return '';
  switch (type) {
    case 'color':
      return colorToCss(v);
    case 'dimension':
    case 'duration':
      return dimToCss(v);
    case 'cubicBezier':
      return Array.isArray(v) ? `cubic-bezier(${v.join(', ')})` : String(v);
    case 'fontFamily':
      return Array.isArray(v) ? v.map((n) => (/\s/.test(String(n)) ? `"${n}"` : String(n))).join(', ') : String(v);
    case 'shadow': {
      if (typeof v === 'string') return v;
      const layers = (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
      return layers.map((l) => [l.inset ? 'inset' : '', dimToCss(l.offsetX), dimToCss(l.offsetY), dimToCss(l.blur), dimToCss(l.spread ?? { value: 0, unit: 'px' }), colorToCss(l.color)].filter(Boolean).join(' ')).join(', ');
    }
    default: {
      const unit = ext?.['dev.bridge.unit'];
      if (typeof v === 'number' && typeof unit === 'string') return `${v}${unit}`;
      return typeof v === 'object' ? compactJson(v) : String(v);
    }
  }
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export function toRgba(v: unknown): Rgba | null {
  if (typeof v === 'string') {
    const m = /^#([0-9a-f]{3,8})$/i.exec(v.trim());
    if (!m) return null;
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  if (v && typeof v === 'object') {
    const o = v as { colorSpace?: string; components?: unknown[]; alpha?: number; hex?: string };
    // hex wins when present: it is what the CSS build emits for opaque colors.
    if (typeof o.hex === 'string') {
      const c = toRgba(o.hex);
      if (c) return { ...c, a: o.alpha ?? c.a };
    }
    if ((!o.colorSpace || o.colorSpace === 'srgb') && Array.isArray(o.components) && o.components.every((x) => typeof x === 'number')) {
      const [r, g, b] = o.components as number[];
      return { r: r!, g: g!, b: b!, a: o.alpha ?? 1 };
    }
    if (o.hex) {
      const c = toRgba(o.hex);
      return c ? { ...c, a: o.alpha ?? c.a } : null;
    }
  }
  return null;
}
export const rgbaToHex = (c: Rgba) => `#${[c.r, c.g, c.b].map(toHex2).join('')}${c.a < 1 ? toHex2(c.a) : ''}`;

// --- token set --------------------------------------------------------------------------------------------

export class TokenSet {
  readonly defs: TokenDef[] = [];
  readonly issues: Issue[] = [];
  readonly fileNames: string[];
  private readonly views = new Map<string, { map: Map<string, TokenDef[]>; missing: string[] }>();

  /** `files`: token file path relative to tokens.root -> file text. */
  constructor(
    readonly config: BridgeConfig,
    readonly files: Map<string, string>,
  ) {
    this.fileNames = [...files.keys()].sort();
    for (const f of this.fileNames) {
      let json: unknown;
      try {
        json = JSON.parse(files.get(f)!);
      } catch (e) {
        this.issues.push({ level: 'error', code: 'invalid-json', message: `Invalid JSON: ${(e as Error).message}`, file: f });
        continue;
      }
      this.defs.push(...flattenTokens(json, f, this.issues));
    }
  }

  get modeNames() {
    return Object.keys(this.config.modes);
  }
  get defaultCombo(): Combo {
    return Object.fromEntries(Object.entries(this.config.modes).map(([k, m]) => [k, m.default]));
  }
  /** Every combination of the given modes (all modes when omitted); other modes stay at default. */
  combos(only?: string[]): Combo[] {
    let out: Combo[] = [this.defaultCombo];
    for (const [name, m] of Object.entries(this.config.modes)) {
      if (only && !only.includes(name)) continue;
      out = out.flatMap((c) => m.values.map((v) => ({ ...c, [name]: v })));
    }
    return out;
  }
  normalizeCombo(partial: Partial<Combo> = {}): Combo {
    const c = { ...this.defaultCombo };
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) continue;
      const m = this.config.modes[k];
      if (!m) throw new Error(`Unknown mode "${k}". Modes: ${this.modeNames.join(', ') || 'none'}.`);
      if (!m.values.includes(v)) throw new Error(`Unknown ${k} "${v}". Values: ${m.values.join(', ')}.`);
      c[k] = v;
    }
    return c;
  }

  tierOfFile(file: string): string | undefined {
    for (const [tier, dirs] of Object.entries(this.config.tokens.tiers)) {
      if (dirs.some((d) => file === d || file.startsWith(`${d.replace(/\/$/, '')}/`) || globToRegExp(d).test(file))) return tier;
    }
    return undefined;
  }

  /** Tier of a token: the lowest layer that defines it in the default mode (an override does not change its tier). */
  tierOf(path: string): string | undefined {
    const d = this.view(this.defaultCombo).get(path)?.[0] ?? this.defs.find((x) => x.path === path);
    return d ? this.tierOfFile(d.file) : undefined;
  }

  /** Files of each layer for a combo, in resolution order. */
  layerFiles(combo: Combo): { files: string[]; missing: string[] } {
    const files: string[] = [];
    const missing: string[] = [];
    for (const l of this.config.tokens.layers) {
      const pattern = l.files.replace(/\{([^}]+)\}/g, (_, k: string) => combo[k] ?? `{${k}}`);
      const re = globToRegExp(pattern);
      const hit = this.fileNames.filter((f) => re.test(f));
      if (!hit.length && !l.optional) missing.push(pattern);
      for (const f of hit) if (!files.includes(f)) files.push(f);
    }
    return { files, missing };
  }

  /** path -> definitions in layer order (last one wins) for a combo. */
  view(combo: Combo): Map<string, TokenDef[]> {
    const key = comboKey(combo);
    let v = this.views.get(key);
    if (!v) {
      const { files, missing } = this.layerFiles(combo);
      const map = new Map<string, TokenDef[]>();
      const byFile = new Map<string, TokenDef[]>();
      for (const d of this.defs) (byFile.get(d.file) ?? byFile.set(d.file, []).get(d.file)!).push(d);
      for (const f of files) for (const d of byFile.get(f) ?? []) (map.get(d.path) ?? map.set(d.path, []).get(d.path)!).push(d);
      v = { map, missing };
      this.views.set(key, v);
    }
    return v.map;
  }
  missingLayers(combo: Combo): string[] {
    this.view(combo);
    return this.views.get(comboKey(combo))!.missing;
  }

  /** Every token path defined in any combo. */
  allPaths(): string[] {
    return [...new Set(this.defs.map((d) => d.path))].sort();
  }
  defsOf(path: string): TokenDef[] {
    return this.defs.filter((d) => d.path === path);
  }

  resolve(path: string, combo: Combo): Resolved {
    const view = this.view(combo);
    const chain: string[] = [path];
    const top = view.get(path);
    if (!top) return { path, value: undefined, css: '', chain, definedIn: [], error: `"${path}" is not defined for ${comboKey(combo)}` };
    const def = top[top.length - 1]!;
    let type = def.type;
    let error: string | undefined;
    const deref = (target: string, stack: string[]): unknown => {
      if (stack.includes(target)) {
        error = `circular alias: ${[...stack, target].join(' -> ')}`;
        return undefined;
      }
      const t = view.get(target);
      if (!t) {
        error = `broken alias {${target}}`;
        return undefined;
      }
      const td = t[t.length - 1]!;
      type ??= td.type;
      return walk(td.value, [...stack, target]);
    };
    const walk = (v: unknown, stack: string[]): unknown => {
      const a = aliasTarget(v);
      if (a) return deref(a, stack);
      if (Array.isArray(v)) return v.map((x) => walk(x, stack));
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, stack)]));
      return v;
    };
    // Top-level alias chain, for designers: color.text.muted -> palette.neutral.600 -> color.steel.600.
    let cur = def.value;
    const seen = new Set([path]);
    for (let a = aliasTarget(cur); a; a = aliasTarget(cur)) {
      chain.push(a);
      if (seen.has(a)) break;
      seen.add(a);
      const t = view.get(a);
      if (!t) break;
      cur = t[t.length - 1]!.value;
    }
    const value = walk(def.value, [path]);
    const ext = def.extensions;
    return { path, ...(type ? { type } : {}), value, css: error ? '' : valueToCss(type, value, ext), chain, definedIn: top.map((d) => d.file), ...(error ? { error } : {}) };
  }

  /** Tokens whose own value aliases `path` directly, across all files. */
  referencedBy(path: string): { path: string; file: string }[] {
    const needle = `{${path}}`;
    return this.defs.filter((d) => JSON.stringify(d.value).includes(needle)).map((d) => ({ path: d.path, file: d.file }));
  }

  cssVarName(path: string): string {
    return `${this.config.cssVar.prefix}${path.split('.').join(this.config.cssVar.separator)}`;
  }
}

// --- validation -------------------------------------------------------------------------------------------

function checkShape(type: string, v: unknown): string | null {
  if (aliasTarget(v)) return null;
  const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
  switch (type) {
    case 'color':
      if (typeof v === 'string') return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? 'warn:color as a hex string: DTCG 2025.10 uses { colorSpace, components, hex }' : 'color must be { colorSpace, components } (or a hex string)';
      if (!isObj(v) || typeof v.colorSpace !== 'string' || !Array.isArray(v.components)) return 'color must be { colorSpace, components, alpha?, hex? }';
      if (v.components.length !== 3 || !v.components.every((c) => typeof c === 'number' || c === 'none' || aliasTarget(c))) return 'color components must be 3 numbers';
      if (v.alpha !== undefined && (typeof v.alpha !== 'number' || v.alpha < 0 || v.alpha > 1)) return 'color alpha must be between 0 and 1';
      if (v.hex !== undefined && !/^#[0-9a-f]{6}$/i.test(String(v.hex))) return 'color hex must be #rrggbb';
      return null;
    case 'dimension':
      if (typeof v === 'string' || typeof v === 'number') return 'warn:dimension as a plain value: DTCG 2025.10 uses { value, unit }';
      return isObj(v) && typeof v.value === 'number' && ['px', 'rem'].includes(String(v.unit)) ? null : 'dimension must be { value: number, unit: "px" | "rem" }';
    case 'duration':
      if (typeof v === 'string') return 'warn:duration as a string: DTCG 2025.10 uses { value, unit }';
      return isObj(v) && typeof v.value === 'number' && ['ms', 's'].includes(String(v.unit)) ? null : 'duration must be { value: number, unit: "ms" | "s" }';
    case 'cubicBezier':
      return Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number') && (v[0] as number) >= 0 && (v[0] as number) <= 1 && (v[2] as number) >= 0 && (v[2] as number) <= 1 ? null : 'cubicBezier must be [x1, y1, x2, y2] with x in 0..1';
    case 'fontFamily':
      return typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')) ? null : 'fontFamily must be a string or an array of strings';
    case 'fontWeight':
      return (typeof v === 'number' && v >= 1 && v <= 1000) || typeof v === 'string' ? null : 'fontWeight must be 1..1000 or a keyword';
    case 'number':
      return typeof v === 'number' ? null : 'number must be a number';
    case 'shadow': {
      const layers = Array.isArray(v) ? v : [v];
      return layers.every((l) => isObj(l) && 'color' in l && 'offsetX' in l && 'offsetY' in l && 'blur' in l) ? null : 'shadow must be { color, offsetX, offsetY, blur, spread? } or an array of them';
    }
    default:
      return null;
  }
}

/** DTCG schema, names, broken and circular aliases (in every mode combination), mode parity, missing layers. */
export function validate(set: TokenSet): Issue[] {
  const issues: Issue[] = [...set.issues];
  for (const d of set.defs) {
    if (d.type && !DTCG_TYPES.has(d.type)) issues.push({ level: 'error', code: 'unknown-type', message: `Unknown $type "${d.type}".`, path: d.path, file: d.file });
    if (d.type) {
      const s = checkShape(d.type, d.value);
      if (s) issues.push({ level: s.startsWith('warn:') ? 'warning' : 'error', code: 'invalid-value', message: s.replace(/^warn:/, ''), path: d.path, file: d.file });
    }
  }
  // Aliases and types per combo, merged so one broken alias is reported once with the modes it breaks in.
  const merged = new Map<string, Issue>();
  const add = (i: Issue, combo: Combo) => {
    const k = `${i.code}|${i.path}|${i.message}`;
    const prev = merged.get(k);
    if (prev) prev.modes!.push(comboKey(combo));
    else merged.set(k, { ...i, modes: [comboKey(combo)] });
  };
  for (const combo of set.combos()) {
    for (const miss of set.missingLayers(combo)) add({ level: 'error', code: 'missing-layer', message: `No file matches layer "${miss}".` }, combo);
    for (const [path, defs] of set.view(combo)) {
      const r = set.resolve(path, combo);
      const def = defs[defs.length - 1]!;
      if (r.error) add({ level: 'error', code: r.error.startsWith('circular') ? 'circular-alias' : 'broken-alias', message: r.error, path, file: def.file }, combo);
      else if (!r.type) add({ level: 'error', code: 'missing-type', message: 'No $type on the token, its groups or its alias target.', path, file: def.file }, combo);
      else if (def.type && aliasTarget(def.value)) {
        const target = set.view(combo).get(aliasTarget(def.value)!);
        const tt = target?.[target.length - 1]?.type;
        if (tt && tt !== def.type) add({ level: 'error', code: 'type-mismatch', message: `$type ${def.type} aliases a ${tt} token (${def.value}).`, path, file: def.file }, combo);
      }
    }
  }
  const total = set.combos().length;
  for (const i of merged.values()) {
    if (i.modes!.length === total) delete i.modes;
    issues.push(i);
  }
  issues.push(...parityIssues(set));
  return issues;
}

/** For modes with parity, every layer file that varies by that mode must define the same token paths. */
export function parityIssues(set: TokenSet): Issue[] {
  const out: Issue[] = [];
  const pathsOf = (file: string) => new Set(set.defs.filter((d) => d.file === file).map((d) => d.path));
  for (const [mode, m] of Object.entries(set.config.modes)) {
    if (!m.parity) continue;
    for (const layer of set.config.tokens.layers) {
      // Optional layers are partial overrides by design (a brand overriding a few light tokens only).
      if (!layer.files.includes(`{${mode}}`) || layer.optional) continue;
      // Hold the other placeholders fixed at each of their values.
      const others = (layer.files.match(/\{([^}]+)\}/g) ?? []).map((p) => p.slice(1, -1)).filter((k) => k !== mode);
      let fixed: Combo[] = [{}];
      for (const o of others) fixed = fixed.flatMap((c) => set.config.modes[o]!.values.map((v) => ({ ...c, [o]: v })));
      for (const c of fixed) {
        const filesByValue = m.values.map((v) => {
          const re = globToRegExp(layer.files.replace(/\{([^}]+)\}/g, (_, k: string) => (k === mode ? v : c[k]!)));
          return { v, files: set.fileNames.filter((f) => re.test(f)) };
        });
        const present = filesByValue.filter((x) => x.files.length);
        if (!present.length) continue;
        for (const x of filesByValue) {
          if (!x.files.length) out.push({ level: 'error', code: 'mode-parity', message: `${mode} "${x.v}" has no file for layer "${layer.files}" while ${present.map((p) => p.v).join(', ')} do.` });
        }
        const sets = present.map((x) => ({ v: x.v, files: x.files, paths: new Set(x.files.flatMap((f) => [...pathsOf(f)])) }));
        const union = new Set(sets.flatMap((s) => [...s.paths]));
        for (const p of union) {
          const lacking = sets.filter((s) => !s.paths.has(p));
          if (lacking.length) {
            const having = sets.find((s) => s.paths.has(p))!;
            out.push({ level: 'error', code: 'mode-parity', message: `Defined for ${mode} ${sets.filter((s) => s.paths.has(p)).map((s) => s.v).join(', ')} but not ${lacking.map((s) => s.v).join(', ')} (${lacking.map((s) => s.files.join(', ')).join('; ')}).`, path: p, file: having.files[0] });
          }
        }
      }
    }
  }
  return out;
}
