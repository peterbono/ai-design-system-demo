// CSS custom properties that paint a token set over another one: the live preview of a token draft (Studio Tokens),
// a change shown in Studio Components, and several changes tried together in the admin's Bridge toolbar. Pure.
import { resolve, type ResolveContext } from './resolver';
import type { TokenSet } from './token-set';
import { formatValue, parseColor, rgbaToHex } from './values';

/** CSS value of a resolved DTCG value, the way tokens.css writes it. */
export function cssOf(type: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (type === 'color') {
    const hex = value && typeof value === 'object' ? (value as { hex?: unknown }).hex : undefined;
    const c = parseColor(value);
    if (!c) return undefined;
    if (c.a < 1) return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)} / ${c.a})`;
    return typeof hex === 'string' ? hex.toLowerCase() : rgbaToHex(c);
  }
  return formatValue(type, value);
}

export const cssVarOf = (path: string) => `--${path.replace(/\./g, '-')}`;

/**
 * CSS custom properties to set on a scope so it renders `proposed` instead of `head`: every token whose resolved value
 * differs in that context. Setting resolved values (not var() references) keeps chains correct even when the original
 * variable is declared on an ancestor.
 */
export function previewOverrides(head: TokenSet, proposed: TokenSet, ctx: ResolveContext): Record<string, string> {
  const out: Record<string, string> = {};
  const hctx = { ...ctx, overrides: head.overrideIndex };
  const pctx = { ...ctx, overrides: proposed.overrideIndex };
  for (const t of proposed.byPath.values()) {
    const a = resolve(head.byPath, t.path, hctx);
    const b = resolve(proposed.byPath, t.path, pctx);
    const css = cssOf(t.type, b.value);
    if (css !== undefined && JSON.stringify(a.value) !== JSON.stringify(b.value)) out[cssVarOf(t.path)] = css;
  }
  return out;
}
