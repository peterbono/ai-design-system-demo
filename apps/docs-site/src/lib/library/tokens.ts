// Token rows of a repo model, named for the Library: the full alias chain (component -> semantic -> brand palette
// role -> primitive -> resolved value), per brand x theme (and density), as @bridge-ds/core buildTokenRows computed
// them. Pure: every function takes the RepoModel, so the build (lib/tokens.ts) and a team's Library read the same.
import { parentDir, tokenRowFiles, type PrimitiveRow, type RepoModel, type TokenRow, type TokenRowMode, type TokenRowTier } from '@bridge-ds/core';
import { tokenHref } from './token-href';

export type Mode = 'light' | 'dark';
export type Brand = string;
export type Density = 'comfortable' | 'compact';
export const DENSITY_LABEL: Record<Density, string> = { comfortable: 'Comfortable', compact: 'Compact' };

/** Token tiers, in resolution order: primitive <- brand <- semantic <- component. Density sits beside semantic. */
export type Tier = TokenRowTier;
export type TokenKind = Tier;

export type Primitive = PrimitiveRow;
export type SemanticMode = TokenRowMode;
/** A brand, semantic, density or component token, with its values per theme, brand x theme and density. */
export interface Semantic extends Omit<TokenRow, 'modes' | 'brands' | 'densities'> {
  modes: Record<Mode, SemanticMode>;
  brands: Record<Brand, Record<Mode, SemanticMode>>;
  densities?: Record<Density, SemanticMode>;
}

export interface TokenRows {
  primitives: Primitive[];
  /** Semantic tier: themed (light/dark) and theme-independent (base). */
  semantic: Semantic[];
  /** Brand tier: palette, radius and font roles per brand. */
  brand: Semantic[];
  density: Semantic[];
  component: Semantic[];
  /** Every non-primitive token. */
  all: Semantic[];
}

/** The token rows of a model, typed with the Library's theme and density names. */
export const tokenRows = (model: RepoModel): TokenRows => model.tokens.rows as unknown as TokenRows;

export interface TokenAxes {
  modes: Mode[];
  /** Brands come from bridge.config.json (modes.brand). */
  brands: Brand[];
  defaultBrand: Brand;
  densities: Density[];
  defaultDensity: Density;
  /** Display name: the name a brand file records ($extensions dev.bridge.brand.name), else the slug in title case. */
  brandLabels: Record<Brand, string>;
}

/** Themes, brands and densities of a model. */
export function tokenAxes(model: RepoModel): TokenAxes {
  const rows = model.tokens.rows;
  return {
    modes: rows.themes as Mode[],
    brands: rows.brands,
    defaultBrand: rows.defaultBrand,
    densities: rows.densities as Density[],
    defaultDensity: rows.defaultDensity as Density,
    brandLabels: rows.brandLabels,
  };
}

/** Repo-relative token file of a theme's semantic tier. */
export const semanticFile = (model: RepoModel, mode: Mode) => tokenRowFiles(model.config).semanticFile(mode);
/** Repo-relative primitive token files, sorted. */
export const primitiveFiles = (model: RepoModel) => {
  const dir = tokenRowFiles(model.config).primitivesDir;
  return model.tokens.rows.sources.filter((f) => parentDir(f) === dir);
};
/** Repo-relative paths of every token source file, in tier order (what the "last updated" lines watch). */
export const tokenSourceFiles = (model: RepoModel) => model.tokens.rows.sources;

/** Where a CSS variable is documented: a token's page for brand, density and component tokens, else a foundation. */
export function hrefForVar(model: RepoModel, cssVar: string, type?: string): string {
  const tok = tokenRows(model).all.find((t) => t.cssVar === cssVar);
  return tokenHref(cssVar, type, tok?.tier, tok?.path);
}

/** Every CSS variable the system defines, mapped to where it is documented. */
export function tokenIndex(model: RepoModel) {
  const { primitives, all } = tokenRows(model);
  const map = new Map<string, { path: string; kind: TokenKind; type: string; href: string }>();
  for (const p of primitives) map.set(p.cssVar, { path: p.path, kind: 'primitive', type: p.type, href: hrefForVar(model, p.cssVar, p.type) });
  for (const s of all) map.set(s.cssVar, { path: s.path, kind: s.tier, type: s.type, href: hrefForVar(model, s.cssVar, s.type) });
  return map;
}

export const primitivesOf = (model: RepoModel, prefix: string) => tokenRows(model).primitives.filter((p) => p.path.startsWith(prefix + '.'));

/** Primitive color ramps, grouped by hue in source order. */
export function colorRamps(model: RepoModel) {
  const ramps = new Map<string, Primitive[]>();
  for (const p of tokenRows(model).primitives.filter((x) => x.type === 'color')) {
    const hue = p.segments[1]!;
    if (!ramps.has(hue)) ramps.set(hue, []);
    ramps.get(hue)!.push(p);
  }
  return [...ramps.entries()].map(([hue, steps]) => ({ hue, steps }));
}
