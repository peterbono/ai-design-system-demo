// Changes tried together, the toolbar's combination: the latest library (this build's own token files, what the page
// already wears) plus the token edits of the changes switched on, through @bridge-ds/core token-combine. It becomes
// one stylesheet that paints every theme, brand and density, and the before and after of each token it edits, with
// the changes it comes from. Pure (no DOM): loaded only when changes are tried together, tested in together.test.ts.
import {
  buildTokenSet,
  combineChanges,
  cssOf,
  cssVarOf,
  parseColor,
  previewOverrides,
  resolve,
  type ChangeEdits,
  type CombinePicks,
  type LayoutOptions,
  type ModeConfig,
  type TokenSet,
} from '@bridge-ds/core';
import { roleOfToken, stepOfToken, type TokenChange } from './session';

export interface TogetherBase {
  /** Token files of the latest library, relative to the tokens root. */
  latest: Record<string, string>;
  options: LayoutOptions;
  modes: Pick<ModeConfig, 'brands' | 'themes' | 'densities'>;
  /** The latest library as a token set, built once. */
  main: TokenSet;
}

export function togetherBase(latest: Record<string, string>, options: LayoutOptions, modes: TogetherBase['modes']): TogetherBase {
  return { latest, options, modes, main: buildTokenSet(latest, options) };
}

/** A token the combination edits, as the toolbar names it, with the changes whose value it takes. */
export interface TogetherToken extends TokenChange {
  from: number[];
}

export interface TogetherResult {
  included: number[];
  /** The stylesheet that paints the combination over the latest library (empty when nothing differs). */
  css: string;
  tokens: TogetherToken[];
  /** Tokens two switched-on changes set differently with no pick that counts: the first change's value is used. */
  unpicked: string[];
  problems: string[];
  next: TokenSet;
}

/** The scope attributes ThemeProvider sets together on the root and on every popup. */
export const scopeSelector = (theme: string, brand: string, density: string) => `[data-theme="${theme}"][data-brand="${brand}"][data-density="${density}"]`;

/**
 * The combination of the switched-on changes. A token two of them set differently takes the pick from Studio; when
 * the picked change is switched off and two others still disagree, the first one listed is used (and said).
 */
export function together(base: TogetherBase, changes: ChangeEdits[], picks: CombinePicks, include: number[]): TogetherResult {
  const combo = combineChanges(base.latest, changes, picks, { include, unpicked: 'first' });
  const next = buildTokenSet(combo.files, base.options);
  const rules: string[] = [];
  for (const theme of base.modes.themes) {
    for (const brand of base.modes.brands) {
      for (const density of base.modes.densities.length ? base.modes.densities : ['comfortable']) {
        const vars = previewOverrides(base.main, next, { theme, brand, density });
        const body = Object.entries(vars)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `  ${k}: ${v.replace(/[;{}<]/g, '')};`)
          .join('\n');
        if (body) rules.push(`${scopeSelector(theme, brand, density)} {\n${body}\n}`);
      }
    }
  }
  const tokens: TogetherToken[] = Object.entries(combo.from)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, from]) => {
      const t = next.byPath.get(path) ?? base.main.byPath.get(path);
      return { path, cssVar: cssVarOf(path), name: roleOfToken(path, t?.description ?? null), step: stepOfToken(path), type: t?.type ?? null, theme: null, brand: null, from };
    });
  return { included: combo.included, css: rules.join('\n'), tokens, unpicked: combo.missing.map((m) => m.path), problems: combo.problems, next };
}

/** A resolved value as the toolbar compares it: a colour as rgb()/rgba() (what computed styles read), else its CSS. */
function shownValue(type: string | null, value: unknown): string | null {
  if (value === undefined) return null;
  if (type === 'color') {
    const c = parseColor(value);
    if (!c) return null;
    const [r, g, b] = [c.r, c.g, c.b].map((x) => Math.round(x * 255));
    return c.a < 1 ? `rgba(${r}, ${g}, ${b}, ${c.a})` : `rgb(${r}, ${g}, ${b})`;
  }
  return cssOf(type ?? 'unknown', value) ?? null;
}

export interface TogetherPair {
  token: TogetherToken;
  before: string;
  after: string;
  color: boolean;
}

/** Before (latest library) and after (the combination) of each edited token where the page is: theme, brand, density. */
export function togetherPairs(base: TogetherBase, result: TogetherResult, here: { theme: string; brand: string; density: string }): TogetherPair[] {
  const out: TogetherPair[] = [];
  for (const token of result.tokens) {
    const a = shownValue(token.type, resolve(base.main.byPath, token.path, { ...here, overrides: base.main.overrideIndex }).value);
    const b = shownValue(token.type, resolve(result.next.byPath, token.path, { ...here, overrides: result.next.overrideIndex }).value);
    if (a === null || b === null || a === b) continue;
    out.push({ token, before: a, after: b, color: token.type === 'color' });
  }
  return out;
}
