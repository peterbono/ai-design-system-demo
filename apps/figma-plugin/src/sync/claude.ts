// Writing help with Claude, two ways, both optional:
// - "Copy for Claude": a ready prompt the designer pastes into Claude.ai or Claude Desktop with their own plan (no key),
//   then pastes the answer back ("Paste Claude's answer").
// - "Draft with Claude": one call to the Messages API with the designer's own Anthropic API key (billed to their
//   account), from the plugin UI iframe. The key lives in figma.clientStorage on this computer, never in the file, and
//   is only ever sent to api.anthropic.com.
// Pure: no DOM, no figma.*. The UI wires it; tests mock fetch.

import { DRAFT_LINE_MAX, type DraftLine, type DraftResultLine, type RequestChange, type RequestKind, REQUEST_KINDS, cleanDraftText, sanitizeDraftLine, sanitizeDraftTitle } from '@bridge-ds/core';

export const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_MODELS = [
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (default)' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]['value'];
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = 'claude-sonnet-5-5';
export const isClaudeModel = (m: unknown): m is ClaudeModel => CLAUDE_MODELS.some((x) => x.value === m);

/** Shown under a field Claude filled, until the designer edits it. */
export const DRAFTED_NOTE = 'Drafted by Claude, review before sending';

export const TITLE_MAX = 70;
const SUMMARY_SENTENCES = 3;
const SUMMARY_MAX = 600;

export interface ClaudeDraftInput {
  /** "request": one component change request. "push": the Push description (pull request and requests). */
  target: 'request' | 'push';
  component?: string | undefined;
  kind?: RequestKind | undefined;
  changes: RequestChange[];
  /** Components the push also sends requests for. */
  components?: string[] | undefined;
  /** The deterministic draft, as a starting point. */
  draft?: { title: string; summary: string } | undefined;
  /** What the designer already typed: their intent, kept in the answer. */
  notes?: string | undefined;
  /** PNG base64 (no data: prefix): the component at its baseline and now. Skipped when missing. */
  before?: string | undefined;
  after?: string | undefined;
  /** Component changes to write one line each for (by id), with the deterministic line as a starting point. */
  lines?: DraftLine[] | undefined;
  /** Push: before and after images per change line, when the item has several components. */
  lineImages?: { id: string; before?: string | undefined; after?: string | undefined }[] | undefined;
}

export interface ClaudeDraft {
  title: string;
  summary: string;
  /** One sentence per change line (by DraftLine id), with its request title. Missing or empty when Claude wrote none. */
  lines?: DraftResultLine[] | undefined;
}

/** The Bridge voice and the output contract, shared by the API call and the copied prompt. */
export const SYSTEM_PROMPT = [
  'You write the text of design system change requests and pull requests for DS Bridge, a Figma plugin that sends designers\' changes to developers.',
  'Voice: a calm, precise colleague. Sentence case. Start with a verb. Plain words developers use: component, prop, variant, token, pull request.',
  'Say what changes for developers (props, variants, tokens, the look) and why it matters for people who use the component. Use only facts from the changes, the images and the designer\'s notes. Never invent numbers, names, usage or reasons; if the reason is unknown, say what changes and leave the reason out.',
  'Never use an em dash. Use a colon, a comma or parentheses instead. No exclamation marks, no emoji, no Markdown.',
  `Return only a JSON object, with no text around it: {"title": "...", "summary": "...", "lines": [{"id": "...", "line": "...", "title": "..."}]}. title: one line, at most ${TITLE_MAX} characters, no trailing period, do not start with the component name. summary: at most ${SUMMARY_SENTENCES} sentences.`,
  `lines: one per change line listed (by its id), or an empty list when none is listed. Each is one short sentence, at most ${DRAFT_LINE_MAX} characters, no trailing period: what changed for developers, read from the before and after images (the part, the variant, the values you can see), for example "Icon added after the label in primary sm: Pencil, 16px". Never guess a value you cannot read. Each line also gets "title": the title of the request that component change becomes, short, sentence case, starts with a verb, at most ${TITLE_MAX} characters, no trailing period, never the component name, for example "Add an icon after the label".`,
].join('\n');

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The change table as Markdown. */
export function changeTable(changes: RequestChange[], head: [string, string, string] = ['What', 'Now', 'In Figma']): string {
  if (!changes.length) return '';
  return [`| ${head.join(' | ')} |`, '| --- | --- | --- |', ...changes.map((c) => `| ${cell(c.field)} | ${cell(c.before) || 'none'} | ${cell(c.after) || 'removed'} |`)].join('\n');
}

/** The user message: what to write, the facts, the starting draft. */
export function claudeUserText(input: ClaudeDraftInput): string {
  const kind = input.kind ? REQUEST_KINDS.find((k) => k.value === input.kind)?.label : undefined;
  const lines: string[] = [];
  if (input.target === 'request') {
    lines.push('Write the title and summary of a component change request (a GitHub issue developers implement).');
    if (input.component) lines.push(`Component: ${input.component}`);
    if (kind) lines.push(`Kind: ${kind}`);
  } else {
    lines.push('Write the title and description of a pull request with these design token (variable) edits from Figma. The description also opens every component request sent with it.');
    if (input.components?.length) lines.push(`Components with a change request: ${input.components.join(', ')}`);
  }
  const table = changeTable(input.changes);
  lines.push('', 'Changes detected:', table || '(none detected: rely on the notes and the images)');
  if (input.draft && (input.draft.title || input.draft.summary)) lines.push('', 'Starting draft, written from the changes only:', `Title: ${input.draft.title}`, `Summary: ${input.draft.summary}`);
  if (input.notes?.trim()) lines.push('', 'The designer\'s notes (keep their intent):', input.notes.trim());
  if (input.lines?.length) {
    lines.push('', 'Change lines to write, one sentence and one request title each:');
    for (const l of input.lines) {
      const kindLabel = l.kind ? REQUEST_KINDS.find((k) => k.value === l.kind)?.label : undefined;
      lines.push(`- id ${l.id}${l.component ? `, ${l.component}` : ''}${kindLabel ? ` (${kindLabel})` : ''}. Starting line: ${l.line || '(none)'}${l.title ? `. Starting title: ${l.title}` : ''}`);
      for (const c of l.changes) lines.push(`  - ${c.field}: ${c.before || 'none'} -> ${c.after || 'removed'}`);
    }
  }
  const imgs = [input.before ? 'before (baseline)' : '', input.after ? 'after (now in Figma)' : ''].filter(Boolean);
  if (imgs.length) lines.push('', `Images attached: ${imgs.join(', ')}.`);
  if (input.lineImages?.some((x) => x.before || x.after)) lines.push('', 'Images attached per change line, labeled with the line id.');
  return lines.join('\n');
}

/** The prompt "Copy for Claude" puts on the clipboard, for Claude.ai or Claude Desktop. */
export function copyPrompt(input: ClaudeDraftInput): string {
  return [
    SYSTEM_PROMPT,
    '',
    claudeUserText({ ...input, before: undefined, after: undefined, lineImages: undefined }),
    '',
    'If I attach before and after screenshots of the component, use them to describe the visible change.',
    'Answer with the JSON object only.',
  ].join('\n');
}

export interface ClaudeHttpRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

const image = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: data.replace(/^data:image\/png;base64,/, '') } });

/** The Messages API call: headers for a direct browser call, the facts as text, then the images. */
export function buildClaudeRequest(apiKey: string, model: string, input: ClaudeDraftInput): ClaudeHttpRequest {
  const content: unknown[] = [];
  if (input.before) content.push({ type: 'text', text: 'Before (baseline):' }, image(input.before));
  if (input.after) content.push({ type: 'text', text: 'After (now in Figma):' }, image(input.after));
  for (const x of input.lineImages ?? []) {
    if (x.before) content.push({ type: 'text', text: `Line ${x.id}, before (baseline):` }, image(x.before));
    if (x.after) content.push({ type: 'text', text: `Line ${x.id}, after (now in Figma):` }, image(x.after));
  }
  content.push({ type: 'text', text: claudeUserText(input) });
  return {
    url: CLAUDE_API_URL,
    init: {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: isClaudeModel(model) ? model : DEFAULT_CLAUDE_MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    },
  };
}

/** A failure with a message the designer can act on. The deterministic draft stays in place. */
export class ClaudeDraftError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ClaudeDraftError';
  }
}

export function claudeErrorMessage(status: number | 'network'): string {
  if (status === 'network') return 'Could not reach Claude. Check your connection and try again. Your draft is unchanged.';
  if (status === 401 || status === 403) return 'Claude did not accept the API key. Check it in Settings, or create a new one on console.anthropic.com.';
  if (status === 429) return 'Claude is rate limiting this key. Wait a minute and try again.';
  if (status === 400) return 'Claude could not read this request. Try again with fewer changes checked, or write the text yourself.';
  if (status === 529 || status >= 500) return 'Claude is busy right now. Try again in a moment.';
  return `Claude answered with an error (${status}). Try again, or write the text yourself.`;
}

/** Shortens to `max` characters at a word boundary, without a trailing period. */
function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:]+$/, '');
}

/** At most 3 sentences and 600 characters. */
function sentences(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const parts = t.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [t];
  let out = parts.slice(0, SUMMARY_SENTENCES).map((s) => s.trim()).join(' ');
  if (out.length > SUMMARY_MAX) out = `${clip(out, SUMMARY_MAX)}.`;
  return out;
}

/** Change lines from Claude's answer: {id, line, title}, the line one sentence of at most 120 characters, the title at most 70. */
function sanitizeLines(raw: unknown): DraftResultLine[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, DraftResultLine>();
  for (const x of raw as { id?: unknown; line?: unknown; title?: unknown }[]) {
    const id = typeof x?.id === 'string' ? x.id.trim() : '';
    const line = sanitizeDraftLine(x?.line);
    const title = sanitizeDraftTitle(x?.title);
    if (id && (line || title)) out.set(id, { id, line, ...(title ? { title } : {}) });
  }
  return [...out.values()];
}

/** Title, summary and change lines from an object Claude returned: em dashes removed, lengths kept to the contract. */
export function sanitizeDraft(raw: unknown): ClaudeDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ClaudeDraftError('Claude\'s answer has no title and summary. Try again.');
  const r = raw as { title?: unknown; summary?: unknown; description?: unknown; lines?: unknown };
  const title = typeof r.title === 'string' ? clip(cleanDraftText(r.title), TITLE_MAX) : '';
  const summaryRaw = typeof r.summary === 'string' ? r.summary : typeof r.description === 'string' ? r.description : '';
  const summary = sentences(cleanDraftText(summaryRaw));
  const lines = sanitizeLines(r.lines);
  if (!title && !summary && !lines.length) throw new ClaudeDraftError('Claude\'s answer has no title and summary. Try again.');
  return { title, summary, ...(lines.length ? { lines } : {}) };
}

/**
 * The JSON object in a pasted or returned answer: plain, inside a ```json fence, or inside surrounding text.
 * Throws a ClaudeDraftError that says what to paste when there is none.
 */
export function parseClaudeAnswer(text: string): ClaudeDraft {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ClaudeDraftError('Paste the whole answer from Claude: it should hold {"title": ..., "summary": ...}.');
  let json: unknown;
  try {
    json = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new ClaudeDraftError('The answer is not valid JSON. Copy Claude\'s whole answer and paste it again.');
  }
  return sanitizeDraft(json);
}

type FetchLike = (url: string, init: ClaudeHttpRequest['init']) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One call to the Messages API with the designer's key. Never retries silently; errors keep the current draft. */
export async function draftWithClaude(fetchImpl: FetchLike, apiKey: string, model: string, input: ClaudeDraftInput): Promise<ClaudeDraft> {
  if (!apiKey.trim()) throw new ClaudeDraftError('Add an Anthropic API key in Settings first.');
  const req = buildClaudeRequest(apiKey.trim(), model, input);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(req.url, req.init);
  } catch {
    throw new ClaudeDraftError(claudeErrorMessage('network'));
  }
  if (!res.ok) throw new ClaudeDraftError(claudeErrorMessage(res.status), res.status);
  const body = (await res.json().catch(() => undefined)) as { stop_reason?: string; content?: { type: string; text?: string }[] } | undefined;
  if (body?.stop_reason === 'refusal') throw new ClaudeDraftError('Claude declined to draft this one. Write the text yourself, or try again.');
  const text = (body?.content ?? []).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return parseClaudeAnswer(text);
}
