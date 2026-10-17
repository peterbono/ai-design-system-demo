// Build time: the deterministic docs pre-fill of a component, from what the docs site already parsed (props from the
// TypeScript, tokens and classes from the CSS module, the contrast checks). Same core function as the MCP tool, the
// CLI and the docs-draft Action (@bridge-ds/core prefillDocs), so a draft starts from the same facts everywhere.
import { prefillDocs, type DocsPrefill, type DocsPrefillInput } from '@bridge-ds/core';
import type { ComponentInfo } from './components';
import { contrastPairs } from './contrast';
import type { DocsAiContext } from './docs-ai-model';
import { section } from './markdown';
import { exists, readJson, readText } from './repo';
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

/** What code tells about a component: the input of prefillDocs, without the docs it has today. */
export function componentPrefillInput(c: ComponentInfo): Omit<DocsPrefillInput, 'existing' | 'change'> {
  return {
    name: c.name,
    description: c.description,
    props: c.props,
    inherits: c.inherits,
    tokens: c.tokensUsed.filter((t) => t.known).map((t) => t.name),
    inheritedTokens: Object.fromEntries(c.inherited.filter((i) => i.paths.length).map((i) => [i.from, i.paths])),
    // Anatomy is keyed by the CSS module classes, in source order (the parser keeps one rule per selector).
    cssClasses: [...new Set(c.rules.map((r) => r.className).filter((n) => /^[\w-]+$/.test(n)))],
    contrast: componentContrast(c),
  };
}

export function componentPrefill(c: ComponentInfo, change?: string): DocsPrefill {
  return prefillDocs({ ...componentPrefillInput(c), existing: c.docs, ...(change ? { change } : {}) });
}

const readOpt = (rel: string | undefined) => (rel && exists(rel) ? readText(rel) : undefined);

/** The voice section of the design language (the first heading that names "voice"), as Markdown. */
function voiceSection(md: string | undefined): string | undefined {
  const head = md?.split('\n').find((l) => /^#{1,6}\s/.test(l) && /voice/i.test(l));
  if (!md || !head) return undefined;
  return section(md, head.replace(/^#+\s*/, '').trim()).join('\n').trim() || undefined;
}

interface DocsConfig {
  docs?: { designLanguage?: string; guidelines?: string };
  components?: { reference?: string };
}

/**
 * Everything Claude needs to draft a component's docs from its Library page, computed at build time and served as
 * /docs-ai/<slug>.json: the pre-fill input from the code (props, JSDoc, tokens, CSS module classes, contrast), the
 * repo conventions (AGENTS.md, the voice of the design language, the reference docs.json) and the component's source
 * and stylesheet. The browser adds the docs it has now and calls prefillDocs, the same core function as the MCP tool,
 * the CLI and the docs-draft Action.
 */
export function docsAiContext(c: ComponentInfo): DocsAiContext {
  const cfg = exists('bridge.config.json') ? readJson<DocsConfig>('bridge.config.json') : {};
  const ref = cfg.components?.reference;
  const refDocs = ref && ref !== c.name ? readOpt(c.files.docs.split(`/${c.name}/`).join(`/${ref}/`).replace(`${c.name}.docs.json`, `${ref}.docs.json`)) : undefined;
  const conventions: DocsAiContext['conventions'] = {};
  const agents = readOpt(cfg.docs?.guidelines ?? 'AGENTS.md');
  const voice = voiceSection(readOpt(cfg.docs?.designLanguage ?? 'docs/DESIGN-LANGUAGE.md'));
  const source = readOpt(c.files.tsx);
  const styles = readOpt(c.files.css);
  if (agents) conventions.agents = agents;
  if (voice) conventions.voice = voice;
  if (refDocs) conventions.example = refDocs;
  if (source) conventions.source = source;
  if (styles) conventions.styles = styles;
  return { slug: c.slug, name: c.name, files: { tsx: c.files.tsx, css: c.files.css, docs: c.files.docs }, input: componentPrefillInput(c), conventions };
}
