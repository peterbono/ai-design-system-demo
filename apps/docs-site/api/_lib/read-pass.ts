// A read pass: what Studio hands a team member's own tab when it opens a product preview with the Bridge toolbar, so
// the toolbar (another origin, no cookie, no credentials) can read that change of a PRIVATE product repository through
// Bridge's read proxy (api/_lib/team-read.ts). Without it, the toolbar reads as a visitor, and visitors only ever read
// public product repositories of the public demo teams.
//
// Shape: signClaims (api/_lib/session.ts) under LIBRARY_SESSION_SECRET with its own purpose, so a session cookie never
// passes for a pass nor a pass for a cookie. Claims:
//   t    the team repository ("owner/name", lower case) the pass was minted for
//   r    the product repositories of that team (products[].repo and products[].design.repo, lower case), at mint time
//   m    the member's read budget id (team-read.ts memberBudgetId): their reads count against their own budget, and
//        the pass never carries their email (it travels in a URL fragment)
//   iat  issued at (ms), exp  expires at (ms), READ_PASS_TTL_MS later, never more than MAX_READ_PASS_TTL_MS
// It lets its holder read, read only, the product repositories it names, with the visitor's allow-list (no
// collaborators), from an origin the team's config names, and nothing of the team's own repository. The server still
// checks on every read that the team's config lists the product and that the Bridge app is on it.

import { signClaims, verifyClaims } from './session.js';

export const READ_PASS_PURPOSE = 'bridge-read-pass';
/** How long a pass opens reads: a working day in one tab. */
export const READ_PASS_TTL_MS = 8 * 60 * 60 * 1000;
/** Never longer than this, whatever the claims say. */
export const MAX_READ_PASS_TTL_MS = 12 * 60 * 60 * 1000;
/** Longer than any pass Bridge mints: refused before any work. */
export const MAX_READ_PASS_CHARS = 4096;
/** At most this many product repositories in one pass. */
export const MAX_READ_PASS_REPOS = 40;

const REPO = /^[\w.-]+\/[\w.-]+$/;

export interface ReadPass {
  t: string;
  r: string[];
  m: string;
  iat: number;
  exp: number;
}

const isPass = (c: any): boolean =>
  typeof c.t === 'string' &&
  REPO.test(c.t) &&
  Array.isArray(c.r) &&
  c.r.length <= MAX_READ_PASS_REPOS &&
  c.r.every((x: unknown) => typeof x === 'string' && REPO.test(x)) &&
  typeof c.m === 'string' &&
  /^[0-9a-f]{8,64}$/.test(c.m) &&
  Number.isFinite(c.iat) &&
  Number.isFinite(c.exp);

/** A pass for `member` of `team` that opens reads of `repos`, or null when there is nothing to open. */
export function mintReadPass(input: { team: string; repos: readonly string[]; member: string }, secret: string, now: number, ttl = READ_PASS_TTL_MS): { pass: string; exp: number } | null {
  const team = input.team.trim().toLowerCase();
  const repos = [...new Set(input.repos.map((r) => r.trim().toLowerCase()))].filter((r) => REPO.test(r) && r !== team).slice(0, MAX_READ_PASS_REPOS);
  if (!REPO.test(team) || !repos.length) return null;
  const exp = now + Math.min(Math.max(ttl, 0), MAX_READ_PASS_TTL_MS);
  const claims: ReadPass = { t: team, r: repos, m: input.member, iat: now, exp };
  return { pass: signClaims(claims, secret, READ_PASS_PURPOSE), exp };
}

/** The claims of a pass whose signature holds and that is still open now, else null. */
export function verifyReadPass(value: string | null | undefined, secret: string, now: number): ReadPass | null {
  if (!value || value.length > MAX_READ_PASS_CHARS) return null;
  const c = verifyClaims<ReadPass>(value, secret, READ_PASS_PURPOSE, isPass);
  if (!c) return null;
  // Expired, issued in the future, or open longer than any pass Bridge mints.
  if (c.exp <= now || c.iat > now + 60_000 || c.exp - c.iat > MAX_READ_PASS_TTL_MS) return null;
  return c;
}

/** Whether `pass` opens reads of `product` ("owner/name") through `team`. */
export function passOpens(pass: ReadPass | null, team: string, product: string): boolean {
  return Boolean(pass && pass.t === team.toLowerCase() && pass.r.includes(product.toLowerCase()));
}
