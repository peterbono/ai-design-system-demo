// Product branches and the library: a designer explores a feature with Claude on a product branch (an exploration
// labeled `product: <key>`) built on the real components. What the branch invents outside the library (a colour
// written by hand, a component restyled into a new tone, a component the library lacks) are "missing pieces". Each
// one becomes a library branch linked to the product branch: a token change, a library exploration for a variant, or
// a component request. In suggest mode (config `changes`), a token piece becomes a suggestion (an issue a developer
// applies) and a variant a component request, so nothing needs write access to the code. Once the library ships it,
// the product branch switches to the real version.
//
// Pure and browser safe: the pieces record kept in the product branch body, the "needed by" mark on the library side,
// the status and preview sentences Studio, the CLI and the MCP server all show, and what each piece opens. Finding the
// pieces needs the adoption audit (audit/missing-pieces.ts, Node or a bundler with TypeScript); the GitHub writes are
// in prod-branch-github.ts.

import type { Exploration } from './explorations';
import { slugify } from './pr-composer';
import type { ChangesMode } from './config';
import type { ComponentChangeRequest } from './requests';
import type { SuggestionStatus } from './suggestions';
import type { TokenEdit } from './token-edits';

/** What the library lacks: a token value, a variant of an existing component, or a component. */
export type PieceKind = 'token' | 'variant' | 'component';

/** What a variant changes on its component, in designer words. */
export type PieceAspect = 'tone' | 'shape' | 'size' | 'style';

export interface PieceValue {
  /** Audit category: color, radius, spacing... */
  category: string;
  /** CSS property, when known: background-color, border-radius. */
  property?: string | undefined;
  /** As written: "#c2410c", "10px". */
  value: string;
}

export interface PieceNearest {
  /** Token path of the closest library value: color.feedback.danger.bg. */
  token: string;
  cssVar: string;
  /** Its value, as the audit resolved it. */
  value: string;
  /** How close: high means it looks a lot like it. */
  level: 'exact' | 'high' | 'medium' | 'low';
  /** The word people use for it: "danger" for color.feedback.danger.bg, "control" for radius.control. */
  label: string;
}

export interface MissingPiece {
  /** Stable id inside one product branch: "badge-overdue-tone", "color-c2410c". */
  id: string;
  kind: PieceKind;
  /** Designer title: "Badge: overdue tone", "New color #C2410C", "New component: Timeline". */
  title: string;
  /** One plain sentence: what the branch did and what the library has today. */
  summary: string;
  /** The name the branch gives it ("overdue"), from a class name, the element's text or the component name. */
  name: string;
  /** The library component it extends (variant) or the proposed component name (component). */
  component?: string | undefined;
  aspect?: PieceAspect | undefined;
  values: PieceValue[];
  nearest?: PieceNearest | undefined;
  /** Where the branch writes it, first places only. */
  where: { file: string; line: number }[];
  /** Token pieces: the token the library branch would add (one value, every file the closest token lives in). */
  token?: { path: string; type: string; value: string; files: string[] } | undefined;
}

/** Where the library side of a piece lives. A suggestion is an issue holding the exact token change (suggestions.ts). */
export type LibraryLinkKind = 'token-change' | 'exploration' | 'request' | 'suggestion';

export interface LibraryLink {
  /** The piece id. */
  piece: string;
  kind: LibraryLinkKind;
  /** Pull request number (token change, exploration) or issue number (request, suggestion). */
  number: number;
  url: string;
  title: string;
  /** Head branch of a pull request. */
  branch?: string | undefined;
  /** GitHub login of who opened it, and the AI agent behind it ("claude") when one did. */
  openedBy?: string | undefined;
  agent?: string | undefined;
  /** ISO date. */
  at: string;
}

/** What the product branch body keeps: the last check and the library branches opened for its pieces. */
export interface PiecesRecord {
  /** ISO date of the last check. */
  checkedAt: string;
  /** Head commit the check read. */
  headSha?: string | undefined;
  pieces: MissingPiece[];
  links: LibraryLink[];
  /** Values and elements the library already has (a token or a component to use instead): fixes, not pieces. */
  fixes?: number | undefined;
}

const PIECES_MARK = 'bridge-pieces';
const NEEDED_MARK = 'bridge-needed-by';
const SECTION = '### Missing from the library';

/** Every library branch opened for a product branch carries this label, so lists can find them without the body. */
export const NEEDED_BY_LABEL = 'needed-by-product';

const hiddenJson = (mark: string, data: unknown) => `<!-- ${mark} ${JSON.stringify(data).replace(/-->/g, '--\\u003e')} -->`;
const readHidden = <T>(mark: string, body: string | null | undefined): T | undefined => {
  if (!body) return undefined;
  const m = new RegExp(`<!-- ${mark} (\\{[\\s\\S]*?\\}) -->`).exec(body);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]!) as T;
  } catch {
    return undefined;
  }
};

const KIND_WORD: Record<LibraryLinkKind, string> = { 'token-change': 'token change', exploration: 'library exploration', request: 'component request', suggestion: 'suggested token change' };

/** The record in a product branch body, or undefined when the branch was never checked. */
export function parsePiecesRecord(body: string | null | undefined): PiecesRecord | undefined {
  const r = readHidden<PiecesRecord>(PIECES_MARK, body);
  if (!r || !Array.isArray(r.pieces) || !Array.isArray(r.links) || typeof r.checkedAt !== 'string') return undefined;
  return r;
}

/** The section people read on GitHub, then the hidden record tools read. */
export function piecesSection(r: PiecesRecord): string {
  const link = (p: MissingPiece) => r.links.find((l) => l.piece === p.id);
  const lines = r.pieces.length
    ? r.pieces.map((p) => {
        const l = link(p);
        return `- **${p.title}**: ${p.summary}${l ? ` ${cap(KIND_WORD[l.kind])}: #${l.number}.` : ' No library branch yet.'}`;
      })
    : ['- Nothing: every value and component comes from the library.'];
  return [SECTION, '', `Checked ${r.checkedAt.slice(0, 10)}${r.headSha ? ` on ${r.headSha.slice(0, 7)}` : ''} by Bridge.`, '', ...lines, '', hiddenJson(PIECES_MARK, r)].join('\n');
}

/** The body with the pieces section replaced, or added at the end. */
export function withPiecesRecord(body: string | null | undefined, r: PiecesRecord): string {
  const b = (body ?? '').trimEnd();
  const start = b.indexOf(SECTION);
  const markAt = b.indexOf(`<!-- ${PIECES_MARK} `);
  if (start >= 0 && markAt > start) {
    const end = b.indexOf('-->', markAt);
    return `${b.slice(0, start)}${piecesSection(r)}${end >= 0 ? b.slice(end + 3) : ''}`.trimEnd();
  }
  return `${b}${b ? '\n\n' : ''}${piecesSection(r)}`;
}

/**
 * A new check merged with the previous record: links stay with their piece (same id), and links of pieces the branch
 * no longer has stay too, so a library branch is never forgotten.
 */
export function mergePiecesRecord(prev: PiecesRecord | undefined, next: Omit<PiecesRecord, 'links'> & { links?: LibraryLink[] | undefined }): PiecesRecord {
  const links = [...(prev?.links ?? [])];
  for (const l of next.links ?? []) {
    const at = links.findIndex((x) => x.piece === l.piece);
    if (at >= 0) links[at] = l;
    else links.push(l);
  }
  return { ...next, links };
}

/** The record with one more link (replacing the piece's earlier one). */
export function withLink(r: PiecesRecord, l: LibraryLink): PiecesRecord {
  return { ...r, links: [...r.links.filter((x) => x.piece !== l.piece), l] };
}

// ---------------------------------------------------------------------------------------------------------------
// The library side: "needed by"

export interface NeededBy {
  /** The product branch (pull request number), its title and branch. */
  pr: number;
  title: string;
  branch: string;
  url: string;
  /** Product key and name: "admin", "Admin demo". */
  product: string;
  productName: string;
  /** Who started the product branch (GitHub login). */
  author?: string | undefined;
  /** The piece it answers. */
  piece: string;
  pieceTitle: string;
  /** The closest thing the library has today, so a reviewer can suggest it instead: "danger". */
  nearest?: string | undefined;
  nearestToken?: string | undefined;
}

/** "Needed by" for a library branch body: one line people read, one hidden block tools read. */
export function neededBySection(n: NeededBy): string {
  const who = n.author ? ` for @${n.author}` : '';
  const near = n.nearest ? ` The closest the library has today is ${n.nearest}${n.nearestToken ? ` (\`${n.nearestToken}\`)` : ''}.` : '';
  return [`**Needed by:** [${n.title}](${n.url}) (#${n.pr}) in ${n.productName}${who}.${near}`, '', hiddenJson(NEEDED_MARK, n)].join('\n');
}

export function parseNeededBy(body: string | null | undefined): NeededBy | undefined {
  const n = readHidden<NeededBy>(NEEDED_MARK, body);
  return n && typeof n.pr === 'number' && typeof n.title === 'string' && typeof n.piece === 'string' ? n : undefined;
}

/** The body with the "Needed by" section first (replacing an earlier one). */
export function withNeededBy(body: string | null | undefined, n: NeededBy): string {
  let b = (body ?? '').trim();
  const at = b.indexOf('**Needed by:**');
  const mark = b.indexOf(`<!-- ${NEEDED_MARK} `);
  if (at >= 0 && mark > at) {
    const end = b.indexOf('-->', mark);
    b = `${b.slice(0, at)}${b.slice(end + 3)}`.trim();
  }
  return `${neededBySection(n)}${b ? `\n\n${b}` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// What each piece opens in the library

export interface ProductBranchRef {
  pr: number;
  title: string;
  branch: string;
  url: string;
  productKey: string;
  productName: string;
  author?: string | undefined;
}

export type LibraryBranchPlan =
  | { kind: 'token-change'; title: string; summary: string; edits: TokenEdit[]; neededBy: NeededBy }
  | { kind: 'exploration'; title: string; exploration: Exploration; neededBy: NeededBy; brief: string }
  | { kind: 'request'; title: string; request: ComponentChangeRequest; neededBy: NeededBy };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Admin demo needs it for "Billing screen with overdue invoices"". */
const forLine = (b: ProductBranchRef) => `${b.productName} needs it for "${b.title.replace(/"/g, "'")}" (#${b.pr})`;

/**
 * What a piece opens in the library, honestly labelled by what Bridge can write:
 * - a token piece: a token change (the new token, a draft for review, the usual gate); in suggest mode the same
 *   change is filed as a suggestion;
 * - a variant: a library exploration (a branch and a draft for the component work, with a brief for Claude); in
 *   suggest mode a component request, since an exploration is a branch;
 * - a new component: a component request (an issue): it needs design work before code.
 */
export function libraryBranchPlan(piece: MissingPiece, branch: ProductBranchRef, opts: { source?: ComponentChangeRequest['source']; requestedBy?: string | undefined; mode?: ChangesMode | undefined } = {}): LibraryBranchPlan {
  const neededBy: NeededBy = {
    pr: branch.pr,
    title: branch.title,
    branch: branch.branch,
    url: branch.url,
    product: branch.productKey,
    productName: branch.productName,
    ...(branch.author ? { author: branch.author } : {}),
    piece: piece.id,
    pieceTitle: piece.title,
    ...(piece.nearest ? { nearest: piece.nearest.label, nearestToken: piece.nearest.token } : {}),
  };
  const near = piece.nearest ? ` The closest the library has today is ${piece.nearest.label} (${piece.nearest.token}, ${piece.nearest.value}).` : '';
  if (piece.kind === 'token' && piece.token) {
    const t = piece.token;
    const files = t.files.length ? t.files : [undefined];
    const edits: TokenEdit[] = files.map((file) => ({
      op: 'add',
      path: t.path,
      type: t.type,
      value: t.value,
      description: `${cap(piece.name)}: ${forLine(branch)}.${files.length > 1 ? ' Same value in every theme: review it in each.' : ''}`,
      ...(file ? { file } : {}),
    }));
    return { kind: 'token-change', title: `Add ${t.path}`, summary: `${forLine(branch)}: ${piece.summary}${near}`, edits, neededBy };
  }
  if (piece.kind === 'variant' && piece.component && opts.mode === 'suggest') {
    const request: ComponentChangeRequest = {
      component: piece.component,
      kind: 'new-variant',
      title: piece.title,
      summary: `${forLine(branch)}: ${piece.summary}${near}`,
      changes: piece.values.slice(0, 6).map((v) => ({ field: v.property ?? v.category, after: v.value })),
      source: opts.source ?? 'mcp',
      ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
    };
    return { kind: 'request', title: piece.title, request, neededBy };
  }
  if (piece.kind === 'variant' && piece.component) {
    const values = piece.values.map((v) => `${v.property ?? v.category} ${v.value}`).join(', ');
    const exploration: Exploration = {
      name: piece.title,
      purpose: `${forLine(branch)}: ${/^[aeiou]/i.test(piece.name) ? 'an' : 'a'} ${piece.name} ${piece.aspect ?? 'style'} on ${piece.component} (${values}).${near}`,
      useCase: 'terminal',
      experimental: [piece.title],
      source: opts.source === 'figma' ? 'figma' : (opts.source ?? 'mcp'),
    };
    const brief = [
      `Add the ${piece.name} ${piece.aspect ?? 'style'} to ${piece.component} in the library, on this exploration branch.`,
      `The product branch writes it by hand: ${values}. Express it with tokens (a component or semantic token per value), add it to the component's props, docs and examples, and keep every existing ${piece.component} unchanged.`,
      piece.nearest ? `Say in the pull request why ${piece.nearest.label} is not enough, or recommend it instead.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return { kind: 'exploration', title: piece.title, exploration, neededBy, brief };
  }
  const name = piece.component ?? cap(piece.name);
  const request: ComponentChangeRequest = {
    component: name,
    kind: 'new-component',
    title: `Add ${name}`,
    summary: `${forLine(branch)}: ${piece.summary}${near}`,
    changes: piece.values.slice(0, 6).map((v) => ({ field: v.property ?? v.category, after: v.value })),
    source: opts.source ?? 'mcp',
    ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
  };
  return { kind: 'request', title: `New component: ${name}`, request, neededBy };
}

// ---------------------------------------------------------------------------------------------------------------
// Where a linked library branch stands

export type LinkStatusKey = 'draft' | 'in-review' | 'changes' | 'approved' | 'shipped' | 'closed' | 'exploring' | 'requested' | 'in-progress' | 'done' | 'declined' | 'outdated';

export interface LinkStatus {
  key: LinkStatusKey;
  /** "In review", "Shipped". */
  label: string;
  /** Logins asked to review (pull requests), or assignees (requests). */
  people: string[];
  /** "In review · @dana reviews". */
  line: string;
}

const STATUS_LABEL: Record<LinkStatusKey, string> = {
  draft: 'Draft',
  'in-review': 'In review',
  changes: 'Changes requested',
  approved: 'Approved',
  shipped: 'Shipped',
  closed: 'Closed',
  exploring: 'Being built',
  requested: 'Requested',
  'in-progress': 'In progress',
  done: 'Done',
  declined: 'Declined',
  outdated: 'Outdated',
};

/** Badge tone of a status: status colours only for status. */
export const LINK_STATUS_TONE: Record<LinkStatusKey, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  'in-review': 'info',
  changes: 'warning',
  approved: 'success',
  shipped: 'success',
  closed: 'neutral',
  exploring: 'neutral',
  requested: 'neutral',
  'in-progress': 'info',
  done: 'success',
  declined: 'neutral',
  outdated: 'warning',
};

const names = (people: string[]) => (people.length <= 2 ? people.map((p) => `@${p}`).join(' and ') : `@${people[0]} and ${people.length - 1} more`);

/** The link status of each suggestion status: review states read like a pull request's, applied like shipped. */
const SUGGESTION_LINK_STATUS: Record<SuggestionStatus, LinkStatusKey> = {
  'needs-review': 'in-review',
  'changes-requested': 'changes',
  approved: 'approved',
  applying: 'in-progress',
  applied: 'shipped',
  declined: 'declined',
  outdated: 'outdated',
};

/**
 * Where a library branch stands, from what GitHub says: a pull request (state, draft, labels, requested reviewers,
 * latest review per person), a request issue (state, reason, assignees, whether a pull request implements it) or a
 * suggestion (its status, suggestionStatus in suggestions.ts, and who it is assigned to).
 */
export function linkStatus(
  x:
    | { kind: 'token-change' | 'exploration'; state: string; draft: boolean; labels?: readonly string[] | undefined; requestedReviewers?: readonly string[] | undefined; reviews?: readonly { user?: string | undefined; state: string }[] | undefined }
    | { kind: 'request'; state: 'open' | 'closed'; stateReason?: string | null | undefined; assignees?: readonly string[] | undefined; implemented?: boolean | undefined }
    | { kind: 'suggestion'; status: SuggestionStatus; assignees?: readonly string[] | undefined },
): LinkStatus {
  const make = (key: LinkStatusKey, people: string[] = [], verb = 'reviews'): LinkStatus => {
    const label = STATUS_LABEL[key];
    const tail = people.length ? ` · ${names(people)} ${people.length === 1 ? verb : verb.replace(/s$/, '')}` : '';
    return { key, label, people, line: `${label}${tail}` };
  };
  if (x.kind === 'suggestion') {
    const key = SUGGESTION_LINK_STATUS[x.status];
    return make(key, key === 'in-progress' ? [...(x.assignees ?? [])] : [], 'builds');
  }
  if (x.kind === 'request') {
    if (x.state === 'closed') return make(x.stateReason === 'not_planned' ? 'declined' : 'done');
    return x.implemented ? make('in-progress', [...(x.assignees ?? [])], 'builds') : make('requested', [...(x.assignees ?? [])], 'builds');
  }
  if (x.state === 'merged') return make('shipped');
  if (x.state !== 'open') return make('closed');
  if ((x.labels ?? []).includes('exploration')) return make('exploring');
  if (x.draft) return make('draft');
  const latest = new Map<string, string>();
  for (const r of x.reviews ?? []) if (r.user && r.state !== 'COMMENTED') latest.set(r.user, r.state);
  const states = [...latest.values()];
  if (states.includes('CHANGES_REQUESTED')) return make('changes', [...latest].filter(([, s]) => s === 'CHANGES_REQUESTED').map(([u]) => u), 'asks');
  const waiting = [...(x.requestedReviewers ?? [])];
  if (states.includes('APPROVED') && !waiting.length) return make('approved');
  return make('in-review', waiting);
}

// ---------------------------------------------------------------------------------------------------------------
// The preview: the product branch uses the library branch before it ships

export type LibraryPreviewKey = 'nothing-yet' | 'not-used' | 'preview' | 'outdated' | 'published' | 'switched' | 'declined';

export interface LibraryPreviewState {
  key: LibraryPreviewKey;
  /** One sentence in designer words. */
  sentence: string;
  /** The one action that moves it on, when there is one. */
  action: { kind: 'use-preview' | 'refresh-preview' | 'switch'; label: string } | null;
}

/**
 * What the product branch shows of a library branch, and what to do next:
 * - while the library branch is open, the product branch carries its commits (Bridge merges the library branch in),
 *   so the product preview shows the real library change; new library commits make it outdated;
 * - once the library branch ships, "Switch to the published version" brings main into the product branch: its own
 *   diff no longer carries the library change, the shipped one is used;
 * - a request has nothing to preview until someone builds it; a closed library branch says so.
 *
 * `missing` is how many library commits the product branch lacks, `total` how many the library branch has on top of
 * main (null when unknown). `behindMain` is how far the product branch is behind main.
 */
export function libraryPreviewState(x: {
  kind: LibraryLinkKind;
  lifecycle: 'open' | 'merged' | 'closed';
  /** The library branch changes something beyond its exploration note. */
  hasChanges: boolean;
  missing: number | null;
  total: number | null;
  behindMain: number | null;
  nearest?: string | undefined;
}): LibraryPreviewState {
  if (x.kind === 'suggestion') {
    if (x.lifecycle === 'closed') return { key: 'declined', sentence: `The library declined this suggestion.${x.nearest ? ` Ask Claude to use ${x.nearest} instead.` : ''}`, action: null };
    if (x.lifecycle === 'merged') return x.behindMain === 0 ? { key: 'switched', sentence: 'Your feature uses the published version.', action: null } : { key: 'published', sentence: 'The library applied the suggestion. Switch your feature to the published version.', action: { kind: 'switch', label: 'Switch to the published version' } };
    return { key: 'nothing-yet', sentence: 'Nothing to preview yet: owners review the suggestion, then a developer applies it. Your feature keeps its own value until then.', action: null };
  }
  if (x.kind === 'request') {
    if (x.lifecycle === 'closed') return { key: 'declined', sentence: `The library declined this request.${x.nearest ? ` Ask Claude to use ${x.nearest} instead.` : ''}`, action: null };
    if (x.lifecycle === 'merged') return x.behindMain === 0 ? { key: 'switched', sentence: 'Your feature uses the published version.', action: null } : { key: 'published', sentence: 'The library built it. Switch your feature to the published version, then ask Claude to use it.', action: { kind: 'switch', label: 'Switch to the published version' } };
    return { key: 'nothing-yet', sentence: 'Nothing to preview yet: the library builds it first. Your feature keeps its own version until then.', action: null };
  }
  if (x.lifecycle === 'merged') {
    if (x.behindMain === 0) return { key: 'switched', sentence: 'Your feature uses the published version.', action: null };
    return { key: 'published', sentence: 'The library published it. Switch your feature to the published version.', action: { kind: 'switch', label: 'Switch to the published version' } };
  }
  if (x.lifecycle === 'closed') return { key: 'declined', sentence: `The library closed it without shipping.${x.nearest ? ` Ask Claude to use ${x.nearest} instead.` : ''}`, action: null };
  if (!x.hasChanges) return { key: 'nothing-yet', sentence: 'The library change has nothing in it yet. Claude adds it there, then your feature can use its preview.', action: null };
  if (x.missing === 0) return { key: 'preview', sentence: 'Your feature uses a preview of the library change. When the library publishes it, switch to the real version here in one click.', action: null };
  if (x.missing !== null && x.total !== null && x.missing < x.total) return { key: 'outdated', sentence: 'The library change changed since your feature took its preview.', action: { kind: 'refresh-preview', label: 'Get the latest preview' } };
  return { key: 'not-used', sentence: 'Your feature does not use the library change yet.', action: { kind: 'use-preview', label: 'Use its preview in my feature' } };
}

// ---------------------------------------------------------------------------------------------------------------
// The summary sentence of a product branch

const nPieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

/**
 * The one sentence first on a product branch: "Built with the library. 1 piece was missing, and Claude AI opened a
 * library change for it." `who` names who opened the library changes when they are all from the same one.
 */
export function productBranchSentence(r: PiecesRecord | undefined, opts: { agentName?: string | undefined; viewer?: string | null | undefined } = {}): { lead: string; strong: string; rest: string } {
  if (!r) return { lead: 'Not checked against the library yet.', strong: '', rest: ' Ask Claude what is missing from the library.' };
  const n = r.pieces.length;
  if (!n) return { lead: 'Built with the library.', strong: ' Nothing is missing', rest: ': every value and component comes from it.' };
  const linked = r.pieces.filter((p) => r.links.some((l) => l.piece === p.id));
  const openers = [...new Set(linked.map((p) => r.links.find((l) => l.piece === p.id)!).map((l) => (l.agent ? (opts.agentName ?? 'Claude AI') : l.openedBy && l.openedBy === opts.viewer ? 'you' : l.openedBy ? `@${l.openedBy}` : 'someone')))];
  const by = openers.length === 1 ? openers[0]! : 'your team';
  const was = n === 1 ? 'was' : 'were';
  if (linked.length === n) {
    const what = n === 1 ? 'a library change for it' : 'library changes for them';
    return { lead: 'Built with the library. ', strong: `${nPieces(n)} ${was} missing`, rest: `, and ${by} opened ${what}.` };
  }
  if (!linked.length) return { lead: 'Built with the library. ', strong: `${nPieces(n)} ${n === 1 ? 'is' : 'are'} missing`, rest: n === 1 ? ': open a library change for it.' : ': open a library change for each.' };
  return { lead: 'Built with the library. ', strong: `${nPieces(n)} ${was} missing`, rest: `: ${linked.length} ${linked.length === 1 ? 'has' : 'have'} a library change, ${n - linked.length} still ${n - linked.length === 1 ? 'needs' : 'need'} one.` };
}

/** "Why it exists" on the library review: "Ann needs it for <title> in Admin demo." */
export function whyItExists(n: NeededBy, opts: { names?: Record<string, string> } = {}): { who: string; title: string; product: string } {
  const who = n.author ? (opts.names?.[n.author] ?? `@${n.author}`) : 'A product team';
  return { who, title: n.title, product: n.productName };
}

/** The reviewer's question when the closest library value looks a lot like the piece. */
export function nearestQuestion(n: NeededBy, opts: { names?: Record<string, string> } = {}): string | null {
  if (!n.nearest) return null;
  const who = n.author ? (opts.names?.[n.author] ?? `@${n.author}`) : 'the product team';
  return `It looks a lot like "${n.nearest}". Is a new one worth it, or should ${who} use ${n.nearest}?`;
}

/** The review comment of "Suggest <nearest>": request changes with the library value to use instead. */
export function suggestNearestComment(n: NeededBy): string | null {
  if (!n.nearest) return null;
  return `Let's not add it to the library: ${n.nearest}${n.nearestToken ? ` (\`${n.nearestToken}\`)` : ''} covers it. Use it on ${n.title} (#${n.pr}) instead, then close this branch.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Naming helpers shared with the audit side

/** A piece id from its kind and names: "badge-overdue-tone". */
export function pieceId(parts: (string | undefined)[]): string {
  return slugify(parts.filter(Boolean).join(' '), 48);
}

const TONE_WORDS = ['neutral', 'success', 'warning', 'danger', 'info', 'error', 'critical', 'accent', 'brand', 'primary', 'secondary'];

/** The word people use for a token: the tone in its path, else its last meaningful segment. */
export function tokenLabel(path: string): string {
  const parts = path.split('.');
  const tone = parts.find((p) => TONE_WORDS.includes(p));
  if (tone) return tone;
  const meaningful = parts.filter((p) => !/^(color|bg|fg|text|border|default|base|value|\d+)$/.test(p));
  return meaningful[meaningful.length - 1] ?? parts[parts.length - 1] ?? path;
}

/** A new token beside the closest one, named after the piece: color.feedback.danger.bg + "overdue" -> color.feedback.overdue.bg when the closest has a tone, else a sibling. */
export function proposedTokenPath(nearest: string | undefined, name: string, category: string): string {
  const slug = slugify(name, 32);
  if (!nearest) return `${category === 'color' ? 'color' : category}.${slug}`;
  const parts = nearest.split('.');
  const toneAt = parts.findIndex((p) => TONE_WORDS.includes(p));
  if (toneAt > 0) return [...parts.slice(0, toneAt), slug, ...parts.slice(toneAt + 1)].join('.');
  return [...parts.slice(0, -1), slug].join('.');
}
