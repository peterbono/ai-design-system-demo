// Token explorer formatting, as pure functions: human alias labels, code syntax, CSS text of resolved values,
// type categories for the "By type" lens. No DOM: unit tested in format.test.ts.
import { aliasTarget, isAlias, parseColor, parseDimension, rgbaToHex, type Tier } from '@bridge-ds/core';

/** "palette.neutral.900" -> "neutral / 900". Drops the namespace root when the path is deep enough to stay clear. */
export function aliasLabel(path: string): string {
  const parts = path.split('.');
  return (parts.length >= 3 ? parts.slice(1) : parts).join(' / ');
}

/** Alias label of a raw DTCG value, or undefined when the value is a literal. */
export function aliasOf(raw: unknown): string | undefined {
  return isAlias(raw) ? aliasTarget(raw) : undefined;
}

export type Syntax = 'css' | 'js' | 'dtcg';
export const SYNTAX_LABEL: Record<Syntax, string> = { css: 'CSS variable', js: 'JavaScript', dtcg: 'DTCG path' };

export const cssVarName = (path: string) => `--${path.replace(/\./g, '-')}`;

/**
 * How code refers to a token. CSS: the custom property. JS: the generated @bridge-ds/tokens map (primitives are raw
 * values, every other tier a var() reference). DTCG: the alias syntax token files use.
 */
export function codeSyntax(path: string, tier: Tier, syntax: Syntax): string {
  const key = path.replace(/\./g, '-');
  if (syntax === 'css') return `var(--${key})`;
  if (syntax === 'js') return tier === 'primitive' ? `primitives['${key}']` : `cssVar['${key}']`;
  return `{${path}}`;
}

const dim = (v: unknown): string => {
  const d = parseDimension(v);
  if (d) return `${d.value}${d.unit}`;
  if (v && typeof v === 'object' && 'value' in v && 'unit' in v) return `${(v as { value: number }).value}${(v as { unit: string }).unit}`;
  return String(v);
};

/** Color as CSS: hex when opaque, rgb() with alpha otherwise. The file's hex wins, like tokens.css. */
export function colorCss(value: unknown): string | undefined {
  const c = parseColor(value);
  if (!c) return undefined;
  const hex = value && typeof value === 'object' && typeof (value as { hex?: unknown }).hex === 'string' ? (value as { hex: string }).hex.toLowerCase() : rgbaToHex(c).slice(0, 7);
  if (c.a < 0.9995) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${r} ${g} ${b} / ${Math.round(c.a * 1000) / 1000})`;
  }
  return hex;
}

/** Opaque hex of a color value (alpha dropped), for labels. */
export function colorHex(value: unknown): string | undefined {
  const c = parseColor(value);
  if (!c) return undefined;
  const hex = value && typeof value === 'object' && typeof (value as { hex?: unknown }).hex === 'string' ? (value as { hex: string }).hex.toLowerCase() : rgbaToHex(c);
  return hex.slice(0, 7);
}

/** Alpha of a color value, 1 when opaque or not a color. */
export function colorAlpha(value: unknown): number {
  return parseColor(value)?.a ?? 1;
}

/** CSS text of a resolved (non-alias) value, the way tokens.css writes it. */
export function cssText(type: string, value: unknown): string {
  if (value === undefined) return '';
  if (isAlias(value)) return aliasTarget(value);
  switch (type) {
    case 'color':
      return colorCss(value) ?? String(value);
    case 'dimension':
    case 'duration':
      return dim(value);
    case 'cubicBezier':
      return Array.isArray(value) ? `cubic-bezier(${value.join(', ')})` : String(value);
    case 'fontFamily':
      return Array.isArray(value) ? value.map((n) => (/\s/.test(String(n)) ? `"${n}"` : String(n))).join(', ') : String(value);
    case 'shadow': {
      const layers = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
      return layers
        .map((l) => [l.inset ? 'inset' : '', dim(l.offsetX), dim(l.offsetY), dim(l.blur), dim(l.spread), colorCss(l.color) ?? ''].filter(Boolean).join(' '))
        .join(', ');
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

/** Short secondary line for a cell: hex for colors, the CSS value otherwise (long font stacks trimmed). */
export function valueLine(type: string, value: unknown): string {
  if (type === 'color') {
    const css = colorCss(value);
    if (!css) return '';
    const a = colorAlpha(value);
    return a < 0.9995 ? `${colorHex(value)} ${Math.round(a * 100)}%` : css;
  }
  if (type === 'fontFamily' && Array.isArray(value)) return String(value[0] ?? '');
  if (type === 'shadow') {
    const n = Array.isArray(value) ? value.length : 1;
    return `${n} layer${n > 1 ? 's' : ''}`;
  }
  return cssText(type, value);
}

/** Pixels of a dimension or milliseconds of a duration, for previews to scale. */
export function numericValue(value: unknown): number | undefined {
  const d = parseDimension(value);
  if (d) return d.unit === 'rem' ? d.value * 16 : d.value;
  if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'number') return (value as { value: number }).value;
  return typeof value === 'number' ? value : undefined;
}

export type TypeCategory = 'color' | 'dimension' | 'typography' | 'shadow' | 'motion' | 'number';
export const CATEGORY_ORDER: TypeCategory[] = ['color', 'dimension', 'typography', 'shadow', 'motion', 'number'];
export const CATEGORY_LABEL: Record<TypeCategory, string> = {
  color: 'Color',
  dimension: 'Dimension',
  typography: 'Typography',
  shadow: 'Shadow',
  motion: 'Duration and easing',
  number: 'Number',
};

/** Lens category of a token: DTCG $type, with font size and line height filed under typography. */
export function typeCategory(t: { path: string; type: string }): TypeCategory {
  if (t.type === 'color') return 'color';
  if (t.type === 'shadow') return 'shadow';
  if (t.type === 'duration' || t.type === 'cubicBezier') return 'motion';
  if (t.type === 'fontFamily' || t.type === 'fontWeight' || /(^|\.)font(\.|$)/.test(t.path)) return 'typography';
  if (t.type === 'dimension') return 'dimension';
  return 'number';
}

/** Foreground colors (text, icons, placeholders) get an "Aa" sample instead of a plain swatch. */
export function isForeground(path: string): boolean {
  return /(^|[.-])(text|fg|icon|placeholder|link)([.-]|$)/.test(path) && !/(^|[.-])bg([.-]|$)/.test(path.split('.').slice(-1)[0] ?? '');
}

const MODE_NAMES: Record<string, string> = { value: 'Value' };
/** "light" -> "Light"; the single-mode key reads "Value", like the Figma collections. */
export const modeName = (mode: string) => MODE_NAMES[mode] ?? mode.charAt(0).toUpperCase() + mode.slice(1);

/** SVG path of a cubic-bezier easing curve in a size x size box (y up), for the easing preview. */
export function bezierPath(points: unknown, size = 24): string | undefined {
  if (!Array.isArray(points) || points.length !== 4 || !points.every((n) => typeof n === 'number')) return undefined;
  const [x1, y1, x2, y2] = points as number[];
  const p = (x: number, y: number) => `${Math.round(x * size * 100) / 100} ${Math.round((1 - y) * size * 100) / 100}`;
  return `M${p(0, 0)} C${p(x1!, y1!)} ${p(x2!, y2!)} ${p(1, 1)}`;
}
