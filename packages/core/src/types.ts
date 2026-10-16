// Shared domain types for the token side of DS Bridge (no Figma or DOM dependency).

/** Extension key holding a stable token id across renames. */
export const EXT_ID = 'com.dsbridge.id';
/** Extension key holding Figma variable scopes. */
export const EXT_SCOPES = 'com.figma.scopes';

/** Mode key of single-mode tiers (primitives, base semantic, component tokens). */
export const PRIMITIVE_MODE = 'value';
export const SINGLE_MODE = PRIMITIVE_MODE;

/**
 * Token tiers, in dependency order (docs/ARCHITECTURE.md):
 *   primitive  primitives/*.tokens.json           raw scales, one value
 *   brand      brands/<brand>.tokens.json         palette, radius and font roles, one value per brand
 *   base       semantic/base.tokens.json          theme-independent semantic (motion, layers, icons), one value
 *   semantic   semantic/<theme>.tokens.json       purpose aliases of palette.*, one value per theme
 *   density    density/<density>.tokens.json      control heights and paddings, one value per density
 *   component  components/*.tokens.json           component hooks aliasing semantic tokens, one value
 */
export type Tier = 'primitive' | 'brand' | 'base' | 'semantic' | 'density' | 'component';
export const TIER_ORDER: Tier[] = ['primitive', 'brand', 'base', 'semantic', 'density', 'component'];

/** The dimension a multi-mode tier varies along. */
export type Axis = 'brand' | 'theme' | 'density';
export const TIER_AXIS: Record<Tier, Axis | undefined> = {
  primitive: undefined,
  brand: 'brand',
  base: undefined,
  semantic: 'theme',
  density: 'density',
  component: undefined,
};
export const isMultiMode = (tier: Tier) => TIER_AXIS[tier] !== undefined;

/** Display name of each tier. The Figma plugin uses the same names for its collections. */
export const TIER_NAMES: Record<Tier, string> = {
  primitive: 'Primitives',
  brand: 'Brand',
  base: 'Base',
  semantic: 'Semantic',
  density: 'Density',
  component: 'Component',
};

/** "light" -> "Light". */
export const modeDisplayName = (mode: string) => mode.charAt(0).toUpperCase() + mode.slice(1);

/** One token as written in one DTCG file. */
export interface FlatToken {
  path: string;
  /** Resolved `$type`, including the type inherited from parent groups. */
  type: string | undefined;
  /** `$type` written on the token itself (undefined when inherited). */
  ownType: string | undefined;
  value: unknown;
  description: string | undefined;
  extensions: Record<string, unknown> | undefined;
  file: string;
}

export interface ModeFile {
  mode: string;
  file: string;
}

/** A brand's semantic override file for one theme: brands/<brand>.<theme>.tokens.json. */
export interface OverrideFile {
  brand: string;
  theme: string;
  file: string;
}

/** Which files hold which tier (relative to the tokens path). */
export interface RepoLayout {
  primitiveFiles: string[];
  brands: ModeFile[];
  baseFiles: string[];
  themes: ModeFile[];
  overrides: OverrideFile[];
  densities: ModeFile[];
  componentFiles: string[];
}

/**
 * A token as the user thinks about it: one name, one value per mode of its tier. Brand tokens
 * have one value per brand, semantic tokens one per theme, density tokens one per density;
 * the other tiers have a single value under SINGLE_MODE.
 */
export interface LogicalToken {
  id: string;
  path: string;
  type: string;
  tier: Tier;
  /** mode key -> DTCG `$value` (alias string like "{palette.primary.600}" or a literal). */
  values: Record<string, unknown>;
  description: string | undefined;
  /** Figma scopes from `$extensions["com.figma.scopes"]`, undefined when not declared. */
  scopes: string[] | undefined;
  /** mode key -> file the value lives in. */
  files: Record<string, string>;
}

/** A brand's per-theme value for a semantic token (code-only: Figma has no brand x theme mode). */
export interface ThemeOverride {
  brand: string;
  theme: string;
  path: string;
  type: string | undefined;
  value: unknown;
  file: string;
}

export type TokenMap = Map<string, LogicalToken>;
