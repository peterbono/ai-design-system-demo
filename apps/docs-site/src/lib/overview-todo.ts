// The Overview to-do list: what waits for the connected person, one row per thing, each with what it is, why it waits
// in plain words, and the button that does the task. What waits on someone else folds into one quiet line. Pure: no
// DOM, no fetch. Unit tested in overview-todo.test.ts.
//
// Sources, never guessed: the review queue with who acts now (lib/changes whoActs, the same rule as the change
// detail), the component change requests (lib/requests-view rows) and, for owners, the library protection state.
import type { RequestStatus } from '@bridge-ds/core';
import type { WhoActs } from './changes';

export interface TodoRow {
  key: string;
  kind: 'change' | 'request' | 'setup';
  /** What: the change or request title. */
  title: string;
  /** Why it waits, in plain words: "Tests fail. Fix them or ask a developer." */
  why: string;
  /** The button, labelled by the task: "Review", "Open change", "Open request". */
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
  /** governance.owners, both roles. They pick up the requests nobody is on. */
  owners: string[];
  /** The library has no protection and the viewer is an owner (lib/protection-view overviewProtectionLine). */
  unprotected?: boolean;
  /** Statuses are still loading: a change without one is being checked, not unreadable. */
  loading?: boolean;
}

export interface Todo {
  /** "1 change waits for you." The Fraunces line of the greeting. */
  headline: string;
  /** Rows for the connected person, or every row when nobody is connected (nobody is "you"). */
  mine: TodoRow[];
  /** Rows that wait on someone else (connected only), each naming who. */
  others: TodoRow[];
}

/** Rows shown before "Show all". */
export const TODO_MAX = 3;

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && norm(a) === norm(b));
const at = (xs: string[]) => (xs.length <= 2 ? xs.map((x) => `@${x.replace(/^@/, '')}`).join(' or ') : `@${xs[0]!.replace(/^@/, '')} or ${xs.length - 1} more`);
const changeHref = (n: number) => `/studio/changes/?pr=${n}`;
const requestHref = (n: number) => `/studio/changes/?request=${n}`;

function tests(n: number | undefined): string {
  if (n === 1) return 'A test fails. Fix it or ask a developer.';
  if (n && n > 1) return `${n} tests fail. Fix them or ask a developer.`;
  return 'Tests fail. Fix them or ask a developer.';
}

/** The why and the button of a change that waits for the viewer, from what whoActs says they do. */
function yourTask(c: TodoChange, who: WhoActs): { why: string; action: string } {
  switch (who.action) {
    case 'approve-design':
      return { why: 'Needs your design approval.', action: 'Review' };
    case 'approve-tech':
      return { why: 'Needs your tech approval.', action: 'Review' };
    case 'approve':
      return { why: 'Needs your approval.', action: 'Review' };
    case 'fix-checks':
      return { why: tests(c.failing), action: 'Open change' };
    case 'address-changes':
      return { why: 'A reviewer asked for changes. Answer them.', action: 'Open change' };
    case 'resolve-conflict':
      return { why: 'It clashes with the latest library. Update it or ask a developer.', action: 'Open change' };
    case 'mark-ready':
      return { why: 'Still a draft. Send it for review when it is done.', action: 'Open draft' };
    case 'promote':
      return { why: 'An exploration. Send it for review, or close it.', action: 'Open exploration' };
    case 'merge':
      return { why: 'Approved and tested. Ship it when you are ready.', action: 'Review and ship' };
    case 'override':
      return { why: 'No other owner can approve. You can ship it with the owner override.', action: 'Open change' };
    default:
      return { why: who.sentence, action: 'Open change' };
  }
}

/**
 * Whether a change waits for the viewer. whoActs says so, plus one case it leaves to the detail page: every other
 * owner wrote or approved the change and the viewer is the one who may ship it with the owner override.
 */
function isMine(who: WhoActs, viewer: string | null): boolean {
  if (!viewer) return false;
  return who.yourTurn || (who.action === 'override' && who.logins.some((l) => same(l, viewer)));
}

/** Who is on a request: the assignee, else the author of the open (then shipped) change that closes it. */
function onIt(r: TodoRequest): string | null {
  const pr = r.prs.find((p) => p.state === 'open' && p.author) ?? r.prs.find((p) => p.merged && p.author);
  return r.assignees[0] ?? pr?.author ?? null;
}

function requestRow(r: TodoRequest, why: string, action: string): TodoRow {
  return { key: `request-${r.number}`, kind: 'request', title: `${r.component}: ${r.title}`, why, action, href: requestHref(r.number) };
}

/** "1 change waits", "2 requests wait", "1 change and 2 requests wait". */
function counted(changes: number, requests: number, setup: number): string {
  const parts = [changes ? `${changes} ${changes === 1 ? 'change' : 'changes'}` : '', requests ? `${requests} ${requests === 1 ? 'request' : 'requests'}` : ''].filter(Boolean);
  const total = changes + requests + setup;
  if (!parts.length) return `${total} ${total === 1 ? 'thing waits' : 'things wait'}`;
  const one = total === 1;
  if (setup) parts.push(setup === 1 ? 'a setup step' : `${setup} setup steps`);
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]!;
  return `${words} ${one ? 'waits' : 'wait'}`;
}

/** The greeting's to-do list. */
export function overviewTodo(input: TodoInput): Todo {
  const { viewer } = input;
  const mine: TodoRow[] = [];
  const others: TodoRow[] = [];
  const owner = Boolean(viewer && input.owners.some((o) => same(o, viewer)));

  for (const c of input.changes) {
    const base = { key: `change-${c.number}`, kind: 'change' as const, title: c.title, href: changeHref(c.number) };
    if (!c.who) {
      (viewer ? others : mine).push({ ...base, why: input.loading ? 'Checking what it needs.' : 'Open it to see what it needs.', action: 'Open change' });
      continue;
    }
    if (isMine(c.who, viewer)) mine.push({ ...base, ...yourTask(c, c.who) });
    else (viewer ? others : mine).push({ ...base, why: c.who.sentence, action: 'Open change' });
  }

  if (input.unprotected && owner) mine.push({ key: 'protect', kind: 'setup', title: 'Protect your library', why: 'Anyone can change it without a review.', action: 'Protect it', href: '/studio/settings/#protection' });

  for (const r of input.requests) {
    // In progress: its change is in the list above. Done and declined wait for nobody.
    if (r.status !== 'requested') continue;
    const who = onIt(r);
    if (who) {
      if (same(who, viewer)) mine.push(requestRow(r, 'Assigned to you. Nobody has started the change yet.', 'Open request'));
      else (viewer ? others : mine).push(requestRow(r, `Waiting for @${who.replace(/^@/, '')} to start it.`, 'Open request'));
    } else if (owner) {
      const ask = 'Nobody is on it yet: explore it, assign someone or decline it.';
      mine.push(requestRow(r, r.requester ? `Asked by @${r.requester.replace(/^@/, '')}. ${ask}` : ask, 'Open request'));
    } else {
      const by = input.owners.length ? `an owner (${at(input.owners)})` : 'an owner';
      (viewer ? others : mine).push(requestRow(r, `Waiting for ${by} to pick it up.`, 'Open request'));
    }
  }

  const count = (rows: TodoRow[], k: TodoRow['kind']) => rows.filter((r) => r.kind === k).length;
  const headline = viewer
    ? mine.length
      ? `${counted(count(mine, 'change'), count(mine, 'request'), count(mine, 'setup'))} for you.`
      : 'Nothing waits for you.'
    : mine.length
      ? `${counted(count(mine, 'change'), count(mine, 'request'), 0)}.`
      : 'Nothing waits for a review.';
  return { headline, mine, others };
}

/** The folded line about the rest: "2 more wait on someone else", or without anything for you, "2 wait on someone else". */
export function othersLine(others: number, mine: number): string {
  if (!others) return '';
  return `${others} ${mine ? 'more ' : ''}${others === 1 ? 'waits' : 'wait'} on someone else`;
}

/** "Show all 5" when the list is cut at TODO_MAX, else empty. */
export function showAllLabel(mine: number): string {
  return mine > TODO_MAX ? `Show all ${mine}` : '';
}
