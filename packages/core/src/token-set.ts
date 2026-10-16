// Build the logical token set (one entry per token, values per mode of its tier) from the repo's
// DTCG files. The tier of a file comes from where it lives (see RepoLayout in types.ts).

import { type BridgeConfig, DEFAULT_TOKEN_PATHS, type TokenPaths } from './config';
import { type TokenDocument, flattenTokens, parseTokenFile } from './dtcg-codec';
import type { ResolveContext } from './resolver';
import {
  EXT_ID,
  EXT_SCOPES,
  type LogicalToken,
  type ModeFile,
  type RepoLayout,
  SINGLE_MODE,
  TIER_AXIS,
  type ThemeOverride,
  type Tier,
  type TokenMap,
} from './types';

export interface TokenSet {
  tokens: TokenMap;
  byPath: Map<string, LogicalToken>;
  docs: Map<string, TokenDocument>;
  layout: RepoLayout;
  /** Tier directories and mode order the set was read with. */
  options: LayoutOptions;
  /** Brand x theme overrides of semantic tokens (brands/<brand>.<theme>.tokens.json). */
  overrides: ThemeOverride[];
  /** overrideKey(brand, theme, path) -> value. */
  overrideIndex: Map<string, unknown>;
  /** Problems found while reading (duplicate paths, missing types, parse errors). */
  problems: string[];
}

export const isTokenFile = (file: string) => file.endsWith('.tokens.json');

/** Default id of a token that does not declare `com.dsbridge.id`. */
export const pathId = (path: string) => `path:${path}`;

export const overrideKey = (brand: string, theme: string, path: string) => `${brand}|${theme}|${path}`;

/** Where each tier lives (relative to the tokens root) and the preferred mode order (default first). */
export interface LayoutOptions {
  dirs?: Partial<Pick<TokenPaths, 'primitives' | 'brands' | 'semantic' | 'base' | 'density' | 'components'>> | undefined;
  order?: { brand?: string[] | undefined; theme?: string[] | undefined; density?: string[] | undefined } | undefined;
}

/** Layout options from a bridge.config.json: tier directories and mode order (defaults first). */
export function layoutOptions(config: BridgeConfig): LayoutOptions {
  const first = (list: string[], def: string | undefined) => (def ? [def, ...list.filter((m) => m !== def)] : list);
  return {
    dirs: config.tokens,
    order: {
      brand: first(config.modes.brands, config.modes.defaults.brand),
      theme: first(config.modes.themes, config.modes.defaults.theme),
      density: first(config.modes.densities, config.modes.defaults.density),
    },
  };
}

const FALLBACK_ORDER = { theme: ['light', 'dark'], brand: [] as string[], density: [] as string[] };
const stem = (file: string) => file.slice(file.lastIndexOf('/') + 1).replace(/\.tokens\.json$/, '');

function ordered(list: ModeFile[], pref: string[]): ModeFile[] {
  const rank = (m: string) => (pref.indexOf(m) === -1 ? 99 : pref.indexOf(m));
  return list.sort((a, b) => rank(a.mode) - rank(b.mode) || a.mode.localeCompare(b.mode));
}

/**
 * Sort token files (paths relative to the tokens root) into tiers. Files outside every tier
 * directory are treated as primitives, so a flat legacy layout still loads.
 */
export function detectLayout(files: string[], options: LayoutOptions = {}): RepoLayout {
  const d = { ...DEFAULT_TOKEN_PATHS, ...options.dirs };
  const inDir = (file: string, dir: string) => file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes('/');
  const layout: RepoLayout = { primitiveFiles: [], brands: [], baseFiles: [], themes: [], overrides: [], densities: [], componentFiles: [] };
  for (const file of files.filter(isTokenFile).sort()) {
    const name = stem(file);
    if (inDir(file, d.brands)) {
      const parts = name.split('.');
      if (parts.length === 2) layout.overrides.push({ brand: parts[0]!, theme: parts[1]!, file });
      else layout.brands.push({ mode: name, file });
    } else if (inDir(file, d.semantic)) {
      if (name === d.base) layout.baseFiles.push(file);
      else layout.themes.push({ mode: name, file });
    } else if (inDir(file, d.density)) layout.densities.push({ mode: name, file });
    else if (file.startsWith(`${d.components}/`)) layout.componentFiles.push(file);
    else layout.primitiveFiles.push(file);
  }
  ordered(layout.brands, options.order?.brand ?? FALLBACK_ORDER.brand);
  ordered(layout.themes, options.order?.theme ?? FALLBACK_ORDER.theme);
  ordered(layout.densities, options.order?.density ?? FALLBACK_ORDER.density);
  return layout;
}

/** Mode keys of a tier in this repo, in display order. */
export function modesOf(layout: RepoLayout, tier: Tier): string[] {
  switch (TIER_AXIS[tier]) {
    case 'brand':
      return layout.brands.map((b) => b.mode);
    case 'theme':
      return layout.themes.map((t) => t.mode);
    case 'density':
      return layout.densities.map((d) => d.mode);
    default:
      return [SINGLE_MODE];
  }
}

/** File holding a multi-mode tier's value for `mode`. */
export function modeFile(layout: RepoLayout, tier: Tier, mode: string): string | undefined {
  const list = TIER_AXIS[tier] === 'brand' ? layout.brands : TIER_AXIS[tier] === 'theme' ? layout.themes : TIER_AXIS[tier] === 'density' ? layout.densities : [];
  return list.find((m) => m.mode === mode)?.file;
}

/** Default file for a new single-mode token at `path` (relative to the tokens root). */
export function defaultFile(tier: Tier, path: string, dirs: LayoutOptions['dirs'] = {}): string {
  const d = { ...DEFAULT_TOKEN_PATHS, ...dirs };
  const head = path.split('.')[0];
  if (tier === 'base') return `${d.semantic}/${d.base}.tokens.json`;
  if (tier === 'component') return `${d.components}/${head}.tokens.json`;
  return `${d.primitives}/${head}.tokens.json`;
}

/** Default resolution context: first brand, first theme, first density, with overrides. */
export function defaultContext(set: Pick<TokenSet, 'layout' | 'overrideIndex'>): ResolveContext {
  return {
    brand: set.layout.brands[0]?.mode,
    theme: set.layout.themes[0]?.mode,
    density: set.layout.densities[0]?.mode,
    overrides: set.overrideIndex,
  };
}

/** Context to describe a token's value in one mode of its own tier (other axes at their default). */
export function contextFor(set: Pick<TokenSet, 'layout' | 'overrideIndex'>, tier: Tier, mode: string): ResolveContext {
  const ctx = defaultContext(set);
  const axis = TIER_AXIS[tier];
  if (axis) ctx[axis] = mode;
  return ctx;
}

function readScopes(ext: Record<string, unknown> | undefined): string[] | undefined {
  const s = ext?.[EXT_SCOPES];
  return Array.isArray(s) && s.every((x) => typeof x === 'string') ? (s as string[]) : undefined;
}

function readId(ext: Record<string, unknown> | undefined): string | undefined {
  const id = ext?.[EXT_ID];
  return typeof id === 'string' && id ? id : undefined;
}

const TIER_LABEL: Record<Tier, string> = {
  primitive: 'a primitive',
  brand: 'a brand token',
  base: 'a base semantic token',
  semantic: 'a semantic token',
  density: 'a density token',
  component: 'a component token',
};

/** `files` maps paths relative to the tokens root to file contents. */
export function buildTokenSet(files: Record<string, string>, options: LayoutOptions = {}): TokenSet {
  const problems: string[] = [];
  const docs = new Map<string, TokenDocument>();
  for (const [file, text] of Object.entries(files)) {
    if (!isTokenFile(file)) continue;
    try {
      docs.set(file, parseTokenFile(file, text));
    } catch (err) {
      problems.push(`${file} is not valid JSON: ${(err as Error).message}`);
    }
  }
  const layout = detectLayout([...docs.keys()], options);
  const tokens: TokenMap = new Map();
  const byPath = new Map<string, LogicalToken>();

  const add = (t: LogicalToken) => {
    if (tokens.has(t.id)) {
      problems.push(`Two tokens share the id "${t.id}" (${tokens.get(t.id)!.path} and ${t.path}).`);
      return;
    }
    tokens.set(t.id, t);
    byPath.set(t.path, t);
  };

  const single = (tier: Tier, fileList: string[]) => {
    for (const file of fileList) {
      for (const flat of flattenTokens(docs.get(file)!)) {
        const prev = byPath.get(flat.path);
        if (prev) {
          problems.push(
            prev.tier === tier
              ? `${flat.path} is defined twice (${prev.files[SINGLE_MODE]} and ${file}).`
              : `${flat.path} exists both as ${TIER_LABEL[prev.tier]} and as ${TIER_LABEL[tier]} (${file}).`,
          );
          continue;
        }
        if (!flat.type) problems.push(`${flat.path} in ${file} has no $type.`);
        add({
          id: readId(flat.extensions) ?? pathId(flat.path),
          path: flat.path,
          type: flat.type ?? 'unknown',
          tier,
          values: { [SINGLE_MODE]: flat.value },
          description: flat.description,
          scopes: readScopes(flat.extensions),
          files: { [SINGLE_MODE]: file },
        });
      }
    }
  };

  const multi = (tier: Tier, modes: ModeFile[]) => {
    const merged = new Map<string, LogicalToken>();
    for (const { mode, file } of modes) {
      for (const flat of flattenTokens(docs.get(file)!)) {
        let t = merged.get(flat.path);
        if (!t) {
          const prev = byPath.get(flat.path);
          if (prev) {
            problems.push(`${flat.path} exists both as ${TIER_LABEL[prev.tier]} and as ${TIER_LABEL[tier]} (${file}).`);
            continue;
          }
          t = {
            id: readId(flat.extensions) ?? pathId(flat.path),
            path: flat.path,
            type: flat.type ?? 'unknown',
            tier,
            values: {},
            description: flat.description,
            scopes: readScopes(flat.extensions),
            files: {},
          };
          merged.set(flat.path, t);
          if (!flat.type) problems.push(`${flat.path} in ${file} has no $type.`);
        } else if (flat.type && t.type !== flat.type) {
          problems.push(`${flat.path} has type ${t.type} in one mode and ${flat.type} in ${file}.`);
        }
        t.values[mode] = flat.value;
        t.files[mode] = file;
        t.description ??= flat.description;
        t.scopes ??= readScopes(flat.extensions);
      }
    }
    merged.forEach(add);
  };

  single('primitive', layout.primitiveFiles);
  multi('brand', layout.brands);
  single('base', layout.baseFiles);
  multi('semantic', layout.themes);
  multi('density', layout.densities);
  single('component', layout.componentFiles);

  const overrides: ThemeOverride[] = [];
  const overrideIndex = new Map<string, unknown>();
  for (const o of layout.overrides) {
    for (const flat of flattenTokens(docs.get(o.file)!)) {
      overrides.push({ brand: o.brand, theme: o.theme, path: flat.path, type: flat.type, value: flat.value, file: o.file });
      overrideIndex.set(overrideKey(o.brand, o.theme, flat.path), flat.value);
    }
  }
  return { tokens, byPath, docs, layout, options, overrides, overrideIndex, problems };
}

export function indexByPath(tokens: Iterable<LogicalToken>): Map<string, LogicalToken> {
  const m = new Map<string, LogicalToken>();
  for (const t of tokens) m.set(t.path, t);
  return m;
}
