// Draft exchange: designers draft their change texts with their own Claude (Claude Desktop or Claude Code on their own
// plan) through the Bridge MCP server, from the DS Bridge Figma plugin. Third-party apps cannot use a Claude plan, and
// Bridge has no backend, so the channel is the GitHub repo both already reach with the designer's own token:
//
// 1. The plugin writes `.bridge/drafts/<sessionId>.json` (status "pending") on the requests branch, with the detected
//    changes, the deterministic draft and links to before and after PNGs uploaded next to it.
// 2. The designer tells their Claude "Draft my Bridge changes". The MCP tool bridge_pending_drafts returns the pending
//    items (and the images, so Claude can see them), bridge_write_drafts writes the results back (status "drafted").
// 3. The plugin polls the file, fills the fields it may fill, then deletes the file once the request or push is sent
//    (or cancelled).
//
// Bridge Studio uses the same exchange for component docs (a "docs" item, from the Library page): the item carries the
// task (which prose sections, or a selected passage) and the full prompt with the facts from the code; the result
// carries the sections (or the rewritten passage), sanitized to the docs.json shapes.
//
// Writers update with the file sha (optimistic concurrency) and retry on 409. Pure helpers plus a few GitHubClient
// helpers: no DOM, no figma.*, no Node-only API.

import { DRAFT_LINE_MAX, cleanDraftText, sanitizeDraftLine, type DraftText } from './change-drafts';
import { type DocsDraftTask, type DocsSections, docsSectionsAnswer, docsTaskKeys, sanitizeDocsReplacement, validateDocsTask } from './docs-ai';
import type { ProseKey } from './docs-draft';
import { GitHubError, type GitHubClient } from './github-client';
import { REQUESTS_BRANCH, type RequestChange, type RequestKind, REQUEST_KINDS } from './requests';

export const DRAFT_EXCHANGE_VERSION = 1;
/** Folder of pending draft sessions on the requests branch. */
export const DRAFTS_DIR = '.bridge/drafts';
/** What the designer says to their Claude. */
export const DRAFT_PHRASE = 'Draft my Bridge changes';
export const DRAFT_TITLE_MAX = 70;
export const DRAFT_SUMMARY_SENTENCES = 3;
export { DRAFT_LINE_MAX };
const SUMMARY_MAX = 600;

export type DraftScope = 'request' | 'push' | 'docs';
/** Who wrote the session: the DS Bridge Figma plugin, or Bridge Studio (component docs on the Library page). */
export type DraftSource = 'figma' | 'studio';
export type DraftSessionStatus = 'pending' | 'drafted';

export interface DraftImage {
  label: 'before' | 'after';
  /** Public URL on the requests branch (github.com/<repo>/blob/bridge-requests/<path>?raw=true). */
  url: string;
  /** Repo path on the requests branch, so tools can read it with the token. */
  path?: string | undefined;
  /** The change line (DraftLine id) this image shows, when an item has several components (a push). */
  line?: string | undefined;
}

/**
 * One detected component change to describe in one sentence (its "change line"): the main line of its row in the
 * plugin and the first line of its request. A request item has one, a push item one per component it requests.
 */
export interface DraftLine {
  /** Stable id to answer with (the plugin uses the component's node id). */
  id: string;
  component?: string | undefined;
  kind?: RequestKind | undefined;
  changes: RequestChange[];
  /** The deterministic line, from the changes only, as a starting point. */
  line: string;
  /** The deterministic request title of this component change, as a starting point. Missing from older plugins. */
  title?: string | undefined;
}

export interface DraftVariableRow {
  path: string;
  before?: string | undefined;
  after?: string | undefined;
}

export interface DraftItem {
  id: string;
  /** "request": one component change request. "push": the pull request description of variable edits. */
  scope: DraftScope;
  component?: string | undefined;
  kind?: RequestKind | undefined;
  changes: RequestChange[];
  /** Push only: the variable edits (token path, value now, value in Figma). */
  variables?: DraftVariableRow[] | undefined;
  /** Push only: components the push also sends a request for. */
  components?: string[] | undefined;
  /** What the designer already typed: their intent, kept in the answer. */
  notes?: string | undefined;
  images?: DraftImage[] | undefined;
  /** The deterministic draft (from the detected changes only), as a starting point. */
  draft: DraftText;
  /** Component changes to write one line each for. Missing in sessions from older plugins. */
  lines?: DraftLine[] | undefined;
  /** Docs only: the component docs to write. */
  docs?: DraftDocsItem | undefined;
}

/** A docs item: prose sections of one component's docs.json (or one selected passage), from Bridge Studio. */
export interface DraftDocsItem {
  /** Component slug on the Library page (button, icon-button). */
  slug: string;
  /** docs.json path in the repo. */
  path?: string | undefined;
  task: DocsDraftTask;
  /** The full prompt: the task, the rules, the facts from the code (props, CSS module classes, JSDoc, tokens), the voice. */
  prompt: string;
}

export interface DraftResult {
  id: string;
  title: string;
  summary: string;
  /**
   * One sentence per change line of the item (by DraftLine id), and the title of the request it becomes. Optional:
   * older writers send none, or lines without a title.
   */
  lines?: DraftResultLine[] | undefined;
  /** Docs items (sections task): the sections Claude wrote, sanitized to the docs.json shapes. */
  docs?: DocsSections | undefined;
  /** Docs items (selection task): the rewritten passage. */
  replacement?: string | undefined;
  /** Docs items (sections task): checked sections Claude verified and left unchanged (still accurate). */
  checked?: ProseKey[] | undefined;
  by: 'claude';
  at: string;
}

export interface DraftResultLine {
  id: string;
  /** May be empty when only the title was written. */
  line: string;
  /** The request title of this component change: short, sentence case, at most 70 characters ("Add an icon after the label"). */
  title?: string | undefined;
}

export interface PendingDrafts {
  version: 1;
  sessionId: string;
  createdAt: string;
  status: DraftSessionStatus;
  source: DraftSource;
  items: DraftItem[];
  results?: DraftResult[] | undefined;
}

// ---------------------------------------------------------------------------------------------
// The words Claude gets: the Bridge voice and the exact output contract.

export const DRAFT_VOICE_RULES = [
  'Write like a calm, precise colleague. Sentence case. Start the title with a verb.',
  'Look at the before and after images first, then the change table: say what changes for developers (props, variants, tokens, the look) and why it matters for people who use the component.',
  'Use only facts from the changes, the images and the designer\'s notes. Never invent numbers, names, usage or reasons. If the reason is unknown, say what changes and leave the reason out.',
  'Keep the designer\'s intent from their notes.',
  'Never use an em dash: use a colon, a comma or parentheses. No exclamation marks, no emoji, no Markdown.',
  'A request title never repeats the component name: the issue title already starts with it.',
  `For each change line, write one short sentence (at most ${DRAFT_LINE_MAX} characters, no trailing period) of what changed for developers, read from the before and after images: the part, the variant and the values when you can see them, for example "Icon added after the label in primary sm: Pencil, 16px". Never guess a value you cannot read.`,
  `For each change line, also write the title of the request it becomes: short, sentence case, starts with a verb, at most ${DRAFT_TITLE_MAX} characters, no trailing period, never the component name, for example "Add an icon after the label".`,
];

export const DRAFT_OUTPUT_CONTRACT = [
  `Call bridge_write_drafts once per session with {"sessionId": "...", "results": [{"id": "<item id>", "title": "...", "summary": "...", "lines": [{"id": "<line id>", "line": "...", "title": "..."}]}]}, one result per item.`,
  `title: one line, at most ${DRAFT_TITLE_MAX} characters, no trailing period.`,
  `summary: at most ${DRAFT_SUMMARY_SENTENCES} sentences, plain text.`,
  `lines: one per change line the item lists (its "lines"), by line id: line is one sentence, at most ${DRAFT_LINE_MAX} characters, no trailing period; title is the request title for that component change, at most ${DRAFT_TITLE_MAX} characters, no trailing period. Leave lines out when the item lists none.`,
  'Docs items (scope "docs", from Bridge Studio): follow the item\'s prompt and send {"id": "<item id>", "docs": {<only the sections it asks for>}} for a sections task (a section to check goes in only when something in it is no longer true for the code: leave accurate ones out, {"docs": {}} when all are), or {"id": "<item id>", "replacement": "..."} for a selection task. No title or summary. The designer reviews them on the Library page.',
  'The designer reviews the text in Figma before anything is sent.',
];

// ---------------------------------------------------------------------------------------------
// Pure helpers

/** A random session id: 16 lowercase base-36 characters, safe in a file name. */
export function newDraftSessionId(random: () => number = Math.random): string {
  let out = '';
  while (out.length < 16) out += Math.floor(random() * 36).toString(36);
  return out;
}

const SESSION_RE = /^[a-z0-9-]{6,64}$/;
export const isDraftSessionId = (s: unknown): s is string => typeof s === 'string' && SESSION_RE.test(s);

/** Path of a session file on the requests branch. */
export function draftSessionPath(sessionId: string): string {
  if (!isDraftSessionId(sessionId)) throw new Error(`"${sessionId}" is not a draft session id.`);
  return `${DRAFTS_DIR}/${sessionId}.json`;
}

/** Path of an image of a session item on the requests branch: `.bridge/drafts/<sessionId>/<itemId>-<label>.png`. */
export function draftImagePath(sessionId: string, itemId: string, label: DraftImage['label']): string {
  const item = itemId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  draftSessionPath(sessionId);
  return `${DRAFTS_DIR}/${sessionId}/${item}-${label}.png`;
}

export interface ComposeDraftsInput {
  items: DraftItem[];
  source?: DraftSource | undefined;
  sessionId?: string | undefined;
  now?: Date | undefined;
  random?: (() => number) | undefined;
}

/** A new pending session. Throws when it has no item or an item is invalid. */
export function composePendingDrafts(input: ComposeDraftsInput): PendingDrafts {
  const p: PendingDrafts = {
    version: DRAFT_EXCHANGE_VERSION,
    sessionId: input.sessionId ?? newDraftSessionId(input.random),
    createdAt: (input.now ?? new Date()).toISOString(),
    status: 'pending',
    source: input.source ?? 'figma',
    items: input.items.map((i) => ({ ...i, changes: i.changes ?? [] })),
  };
  const problems = validatePendingDrafts(p);
  if (problems.length) throw new Error(problems.join(' '));
  return p;
}

const KINDS = new Set<string>(REQUEST_KINDS.map((k) => k.value));
const str = (x: unknown) => typeof x === 'string';
const optStr = (x: unknown) => x === undefined || typeof x === 'string';

/** Problems in a session, as sentences. Empty when valid. */
export function validatePendingDrafts(x: unknown): string[] {
  const out: string[] = [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return ['A draft session is a JSON object.'];
  const p = x as Partial<PendingDrafts>;
  if (p.version !== DRAFT_EXCHANGE_VERSION) out.push(`Unsupported draft session version ${String(p.version)}: update Bridge.`);
  if (!isDraftSessionId(p.sessionId)) out.push('The session id is missing or invalid.');
  if (!str(p.createdAt) || Number.isNaN(Date.parse(p.createdAt!))) out.push('createdAt must be an ISO date.');
  if (p.status !== 'pending' && p.status !== 'drafted') out.push('status must be "pending" or "drafted".');
  if (p.source !== 'figma' && p.source !== 'studio') out.push('source must be "figma" or "studio".');
  if (!Array.isArray(p.items) || !p.items.length) out.push('A draft session needs at least one item.');
  const ids = new Set<string>();
  for (const [n, i] of (Array.isArray(p.items) ? p.items : []).entries()) {
    const at = `Item ${n + 1}`;
    if (!i || typeof i !== 'object') {
      out.push(`${at} is not an object.`);
      continue;
    }
    if (!str(i.id) || !i.id) out.push(`${at} has no id.`);
    else if (ids.has(i.id)) out.push(`${at} repeats the id "${i.id}".`);
    else ids.add(i.id);
    if (i.scope !== 'request' && i.scope !== 'push' && i.scope !== 'docs') out.push(`${at}: scope must be "request", "push" or "docs".`);
    if (i.scope === 'docs') {
      const d = i.docs;
      if (!d || typeof d !== 'object' || !str(d.slug) || !d.slug || !str(d.prompt) || !d.prompt || !optStr(d.path)) out.push(`${at}: a docs item needs docs {slug, task, prompt}.`);
      else out.push(...validateDocsTask(d.task).map((m) => `${at}: ${m}`));
    } else if (i.docs !== undefined) out.push(`${at}: only a docs item has docs.`);
    if (!optStr(i.component)) out.push(`${at}: component must be text.`);
    if (i.kind !== undefined && !KINDS.has(i.kind)) out.push(`${at}: unknown kind "${String(i.kind)}".`);
    if (!Array.isArray(i.changes) || i.changes.some((c) => !c || !str(c.field) || !optStr(c.before) || !optStr(c.after))) out.push(`${at}: changes must be a list of {field, before, after}.`);
    if (i.variables !== undefined && (!Array.isArray(i.variables) || i.variables.some((v) => !v || !str(v.path)))) out.push(`${at}: variables must be a list of {path, before, after}.`);
    if (i.variables !== undefined && i.scope !== 'push') out.push(`${at}: only a push item has variables.`);
    if (i.images !== undefined && (!Array.isArray(i.images) || i.images.some((m) => !m || (m.label !== 'before' && m.label !== 'after') || !str(m.url)))) out.push(`${at}: images must be a list of {label: before or after, url}.`);
    if (!i.draft || !str(i.draft.title) || !str(i.draft.summary)) out.push(`${at}: draft must hold a title and a summary.`);
    if (i.lines !== undefined && (!Array.isArray(i.lines) || i.lines.some((l) => !l || !str(l.id) || !l.id || !str(l.line) || !optStr(l.title) || !Array.isArray(l.changes)))) out.push(`${at}: lines must be a list of {id, changes, line, title}.`);
  }
  if (p.results !== undefined) {
    if (!Array.isArray(p.results)) out.push('results must be a list.');
    else
      for (const r of p.results) {
        if (!r || !str(r.id) || !str(r.title) || !str(r.summary)) out.push('Each result needs an id, a title and a summary.');
        else if (r.docs !== undefined && (!r.docs || typeof r.docs !== 'object' || Array.isArray(r.docs))) out.push('Result docs must be an object of sections.');
        else if (!optStr(r.replacement)) out.push('A result replacement must be text.');
        else if (r.lines !== undefined && (!Array.isArray(r.lines) || r.lines.some((l) => !l || !str(l.id) || !str(l.line) || !optStr(l.title)))) out.push('Result lines must be a list of {id, line, title}.');
      }
  }
  return out;
}

/** The session in a file's text, or undefined when it is not a valid session. */
export function parsePendingDrafts(text: string | null | undefined): PendingDrafts | undefined {
  if (!text) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  return validatePendingDrafts(json).length ? undefined : (json as PendingDrafts);
}

export function serializePendingDrafts(p: PendingDrafts): string {
  return `${JSON.stringify(p, null, 2)}\n`;
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
  // A sentence ends at . ! or ? followed by a space or the end: a dot inside a token path (tag.bg) is not an end.
  const parts = t.match(/.+?(?:[.!?]+(?=\s|$)|$)/g) ?? [t];
  let out = parts.slice(0, DRAFT_SUMMARY_SENTENCES).map((s) => s.trim()).join(' ');
  if (out.length > SUMMARY_MAX) out = `${clip(out, SUMMARY_MAX)}.`;
  return out;
}

/**
 * Title and summary kept to the contract: em dashes removed, title one line of at most 70 characters with no
 * trailing period, summary at most 3 sentences. Both may come back empty.
 */
export function sanitizeDraftText(raw: { title?: unknown; summary?: unknown }): DraftText {
  const title = typeof raw.title === 'string' ? clip(cleanDraftText(raw.title), DRAFT_TITLE_MAX) : '';
  const summary = typeof raw.summary === 'string' ? sentences(cleanDraftText(raw.summary)) : '';
  return { title, summary };
}

/** What a writer (bridge_write_drafts) sends for one item, before sanitizing. */
export interface DraftResultInput {
  id: string;
  title?: unknown;
  summary?: unknown;
  lines?: unknown;
  /** Docs items: the sections written (sections task). */
  docs?: unknown;
  /** Docs items: the rewritten passage (selection task). */
  replacement?: unknown;
}

/** The docs part of a result for a docs item, sanitized to its task. Throws when it holds nothing the task asked for. */
export function sanitizeDocsResult(item: DraftItem, r: DraftResultInput): Pick<DraftResult, 'docs' | 'replacement' | 'checked'> {
  const task = item.docs!.task;
  if (task.kind === 'selection') {
    const raw = r.replacement ?? (r.docs && typeof r.docs === 'object' ? (r.docs as Record<string, unknown>)[task.key] : undefined);
    const replacement = sanitizeDocsReplacement(raw);
    if (!replacement) throw new Error(`Item "${item.id}" asks to rewrite a passage of ${task.key}: send {"id": "${item.id}", "replacement": "..."}.`);
    return { replacement };
  }
  try {
    const { sections, checked } = docsSectionsAnswer(task, r.docs ?? {});
    return { docs: sections, checked };
  } catch {
    throw new Error(`Item "${item.id}" asks for the sections ${docsTaskKeys(task).join(', ')}: send {"id": "${item.id}", "docs": {${task.keys.map((k) => `"${k}": ...`).join(', ')}}} in the shapes of its prompt.`);
  }
}

/**
 * The change lines of a result kept to the contract: known line ids only (throws on an unknown one), one sentence of
 * at most 120 characters each, empty ones dropped, the last one per id kept.
 */
export function sanitizeResultLines(item: Pick<DraftItem, 'id' | 'lines'>, raw: unknown): DraftResultLine[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`lines for "${item.id}" must be a list of {"id", "line", "title"}.`);
  const known = new Set((item.lines ?? []).map((l) => l.id));
  const out = new Map<string, DraftResultLine>();
  for (const l of raw as { id?: unknown; line?: unknown; title?: unknown }[]) {
    const id = typeof l?.id === 'string' ? l.id : '';
    if (!known.has(id)) throw new Error(`Item "${item.id}" has no change line "${id}".${known.size ? ` Use the line ids from bridge_pending_drafts: ${[...known].join(', ')}.` : ' It lists no lines: leave lines out.'}`);
    const line = sanitizeDraftLine(l.line);
    const title = sanitizeDraftTitle(l.title);
    if (line || title) out.set(id, { id, line, ...(title ? { title } : {}) });
  }
  return [...out.values()];
}

/** A request title kept to the contract: one line, no em dash, sentence case, at most 70 characters, no trailing period. */
export function sanitizeDraftTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = clip(cleanDraftText(raw.replace(/[\r\n]+/g, ' ')), DRAFT_TITLE_MAX);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The session with these results added (a result for the same item replaces the earlier one). Results are sanitized.
 * Throws on an unknown item id or an empty result. Status is "drafted" once every item has a result.
 */
export function mergeDraftResults(p: PendingDrafts, results: DraftResultInput[], at: Date = new Date()): PendingDrafts {
  const ids = new Set(p.items.map((i) => i.id));
  const next = new Map((p.results ?? []).map((r) => [r.id, r]));
  for (const r of results) {
    if (!ids.has(r.id)) throw new Error(`Session ${p.sessionId} has no item "${r.id}". Use the ids from bridge_pending_drafts: ${[...ids].join(', ')}.`);
    const item = p.items.find((i) => i.id === r.id)!;
    if (item.scope === 'docs') {
      next.set(r.id, { id: r.id, title: '', summary: '', ...sanitizeDocsResult(item, r), by: 'claude', at: at.toISOString() });
      continue;
    }
    const clean = sanitizeDraftText(r);
    const lines = sanitizeResultLines(item, r.lines);
    if (!clean.title && !clean.summary && !lines.length) throw new Error(`The result for "${r.id}" has no title and no summary, and no line.`);
    next.set(r.id, { id: r.id, title: clean.title, summary: clean.summary, ...(lines.length ? { lines } : {}), by: 'claude', at: at.toISOString() });
  }
  const merged = p.items.map((i) => next.get(i.id)).filter((r): r is DraftResult => !!r);
  return { ...p, results: merged, status: merged.length === p.items.length ? 'drafted' : 'pending' };
}

/** The Markdown brief of one item, for Claude: what to write, the facts, the starting draft. */
export function draftItemBrief(i: DraftItem): string {
  if (i.scope === 'docs' && i.docs) {
    const t = i.docs.task;
    const check = t.kind === 'sections' ? (t.check ?? []).filter((k) => t.keys.includes(k)) : [];
    const write = t.kind === 'sections' ? t.keys.filter((k) => !check.includes(k)) : [];
    const what =
      t.kind === 'selection'
        ? `rewrite one passage of the ${t.key} section (${t.mode}), answer with "replacement"`
        : [
            write.length ? `${t.rewrite ? 'rewrite' : 'write'} the sections ${write.join(', ')}` : '',
            check.length ? `check the sections ${check.join(', ')} against the code and return one only when something in it is no longer true (leave accurate ones out)` : '',
          ]
            .filter(Boolean)
            .join('; ') + ', answer with "docs"';
    return [`Item ${i.id}: component docs${i.component ? ` of ${i.component}` : ''} from Bridge Studio (${i.docs.path ?? i.docs.slug}): ${what}.`, '', i.docs.prompt].join('\n');
  }
  const kind = i.kind ? REQUEST_KINDS.find((k) => k.value === i.kind)?.label : undefined;
  const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines: string[] = [`Item ${i.id}: ${i.scope === 'request' ? 'a component change request (a GitHub issue developers implement)' : 'the description of a pull request with design token (variable) edits from Figma'}.`];
  if (i.component) lines.push(`Component: ${i.component}`);
  if (kind) lines.push(`Kind: ${kind}`);
  if (i.components?.length) lines.push(`Components with a change request: ${i.components.join(', ')}`);
  if (i.changes.length) lines.push('', '| What | Now | In Figma |', '| --- | --- | --- |', ...i.changes.map((c) => `| ${cell(c.field)} | ${cell(c.before) || 'none'} | ${cell(c.after) || 'removed'} |`));
  if (i.variables?.length) lines.push('', '| Token | Now | In Figma |', '| --- | --- | --- |', ...i.variables.map((v) => `| ${cell(v.path)} | ${cell(v.before) || 'none'} | ${cell(v.after) || 'removed'} |`));
  if (!i.changes.length && !i.variables?.length && !i.lines?.length) lines.push('', 'No change detected: rely on the notes and the images.');
  if (i.draft.title || i.draft.summary) lines.push('', 'Starting draft, written from the changes only:', `Title: ${i.draft.title}`, `Summary: ${i.draft.summary}`);
  if (i.notes?.trim()) lines.push('', 'The designer\'s notes (keep their intent):', i.notes.trim());
  if (i.lines?.length) {
    lines.push('', `Change lines to write (one sentence each, at most ${DRAFT_LINE_MAX} characters, from the before and after images), each with the title of its request (at most ${DRAFT_TITLE_MAX} characters):`);
    for (const l of i.lines) {
      lines.push(`- Line ${l.id}${l.component ? `, ${l.component}` : ''}${l.kind ? ` (${REQUEST_KINDS.find((k) => k.value === l.kind)?.label ?? l.kind})` : ''}. Starting line: ${l.line || '(none)'}${l.title ? `. Starting title: ${l.title}` : ''}`);
      for (const c of l.changes) lines.push(`  - ${c.field}: ${c.before || 'none'} -> ${c.after || 'removed'}`);
    }
  }
  if (i.images?.length) lines.push('', `Images: ${i.images.map((m) => `${m.label}${m.line ? ` (line ${m.line})` : ''} ${m.url}`).join(', ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// GitHub: read and write sessions on the requests branch

type DraftClient = Pick<GitHubClient, 'getFile' | 'putFile' | 'deleteFile' | 'listDirectory'>;

const isConflict = (err: unknown) => err instanceof GitHubError ? err.status === 409 || (err.status === 422 && /sha/i.test(`${err.detail ?? ''} ${err.message}`)) : (err as { status?: number })?.status === 409;

/** Writes a new session file on the requests branch (the branch must exist). Returns the session. */
export async function createPendingDrafts(client: DraftClient, p: PendingDrafts, branch = REQUESTS_BRANCH): Promise<PendingDrafts> {
  const problems = validatePendingDrafts(p);
  if (problems.length) throw new Error(problems.join(' '));
  await client.putFile({ path: draftSessionPath(p.sessionId), content: serializePendingDrafts(p), branch, message: `Bridge drafts: ${p.items.length === 1 ? '1 item' : `${p.items.length} items`} waiting for Claude` });
  return p;
}

/** One session and its file sha, or undefined when the file is gone (sent, cancelled) or not a session. */
export async function readPendingDrafts(client: Pick<GitHubClient, 'getFile'>, sessionId: string, branch = REQUESTS_BRANCH): Promise<{ drafts: PendingDrafts; sha: string } | undefined> {
  const f = await client.getFile(draftSessionPath(sessionId), branch);
  const drafts = parsePendingDrafts(f?.text);
  return f && drafts ? { drafts, sha: f.sha } : undefined;
}

/** Every valid session on the requests branch, newest first. Unreadable files are skipped. */
export async function listPendingDrafts(client: Pick<GitHubClient, 'getFile' | 'listDirectory'>, opts: { status?: DraftSessionStatus | 'all'; branch?: string } = {}): Promise<PendingDrafts[]> {
  const branch = opts.branch ?? REQUESTS_BRANCH;
  const entries = (await client.listDirectory(DRAFTS_DIR, branch)).filter((e) => e.type === 'file' && /\.json$/.test(e.name));
  const out: PendingDrafts[] = [];
  for (const e of entries) {
    const id = e.name.replace(/\.json$/, '');
    if (!isDraftSessionId(id)) continue;
    const r = await readPendingDrafts(client, id, branch).catch(() => undefined);
    if (r && r.drafts.sessionId === id) out.push(r.drafts);
  }
  const status = opts.status ?? 'all';
  return out.filter((p) => status === 'all' || p.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Read, change and write a session with its sha; when someone else wrote it in between (409), read it again and
 * retry, up to `attempts` times. Throws when the session does not exist.
 */
export async function updatePendingDrafts(
  client: DraftClient,
  sessionId: string,
  change: (p: PendingDrafts) => PendingDrafts,
  opts: { branch?: string; attempts?: number; message?: string } = {},
): Promise<PendingDrafts> {
  const branch = opts.branch ?? REQUESTS_BRANCH;
  const attempts = Math.max(1, opts.attempts ?? 3);
  for (let attempt = 1; ; attempt++) {
    const cur = await readPendingDrafts(client, sessionId, branch);
    if (!cur) throw new Error(`No pending drafts for session ${sessionId}: it was sent or cancelled in Figma. Call bridge_pending_drafts for the current ones.`);
    const next = change(cur.drafts);
    try {
      await client.putFile({ path: draftSessionPath(sessionId), content: serializePendingDrafts(next), branch, message: opts.message ?? 'Bridge drafts: update', sha: cur.sha });
      return next;
    } catch (err) {
      if (attempt >= attempts || !isConflict(err)) throw err;
    }
  }
}

/** Writes Claude's results into a session (sanitized, merged, status "drafted" when complete), retrying on 409. */
export function writeDraftResults(client: DraftClient, sessionId: string, results: DraftResultInput[], opts: { branch?: string; now?: Date; attempts?: number } = {}): Promise<PendingDrafts> {
  return updatePendingDrafts(client, sessionId, (p) => mergeDraftResults(p, results, opts.now), {
    ...opts,
    message: `Bridge drafts: ${results.length === 1 ? '1 text' : `${results.length} texts`} drafted by Claude`,
  });
}

/**
 * Removes a session once it was sent or cancelled: its file, then its images (best effort). Returns false when it was
 * already gone.
 */
export async function deletePendingDrafts(client: DraftClient, sessionId: string, opts: { branch?: string } = {}): Promise<boolean> {
  const branch = opts.branch ?? REQUESTS_BRANCH;
  const path = draftSessionPath(sessionId);
  const f = await client.getFile(path, branch);
  if (!f) return false;
  await client.deleteFile({ path, branch, message: 'Bridge drafts: done', sha: f.sha });
  const images = await client.listDirectory(`${DRAFTS_DIR}/${sessionId}`, branch).catch(() => []);
  for (const img of images.filter((e) => e.type === 'file')) {
    await client.deleteFile({ path: img.path, branch, message: 'Bridge drafts: done', sha: img.sha }).catch(() => undefined);
  }
  return true;
}

/** Creates the requests branch from the head of `baseBranch` when it is missing. Never moves an existing branch. */
export async function ensureRequestsBranch(client: Pick<GitHubClient, 'getBranchSha' | 'createBranch'>, baseBranch: string): Promise<void> {
  if (await client.getBranchSha(REQUESTS_BRANCH)) return;
  const head = await client.getBranchSha(baseBranch);
  if (!head) throw new Error(`Branch "${baseBranch}" was not found, so the ${REQUESTS_BRANCH} branch cannot start from it.`);
  await client.createBranch(REQUESTS_BRANCH, head);
}

export interface DocsDraftSessionInput {
  component: string;
  slug: string;
  path?: string | undefined;
  task: DocsDraftTask;
  prompt: string;
  /** Branch the requests branch starts from when it does not exist yet. */
  baseBranch: string;
  now?: Date | undefined;
  random?: (() => number) | undefined;
}

/**
 * Bridge Studio asks the user's own Claude for component docs: one docs item in a new session (source "studio") on
 * the requests branch, created from `baseBranch` when missing. Returns the session to poll.
 */
export async function createDocsDraftSession(
  client: Pick<GitHubClient, 'getBranchSha' | 'createBranch' | 'getFile' | 'putFile' | 'deleteFile' | 'listDirectory'>,
  input: DocsDraftSessionInput,
): Promise<PendingDrafts> {
  await ensureRequestsBranch(client, input.baseBranch);
  const what = input.task.kind === 'selection' ? `Rewrite a passage of ${input.task.key}` : `${input.task.rewrite ? 'Rewrite' : 'Write'} ${input.task.keys.join(', ')}`;
  const item: DraftItem = {
    id: 'docs-1',
    scope: 'docs',
    component: input.component,
    changes: [],
    draft: { title: `${input.component} docs`, summary: what },
    docs: { slug: input.slug, ...(input.path ? { path: input.path } : {}), task: input.task, prompt: input.prompt },
  };
  return createPendingDrafts(client, composePendingDrafts({ items: [item], source: 'studio', now: input.now, random: input.random }));
}

// ---------------------------------------------------------------------------------------------
// Polling: the plugin and Studio read the session until Claude answers

export const DRAFT_POLL_INTERVAL_MS = 5_000;
export const DRAFT_POLL_TIMEOUT_MS = 10 * 60_000;

export interface DraftPollerOptions {
  client: Pick<GitHubClient, 'getFile'>;
  sessionId: string;
  intervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((handle: unknown) => void) | undefined;
  /** Claude answered every item. Polling has stopped. */
  onResults: (results: DraftResult[], drafts: PendingDrafts) => void;
  /** No answer within the timeout. Polling has stopped; start() polls again. */
  onTimeout: () => void;
  /** The file is gone (sent or cancelled elsewhere). Polling has stopped. */
  onGone?: (() => void) | undefined;
  /** A read failed; polling goes on. */
  onError?: ((message: string) => void) | undefined;
}

/** Reads the session every 5 seconds until Claude answers, the file goes away, or 10 minutes pass. */
export class DraftPoller {
  private handle: unknown;
  private startedAt = 0;
  private running = false;
  private busy = false;

  constructor(private readonly o: DraftPollerOptions) {}

  get active(): boolean {
    return this.running;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private schedule(): void {
    const set = this.o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.handle = set(() => void this.tick(), this.o.intervalMs ?? DRAFT_POLL_INTERVAL_MS);
  }

  /** Starts (or restarts, after a timeout) polling; the timeout counts from now. */
  start(): void {
    this.stop();
    this.running = true;
    this.startedAt = this.now();
    this.schedule();
  }

  stop(): void {
    if (this.handle !== undefined) (this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.handle);
    this.handle = undefined;
    this.running = false;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    this.handle = undefined;
    const done = await this.check();
    if (done || !this.running) return;
    if (this.now() - this.startedAt >= (this.o.timeoutMs ?? DRAFT_POLL_TIMEOUT_MS)) {
      this.stop();
      this.o.onTimeout();
      return;
    }
    this.schedule();
  }

  /** Reads the file once. True when polling is over (answered or gone). */
  async check(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const cur = await readPendingDrafts(this.o.client, this.o.sessionId);
      if (!cur) {
        this.stop();
        this.o.onGone?.();
        return true;
      }
      if (cur.drafts.status === 'drafted' && cur.drafts.results?.length) {
        this.stop();
        this.o.onResults(cur.drafts.results, cur.drafts);
        return true;
      }
      return false;
    } catch (err) {
      this.o.onError?.(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this.busy = false;
    }
  }
}
