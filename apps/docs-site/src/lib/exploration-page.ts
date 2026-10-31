// The exploration page while it runs (validated boards X1 "nothing built yet" and X2 "Claude has changed things"):
// pure view rules over @bridge-ds/core's exploration-resume words. Not started: the Continue in Claude panel and an
// empty "Your preview" frame. Exploring: the preview, the last activity in words, Done exploring, the last 3 events.
// Later states keep their own pages. No DOM, no fetch: tested in exploration-page.test.ts.
import { changedThings, continueLines, explorationActivity, humanAuthorOf, lastActivity, shortAgo, startedWhen, type BranchCommitLike, type PreviewApps } from '@bridge-ds/core';

/** A person or Claude on the page: the login (for the face), the name to show, and whether it is Claude. */
export interface PageFace {
  login: string;
  name: string;
  agent: boolean;
  avatar: string | null;
}

/** GitHub's public photo of an account (no API read); none for an email or Claude. */
export const avatarOf = (login: string): string | null => (/^[A-Za-z0-9-]+(\[bot\])?$/.test(login) && !/\[bot\]$/.test(login) ? `https://github.com/${login}.png?size=64` : null);

/** The face of an actor; a person's change Claude co-wrote reads "Florian with Claude" with the person's photo. */
export const faceOf = (who: string, claude: boolean, names: Record<string, string> = {}, withClaude = false): PageFace =>
  claude
    ? { login: 'claude', name: 'Claude', agent: true, avatar: null }
    : { login: who, name: `${names[who] ?? who}${withClaude ? ' with Claude' : ''}`, agent: false, avatar: avatarOf(who) };

/**
 * Display names readable without signing in: the git author name of each person's commits, when it is not the login
 * itself (or Claude). A signed-out visitor then reads "Florian", not "peterbono"; the login stays the fallback.
 */
export function gitNamesOf(commits: readonly BranchCommitLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of commits) {
    const login = c.author?.login?.trim();
    const name = c.commit.author?.name?.trim();
    if (!login || !name || out[login] || humanAuthorOf(c) !== login) continue;
    if (name.toLowerCase() !== login.toLowerCase() && !/claude/i.test(name)) out[login] = name;
  }
  return out;
}

/** "Started by" line after the name: " · Admin demo · today". */
export const startedTail = (productName: string, startedAt: string | null | undefined, now?: Date): string => [productName, startedAt ? startedWhen(startedAt, now) : ''].filter(Boolean).join(' · ');

/** One row of the activity list, and the line under the title (the same words). */
export interface ActivityRow {
  who: PageFace;
  text: string;
  when: string;
}

/** The last 3 events: Claude's and people's changes, then "started the exploration" when it fits. */
export function activityRows(input: { commits: readonly BranchCommitLike[]; author: string; startedAt?: string | null | undefined; names?: Record<string, string>; now?: Date }): ActivityRow[] {
  return explorationActivity({ commits: input.commits, author: input.author, startedAt: input.startedAt, limit: 3 }).map((e) => ({ who: faceOf(e.who, e.claude, input.names, e.withClaude), text: e.text, when: shortAgo(e.at, input.now) }));
}

/** "Claude changed Orders table and Bulk actions bar, 2 h ago": the line under the title once something changed. */
export function headlineOf(input: { commits: readonly BranchCommitLike[]; files: readonly string[] | null; author: string; names?: Record<string, string>; now?: Date }): ActivityRow | null {
  const last = lastActivity({ commits: input.commits, files: input.files, author: input.author });
  return last ? { who: faceOf(last.who, last.claude, input.names, last.withClaude), text: last.text, when: shortAgo(last.at, input.now) } : null;
}

/** The two lines of the Continue in Claude panel. */
export const pageLines = continueLines;

/**
 * Which preview a library exploration opens: the app its files change (the docs site, the admin demo), else the
 * Storybook for library components, else the docs site. Only apps the repository has previews for.
 */
export function libraryPreviewApp(files: readonly string[] | null | undefined, apps: PreviewApps): keyof PreviewApps | null {
  const has = (k: keyof PreviewApps) => Boolean(apps[k]);
  const f = files ?? [];
  if (f.some((x) => x.startsWith('apps/admin/')) && has('admin')) return 'admin';
  if (f.some((x) => x.startsWith('apps/docs-site/')) && has('docs')) return 'docs';
  if (f.some((x) => x.startsWith('packages/react/')) && has('storybook')) return 'storybook';
  return has('docs') ? 'docs' : has('storybook') ? 'storybook' : has('admin') ? 'admin' : null;
}

/** The Done exploring card: what its button does for this viewer (never a technical blocker). */
export type DoneAction = { kind: 'run' } | { kind: 'demo' } | { kind: 'note'; text: string } | null;

/**
 * Who sees the Done exploring card. A signed-out visitor or a viewer without write access to the repository (a PM, a
 * stakeholder) gets no card at all: they keep the preview, the line to continue and the activity. A signed-in person
 * with access who cannot keep it reads who can (`keeperNote`); the person who started it or a reviewer runs it.
 * `write`: null when unknown (a product's own repository), which leaves the decision to `keeper`.
 */
export function doneActionFor(v: { direct: boolean; demo: boolean; connected: boolean; write: boolean | null; keeper: boolean; keeperNote: string; productNote?: string | null }): DoneAction {
  if (!v.direct) return null;
  if (v.productNote) return { kind: 'note', text: v.productNote };
  if (!v.connected) return v.demo ? { kind: 'demo' } : null;
  if (v.write === false) return null;
  return v.keeper ? { kind: 'run' } : { kind: 'note', text: v.keeperNote };
}

/**
 * The "..." menu of the page, in order: Rename, Back to exploring, Archive. Only the keeper with GitHub in direct mode
 * (`writable`: the person who started it or a reviewer) gets it. Rename while it is open (not shipped). Back to
 * exploring only after Done exploring while no developer pushed since (status ready, not building). Nothing offered:
 * no menu at all.
 */
export function explorationMenu(v: { writable: boolean; status: string }): { rename: boolean; reopen: boolean; archive: boolean } {
  if (!v.writable) return { rename: false, reopen: false, archive: false };
  return { rename: v.status !== 'shipped', reopen: v.status === 'ready', archive: true };
}

// ---------------------------------------------------------------------------------------------------------------
// After Done exploring (Waiting for code, Being built, Shipped): the same page family as X1 and X2. The status tag,
// who said done and when, the preview, the hand-off in three steps, the pieces sent to the library, the activity.

/** The states of the page after Done exploring. */
export type HandoffStatus = 'ready' | 'building' | 'shipped';

/** True for the statuses this page shows after Done exploring. */
export const isHandoffStatus = (s: string): s is HandoffStatus => s === 'ready' || s === 'building' || s === 'shipped';

/** DS Badge tones the status tags use, the same words as the lists (core EXPLORATION_STATUS_LABEL). */
export type TagTone = 'neutral' | 'info' | 'success' | 'warning';

/**
 * The status tag of an exploration, everywhere it shows (the page title row, the Studio home cards): the same word
 * and the same tone. Not started is grey, Exploring is Harbor, Waiting for code waits on someone (amber), Being built
 * is in progress, Shipped is done.
 */
export function explorationTag(status: string, opts: { notStarted?: boolean } = {}): { label: string; tone: TagTone; dot: boolean } {
  if (status === 'active') return opts.notStarted ? { label: 'Not started', tone: 'neutral', dot: false } : { label: 'Exploring', tone: 'info', dot: true };
  if (status === 'ready') return { label: 'Waiting for code', tone: 'warning', dot: false };
  if (status === 'building') return { label: 'Being built', tone: 'info', dot: true };
  if (status === 'shipped') return { label: 'Shipped', tone: 'success', dot: false };
  if (status === 'promoted') return { label: 'In review', tone: 'info', dot: false };
  if (status === 'kept') return { label: 'Kept in the library', tone: 'success', dot: false };
  return { label: 'Closed', tone: 'neutral', dot: false };
}

/** One row of the hand-off progress (the DS Checklist): done or waiting, a title, one line. */
export interface HandoffStep {
  status: 'done' | 'waiting';
  title: string;
  detail: string;
  /** The step happening now (aria-current). */
  current?: boolean;
}

/** Bridge's own commit at Done exploring (the exploration note removed): neither the explorer's work nor a developer's. */
export const isDoneCommit = (c: BranchCommitLike): boolean => /^chore\(explore\): done exploring/.test(c.commit.message);

/** Who said Done exploring, from Bridge's commit at that moment (its author), when there is one. */
export function doneByOf(commits: readonly BranchCommitLike[]): string | null {
  const c = commits.find(isDoneCommit);
  return c ? humanAuthorOf(c) : null;
}

const names = (people: readonly PageFace[]) => (people.length <= 2 ? people.map((p) => p.name).join(' and ') : `${people[0]!.name} and ${people.length - 1} more`);

/** "Oct 30", "today", "yesterday": a day in words, for the hand-off steps. */
const dayOf = (iso: string | null | undefined, now?: Date): string => (iso ? startedWhen(iso, now) : '');

/**
 * The hand-off in three steps: Done exploring (who, when), Developers build it (waiting, or who builds it), Shipped.
 * `builders`: the developers known on it (assigned, or who pushed after Done exploring).
 */
export function handoffSteps(input: { status: HandoffStatus; doneBy: PageFace | null; doneAt: string | null; builders: readonly PageFace[]; shippedAt?: string | null; product: string; now?: Date }): HandoffStep[] {
  const when = dayOf(input.doneAt, input.now);
  const done: HandoffStep = { status: 'done', title: 'Done exploring', detail: [input.doneBy?.name, when].filter(Boolean).join(', ') || 'Handed to your developers' };
  const who = input.builders.length ? names(input.builders) : null;
  const build: HandoffStep =
    input.status === 'ready'
      ? { status: 'waiting', title: 'Developers build it', detail: who ? `Waiting for ${who}` : 'Waiting for a developer', current: true }
      : input.status === 'building'
        ? { status: 'waiting', title: 'Developers build it', detail: who ? `${who} ${input.builders.length === 1 ? 'is' : 'are'} building it` : 'Being built', current: true }
        : { status: 'done', title: 'Built', detail: who ? `By ${who}` : 'By your developers' };
  const ship: HandoffStep =
    input.status === 'shipped'
      ? { status: 'done', title: 'Shipped', detail: [`In ${input.product}`, dayOf(input.shippedAt, input.now)].filter(Boolean).join(', '), current: true }
      : { status: 'waiting', title: 'Shipped', detail: `Then live in ${input.product}` };
  return [done, build, ship];
}

/**
 * The developers known on it: the people assigned to it, then the people who pushed after Done exploring (not the
 * person who explored it, not Claude). Logins, deduplicated.
 */
export function buildersOf(input: { assignees?: readonly { login: string }[] | null; commits: readonly BranchCommitLike[]; doneAt: string | null; author: string }): string[] {
  const out: string[] = [];
  const add = (l: string | null | undefined) => {
    if (l && !/\[bot\]$/i.test(l) && l.toLowerCase() !== input.author.toLowerCase() && !out.some((x) => x.toLowerCase() === l.toLowerCase())) out.push(l);
  };
  for (const a of input.assignees ?? []) add(a.login);
  if (input.doneAt) {
    for (const c of input.commits) {
      if (isDoneCommit(c)) continue;
      const at = c.commit.author?.date ?? c.commit.committer?.date ?? '';
      if (at && at > input.doneAt && !/claude/i.test(c.author?.login ?? '') && !/claude/i.test(c.commit.author?.name ?? '')) add(c.author?.login ?? null);
    }
  }
  return out;
}

/**
 * The activity after Done exploring: "said done exploring" with the branch's events, newest first, the last 3. The
 * commit before it is the explorer's work, the ones after are the developers'.
 */
export function handoffActivity(input: { commits: readonly BranchCommitLike[]; author: string; startedAt?: string | null; doneBy: string | null; doneAt: string | null; names?: Record<string, string>; now?: Date }): ActivityRow[] {
  const events = explorationActivity({ commits: input.commits.filter((c) => !isDoneCommit(c)), author: input.author, startedAt: input.startedAt ?? null });
  const all = input.doneAt ? [...events, { who: input.doneBy ?? input.author, claude: false, text: 'said done exploring', at: input.doneAt }] : events;
  return all
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3)
    .map((e) => ({ who: faceOf(e.who, e.claude, input.names, 'withClaude' in e && Boolean(e.withClaude)), text: e.text, when: shortAgo(e.at, input.now) }));
}

/** One piece the library gets from this exploration, with its request status. */
export interface SentPiece {
  id: string;
  title: string;
  /** Where it opens in Studio, when it has a library side. */
  href: string | null;
  /** "In review · Dana reviews", "Requested", or null with no library side yet. */
  line: string | null;
  tone: TagTone | 'danger';
  /** A token swatch, when the piece is a value. */
  value?: string | null;
  /** How Studio opens it in place (data-open-<opens>="<number>"), when it has a library side. */
  opens?: 'pr' | 'exploration' | 'request' | 'suggestion';
  number?: number;
  /** Its one action (send it to the library, use its preview, switch to the published version), when offered. */
  action?: { kind: 'open' | 'use-preview' | 'refresh-preview' | 'switch'; label: string } | null;
}

/**
 * What the hand-off card says about the library: the pieces (loading, being checked, the rows, nothing missing), or
 * not checked yet (with the way to check it in Claude when Bridge cannot run the check for this viewer).
 */
export type LibraryPieces =
  | { state: 'loading' }
  | { state: 'checking' }
  | { state: 'rows'; rows: SentPiece[] }
  | { state: 'none' }
  | { state: 'unchecked'; claude: string | null }
  | { state: 'hidden' };

/** A library exploration's requests (the library side it already has), as sent pieces. */
export function requestPieces(requests: readonly { number: number; title: string; component: string; statusLabel: string; open: boolean }[]): SentPiece[] {
  return requests.map((q) => ({ id: `request-${q.number}`, title: q.component || q.title, href: `?request=${q.number}`, line: q.statusLabel, tone: q.open ? 'info' : 'success', opens: 'request', number: q.number }));
}

/** The line to paste in Claude to check an exploration against the library, when Bridge cannot run it itself. */
export const checkInClaudeLine = (name: string, ref: string) => `Check what the exploration "${name}" (${ref}) adds that the library does not have, and record it in Bridge.`;

/** The screen a fallback preview names: the first changed screen or component, else null. */
export const changedScreenOf = (files: readonly string[] | null | undefined): string | null => changedThings(files ?? [])[0] ?? null;
