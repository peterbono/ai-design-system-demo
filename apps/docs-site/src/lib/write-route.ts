// Which way a write goes for the viewer, and who keeps an exploration. Pure, unit tested in write-route.test.ts.
//
// A GitHub account that can read the library but not change it (RepoAccess.write false, not an email member) gets
// nothing that fails at GitHub after the click. In direct mode its change goes as a suggestion when the action has one
// (a new brand, a missing piece); an action with no suggestion path (sending an exploration for review, closing it) is
// not offered, and one line says who can do it.

import type { ChangesMode } from '@bridge-ds/core';

export type WriteRoute = 'direct' | 'suggest' | 'none';

/**
 * How this viewer's write goes. `access` null: not known yet (signed out, or GitHub not asked): the team's mode, the
 * page asks to sign in first. An email member keeps the team's mode (Bridge's proxy writes for them). `canSuggest`:
 * the action can be filed as a suggestion.
 */
export function routeFor(access: { write: boolean; contributor?: boolean | undefined } | null | undefined, mode: ChangesMode, canSuggest = true): WriteRoute {
  if (!access || access.contributor) return mode;
  if (mode === 'suggest') return canSuggest ? 'suggest' : 'none';
  if (access.write) return 'direct';
  return canSuggest ? 'suggest' : 'none';
}

/** The mode a send uses: a reader in direct mode suggests. */
export const sendModeFor = (access: Parameters<typeof routeFor>[0], mode: ChangesMode): ChangesMode => (routeFor(access, mode) === 'suggest' ? 'suggest' : mode);

/** Told once under the send when a reader's change goes as a suggestion in a direct-mode team. */
export const READER_SUGGESTS = 'You can view this library but not change it, so this goes as a suggestion for your DS lead.';

/**
 * Whether the viewer may send an exploration for review or close it: the person who started it, or a reviewer, with
 * write access (no suggestion path exists for either).
 */
export function canKeepExploration(x: { viewer: string | null | undefined; author: string; reviewer: boolean; write: boolean | null | undefined }): boolean {
  if (!x.viewer || x.write === false) return false;
  return x.reviewer || x.viewer.replace(/^@/, '').toLowerCase() === x.author.replace(/^@/, '').toLowerCase();
}

/**
 * Whether an email member started this exploration in the design team's copy: Bridge opened its pull request for them
 * (api/contribute), so its body carries "Requested by <name> through Bridge." (never their email; older ones may carry
 * it in parentheses). Bridge's proxy decides again on every write; this only shows them their own Done exploring.
 */
export function startedByEmailMember(body: string | null | undefined, member: { name: string; email: string } | null | undefined): boolean {
  if (!body || !member?.name) return false;
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`Requested by ${esc(member.name)}(?: \\(([^)]+)\\))? through Bridge\\.`).exec(body);
  return Boolean(m && (!m[1] || m[1].toLowerCase() === member.email.toLowerCase()));
}

/**
 * The line in place of Done exploring and Archive on an exploration in a product's own repository, for someone who
 * signed in with their email: Bridge writes for them in the design system only.
 */
export const productKeeperLine = (product: string): string => `Someone on ${product} who signs in with GitHub says it is done exploring or archives it.`;

/** The line in place of Done exploring and Archive for everyone else. */
export function keepExplorationLine(author: string): string {
  return `Only ${author ? `@${author.replace(/^@/, '')}, who started it,` : 'the person who started it'} or a reviewer can say it is done exploring or archive it.`;
}

/**
 * How a write in one of the team's products (its design copy, or the developers' repository for the task) goes, for
 * the viewer (Florian's rule, 2026-11-02): every designer through Bridge's app (the proxy, api/contribute), with or
 * without GitHub, so a designer only ever touches their own explorations and needs no access to the copy; leads
 * (admins, design and tech owners, people allowed the owner override) and anyone not known as a designer keep GitHub.
 * The server decides again on every call (contribute githubRoleOf). Pure.
 */
export type ProductRoute = 'github' | 'bridge';

export function productRouteFor(x: {
  session: 'github' | 'email' | null;
  access: { write: boolean; admin: boolean; contributor?: boolean | undefined } | null | undefined;
  login: string | null | undefined;
  site: { owners?: { design?: readonly string[]; tech?: readonly string[] } | null; override?: { allowed?: readonly string[] } | null } | null | undefined;
}): ProductRoute {
  if (x.session === 'email' || x.access?.contributor) return 'bridge';
  if (x.session !== 'github' || !x.access || !x.login) return 'github';
  if (x.access.admin) return 'github';
  const me = x.login.replace(/^@/, '').toLowerCase();
  const leads = [...(x.site?.owners?.design ?? []), ...(x.site?.owners?.tech ?? []), ...(x.site?.override?.allowed ?? [])].map((l) => l.replace(/^@/, '').toLowerCase());
  if (leads.includes(me)) return 'github';
  return x.access.write ? 'bridge' : 'github';
}

/**
 * Whether a designer signed in with GitHub started this exploration through Bridge: its pull request (opened by
 * Bridge's app) carries "Requested by <name> (@<login>) through Bridge.". Shows them their own Done exploring.
 */
export function startedByDesigner(body: string | null | undefined, login: string | null | undefined): boolean {
  if (!body || !login) return false;
  const esc = login.replace(/^@/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`Requested by [^\\n]* \\(@${esc}\\) through Bridge\\.`, 'i').test(body);
}
