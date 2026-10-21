// Token rows for every page: the full alias chain (component -> semantic -> brand palette role -> primitive ->
// resolved value), per brand x theme (and density). Computed once by the repo model (lib/model.ts, @bridge-ds/core
// buildTokenRows) from the DTCG sources under bridge.config.json tokens.root; this module names them for the pages.
import { parentDir, tokenRowFiles, type PrimitiveRow, type TokenRow, type TokenRowMode, type TokenRowTier } from '@bridge-ds/core';
import { anchorOf, repoModel, tokenHref } from './model';

const rows = repoModel.tokens.rows;
const files = tokenRowFiles(repoModel.config);

export type Mode = 'light' | 'dark';
export const MODES = rows.themes as Mode[];
// Brands come from bridge.config.json (modes.brand): a brand merged from the Studio, the CLI, the MCP server or the
// Figma plugin shows up in every page, menu and contrast table of the next build, with no template to edit.
export type Brand = string;
export const BRANDS: Brand[] = rows.brands;
export const DEFAULT_BRAND: Brand = rows.defaultBrand;
export type Density = 'comfortable' | 'compact';
export const DENSITIES = rows.densities as Density[];
export const DEFAULT_DENSITY = rows.defaultDensity as Density;
/** Display name: the name a brand file records ($extensions dev.bridge.brand.name), else the slug in title case. */
export const BRAND_LABEL: Record<Brand, string> = rows.brandLabels;
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

/** Repo-relative token file of a theme's semantic tier. */
export const semanticFile = (mode: Mode) => files.semanticFile(mode);
/** Repo-relative primitive token files, sorted. */
export const primitiveFiles = () => rows.sources.filter((f) => parentDir(f) === files.primitivesDir);
/** Repo-relative paths of every token source file, in tier order (what the "last updated" lines watch). */
export const TOKEN_SOURCE_FILES = () => rows.sources;

export { anchorOf };

interface Loaded {
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

/** The token rows of this build (the repo model's, typed with this site's theme and density names). */
export const loadTokens = (): Loaded => rows as unknown as Loaded;

/** Every CSS variable the system defines, mapped to where it is documented. */
export function tokenIndex() {
  const { primitives, all } = loadTokens();
  const map = new Map<string, { path: string; kind: TokenKind; type: string; href: string }>();
  for (const p of primitives) map.set(p.cssVar, { path: p.path, kind: 'primitive', type: p.type, href: hrefForVar(p.cssVar, p.type) });
  for (const s of all) map.set(s.cssVar, { path: s.path, kind: s.tier, type: s.type, href: hrefForVar(s.cssVar, s.type) });
  return map;
}

/** Where a CSS variable is documented: a token's page for brand, density and component tokens, else a foundation. */
export function hrefForVar(cssVar: string, type?: string): string {
  const tok = loadTokens().all.find((t) => t.cssVar === cssVar);
  return tokenHref(cssVar, type, tok?.tier, tok?.path);
}

export const primitivesOf = (prefix: string) => loadTokens().primitives.filter((p) => p.path.startsWith(prefix + '.'));

/** Primitive color ramps, grouped by hue in source order. */
export function colorRamps() {
  const ramps = new Map<string, Primitive[]>();
  for (const p of loadTokens().primitives.filter((x) => x.type === 'color')) {
    const hue = p.segments[1]!;
    if (!ramps.has(hue)) ramps.set(hue, []);
    ramps.get(hue)!.push(p);
  }
  return [...ramps.entries()].map(([hue, steps]) => ({ hue, steps }));
}
