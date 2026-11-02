// Which way a write goes for the viewer, and who keeps an exploration. Pure, unit tested in write-route.test.ts.
//
// A GitHub account that can read the library but not change it (RepoAccess.write false, not an email member) gets
// nothing that fails at GitHub after the click. In direct mode its change goes as a suggestion when the action has one
// (a new brand, a missing piece); an action with no suggestion path (sending an exploration for review, closing it) is
// not offered, and one line says who can do it.

import type { ChangesMode } from '@bridge-ds/core';
import { GITHUB_API } from './contribute';

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
 * How a GitHub call of the Studio reads one of the team's product repositories (bridge.config.json products[].repo and
 * the design copy products[].design.repo, lower case: productReposOfConfig) for the viewer. Settled rule: GitHub reads
 * go through the Bridge server with the app's token, so a private product or design copy reads for everyone on the
 * team (an email member, a designer, a lead or an admin signed in with GitHub), whatever their own token can see.
 * 'bridge': a GET under a product repository, by someone signed in (the server checks they are on the team).
 * 'github': anything else (the library, another repository, a guest, which has its own path); a write keeps its own
 * route (productRouteFor, the suggest or direct app). Pure.
 */
export function productReadRoute(x: { method: string | undefined; url: string; products: readonly string[]; session: 'github' | 'email' | null }): ProductRoute {
  if (!x.session || (x.method ?? 'GET').toUpperCase() !== 'GET' || !x.url.startsWith(GITHUB_API)) return 'github';
  const m = /^\/repos\/([^/?#]+)\/([^/?#]+)(?:[/?#]|$)/.exec(x.url.slice(GITHUB_API.length));
  if (!m) return 'github';
  let repo: string;
  try {
    repo = `${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}`.toLowerCase();
  } catch {
    return 'github';
  }
  return x.products.some((p) => p.toLowerCase() === repo) ? 'bridge' : 'github';
}

/** Where a signed-in GitHub read of the team goes (teamReadRoute): which repository, or a person's public profile. */
export type TeamReadRoute = { via: 'bridge'; scope: 'library' | 'product' | 'user' } | { via: 'github' };

/** `path` (under api.github.com) is the repository `team` itself, with or without a query. */
function isRepoRoot(path: string, team: string): boolean {
  const m = /^\/repos\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);
  if (!m) return false;
  try {
    return `${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}`.toLowerCase() === team.toLowerCase();
  } catch {
    return false;
  }
}

/** A person's public profile on api.github.com (/users/<login>): names and avatars of builders and reviewers. */
const USER_PATH = /^\/users\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:%5Bbot%5D|\[bot\])?)$/;

/**
 * How a GitHub read of the Studio goes for someone signed in with GitHub on a team page. Settled rule: every read of
 * the team goes through the Bridge server with the app's read token and the team's shared cache, never the viewer's
 * own GitHub limit (5,000 an hour, shared with everything else they do on GitHub): a GET under the team's library
 * repository (`team`, "owner/name"), under one of its products (productReadRoute), or a person's public profile. The
 * server checks they are on the team (api/contribute githubTeamReaderOf) and the read allow-list; anything it refuses
 * goes to GitHub as before. 'github': a write (its own route), another repository or host, the account itself
 * (/user), a page without a team, a guest (its own path). Pure.
 */
export function teamReadRoute(x: { method: string | undefined; url: string; team: string | null; products: readonly string[]; session: 'github' | 'email' | null }): TeamReadRoute {
  if (!x.session || !x.team || (x.method ?? 'GET').toUpperCase() !== 'GET' || !x.url.startsWith(GITHUB_API)) return { via: 'github' };
  const path = x.url.slice(GITHUB_API.length);
  if (USER_PATH.test(path)) return { via: 'bridge', scope: 'user' };
  // The library repository itself (GET /repos/owner/name): its `permissions` are the reader's own (admin, push), and
  // Bridge would answer the app's, shared by the whole team (every flag false). Read with the viewer's token, always.
  if (isRepoRoot(path, x.team)) return { via: 'github' };
  if (productReadRoute({ ...x, products: [x.team] }) === 'bridge') return { via: 'bridge', scope: 'library' };
  if (productReadRoute(x) === 'bridge') return { via: 'bridge', scope: 'product' };
  return { via: 'github' };
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
