// A team's Library shell paints its previews with the team's own token values. The site's stylesheet declares Bridge's
// tokens on every [data-theme] scope; on a team's Library, the preview scopes inside the page (specimen panels, token
// swatches, contrast tiles, type and shape samples) get the team's resolved values on top, per brand and theme. The
// page chrome keeps Bridge's.
//
// Token values come from a repository Bridge does not control: names pass safeCustomPropertyName, values
// safeSpecimenValue, and both reach the page through the CSSOM (setProperty on a constructed stylesheet), never as
// stylesheet text. Brand and theme names only make a selector when they are plain slugs.
import type { RepoModel } from '@bridge-ds/core';
import { safeCustomPropertyName, safeSpecimenValue } from '../lib/token-specimens';

const SLUG = /^[a-z0-9][a-z0-9-]*$/i;

export interface TeamTokenScope {
  brand: string;
  theme: string;
  /** Custom property name -> resolved value. */
  vars: Record<string, string>;
}

/** The team's resolved token values per brand and theme, checked. Pure. */
export function teamTokenScopes(model: Pick<RepoModel, 'tokens'>): TeamTokenScope[] {
  const rows = model.tokens.rows;
  const out: TeamTokenScope[] = [];
  for (const brand of rows.brands.filter((b) => SLUG.test(b))) {
    for (const theme of rows.themes.filter((t) => SLUG.test(t))) {
      const vars: Record<string, string> = {};
      const put = (path: string, css: unknown) => {
        const name = safeCustomPropertyName(path);
        const value = safeSpecimenValue(css);
        if (name && value) vars[name] = value;
      };
      for (const p of rows.primitives) put(p.path, p.css);
      for (const t of rows.all) put(t.path, t.brands[brand]?.[theme]?.css ?? t.modes[theme]?.css);
      out.push({ brand, theme, vars });
    }
  }
  return out;
}

/** Where the values go: the preview scopes inside the page, never the chrome around it. */
export function scopeSelectors(brand: string, theme: string): string {
  const shell = ':root[data-library-shell]';
  return [
    `${shell} main [data-theme="${theme}"][data-brand="${brand}"]`,
    `${shell}[data-theme="${theme}"][data-preview-brand="${brand}"] main :is(.fd-pv, .fd-stage):not([data-theme])`,
  ].join(', ');
}

let sheet: CSSStyleSheet | null = null;

/** Paints the team's values on the previews of this page (once per page; a second call replaces the first). */
export function applyTeamTokens(model: Pick<RepoModel, 'tokens'>, doc: Document = document) {
  if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in doc)) return;
  const next = new CSSStyleSheet();
  for (const scope of teamTokenScopes(model)) {
    const index = next.insertRule(`${scopeSelectors(scope.brand, scope.theme)} {}`, next.cssRules.length);
    const rule = next.cssRules[index] as CSSStyleRule;
    for (const [name, value] of Object.entries(scope.vars)) rule.style.setProperty(name, value);
  }
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets.filter((s) => s !== sheet), next];
  sheet = next;
}
