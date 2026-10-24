// The Overview "Needs you" list, sorted by kind of work, not only by person. Pure: no DOM, no fetch. Unit tested in
// overview-todo.test.ts.
//
//   - Needs you (mine): every decision a designer or design system owner makes in the Studio, in one list with one
//     row component. Review the design of a change, ship one that is approved, decide on a request nobody is on,
//     review or write usage guidance, protect the library. Ordered by what unblocks the most, each with the exact
//     task on its button and what happens once it is done. The greeting counts exactly these rows.
//   - Developer work (lib/work-nature: code only, no design decision) never shows here, nor in the Changes badge:
//     the board folds it into one quiet line and Changes tags it.
//   - Waiting on a developer and waiting on someone else: kept for the counts. The Overview shows these changes on
//     its In flight board (lib/overview-board.ts), the blocker written on the card (blockerOf below).
//
// Sources, never guessed: the review queue with who acts now (lib/changes whoActs, the same rule as the change
// detail), the failing check names, whether the visual impact run published before and after images, the component
// change requests (lib/requests-view rows), the usage guidance state of each component and, for owners, the library
// protection state.
import type { RequestStatus } from '@bridge-ds/core';
import type { WhoActs } from './changes';
import { wantsToChange } from './requests-view';
import type { WorkNature } from './work-nature';
import { todoBadge, type Lifecycle, type LifecycleTone } from './change-status';
import { VOCAB } from './vocabulary';

import { REQUEST_TRIAGE_IN_STUDIO } from './studio-flags';
import { studioHref } from './team-path';

/**
 * Request triage (decide, assign, decline component change requests) is off in Studio: teams triage in Jira. The
 * request rows below stay in the code and come back with the flag (lib/studio-flags), or per call with
 * TodoInput.requestTriage.
 */
export { REQUEST_TRIAGE_IN_STUDIO };

/**
 * What the row asks for. The first four are decisions; blocked rows wait on a developer; waiting rows on another
 * person; checking rows on the tests or GitHub, nobody.
 */
export type TodoTask = 'design' | 'ship' | 'decide' | 'guidance' | 'finish' | 'setup' | 'assigned' | 'blocked' | 'waiting' | 'checking';

export interface TodoRow {
  key: string;
  kind: 'change' | 'request' | 'setup';
  task: TodoTask;
  /** What: the change or request title. */
  title: string;
  /** Why it waits and what happens once it is done: "Before and after are ready. Your approval lets it ship." */
  why: string;
  /** The button, labelled by the exact task: "Review design", "Ship", "Decide", "Review guidance". */
  action: string;
  href: string;
  /** A change row: its lifecycle badge, in the words of the change status line (lib/change-status). */
  state?: { lifecycle: Lifecycle; label: string; tone: LifecycleTone };
}

export interface TodoChange {
  number: number;
  /** A token push from Figma that ships after the checks: never waits on anyone (lib/waiting-on). */
  autoShip?: boolean;
  /** Already in plain words (humanTitle, one line). */
  title: string;
  /** Null while the status is not read yet. */
  who: WhoActs | null;
  /** Failing checks, when the status says tests fail. */
  failing?: number;
  /** Names of the failing checks ("Changeset present"), to say which blocker in plain words. */
  failingChecks?: string[];
  /** Reviewers whose latest review asks for changes. */
  changesBy?: string[];
  /**
   * Before and after images: `ready` once the visual impact run published them for the latest version, `none` when
   * the change touches nothing visual. Absent while unknown.
   */
  visual?: 'ready' | 'none' | null;
  /** Only usage guidance changes (docs files, or opened from the Library editor). */
  guidance?: boolean;
  /** Design or developer work (lib/work-nature). Absent: design. */
  nature?: WorkNature;
  /** A real marker says an AI agent made it (lib/work-nature agentMade). */
  agent?: boolean;
  /** Draft, Ready for review, Approved waiting for code (lib/change-status rowLifecycle). Absent: not known. */
  lifecycle?: Lifecycle;
}

export interface TodoRequest {
  number: number;
  component: string;
  title: string;
  status: RequestStatus;
  requester: string;
  assignees: string[];
  prs: { state: 'open' | 'closed'; merged: boolean; author: string | null }[];
  /** Design or developer work (lib/work-nature). Absent: design. */
  nature?: WorkNature;
}

export interface TodoInput {
  /** The review queue, most urgent first (byUrgency). */
  changes: TodoChange[];
  requests: TodoRequest[];
  /** GitHub login of the connected person, null when nobody is connected. */
  viewer: string | null;
  /** governance.owners after rights, both roles, GitHub teams expanded to their members. They decide on the requests nobody is on. */
  owners: string[];
  /** The same owners as the config names them, for the sentence ("@acme/design (4 people)"). Absent: `owners`. */
  ownerNames?: string[];
  /** The library has no protection and the viewer is an owner (lib/protection-view overviewProtectionLine). */
  unprotected?: boolean;
  /** Statuses are still loading: a change without one is being checked, not unreadable. */
  loading?: boolean;
  /**
   * Usage guidance from the repo (build time): components whose guidance Claude drafted and nobody reviewed yet, and
   * components with none. Each list becomes one row, for anyone: reviewing guidance is a designer decision.
   */
  guidance?: { drafted: GuidanceItem[]; missing: GuidanceItem[] };
  /** Show the component change request rows (triage). Default REQUEST_TRIAGE_IN_STUDIO: off. */
  requestTriage?: boolean;
}

export interface GuidanceItem {
  name: string;
  /** The Library page in edit mode. */
  href: string;
}

export interface Todo {
  /** "2 things need you." The Fraunces line of the greeting. Counts every Needs you row. */
  headline: string;
  /** For you: designer decisions, ordered by what unblocks the most. Signed out: the decisions, naming who makes them. */
  mine: TodoRow[];
  /** Waiting on a developer: technical blockers, link only. */
  developer: TodoRow[];
  /** Waiting on someone else: another person decides, or tests still run. */
  others: TodoRow[];
  /** Developer work, kept out of every list above (the board folds it into one line). */
  devWork: TodoRow[];
}

/** Rows shown before "Show all". */
export const TODO_MAX = 3;

/** For you, what unblocks the most first: design approvals, ship, requests to decide, guidance. */
const ORDER: Record<TodoTask, number> = { design: 0, ship: 1, decide: 2, guidance: 3, finish: 4, setup: 5, assigned: 6, blocked: 7, waiting: 8, checking: 9 };

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && norm(a) === norm(b));
const handle = (x: string) => `@${x.replace(/^@/, '')}`;
const at = (xs: string[]) => (xs.length <= 2 ? xs.map(handle).join(' or ') : `${handle(xs[0]!)} or ${xs.length - 1} more`);
const changeHref = (n: number) => studioHref(`changes/?pr=${n}`);
const requestHref = (n: number) => studioHref(`changes/?request=${n}`);

/** The changeset check, the only failing check a designer can read in plain words: "the release note is missing". */
const isReleaseNoteCheck = (name: string) => /changeset/i.test(name);

/** What blocks a change in plain words, and what the developer does about it. Null: not a technical blocker. */
export function blockerOf(c: TodoChange, who: WhoActs, viewer: string | null): { what: string; fix: string } | null {
  switch (who.action) {
    case 'fix-checks': {
      const names = c.failingChecks ?? [];
      if (names.length && names.every(isReleaseNoteCheck)) return { what: 'the release note is missing', fix: 'add it' };
      const n = c.failing ?? names.length;
      if (n === 1) return { what: 'a test fails', fix: 'fix it' };
      return { what: n > 1 ? `${n} tests fail` : 'tests fail', fix: 'fix them' };
    }
    case 'resolve-conflict':
      return { what: `it clashes with ${VOCAB.main}`, fix: 'update it' };
    case 'address-changes': {
      const by = c.changesBy ?? [];
      const asker = by.some((b) => same(b, viewer)) ? 'you' : by.length ? at(by) : 'a reviewer';
      return { what: `${asker} asked for changes`, fix: 'make them' };
    }
    case 'mark-ready':
      return { what: 'it is still a draft', fix: 'finish it' };
    case 'promote':
      return { what: 'it is still an exploration', fix: 'request a review' };
    default:
      return null;
  }
}

/** The row of a change, sorted into For you, Waiting on a developer or Waiting on someone else. */
type Group = 'mine' | 'developer' | 'others' | 'devWork';

function changeRow(c: TodoChange, input: TodoInput): { group: Group; row: TodoRow } {
  const { viewer } = input;
  const base = { key: `change-${c.number}`, kind: 'change' as const, title: c.title, href: changeHref(c.number) };
  // The lifecycle badge of the row, in the same words and tone as the status line (lib/change-status todoBadge). Only when the state is known.
  const state = c.lifecycle ? { state: { lifecycle: c.lifecycle, ...todoBadge(c.lifecycle) } } : {};
  const open = (group: Group, task: TodoTask, why: string) => ({ group, row: { ...base, task, why, action: 'Open branch', ...state } });
  // Code only: no design decision waits on anyone in the Studio.
  if (c.nature === 'developer') return open('devWork', 'waiting', 'Developer work.');
  const who = c.who;
  if (!who) return open('others', input.loading ? 'checking' : 'waiting', input.loading ? 'Checking what it needs.' : 'Open it to see what it needs.');
  // Approved, waiting for code: the design side is done, a developer finishes it. No designer action.
  if (c.lifecycle === 'waiting') return open('developer', 'blocked', 'Design is approved. A developer finishes the code before it is merged.');
  // The viewer's own draft (not one an agent made with their account): marking it ready is theirs to do.
  if (who.action === 'mark-ready' && who.yourTurn && viewer && !c.agent)
    return { group: 'mine', row: { ...base, task: 'finish', why: 'Reviewers are not asked until you request a review.', action: 'Open draft', ...state } };

  // Technical blockers: named, delegated to the author, or to "a developer" when the author is the viewer.
  const block = blockerOf(c, who, viewer);
  if (block) {
    const author = who.logins[0];
    const actor = !author || same(author, viewer) || who.who === 'you' ? 'A developer' : handle(author);
    return open('developer', 'blocked', `Blocked: ${block.what}. ${actor} needs to ${block.fix} before ${viewer ? 'you review' : 'review'}.`);
  }
  // The tech review is developer work, even for a viewer who holds that right too.
  if (who.action === 'approve-tech') return open('developer', 'blocked', who.yourTurn ? 'Design is approved. It waits for your tech review.' : `Design is approved. ${who.sentence}`);

  const yours = Boolean(viewer) && (who.yourTurn || (who.action === 'override' && who.logins.some((l) => same(l, viewer))));
  const task: TodoTask | null =
    who.action === 'merge' ? 'ship' : ['approve-design', 'approve', 'override'].includes(who.action) ? (c.guidance ? 'guidance' : 'design') : null;
  if (!task) return open('others', who.action === 'wait' ? 'checking' : 'waiting', who.sentence);
  // Signed out nobody is "you": the decision shows with who makes it, the button only opens the change.
  if (!viewer) return open('mine', task, who.sentence);
  if (!yours) return open('others', 'waiting', who.sentence);
  return { group: 'mine', row: { ...base, task, ...yourTask(c, who, task), ...state } };
}

/** The exact task of a change that waits for the viewer, and what happens once it is done. */
function yourTask(c: TodoChange, who: WhoActs, task: TodoTask): { why: string; action: string } {
  if (task === 'ship') return { why: 'Approved and tested. Merging puts it in the next release.', action: VOCAB.merge };
  const override = who.action === 'override';
  if (task === 'guidance') {
    if (override) return { why: 'Usage guidance changed and no other owner can approve it. Read it, then merge it with the owner override.', action: 'Review guidance' };
    return { why: 'Usage guidance changed. Read it, then approve it or edit it.', action: 'Review guidance' };
  }
  const seen = c.visual === 'ready' ? 'Before and after are ready. ' : c.visual === 'none' ? 'Nothing changes on screen. ' : '';
  if (override) return { why: `${seen}No other owner can approve it. Check the design, then merge it with the owner override.`, action: 'Review design' };
  // One approval ships it; a design approval is one of two (the tech review comes after).
  if (who.action === 'approve') return { why: `${seen}Your approval lets it merge.`, action: 'Review design' };
  return { why: `${seen}Your design approval is the next step.`, action: 'Review design' };
}

/** Who is on a request: the assignee, else the author of the open (then shipped) change that closes it. */
function onIt(r: TodoRequest): string | null {
  const pr = r.prs.find((p) => p.state === 'open' && p.author) ?? r.prs.find((p) => p.merged && p.author);
  return r.assignees[0] ?? pr?.author ?? null;
}

function requestRow(r: TodoRequest, task: TodoTask, why: string, action: string): TodoRow {
  return { key: `request-${r.number}`, kind: 'request', task, title: r.title, why: `${wantsToChange(r.requester, r.component)}. ${why}`, action, href: requestHref(r.number) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The greeting line, one count for every row of Needs you so the sentence and the list never disagree: "1 thing
 * needs you.", "You're all caught up.". Signed out nobody is "you": "2 decisions wait."
 */
export function headlineFor(mine: Pick<TodoRow, 'task'>[], viewer: string | null): string {
  const n = mine.length;
  if (!viewer) return SIGNED_OUT_LINE;
  return n ? `${plural(n, 'thing needs', 'things need')} you.` : "You're all caught up.";
}

/** Signed out, the Overview asks for one thing: connecting GitHub. */
export const SIGNED_OUT_LINE = 'Connect GitHub to start working on the library.';

/** The signed-out line in the words of the site's one way in: Sign in with GitHub when it has a GitHub App. */
export const signedOutLine = (signIn: boolean): string => (signIn ? 'Sign in with GitHub to start working on the library.' : SIGNED_OUT_LINE);

/**
 * The one-line greeting: "Hello, Florian. 1 thing needs you." with the first word of the GitHub profile name, else
 * "Hello." (never the login, never a stored name). Signed out: the connect line alone.
 */
export function greetingLine(profileName: string | null | undefined, headline: string, viewer: string | null): string {
  if (!viewer) return headline;
  const first = profileName?.trim().split(/\s+/)[0];
  return `${first ? `Hello, ${first}.` : 'Hello.'} ${headline}`;
}

const names = (xs: GuidanceItem[]) => (xs.length <= 2 ? xs.map((x) => x.name).join(' and ') : `${xs.slice(0, 2).map((x) => x.name).join(', ')} and ${xs.length - 2} more`);

/** One row per guidance state: drafted by Claude (review it), then missing (write it). */
function guidanceRows(g: NonNullable<TodoInput['guidance']>): TodoRow[] {
  const out: TodoRow[] = [];
  if (g.drafted.length)
    out.push({
      key: 'guidance-drafted',
      kind: 'setup',
      task: 'guidance',
      title: `Usage guidance of ${names(g.drafted)}`,
      why: 'Claude drafted it from the code. Read it, fix it, then mark it reviewed.',
      action: 'Review guidance',
      href: g.drafted[0]!.href,
    });
  if (g.missing.length)
    out.push({
      key: 'guidance-missing',
      kind: 'setup',
      task: 'guidance',
      title: `Usage guidance of ${names(g.missing)}`,
      why: 'Not written yet. Start from what the code tells: props, tokens and anatomy.',
      action: 'Write guidance',
      href: g.missing[0]!.href,
    });
  return out;
}

/** The greeting's to-do list. */
export function overviewTodo(input: TodoInput): Todo {
  const { viewer } = input;
  const groups: Record<Group, TodoRow[]> = { mine: [], developer: [], others: [], devWork: [] };
  const owner = Boolean(viewer && input.owners.some((o) => same(o, viewer)));

  for (const c of input.changes) {
    const { group, row } = changeRow(c, input);
    groups[group].push(row);
  }

  if (input.unprotected && owner) groups.mine.push({ key: 'protect', kind: 'setup', task: 'setup', title: 'Protect your library', why: 'Anyone can change it without a review. Protecting it asks for one first.', action: 'Protect it', href: studioHref('settings/#protection') });

  for (const r of (input.requestTriage ?? REQUEST_TRIAGE_IN_STUDIO) ? input.requests : []) {
    // In progress: its change is in the list above. Done and declined wait for nobody.
    if (r.status !== 'requested') continue;
    if (r.nature === 'developer') {
      groups.devWork.push(requestRow(r, 'waiting', 'Developer work.', 'Open request'));
      continue;
    }
    const who = onIt(r);
    if (who) {
      if (same(who, viewer)) groups.mine.push(requestRow(r, 'assigned', 'Assigned to you. Nobody has started the work yet.', 'Open request'));
      else groups.others.push(requestRow(r, 'waiting', `Waiting for ${handle(who)} to start it.`, 'Open request'));
      continue;
    }
    // A change already linked (an exploration): someone works on it, nothing to decide.
    if (r.prs.length) continue;
    if (owner) groups.mine.push(requestRow(r, 'decide', 'Start an exploration, assign someone or decline it.', 'Decide'));
    else {
      const names = input.ownerNames?.length ? input.ownerNames : input.owners.map(handle);
      const by = names.length ? `a design system owner (${names.length <= 2 ? names.join(' or ') : `${names[0]} or ${names.length - 1} more`})` : 'a design system owner';
      const row = requestRow(r, viewer ? 'waiting' : 'decide', `Waiting for ${by} to decide.`, 'Open request');
      (viewer ? groups.others : groups.mine).push(row);
    }
  }

  if (input.guidance) groups.mine.push(...guidanceRows(input.guidance));

  // Stable: the queue's urgency order holds inside each task.
  const mine = groups.mine.map((r, i) => ({ r, i })).sort((a, b) => ORDER[a.r.task] - ORDER[b.r.task] || a.i - b.i).map((x) => x.r);
  return { headline: headlineFor(mine, viewer), mine, developer: groups.developer, others: groups.others, devWork: groups.devWork };
}

/** The folded developer line: "3 branches wait on a developer". */
export function developerLine(n: number): string {
  return n ? `${n} ${n === 1 ? `${VOCAB.branch} waits` : `${VOCAB.branches} wait`} on a developer` : '';
}

/**
 * The folded line about the rest, saying on what they wait: "2 more wait on someone else", "1 is being checked",
 * "3 more wait on someone else or on checks". "more" only when the For you list shows above.
 */
export function othersLine(others: Pick<TodoRow, 'task'>[], mine: number): string {
  const n = others.length;
  if (!n) return '';
  const checking = others.filter((r) => r.task === 'checking').length;
  const more = mine ? 'more ' : '';
  if (checking === n) return `${n} ${more}${n === 1 ? 'is' : 'are'} being checked`;
  return `${n} ${more}${n === 1 ? 'waits' : 'wait'} on someone else${checking ? ' or on checks' : ''}`;
}

/** "Show all 5" when the list is cut at TODO_MAX, else empty. */
export function showAllLabel(mine: number): string {
  return mine > TODO_MAX ? `Show all ${mine}` : '';
}

/** The Needs you rows that are changes in review: the designer decisions the Changes nav badge counts (not own drafts). */
export const reviewDecisions = (mine: Pick<TodoRow, 'kind' | 'task'>[]) => mine.filter((r) => r.kind === 'change' && r.task !== 'finish').length;

/**
 * The Changes nav badge: how many changes in review wait on the viewer's decision. The same rule as the Overview
 * Needs you list (overviewTodo, then reviewDecisions), so the badge and the list never disagree. 0 signed out.
 */
export function reviewNeedsYou(input: Pick<TodoInput, 'changes' | 'viewer' | 'owners' | 'ownerNames' | 'loading'>): number {
  if (!input.viewer) return 0;
  return reviewDecisions(overviewTodo({ ...input, requests: [] }).mine);
}

/** Needs you rows shown before "Show 2 more", which opens the rest in place. */
export const NEEDS_MAX = 5;

/** "Show 2 more" when the Needs you list is cut at NEEDS_MAX, else empty. */
export function moreLabel(n: number, max = NEEDS_MAX): string {
  return n > max ? `Show ${n - max} more` : '';
}

/** Only usage guidance changes: every file is a component docs.json, plus its release note. */
export function isGuidanceOnly(files: string[]): boolean {
  const docs = (f: string) => /(^|\/)[A-Z]\w*\.docs\.json$/.test(f);
  return files.some(docs) && files.every((f) => docs(f) || /^\.changeset\/[^/]+\.md$/.test(f));
}

/** A guidance change: opened from the Library editor (its docs/ branch) or, once its files are read, guidance only. */
export const isGuidanceChange = (branch: string, guidanceOnly: boolean | undefined) => guidanceOnly ?? branch.startsWith('docs/');
