// Color literal detection for swatches (TokenValue and its DOM renderer). No React.

const COLOR_RE = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^()"';{}<>]*\))$/i;

/** True for a CSS color literal a swatch can paint: hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(), color(). */
export function isColorLiteral(value: string | null | undefined): boolean {
  return typeof value === 'string' && COLOR_RE.test(value.trim());
}

/** The swatch color: a forced one (a literal or a `var(--token)`), else the resolved value, else the value; null for none. */
export function swatchColor(swatch: string | false | undefined, resolved: string | undefined, value: string): string | null {
  if (swatch === false) return null;
  if (typeof swatch === 'string') return isColorLiteral(swatch) || /^var\(--[\w-]+\)$/.test(swatch.trim()) ? swatch.trim() : null;
  if (isColorLiteral(resolved)) return resolved!.trim();
  if (isColorLiteral(value)) return value.trim();
  return null;
}
