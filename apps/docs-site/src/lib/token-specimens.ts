// Team pages (multi-team PR 3b): token specimens drawn from a team's resolved tokens, for a team without a Storybook.
// Bridge cannot run another team's component code, so it shows what it can draw safely from values: colour swatches, a
// type ramp, radius, space and shadow, each labelled with its token path. Pure: TokenSpecimens.tsx draws them.
//
// Token values come from a repository Bridge does not control. They only ever reach React inline styles (CSSOM
// setProperty, no stylesheet text), and a value that could load a resource or leave its declaration is dropped first.
import type { PrimitiveRow, RepoModel, TokenRow } from '@bridge-ds/core';

export type SpecimenKind = 'color' | 'type' | 'radius' | 'space' | 'shadow';

export interface Specimen {
  path: string;
  /** The resolved value, already through safeSpecimenValue. */
  value: string;
}

export interface SpecimenSet {
  /** The brand and theme the values are read at. */
  brand: string;
  theme: string;
  color: Specimen[];
  type: Specimen[];
  /** Font family for the type ramp, when the tokens name one. */
  family: string | undefined;
  radius: Specimen[];
  space: Specimen[];
  shadow: Specimen[];
  /** Every specimen across kinds: 0 means there is nothing to draw. */
  total: number;
}

/** Above these, a section shows the first ones only: the band is a glimpse, the Tokens page has every token. */
export const SPECIMEN_LIMITS: Record<SpecimenKind, number> = { color: 12, type: 6, radius: 6, space: 8, shadow: 4 };

const UNSAFE = /url\(|image-set\(|image\(|src\(|expression|[\\;@{}<>]/i;

/** A token value safe to put in an inline style, or null: no resource loads, no way out of the declaration. */
export function safeSpecimenValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 300 || UNSAFE.test(v)) return null;
  return v;
}

/** A CSS custom property name from a token path ("color.bg.canvas" -> "--color-bg-canvas"), or null when it would not be [a-z0-9-]. */
export function safeCustomPropertyName(path: string): string | null {
  const name = path.toLowerCase().replace(/\./g, '-');
  return /^[a-z0-9][a-z0-9-]*$/.test(name) ? `--${name}` : null;
}

type AnyRow = { path: string; segments: string[]; type: string; css: string };

const valueOf = (row: TokenRow, brand: string, theme: string): string | undefined => row.brands[brand]?.[theme]?.css ?? row.modes[theme]?.css ?? Object.values(row.modes)[0]?.css;

const has = (segs: string[], ...words: string[]) => segs.some((s) => words.includes(s.toLowerCase()));

function pick(rows: AnyRow[], match: (r: AnyRow) => boolean, limit: number): Specimen[] {
  const out: Specimen[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (out.length >= limit) break;
    if (!match(r) || seen.has(r.path)) continue;
    const value = safeSpecimenValue(r.css);
    if (value === null) continue;
    seen.add(r.path);
    out.push({ path: r.path, value });
  }
  return out;
}

/** Specimens of a model at its default brand and first theme: semantic and brand tokens first, primitives as fallback. */
export function tokenSpecimens(model: Pick<RepoModel, 'tokens'>): SpecimenSet {
  const rows = model.tokens.rows;
  const brand = rows.defaultBrand;
  const theme = rows.themes[0] ?? 'light';
  const roles: AnyRow[] = [...rows.semantic, ...rows.brand, ...rows.density].flatMap((r) => {
    const css = valueOf(r, brand, theme);
    return css === undefined ? [] : [{ path: r.path, segments: r.segments, type: r.type, css }];
  });
  const prims: AnyRow[] = rows.primitives.map((p: PrimitiveRow) => ({ path: p.path, segments: p.segments, type: p.type, css: p.css }));
  // Roles say what a value is for; primitives fill a kind the roles do not cover.
  const either = (match: (r: AnyRow) => boolean, limit: number) => {
    const fromRoles = pick(roles, match, limit);
    return fromRoles.length ? fromRoles : pick(prims, match, limit);
  };
  const dim = (r: AnyRow) => r.type === 'dimension';
  const color = either((r) => r.type === 'color', SPECIMEN_LIMITS.color);
  const type = either((r) => dim(r) && has(r.segments, 'font', 'typography', 'text', 'type') && has(r.segments, 'size'), SPECIMEN_LIMITS.type);
  const family = either((r) => r.type === 'fontFamily', 1)[0]?.value;
  const radius = either((r) => dim(r) && has(r.segments, 'radius', 'radii', 'rounded'), SPECIMEN_LIMITS.radius);
  const space = either((r) => dim(r) && has(r.segments, 'space', 'spacing', 'gap'), SPECIMEN_LIMITS.space);
  const shadow = either((r) => r.type === 'shadow', SPECIMEN_LIMITS.shadow);
  return { brand, theme, color, type, family, radius, space, shadow, total: color.length + type.length + radius.length + space.length + shadow.length };
}
