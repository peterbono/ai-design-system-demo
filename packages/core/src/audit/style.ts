// Style sheets (CSS, SCSS, Less files and the <style> blocks of Astro, Vue and Svelte files): hardcoded values with
// the closest token, DS token references, other theme references, and which literals the autofix may replace.
import { parseCssColor } from './color';
import { scanCssText } from './css';
import type { DesignSystemIndex } from './ds-index';
import type { FindingCategory, FindingSource, StyleFinding, TokenSuggestion } from './types';

/** A literal the CSS autofix may replace: exact token value, same spelling for lengths and durations. */
export function isSafeFix(h: { category: FindingCategory; text: string }, s: TokenSuggestion | undefined): boolean {
  if (!s || s.level !== 'exact') return false;
  switch (h.category) {
    case 'color': {
      const a = parseCssColor(h.text);
      const b = parseCssColor(s.value);
      return Boolean(a && b && s.distance <= 0.5 && Math.abs(a.a - b.a) < 0.01);
    }
    case 'spacing':
    case 'size':
    case 'radius':
    case 'border-width':
    case 'font-size':
    case 'duration':
    case 'z-index':
    case 'font-weight':
    case 'line-height':
      return h.text.trim() === s.value.trim();
    case 'shadow':
      return s.distance === 0;
    default:
      return false;
  }
}

export interface CssAudit {
  findings: StyleFinding[];
  tokenUsages: number;
  themeRefs: number;
}

/**
 * Audit style sheet text. `offset` places the text inside a larger file (a <style> block, a style attribute) and
 * `pos` maps a file offset to its line and column. `source` labels the findings (`css` for sheets, `style` for
 * style attributes); only `css` findings are marked for the autofix, which rewrites CSS files.
 */
export function auditCssText(
  text: string,
  lang: 'css' | 'scss' | 'less',
  ds: DesignSystemIndex,
  opts: { pos: (offset: number) => { line: number; column: number }; offset?: number; source?: FindingSource },
): CssAudit {
  const base = opts.offset ?? 0;
  const source = opts.source ?? 'css';
  const at = (o: number) => opts.pos(base + o);
  const scan = scanCssText(text, lang);
  const findings: StyleFinding[] = [];
  let tokenUsages = 0;
  let themeRefs = 0;
  for (const d of scan.decls) {
    for (const v of d.scan.vars) ds.isDsVar(v) ? tokenUsages++ : themeRefs++;
    if (d.scan.themeRef) themeRefs++;
    else if (lang !== 'css' && !d.property.startsWith('$')) themeRefs += (d.value.match(/\$[\w-]+/g) ?? []).length;
    const property = d.property.toLowerCase();
    for (const h of d.scan.hits) {
      const suggestion = ds.suggest(h.category, h.text, property);
      const autofix = source === 'css' && isSafeFix(h, suggestion);
      findings.push({ ...at(d.valueStart + h.index), category: h.category, property, value: h.text, source, ...(suggestion ? { suggestion } : {}), ...(autofix ? { autofix: true } : {}) });
    }
  }
  for (const a of scan.applies) {
    for (const h of a.hits) {
      if (h.kind === 'scale') themeRefs++;
      else if (h.kind !== 'token' && h.value) {
        const cat: FindingCategory = parseCssColor(h.value) ? 'color' : h.category === 'color-or-size' ? 'font-size' : h.category === 'color-or-width' ? 'border-width' : h.category === 'color-or-shadow' ? 'shadow' : h.category === 'font' ? 'font-family' : (h.category as FindingCategory);
        const suggestion = ds.suggest(cat, h.value);
        findings.push({ ...at(a.start + h.index), category: cat, value: h.cls, source: 'tailwind', ...(suggestion ? { suggestion } : {}) });
      } else if (h.kind === 'token' && h.value) {
        const v = /var\(\s*(--[\w-]+)/.exec(h.value)?.[1];
        if (v && ds.isDsVar(v)) tokenUsages++;
        else themeRefs++;
      }
    }
  }
  findings.sort((x, y) => x.line - y.line || x.column - y.column);
  return { findings, tokenUsages, themeRefs };
}
