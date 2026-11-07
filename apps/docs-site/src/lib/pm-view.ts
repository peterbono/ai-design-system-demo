// What the exploration page says about the product manager of its product (boards R1 and R3): the PM's own zone (What
// do you think?) and, for the designer and the lead, where the PM stands. Pure: no DOM, no fetch. The record is core's
// (explorations.ts pmOpinionOf); who the PM is comes from Settings > Products (api/_lib/product-pm.ts).
import { parseExplorationBody, pmOpinionOf, type Decision } from '@bridge-ds/core';

/** A product manager as Studio reads them: a GitHub person by login, an email member by reference. Never an email. */
export type PmPerson = { name: string; login: string } | { name: string; ref: string };

/**
 * Whether the PM's word is required before the developers (board R1): when no other designer reviews the work, the
 * team's design system being shared with no review, or a team with one designer. Otherwise the lead reads it, nothing
 * waits on it.
 */
export function pmRequired(team: { review?: 'one' | 'shared-review' | 'shared-none' | null; designers?: number | null }): boolean {
  return team.review === 'shared-none' || (typeof team.designers === 'number' && team.designers <= 1);
}

/** True when the viewer (an email member by reference, a GitHub person by login) is this PM. */
export function isViewerPm(pm: PmPerson | null | undefined, viewer: { ref?: string | null; login?: string | null }): boolean {
  if (!pm) return false;
  if ('ref' in pm) return Boolean(viewer.ref && viewer.ref === pm.ref);
  return Boolean(viewer.login && viewer.login.toLowerCase() === pm.login.toLowerCase());
}

export const PM_WORDS = {
  title: (pm: string) => `What do you think, ${pm}?`,
  intro: (designer: string) => `${designer} shares this with you before it goes to the design lead.`,
  note: 'Your note',
  noteHint: 'Needed for Needs changes.',
  noteNeeded: 'Say what to change.',
  looksGood: 'Looks good',
  changes: 'Needs changes',
  heading: 'Product manager',
  agreedInCall: (pm: string) => `${pm} agreed in a call`,
  sentOk: 'Sent: it looks good to you.',
  sentChanges: 'Sent to the designer, with your note.',
  sentCall: (pm: string) => `Noted. ${pm} gets a line and can correct it.`,
} as const;

export type PmSaid = Pick<Decision, 'kind' | 'text' | 'by' | 'byName' | 'to'>;

/** Where the PM stands, in one line (when: "yesterday"). Their own word reads "You". */
export function pmStatusLine(said: PmSaid | null, x: { pm: string; when: string; mine?: boolean }): string {
  const who = x.mine ? 'You' : x.pm;
  if (!said) return x.mine ? 'You have not said what you think yet.' : `${x.pm} has not seen it yet.`;
  const at = x.when ? `, ${x.when}` : '';
  if (said.kind === 'pm-ok') return `${who} said it looks good${at}.`;
  if (said.kind === 'pm-changes') return `${who} asked for changes${at}.`;
  return `${said.byName ?? 'The designer'} said ${x.mine ? 'you' : x.pm} agreed in a call${at}.`;
}

/**
 * The PM's row on their Home (boards R3, R4), for an exploration of their product: its build ready for their check, or,
 * while it runs, their opinion asked for and not given yet. Null otherwise (archived, already said, nothing to do).
 */
export function pmHomeRow(body: string | null | undefined, x: { buildReady: boolean }): { line: (designer: string) => string; action: string; since: string | null } | null {
  const e = parseExplorationBody(body);
  if (!e) return null;
  if (e.doneAt) return x.buildReady ? { line: () => 'The build is ready to check', action: 'Check', since: null } : null;
  if (pmOpinionOf(body)) return null;
  return { line: (designer) => `${designer} would like your opinion`, action: 'Look', since: e.leadAskedAt ?? null };
}

/** A PM word as Bridge keeps it on the exploration (core's Decision). */
export type PmSaidHere = PmSaid & { at?: string };
const PM_SAID_TTL = 5 * 60_000;

/**
 * The PM word the page shows: the one read from the exploration, or the one just said from this page when it is
 * newer (the page reads the exploration again after an answer and that read can come from a cache older than the
 * answer). A word said here is trusted for five minutes only.
 */
export function newerPmSaid<T extends PmSaidHere>(fromBody: T | null, local: T | undefined, now = Date.now()): T | null {
  if (!local?.at || now - Date.parse(local.at) > PM_SAID_TTL) return fromBody;
  if (!fromBody?.at) return local;
  return Date.parse(fromBody.at) >= Date.parse(local.at) ? fromBody : local;
}
