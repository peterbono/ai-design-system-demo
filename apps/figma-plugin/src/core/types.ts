// Shared domain types for the token side of DS Bridge (no Figma or DOM dependency).

/** Extension key holding a stable token id across renames. */
export const EXT_ID = 'com.dsbridge.id';
/** Extension key holding Figma variable scopes. */
export const EXT_SCOPES = 'com.figma.scopes';

/** Mode key used for primitives, which have a single theme-independent value. */
export const PRIMITIVE_MODE = 'value';

export type Tier = 'primitive' | 'semantic';

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

export interface ThemeFile {
  mode: string;
  file: string;
}

/** Which files hold primitives and which hold one theme each (relative to the tokens path). */
export interface RepoLayout {
  primitiveFiles: string[];
  themes: ThemeFile[];
}

/**
 * A token as the user thinks about it: one name, one value per mode. Semantic tokens span the
 * theme files (one value per theme); primitives have a single value under PRIMITIVE_MODE.
 */
export interface LogicalToken {
  id: string;
  path: string;
  type: string;
  tier: Tier;
  /** mode key -> DTCG `$value` (alias string like "{color.blue.600}" or a literal). */
  values: Record<string, unknown>;
  description: string | undefined;
  /** Figma scopes from `$extensions["com.figma.scopes"]`, undefined when not declared. */
  scopes: string[] | undefined;
  /** mode key -> file the value lives in. */
  files: Record<string, string>;
}

export type TokenMap = Map<string, LogicalToken>;
