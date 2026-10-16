// Default Figma variable scopes, inferred from token path and type when the DTCG file does not
// declare `$extensions["com.figma.scopes"]`. Figma's own default is ALL_SCOPES, which shows every
// variable in every picker; DS Bridge never creates variables with it.

import type { Tier } from './types';

const has = (segments: string[], ...names: string[]) => names.some((n) => segments.includes(n));

export function defaultScopes(path: string, type: string, tier: Tier): string[] {
  const s = path.split('.');
  switch (type) {
    case 'color':
      // Raw ramps and brand palette roles are referenced by semantic tokens, never applied directly.
      if (tier === 'primitive' || (tier === 'brand' && s[0] === 'palette')) return [];
      if (has(s, 'text')) return ['TEXT_FILL'];
      if (has(s, 'border', 'ring', 'outline')) return ['STROKE_COLOR'];
      if (has(s, 'bg', 'surface', 'background')) return ['FRAME_FILL', 'SHAPE_FILL'];
      if (has(s, 'shadow')) return ['EFFECT_COLOR'];
      return ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'];
    case 'dimension':
      if (has(s, 'radius')) return ['CORNER_RADIUS'];
      if (has(s, 'border', 'width', 'stroke')) return ['STROKE_FLOAT'];
      if (has(s, 'space', 'spacing', 'gap')) return ['GAP', 'WIDTH_HEIGHT'];
      if (has(s, 'size') && has(s, 'font')) return ['FONT_SIZE'];
      if (has(s, 'letter-spacing')) return ['LETTER_SPACING'];
      return ['WIDTH_HEIGHT', 'GAP'];
    case 'fontWeight':
      return ['FONT_WEIGHT'];
    case 'fontFamily':
      return ['FONT_FAMILY'];
    case 'number':
      if (has(s, 'line-height', 'lineHeight')) return ['LINE_HEIGHT'];
      if (has(s, 'opacity')) return ['OPACITY'];
      return ['WIDTH_HEIGHT', 'GAP'];
    case 'string':
      return ['TEXT_CONTENT'];
    default:
      return [];
  }
}

export const sameScopes = (a: string[], b: string[]) => {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((x, i) => x === sb[i]);
};

/** Scopes a token effectively has: the declared ones, or the inferred default. */
export const effectiveScopes = (t: { path: string; type: string; tier: Tier; scopes: string[] | undefined }) =>
  t.scopes ?? defaultScopes(t.path, t.type, t.tier);
