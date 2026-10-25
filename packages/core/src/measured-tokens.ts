// Tokens from a measure: the custom properties a design system's CSS defines (`bridge specs --measure --tokens`, the
// `tokens` of measured-specs.json) written as a two-tier DTCG repo Bridge reads like any other: Primitives (one value)
// and Semantic (aliases, one file per mode). For a design system that ships no token files, only CSS.
//
// - Only the properties measured stories use, with their alias targets (the harvest marks them `used`).
// - A primitive holds one value. A property whose literal changes with the mode (compiled themes: Carbon, Primer) is
//   semantic: in each mode it aliases the primitive holding that value, an existing one or a palette entry made for it.
// - A semantic property aliases its declared target when that target is a fixed primitive, else the primitive of its
//   value in each mode: the two tiers never chain semantic to semantic.
// - The first mode set the measure read is the theme axis (one Figma mode per value).
//
// Pure: no Node or DOM API.

import type { MeasuredSpecsFile, MeasuredTokenProperty, MeasuredTokens } from './measured-spec';

export interface TokenRepoFromMeasure {
  /** Files relative to `root` (`primitives/measured.tokens.json`, `semantic/<mode>.tokens.json`). */
  files: Record<string, string>;
  /** bridge.config.json for them. */
  config: Record<string, unknown>;
  /** CSS custom property -> token path written (`--cds-layer-01` -> layer.01). */
  paths: Map<string, string>;
  report: { primitives: number; semantic: number; palette: number; modes: string[]; skipped: string[] };
}

type Value = string | number;

const hex2 = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');

/** `rgb(31, 41, 55)` / `rgba(...)` -> 0..255 channels and alpha. */
function rgbOf(v: string): { r: number; g: number; b: number; a: number } | undefined {
  const m = /^rgba?\(([^)]*)\)$/i.exec(v.trim());
  if (!m) return undefined;
  const [r, g, b, a] = m[1]!.split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? Number(x.slice(0, -1)) / 100 : Number(x)));
  return [r, g, b].every((x) => x !== undefined && Number.isFinite(x)) ? { r: r!, g: g!, b: b!, a: a === undefined || !Number.isFinite(a) ? 1 : a } : undefined;
}

/** A DTCG $type and $value for a measured value, or undefined when Bridge has no variable for it. */
function dtcg(type: MeasuredTokenProperty['type'], v: Value, name: string): { $type: string; $value: unknown } | undefined {
  // An empty value (a variable that resolves to nothing, or to itself) is no token: what uses it keeps its computed value.
  if (typeof v === 'string' && !v.trim()) return undefined;
  if (type === 'color' && typeof v === 'string') {
    const c = rgbOf(v);
    if (!c) return undefined;
    const hex = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ''}`;
    return { $type: 'color', $value: { colorSpace: 'srgb', components: [c.r / 255, c.g / 255, c.b / 255], ...(c.a < 1 ? { alpha: c.a } : {}), hex } };
  }
  if (type === 'length' && typeof v === 'number') return { $type: 'dimension', $value: { value: v, unit: 'px' } };
  if (type === 'number' && typeof v === 'number') return { $type: 'number', $value: v };
  if (type === 'string' && typeof v === 'string' && /font-?family/i.test(name)) {
    const families = v.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    return families.length ? { $type: 'fontFamily', $value: families } : undefined;
  }
  return undefined;
}

/** Same value for the palette index: colors as hex, lengths and numbers as text. */
const valueKey = (type: string, v: Value) => `${type}:${typeof v === 'string' ? (rgbOf(v) ? Object.values(rgbOf(v)!).join(',') : v) : v}`;

/** A token path from the measure's (`layer/background` -> layer.background), unique, never both a token and a group. */
function dotPaths(props: MeasuredTokenProperty[]): Map<string, string> {
  const base = new Map(props.map((p) => [p.name, p.path.split('/').filter(Boolean).join('.').replace(/[^\w.-]/g, '-')]));
  const all = new Set(base.values());
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const [name, path] of base) {
    // A token that is also a group (`layer` next to `layer.background`): its value moves to `layer.default`.
    let p = [...all].some((x) => x.startsWith(`${path}.`)) ? `${path}.default` : path;
    for (let i = 2; taken.has(p); i++) p = `${path}-${i}`;
    taken.add(p);
    out.set(name, p);
  }
  return out;
}

function nest(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, token] of Object.entries(flat).sort(([a], [b]) => a.localeCompare(b))) {
    const parts = path.split('.');
    let at = root;
    for (const part of parts.slice(0, -1)) at = (at[part] ??= {}) as Record<string, unknown>;
    at[parts.at(-1)!] = token;
  }
  return root;
}

/** The two-tier repo for a token harvest (see the top of this file). */
export function tokenRepoFromMeasure(t: MeasuredTokens): TokenRepoFromMeasure {
  const axis = t.modes[0];
  const modes = axis ? [axis.default, ...axis.values.filter((v) => v !== axis.default)] : ['default'];
  const key = (mode: string) => (axis ? `${axis.global}:${mode}` : '');
  const props = t.properties.filter((p) => p.used);
  const byName = new Map(props.map((p) => [p.name, p]));
  const paths = dotPaths(props);
  const valueIn = (p: MeasuredTokenProperty, mode: string) => p.values?.[key(mode)] ?? p.value;
  const skipped: string[] = [];

  // Primitives: one value, as the CSS writes it (a literal, or the resolved value of an expression).
  const primitives: Record<string, unknown> = {};
  const byValue = new Map<string, string>();
  const fixed = props.filter((p) => p.tier === 'primitive' && !p.values);
  for (const p of fixed) {
    const d = dtcg(p.type, p.value, p.name);
    if (!d) {
      skipped.push(p.name);
      continue;
    }
    const path = paths.get(p.name)!;
    primitives[path] = d;
    if (!byValue.has(valueKey(p.type, p.value))) byValue.set(valueKey(p.type, p.value), path);
  }
  // A palette entry for a value no fixed primitive holds.
  let palette = 0;
  const primitiveOf = (type: MeasuredTokenProperty['type'], v: Value, name: string): string | undefined => {
    const k = valueKey(type, v);
    const known = byValue.get(k);
    if (known) return known;
    const d = dtcg(type, v, name);
    if (!d) return undefined;
    const hex = (d.$value as { hex?: string }).hex;
    let path = type === 'color' && hex ? `palette.${hex.slice(1)}` : `palette.${type}.${String(v).replace(/[^\w]/g, '-')}`;
    for (let i = 2; primitives[path]; i++) path = `${path}-${i}`;
    primitives[path] = d;
    byValue.set(k, path);
    palette++;
    return path;
  };

  // Semantic: aliases per mode, to a fixed primitive (its declared target) or the primitive of its value there.
  const semantic: Record<string, Record<string, unknown>> = Object.fromEntries(modes.map((m) => [m, {}]));
  let semanticCount = 0;
  for (const p of props) {
    if (p.tier === 'primitive' && !p.values) continue;
    const path = paths.get(p.name)!;
    let ok = true;
    const per: Record<string, string> = {};
    for (const mode of modes) {
      const declared = p.tier === 'semantic' ? (p.aliasOfByMode?.[key(mode)] ?? p.aliasOf) : undefined;
      const target = declared ? byName.get(declared) : undefined;
      const direct = target && target.tier === 'primitive' && !target.values && primitives[paths.get(target.name)!] ? paths.get(target.name)! : undefined;
      const to = direct ?? primitiveOf(p.type, valueIn(p, mode), p.name);
      if (!to) {
        ok = false;
        break;
      }
      per[mode] = to;
    }
    if (!ok) {
      skipped.push(p.name);
      continue;
    }
    const type = (primitives[per[modes[0]!]!] as { $type: string }).$type;
    for (const mode of modes) semantic[mode]![path] = { $type: type, $value: `{${per[mode]}}` };
    semanticCount++;
  }

  const files: Record<string, string> = { 'primitives/measured.tokens.json': `${JSON.stringify(nest(primitives), null, 2)}\n` };
  for (const mode of modes) files[`semantic/${mode}.tokens.json`] = `${JSON.stringify(nest(semantic[mode]!), null, 2)}\n`;
  const config: Record<string, unknown> = {
    tokens: {
      root: 'tokens',
      include: ['**/*.tokens.json'],
      tiers: { primitive: ['primitives'], semantic: ['semantic'] },
      layers: [{ files: 'primitives/*.tokens.json' }, { files: 'semantic/{theme}.tokens.json' }],
    },
    modes: { theme: { values: modes, default: modes[0] } },
  };
  return {
    files,
    config,
    paths: new Map([...paths].filter(([name]) => primitives[paths.get(name)!] || Object.values(semantic).some((s) => s[paths.get(name)!]))),
    report: { primitives: Object.keys(primitives).length, semantic: semanticCount, palette, modes, skipped },
  };
}

/** How a measure names a CSS variable it found no token for (core/node measure's default): `--cds-layer-01` -> cds.layer.01. */
const measureDefaultPath = (name: string) => name.replace(/^--/, '').split('-').filter(Boolean).join('.');

/**
 * The measured specs with their values pointing at the tokens `tokenRepoFromMeasure` wrote: a value the measure named
 * after its CSS variable (`cds.layer.01`) becomes the written path (`layer.01`), and a field whose declaration is a
 * variable alone (`var(--cds-button-primary, #0f62fe)`) gets the written path of the first variable of its chain. Other
 * values are kept: a calc() of a token, or a value that only matches one, stays a literal.
 */
export function withRepoTokenPaths(file: MeasuredSpecsFile, paths: Map<string, string>): MeasuredSpecsFile {
  const rename = new Map([...paths].map(([name, path]) => [measureDefaultPath(name), path]));
  type Spec = NonNullable<MeasuredSpecsFile['stories'][number]['spec']>;
  const spec = <T extends Spec | undefined>(s: T): T => {
    if (!s) return s;
    const values: Spec['values'] = {};
    for (const [part, fields] of Object.entries(s.values)) values[part] = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' && rename.has(v) ? rename.get(v) : v]));
    for (const [part, fields] of Object.entries(s.tokens ?? {})) {
      for (const [field, t] of Object.entries(fields ?? {})) {
        if (!t || t.via !== 'declared' || !t.exact) continue;
        const path = t.chain.map((name) => paths.get(name)).find(Boolean);
        if (path) values[part] = { ...values[part], [field]: path };
      }
    }
    return { ...s, values } as T;
  };
  return { ...file, stories: file.stories.map((s) => ({ ...s, ...(s.spec ? { spec: spec(s.spec) } : {}), ...(s.instances ? { instances: s.instances.map((i) => spec(i)) } : {}) })) };
}
