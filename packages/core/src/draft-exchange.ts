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
// Writers update with the file sha (optimistic concurrency) and retry on 409. Pure helpers plus a few GitHubClient
// helpers: no DOM, no figma.*, no Node-only API.

import { cleanDraftText, type DraftText } from './change-drafts';
import { GitHubError, type GitHubClient } from './github-client';
import { REQUESTS_BRANCH, type RequestChange, type RequestKind, REQUEST_KINDS } from './requests';

export const DRAFT_EXCHANGE_VERSION = 1;
/** Folder of pending draft sessions on the requests branch. */
export const DRAFTS_DIR = '.bridge/drafts';
/** What the designer says to their Claude. */
export const DRAFT_PHRASE = 'Draft my Bridge changes';
export const DRAFT_TITLE_MAX = 70;
export const DRAFT_SUMMARY_SENTENCES = 3;
const SUMMARY_MAX = 600;

export type DraftScope = 'request' | 'push';
export type DraftSessionStatus = 'pending' | 'drafted';

export interface DraftImage {
  label: 'before' | 'after';
  /** Public URL on the requests branch (github.com/<repo>/blob/bridge-requests/<path>?raw=true). */
  url: string;
  /** Repo path on the requests branch, so tools can read it with the token. */
  path?: string | undefined;
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
}

export interface DraftResult {
  id: string;
  title: string;
  summary: string;
  by: 'claude';
  at: string;
}

export interface PendingDrafts {
  version: 1;
  sessionId: string;
  createdAt: string;
  status: DraftSessionStatus;
  source: 'figma';
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
];

export const DRAFT_OUTPUT_CONTRACT = [
  `Call bridge_write_drafts once per session with {"sessionId": "...", "results": [{"id": "<item id>", "title": "...", "summary": "..."}]}, one result per item.`,
  `title: one line, at most ${DRAFT_TITLE_MAX} characters, no trailing period.`,
  `summary: at most ${DRAFT_SUMMARY_SENTENCES} sentences, plain text.`,
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
    source: 'figma',
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
  if (p.source !== 'figma') out.push('source must be "figma".');
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
    if (i.scope !== 'request' && i.scope !== 'push') out.push(`${at}: scope must be "request" or "push".`);
    if (!optStr(i.component)) out.push(`${at}: component must be text.`);
    if (i.kind !== undefined && !KINDS.has(i.kind)) out.push(`${at}: unknown kind "${String(i.kind)}".`);
    if (!Array.isArray(i.changes) || i.changes.some((c) => !c || !str(c.field) || !optStr(c.before) || !optStr(c.after))) out.push(`${at}: changes must be a list of {field, before, after}.`);
    if (i.variables !== undefined && (!Array.isArray(i.variables) || i.variables.some((v) => !v || !str(v.path)))) out.push(`${at}: variables must be a list of {path, before, after}.`);
    if (i.variables !== undefined && i.scope !== 'push') out.push(`${at}: only a push item has variables.`);
    if (i.images !== undefined && (!Array.isArray(i.images) || i.images.some((m) => !m || (m.label !== 'before' && m.label !== 'after') || !str(m.url)))) out.push(`${at}: images must be a list of {label: before or after, url}.`);
    if (!i.draft || !str(i.draft.title) || !str(i.draft.summary)) out.push(`${at}: draft must hold a title and a summary.`);
  }
  if (p.results !== undefined) {
    if (!Array.isArray(p.results)) out.push('results must be a list.');
    else for (const r of p.results) if (!r || !str(r.id) || !str(r.title) || !str(r.summary)) out.push('Each result needs an id, a title and a summary.');
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
  const parts = t.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [t];
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

/**
 * The session with these results added (a result for the same item replaces the earlier one). Results are sanitized.
 * Throws on an unknown item id or an empty result. Status is "drafted" once every item has a result.
 */
export function mergeDraftResults(p: PendingDrafts, results: { id: string; title?: unknown; summary?: unknown }[], at: Date = new Date()): PendingDrafts {
  const ids = new Set(p.items.map((i) => i.id));
  const next = new Map((p.results ?? []).map((r) => [r.id, r]));
  for (const r of results) {
    if (!ids.has(r.id)) throw new Error(`Session ${p.sessionId} has no item "${r.id}". Use the ids from bridge_pending_drafts: ${[...ids].join(', ')}.`);
    const clean = sanitizeDraftText(r);
    if (!clean.title && !clean.summary) throw new Error(`The result for "${r.id}" has no title and no summary.`);
    next.set(r.id, { id: r.id, title: clean.title, summary: clean.summary, by: 'claude', at: at.toISOString() });
  }
  const merged = p.items.map((i) => next.get(i.id)).filter((r): r is DraftResult => !!r);
  return { ...p, results: merged, status: merged.length === p.items.length ? 'drafted' : 'pending' };
}

/** The Markdown brief of one item, for Claude: what to write, the facts, the starting draft. */
export function draftItemBrief(i: DraftItem): string {
  const kind = i.kind ? REQUEST_KINDS.find((k) => k.value === i.kind)?.label : undefined;
  const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines: string[] = [`Item ${i.id}: ${i.scope === 'request' ? 'a component change request (a GitHub issue developers implement)' : 'the description of a pull request with design token (variable) edits from Figma'}.`];
  if (i.component) lines.push(`Component: ${i.component}`);
  if (kind) lines.push(`Kind: ${kind}`);
  if (i.components?.length) lines.push(`Components with a change request: ${i.components.join(', ')}`);
  if (i.changes.length) lines.push('', '| What | Now | In Figma |', '| --- | --- | --- |', ...i.changes.map((c) => `| ${cell(c.field)} | ${cell(c.before) || 'none'} | ${cell(c.after) || 'removed'} |`));
  if (i.variables?.length) lines.push('', '| Token | Now | In Figma |', '| --- | --- | --- |', ...i.variables.map((v) => `| ${cell(v.path)} | ${cell(v.before) || 'none'} | ${cell(v.after) || 'removed'} |`));
  if (!i.changes.length && !i.variables?.length) lines.push('', 'No change detected: rely on the notes and the images.');
  if (i.draft.title || i.draft.summary) lines.push('', 'Starting draft, written from the changes only:', `Title: ${i.draft.title}`, `Summary: ${i.draft.summary}`);
  if (i.notes?.trim()) lines.push('', 'The designer\'s notes (keep their intent):', i.notes.trim());
  if (i.images?.length) lines.push('', `Images: ${i.images.map((m) => `${m.label} ${m.url}`).join(', ')}`);
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
export function writeDraftResults(client: DraftClient, sessionId: string, results: { id: string; title?: unknown; summary?: unknown }[], opts: { branch?: string; now?: Date; attempts?: number } = {}): Promise<PendingDrafts> {
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
