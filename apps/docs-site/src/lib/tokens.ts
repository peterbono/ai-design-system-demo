// Token rows of this build, for the pages: thin wrappers over the pure lib/library/tokens.ts with the build-time
// repo model (lib/model.ts, @bridge-ds/core buildTokenRows over the DTCG sources under bridge.config.json tokens.root).
import { repoModel } from './model';
import * as lib from './library/tokens';
import type { Brand, Density, Mode } from './library/tokens';

export type { Brand, Density, Mode, Primitive, Semantic, SemanticMode, Tier, TokenKind } from './library/tokens';
export { DENSITY_LABEL } from './library/tokens';
export { anchorOf } from './library/token-href';

const axes = lib.tokenAxes(repoModel);
export const MODES: Mode[] = axes.modes;
// Brands come from bridge.config.json (modes.brand): a brand merged from the Studio, the CLI, the MCP server or the
// Figma plugin shows up in every page, menu and contrast table of the next build, with no template to edit.
export const BRANDS: Brand[] = axes.brands;
export const DEFAULT_BRAND: Brand = axes.defaultBrand;
export const DENSITIES: Density[] = axes.densities;
export const DEFAULT_DENSITY: Density = axes.defaultDensity;
/** Display name: the name a brand file records ($extensions dev.bridge.brand.name), else the slug in title case. */
export const BRAND_LABEL: Record<Brand, string> = axes.brandLabels;

/** Repo-relative token file of a theme's semantic tier. */
export const semanticFile = (mode: Mode) => lib.semanticFile(repoModel, mode);
/** Repo-relative primitive token files, sorted. */
export const primitiveFiles = () => lib.primitiveFiles(repoModel);
/** Repo-relative paths of every token source file, in tier order (what the "last updated" lines watch). */
export const TOKEN_SOURCE_FILES = () => lib.tokenSourceFiles(repoModel);

/** The token rows of this build (the repo model's, typed with this site's theme and density names). */
export const loadTokens = () => lib.tokenRows(repoModel);
/** Every CSS variable the system defines, mapped to where it is documented. */
export const tokenIndex = () => lib.tokenIndex(repoModel);
/** Where a CSS variable is documented: a token's page for brand, density and component tokens, else a foundation. */
export const hrefForVar = (cssVar: string, type?: string) => lib.hrefForVar(repoModel, cssVar, type);
export const primitivesOf = (prefix: string) => lib.primitivesOf(repoModel, prefix);
/** Primitive color ramps, grouped by hue in source order. */
export const colorRamps = () => lib.colorRamps(repoModel);
