// Where a token is documented in the Library. Pure and browser-safe: no Node API, no repo read.
import type { TokenRowTier } from '@bridge-ds/core';

/** Anchor id used across pages: the CSS variable name without the leading dashes. */
export const anchorOf = (cssVar: string) => cssVar.replace(/^--/, '');

const NON_FOUNDATION = /^(palette|button|control|input|table|dialog|card|badge|tag|avatar|tooltip|menu|popover|toast|alert|tabs|drawer|accordion|layout|field|checkbox|radio|switch|slider|progress|skeleton|spinner|sidebar|pagination|breadcrumb|kbd|divider|empty|link|select|combobox|data|display|overlay|surface-tier|font-role)-/;

/**
 * Where a token's CSS variable is documented. `tier` and `path` are the token's when it is a brand, semantic,
 * density or component token; a primitive (or an unknown variable) is routed by its name and type.
 */
export function tokenHref(cssVar: string, type?: string, tier?: TokenRowTier, path?: string): string {
  const id = anchorOf(cssVar);
  if (path && (tier === 'brand' || tier === 'component' || tier === 'density')) return `/tokens/?t=${encodeURIComponent(path)}`;
  if (NON_FOUNDATION.test(id)) return `/tokens/?q=${encodeURIComponent(id)}`;
  if (id.startsWith('color-') || id === 'focus-ring-color') return `/foundations/color/#${id}`;
  if (id.startsWith('space-')) return `/foundations/spacing/#${id}`;
  if (id.startsWith('radius-') || id.startsWith('border-') || id === 'focus-ring-width') return `/foundations/radius/#${id}`;
  if (id.startsWith('font-')) return `/foundations/typography/#${id}`;
  if (id.startsWith('shadow-') || id.startsWith('elevation-') || type === 'shadow') return `/foundations/elevation/#${id}`;
  if (type === 'color') return `/foundations/color/#${id}`;
  return `/tokens/?q=${encodeURIComponent(id)}`;
}
