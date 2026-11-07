// What the exploration page says about the talk between a designer and their design lead (boards L1 to L5): the
// Decisions list, and who the next word is for. Pure: no DOM, no fetch. The record itself is core's (explorations.ts
// decisionsOf, openDecisionOf). Bridge voice: a designer reads it.
import { isNameAuthor, nameOfAuthor } from './author';
import { decisionsOf, isWaitingForLead, leadTurnOf, openDecisionOf, parseExplorationBody, type Decision, type DecisionKind } from '@bridge-ds/core';

export interface DecisionRowView {
  key: string;
  /** Who said it, as the page names them. */
  name: string;
  /** Their face's login (lib/people), when known. */
  login: string;
  /** "asked for changes". */
  verb: string;
  why: string | null;
  round: number;
  /** ISO date. */
  at: string;
}

const VERB: Record<DecisionKind, string> = {
  'looks-right': 'said it looks right',
  changes: 'asked for changes',
  question: 'asked a question',
  answer: 'answered',
  'not-doing': 'decided not to do this',
  'take-back': 'took it back from the developers',
  'asked-someone': 'asked someone else to review',
  handed: 'handed it over',
  archived: 'archived it',
};

/** The name of who said it: their display name, the page's name for their login, the login last. */
export function sayerName(d: Pick<Decision, 'by' | 'byName'>, names: Record<string, string> = {}): string {
  if (d.byName) return d.byName;
  if (d.by) return isNameAuthor(d.by) ? nameOfAuthor(d.by) : (names[d.by] ?? d.by);
  return 'Someone';
}

/** The list on the page, newest first. */
export function decisionRows(all: readonly Decision[], names: Record<string, string> = {}): DecisionRowView[] {
  return all
    .map((d, i) => {
      const to = d.to?.length ? ` to ${d.to.map((t) => names[t] ?? t).join(', ')}` : '';
      const verb = d.kind === 'asked-someone' ? `asked ${d.to?.map((t) => names[t] ?? t).join(', ') || 'someone else'} to review` : `${VERB[d.kind]}${d.kind === 'handed' ? to : ''}`;
      return { key: `${i}`, name: sayerName(d, names), login: d.by ?? `name:${d.byName ?? 'Someone'}`, verb, why: d.text ?? null, round: d.round, at: d.at };
    })
    .reverse();
}

/** The tag of the page while the talk decides what it is, over the lifecycle's own. */
export function decisionTag(open: Pick<Decision, 'kind'> | null, designer: string): { label: string; tone: 'danger' | 'neutral' | 'info' } | null {
  if (!open) return null;
  if (open.kind === 'not-doing') return { label: 'Not doing this', tone: 'neutral' };
  if (open.kind === 'question') return { label: `Waiting for ${designer}`, tone: 'info' };
  return open.kind === 'changes' || open.kind === 'take-back' ? { label: 'Needs changes', tone: 'danger' } : null;
}

/** The words of a lead's last open word, for the zone's title. */
export function designerZoneTitle(kind: DecisionKind, who: string): string {
  if (kind === 'question') return `${who} has a question`;
  if (kind === 'take-back') return `${who} took it back`;
  if (kind === 'not-doing') return `${who} decided not to do this`;
  return `${who} asks for changes`;
}

/** The next name free for a reopened exploration: "Late tag 2", then 3. */
export function nextName(name: string): string {
  const m = /^(.*\S)\s+(\d+)$/.exec(name.trim());
  return m ? `${m[1]} ${Number(m[2]) + 1}` : `${name.trim()} 2`;
}

/** A row of the lead's Home: Needs you, or the quiet Waiting on others. */
export interface LeadHomeRow {
  where: 'needs' | 'waiting';
  line: string;
  since: string | null;
  /** The verb on a Needs you row. */
  action: string;
  /** Who it is about: their login, or their display name when they have none. */
  person: { login: string | null; name: string };
}

/**
 * Where an exploration goes on someone's Home (board L6). A row in Needs you only when the next word is theirs: the
 * lead asked (by name, once someone else was asked), or the designer with the lead's words on their side. The lead who
 * spoke sees it, quietly, in Waiting on others, until the answer moves it up. Everyone else: nothing.
 */
export function leadHomeRow(body: string | null | undefined, v: { viewer: string | null; lead: boolean; own: boolean; names?: Record<string, string> }): LeadHomeRow | null {
  const e = parseExplorationBody(body);
  if (!e) return null;
  const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const turn = leadTurnOf(body);
  const all = decisionsOf(e);
  const last = all[all.length - 1];
  const designer = { login: e.leadAskedBy ?? e.author ?? null, name: e.leadAskedByName ?? e.memberName ?? e.leadAskedBy ?? e.author ?? 'The designer' };
  const shown = v.names?.[designer.login ?? ''] ?? designer.name;
  if (turn === 'lead' && isWaitingForLead(body)) {
    if (!v.lead || v.own) return null;
    if (e.leadAskedTo?.length && !e.leadAskedTo.some((l) => same(l, v.viewer))) return null;
    const answered = last?.kind === 'answer';
    const before = answered ? [...all].reverse().find((d) => d.kind === 'question' || d.kind === 'changes' || d.kind === 'take-back') : null;
    const line = answered ? `${shown} answered your ${before?.kind === 'question' ? 'question' : 'changes'}` : last?.kind === 'asked-someone' ? `${sayerName(last, v.names)} asks you to look` : `${shown} is done exploring`;
    return { where: 'needs', line, since: last?.at ?? e.leadAskedAt ?? null, action: 'Review', person: designer };
  }
  if (turn === 'designer') {
    const open = openDecisionOf(body)!;
    if (v.own) return { where: 'needs', line: `${sayerName(open, v.names)} ${open.kind === 'question' ? 'has a question' : open.kind === 'take-back' ? 'took it back' : 'asked for changes'}`, since: open.at, action: 'Answer', person: { login: open.by ?? null, name: sayerName(open, v.names) } };
    if (same(open.by, v.viewer)) return { where: 'waiting', line: `waiting for ${shown}`, since: open.at, action: '', person: designer };
  }
  return null;
}
