// The Overview to-do list, sorted by kind of work, not only by person. Pure: no DOM, no fetch. Unit tested in
// overview-todo.test.ts.
//
//   - For you: the decisions a designer or design system owner makes in the Studio. Review the design of a change,
//     ship one that is approved, decide on a request nobody is on, review usage guidance. Ordered by what unblocks
//     the most, each with the exact task on its button and what happens once it is done.
//   - Waiting on a developer: technical blockers (failing tests, a clash with the latest library, a missing release
//     note, a draft, changes a reviewer asked for, the tech review). One quiet folded line that names the blocker and
//     who is expected, never a designer action: only a link to the change. A viewer who also holds the tech
//     approval still finds those items here, never as their main task.
//   - Waiting on someone else: what another person decides, or tests still running.
//
// Sources, never guessed: the review queue with who acts now (lib/changes whoActs, the same rule as the change
// detail), the failing check names, whether the visual impact run published before and after images, the component
// change requests (lib/requests-view rows) and, for owners, the library protection state.
import type { RequestStatus } from '@bridge-ds/core';
import type { WhoActs } from './changes';
import { wantsToChange } from './requests-view';

/**
 * What the row asks for. The first four are decisions; blocked rows wait on a developer; waiting rows on another
 * person; checking rows on the tests or GitHub, nobody.
 */
export type TodoTask = 'design' | 'ship' | 'decide' | 'guidance' | 'setup' | 'assigned' | 'blocked' | 'waiting' | 'checking';

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
}

export interface TodoChange {
  number: number;
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
}

export interface TodoRequest {
  number: number;
  component: string;
  title: string;
  status: RequestStatus;
  requester: string;
  assignees: string[];
  prs: { state: 'open' | 'closed'; merged: boolean; author: string | null }[];
}

export interface TodoInput {
  /** The review queue, most urgent first (byUrgency). */
  changes: TodoChange[];
  requests: TodoRequest[];
  /** GitHub login of the connected person, null when nobody is connected. */
  viewer: string | null;
  /** governance.owners after rights, both roles. They decide on the requests nobody is on. */
  owners: string[];
  /** The library has no protection and the viewer is an owner (lib/protection-view overviewProtectionLine). */
  unprotected?: boolean;
  /** Statuses are still loading: a change without one is being checked, not unreadable. */
  loading?: boolean;
}

export interface Todo {
  /** "2 decisions wait for you." The Fraunces line of the greeting. Counts only the For you rows. */
  headline: string;
  /** For you: designer decisions, ordered by what unblocks the most. Signed out: the decisions, naming who makes them. */
  mine: TodoRow[];
  /** Waiting on a developer: technical blockers, link only. */
  developer: TodoRow[];
  /** Waiting on someone else: another person decides, or tests still run. */
  others: TodoRow[];
}

/** Rows shown before "Show all". */
export const TODO_MAX = 3;

/** For you, what unblocks the most first: design approvals, ship, requests to decide, guidance. */
const ORDER: Record<TodoTask, number> = { design: 0, ship: 1, decide: 2, guidance: 3, setup: 4, assigned: 5, blocked: 6, waiting: 7, checking: 8 };
const DECISIONS = new Set<TodoTask>(['design', 'ship', 'decide', 'guidance']);

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && norm(a) === norm(b));
const handle = (x: string) => `@${x.replace(/^@/, '')}`;
const at = (xs: string[]) => (xs.length <= 2 ? xs.map(handle).join(' or ') : `${handle(xs[0]!)} or ${xs.length - 1} more`);
const changeHref = (n: number) => `/studio/changes/?pr=${n}`;
const requestHref = (n: number) => `/studio/changes/?request=${n}`;

/** The changeset check, the only failing check a designer can read in plain words: "the release note is missing". */
const isReleaseNoteCheck = (name: string) => /changeset/i.test(name);

/** What blocks a change in plain words, and what the developer does about it. Null: not a technical blocker. */
function blocker(c: TodoChange, who: WhoActs, viewer: string | null): { what: string; fix: string } | null {
  switch (who.action) {
    case 'fix-checks': {
      const names = c.failingChecks ?? [];
      if (names.length && names.every(isReleaseNoteCheck)) return { what: 'the release note is missing', fix: 'add it' };
      const n = c.failing ?? names.length;
      if (n === 1) return { what: 'a test fails', fix: 'fix it' };
      return { what: n > 1 ? `${n} tests fail` : 'tests fail', fix: 'fix them' };
    }
    case 'resolve-conflict':
      return { what: 'it clashes with the latest library', fix: 'update it' };
    case 'address-changes': {
      const by = c.changesBy ?? [];
      const asker = by.some((b) => same(b, viewer)) ? 'you' : by.length ? at(by) : 'a reviewer';
      return { what: `${asker} asked for changes`, fix: 'make them' };
    }
    case 'mark-ready':
      return { what: 'it is still a draft', fix: 'finish it' };
    case 'promote':
      return { what: 'it is still an exploration', fix: 'send it for review' };
    default:
      return null;
  }
}

/** The row of a change, sorted into For you, Waiting on a developer or Waiting on someone else. */
function changeRow(c: TodoChange, input: TodoInput): { group: 'mine' | 'developer' | 'others'; row: TodoRow } {
  const { viewer } = input;
  const base = { key: `change-${c.number}`, kind: 'change' as const, title: c.title, href: changeHref(c.number) };
  const open = (group: 'mine' | 'developer' | 'others', task: TodoTask, why: string) => ({ group, row: { ...base, task, why, action: 'Open change' } });
  const who = c.who;
  if (!who) return open('others', input.loading ? 'checking' : 'waiting', input.loading ? 'Checking what it needs.' : 'Open it to see what it needs.');

  // Technical blockers: named, delegated to the author, or to "a developer" when the author is the viewer.
  const block = blocker(c, who, viewer);
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
  return { group: 'mine', row: { ...base, task, ...yourTask(c, who, task) } };
}

/** The exact task of a change that waits for the viewer, and what happens once it is done. */
function yourTask(c: TodoChange, who: WhoActs, task: TodoTask): { why: string; action: string } {
  if (task === 'ship') return { why: 'Approved and tested. Shipping puts it in the next release.', action: 'Ship' };
  const override = who.action === 'override';
  if (task === 'guidance') {
    if (override) return { why: 'Usage guidance changed and no other owner can approve it. Read it, then ship it with the owner override.', action: 'Review guidance' };
    return { why: 'Usage guidance changed. Read it, then approve it or edit it.', action: 'Review guidance' };
  }
  const seen = c.visual === 'ready' ? 'Before and after are ready. ' : c.visual === 'none' ? 'Nothing changes on screen. ' : '';
  if (override) return { why: `${seen}No other owner can approve it. Check the design, then ship it with the owner override.`, action: 'Review design' };
  // One approval ships it; a design approval is one of two (the tech review comes after).
  if (who.action === 'approve') return { why: `${seen}Your approval lets it ship.`, action: 'Review design' };
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

/** "2 decisions wait for you", "1 decision and a setup step wait for you". */
function headlineFor(mine: TodoRow[], viewer: string | null): string {
  const decisions = mine.filter((r) => DECISIONS.has(r.task)).length;
  if (!viewer) return decisions ? `${plural(decisions, 'decision waits', 'decisions wait')}.` : 'Nothing waits for a decision.';
  const assigned = mine.filter((r) => r.task === 'assigned').length;
  const setup = mine.filter((r) => r.task === 'setup').length;
  const parts = [decisions ? plural(decisions, 'decision', 'decisions') : '', assigned ? plural(assigned, 'request assigned to you', 'requests assigned to you') : '', setup ? 'a setup step' : ''].filter(Boolean);
  if (!parts.length) return 'Nothing needs you right now.';
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]!;
  const one = decisions + assigned + setup === 1;
  // "1 request assigned to you waits." reads better without a second "for you".
  const line = `${words} ${one ? 'waits' : 'wait'}${assigned && !decisions && !setup ? '' : ' for you'}.`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The greeting's to-do list. */
export function overviewTodo(input: TodoInput): Todo {
  const { viewer } = input;
  const groups = { mine: [] as TodoRow[], developer: [] as TodoRow[], others: [] as TodoRow[] };
  const owner = Boolean(viewer && input.owners.some((o) => same(o, viewer)));

  for (const c of input.changes) {
    const { group, row } = changeRow(c, input);
    groups[group].push(row);
  }

  if (input.unprotected && owner) groups.mine.push({ key: 'protect', kind: 'setup', task: 'setup', title: 'Protect your library', why: 'Anyone can change it without a review. Protecting it asks for one first.', action: 'Protect it', href: '/studio/settings/#protection' });

  for (const r of input.requests) {
    // In progress: its change is in the list above. Done and declined wait for nobody.
    if (r.status !== 'requested') continue;
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
      const by = input.owners.length ? `a design system owner (${at(input.owners)})` : 'a design system owner';
      const row = requestRow(r, viewer ? 'waiting' : 'decide', `Waiting for ${by} to decide.`, 'Open request');
      (viewer ? groups.others : groups.mine).push(row);
    }
  }

  // Stable: the queue's urgency order holds inside each task.
  const mine = groups.mine.map((r, i) => ({ r, i })).sort((a, b) => ORDER[a.r.task] - ORDER[b.r.task] || a.i - b.i).map((x) => x.r);
  return { headline: headlineFor(mine, viewer), mine, developer: groups.developer, others: groups.others };
}

/** The folded developer line: "3 changes wait on a developer". */
export function developerLine(n: number): string {
  return n ? `${n} ${n === 1 ? 'change waits' : 'changes wait'} on a developer` : '';
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

/** Only usage guidance changes: every file is a component docs.json, plus its release note. */
export function isGuidanceOnly(files: string[]): boolean {
  const docs = (f: string) => /(^|\/)[A-Z]\w*\.docs\.json$/.test(f);
  return files.some(docs) && files.every((f) => docs(f) || /^\.changeset\/[^/]+\.md$/.test(f));
}

/** A guidance change: opened from the Library editor (its docs/ branch) or, once its files are read, guidance only. */
export const isGuidanceChange = (branch: string, guidanceOnly: boolean | undefined) => guidanceOnly ?? branch.startsWith('docs/');
