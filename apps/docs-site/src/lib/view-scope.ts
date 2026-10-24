// View the library as a change: Studio's Tokens, Components and Quality pages as they would be with one open change
// applied (Tokens Studio's branch switcher, in designer words). Pure rules and words, tested in view-scope.test.ts;
// the browser side (reading the change, caching it per version, painting the pages) lives in scripts/view-change.ts.
//
// One model for the address, shared by every page:
//   (nothing)            Latest library: what is shipped. Tokens edits go to a draft in this browser, as before.
//   ?change=N            View: the page reads change N as it is now. Read only, nothing is saved. Default for a change.
//   ?change=N&edit=1     Edit (Studio Tokens only): the token editor scoped to change N, edits are added to it (#114).
//   ?change=N,M[&use=..] View 2 to 4 token changes together (lib/combine-changes): the latest library plus each one's
//                        token edits, `use` holding the picks where two of them set a token differently. Read only.
// "Edit tokens in this change" turns a view into an edit; "Stop editing" (or the selector) turns it back. Other pages
// ignore edit=1, and links between Studio pages keep the view but never the edit.
import type { TokenSet } from '@bridge-ds/core';
import type { Lifecycle, LifecycleTone } from './change-status';
import { LIFECYCLE, lifecycleTone } from './change-status';
import { oneLineTitle } from './markdown';
import { humanTitle } from './pr-title';
import { studioHref } from './team-path';

/** The Studio pages that can show a change. Everything else reads the latest library and drops ?change=. */
export const VIEW_PAGES = [studioHref('tokens/'), studioHref('components/'), studioHref('quality/')] as const;

const norm = (path: string) => path.replace(/\/?$/, '/');

export const viewsChange = (path: string) => (VIEW_PAGES as readonly string[]).includes(norm(path));

/**
 * `change` is the first (or only) change shown. A view of several changes together also has `changes` (2 to 4, in the
 * address order) and `use`, the picks of the tokens they set differently (core encodePicks), as the address has it.
 */
export type LibraryScope = { kind: 'latest' } | { kind: 'view'; change: number; changes?: number[]; use?: string | null } | { kind: 'edit'; change: number };

export const LATEST: LibraryScope = { kind: 'latest' };

/** At most this many changes are shown together. */
export const MAX_CHANGES = 4;

/**
 * Change numbers in an address value: "118", "101,118" (or "101%2C118" once encoded). Positive whole numbers, no
 * repeats, at most MAX_CHANGES; anything else in the list makes it unreadable (empty), never a guess.
 */
export function parseChangeList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const parts = raw.split(/,|%2C/i).map((p) => p.trim());
  if (!parts.every((p) => /^\d{1,7}$/.test(p) && Number(p) > 0)) return [];
  return [...new Set(parts.map(Number))].slice(0, MAX_CHANGES);
}

/** The scope of a page from its address. Edit only exists on Studio Tokens; a page that cannot show a change reads the latest library. */
export function scopeOf(search: string, path: string): LibraryScope {
  if (!viewsChange(path)) return LATEST;
  const params = new URLSearchParams(search);
  const list = parseChangeList(params.get('change'));
  if (!list.length) return LATEST;
  if (list.length > 1) return { kind: 'view', change: list[0]!, changes: list, use: params.get('use') || null };
  const edit = params.get('edit') === '1' && norm(path) === studioHref('tokens/');
  return { kind: edit ? 'edit' : 'view', change: list[0]! };
}

/** The change a scope reads, or null for the latest library. */
export const scopeChange = (s: LibraryScope) => (s.kind === 'latest' ? null : s.change);

/** Every change a scope shows: none, one, or the 2 to 4 shown together. */
export const scopeChanges = (s: LibraryScope): number[] => (s.kind === 'latest' ? [] : s.kind === 'view' && s.changes && s.changes.length > 1 ? s.changes : [s.change]);

/** Several changes shown together. */
export const isTogether = (s: LibraryScope) => scopeChanges(s).length > 1;

/** Sets the scope's parameters on an address. */
function setScope(p: URLSearchParams, next: LibraryScope) {
  p.delete('change');
  p.delete('edit');
  p.delete('use');
  if (next.kind === 'latest') return;
  p.set('change', scopeChanges(next).join(','));
  if (next.kind === 'edit') p.set('edit', '1');
  if (next.kind === 'view' && isTogether(next) && next.use) p.set('use', next.use);
}

/** Commas in a list of changes stay readable in the address ("change=101,118"). */
const readable = (q: string) => q.replace(/(^|&)change=([\d%2Cc]+)/, (_m, a: string, b: string) => `${a}change=${b.replace(/%2C/gi, ',')}`);

/**
 * The same page in another scope, keeping its other parameters (filters, selection) and hash. A view drops edit=1;
 * the latest library drops both.
 */
export function scopeHref(loc: { pathname: string; search: string; hash?: string }, next: LibraryScope): string {
  const p = new URLSearchParams(loc.search);
  setScope(p, next);
  const q = readable(p.toString());
  return `${loc.pathname}${q ? `?${q}` : ''}${loc.hash ?? ''}`;
}

/**
 * A link from one Studio page to another while a change is shown: pages that can show it keep the view (never the
 * edit, which belongs to Tokens), other pages get the plain link. Off-site and same-page anchors stay as they are.
 */
export function keepScopeHref(href: string, scope: LibraryScope, base: string): string {
  if (scope.kind === 'latest' || href.startsWith('#')) return href;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return href;
  }
  if (url.origin !== new URL(base).origin) return href;
  if (viewsChange(url.pathname)) setScope(url.searchParams, scope.kind === 'edit' ? { kind: 'view', change: scope.change } : scope);
  else ['change', 'edit', 'use'].forEach((k) => url.searchParams.delete(k));
  const q = readable(url.searchParams.toString());
  return url.pathname + (q ? `?${q}` : '') + url.hash;
}

export const viewInChangeHref = (n: number, path = studioHref('tokens/')) => `${norm(path)}?change=${n}`;
/** Studio Tokens (or another view page) showing several changes together, with the picks (core encodePicks). */
export const viewTogetherHref = (numbers: number[], use: string, path = studioHref('tokens/')) =>
  scopeHref({ pathname: norm(path), search: '' }, { kind: 'view', change: numbers[0]!, changes: numbers, use: use || null });
/** Studio Tokens scoped to a change for editing ("Edit tokens in this change"). */
export const editInChangeHref = (n: number) => studioHref(`tokens/?change=${n}&edit=1`);
/** The change page. */
export const changePageHref = (n: number) => studioHref(`changes/?pr=${n}`);

// ---------------------------------------------------------------------------------------------------------------
// The selector: "Viewing: Latest library", then the open changes with their status.

export const LATEST_VALUE = 'latest';
export const LATEST_LABEL = 'Library';

export interface ViewPull {
  number: number;
  title: string;
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  updated_at?: string;
  user?: { login: string } | null;
  head: { ref: string; sha: string };
}

export interface ViewOption {
  value: string;
  label: string;
  description: string;
  group?: string;
  /** The change's status, shown as a Badge after the label (in the list and in the trigger). */
  status?: { label: string; tone: LifecycleTone };
}

/** "tokens: darker default background" reads "Darker default background". */
export const viewTitle = (title: string) => oneLineTitle(humanTitle(title), 70);

/** The script sends the options to the top bar Select; the Select sends a pick back; READY asks for the options again. */
export const VIEW_OPTIONS_EVENT = 'bridge:view-options';
export const VIEW_PICK_EVENT = 'bridge:view-pick';
export const VIEW_READY_EVENT = 'bridge:view-ready';

export interface ViewOptionsDetail {
  options: ViewOption[];
  value: string;
  /** Why the list is short (GitHub could not be reached), as the trigger's tooltip. */
  note?: string;
}

export const optionValue = (n: number | null) => (n ? `change-${n}` : LATEST_VALUE);

export function parseOptionValue(v: string | null | undefined): number | null {
  const m = /^change-(\d+)$/.exec(v ?? '');
  return m ? Number(m[1]) : null;
}

/** The selector's value for several changes shown together. */
export const togetherValue = (numbers: number[]) => `together-${numbers.join('-')}`;

/** "3 changes together", first under Open changes while they are shown; its description names them. */
export function togetherOption(numbers: number[], titles: string[]): ViewOption {
  return { value: togetherValue(numbers), label: `${numbers.length} changes together`, description: titles.length ? names(titles) : numbers.map((n) => `#${n}`).join(', '), group: 'Open changes' };
}

/** Open changes only, one per change, never the default branch itself; most recently updated first. */
export function openChanges<P extends ViewPull>(pulls: P[], defaultBranch: string): P[] {
  const seen = new Set<number>();
  return pulls
    .filter((p) => (p.state ?? 'open') === 'open' && !p.merged_at && p.head.ref !== defaultBranch && !seen.has(p.number) && seen.add(p.number))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
}

/**
 * The selector's options: the latest library, then each open change with its status (lib/change-status, a Badge in
 * the Select) and its author. A change
 * in the address that is not open any more (shipped or closed) stays listed, so the selector always says what the
 * page shows.
 */
export function viewOptions(pulls: ViewPull[], opts: { defaultBranch: string; lifecycleOf: (p: ViewPull) => Lifecycle; current?: ViewPull | null }): ViewOption[] {
  const open = openChanges(pulls, opts.defaultBranch);
  if (opts.current && !open.some((p) => p.number === opts.current!.number)) open.unshift(opts.current);
  const statusOf = (p: ViewPull) => {
    const l = opts.lifecycleOf(p);
    return { label: LIFECYCLE[l].short, tone: lifecycleTone(l) };
  };
  return [
    { value: LATEST_VALUE, label: LATEST_LABEL, description: 'The published library' },
    ...open.map((p) => ({
      value: optionValue(p.number),
      label: viewTitle(p.title),
      description: p.user?.login ? `by ${p.user.login}` : '',
      group: 'Open changes',
      status: statusOf(p),
    })),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a change cheaply: one tree read, then only the files whose content differs from this build.

/** A file of the change's tree: path from the repository root and its git blob id. */
export interface TreeEntry {
  path: string;
  sha: string;
  type?: string;
}

export interface FilePlan {
  /** Same content as this build: reuse the text already on the page. */
  reuse: string[];
  /** Different or new in the change: read their text. */
  fetch: string[];
  /** In this build, not in the change. */
  removed: string[];
}

/**
 * Which token files to read for a change. `main` maps each file of this build (relative to the token root) to its git
 * blob id; `head` lists the change's tree. Only *.tokens.json files under the root count.
 */
export function planFiles(main: Record<string, string>, head: TreeEntry[], root: string): FilePlan {
  const prefix = `${root.replace(/^\/+|\/+$/g, '')}/`;
  const inHead = new Map(head.filter((e) => (e.type ?? 'blob') === 'blob' && e.path.startsWith(prefix) && e.path.endsWith('.tokens.json')).map((e) => [e.path.slice(prefix.length), e.sha]));
  const reuse: string[] = [];
  const fetch: string[] = [];
  for (const [rel, sha] of inHead) (main[rel] === sha ? reuse : fetch).push(rel);
  const removed = Object.keys(main).filter((rel) => !inHead.has(rel));
  return { reuse: reuse.sort(), fetch: fetch.sort(), removed: removed.sort() };
}

/** The git blob id of a file: sha1 of "blob <bytes>\0<content>". `sha1` hashes bytes to hex (node or the browser). */
export async function gitBlobSha(text: string, sha1: (bytes: Uint8Array) => Promise<string> | string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  return sha1(all);
}

/** Where a change's files are kept in this browser: per version, so a new edit to the change is read again. */
export const viewCacheKey = (repo: string, sha: string) => `bridge.view.${repo.toLowerCase()}@${sha}`;
export const VIEW_CACHE_PREFIX = 'bridge.view.';
/** Versions kept: the oldest go first. */
export const VIEW_CACHE_KEEP = 6;

/** Cache keys to drop, oldest first, so at most `keep` versions stay. `entries`: key and when it was saved. */
export function staleKeys(entries: { key: string; at: number }[], keep = VIEW_CACHE_KEEP): string[] {
  return [...entries]
    .sort((a, b) => b.at - a.at)
    .slice(keep)
    .map((e) => e.key);
}

// ---------------------------------------------------------------------------------------------------------------
// Changed tokens: what the change does to each token, against the latest library.

export interface TokenMark {
  kind: 'changed' | 'added';
  /** Modes (or "brand theme" overrides) whose value differs. */
  modes: string[];
  /** The latest library's value of each of those modes. */
  before: Record<string, unknown>;
  /** The token's type, to format values. */
  type: string;
  /** Changes shown together: the changes whose value the token takes. */
  from?: number[];
}

export interface TokenMarks {
  marks: Map<string, TokenMark>;
  /** Tokens in the latest library that the change removes. */
  removed: string[];
}

/** Every value of a token: its modes, then its brand x theme overrides ("ocean dark"). */
function valuesOf(set: TokenSet, path: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const t = set.byPath.get(path);
  if (!t) return out;
  for (const [m, v] of Object.entries(t.values)) out.set(m, v);
  for (const o of set.overrides) if (o.path === path) out.set(`${o.brand} ${o.theme}`, o.value);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The tokens a change defines differently from the latest library (its own values, not what aliases resolve to). */
export function changedTokens(main: TokenSet, change: TokenSet): TokenMarks {
  const marks = new Map<string, TokenMark>();
  for (const t of change.byPath.values()) {
    const after = valuesOf(change, t.path);
    if (!main.byPath.has(t.path)) {
      marks.set(t.path, { kind: 'added', modes: [...after.keys()], before: {}, type: t.type });
      continue;
    }
    const before = valuesOf(main, t.path);
    const modes = [...new Set([...before.keys(), ...after.keys()])].filter((m) => !same(before.get(m), after.get(m)));
    if (modes.length) marks.set(t.path, { kind: 'changed', modes, before: Object.fromEntries(modes.map((m) => [m, before.get(m)])), type: t.type });
  }
  const removed = [...main.byPath.keys()].filter((p) => !change.byPath.has(p)).sort();
  return { marks, removed };
}

// Short on purpose: the banner on top already says which change the page shows, so every marked row does not repeat it.
export const CHANGED_LABEL = 'Changed';
export const ADDED_LABEL = 'New';
/** Components: why a row is marked. */
export const LOOKS_LABEL = 'Looks different';
export const GUIDANCE_LABEL = 'Guidance edited';

/**
 * The tooltip of a changed token: the latest library's value in each mode the change moves. `format` turns a raw
 * value into text (core formatValue: an alias target, a hex, 16px).
 */
export function beforeText(mark: TokenMark, format: (type: string, v: unknown) => string, modeName: (m: string) => string = (m) => m): string {
  if (mark.kind === 'added') return 'Not in the latest library.';
  // Token names as the table writes them: "primary.700", not "palette.primary.700".
  const shown = (v: unknown) => (v === undefined ? 'none' : format(mark.type, v).replace(/^palette\./, ''));
  const single = mark.modes.length === 1 && (mark.modes[0] === 'value' || mark.modes[0] === 'default');
  if (single) return `Before: ${shown(mark.before[mark.modes[0]!])}`;
  return `Before: ${mark.modes.map((m) => `${modeName(m)} ${shown(mark.before[m])}`).join(', ')}`;
}

/** Components whose look the change moves: any token they read resolves to another value (CSS variables that differ). */
export function changedComponents(index: Record<string, { name: string; paths: string[] }>, changedVars: Set<string>): string[] {
  const varOf = (p: string) => `--${p.replace(/\./g, '-')}`;
  return Object.entries(index)
    .filter(([, c]) => c.paths.some((p) => changedVars.has(varOf(p))))
    .map(([slug]) => slug)
    .sort();
}

/**
 * Components whose guidance file the change edits or removes: its blob id in the change's tree differs from this
 * build's. `head` maps repository paths to blob ids (the change's tree under the components directory).
 */
export function changedGuidance(docs: Record<string, { path: string; sha: string }>, head: Record<string, string>): string[] {
  return Object.entries(docs)
    .filter(([, d]) => head[d.path] !== d.sha)
    .map(([slug]) => slug)
    .sort();
}

/**
 * The stylesheet that paints previews with the change's tokens: per theme, the CSS variables whose value differs,
 * on the elements given for that theme (a selector list). Values are already CSS (editor-model previewOverrides).
 */
export function overrideCss(byTheme: Record<string, Record<string, string>>, selectors: (theme: string) => string): string {
  return Object.entries(byTheme)
    .filter(([, vars]) => Object.keys(vars).length)
    .map(([theme, vars]) => {
      const body = Object.entries(vars)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `  ${k}: ${v.replace(/[;{}<]/g, '')};`)
        .join('\n');
      return `${selectors(theme)} {\n${body}\n}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Words

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}`);

export type ViewPage = 'tokens' | 'components' | 'quality';

export function pageOf(path: string): ViewPage | null {
  const p = norm(path);
  return p === studioHref('tokens/') ? 'tokens' : p === studioHref('components/') ? 'components' : p === studioHref('quality/') ? 'quality' : null;
}

/** The banner's title: the one sentence of the mode, the same on every page. */
export const bannerTitle = (title: string) => `Viewing the library as ${title}. Nothing is saved.`;

/** "A and B", "A, B and C": every name (at most 4 changes are shown together). */
const names = (titles: string[]) => (titles.length <= 2 ? titles.join(' and ') : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`);

/** The banner's title for changes shown together: "Viewing the library with A, B and C. Nothing is saved." */
export const togetherTitle = (titles: string[]) => `Viewing the library with ${names(titles)}. Nothing is saved.`;

/** The mark of a token changed by changes shown together: which change it comes from ("Changed in #118"). */
export function fromLabel(kind: 'changed' | 'added', from: number[]): string {
  return `${kind === 'added' ? 'New in' : 'Changed in'} ${from.map((n) => `#${n}`).join(' and ')}`;
}

/**
 * The theme a changed token moves in when it moves in one theme only: every mode it changes ("light", or a brand
 * override "ocean light") names the same theme. Null when both themes move, for a new token, or for modes that are not
 * themes (density, a single value).
 */
export function onlyTheme(mark: Pick<TokenMark, 'kind' | 'modes'>): 'light' | 'dark' | null {
  if (mark.kind !== 'changed' || !mark.modes.length) return null;
  const themes = new Set(mark.modes.map((m) => m.trim().split(/\s+/).pop()));
  if (themes.size !== 1) return null;
  const [t] = themes;
  return t === 'light' || t === 'dark' ? t : null;
}

/** The words of a token's mark: new or changed, the change it comes from when several are shown, and the one theme it moves in. */
export function markLabel(mark: Pick<TokenMark, 'kind' | 'modes' | 'from'>): string {
  const theme = onlyTheme(mark);
  if (mark.from?.length) return `${fromLabel(mark.kind, mark.from)}${theme ? `, ${theme} theme only` : ''}`;
  if (mark.kind === 'added') return ADDED_LABEL;
  return theme ? `Changed, ${theme} theme only` : CHANGED_LABEL;
}

/** What this page shows of the change, in one sentence (null while reading). */
export function bannerBody(page: ViewPage, x: { changed?: number; added?: number; removed?: number; components?: number; guidance?: string[]; together?: boolean; picked?: boolean }): string {
  if (page === 'quality') return '';
  // Changes shown together speak in the plural, and each mark names its change.
  const [its, it] = x.together ? ['their', 'They change'] : ['its', 'It changes'];
  if (page === 'tokens') {
    const parts = [x.changed ? `${plural(x.changed, 'token')} changed` : '', x.added ? `${plural(x.added, 'token')} added` : '', x.removed ? `${plural(x.removed, 'token')} removed` : ''].filter(Boolean);
    const picked = x.picked ? ' Where two of them set a token differently, the value you picked is used.' : '';
    return parts.length ? `${list(parts)}, listed first in the table${x.together ? ', each marked with its change' : ''}.${picked}` : `${it} no token values.`;
  }
  const n = x.components ?? 0;
  const g = x.guidance?.length ?? 0;
  if (!n && !g) return `Previews use ${its} tokens. ${it} how no component looks.`;
  const what = [n ? `${plural(n, 'component')} ${n === 1 ? 'looks' : 'look'} different` : '', g ? `${g} ${g === 1 ? 'has' : 'have'} edited guidance` : ''].filter(Boolean).join(' and ');
  return `Previews use ${its} tokens: ${what}, marked in the list.${g ? ' Guidance text here comes from the library.' : ''}`;
}

/** Quality on a change: its numbers live in the change's checks, never main's numbers in their place. */
export const QUALITY_IN_CHECKS = 'Quality for this change is in its checks';
export const QUALITY_IN_CHECKS_BODY = 'The contrast gate, token validation and docs checks run on every change. Open the change to see what they found.';
/** Quality on changes shown together: no numbers exist for a combination here, so none are shown. */
export const QUALITY_TOGETHER = 'Quality is measured for each change on its own';
export const QUALITY_TOGETHER_BODY = 'Checks run on every change, not on a combination. Before they open together, Changes runs the contrast checks on the combined tokens.';

/** Errors say how to fix. */
export function readError(kind: 'rate' | 'missing' | 'other', title: string, signIn: string, resetAt?: string | null): string {
  if (kind === 'rate') return `GitHub's hourly limit for visitors is used up, so ${title} could not be read. ${signIn} to keep going${resetAt ? `, or try again after ${resetAt}` : ''}.`;
  if (kind === 'missing') return `${title} was not found. It may have been deleted: go back to the library or pick another change.`;
  return `${title} could not be read. Check your connection and reload the page, or go back to the library.`;
}
