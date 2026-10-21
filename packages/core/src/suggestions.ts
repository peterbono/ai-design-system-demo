// Suggestions: a change Bridge files as a GitHub issue instead of a branch, so a design system owner can work with
// read access to the code. Owners approve it on the issue (suggestion-review.ts) and a developer applies it with their
// own access (`bridge apply <n>`). It follows the request conventions (requests.ts): a readable Markdown body, labels
// tools filter on, status from the issue state and the pull requests that close it. The difference is an exact,
// machine-applicable payload: a versioned JSON block (schema "bridge.suggestion/1") in a collapsed section at the end
// of the body, with the sha256 of its canonical form in a marker, so an edit by hand is detected. Token changes are
// stored as edits (paths and values, re-applied on the current tokens), other files as whole contents with the git
// blob sha before and after. Large file contents move to continuation comments ("parts") to fit GitHub's limit.
// Pure: no I/O, runs in a browser, a plugin sandbox or Node. GitHub calls live in suggestions-github.ts.

import { CONFIG_FILE, tokensPath, type BridgeConfig } from './config';
import { EXPLORATION_LABEL } from './explorations';
import { FROM_FIGMA_LABEL } from './figma-push';
import type { LayeredChange } from './layered-review';
import { NEEDED_BY_LABEL, type NeededBy } from './prod-branch';
import type { RequestSource } from './requests';
import type { TokenEdit } from './token-edits';

export const SUGGESTION_SCHEMA = 'bridge.suggestion/1';
/** Every suggestion issue carries this label; tools list suggestions by it. */
export const SUGGESTION_LABEL = 'bridge-suggestion';

export type SuggestionKind = 'token-change' | 'docs' | 'component-spec' | 'brand' | 'revert' | 'config';
export const SUGGESTION_KINDS: readonly SuggestionKind[] = ['token-change', 'docs', 'component-spec', 'brand', 'revert', 'config'];

/** The states a suggestion label records, exactly one at a time while the issue is open. */
export type SuggestionState = 'needs-review' | 'changes-requested' | 'approved' | 'applying';
/** Where a suggestion stands (suggestionStatus). */
export type SuggestionStatus = SuggestionState | 'applied' | 'declined' | 'outdated';

export const SUGGESTION_STATE_LABELS: Record<SuggestionState, string> = {
  'needs-review': 'suggestion: needs review',
  'changes-requested': 'suggestion: changes requested',
  approved: 'suggestion: approved',
  applying: 'suggestion: applying',
};

export const SUGGESTION_STATUS_LABEL: Record<SuggestionStatus, string> = {
  'needs-review': 'Needs review',
  'changes-requested': 'Changes requested',
  approved: 'Approved, ready to apply',
  applying: 'Being applied',
  applied: 'Applied',
  declined: 'Declined',
  outdated: 'Outdated',
};

/** A whole-file result: the git blob sha at `base` (null: a new file), after (null: deleted), and the new content. */
export interface SuggestionFile {
  path: string;
  beforeSha: string | null;
  afterSha: string | null;
  /** The new text; null for a deleted file. Absent from the body when it moved to a continuation comment (`part`). */
  content?: string | null | undefined;
  /** Continuation comment (1-based) where the content starts. Transport only: not part of the payload sha. */
  part?: number | undefined;
}

export interface SuggestionContrastCheck {
  pair: string;
  mode?: string | undefined;
  before: number;
  after: number;
  min: number;
  pass: boolean;
}

export type SuggestionTokenChange = Pick<LayeredChange, 'kind' | 'path' | 'from' | 'file' | 'before' | 'after' | 'beforeCss' | 'afterCss'>;

export interface SuggestionPayloadV1 {
  schema: typeof SUGGESTION_SCHEMA;
  kind: SuggestionKind;
  title: string;
  summary: string;
  source: RequestSource;
  /** GitHub login. */
  suggestedBy?: string | undefined;
  /** ISO date. */
  createdAt: string;
  /** Default branch and the commit the plan was computed on. */
  base: { ref: string; sha: string };
  tier: { tier: 1 | 2 | 3; bump: 'patch' | 'minor' | 'major' };
  /** Semantic token ops, applied with applyTokenEdits on the current token set, never as a text patch. */
  tokens?: { edits: TokenEdit[]; changes: SuggestionTokenChange[] } | undefined;
  /** docs.json edits: the component and the cleaned docs object. */
  docs?: { component: string; path: string; after: unknown }[] | undefined;
  /** Figma component push spec, for Claude or a developer to implement. */
  componentSpec?: { component: string; specPath: string; spec: unknown; brief: string } | undefined;
  /** Whole-file results for everything else (changeset, brand files, revert, config). */
  files?: SuggestionFile[] | undefined;
  checks: {
    newErrors: number;
    contrast: SuggestionContrastCheck[];
    /** The planner's `blocked` sentence at creation; a suggestion is never created when it is set. */
    blocked: string | null;
    impact: number;
  };
  links?:
    | {
        neededBy?: NeededBy | undefined;
        figma?: { fileKey?: string | undefined; nodeId?: string | undefined; url?: string | undefined } | undefined;
        /** explore/<slug> */
        exploration?: string | undefined;
        /** A previous suggestion this one replaces. */
        supersedes?: number | undefined;
      }
    | undefined;
  previews?: { label: string; url: string }[] | undefined;
}

/** GitHub caps an issue body and a comment at 65,536 characters. The budgets below keep every write under it. */
export const SUGGESTION_LIMITS = {
  body: 65_536,
  /** The readable part of the body (tables are cut with "and N more"). */
  human: 12_000,
  /** The JSON block in the body. */
  inline: 48_000,
  /** The JSON block of one continuation comment. */
  part: 60_000,
  /** Continuation comments at most (about 480 KB of file contents). */
  maxParts: 8,
} as const;

export type SuggestionErrorCode = 'too-large' | 'invalid';

export class SuggestionError extends Error {
  constructor(
    readonly code: SuggestionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SuggestionError';
  }
}

export const SUGGESTION_TOO_LARGE = 'Too large for a suggestion: split it, or ask a developer to open it directly.';

// ---------------------------------------------------------------------------------------------------------------
// Hashes: sha256 for the payload, git blob sha1 for files. Pure TypeScript so it runs where crypto.subtle does not
// (Figma plugin sandbox) and stays synchronous.

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const hex = (words: number[]) => words.map((w) => (w >>> 0).toString(16).padStart(8, '0')).join('');

function padded(bytes: Uint8Array): DataView {
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(len / 0x20000000), false);
  view.setUint32(total - 4, (len * 8) >>> 0, false);
  return view;
}

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** sha256 of a string's UTF-8 bytes, as 64 hex characters. */
export function sha256Hex(text: string): string {
  const view = padded(utf8(text));
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i]! + w[i]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
    h[5] = (h[5]! + f) | 0;
    h[6] = (h[6]! + g) | 0;
    h[7] = (h[7]! + hh) | 0;
  }
  return hex(h);
}

function sha1Bytes(bytes: Uint8Array): string {
  const view = padded(bytes);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
  }
  return hex(h);
}

/** The git blob sha of a text file (what `git hash-object` and the GitHub contents API return). */
export function gitBlobSha(text: string): string {
  const body = utf8(text);
  const head = utf8(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  return sha1Bytes(all);
}

// ---------------------------------------------------------------------------------------------------------------
// Canonical form and payload sha

/** JSON with object keys sorted and no spaces; `undefined` members dropped, as JSON.stringify does. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : sortKeys(x)));
  if (v && typeof v === 'object' && !((v as { toJSON?: unknown }).toJSON instanceof Function)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/** The payload without transport fields (`files[].part`), the form its sha is computed on. */
function shaForm(p: SuggestionPayloadV1): SuggestionPayloadV1 {
  if (!p.files) return p;
  return { ...p, files: p.files.map(({ part: _part, ...f }) => f) };
}

/** sha256 of the payload's canonical JSON: what approvals bind to and what the marker records. */
export function suggestionPayloadSha(p: SuggestionPayloadV1): string {
  return sha256Hex(canonicalJson(shaForm(p)));
}

// ---------------------------------------------------------------------------------------------------------------
// Title and labels

const KIND_SUBJECT: Record<SuggestionKind, string> = {
  'token-change': 'Tokens',
  docs: 'Docs',
  'component-spec': 'Component',
  brand: 'Brand',
  revert: 'Revert',
  config: 'Settings',
};

/** Subject of the title: the component for docs and component specs, else the kind ("Tokens", "Brand"). */
export function suggestionSubject(p: Pick<SuggestionPayloadV1, 'kind' | 'docs' | 'componentSpec'>): string {
  if (p.kind === 'component-spec' && p.componentSpec?.component) return p.componentSpec.component;
  if (p.kind === 'docs' && p.docs?.length) {
    const names = [...new Set(p.docs.map((d) => d.component))];
    return names.length === 1 ? names[0]! : KIND_SUBJECT.docs;
  }
  return KIND_SUBJECT[p.kind];
}

/** Issue title, like requests: "Tokens: raise color.action.primary.bg contrast", "Button: docs for the danger tone". */
export function suggestionIssueTitle(p: Pick<SuggestionPayloadV1, 'kind' | 'title' | 'docs' | 'componentSpec'>): string {
  const t = p.title.trim().replace(/\.$/, '');
  return `${suggestionSubject(p)}: ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

/**
 * The labels of a suggestion issue: the list key, kind, source, tier, one state label, then the marks it carries
 * (needed by a product, from Figma, exploration) and the caller's (governance or integrations labels). Labels are a
 * cache for filtering: status is always recomputed from comments and pull requests.
 */
export function suggestionLabels(p: SuggestionPayloadV1, opts: { state?: SuggestionState | undefined; labels?: string[] | undefined } = {}): string[] {
  return [
    ...new Set([
      SUGGESTION_LABEL,
      `suggestion: ${p.kind}`,
      `source: ${p.source}`,
      `tier: ${p.tier.tier}`,
      SUGGESTION_STATE_LABELS[opts.state ?? 'needs-review'],
      ...(p.links?.neededBy ? [NEEDED_BY_LABEL] : []),
      ...(p.links?.figma || p.source === 'figma' ? [FROM_FIGMA_LABEL] : []),
      ...(p.links?.exploration ? [EXPLORATION_LABEL] : []),
      ...(opts.labels ?? []),
    ]),
  ];
}

/** The kind a label set names, when the issue has a `suggestion: <kind>` label. */
export function suggestionKindFromLabels(labels: readonly string[]): SuggestionKind | undefined {
  for (const l of labels) {
    const m = /^suggestion: (.+)$/.exec(l);
    if (m && (SUGGESTION_KINDS as readonly string[]).includes(m[1]!)) return m[1] as SuggestionKind;
  }
  return undefined;
}

/** The state a label set records (the cache), when it has one. */
export function suggestionStateFromLabels(labels: readonly string[]): SuggestionState | undefined {
  return (Object.entries(SUGGESTION_STATE_LABELS) as [SuggestionState, string][]).find(([, l]) => labels.includes(l))?.[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Status

export interface SuggestionStatusInput {
  state: 'open' | 'closed';
  stateReason?: string | null | undefined;
  /** Pull requests whose body closes the issue ("Closes #n"). */
  linkedPrs?: { state: 'open' | 'closed'; merged?: boolean | undefined }[] | undefined;
  /** From the review comments on the current payload sha (suggestionReviewState in suggestion-review.ts). */
  review?: 'needs-review' | 'changes-requested' | 'approved' | undefined;
  /** An "applied" marker comment exists (a developer applied it on a branch, see linkSuggestionPrOnGitHub). */
  applied?: boolean | undefined;
  /** The dry-run apply found a conflict with the current default branch. */
  outdated?: boolean | undefined;
}

/**
 * Where a suggestion stands. Closed: applied when a linked pull request merged or the issue was closed as completed,
 * declined otherwise. Open: applying when a linked pull request is open or an applied marker exists; outdated when the
 * dry run found a conflict; then the review state (changes requested, approved, needs review).
 */
export function suggestionStatus(i: SuggestionStatusInput): SuggestionStatus {
  const prs = i.linkedPrs ?? [];
  if (i.state === 'closed') return prs.some((p) => p.merged) || i.stateReason === 'completed' ? 'applied' : 'declined';
  if (prs.some((p) => p.state === 'open') || i.applied) return 'applying';
  if (i.outdated) return 'outdated';
  return i.review ?? 'needs-review';
}

/** The state label a status keeps on the issue, or null when none should stay (closed, outdated). */
export function suggestionStateLabel(status: SuggestionStatus): string | null {
  return status in SUGGESTION_STATE_LABELS ? SUGGESTION_STATE_LABELS[status as SuggestionState] : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Compose

export interface SuggestionIssue {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  /** Continuation comments to post right after the issue, in order. Empty when everything fits in the body. */
  parts: string[];
  /** sha256 of the payload (canonical JSON, contents included). */
  sha: string;
}

export interface ComposeSuggestionOptions {
  labels?: string[] | undefined;
  assignees?: string[] | undefined;
  state?: SuggestionState | undefined;
  /**
   * Extra Markdown for the readable part, placed after the changes table (for example the risk tier reasons, contrast
   * and impact sections of composeProposalBody). Cut to fit the readable budget.
   */
  details?: string | undefined;
}

const MARK = 'bridge-suggestion';
const PART_SCHEMA = 'bridge.suggestion-part/1';
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
/** Text people wrote, made safe to sit before the payload block (no fake marker, no HTML comment). */
const safeText = (s: string) => s.replace(/<!--/g, '&lt;!--');
const sourceLabel = (s: RequestSource) => (s === 'figma' ? 'Figma' : s === 'studio' ? 'Bridge Studio' : s === 'cli' ? 'the CLI' : 'Claude (MCP)');
const show = (v: unknown): string => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function table(head: string[], rows: string[][], max: number): string[] {
  if (!rows.length) return [];
  const shown = rows.slice(0, max);
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...shown.map((r) => `| ${r.map((c) => cell(c)).join(' | ')} |`),
    ...(rows.length > max ? ['', `and ${rows.length - max} more`] : []),
  ];
}

function changesSection(p: SuggestionPayloadV1, max: number): string[] {
  const out: string[] = [];
  if (p.tokens?.changes.length) {
    const rows = p.tokens.changes.map((c) => [
      `\`${c.path}\`${c.kind === 'renamed' && c.from ? ` (was \`${c.from}\`)` : c.kind === 'added' ? ' (new)' : c.kind === 'removed' ? ' (removed)' : ''}`,
      c.beforeCss ?? show(c.before),
      c.afterCss ?? show(c.after),
    ]);
    out.push(...table(['Token', 'Now', 'Suggested'], rows, max), '');
  } else if (p.tokens?.edits.length) {
    const rows = p.tokens.edits.map((e) => [`\`${e.path}\``, e.op === 'rename' ? `rename to \`${e.newPath ?? ''}\`` : e.op, show(e.value)]);
    out.push(...table(['Token', 'Edit', 'Value'], rows, max), '');
  }
  if (p.docs?.length) out.push(...table(['Component', 'Docs file'], p.docs.map((d) => [d.component, `\`${d.path}\``]), max), '');
  if (p.componentSpec) out.push(`**Component spec:** ${p.componentSpec.component} (\`${p.componentSpec.specPath}\`)`, '');
  if (p.files?.length) {
    const rows = p.files.map((f) => [`\`${f.path}\``, f.beforeSha === null ? 'new' : f.afterSha === null ? 'deleted' : 'changed']);
    out.push(...table(['File', 'Change'], rows, max), '');
  }
  return out;
}

function checksSection(p: SuggestionPayloadV1, max: number): string[] {
  const c = p.checks;
  const failing = c.contrast.filter((x) => !x.pass);
  const rows = [...failing, ...c.contrast.filter((x) => x.pass)].map((x) => [x.pair, x.mode ?? '', x.before.toFixed(2), x.after.toFixed(2), String(x.min), x.pass ? 'pass' : '**fails**']);
  return [
    '## Checks when suggested',
    '',
    `- Token validation: ${c.newErrors ? `**${c.newErrors} new error(s)**` : 'no new errors'}`,
    `- Contrast: ${c.contrast.length ? (failing.length ? `**${failing.length} failing pair(s)**` : `${c.contrast.length} pair(s) checked, all pass`) : 'no pair affected'}`,
    `- Risk tier: ${p.tier.tier} (\`${p.tier.bump}\`), ${p.tier.tier === 1 ? 'one approval' : 'design and tech approval'}`,
    `- Impact: ${c.impact ? `${c.impact} token(s) resolve to a new value` : 'no other token changes value'}`,
    '',
    ...(rows.length ? [...table(['Pair', 'Mode', 'Before', 'After', 'Min', 'Result'], rows, max), ''] : []),
  ];
}

function linksSection(p: SuggestionPayloadV1): string[] {
  const l = p.links ?? {};
  const out: string[] = [];
  if (l.neededBy) out.push(`- Needed by ${l.neededBy.productName}: [#${l.neededBy.pr} ${cell(l.neededBy.title)}](${l.neededBy.url})`);
  if (l.figma?.url) out.push(`- Design: [Open in Figma](${l.figma.url})`);
  if (l.exploration) out.push(`- Exploration: \`${l.exploration}\``);
  if (l.supersedes) out.push(`- Replaces suggestion #${l.supersedes}`);
  for (const v of p.previews ?? []) out.push(`- ${cell(v.label)}: ${v.url}`);
  return out.length ? ['## Previews and links', '', ...out, ''] : [];
}

function humanPart(p: SuggestionPayloadV1, details: string | undefined, max: number): string {
  return [
    `## Suggested change: ${safeText(p.title.trim())}`,
    '',
    safeText(p.summary.trim()),
    '',
    ...changesSection(p, max),
    ...(details?.trim() ? [safeText(details.trim()), ''] : []),
    ...checksSection(p, max),
    ...linksSection(p),
    '## How to apply',
    '',
    '- CLI: `bridge apply <this issue number>` (add `--dry-run` to check it first, `--patch` for a patch file)',
    '- Claude: "Apply Bridge suggestion #<this issue number>" (MCP tool `bridge_apply_suggestion`)',
    '',
    'The pull request that applies it must say `Closes #<this issue number>`, so this suggestion closes when it merges.',
    '',
    `<sub>Suggested from ${sourceLabel(p.source)}${p.suggestedBy ? ` by @${p.suggestedBy.replace(/^@/, '')}` : ''} with Bridge.</sub>`,
  ].join('\n');
}

/** The readable part within the budget: fewer table rows first, then the text cut with a note. */
function fitHuman(p: SuggestionPayloadV1, details: string | undefined): string {
  for (const max of [50, 20, 8, 3]) {
    const h = humanPart(p, details, max);
    if (h.length <= SUGGESTION_LIMITS.human) return h;
  }
  const h = humanPart(p, undefined, 3);
  if (h.length <= SUGGESTION_LIMITS.human) return h;
  const note = '\n\n_The description is cut here: the full change is in the machine-readable block below._';
  return h.slice(0, SUGGESTION_LIMITS.human - note.length) + note;
}

const pretty = (v: unknown) => JSON.stringify(sortKeys(v), null, 2);
/** Indented for people when it fits the body budget, else the compact canonical form. */
const fit = (v: unknown) => {
  const p = pretty(v);
  return p.length <= SUGGESTION_LIMITS.inline ? p : canonicalJson(v);
};
const fenced = (json: string) => ['```json', json, '```'].join('\n');

function payloadBlock(json: string, sha: string, parts: number): string {
  return [
    '<details><summary>Machine-readable change (Bridge suggestion v1)</summary>',
    '',
    `<!-- ${MARK}:v1 sha256=${sha}${parts ? ` parts=${parts}` : ''} -->`,
    fenced(json),
    '',
    '</details>',
  ].join('\n');
}

function partComment(i: number, n: number, json: string): string {
  return [
    `<details><summary>Machine-readable change, part ${i} of ${n} (Bridge suggestion v1)</summary>`,
    '',
    `<!-- ${MARK}:v1 part ${i}/${n} sha256=${sha256Hex(json)} -->`,
    fenced(json),
    '',
    '</details>',
  ].join('\n');
}

/** Where a slice of `s` starting at `from` stops fitting in `budget` characters once JSON-escaped (never splits a surrogate pair). */
function escapedEnd(s: string, from: number, budget: number): number {
  let used = 0;
  let i = from;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    let w = 1;
    let len = 1;
    if (c === 0x22 || c === 0x5c || c === 0x08 || c === 0x0c || c === 0x0a || c === 0x0d || c === 0x09) len = 2;
    else if (c < 0x20) len = 6;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        w = 2;
        len = 2;
      } else len = 6;
    } else if (c >= 0xdc00 && c <= 0xdfff) len = 6;
    if (used + len > budget) break;
    used += len;
    i += w;
  }
  return i;
}

interface PartChunk {
  i: number;
  path: string;
  text: string;
}

/** The suggestion as a GitHub issue: readable Markdown, labels, the payload block, and continuation comments when large. */
export function composeSuggestionIssue(payload: SuggestionPayloadV1, opts: ComposeSuggestionOptions = {}): SuggestionIssue {
  const problems = suggestionShapeProblems(payload);
  if (problems.length) throw new SuggestionError('invalid', problems.join(' '));
  if (payload.checks.blocked) throw new SuggestionError('invalid', `This change cannot be suggested: ${payload.checks.blocked}`);
  const full = shaForm(payload);
  const sha = suggestionPayloadSha(full);
  const human = fitHuman(full, opts.details);
  const base = { title: suggestionIssueTitle(full), labels: suggestionLabels(full, { state: opts.state, labels: opts.labels }), assignees: opts.assignees ?? [], sha };

  const inline = fit(full);
  if (inline.length <= SUGGESTION_LIMITS.inline) {
    return { ...base, body: `${human}\n\n${payloadBlock(inline, sha, 0)}\n`, parts: [] };
  }

  // Too large inline: file contents move to continuation comments, split across them when one file is larger.
  const moved = (full.files ?? []).map((f, i) => ({ f, i })).filter(({ f }) => typeof f.content === 'string' && f.content.length > 0);
  const parts: PartChunk[][] = [];
  const firstPart = new Map<number, number>();
  const partJson = (chunks: PartChunk[], i: number, n: number) => pretty({ schema: PART_SCHEMA, part: i, of: n, files: chunks });
  const emptyOverhead = partJson([], 9, 9).length;
  let cur: PartChunk[] = [];
  let room = SUGGESTION_LIMITS.part - emptyOverhead - 64;
  for (const { f, i } of moved) {
    const text = f.content as string;
    let at = 0;
    while (at < text.length) {
      const entryOverhead = partJson([{ i, path: f.path, text: '' }], 9, 9).length - emptyOverhead + 8;
      if (room - entryOverhead < 256) {
        parts.push(cur);
        cur = [];
        room = SUGGESTION_LIMITS.part - emptyOverhead - 64;
      }
      const end = escapedEnd(text, at, room - entryOverhead);
      if (end === at) throw new SuggestionError('too-large', SUGGESTION_TOO_LARGE);
      if (!firstPart.has(i)) firstPart.set(i, parts.length + 1);
      const chunk = { i, path: f.path, text: text.slice(at, end) };
      cur.push(chunk);
      room -= partJson([chunk], 9, 9).length - emptyOverhead + 8;
      at = end;
    }
  }
  if (cur.length) parts.push(cur);
  if (parts.length > SUGGESTION_LIMITS.maxParts) throw new SuggestionError('too-large', SUGGESTION_TOO_LARGE);
  const skeleton: SuggestionPayloadV1 = {
    ...full,
    files: (full.files ?? []).map((f, i) => {
      if (!firstPart.has(i)) return f;
      const { content: _content, ...rest } = f;
      return { ...rest, part: firstPart.get(i)! };
    }),
  };
  const skeletonJson = fit(skeleton);
  if (skeletonJson.length > SUGGESTION_LIMITS.inline) throw new SuggestionError('too-large', SUGGESTION_TOO_LARGE);
  const n = parts.length;
  const partBodies = parts.map((chunks, k) => {
    const json = partJson(chunks, k + 1, n);
    if (json.length > SUGGESTION_LIMITS.part) throw new SuggestionError('too-large', SUGGESTION_TOO_LARGE);
    return partComment(k + 1, n, json);
  });
  const body = `${human}\n\n${payloadBlock(skeletonJson, sha, n)}\n`;
  if (body.length > SUGGESTION_LIMITS.body || partBodies.some((b) => b.length > SUGGESTION_LIMITS.body)) throw new SuggestionError('too-large', SUGGESTION_TOO_LARGE);
  return { ...base, body, parts: partBodies };
}

// ---------------------------------------------------------------------------------------------------------------
// Parse

export type SuggestionParseFailure = 'no-block' | 'invalid' | 'unsupported-version' | 'missing-part';

export type ParsedSuggestion =
  | {
      ok: true;
      payload: SuggestionPayloadV1;
      /** sha256 of the payload as read now (what approvals bind to). */
      sha: string;
      /** The sha the marker recorded when Bridge wrote it. */
      markedSha: string;
      /** The payload or a part no longer matches what Bridge wrote: someone edited it by hand. */
      edited: boolean;
      /** Continuation comments read. */
      parts: number;
    }
  | { ok: false; reason: SuggestionParseFailure; message: string };

export interface SuggestionCommentInput {
  body: string;
  author?: string | undefined;
}

/** Whether a body carries a suggestion block (any version). */
export function hasSuggestionBlock(body: string | null | undefined): boolean {
  return new RegExp(`^<!-- ${MARK}:v\\d+ sha256=`, 'm').test(body ?? '');
}

/** The first ```json fenced block after `from` in `text`. */
function fencedAfter(text: string, from: number): string | undefined {
  const m = /```json\r?\n([\s\S]*?)\r?\n```/.exec(text.slice(from));
  return m?.[1];
}

const fail = (reason: SuggestionParseFailure, message: string): ParsedSuggestion => ({ ok: false, reason, message });

/**
 * The suggestion in an issue body (plus its continuation comments when it has parts). Checks the schema, reassembles
 * the parts (only comments by the issue author count when `author` is given), recomputes the sha and compares it with
 * the marker: a mismatch sets `edited` (shown, applied only when the developer accepts it).
 */
export function parseSuggestionIssue(body: string | null | undefined, opts: { comments?: SuggestionCommentInput[] | undefined; author?: string | undefined } = {}): ParsedSuggestion {
  const text = body ?? '';
  // On its own line: a marker quoted inside the JSON (a string, never at a line start) or in the text is not one.
  const markers = [...text.matchAll(new RegExp(`^<!-- ${MARK}:v(\\d+) sha256=([0-9a-f]{64})(?: parts=(\\d+))? -->$`, 'gm'))];
  const marker = markers[markers.length - 1];
  if (!marker) return fail('no-block', 'This issue has no Bridge suggestion block.');
  if (marker[1] !== '1') return fail('unsupported-version', `This suggestion uses version ${marker[1]} of the format. Update Bridge to read it.`);
  const json = fencedAfter(text, marker.index! + marker[0].length);
  if (json === undefined) return fail('invalid', 'The suggestion block has no JSON. Someone may have edited it by hand: ask the author to send it again.');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail('invalid', 'The suggestion JSON does not parse. Someone may have edited it by hand: ask the author to send it again.');
  }
  const schema = (raw as { schema?: unknown } | null)?.schema;
  if (typeof schema === 'string' && schema !== SUGGESTION_SCHEMA) {
    const v = /^bridge\.suggestion\/(\d+)$/.exec(schema);
    return v ? fail('unsupported-version', `This suggestion uses ${schema}. Update Bridge to read it.`) : fail('invalid', `"${schema}" is not a Bridge suggestion schema.`);
  }
  const problems = suggestionShapeProblems(raw);
  if (problems.length) return fail('invalid', `The suggestion block is not valid: ${problems.join(' ')}`);
  const payload = raw as SuggestionPayloadV1;
  const markedSha = marker[2]!;
  const expected = marker[3] ? Number(marker[3]) : 0;
  let edited = false;

  if (expected > 0 || payload.files?.some((f) => f.part !== undefined)) {
    const want = Math.max(expected, ...(payload.files ?? []).map((f) => f.part ?? 0));
    const found = new Map<number, PartChunk[]>();
    const author = opts.author?.toLowerCase();
    for (const c of opts.comments ?? []) {
      if (author && c.author && c.author.toLowerCase() !== author) continue;
      const m = new RegExp(`^<!-- ${MARK}:v1 part (\\d+)/(\\d+) sha256=([0-9a-f]{64}) -->$`, 'm').exec(c.body);
      if (!m) continue;
      const i = Number(m[1]);
      if (found.has(i)) continue;
      const pj = fencedAfter(c.body, m.index + m[0].length);
      if (pj === undefined) continue;
      if (sha256Hex(pj) !== m[3]) edited = true;
      try {
        const part = JSON.parse(pj) as { schema?: string; files?: PartChunk[] };
        if (part.schema !== PART_SCHEMA || !Array.isArray(part.files)) continue;
        found.set(i, part.files.filter((x) => x && typeof x.i === 'number' && typeof x.text === 'string'));
      } catch {
        continue;
      }
    }
    for (let i = 1; i <= want; i++) {
      if (!found.has(i)) return fail('missing-part', `This suggestion is incomplete: part ${i} of ${want} is missing. It is still being written, or a comment was deleted: ask the author to send it again.`);
    }
    const files = (payload.files ?? []).map((f, idx) => {
      if (f.part === undefined) return f;
      let content = '';
      for (let i = 1; i <= want; i++) for (const ch of found.get(i)!) if (ch.i === idx && ch.path === f.path) content += ch.text;
      const { part: _part, ...rest } = f;
      return { ...rest, content };
    });
    payload.files = files;
  }
  const sha = suggestionPayloadSha(payload);
  return { ok: true, payload, sha, markedSha, edited: edited || sha !== markedSha, parts: expected };
}

/** Problems with a payload's shape, as sentences. Empty when it is a valid v1 payload. */
export function suggestionShapeProblems(raw: unknown): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['The payload must be a JSON object.'];
  const p = raw as Record<string, unknown>;
  if (p.schema !== SUGGESTION_SCHEMA) out.push(`"schema" must be "${SUGGESTION_SCHEMA}".`);
  if (!(SUGGESTION_KINDS as readonly unknown[]).includes(p.kind)) out.push(`"kind" must be one of ${SUGGESTION_KINDS.join(', ')}.`);
  if (typeof p.title !== 'string' || !p.title.trim()) out.push('"title" must be a sentence.');
  if (typeof p.summary !== 'string') out.push('"summary" must be text.');
  if (!['figma', 'studio', 'cli', 'mcp'].includes(p.source as string)) out.push('"source" must be figma, studio, cli or mcp.');
  if (typeof p.createdAt !== 'string') out.push('"createdAt" must be an ISO date.');
  const base = p.base as { ref?: unknown; sha?: unknown } | undefined;
  if (!base || typeof base.ref !== 'string' || typeof base.sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(base.sha)) out.push('"base" must be { "ref", "sha" } with the commit the change was planned on.');
  const tier = p.tier as { tier?: unknown; bump?: unknown } | undefined;
  if (!tier || ![1, 2, 3].includes(tier.tier as number) || !['patch', 'minor', 'major'].includes(tier.bump as string)) out.push('"tier" must be { "tier": 1, 2 or 3, "bump": patch, minor or major }.');
  const checks = p.checks as Record<string, unknown> | undefined;
  if (!checks || typeof checks.newErrors !== 'number' || !Array.isArray(checks.contrast) || typeof checks.impact !== 'number' || !(checks.blocked === null || typeof checks.blocked === 'string'))
    out.push('"checks" must be { "newErrors", "contrast", "blocked", "impact" }.');
  const tokens = p.tokens as { edits?: unknown; changes?: unknown } | undefined;
  if (tokens !== undefined && (!tokens || !Array.isArray(tokens.edits) || !Array.isArray(tokens.changes))) out.push('"tokens" must be { "edits", "changes" }.');
  if (p.docs !== undefined && !(Array.isArray(p.docs) && p.docs.every((d) => d && typeof d.component === 'string' && typeof d.path === 'string'))) out.push('"docs" must be a list of { "component", "path", "after" }.');
  const spec = p.componentSpec as Record<string, unknown> | undefined;
  if (spec !== undefined && (!spec || typeof spec.component !== 'string' || typeof spec.specPath !== 'string' || typeof spec.brief !== 'string')) out.push('"componentSpec" must be { "component", "specPath", "spec", "brief" }.');
  if (p.files !== undefined) {
    if (!Array.isArray(p.files)) out.push('"files" must be a list.');
    else {
      const seen = new Set<string>();
      for (const f of p.files as Record<string, unknown>[]) {
        const ok =
          f &&
          typeof f.path === 'string' &&
          (f.beforeSha === null || typeof f.beforeSha === 'string') &&
          (f.afterSha === null || typeof f.afterSha === 'string') &&
          (f.content === undefined || f.content === null || typeof f.content === 'string') &&
          (f.part === undefined || (Number.isInteger(f.part) && (f.part as number) >= 1 && (f.part as number) <= SUGGESTION_LIMITS.maxParts));
        if (!ok) {
          out.push('Each of "files" must be { "path", "beforeSha", "afterSha", "content"? }.');
          break;
        }
        if (seen.has(f.path as string)) out.push(`"${f.path}" is listed twice in "files".`);
        seen.add(f.path as string);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Path safety: issues are user-editable input, so every path is checked before anything reads or writes it.

/** Problems with one repo-relative path, as sentences. Empty when it is a plain path inside the repo. */
export function unsafePathProblem(path: string): string | null {
  if (typeof path !== 'string' || !path.length) return 'A path is empty.';
  if (/[\0-\x1f\x7f]/.test(path)) return `"${path.replace(/[\0-\x1f\x7f]/g, '?')}" has control characters.`;
  if (path.includes('\\')) return `"${path}" uses backslashes: paths use forward slashes.`;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.startsWith('~')) return `"${path}" is absolute: paths are relative to the repository root.`;
  const segs = path.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return `"${path}" has an empty, "." or ".." part: paths stay inside the repository.`;
  if (segs.some((s) => s.toLowerCase() === '.git')) return `"${path}" is inside .git.`;
  return null;
}

const under = (path: string, root: string) => {
  const r = root.replace(/\/+$/, '');
  return !r || r === '.' || path === r || path.startsWith(`${r}/`);
};

/** Whether a path is a governance guardrail (a trailing "/" in the list matches a directory). */
export function isGuardrailPath(path: string, guardrails: readonly string[]): boolean {
  return guardrails.some((g) => (g.endsWith('/') ? path.startsWith(g) || path === g.slice(0, -1) : path === g));
}

/** Where each kind may write, repo-relative. Undefined: anywhere (revert), still subject to guardrails. */
export function suggestionAllowedRoots(kind: SuggestionKind, config: Pick<BridgeConfig, 'tokens' | 'changesets' | 'components'>): string[] | undefined {
  const tokenRoot = tokensPath(config as BridgeConfig) || '.';
  const changesets = config.changesets?.dir ? [config.changesets.dir] : [];
  switch (kind) {
    case 'token-change':
      return [tokenRoot, ...changesets];
    case 'docs':
      return [...(config.components?.dir ? [config.components.dir] : []), ...changesets];
    case 'component-spec':
      return ['.bridge/figma'];
    case 'brand':
      return [tokenRoot, ...changesets, CONFIG_FILE];
    case 'config':
      return [CONFIG_FILE];
    case 'revert':
      return undefined;
  }
}

/**
 * Every unsafe path in a payload, as sentences that say what is wrong: not a plain repo-relative path, outside the
 * folders its kind may touch, or a governance guardrail (bridge.config.json is allowed for config and brand only).
 * Token edit files are checked under the tokens root. Symlinks are checked where files are read (apply).
 */
export function suggestionPathProblems(p: SuggestionPayloadV1, config: Pick<BridgeConfig, 'tokens' | 'changesets' | 'components' | 'governance'>): string[] {
  const out: string[] = [];
  const roots = suggestionAllowedRoots(p.kind, config);
  const guardrails = config.governance.guardrails;
  const check = (path: string) => {
    const bad = unsafePathProblem(path);
    if (bad) return out.push(bad);
    if (roots && !roots.some((r) => under(path, r))) return out.push(`"${path}" is outside what a ${p.kind} suggestion may change (${roots.join(', ')}).`);
    const configAllowed = path === CONFIG_FILE && (p.kind === 'config' || p.kind === 'brand');
    if (!configAllowed && isGuardrailPath(path, guardrails)) return out.push(`"${path}" is a guardrail file: change it in a pull request, not a suggestion.`);
    return 0;
  };
  for (const f of p.files ?? []) check(f.path);
  for (const d of p.docs ?? []) check(d.path);
  if (p.componentSpec) check(p.componentSpec.specPath);
  for (const e of p.tokens?.edits ?? []) {
    if (e.file === undefined) continue;
    const bad = unsafePathProblem(e.file);
    if (bad) out.push(bad);
  }
  return [...new Set(out)];
}
