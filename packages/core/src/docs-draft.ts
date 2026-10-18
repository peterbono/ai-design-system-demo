// Component docs drafts: the deterministic part of a component's documentation, computed from its code, and the
// review state of prose an AI drafted. Shared by the Bridge docs editor, the MCP server (bridge_draft_docs), the
// CLI (bridge docs draft) and the docs-draft GitHub Action, so a draft looks the same wherever it starts.
//
// What code can tell (deterministic, never invented): the props table from the TypeScript props, the tokens the
// stylesheet reads, the anatomy from the CSS module classes, the contrast pairs those tokens take part in, and a
// changelog line. What only a person (or an AI, then a person) can write: summary, when to use, do and don't,
// accessibility and content guidelines. Prose an AI wrote carries "draftedBy": "claude" and "needsReview": true
// until a reviewer accepts it.

import { type JsonEntry, type JsonNode, fromPlain, getEntry, parseJson, plainEqual, serializeJson, toPlain } from './json-ast';

export type DocsExampleNode = string | { c: string; p?: Record<string, unknown>; children?: DocsExampleNode[] };

export interface DocsGuidance {
  title: string;
  text: string;
  example?: DocsExampleNode;
}

/** The shape of <Name>.docs.json (same keys as Button.docs.json). */
export interface ComponentDocsJson {
  summary: string;
  category?: string;
  status?: 'stable' | 'beta' | 'deprecated';
  preview?: DocsExampleNode;
  whenToUse: string[];
  whenNotToUse: string[];
  dos: DocsGuidance[];
  donts: DocsGuidance[];
  accessibility: string[];
  contentGuidelines?: string[];
  anatomy?: Record<string, string>;
  /** Who wrote the prose when it was not a person in the editor. Only "claude" today. */
  draftedBy?: string;
  /**
   * The prose sections Claude drafted that wait for review, when a draft covered only some of them (in-place drafting
   * on the Library page, the docs-draft Action). Missing means the whole file. Accepting removes it.
   */
  draftedSections?: ProseKey[];
  /** True while drafted prose waits for a reviewer. Accepting sets it to false. */
  needsReview?: boolean;
}

/** Keys of docs.json in the order Button.docs.json lists them. The editor and the drafts follow this order. */
export const DOCS_KEYS = ['summary', 'preview', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines', 'anatomy'] as const;
export type DocsKey = (typeof DOCS_KEYS)[number];

/** Prose keys: the ones code cannot fill. */
export const PROSE_KEYS = ['summary', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines'] as const;
export type ProseKey = (typeof PROSE_KEYS)[number];

export interface DocsPropInput {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string | undefined;
  description?: string | undefined;
}

export interface DocsContrastInput {
  foreground: string;
  background: string;
  /** Lowest ratio over every brand and theme. */
  ratio: number;
  min: number;
}

export interface DocsPrefillInput {
  /** PascalCase component name. */
  name: string;
  /** JSDoc of the component export, when there is one. */
  description?: string | undefined;
  props: DocsPropInput[];
  /** Native element whose attributes the component also accepts (button, span). */
  inherits?: string | undefined;
  /** CSS custom properties the stylesheet reads that are tokens, e.g. --color-text-default. */
  tokens: string[];
  /** Tokens it reads through another component's stylesheet, by that component (IconButton reads Button's). */
  inheritedTokens?: Record<string, string[]>;
  /** Class names of the CSS module, in source order. */
  cssClasses: string[];
  /** Contrast pairs from the contrast checks that involve the tokens it reads. */
  contrast?: DocsContrastInput[];
  /** The docs.json it has today, if any: existing prose is kept, only gaps are listed. */
  existing?: Partial<ComponentDocsJson> | null;
  /** What changed, when the pre-fill runs for a proposed change ("token color.text.muted changed"). */
  change?: string;
}

export interface DocsPrefill {
  component: string;
  /** Markdown table: prop, type, default, description. Empty string when the component has no props. */
  propsTable: string;
  tokens: string[];
  inheritedTokens: Record<string, string[]>;
  /** Class name -> readable label, keeping labels a writer already set. */
  anatomy: Record<string, string>;
  contrastNotes: string[];
  changelogLine: string;
  /** Prose keys with no content yet. */
  missing: ProseKey[];
  /** docs.json with the deterministic parts filled and the existing prose kept. Empty prose stays empty. */
  draft: ComponentDocsJson;
}

const ACRONYMS = new Set(['sm', 'md', 'lg', 'xl', 'xs']);

/** Readable label for a CSS module class: iconOnly -> "Icon only", is-open -> "Is open", sm -> "Size sm". */
export function anatomyLabel(className: string): string {
  if (ACRONYMS.has(className)) return `Size ${className}`;
  const words = className
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return className;
  if (words === 'root') return 'Container';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Class names of a CSS module, in source order, without duplicates and without keyframes. */
export function cssModuleClasses(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const out: string[] = [];
  for (const m of clean.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    // Skip decimals inside values (0.5) and file names: a class follows a selector boundary.
    const before = clean[m.index! - 1] ?? ' ';
    if (/[\w)]/.test(before)) continue;
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function propsTable(name: string, props: DocsPropInput[], inherits?: string): string {
  if (!props.length) return inherits ? `${name} has no props of its own. It accepts every native <${inherits}> attribute.` : '';
  const rows = props.map((p) => `| \`${p.name}\`${p.required ? ' (required)' : ''} | \`${cell(p.type)}\` | ${p.defaultValue ? `\`${cell(p.defaultValue)}\`` : ''} | ${cell(p.description ?? '')} |`);
  const tail = inherits ? `\n\nAlso accepts every native <${inherits}> attribute.` : '';
  return ['| Prop | Type | Default | Description |', '| --- | --- | --- | --- |', ...rows].join('\n') + tail;
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

/** Prose keys with no content in a docs.json (missing or empty). */
export function missingProse(d: Partial<ComponentDocsJson> | null | undefined): ProseKey[] {
  return PROSE_KEYS.filter((k) => isEmpty(d?.[k]));
}

/** The deterministic pre-fill of a component's docs. Same input, same output: nothing is invented. */
export function prefillDocs(input: DocsPrefillInput): DocsPrefill {
  const existing = input.existing ?? null;
  const anatomy: Record<string, string> = {};
  for (const c of input.cssClasses) anatomy[c] = existing?.anatomy?.[c] ?? anatomyLabel(c);
  const contrastNotes = (input.contrast ?? [])
    .slice()
    .sort((a, b) => a.ratio - b.ratio)
    .map((p) => `${p.foreground} on ${p.background}: ${p.ratio.toFixed(2)}:1 at worst over every brand and theme, needs ${p.min}:1 (${p.ratio >= p.min ? 'passes' : 'fails'}).`);
  const missing = missingProse(existing);
  const changelogLine = input.change
    ? `${input.name}: ${input.change.replace(/\.$/, '')}.`
    : missing.length === PROSE_KEYS.length
      ? `${input.name}: usage guidance added.`
      : `${input.name}: usage guidance updated.`;
  const draft: ComponentDocsJson = {
    summary: existing?.summary ?? input.description ?? '',
    ...(existing?.category ? { category: existing.category } : {}),
    ...(existing?.status ? { status: existing.status } : {}),
    ...(existing?.preview ? { preview: existing.preview } : {}),
    whenToUse: existing?.whenToUse ?? [],
    whenNotToUse: existing?.whenNotToUse ?? [],
    dos: existing?.dos ?? [],
    donts: existing?.donts ?? [],
    accessibility: existing?.accessibility ?? [],
    contentGuidelines: existing?.contentGuidelines ?? [],
    anatomy,
    ...(existing?.draftedBy ? { draftedBy: existing.draftedBy } : {}),
    ...(existing?.draftedSections?.length ? { draftedSections: existing.draftedSections } : {}),
    ...(existing?.needsReview !== undefined ? { needsReview: existing.needsReview } : {}),
  };
  return {
    component: input.name,
    propsTable: propsTable(input.name, input.props, input.inherits),
    tokens: [...new Set(input.tokens)].sort(),
    inheritedTokens: input.inheritedTokens ?? {},
    anatomy,
    contrastNotes,
    changelogLine,
    missing,
    draft,
  };
}

export interface DocsConventions {
  /** AGENTS.md (or the part about docs.json). */
  agents?: string;
  /** The voice section of the design language. */
  voice?: string;
  /** A finished docs.json to copy the structure and tone from (Button.docs.json). */
  example?: string;
  /** The component source, so the prose stays true to the code. */
  source?: string;
  /** The component's CSS module: its states and parts, so the prose stays true to the look. */
  styles?: string;
}

/** What docsPrompt asks for. Without `keys`, the missing prose as a full docs.json (the docs-draft Action, bridge_draft_docs). */
export interface DocsPromptOptions {
  /** Only these sections, answered as an object holding only them. */
  keys?: readonly ProseKey[];
  /** Rewrite the sections even when they hold text. */
  rewrite?: boolean;
  /**
   * Written sections older than the component code, to check (among `keys`): Claude returns one only when something
   * in it is no longer true for the code, keeping the writer's wording elsewhere; an accurate one is left out.
   */
  check?: readonly ProseKey[];
}

const SECTION_SHAPE: Record<ProseKey, string> = {
  summary: '"summary": "one or two sentences"',
  whenToUse: '"whenToUse": ["..."]',
  whenNotToUse: '"whenNotToUse": ["..."]',
  dos: '"dos": [{ "title": "...", "text": "..." }]',
  donts: '"donts": [{ "title": "...", "text": "..." }]',
  accessibility: '"accessibility": ["..."]',
  contentGuidelines: '"contentGuidelines": ["..."]',
};

/** The JSON shape of these sections, for a prompt: {"summary": "...", "dos": [{ "title", "text" }]}. */
export const docsSectionShapes = (keys: readonly ProseKey[]): string => `{ ${keys.map((k) => SECTION_SHAPE[k]).join(', ')} }`;

/**
 * The prompt a model gets to write the prose of a docs.json: the pre-fill as facts, the conventions, and strict
 * rules (no invention, JSON only). Used by the GitHub Action and returned by bridge_draft_docs for the user's own
 * Claude.
 */
export function docsPrompt(prefill: DocsPrefill, conventions: DocsConventions = {}, options: DocsPromptOptions = {}): string {
  const facts = [
    `Component: ${prefill.component}`,
    prefill.propsTable ? `Props (parsed from TypeScript):\n${prefill.propsTable}` : 'Props: none of its own.',
    `Tokens its stylesheet reads: ${prefill.tokens.join(', ') || 'none'}`,
    ...Object.entries(prefill.inheritedTokens).map(([from, list]) => `Tokens it reads through ${from}'s stylesheet: ${list.length}`),
    `Anatomy (CSS module classes): ${Object.entries(prefill.anatomy)
      .map(([k, v]) => `${k} = ${v}`)
      .join('; ') || 'none'}`,
    prefill.contrastNotes.length ? `Contrast checks:\n- ${prefill.contrastNotes.join('\n- ')}` : '',
    `Changelog line: ${prefill.changelogLine}`,
  ].filter(Boolean);
  const block = (title: string, text?: string) => (text?.trim() ? `<${title}>\n${text.trim()}\n</${title}>` : '');
  const keys = options.keys;
  const check = keys ? (options.check ?? []).filter((k) => keys.includes(k)) : [];
  const write = keys ? keys.filter((k) => !check.includes(k)) : [];
  const task = keys
    ? [
        ...(write.length ? [`${options.rewrite ? 'Rewrite' : 'Write'} these sections of ${prefill.component}.docs.json for the Bridge design system: ${write.join(', ')}.`] : []),
        ...(check.length
          ? [
              `Check these written sections of ${prefill.component}.docs.json against the current code: ${check.join(', ')}. The code changed after they were written.`,
              'Return a checked section ONLY when something in it is no longer true for the code (a wrong or removed prop, a removed state or variant, changed behavior). Then return the whole section with only the untrue parts fixed, keeping the writer\'s wording everywhere else.',
              'Leave a checked section out of the answer when it is still accurate: a missing key means unchanged. Never return a checked section just to improve its style.',
            ]
          : []),
        ...(options.rewrite ? ['Rewrite each one from the facts and the source: keep what is true in the current text, drop what the code does not support.'] : []),
      ]
    : [`Write the missing prose of ${prefill.component}.docs.json for the Bridge design system.`];
  const shape = keys
    ? [
        `- ${check.length ? 'Return' : 'Write'} only these keys: ${keys.join(', ')}${check.length ? ` (the checked ones, ${check.join(', ')}, only when they need a fix)` : ''}. Never return anatomy, preview or any other key: code decides them.`,
        `- Answer with one JSON object holding only those keys, nothing else: ${docsSectionShapes(keys)}.`,
      ]
    : [
        `- Fill only these keys: ${prefill.missing.join(', ') || 'none (everything is written: improve nothing, return the draft as is)'}. Keep every other key exactly as given.`,
        '- Answer with the full docs.json as one JSON object, nothing else.',
      ];
  return [
    ...task,
    '',
    'Rules:',
    '- Ground every sentence in the facts and the source below. Never invent props, variants, keyboard behavior or tokens that are not there.',
    '- Bridge voice: sentence case, plain words, verbs first, no em dashes, no marketing words.',
    '- Keep the keys and shapes of the example docs.json. dos and donts are { "title", "text" } objects; add an "example" only with components and props that exist.',
    ...shape,
    '',
    'Facts computed from the code:',
    facts.join('\n\n'),
    '',
    `Current draft:\n${JSON.stringify(prefill.draft, null, 2)}`,
    '',
    block('source', conventions.source),
    block('styles', conventions.styles),
    block('agents-md', conventions.agents),
    block('voice', conventions.voice),
    block('example-docs-json', conventions.example),
  ]
    .filter((x, i, all) => x !== '' || all[i - 1] !== '')
    .join('\n');
}

/**
 * Marks prose as drafted by Claude and waiting for review. With `sections`, only those sections were drafted: they
 * join the ones already waiting (draftedSections, in the PROSE_KEYS order). Without, the whole file was.
 */
export function markClaudeDraft<T extends Partial<ComponentDocsJson>>(d: T, sections?: readonly ProseKey[]): T {
  if (!sections) {
    const { draftedSections: _all, ...rest } = d;
    return { ...rest, draftedBy: 'claude', needsReview: true } as T;
  }
  const waiting = d.needsReview === true ? (d.draftedSections ?? (d.draftedBy ? [...PROSE_KEYS] : [])) : [];
  const union = PROSE_KEYS.filter((k) => waiting.includes(k) || sections.includes(k));
  return { ...d, draftedBy: 'claude', needsReview: true, draftedSections: union };
}

/** Prose sections that wait for review: draftedSections, every prose key for a whole-file draft, none once accepted. */
export function sectionsNeedingReview(d: Partial<ComponentDocsJson> | null | undefined): ProseKey[] {
  if (!d || d.needsReview !== true) return [];
  return d.draftedSections ? PROSE_KEYS.filter((k) => d.draftedSections!.includes(k)) : [...PROSE_KEYS];
}

/** True when the docs hold AI-drafted prose nobody has reviewed yet. */
export const needsDocsReview = (d: Partial<ComponentDocsJson> | null | undefined): boolean => Boolean(d && d.needsReview === true);

/** A reviewer accepts drafted prose: needsReview goes false, draftedBy stays as the record of who wrote it. */
export function acceptDocsDraft(d: ComponentDocsJson): ComponentDocsJson {
  const { draftedSections: _done, ...rest } = d;
  return { ...rest, needsReview: false };
}

/** docs.json text the way the repo writes it: two spaces, keys in the Button.docs.json order, trailing newline. */
export function formatDocsJson(d: Partial<ComponentDocsJson>): string {
  const order = ['summary', 'category', 'status', ...DOCS_KEYS.filter((k) => k !== 'summary'), 'draftedBy', 'draftedSections', 'needsReview'];
  const out: Record<string, unknown> = {};
  for (const k of order) if ((d as Record<string, unknown>)[k] !== undefined) out[k] = (d as Record<string, unknown>)[k];
  for (const [k, v] of Object.entries(d)) if (!(k in out) && v !== undefined) out[k] = v;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Keeps untouched nodes as they were written; rebuilds only what changed, in the shape of what it replaces. */
function patchNode(old: JsonNode, next: unknown): JsonNode {
  if (plainEqual(toPlain(old), next)) return old;
  if (old.kind === 'object' && next && typeof next === 'object' && !Array.isArray(next)) {
    const n = next as Record<string, unknown>;
    const kept = old.entries.filter((e) => n[e.key] !== undefined).map((e): JsonEntry => ({ key: e.key, value: patchNode(e.value, n[e.key]) }));
    const added = Object.keys(n)
      .filter((k) => n[k] !== undefined && !getEntry(old, k))
      .map((k): JsonEntry => ({ key: k, value: fromPlain(n[k], undefined, old.inline) }));
    return { kind: 'object', inline: old.inline, entries: [...kept, ...added] };
  }
  if (old.kind === 'array' && Array.isArray(next)) {
    return { kind: 'array', inline: old.inline, items: next.map((v, i) => (old.items[i] ? patchNode(old.items[i]!, v) : fromPlain(v, old.items[0], old.inline))) };
  }
  return fromPlain(next, old);
}

/**
 * docs.json text for edited docs, written as a minimal diff of the file it replaces: untouched sections stay byte for
 * byte (a hand-formatted file keeps its inline preview nodes), new keys go at the end in the repo order. Without an
 * original (or with one that is not valid JSON) it falls back to formatDocsJson.
 */
export function patchDocsJson(original: string | null | undefined, next: Partial<ComponentDocsJson>): string {
  const plain = JSON.parse(formatDocsJson(next)) as unknown;
  if (!original) return formatDocsJson(next);
  try {
    const doc = parseJson(original);
    if (doc.root.kind !== 'object') return formatDocsJson(next);
    return serializeJson({ ...doc, root: patchNode(doc.root, plain) });
  } catch {
    return formatDocsJson(next);
  }
}

/** Accepts the drafted prose inside a docs.json text: only the review lines change. Throws on invalid JSON. */
export function acceptDocsText(text: string): string {
  return patchDocsJson(text, acceptDocsDraft(JSON.parse(text) as ComponentDocsJson));
}

/** Tier and bump of a docs-only change: Tier 1 under the shared classifier, and a patch. */
export const DOCS_CHANGE_BUMP = 'patch' as const;
