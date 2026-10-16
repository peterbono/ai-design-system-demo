// Layered token sets: any DTCG repo described by bridge.config.json "tokens.layers" and "modes".
//
// The tier model in token-set.ts maps the Bridge layout onto Figma collections (one collection per tier,
// one Figma mode per brand, theme or density). Tools that only read and check tokens (the CLI and the MCP
// server) need something more general: a repo with a core.json, a theme/ folder and no brands at all must
// work too. A layered set resolves a token for a combination of mode values ("combo") by stacking the
// layer files for that combo, lowest first, the last definition winning; aliases resolve inside the stack.
//
// Values are formatted for CSS exactly like packages/tokens/build.mjs, so a resolved value can be compared
// with dist/resolved.json byte for byte.

import type { BridgeConfig } from './config';
import { isAlias, aliasTarget as targetOf } from './values';

export interface LayeredDef {
  path: string;
  type?: string;
  value: unknown;
  description?: string;
  extensions?: Record<string, unknown>;
  deprecated?: unknown;
  /** File relative to tokens.root. */
  file: string;
}

export interface LayerIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
  file?: string;
  /** Mode combinations the issue appears in; absent when it appears in all of them. */
  modes?: string[];
}

/** A value per mode name, e.g. { brand: "ocean", theme: "dark", density: "compact" }. */
export type Combo = Record<string, string>;

export interface LayeredResolution {
  path: string;
  type?: string;
  /** Raw DTCG value with every alias replaced. */
  value: unknown;
  /** CSS-ready string, the way the token build writes it. */
  css: string;
  /** Alias hops, starting with the token itself. */
  chain: string[];
  /** Files that define the token in this combo, highest layer last. */
  definedIn: string[];
  error?: string;
}

export const DTCG_TYPES = new Set(['color', 'dimension', 'fontFamily', 'fontWeight', 'duration', 'cubicBezier', 'number', 'strokeStyle', 'border', 'transition', 'shadow', 'gradient', 'typography', 'fontStyle', 'string', 'boolean']);

/** Alias target of a value, or null when it is not an alias. */
export const aliasOf = (v: unknown): string | null => (isAlias(v) ? targetOf(v) : null);

/** `*` (one segment), `**` (any depth) and `?` globs, matched against the whole path. */
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

/** Tokens of one parsed file, with $type inherited from groups. Names DTCG forbids are reported. */
export function flattenLayerFile(json: unknown, file: string, issues: LayerIssue[]): LayeredDef[] {
  const out: LayeredDef[] = [];
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
      const p = [...path, k].join('.');
      if (/[{}.]/.test(k)) issues.push({ level: 'error', code: 'invalid-name', message: `Name "${k}" contains {, } or . which DTCG forbids.`, path: p, file });
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, [...path, k], type);
      else issues.push({ level: 'error', code: 'not-a-token', message: `"${p}" is neither a token (no $value) nor a group.`, path: p, file });
    }
  };
  walk(json, []);
  return out;
}

// --- CSS formatting (matches packages/tokens/build.mjs) ---------------------------------------------------

const toHex2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');

/** One-line JSON in the house style: `{ "a": 1, "b": [1, 2] }`. */
export function compactJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(compactJson).join(', ')}]`;
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${compactJson(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

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

// --- the set ----------------------------------------------------------------------------------------------

export class LayeredTokenSet {
  readonly defs: LayeredDef[] = [];
  readonly issues: LayerIssue[] = [];
  readonly fileNames: string[];
  private readonly views = new Map<string, { map: Map<string, LayeredDef[]>; missing: string[] }>();

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
      this.defs.push(...flattenLayerFile(json, f, this.issues));
    }
  }

  get modeNames() {
    return Object.keys(this.config.axes);
  }
  get defaultCombo(): Combo {
    return Object.fromEntries(Object.entries(this.config.axes).map(([k, m]) => [k, m.default]));
  }
  /** Every combination of the given modes (all modes when omitted); other modes stay at default. */
  combos(only?: string[]): Combo[] {
    let out: Combo[] = [this.defaultCombo];
    for (const [name, m] of Object.entries(this.config.axes)) {
      if (only && !only.includes(name)) continue;
      out = out.flatMap((c) => m.values.map((v) => ({ ...c, [name]: v })));
    }
    return out;
  }
  normalizeCombo(partial: Partial<Combo> = {}): Combo {
    const c = { ...this.defaultCombo };
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) continue;
      const m = this.config.axes[k];
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
  view(combo: Combo): Map<string, LayeredDef[]> {
    const key = comboKey(combo);
    let v = this.views.get(key);
    if (!v) {
      const { files, missing } = this.layerFiles(combo);
      const map = new Map<string, LayeredDef[]>();
      const byFile = new Map<string, LayeredDef[]>();
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
  defsOf(path: string): LayeredDef[] {
    return this.defs.filter((d) => d.path === path);
  }

  /** First combo whose layers include `file`, preferring the default. */
  comboForFile(file: string): Combo {
    const all = [this.defaultCombo, ...this.combos()];
    return all.find((c) => this.layerFiles(c).files.includes(file)) ?? this.defaultCombo;
  }

  resolve(path: string, combo: Combo): LayeredResolution {
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
      const a = aliasOf(v);
      if (a) return deref(a, stack);
      if (Array.isArray(v)) return v.map((x) => walk(x, stack));
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, stack)]));
      return v;
    };
    // Top-level alias chain, for designers: color.text.muted -> palette.neutral.600 -> color.steel.600.
    let cur = def.value;
    const seen = new Set([path]);
    for (let a = aliasOf(cur); a; a = aliasOf(cur)) {
      chain.push(a);
      if (seen.has(a)) break;
      seen.add(a);
      const t = view.get(a);
      if (!t) break;
      cur = t[t.length - 1]!.value;
    }
    const value = walk(def.value, [path]);
    return { path, ...(type ? { type } : {}), value, css: error ? '' : valueToCss(type, value, def.extensions), chain, definedIn: top.map((d) => d.file), ...(error ? { error } : {}) };
  }

  /** Tokens whose own value aliases `path` directly, across all files. */
  referencedBy(path: string): { path: string; file: string }[] {
    const needle = `{${path}}`;
    return this.defs.filter((d) => JSON.stringify(d.value).includes(needle)).map((d) => ({ path: d.path, file: d.file }));
  }

  cssVarName(path: string): string {
    return `${this.config.cssVar.prefix}${path.split('.').join(this.config.cssVar.separator)}`;
  }

  /** Repo-relative path of a token file. */
  repoPath(file: string): string {
    const root = this.config.tokens.root;
    return root === '.' || !root ? file : `${root.replace(/\/$/, '')}/${file}`;
  }
}

/** Token files of a repo listing: under tokens.root, matching include and not exclude, minus the contrast file. Paths relative to root. */
export function selectTokenFiles(config: BridgeConfig, repoFiles: string[]): string[] {
  const root = config.tokens.root.replace(/\/$/, '');
  const rel = (f: string) => (root === '.' || !root ? f : f.startsWith(`${root}/`) ? f.slice(root.length + 1) : null);
  const inc = config.tokens.include.map(globToRegExp);
  const exc = config.tokens.exclude.map(globToRegExp);
  return repoFiles
    .filter((f) => f !== config.contrast?.path)
    .map(rel)
    .filter((f): f is string => f !== null && inc.some((r) => r.test(f)) && !exc.some((r) => r.test(f)));
}

// --- validation -------------------------------------------------------------------------------------------

function checkShape(type: string, v: unknown): string | null {
  if (aliasOf(v)) return null;
  const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
  switch (type) {
    case 'color':
      if (typeof v === 'string') return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? 'warn:color as a hex string: DTCG 2025.10 uses { colorSpace, components, hex }' : 'color must be { colorSpace, components } (or a hex string)';
      if (!isObj(v) || typeof v.colorSpace !== 'string' || !Array.isArray(v.components)) return 'color must be { colorSpace, components, alpha?, hex? }';
      if (v.components.length !== 3 || !v.components.every((c) => typeof c === 'number' || c === 'none' || aliasOf(c))) return 'color components must be 3 numbers';
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

/** DTCG shapes, names, broken and circular aliases (in every mode combination), mode parity, missing layers. */
export function validateLayered(set: LayeredTokenSet): LayerIssue[] {
  const issues: LayerIssue[] = [...set.issues];
  for (const d of set.defs) {
    if (d.type && !DTCG_TYPES.has(d.type)) issues.push({ level: 'error', code: 'unknown-type', message: `Unknown $type "${d.type}".`, path: d.path, file: d.file });
    if (d.type) {
      const s = checkShape(d.type, d.value);
      if (s) issues.push({ level: s.startsWith('warn:') ? 'warning' : 'error', code: 'invalid-value', message: s.replace(/^warn:/, ''), path: d.path, file: d.file });
    }
  }
  // Aliases and types per combo, merged so one broken alias is reported once with the modes it breaks in.
  const merged = new Map<string, LayerIssue>();
  const add = (i: LayerIssue, combo: Combo) => {
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
      else if (def.type && aliasOf(def.value)) {
        const target = set.view(combo).get(aliasOf(def.value)!);
        const tt = target?.[target.length - 1]?.type;
        if (tt && tt !== def.type) add({ level: 'error', code: 'type-mismatch', message: `$type ${def.type} aliases a ${tt} token (${String(def.value)}).`, path, file: def.file }, combo);
      }
    }
  }
  const total = set.combos().length;
  for (const i of merged.values()) {
    if (i.modes!.length === total) delete i.modes;
    issues.push(i);
  }
  issues.push(...layeredParityIssues(set));
  return issues;
}

/** For modes with parity, every layer file that varies by that mode must define the same token paths. */
export function layeredParityIssues(set: LayeredTokenSet): LayerIssue[] {
  const out: LayerIssue[] = [];
  const pathsOf = (file: string) => new Set(set.defs.filter((d) => d.file === file).map((d) => d.path));
  for (const [mode, m] of Object.entries(set.config.axes)) {
    if (!m.parity) continue;
    for (const layer of set.config.tokens.layers) {
      // Optional layers are partial overrides by design (a brand overriding a few light tokens only).
      if (!layer.files.includes(`{${mode}}`) || layer.optional) continue;
      // Hold the other placeholders fixed at each of their values.
      const others = (layer.files.match(/\{([^}]+)\}/g) ?? []).map((p) => p.slice(1, -1)).filter((k) => k !== mode);
      let fixed: Combo[] = [{}];
      for (const o of others) fixed = fixed.flatMap((c) => (set.config.axes[o]?.values ?? []).map((v) => ({ ...c, [o]: v })));
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
            out.push({ level: 'error', code: 'mode-parity', message: `Defined for ${mode} ${sets.filter((s) => s.paths.has(p)).map((s) => s.v).join(', ')} but not ${lacking.map((s) => s.v).join(', ')} (${lacking.map((s) => s.files.join(', ')).join('; ')}).`, path: p, file: having.files[0]! });
          }
        }
      }
    }
  }
  return out;
}
