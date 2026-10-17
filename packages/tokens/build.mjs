// Builds the DTCG 2025.10 sources in src/ into:
//   dist/tokens.css     every tier as CSS variables, scoped by [data-brand], [data-theme] and [data-density]
//   dist/tokens.ts      typed cssVar map, primitives, brand/theme/density lists
//   dist/resolved.json  resolved values per brand x theme (tooling, docs, Figma plugin)
// and fails if any pair in src/contrast.checks.json drops below its minimum in any brand x theme.
//
// Tiers (docs/ARCHITECTURE.md):
//   primitives/*      raw scales                                  :root
//   brands/<b>        palette roles, radius roles, font roles      :root + [data-brand]
//   semantic/<theme>  purpose aliases -> palette.*                 :root + [data-theme]
//   brands/<b>.<t>    a brand's few semantic overrides             [data-brand][data-theme]
//   semantic/base     theme-independent: motion, layers, icons     :root
//   density/<d>       control heights, paddings, row heights       :root + [data-density]
//   components/*      component tier -> semantic                   :root + every scope attribute
import StyleDictionary from 'style-dictionary';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Brands come from bridge.config.json (modes.brand), so a brand added with `bridge brand create`, the Studio or
// the Figma plugin is built, exported and put through the contrast gate without touching this script.
const repoConfig = JSON.parse(await readFile(new URL('../../bridge.config.json', import.meta.url), 'utf8'));
const brandMode = repoConfig.modes?.brand ?? { values: repoConfig.modes?.brands, default: repoConfig.modes?.defaults?.brand };
export const BRANDS = brandMode.values?.length ? brandMode.values : ['bridge', 'ocean'];
export const THEMES = ['light', 'dark'];
export const DENSITIES = ['comfortable', 'compact'];
const DEFAULT = { brand: brandMode.default ?? BRANDS[0], theme: 'light', density: 'comfortable' };
for (const b of BRANDS) if (!existsSync(`src/brands/${b}.tokens.json`)) throw new Error(`bridge.config.json lists brand "${b}" but src/brands/${b}.tokens.json does not exist.`);

const valueOf = (token) => token.$value ?? token.value;
const typeOf = (token) => token.$type ?? token.type;
const toHex2 = (n) => Math.round(n * 255).toString(16).padStart(2, '0');

function colorToCss(c) {
  if (typeof c === 'string') return c;
  const [r, g, b] = c.components;
  const alpha = c.alpha ?? 1;
  if (alpha < 1) return `rgb(${[r, g, b].map((x) => Math.round(x * 255)).join(' ')} / ${alpha})`;
  return c.hex ?? `#${[r, g, b].map(toHex2).join('')}`;
}
const dimensionToCss = (d) => (typeof d === 'object' ? `${d.value}${d.unit}` : String(d));
function shadowToCss(s) {
  if (typeof s === 'string') return s;
  const layers = Array.isArray(s) ? s : [s];
  return layers
    .map((l) =>
      [l.inset ? 'inset' : '', dimensionToCss(l.offsetX), dimensionToCss(l.offsetY), dimensionToCss(l.blur), dimensionToCss(l.spread), colorToCss(l.color)]
        .filter(Boolean)
        .join(' '),
    )
    .join(', ');
}
const fontFamilyToCss = (f) => (Array.isArray(f) ? f.map((name) => (/\s/.test(name) ? `"${name}"` : name)).join(', ') : f);

StyleDictionary.registerTransform({
  name: 'dtcg/color',
  type: 'value',
  transitive: true,
  filter: (t) => typeOf(t) === 'color' && typeof valueOf(t) === 'object',
  transform: (t) => colorToCss(valueOf(t)),
});
StyleDictionary.registerTransform({
  name: 'dtcg/dimension',
  type: 'value',
  transitive: true,
  filter: (t) => (typeOf(t) === 'dimension' || typeOf(t) === 'duration') && typeof valueOf(t) === 'object',
  transform: (t) => dimensionToCss(valueOf(t)),
});
StyleDictionary.registerTransform({
  name: 'dtcg/shadow',
  type: 'value',
  transitive: true,
  filter: (t) => typeOf(t) === 'shadow' && typeof valueOf(t) === 'object',
  transform: (t) => shadowToCss(valueOf(t)),
});
StyleDictionary.registerTransform({
  name: 'dtcg/cubic-bezier',
  type: 'value',
  transitive: true,
  filter: (t) => typeOf(t) === 'cubicBezier' && Array.isArray(valueOf(t)),
  transform: (t) => `cubic-bezier(${valueOf(t).join(', ')})`,
});
StyleDictionary.registerTransform({
  name: 'dtcg/font-family',
  type: 'value',
  filter: (t) => typeOf(t) === 'fontFamily' && Array.isArray(valueOf(t)),
  transform: (t) => fontFamilyToCss(valueOf(t)),
});
// Unitless numbers that carry a unit in $extensions (letter-spacing in em).
StyleDictionary.registerTransform({
  name: 'bridge/unit-extension',
  type: 'value',
  filter: (t) => typeof valueOf(t) === 'number' && t.$extensions?.['dev.bridge.unit'],
  transform: (t) => `${valueOf(t)}${t.$extensions['dev.bridge.unit']}`,
});
StyleDictionary.registerTransformGroup({
  name: 'bridge/css',
  transforms: ['attribute/cti', 'name/kebab', 'dtcg/color', 'dtcg/dimension', 'dtcg/shadow', 'dtcg/cubic-bezier', 'dtcg/font-family', 'bridge/unit-extension'],
});

const PRIMITIVES = 'src/primitives/**/*.tokens.json';
const BASE = 'src/semantic/base.tokens.json';
const brandFile = (b) => `src/brands/${b}.tokens.json`;
const themeFile = (t) => `src/semantic/${t}.tokens.json`;
const overrideFile = (b, t) => `src/brands/${b}.${t}.tokens.json`;
const densityFile = (d) => `src/density/${d}.tokens.json`;
const COMPONENTS = 'src/components/*.tokens.json';

function makeSd({ include = [], source }) {
  return new StyleDictionary({
    usesDtcg: true,
    include,
    source,
    log: { verbosity: 'silent', warnings: 'disabled' },
    platforms: {
      css: { transformGroup: 'bridge/css', files: [{ destination: 'tokens.css', format: 'css/variables', filter: (t) => t.isSource, options: { outputReferences: true, showFileHeader: false } }] },
      resolved: { transformGroup: 'bridge/css' },
    },
  });
}

// Renders the source tokens of one layer as a CSS block under `selector`.
async function block({ include = [], source, selector, extra = '' }) {
  const sd = makeSd({ include, source });
  const out = (await sd.formatPlatform('css'))[0].output;
  // css/variables emits ":root {...}": swap in our selector.
  return out.replace(/^:root \{/m, `${selector} {`).replace(/\}\s*$/, `${extra}}\n`);
}

// Flat map of resolved token values (references replaced) for one combination.
async function resolve(include, source) {
  const sd = makeSd({ include, source });
  const dict = await sd.getPlatformTokens('resolved');
  return Object.fromEntries(dict.allTokens.map((t) => [t.path.join('.'), { value: valueOf(t), type: typeOf(t), name: t.name, isSource: t.isSource, description: t.$description }]));
}

const overrideSources = (b, t) => (existsSync(overrideFile(b, t)) ? [overrideFile(b, t)] : []);

// --- CSS ---------------------------------------------------------------------------------------------
const parts = [];
parts.push('/* Tier 1: primitives */', await block({ source: [PRIMITIVES], selector: ':root' }));
parts.push('/* Theme-independent semantic: motion, layers, icon sizes */', await block({ include: [PRIMITIVES], source: [BASE], selector: ':root' }));
for (const b of BRANDS) {
  const sel = b === DEFAULT.brand ? `:root,\n[data-brand="${b}"]` : `[data-brand="${b}"]`;
  parts.push(`/* Brand: ${b} (palette, radius and font roles) */`, await block({ include: [PRIMITIVES], source: [brandFile(b)], selector: sel }));
}
for (const t of THEMES) {
  const sel = t === DEFAULT.theme ? `:root,\n[data-theme="${t}"]` : `[data-theme="${t}"]`;
  parts.push(`/* Tier 2: semantic, ${t} */`, await block({ include: [PRIMITIVES, brandFile(DEFAULT.brand)], source: [themeFile(t)], selector: sel, extra: `  color-scheme: ${t};\n` }));
}
for (const b of BRANDS) {
  for (const t of THEMES) {
    const src = overrideSources(b, t);
    if (!src.length) continue;
    // Light is the default theme, so a brand scope with no data-theme gets the light overrides.
    const sel = t === DEFAULT.theme ? `[data-brand="${b}"]:not([data-theme="dark"])` : `[data-brand="${b}"][data-theme="${t}"]`;
    parts.push(`/* Brand ${b}: semantic overrides, ${t} */`, await block({ include: [PRIMITIVES, brandFile(b), themeFile(t)], source: src, selector: sel }));
  }
}
for (const d of DENSITIES) {
  const sel = d === DEFAULT.density ? `:root,\n[data-density="${d}"]` : `[data-density="${d}"]`;
  parts.push(`/* Density: ${d} */`, await block({ include: [PRIMITIVES], source: [densityFile(d)], selector: sel }));
}
// Component tokens alias semantic tokens. They are re-declared on every scope element so a nested
// [data-theme] or [data-brand] scope re-resolves them instead of inheriting the root's values.
parts.push(
  '/* Tier 3: component tokens (aliases of semantic tokens) */',
  await block({
    include: [PRIMITIVES, BASE, brandFile(DEFAULT.brand), themeFile(DEFAULT.theme)],
    source: [COMPONENTS],
    selector: ':root,\n[data-theme],\n[data-brand],\n[data-density]',
  }),
);
// Reduced motion: transitions collapse to 0ms; spinners keep turning, slower.
const motion = await resolve([PRIMITIVES], [BASE]);
const reduced = Object.values(motion)
  .filter((t) => t.isSource && t.name.startsWith('motion-duration-'))
  .map((t) => `    --${t.name}: ${t.name.endsWith('spin') ? '1400ms' : '0ms'};`)
  .join('\n');
parts.push('/* Reduced motion */', `@media (prefers-reduced-motion: reduce) {\n  :root,\n  [data-theme],\n  [data-brand],\n  [data-density] {\n${reduced}\n  }\n}\n`);

const header = '/* Generated by packages/tokens/build.mjs from DTCG sources in src/. Do not edit by hand. */\n\n';
await mkdir('dist', { recursive: true });
await writeFile('dist/tokens.css', header + parts.join('\n'));

// --- Resolved values + contrast checks ------------------------------------------------------------
const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const checks = JSON.parse(await readFile('src/contrast.checks.json', 'utf8')).pairs;
const resolved = {};
const failures = [];
const report = [];
for (const b of BRANDS) {
  resolved[b] = {};
  for (const t of THEMES) {
    const tokens = await resolve([PRIMITIVES, BASE, brandFile(b)], [themeFile(t), ...overrideSources(b, t), densityFile(DEFAULT.density), COMPONENTS]);
    resolved[b][t] = Object.fromEntries(Object.entries(tokens).filter(([, v]) => v.isSource).map(([k, v]) => [k, v.value]));
    for (const [fg, bg, min] of checks) {
      const a = tokens[fg]?.value;
      const c = tokens[bg]?.value;
      if (!a || !c || !/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(c)) {
        failures.push(`${b}/${t}: cannot check ${fg} on ${bg} (missing or non-opaque color)`);
        continue;
      }
      const r = ratio(a, c);
      report.push({ brand: b, theme: t, fg, bg, ratio: Math.round(r * 100) / 100, min });
      if (r < min) failures.push(`${b}/${t}: ${fg} (${a}) on ${bg} (${c}) is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  }
}
await writeFile('dist/resolved.json', JSON.stringify({ brands: BRANDS, themes: THEMES, densities: DENSITIES, default: DEFAULT, values: resolved, contrast: report }, null, 2) + '\n');

// --- TypeScript ----------------------------------------------------------------------------------
const prim = await resolve([], [PRIMITIVES]);
const varNames = new Set();
const layered = [BASE, brandFile(DEFAULT.brand), themeFile(DEFAULT.theme), densityFile(DEFAULT.density), COMPONENTS];
for (const src of layered) {
  const r = await resolve(src === BASE ? [PRIMITIVES] : [PRIMITIVES, BASE, brandFile(DEFAULT.brand), themeFile(DEFAULT.theme), densityFile(DEFAULT.density)], [src]);
  for (const v of Object.values(r)) if (v.isSource) varNames.add(v.name);
}
const line = (k, v) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`;
const ts = [
  '// Generated by packages/tokens/build.mjs. Do not edit by hand.',
  '',
  '/** Every non-primitive token as a CSS variable reference. Values follow [data-brand], [data-theme] and [data-density]. */',
  'export const cssVar = {',
  ...[...varNames].sort().map((n) => line(n, `var(--${n})`)),
  '} as const;',
  '',
  '/** Resolved primitive values. Components never use these; they are for tooling and docs. */',
  'export const primitives = {',
  ...Object.values(prim).filter((t) => t.isSource).map((t) => line(t.name, t.value)),
  '} as const;',
  '',
  `export const brands = ${JSON.stringify(BRANDS)} as const;`,
  `export const themes = ${JSON.stringify(THEMES)} as const;`,
  `export const densities = ${JSON.stringify(DENSITIES)} as const;`,
  `export const defaults = ${JSON.stringify(DEFAULT)} as const;`,
  '/** Viewport breakpoints in px, for JS logic (CSS media queries use the same literals). */',
  `export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;`,
  '',
  'export type Brand = (typeof brands)[number];',
  'export type Theme = (typeof themes)[number];',
  'export type Density = (typeof densities)[number];',
  'export type TokenName = keyof typeof cssVar;',
  'export type SemanticToken = TokenName;',
  'export type PrimitiveToken = keyof typeof primitives;',
  '',
].join('\n');
await writeFile('dist/tokens.ts', ts);

console.log(`tokens: wrote dist/tokens.css, dist/tokens.ts, dist/resolved.json (${BRANDS.length} brands x ${THEMES.length} themes x ${DENSITIES.length} densities)`);
console.log(`tokens: ${report.length} contrast checks, ${failures.length} failing`);
if (failures.length) {
  console.error(failures.map((f) => `  x ${f}`).join('\n'));
  process.exit(1);
}
