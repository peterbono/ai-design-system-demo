// Build time: the deterministic docs pre-fill of a component, from what the docs site already parsed (props from the
// TypeScript, tokens and classes from the CSS module, the contrast checks). Same core function as the MCP tool, the
// CLI and the docs-draft Action (@bridge-ds/core prefillDocs), so a draft starts from the same facts everywhere.
import { prefillDocs, type DocsPrefill } from '@bridge-ds/core';
import type { ComponentInfo } from './components';
import { contrastPairs } from './contrast';
import { BRANDS, MODES } from './tokens';

/** Contrast pairs of the contrast gate that involve a token the component paints with, worst ratio first. */
export function componentContrast(c: Pick<ComponentInfo, 'allTokenPaths'>) {
  const mine = new Set(c.allTokenPaths);
  return contrastPairs()
    .filter((p) => mine.has(p.fg) || mine.has(p.bg))
    .map((p) => ({
      foreground: p.fg,
      background: p.bg,
      ratio: Math.min(...BRANDS.flatMap((b) => MODES.map((m) => p.brands[b][m].ratio))),
      min: p.min,
    }))
    .sort((a, b) => a.ratio - b.ratio);
}

export function componentPrefill(c: ComponentInfo, change?: string): DocsPrefill {
  return prefillDocs({
    name: c.name,
    description: c.description,
    props: c.props,
    inherits: c.inherits,
    tokens: c.tokensUsed.filter((t) => t.known).map((t) => t.name),
    inheritedTokens: Object.fromEntries(c.inherited.filter((i) => i.paths.length).map((i) => [i.from, i.paths])),
    // Anatomy is keyed by the CSS module classes, in source order (the parser keeps one rule per selector).
    cssClasses: [...new Set(c.rules.map((r) => r.className).filter((n) => /^[\w-]+$/.test(n)))],
    contrast: componentContrast(c),
    existing: c.docs,
    ...(change ? { change } : {}),
  });
}
