// Who asked for a change, as Bridge records it in the body of the pull request or suggestion it opens. The GitHub
// author is often an account or agent acting for someone (Claude AI through the MCP server, a bot, a lead opening a
// branch for a teammate); the requester is the person the team should see. Pure, covered by test/requester.test.ts.
//
// The line Bridge writes, one per body, anywhere in it (requesterLine):
//   Requested by Ann Leroy (@annleroy).     a name and a GitHub login
//   Requested by Ann Leroy.                 a name only (someone without a GitHub account, or a demo persona)
//   Requested by @annleroy.                 a login only
// Also read: the line of a component change request, "<sub>Requested from Figma by @ann with Bridge.</sub>", and,
// when no "Requested by" line is there, the footer of a suggestion, "<sub>Suggested from Figma by @ann with Bridge.</sub>".

export interface Requester {
  /** The display name, when the line gives one. */
  name: string | null;
  /** The GitHub login, without "@", when the line gives one. */
  login: string | null;
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const LINE = /(?:^|\n)[ \t>*_-]*(?:<sub>)?\s*Requested (?:from [^\n<]{1,40}? )?by ([^\n<]{1,120}?)(?:\s+with Bridge)?\.?\s*(?:<\/sub>)?[ \t]*(?=\n|$)/i;

/** A suggestion's footer (core suggestions.ts suggestionBody), read only when the body has no "Requested by" line. */
const SUGGESTED = new RegExp(LINE.source.replace('Requested (?:from', 'Suggested (?:from'), 'i');

/** The requester a body names, null when it names none (or names it in a form Bridge does not write). */
export function requesterOf(body: string | null | undefined): Requester | null {
  const m = LINE.exec(body ?? '') ?? SUGGESTED.exec(body ?? '');
  if (!m) return null;
  const who = m[1]!.trim().replace(/\.$/, '');
  const both = /^(.+?)\s*\(@([^)\s]+)\)$/.exec(who);
  if (both) return LOGIN.test(both[2]!) ? { name: both[1]!.trim(), login: both[2]! } : null;
  if (who.startsWith('@')) return LOGIN.test(who.slice(1)) ? { name: null, login: who.slice(1) } : null;
  // A name: letters, spaces, apostrophes, dots and hyphens, at most five words. Anything else is prose, not the line.
  return /^[\p{L}][\p{L}'’. -]{0,60}$/u.test(who) && who.split(/\s+/).length <= 5 ? { name: who, login: null } : null;
}

/** The line Bridge writes for a requester: "Requested by Ann Leroy (@annleroy)." */
export function requesterLine(r: Requester): string {
  const name = r.name?.trim();
  const login = r.login?.replace(/^@/, '').trim();
  if (name && login) return `Requested by ${name} (@${login}).`;
  if (login) return `Requested by @${login}.`;
  if (name) return `Requested by ${name}.`;
  throw new Error('A requester needs a name or a login.');
}
