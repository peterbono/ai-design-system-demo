// New brands: one planner shared by the CLI (`bridge brand create`), the MCP server (bridge_plan_brand,
// bridge_propose_brand), the Figma plugin (a new mode in the Brand collection) and the docs site Studio.
//
// A brand only re-points palette roles, radius roles, font roles and typography families (docs/DESIGN-LANGUAGE.md,
// "Second brand"). planNewBrand copies a starting brand (or the default brand's structure for "blank"), fills
// the primary, accent, link and neutral palette roles with ramps from the shared ramp engine (ramps.js, the
// code packages/tokens/scripts/ramps.mjs runs), copies the starting brand's theme overrides when it has any,
// adds the slug to modes.brand in bridge.config.json and runs the contrast gate for the new brand in every theme.
// Nothing is written: the result lists files, contrast, validation, risk tier and a PR body; each surface decides
// where the files go (a local branch, a remote pull request), never to the default branch.

import { CONFIG_FILE, type BridgeConfig, loadConfig, tokensPath, toConfigJson } from './config';
import { formatChangeset } from './changeset';
import { type Combo, type LayerIssue, LayeredTokenSet, validateLayered } from './layered';
import { type LayeredContrastResult, checkLayeredPair } from './layered-review';
import { RISK_LABELS, type RiskResult, classifyRisk } from './risk';
import { type Step, LIGHTNESS, PIN_TOLERANCE, STEPS, anchoredRamp, bellChroma, dtcgColor, fromHex, generateRamp, isHex, neutralChroma, neutralOffset, tintedNeutral, toOklch } from './ramps';
import { coerceValue } from './token-edits';
import { type ContrastPair, parseContrastChecks } from './wcag';

// --- inputs -----------------------------------------------------------------------------------------------

/** A ramp anchor: a "#rrggbb" brand color (pinned in the ramp) or an OKLCH hue in degrees (0..360). */
export type HueInput = string | number;

export interface BrandRadiusInput {
  /** px, on the radius scale (0, 2, 4, 6, 10, 12, 16, 20). */
  inset?: number;
  control?: number;
  container?: number;
  overlay?: number;
}

export interface BrandFontsInput {
  /** Display and headings (typography display, h1, h2). A curated font id, see BRAND_FONTS. */
  heading?: string;
  /** Body, UI and captions (typography h3, body, ui, caption). */
  text?: string;
}

export interface NewBrandInput {
  /** Lowercase letters, digits and single dashes, 2 to 24 characters: "acme", "north-star". */
  slug: string;
  /** Display name. Default: the slug in title case. */
  name?: string;
  /** Existing brand to start from, or "blank" (the default brand's structure, neutral type and no overrides). */
  from: string;
  /** Primary ramp (also accent and link unless set in `colors`). A hex is pinned at the step primary actions use. */
  primaryHue?: HueInput;
  /** Neutral ramp: text, lines, canvases. A hex tints it with its hue; a pure grey gives a pure grey ramp. */
  neutralHue?: HueInput;
  /** "More colors": separate ramps for accent (signal, focus ring) and link. */
  colors?: { accent?: HueInput; link?: HueInput };
  radius?: BrandRadiusInput;
  fonts?: BrandFontsInput;
  /** Exact values for brand tokens, by path (palette.primary.600, radius.control...): hex, "12px", "{alias}" or DTCG. */
  overrides?: Record<string, unknown>;
}

/** What the planner reads: the repo's config, its token files (relative to tokens.root) and contrast pairs. */
export interface BrandSource {
  config: BridgeConfig;
  /** bridge.config.json as written; edited with a minimal diff. Without it the canonical form is written. */
  configText?: string | undefined;
  files: Map<string, string> | Record<string, string>;
  /** contrast.checks.json text. */
  contrastText?: string | undefined;
}

// --- curated choices --------------------------------------------------------------------------------------

export interface BrandFont {
  id: string;
  label: string;
  /** Primitive token the role aliases. */
  token: string;
  /** Where it reads well: headings only (a display serif) or both. */
  use: 'heading' | 'both';
}

/** The short list the Studio offers. Every font here is self-hosted by @bridge-ds/tokens/fonts.css. */
export const BRAND_FONTS: BrandFont[] = [
  { id: 'fraunces', label: 'Fraunces', token: 'font.family.fraunces', use: 'heading' },
  { id: 'instrument-sans', label: 'Instrument Sans', token: 'font.family.instrument-sans', use: 'both' },
  { id: 'plex-sans', label: 'IBM Plex Sans', token: 'font.family.plex-sans', use: 'both' },
  { id: 'system', label: 'System UI', token: 'font.family.system', use: 'both' },
];

export interface RadiusPreset {
  id: string;
  label: string;
  hint: string;
  radius: Required<BrandRadiusInput>;
}

export const RADIUS_PRESETS: RadiusPreset[] = [
  { id: 'soft', label: 'Soft', hint: 'Rounded, like Bridge', radius: { inset: 6, control: 12, container: 20, overlay: 20 } },
  { id: 'balanced', label: 'Balanced', hint: 'Tighter, like Ocean', radius: { inset: 4, control: 10, container: 16, overlay: 20 } },
  { id: 'crisp', label: 'Crisp', hint: 'Near square corners', radius: { inset: 2, control: 4, container: 6, overlay: 10 } },
];

const HEADING_ROLES = ['display', 'h1', 'h2'];
const TEXT_ROLES = ['h3', 'body', 'ui', 'caption'];
const RADIUS_ROLES = ['inset', 'control', 'container', 'overlay'] as const;
const RESERVED = new Set(['default', 'base', 'all', 'none', 'new', 'blank', 'primitives', 'semantic', 'components', 'density']);
export const BRAND_SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DEFAULT_PRIMARY_CHROMA = 0.14;

// --- outputs ----------------------------------------------------------------------------------------------

export interface PlannedFile {
  /** Repo-relative path. */
  path: string;
  action: 'create' | 'modify';
  content: string;
}

export interface BrandIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
  file?: string;
}

export interface BrandSwatch {
  step: number;
  hex: string;
}

export interface BrandContrastSummary {
  /** Pairs checked for the new brand, every theme. */
  checks: number;
  passing: number;
  failing: LayeredContrastResult[];
  /** Every result for the new brand, for tables. */
  results: LayeredContrastResult[];
  themes: string[];
}

export interface NewBrandPlan {
  ok: boolean;
  slug: string;
  name: string;
  from: string;
  title: string;
  /** Suggested branch name (governance.branchPrefix + brand-<slug>). */
  branch: string;
  files: PlannedFile[];
  /** Token files after the change, relative to tokens.root (feed it to brandPreviewVariables or a LayeredTokenSet). */
  tokenFiles: Record<string, string>;
  /** bridge.config.json after the change, as text. */
  configText: string;
  /** Primary, neutral (and accent, link when they differ) ramps of the new brand, resolved. */
  ramps: Record<string, BrandSwatch[]>;
  /** Step of the primary ramp that primary actions use in the light theme (where a hex primary is pinned). */
  actionStep: number;
  contrast: BrandContrastSummary;
  /** Slug, input and DTCG problems. Errors block a proposal. */
  issues: BrandIssue[];
  risk: RiskResult & { bump: 'minor' };
  changeset?: { path: string; content: string } | undefined;
}

// --- helpers ----------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const fileMap = (f: BrandSource['files']) => (f instanceof Map ? new Map(f) : new Map(Object.entries(f)));
export const brandDisplayName = (slug: string) => slug.split('-').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

/** The layer patterns brands use: the brand file and the optional brand x theme overrides. */
function brandLayers(config: BridgeConfig): { brand?: string; override?: string; overrideAxis?: string } {
  const out: { brand?: string; override?: string; overrideAxis?: string } = {};
  for (const l of config.tokens.layers) {
    const ph = (l.files.match(/\{([^}]+)\}/g) ?? []).map((p) => p.slice(1, -1));
    if (!ph.includes('brand')) continue;
    if (ph.length === 1 && !out.brand) out.brand = l.files;
    else if (ph.length === 2 && !out.override) {
      out.override = l.files;
      out.overrideAxis = ph.find((p) => p !== 'brand');
    }
  }
  return out;
}
const fill = (pattern: string, combo: Combo) => pattern.replace(/\{([^}]+)\}/g, (_, k: string) => combo[k] ?? `{${k}}`);

function setAt(doc: Json, path: string, node: Json) {
  const keys = path.split('.');
  let cur = doc;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k] as Json;
  }
  const last = keys[keys.length - 1]!;
  const prev = isObj(cur[last]) ? (cur[last] as Json) : {};
  cur[last] = { ...prev, ...node };
}
function getAt(doc: Json, path: string): Json | undefined {
  let cur: unknown = doc;
  for (const k of path.split('.')) cur = isObj(cur) ? cur[k] : undefined;
  return isObj(cur) ? cur : undefined;
}
/** $type of a token in a doc, inherited from its groups. */
function typeAt(doc: Json, path: string): string | undefined {
  let cur: unknown = doc;
  let type: string | undefined;
  for (const k of path.split('.')) {
    if (!isObj(cur)) return type;
    if (typeof cur.$type === 'string') type = cur.$type;
    cur = cur[k];
  }
  return isObj(cur) && typeof cur.$type === 'string' ? cur.$type : type;
}

/** Ramp for a hue input: a hex is pinned (at `pinStep`), a number is generated with the default chroma. */
function rampFor(input: HueInput, pinStep: Step | undefined, kind: 'color' | 'neutral'): { ramp: Record<number, number[]>; issue?: BrandIssue; anchor: string } {
  if (typeof input === 'number' || (typeof input === 'string' && /^\d+(\.\d+)?$/.test(input.trim()))) {
    const hue = ((Number(input) % 360) + 360) % 360;
    const ramp = kind === 'neutral' ? generateRamp({ hue, chroma: neutralChroma(), offset: neutralOffset() }) : generateRamp({ hue, chroma: bellChroma(DEFAULT_PRIMARY_CHROMA) });
    return { ramp, anchor: `OKLCH hue ${Math.round(hue)}` };
  }
  const hex = String(input).trim();
  if (!isHex(hex)) throw new Error(`"${hex}" is not a color. Use #rrggbb or a hue in degrees (0 to 360).`);
  if (kind === 'neutral') {
    const n = tintedNeutral(hex);
    return { ramp: n.ramp, anchor: `${hex.toUpperCase()} (hue ${Math.round(n.hue)})` };
  }
  const a = anchoredRamp(hex, pinStep);
  const issue: BrandIssue | undefined =
    a.distance > PIN_TOLERANCE
      ? {
          level: 'warning',
          code: 'pin-off-ladder',
          message: `${hex.toUpperCase()} is ${a.distance > 0.12 ? 'much ' : ''}${toOklch(fromHex(hex)).L > LIGHTNESS[a.step] ? 'lighter' : 'darker'} than the ${a.step} step it is pinned to, so the ramp around it will not read as one family. Primary actions use this step: pick a ${a.step >= 600 ? 'deeper' : 'lighter'} color.`,
        }
      : undefined;
  return { ramp: a.ramp, anchor: `${hex.toUpperCase()} pinned at ${a.step}`, ...(issue ? { issue } : {}) };
}

/** Points a palette role at a primitive ramp: palette.<role>.<step> -> {color.<ramp>.<step>} (two tiers, never literals). */
function aliasRamp(doc: Json, role: string, ramp: string, description: string) {
  const group = getAt(doc, `palette.${role}`);
  if (!group) return;
  for (const s of STEPS) {
    if (!(String(s) in group)) continue;
    setAt(doc, `palette.${role}.${s}`, { $value: `{color.${ramp}.${s}}` });
  }
  group.$description = description;
}

/** Primitive ramps a new brand adds: ramp name -> description and DTCG color per step. */
type PrimitiveRamps = Map<string, { description: string; steps: Map<number, unknown> }>;

/** Inserts `slug` into modes.brand.values (or modes.brands) with a minimal text change. */
export function addBrandToConfigText(text: string, slug: string): string {
  const canonical = /("brand"\s*:\s*\{\s*"values"\s*:\s*\[)([^\]]*)(\])/;
  const flat = /("brands"\s*:\s*\[)([^\]]*)(\])/;
  for (const re of [canonical, flat]) {
    const m = re.exec(text);
    if (!m) continue;
    const items = m[2]!.trim();
    const sep = items.includes('\n') ? `,${/\n(\s*)"/.exec(m[2]!)?.[0]?.replace(/"$/, '') ?? ' '}` : ', ';
    return text.slice(0, m.index) + m[1] + (items ? `${m[2]!.replace(/\s*$/, '')}${sep}"${slug}"` : `"${slug}"`) + (m[2]!.match(/\s*$/)?.[0] ?? '') + m[3] + text.slice(m.index + m[0].length);
  }
  throw new Error('bridge.config.json has no modes.brand.values list to add the brand to.');
}

// --- listing ----------------------------------------------------------------------------------------------

export interface BrandSummary {
  slug: string;
  name: string;
  default: boolean;
  file: string;
  description?: string;
  /** Resolved color.action.primary.bg in the default theme, when the repo has it. */
  primary?: string;
  /** Theme override files the brand has. */
  overrides: string[];
}

export function listBrands(source: BrandSource): BrandSummary[] {
  const { config } = source;
  const files = fileMap(source.files);
  const set = new LayeredTokenSet(config, files);
  const layers = brandLayers(config);
  const brandAxis = config.axes.brand;
  if (!brandAxis || !layers.brand) return [];
  return brandAxis.values.map((slug) => {
    const file = fill(layers.brand!, { brand: slug });
    let doc: Json = {};
    try {
      doc = JSON.parse(files.get(file) ?? '{}') as Json;
    } catch {
      /* reported by validation */
    }
    const meta = isObj(doc.$extensions) && isObj(doc.$extensions['dev.bridge.brand']) ? (doc.$extensions['dev.bridge.brand'] as Json) : {};
    const combo = set.normalizeCombo({ brand: slug });
    const primary = set.resolve('color.action.primary.bg', combo);
    const overrides = layers.override ? (config.axes[layers.overrideAxis!]?.values ?? []).map((v) => fill(layers.override!, { brand: slug, [layers.overrideAxis!]: v })).filter((f) => files.has(f)) : [];
    return {
      slug,
      name: typeof meta.name === 'string' ? meta.name : brandDisplayName(slug),
      default: slug === brandAxis.default,
      file: tokensPath(config, file),
      ...(typeof doc.$description === 'string' ? { description: doc.$description } : {}),
      ...(primary.css && !primary.error ? { primary: primary.css } : {}),
      overrides: overrides.map((f) => tokensPath(config, f)),
    };
  });
}

// --- planning ---------------------------------------------------------------------------------------------

/** Problems with a slug before anything is generated (the Studio uses it as you type). */
export function checkBrandSlug(config: BridgeConfig, files: BrandSource['files'], slug: string): BrandIssue[] {
  const out: BrandIssue[] = [];
  const s = slug.trim();
  if (!s) return [{ level: 'error', code: 'slug-empty', message: 'Give the brand a name.' }];
  if (s.length < 2 || s.length > 24 || !BRAND_SLUG_RE.test(s)) out.push({ level: 'error', code: 'slug-format', message: 'Use 2 to 24 lowercase letters, digits and single dashes, starting with a letter: "acme" or "north-star".' });
  const taken = Object.values(config.axes).flatMap((a) => a.values);
  if (config.axes.brand?.values.includes(s)) out.push({ level: 'error', code: 'slug-taken', message: `A brand called "${s}" already exists. Pick another name or edit that brand.` });
  else if (taken.includes(s) || RESERVED.has(s)) out.push({ level: 'error', code: 'slug-reserved', message: `"${s}" is a reserved mode name. Pick another name.` });
  const layer = brandLayers(config).brand;
  const map = fileMap(files);
  if (layer && !config.axes.brand?.values.includes(s) && map.has(fill(layer, { brand: s }))) out.push({ level: 'error', code: 'slug-file-exists', message: `${tokensPath(config, fill(layer, { brand: s }))} already exists. Pick another name or add it to bridge.config.json.` });
  return out;
}

export function planNewBrand(source: BrandSource, input: NewBrandInput): NewBrandPlan {
  const { config } = source;
  const files = fileMap(source.files);
  const issues: BrandIssue[] = [];
  const slug = input.slug.trim();
  const name = input.name?.trim() || brandDisplayName(slug);
  const layers = brandLayers(config);
  const brandAxis = config.axes.brand;
  if (!brandAxis || !layers.brand) throw new Error('This repo has no brand mode: bridge.config.json needs modes.brand and a tokens layer with {brand}.');
  issues.push(...checkBrandSlug(config, files, slug));

  const from = input.from?.trim() || brandAxis.default;
  const blank = from === 'blank';
  if (!blank && !brandAxis.values.includes(from)) throw new Error(`Unknown brand "${from}" to start from. Brands: ${brandAxis.values.join(', ')} (or "blank").`);
  const template = blank ? brandAxis.default : from;
  const templateFile = fill(layers.brand, { brand: template });
  const templateText = files.get(templateFile);
  if (!templateText) throw new Error(`${tokensPath(config, templateFile)} is missing.`);
  const doc = JSON.parse(templateText) as Json;
  const before = new LayeredTokenSet(config, files);

  // Step that primary actions use in the light (default) theme of the starting brand: a hex primary is pinned there.
  const chain = before.resolve('color.action.primary.bg', before.normalizeCombo({ brand: template })).chain;
  const actionStep = Number(/^palette\.primary\.(\d+)$/.exec(chain.find((c) => /^palette\.primary\.\d+$/.test(c)) ?? '')?.[1] ?? 600) as Step;

  const anchors: Record<string, string> = {};
  const safeRamp = (role: string, hue: HueInput, kind: 'color' | 'neutral', pin?: Step) => {
    try {
      const r = rampFor(hue, pin, kind);
      if (r.issue) issues.push({ ...r.issue, path: `palette.${role}` });
      anchors[role] = r.anchor;
      return r.ramp;
    } catch (e) {
      issues.push({ level: 'error', code: 'invalid-color', message: (e as Error).message, path: `palette.${role}` });
      return undefined;
    }
  };
  // Generated ramps become primitives (color.<slug>-<role>.<step>); the brand file only aliases them.
  const prims: PrimitiveRamps = new Map();
  const addRamp = (role: string, ramp: Record<number, number[]>, description: string) => {
    const steps = new Map<number, unknown>(STEPS.map((st) => [st, dtcgColor(ramp[st]!)]));
    prims.set(`${slug}-${role}`, { description, steps });
    return `${slug}-${role}`;
  };
  if (input.primaryHue !== undefined && input.primaryHue !== '') {
    const ramp = safeRamp('primary', input.primaryHue, 'color', actionStep);
    if (ramp) {
      const r = addRamp('primary', ramp, `${name} primary. Generated by Bridge from ${anchors.primary}.`);
      aliasRamp(doc, 'primary', r, `${name} primary.`);
      if (input.colors?.accent === undefined) aliasRamp(doc, 'accent', r, `${name} accent: the primary ramp.`);
      if (input.colors?.link === undefined) aliasRamp(doc, 'link', r, `${name} links: the primary ramp.`);
    }
  }
  for (const role of ['accent', 'link'] as const) {
    const hue = input.colors?.[role];
    if (hue === undefined || hue === '') continue;
    const ramp = safeRamp(role, hue, 'color');
    if (ramp) aliasRamp(doc, role, addRamp(role, ramp, `${name} ${role}. Generated by Bridge from ${anchors[role]}.`), `${name} ${role}.`);
  }
  if (input.neutralHue !== undefined && input.neutralHue !== '') {
    const ramp = safeRamp('neutral', input.neutralHue, 'neutral');
    if (ramp) aliasRamp(doc, 'neutral', addRamp('neutral', ramp, `${name} neutral. Generated by Bridge from ${anchors.neutral}.`), `${name} neutral.`);
  }

  // Radius roles: aliases of the radius scale.
  const scale = new Map<number, string>();
  for (const [path, defs] of before.view(before.defaultCombo)) {
    const m = /^radius\.([\w-]+)$/.exec(path);
    const v = defs[defs.length - 1]!.value;
    if (m && isObj(v) && typeof v.value === 'number' && v.unit === 'px' && !getAt(doc, path)) scale.set(v.value, m[1]!);
  }
  const radius = input.radius ?? (blank ? RADIUS_PRESETS[0]!.radius : undefined);
  if (radius) {
    for (const role of RADIUS_ROLES) {
      const px = radius[role];
      if (px === undefined) continue;
      const step = scale.get(px);
      if (!step) issues.push({ level: 'error', code: 'radius-off-scale', message: `radius.${role} ${px}px is not on the radius scale (${[...scale.keys()].filter((x) => x < 9999).sort((a, b) => a - b).join(', ')} px).`, path: `radius.${role}` });
      else if (getAt(doc, `radius.${role}`)) setAt(doc, `radius.${role}`, { $value: `{radius.${step}}` });
    }
  }

  // Font roles and typography families.
  const fonts = input.fonts ?? (blank ? { heading: 'instrument-sans', text: 'instrument-sans' } : undefined);
  const fontToken = (id: string | undefined, role: string) => {
    if (!id) return undefined;
    const f = BRAND_FONTS.find((x) => x.id === id || x.token === id);
    const token = f?.token ?? (id.startsWith('font.family.') ? id : `font.family.${id}`);
    if (!before.view(before.defaultCombo).has(token) || ['font.family.sans', 'font.family.display', 'font.family.mono'].includes(token)) {
      issues.push({ level: 'error', code: 'unknown-font', message: `"${id}" is not a font this repo self-hosts. Pick one of: ${BRAND_FONTS.map((x) => x.label).join(', ')}.`, path: `font.family.${role}` });
      return undefined;
    }
    return token;
  };
  const heading = fontToken(fonts?.heading, 'display');
  const text = fontToken(fonts?.text, 'sans');
  if (heading && getAt(doc, 'font.family.display')) setAt(doc, 'font.family.display', { $value: `{${heading}}` });
  if (text && getAt(doc, 'font.family.sans')) setAt(doc, 'font.family.sans', { $value: `{${text}}` });
  for (const r of HEADING_ROLES) if (heading && getAt(doc, `typography.${r}.family`)) setAt(doc, `typography.${r}.family`, { $value: `{${heading}}` });
  for (const r of TEXT_ROLES) if (text && getAt(doc, `typography.${r}.family`)) setAt(doc, `typography.${r}.family`, { $value: `{${text}}` });

  // Exact values (the Figma plugin sends every variable of the new mode).
  for (const [path, raw] of Object.entries(input.overrides ?? {})) {
    const node = getAt(doc, path);
    if (!node || !('$value' in node)) {
      issues.push({ level: 'error', code: 'unknown-token', message: `${path} is not a token of the ${template} brand file, so a new brand cannot set it.`, path });
      continue;
    }
    setAt(doc, path, { $value: coerceValue(raw, typeAt(doc, path), node.$value) });
  }

  // Exact colors (Figma values, overrides) are hoisted too: a literal palette color becomes the primitive
  // color.<slug>-<role>.<step> and the role aliases it, so brand files never hold literal values.
  const palette = getAt(doc, 'palette');
  for (const [role, group] of Object.entries(palette ?? {})) {
    if (role.startsWith('$') || !isObj(group)) continue;
    for (const [step, node] of Object.entries(group)) {
      if (step.startsWith('$') || !isObj(node) || !('$value' in node) || typeof node.$value === 'string') continue;
      const ramp = `${slug}-${role}`;
      const entry = prims.get(ramp) ?? { description: `${name} ${role}. Exact values set when the brand was created.`, steps: new Map<number, unknown>() };
      entry.steps.set(Number(step), node.$value);
      prims.set(ramp, entry);
      setAt(doc, `palette.${role}.${step}`, { $value: `{color.${ramp}.${step}}` });
    }
  }
  const primDir = config.tokens.tiers.primitive?.[0]?.replace(/\/$/, '') ?? config.tokens.primitives;
  const primFile = `${primDir}/${slug}.tokens.json`;
  if (prims.size && files.has(primFile)) issues.push({ level: 'error', code: 'slug-file-exists', message: `${tokensPath(config, primFile)} already exists. Pick another name.` });
  for (const r of prims.keys()) if (before.allPaths().some((p) => p.startsWith(`color.${r}.`))) issues.push({ level: 'error', code: 'ramp-exists', message: `A primitive ramp color.${r} already exists. Pick another name.` });

  doc.$description = `${name}: created with Bridge, started from ${blank ? 'a blank brand' : brandDisplayName(from)}.`;
  doc.$extensions = { ...(isObj(doc.$extensions) ? doc.$extensions : {}), 'dev.bridge.brand': { name, from, ...(Object.keys(anchors).length ? { anchors } : {}) } };
  // Keep $description and $extensions on top, like the hand-written brand files.
  const { $description, $extensions, ...rest } = doc;
  const brandFile = fill(layers.brand, { brand: slug });
  const nextFiles = new Map(files);
  const created: string[] = [];
  if (prims.size) {
    const color: Json = { $type: 'color' };
    for (const [r, { description, steps }] of prims) {
      const ramp: Json = { $description: description };
      for (const st of [...steps.keys()].sort((a, b) => a - b)) ramp[String(st)] = { $value: steps.get(st) };
      color[r] = ramp;
    }
    const prim = { $description: `${name} brand ramps, generated by Bridge (@bridge-ds/core ramp engine). Never used by components directly: brands/${slug}.tokens.json maps them to palette roles.`, color };
    nextFiles.set(primFile, `${JSON.stringify(prim, null, 2)}\n`);
    created.push(primFile);
  }
  created.push(brandFile);
  nextFiles.set(brandFile, `${JSON.stringify({ $description, $extensions, ...rest }, null, 2)}\n`);

  // Theme overrides of the starting brand come along: they point at palette roles, so they follow the new ramps.
  if (!blank && layers.override && layers.overrideAxis) {
    for (const v of config.axes[layers.overrideAxis]?.values ?? []) {
      const src = fill(layers.override, { brand: from, [layers.overrideAxis]: v });
      const text = files.get(src);
      if (!text) continue;
      const o = JSON.parse(text) as Json;
      const out = { ...o, $description: `${name} overrides on top of semantic/${v}, copied from ${brandDisplayName(from)}.` };
      const dst = fill(layers.override, { brand: slug, [layers.overrideAxis]: v });
      nextFiles.set(dst, `${JSON.stringify(out, null, 2)}\n`);
      created.push(dst);
    }
  }

  // bridge.config.json: modes.brand += slug.
  const baseConfigText = source.configText ?? `${JSON.stringify(toConfigJson(config), null, 2)}\n`;
  let configText = baseConfigText;
  let nextConfig = config;
  try {
    configText = addBrandToConfigText(baseConfigText, slug);
    nextConfig = issues.some((i) => i.code.startsWith('slug-')) ? config : loadConfig(configText);
  } catch (e) {
    issues.push({ level: 'error', code: 'config', message: (e as Error).message });
  }

  // Validation (only problems the new brand brings) and the contrast gate for the new brand in every theme.
  const after = new LayeredTokenSet(nextConfig, nextFiles);
  const key = (i: LayerIssue) => `${i.code}|${i.path ?? ''}|${i.message}`;
  const known = new Set(validateLayered(before).map(key));
  const brandKey = `brand=${slug}`;
  for (const i of validateLayered(after)) {
    if (known.has(key(i))) continue;
    if (i.modes && !i.modes.some((m) => m.split(',').includes(brandKey)) && !created.includes(i.file ?? '')) continue;
    issues.push({ level: i.level, code: i.code, message: i.message, ...(i.path ? { path: i.path } : {}), ...(i.file ? { file: tokensPath(config, i.file) } : {}) });
  }
  const pairs: ContrastPair[] = parseContrastChecks(source.contrastText);
  const inGate = nextConfig.axes.brand?.values.includes(slug);
  const combos = inGate ? after.combos(nextConfig.contrast?.modes).filter((c) => c.brand === slug) : [];
  const results = combos.flatMap((c) => pairs.map((p) => checkLayeredPair(after, p, c)));
  const failing = results.filter((r) => !r.pass);
  const themes = [...new Set(combos.map((c) => c.theme).filter((t): t is string => !!t))];

  // Ramps, resolved (so Figma values and overrides show as they will ship).
  const ramps: Record<string, BrandSwatch[]> = {};
  if (inGate) {
    const combo = after.normalizeCombo({ brand: slug });
    const read = (role: string) =>
      STEPS.map((s) => ({ step: s, hex: after.resolve(`palette.${role}.${s}`, combo).css })).filter((x) => /^#[0-9a-f]{6}$/i.test(x.hex));
    ramps.primary = read('primary');
    ramps.neutral = read('neutral');
    for (const role of ['accent', 'link']) {
      const r = read(role);
      if (JSON.stringify(r) !== JSON.stringify(ramps.primary)) ramps[role] = r;
    }
  }

  // Tier: every token of the new files is an addition, bridge.config.json is a guardrail. Tier 3, minor.
  const addedTokens = after.defs.filter((d) => created.includes(d.file)).map((d) => ({ kind: 'added' as const, path: d.path }));
  const risk = classifyRisk({ tokenChanges: addedTokens, files: [{ path: CONFIG_FILE, status: 'modified' }], config });
  const planned: PlannedFile[] = [
    ...created.map((f) => ({ path: tokensPath(config, f), action: 'create' as const, content: nextFiles.get(f)! })),
    { path: CONFIG_FILE, action: 'modify', content: configText },
  ];
  const cs = config.changesets ?? (config.changeset ? { dir: '.changeset', package: config.changeset.package } : undefined);
  const changeset = cs
    ? {
        path: `${cs.dir}/bridge-brand-${slug}.md`,
        content: formatChangeset(cs.package, 'minor', `Add the ${name} brand (\`${slug}\`), started from ${blank ? 'a blank brand' : brandDisplayName(from)}.`, `- ${created.map((f) => `\`${tokensPath(config, f)}\``).join('\n- ')}\n- \`${CONFIG_FILE}\`: modes.brand gains "${slug}", so the token build and the contrast gate cover it.`),
      }
    : undefined;
  if (changeset) planned.push({ path: changeset.path, action: 'create', content: changeset.content });

  const errors = issues.filter((i) => i.level === 'error');
  return {
    ok: errors.length === 0 && failing.length === 0 && results.length > 0,
    slug,
    name,
    from,
    title: `Add the ${name} brand`,
    branch: `${config.governance.branchPrefix}brand-${slug || 'new'}`,
    files: planned,
    tokenFiles: Object.fromEntries(nextFiles),
    configText,
    ramps,
    actionStep,
    contrast: { checks: results.length, passing: results.length - failing.length, failing, results, themes },
    issues,
    risk: { ...risk, bump: 'minor' },
    changeset,
  };
}

/** CSS variables of a planned brand in one theme (every semantic and component token), for live previews. */
export function brandPreviewVariables(source: BrandSource, plan: Pick<NewBrandPlan, 'slug' | 'tokenFiles' | 'configText'>, theme?: string): Record<string, string> {
  let config = source.config;
  try {
    config = loadConfig(plan.configText);
  } catch {
    /* keep the old config: the preview falls back to the default brand */
  }
  const set = new LayeredTokenSet(config, new Map(Object.entries(plan.tokenFiles)));
  let combo: Combo;
  try {
    combo = set.normalizeCombo({ brand: plan.slug, ...(theme ? { theme } : {}) });
  } catch {
    combo = set.normalizeCombo(theme ? { theme } : {});
  }
  const out: Record<string, string> = {};
  for (const path of set.view(combo).keys()) {
    const tier = set.tierOf(path);
    if (tier === 'primitive') continue;
    const r = set.resolve(path, combo);
    if (!r.error && r.css) out[set.cssVarName(path)] = r.css;
  }
  return out;
}

// --- PR body ----------------------------------------------------------------------------------------------

const code = (s: string) => `\`${s}\``;

/** The "New brand" section: swatch ramps and the contrast summary. GitHub shows a chip next to `#rrggbb`. */
export function newBrandSection(plan: NewBrandPlan): string {
  const roles = Object.keys(plan.ramps);
  const rampTable = roles.length
    ? [
        `| Step | ${roles.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(' | ')} |`,
        `| --- | ${roles.map(() => '---').join(' | ')} |`,
        ...STEPS.map((s) => `| ${s}${s === plan.actionStep ? ' (actions)' : ''} | ${roles.map((r) => code(plan.ramps[r]!.find((x) => x.step === s)?.hex ?? '')).join(' | ')} |`),
      ].join('\n')
    : '_No ramps resolved._';
  const c = plan.contrast;
  const contrastLine = c.failing.length
    ? `**${c.failing.length} of ${c.checks} pairs fail** for ${plan.name} (${c.themes.join(' and ')}).`
    : `All ${c.checks} contrast checks pass for ${plan.name} in ${c.themes.join(' and ')}.`;
  const failRows = c.failing.slice(0, 20).map((r) => `| ${code(r.fg)} on ${code(r.bg)} | ${r.modes.split(',').find((m) => m.startsWith('theme='))?.slice(6) ?? r.modes} | ${r.ratio ?? 'n/a'} | ${r.min} |`);
  const tightest = [...c.results].filter((r) => r.pass && r.ratio !== null).sort((a, b) => a.ratio! - a.min - (b.ratio! - b.min)).slice(0, 3);
  return [
    '## New brand',
    '',
    `- Name: **${plan.name}** (${code(plan.slug)})`,
    `- Started from: ${plan.from === 'blank' ? 'a blank brand' : brandDisplayName(plan.from)}`,
    `- Primary actions use step ${plan.actionStep} of the primary ramp in the light theme.`,
    '',
    rampTable,
    '',
    '### Contrast',
    '',
    contrastLine,
    ...(failRows.length ? ['', '| Pair | Theme | Ratio | Min |', '| --- | --- | --- | --- |', ...failRows] : []),
    ...(tightest.length ? ['', `Tightest passing pairs: ${tightest.map((r) => `${code(r.fg)} on ${code(r.bg)} ${r.ratio}:1 (min ${r.min})`).join('; ')}.`] : []),
  ].join('\n');
}

export interface NewBrandBodyOptions {
  /** "the bridge CLI", "Bridge MCP", "the Bridge Studio", "the DS Bridge Figma plugin". */
  tool: string;
  author?: string;
  /** true when an AI agent proposed it. */
  agent?: boolean;
  /** Free text from the person proposing. */
  notes?: string;
}

export function composeNewBrandBody(plan: NewBrandPlan, opts: NewBrandBodyOptions): string {
  const t = plan.risk.tier;
  const box = (n: 1 | 2 | 3) => `- ${n === t ? '[x]' : '[ ]'} ${RISK_LABELS[n]}`;
  const errors = plan.issues.filter((i) => i.level === 'error');
  const warnings = plan.issues.filter((i) => i.level === 'warning');
  return [
    '## What changed and why',
    '',
    `Adds the ${plan.name} brand. Components do not change: the brand re-points palette, radius and font roles, and the token build, the contrast gate and the docs pick it up from ${code('bridge.config.json')}.`,
    ...(opts.notes?.trim() ? ['', opts.notes.trim()] : []),
    '',
    `Proposed through ${opts.tool}${opts.author ? ` by ${opts.author}` : ''}.${opts.agent ? ' Agent-authored: a human design owner and tech owner review and merge.' : ''}`,
    '',
    newBrandSection(plan),
    '',
    '## Files',
    '',
    ...plan.files.map((f) => `- ${f.action === 'create' ? 'Create' : 'Modify'} ${code(f.path)}`),
    '',
    '## Risk tier',
    '',
    box(1),
    box(2),
    box(3),
    '',
    `- Brand added: ${plan.files.filter((f) => f.action === 'create' && f.path.endsWith('.tokens.json')).length} token file(s), every token new`,
    `- ${code('bridge.config.json')} is a guardrail file`,
    `- Semver bump: ${code(plan.risk.bump)} for ${code('@bridge-ds/tokens')}`,
    '',
    '## Checks',
    '',
    `- Token validation: ${errors.length ? `**${errors.length} error(s)**` : 'no errors'} (DTCG shapes, aliases, every mode)${warnings.length ? `, ${warnings.length} warning(s): ${warnings.map((w) => w.message).join(' ')}` : ''}`,
    `- Contrast gate for ${plan.name}: ${plan.contrast.failing.length ? `**${plan.contrast.failing.length} failing pair(s)**` : `all ${plan.contrast.checks} pairs pass`}`,
    '',
    '## Authored by',
    '',
    opts.agent ? '- [ ] Human' : '- [x] Human',
    opts.agent ? '- [x] AI agent (Claude), reviewed by a human before merge' : '- [ ] AI agent',
    '',
    '## Design review checklist',
    '',
    '- [ ] Checked in light and dark, with real components (Studio preview or Storybook brand switch)',
    '- [ ] Primary, zone and link colors read as one family',
    '- [ ] Changeset bump matches the tier',
    '',
  ].join('\n');
}
