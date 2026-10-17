// In-place docs drafting on a Library component page, as pure functions: which sections a scope drafts, which ones
// are outdated, the prompt, the Messages API request and the answer. The browser side (src/scripts/docs-ai.ts) only
// adds localStorage, fetch and the GitHub session. Shared logic lives in @bridge-ds/core (prefillDocs, docsPrompt,
// docs-ai.ts), the same code the docs-draft Action and the MCP draft exchange use.
import {
  type AnthropicHttpRequest,
  type ComponentDocsJson,
  type DocsConventions,
  type DocsDraftTask,
  type DocsPrefillInput,
  type DocsSections,
  type DocsTaskAnswer,
  type DraftResult,
  DOCS_DRAFT_MODEL,
  PROSE_KEYS,
  type ProseKey,
  anthropicReplyText,
  anthropicRequest,
  docsSectionsResult,
  docsTaskPrompt,
  missingProse,
  parseDocsTaskAnswer,
  prefillDocs,
  sanitizeDocsReplacement,
} from '@bridge-ds/core';

/** What to draft: the whole page (only gaps, or every section), one section, or a selected passage. */
export type DraftScope =
  | { kind: 'page-fill' } // fill only empty or outdated prose sections, never touch reviewed human text
  | { kind: 'page-rewrite' } // rewrite every prose section
  | { kind: 'section'; key: ProseKey } // one section
  | { kind: 'selection'; key: ProseKey; text: string; mode: 'clearer' | 'shorter' | 'voice' }; // rewrite a selected passage in the Bridge voice

/** Who writes: the designer's own API key from this browser, or their own Claude through the Bridge MCP server. */
export type DraftWay = 'api-key' | 'my-claude';

export interface DraftAvailability {
  ways: DraftWay[];
  preferred: DraftWay | null;
}

/** Drafted sections (sections scopes) or the rewritten passage (selection, `sections` stays empty). */
export interface DraftDocsResult {
  sections: Partial<Record<ProseKey, ComponentDocsJson[ProseKey]>>;
  replacement?: string;
}

/** /docs-ai/<slug>.json: the facts from the code and the repo conventions, built with the site. */
export interface DocsAiContext {
  slug: string;
  name: string;
  /** Repo paths of the component files (commit dates decide which sections are outdated). */
  files: { tsx: string; css: string; docs: string };
  /** prefillDocs input without the docs: the browser adds the docs it has now. */
  input: Omit<DocsPrefillInput, 'existing' | 'change'>;
  conventions: DocsConventions;
}

export const PROSE_SECTIONS = PROSE_KEYS;

/** The ways open in this browser: an API key saved here, and a GitHub token that can write the draft exchange. */
export function availability(has: { apiKey: boolean; exchange: boolean }): DraftAvailability {
  const ways: DraftWay[] = [...(has.apiKey ? (['api-key'] as const) : []), ...(has.exchange ? (['my-claude'] as const) : [])];
  return { ways, preferred: ways[0] ?? null };
}

/**
 * Sections that are empty, or older than the component code: when the last commit of the tsx or the css is newer than
 * the last commit of docs.json, every written section is outdated (a docs.json not committed yet counts as oldest).
 * Without dates (GitHub could not be read) only the empty ones.
 */
export function outdatedFromDates(docs: Partial<ComponentDocsJson> | null | undefined, dates?: { code: (string | null | undefined)[]; docs: string | null | undefined } | null): ProseKey[] {
  const empty = missingProse(docs);
  if (!dates) return empty;
  const code = Math.max(...dates.code.map((d) => (d ? Date.parse(d) : Number.NaN)).filter((n) => !Number.isNaN(n)), Number.NEGATIVE_INFINITY);
  if (code === Number.NEGATIVE_INFINITY) return empty;
  const written = dates.docs ? Date.parse(dates.docs) : Number.NEGATIVE_INFINITY;
  if (!(code > written)) return empty;
  return [...PROSE_KEYS];
}

/**
 * The core task of a scope. page-fill: the empty or outdated sections only (written, up-to-date text is never touched);
 * an empty key list means nothing to draft. page-rewrite: every prose section. section: that one, rewritten when it
 * holds text. selection: the passage only.
 */
export function scopeTask(scope: DraftScope, docs: Partial<ComponentDocsJson> | null | undefined, outdated: readonly ProseKey[] = missingProse(docs)): DocsDraftTask {
  const empty = missingProse(docs);
  switch (scope.kind) {
    case 'page-fill': {
      const keys = PROSE_KEYS.filter((k) => empty.includes(k) || outdated.includes(k));
      const stale = keys.filter((k) => !empty.includes(k));
      return { kind: 'sections', keys, ...(stale.length ? { outdated: stale } : {}) };
    }
    case 'page-rewrite':
      return { kind: 'sections', keys: [...PROSE_KEYS], rewrite: true };
    case 'section':
      if (!PROSE_KEYS.includes(scope.key)) throw new Error(`"${scope.key}" is not a prose section. Anatomy and preview come from the code.`);
      return { kind: 'sections', keys: [scope.key], ...(empty.includes(scope.key) ? {} : { rewrite: true }) };
    case 'selection':
      if (!PROSE_KEYS.includes(scope.key)) throw new Error(`"${scope.key}" is not a prose section.`);
      if (!scope.text.trim()) throw new Error('Select the text to rewrite first.');
      return { kind: 'selection', key: scope.key, text: scope.text.trim(), mode: scope.mode };
  }
}

/** True when a task has nothing to write (page-fill on complete, up-to-date docs). */
export const isEmptyTask = (t: DocsDraftTask) => t.kind === 'sections' && t.keys.length === 0;

/** The prompt of a task for this component, with the docs as they are now (edited or not). */
export function taskPrompt(ctx: DocsAiContext, docs: Partial<ComponentDocsJson> | null | undefined, task: DocsDraftTask): string {
  const prefill = prefillDocs({ ...ctx.input, existing: docs ?? null });
  return docsTaskPrompt(prefill, ctx.conventions, task);
}

/** System prompt of the direct call: who Claude writes for and the hard rules. */
export const DOCS_SYSTEM_PROMPT = [
  'You write the usage guidance of design system components for Bridge, read by designers and developers on the component\'s Library page.',
  'Ground every sentence in the facts and the source given. Never invent props, variants, keyboard behavior, tokens or anatomy.',
  'Bridge voice: sentence case, plain words, verbs first, calm and precise. Never use an em dash: use a colon, a comma or two sentences. No exclamation marks, no emoji, no Markdown.',
  'Answer with one JSON object only, in the shape the prompt asks for.',
].join('\n');

/** The Messages API call with the designer's own key, straight from this browser. */
export function docsApiRequest(apiKey: string, prompt: string, model: string = DOCS_DRAFT_MODEL): AnthropicHttpRequest {
  return anthropicRequest({ apiKey, prompt, model, system: DOCS_SYSTEM_PROMPT, browser: true, maxTokens: 8000 });
}

/** The result of a direct call: the reply text parsed for the task, sanitized (no em dash, docs.json shapes). */
export function resultFromReply(task: DocsDraftTask, replyBody: unknown): DraftDocsResult {
  return toResult(parseDocsTaskAnswer(task, anthropicReplyText(replyBody)));
}

/** The result from the draft exchange (the user's own Claude wrote it through the Bridge MCP server). */
export function resultFromExchange(task: DocsDraftTask, r: Pick<DraftResult, 'docs' | 'replacement'>): DraftDocsResult {
  if (task.kind === 'selection') {
    const replacement = sanitizeDocsReplacement(r.replacement);
    if (!replacement) throw new Error('Claude sent no rewritten passage. Try again.');
    return { sections: {}, replacement };
  }
  return { sections: docsSectionsResult(task, r.docs) };
}

function toResult(a: DocsTaskAnswer): DraftDocsResult {
  return a.replacement !== undefined ? { sections: {}, replacement: a.replacement } : { sections: a.sections as DocsSections };
}

/** An error the designer can act on, for a failed direct call. Their docs stay as they were. */
export function apiErrorMessage(status: number | 'network'): string {
  if (status === 'network') return 'Could not reach Claude. Check your connection and try again. Your docs are unchanged.';
  if (status === 401 || status === 403) return 'Claude did not accept the API key. Check it, or create a new one on console.anthropic.com.';
  if (status === 429) return 'Claude is rate limiting this key. Wait a minute and try again.';
  if (status === 400) return 'Claude could not read this request. Try a smaller scope, or write the text yourself.';
  if (status === 529 || status >= 500) return 'Claude is busy right now. Try again in a moment.';
  return `Claude answered with an error (${status}). Try again, or write the text yourself.`;
}
