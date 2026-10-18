// Continue a change: add more token edits to a change already sent for review instead of opening a new one, the way
// the Figma plugin's "Add to open pull request" does. Pure rules and words, tested in continue-change.test.ts; the
// browser side (reading changes, the 3-way check, the commit on top of the change) lives in scripts/token-editor.ts.
// Designer words only on screen: a change, sent for review, edits. Branch, commit and pull request stay in code.
import { changeKind, changesetBump, composeChangeset, threeWayDiff, type AcceptedChange, type ChangesetOptions, type TokenSet } from '@bridge-ds/core';
import type { Draft } from './editor-model';

/** The fields of a GitHub pull request these rules read (REST shape). */
export interface ChangePullLike {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  updated_at?: string;
  user: { login: string } | null;
  labels?: { name: string }[] | null;
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
}

/** A change the viewer may add token edits to. */
export interface ChangeTarget {
  number: number;
  title: string;
  /** The change's branch (never shown to designers). */
  branch: string;
  headSha: string;
  /** Opened by the viewer. */
  mine: boolean;
  author: string;
  updatedAt: string;
}

/** Branches the token editor and the Figma plugin open for token edits (core branchName). */
export const TOKEN_BRANCH = /^tokens\//;

const labelNames = (p: ChangePullLike) => (p.labels ?? []).map((l) => l.name.toLowerCase());

/**
 * A change created from token edits, still open, in this repository. Explorations (explore/*, label exploration),
 * new brands (bridge/brand-*, label "new brand") and docs changes keep their own flows.
 */
export function isTokenChange(p: ChangePullLike, repoFullName: string): boolean {
  if (p.state !== 'open' || p.merged_at) return false;
  if (!TOKEN_BRANCH.test(p.head.ref)) return false;
  const labels = labelNames(p);
  if (!labels.includes('tokens')) return false;
  if (labels.some((l) => l === 'exploration' || l.includes('brand'))) return false;
  // A change from a fork lives in someone else's repository: Studio cannot add to it.
  const from = p.head.repo?.full_name;
  return !from || from.toLowerCase() === repoFullName.toLowerCase();
}

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Only the author or someone with write access to the repository adds to a change. */
export function canAddTo(p: ChangePullLike, viewer: string | null | undefined, write: boolean): boolean {
  if (!viewer) return false;
  return write || same(p.user?.login, viewer);
}

/** The changes the viewer can add token edits to: theirs first, then the most recently updated. */
export function addableChanges(pulls: ChangePullLike[], ctx: { repo: string; viewer: string | null | undefined; write: boolean }): ChangeTarget[] {
  return pulls
    .filter((p) => isTokenChange(p, ctx.repo) && canAddTo(p, ctx.viewer, ctx.write))
    .map((p) => ({
      number: p.number,
      title: changeTitle(p.title),
      branch: p.head.ref,
      headSha: p.head.sha,
      mine: same(p.user?.login, ctx.viewer),
      author: p.user?.login ?? '',
      updatedAt: p.updated_at ?? '',
    }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || b.updatedAt.localeCompare(a.updatedAt));
}

/** "tokens: Darker default background" reads "Darker default background" to a designer. */
export function changeTitle(title: string): string {
  const t = title.replace(/^(feat|fix|chore)?\(?tokens\)?:\s*/i, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title;
}

export type TargetChoice = { kind: 'new' } | { kind: 'change'; number: number };

/**
 * Where the edits go unless the viewer picks otherwise. Editing inside a change: that change. Otherwise the viewer's
 * own most recent token change (like the plugin, which follows the designer's last change), else a new change. A
 * change someone else opened is offered but never the default.
 */
export function defaultTarget(targets: ChangeTarget[], scoped: number | null = null): TargetChoice {
  if (scoped && targets.some((t) => t.number === scoped)) return { kind: 'change', number: scoped };
  const mine = targets.find((t) => t.mine);
  return mine ? { kind: 'change', number: mine.number } : { kind: 'new' };
}

/** Choices shown in the send dialog. At most `max` changes, so the choice stays short. */
export const MAX_TARGETS = 3;

export interface TargetOption {
  value: string;
  label: string;
  description: string;
}

export function targetValue(c: TargetChoice): string {
  return c.kind === 'new' ? 'new' : `change-${c.number}`;
}

export function parseTargetValue(v: string | null | undefined): TargetChoice | null {
  if (v === 'new') return { kind: 'new' };
  const m = /^change-(\d+)$/.exec(v ?? '');
  return m ? { kind: 'change', number: Number(m[1]) } : null;
}

export function targetOptions(targets: ChangeTarget[], ago: (iso: string) => string, max = MAX_TARGETS): TargetOption[] {
  const shown = targets.slice(0, max);
  return [
    ...shown.map((t) => ({
      value: targetValue({ kind: 'change', number: t.number }),
      label: `Add to ${t.title}`,
      description: [t.mine ? 'Your change' : `Opened by ${t.author}`, t.updatedAt ? `updated ${ago(t.updatedAt)}` : ''].filter(Boolean).join(', ') + '.',
    })),
    { value: 'new', label: 'Start a new change', description: 'It gets its own title and its own review.' },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Conflicts: the same 3-way token diff the Figma plugin runs (core threeWayDiff). Base is the token set the draft was
// made on, "ours" the draft applied to it, "theirs" the change as it is now. A token both sides changed differently
// stops the save; tokens only the change moved are kept as they are; the draft's other edits go on top.

export interface ChangeMerge {
  /** Tokens edited in the draft and, differently, in the change since the editor loaded it. */
  conflicts: string[];
  /** Tokens the change moved that the draft does not touch: kept as the change has them. */
  upstream: string[];
}

export function mergeCheck(base: TokenSet, ours: TokenSet, theirs: TokenSet): ChangeMerge {
  const r = threeWayDiff(base.tokens, ours.tokens, theirs.tokens);
  return { conflicts: r.conflicts.map((e) => e.path), upstream: r.remote.map((e) => e.path) };
}

/** The error the save throws on a conflict, so the dialog can link to the conflict flow. */
export class ChangeConflictError extends Error {
  constructor(
    readonly paths: string[],
    readonly change: number,
    scoped = true,
  ) {
    super(conflictSentence(paths, scoped));
    this.name = 'ChangeConflictError';
  }
}

export function conflictSentence(paths: string[], scoped = true): string {
  const n = paths.length;
  const what = n === 1 ? paths[0] : n === 2 ? `${paths[0]} and ${paths[1]}` : `${paths[0]} and ${n - 1} other tokens`;
  const where = scoped ? `Someone also edited ${what} in this change after you opened it.` : `This change already edits ${what}, to another value than yours.`;
  return `${where} Nothing was saved, so no edit is lost. Keep your value, or keep theirs and drop your edit.`;
}

/** Conflicts still open once the designer chose "Keep mine" for some tokens. */
export function unresolved(conflicts: string[], keepMine: string[]): string[] {
  const mine = new Set(keepMine);
  return conflicts.filter((p) => !mine.has(p));
}

/** "Keep theirs": the draft without its edits of these tokens (docs edits stay). */
export function dropEdits<D extends Draft>(draft: D, paths: string[]): D {
  const drop = new Set(paths);
  return { ...draft, edits: draft.edits.filter((e) => e.kind === 'docs' || !drop.has(e.path)) };
}

/** The change page, where both values show (its token diff) and the library conflict flow lives. */
export const conflictHref = (n: number) => `/studio/changes/?pr=${n}`;

// ---------------------------------------------------------------------------------------------------------------
// Words

/** The persistent banner of the token editor scoped to a change. */
export function scopeBanner(title: string): { title: string; body: string } {
  return { title: `Editing: ${title}`, body: 'Your edits are added to this change, on top of its values.' };
}

/** Status line once the edits are added. */
export function addedSentence(n: number, title: string, upstream: number): string {
  const edits = `${n} edit${n === 1 ? '' : 's'}`;
  const moved = upstream ? ` It had moved since you opened it: ${upstream === 1 ? '1 other token stays as the change has it' : `${upstream} other tokens stay as the change has them`}.` : '';
  return `Added ${edits} to ${title}.${moved}`;
}

/** The change page, back from the token editor. */
export const addedNotice = (n: number) => `Added ${n} edit${n === 1 ? '' : 's'} to this change. Reviewers see ${n === 1 ? 'it' : 'them'} now.`;

/** The local draft strip on Changes: where the draft goes when sent. */
export function draftDestination(target: ChangeTarget | null, edits = 2): string {
  return target ? `Sending adds ${edits === 1 ? 'it' : 'them'} to ${target.title}.` : 'Sending starts a new change.';
}

/** The comment posted on the change, so reviewers see what was added and from where. */
export function addedComment(paths: string[], viewer: string | null | undefined): string {
  const lines = paths.slice(0, 20).map((p) => `- \`${p}\``);
  if (paths.length > 20) lines.push(`- and ${paths.length - 20} more`);
  return `${viewer ? `@${viewer} added` : 'Added'} token edits from the Bridge token editor:\n\n${lines.join('\n')}`;
}

/** The commit message on the change. */
export function addedCommitMessage(title: string, paths: string[]): string {
  return `tokens: ${title.replace(/^tokens:\s*/i, '')}\n\n${paths.map((p) => `- ${p}`).join('\n')}\n\nAdded with the Bridge token editor.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Approvals after new edits: GitHub decides (dismiss stale approvals is a branch rule). Studio shows what it did.

export interface ReviewStateLike {
  state: string;
  user: { login: string } | null;
  submitted_at?: string | null;
  commit_id?: string | null;
}

/**
 * Approvals GitHub dismissed and nobody gave again. `afterEdits`: the dismissed review was on an older version of the
 * change (its commit is not the head), so new edits are the likely reason.
 */
export function dismissedApprovals(reviews: ReviewStateLike[], headSha: string): { login: string; afterEdits: boolean }[] {
  const latest = new Map<string, ReviewStateLike>();
  const ordered = [...reviews].sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''));
  for (const r of ordered) {
    const login = r.user?.login;
    if (!login || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(login.toLowerCase(), r);
  }
  return [...latest.values()].filter((r) => r.state === 'DISMISSED').map((r) => ({ login: r.user!.login, afterEdits: Boolean(r.commit_id && r.commit_id !== headSha) }));
}

export function dismissedSentence(d: { login: string; afterEdits: boolean }[]): string | null {
  if (!d.length) return null;
  const who = d.length === 1 ? d[0]!.login : d.length === 2 ? `${d[0]!.login} and ${d[1]!.login}` : `${d[0]!.login} and ${d.length - 1} others`;
  const why = d.every((x) => x.afterEdits) ? ' when new edits were added' : '';
  return d.length === 1 ? `The approval from ${who} was reset${why}.` : `The approvals from ${who} were reset${why}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Drafts of a change: kept apart from the local draft, with the version of the change they were made on.

export interface ChangeDraft extends Draft {
  /** The change's head the edits were made on: the base of the 3-way check. */
  baseSha: string | null;
}

export const changeDraftKey = (repo: string, n: number) => `bridge.draft.change.${repo.toLowerCase()}#${n}.v1`;

export function parseChangeDraft(raw: string | null): ChangeDraft {
  try {
    const d = raw ? (JSON.parse(raw) as Partial<ChangeDraft>) : null;
    return { edits: Array.isArray(d?.edits) ? d!.edits : [], baseSha: typeof d?.baseSha === 'string' ? d.baseSha : null };
  } catch {
    return { edits: [], baseSha: null };
  }
}

/** The number in ?change=N of the token editor, or null. */
export function changeParam(search: string): number | null {
  const n = Number(new URLSearchParams(search).get('change'));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The token editor scoped to a change. */
export const editInChangeHref = (n: number) => `/studio/tokens/?change=${n}`;

const BUMPS = ['patch', 'minor', 'major'] as const;
type Bump = (typeof BUMPS)[number];

/**
 * The change's changeset after more edits: the bump is the larger of the two and the new tokens are listed under the
 * ones already there, so the release notes keep everything the change does. No changeset yet: a fresh one.
 */
export function mergeChangeset(existing: string | null | undefined, added: AcceptedChange[], opts: ChangesetOptions): string {
  if (!existing?.trim()) return composeChangeset(added, opts).content;
  const m = /^---\n([\s\S]*?)\n---\n/.exec(existing);
  if (!m) return existing;
  const addBump = changesetBump(added) as Bump;
  const header = m[1]!.replace(/:\s*(patch|minor|major)\s*$/gm, (_all, old: Bump) => `: ${BUMPS[Math.max(BUMPS.indexOf(old), BUMPS.indexOf(addBump))]}`);
  const lines = added
    .map((c) => ({ path: (c.target ?? c.current)!.path, line: `- ${changeKind(c)} \`${(c.target ?? c.current)!.path}\`` }))
    .filter((x) => !existing.includes(`\`${x.path}\``))
    .map((x) => x.line);
  const body = existing.slice(m[0].length).replace(/\s+$/, '');
  return `---\n${header}\n---\n${body}${lines.length ? `\n${lines.join('\n')}` : ''}\n`;
}
