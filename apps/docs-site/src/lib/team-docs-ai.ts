// Edit mode on a team's Library component page (components/ds/library/LibraryTeamComponents.tsx): what this site
// computes at build time for its own components (lib/docs-prefill.ts componentPrefill and docsAiContext, served as
// /docs-ai/<slug>.json), computed in the browser from the team's repo model and the files read from its repository.
// Same core function (prefillDocs), so a team's draft starts from the same facts as everywhere else. Pure: no fetch, no
// DOM; the caller reads the files (teamConventionPaths says which). Covered by team-docs-ai.test.ts.
import { prefillDocs, type ComponentDocsJson, type DocsPrefill, type DocsPrefillInput, type RepoModel } from '@bridge-ds/core';
import type { ComponentInfo } from './library/components';
import type { DocsAiContext } from './docs-ai-model';
import { section } from './markdown';
import { studioHrefAt, teamHref } from './team-path';

type Model = Pick<RepoModel, 'contrast' | 'config'>;

/** The team's contrast pairs that involve a token the component paints with, worst ratio first (all brands, themes). */
export function teamComponentContrast(model: Pick<RepoModel, 'contrast'>, c: Pick<ComponentInfo, 'allTokenPaths'>): NonNullable<DocsPrefillInput['contrast']> {
  const mine = new Set(c.allTokenPaths);
  return model.contrast.pairs
    .filter((p) => mine.has(p.fg) || mine.has(p.bg))
    .flatMap((p) => {
      const ratios = Object.values(p.brands).flatMap((modes) => Object.values(modes).map((r) => r.ratio));
      return ratios.length ? [{ foreground: p.fg, background: p.bg, ratio: Math.min(...ratios), min: p.min }] : [];
    })
    .sort((a, b) => a.ratio - b.ratio);
}

/** What the team's code tells about a component: the input of prefillDocs, without the docs it has today. */
export function teamPrefillInput(model: Pick<RepoModel, 'contrast'>, c: ComponentInfo): Omit<DocsPrefillInput, 'existing' | 'change'> {
  return {
    name: c.name,
    description: c.description,
    props: c.props,
    inherits: c.inherits,
    tokens: c.tokensUsed.filter((t) => t.known).map((t) => t.name),
    inheritedTokens: Object.fromEntries(c.inherited.filter((i) => i.paths.length).map((i) => [i.from, i.paths])),
    cssClasses: [...new Set(c.rules.map((r) => r.className).filter((n) => /^[\w-]+$/.test(n)))],
    contrast: teamComponentContrast(model, c),
  };
}

/** The deterministic pre-fill of a team component: where its edit mode starts when it has no docs yet. */
export const teamComponentPrefill = (model: Pick<RepoModel, 'contrast'>, c: ComponentInfo): DocsPrefill => prefillDocs({ ...teamPrefillInput(model, c), existing: c.docs });

/** The files of the team's repository the drafting context reads: its conventions, the reference docs, the code. */
export function teamConventionPaths(model: Pick<RepoModel, 'config'>, c: ComponentInfo): { agents: string; designLanguage: string; example: string | null; source: string; styles: string } {
  const cfg = model.config;
  const ref = cfg.components?.reference;
  const example = ref && ref !== c.name ? c.files.docs.split(`/${c.name}/`).join(`/${ref}/`).replace(`${c.name}.docs.json`, `${ref}.docs.json`) : null;
  return { agents: cfg.docs?.guidelines ?? 'AGENTS.md', designLanguage: cfg.docs?.designLanguage ?? 'docs/DESIGN-LANGUAGE.md', example, source: c.files.tsx, styles: c.files.css };
}

/** The voice section of a design language (the first heading that names "voice"), as Markdown. */
function voiceSection(md: string | undefined): string | undefined {
  const head = md?.split('\n').find((l) => /^#{1,6}\s/.test(l) && /voice/i.test(l));
  if (!md || !head) return undefined;
  return section(md, head.replace(/^#+\s*/, '').trim()).join('\n').trim() || undefined;
}

/** The drafting context of a team component (the shape of /docs-ai/<slug>.json), from the files read for it. */
export function teamDocsAiContext(model: Model, c: ComponentInfo, files: Partial<Record<'agents' | 'designLanguage' | 'example' | 'source' | 'styles', string | undefined>>): DocsAiContext {
  const conventions: DocsAiContext['conventions'] = {};
  const voice = voiceSection(files.designLanguage);
  if (files.agents) conventions.agents = files.agents;
  if (voice) conventions.voice = voice;
  if (files.example) conventions.example = files.example;
  if (files.source) conventions.source = files.source;
  if (files.styles) conventions.styles = files.styles;
  return { slug: c.slug, name: c.name, files: { tsx: c.files.tsx, css: c.files.css, docs: c.files.docs }, input: teamPrefillInput(model, c), conventions };
}

/** The props of the team's editor: the docs.json read at the page's commit (null without one), and where editing starts. */
export function teamEditProps(data: { owner: string; repo: string; model: Pick<RepoModel, 'contrast'> }, c: ComponentInfo, original: string | null) {
  let initial: ComponentDocsJson;
  try {
    initial = original ? (JSON.parse(original) as ComponentDocsJson) : teamComponentPrefill(data.model, c).draft;
  } catch {
    initial = teamComponentPrefill(data.model, c).draft;
  }
  const studioRoot = teamHref(data.owner, data.repo, null);
  return {
    name: c.name,
    slug: c.slug,
    path: c.files.docs,
    original,
    initial,
    repo: { owner: data.owner, repo: data.repo },
    studio: (path: string) => studioHrefAt(studioRoot, path),
  };
}
