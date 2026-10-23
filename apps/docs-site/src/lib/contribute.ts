// Email contributors (docs: the email contributors contract): a designer invited with "Can edit" joins and contributes
// with their email only. Reviewers and admins keep GitHub: they approve and merge. Pure: no DOM, no fetch, no storage,
// covered by contribute.test.ts. The browser side is scripts/contribute-session.ts; the server is api/contribute.
//
// How Studio talks to GitHub for an email contributor, without touching each feature: the session holds a stand-in
// token (CONTRIB_TOKEN) instead of a GitHub token, and every GitHub call that carries it is sent to this site's proxy,
// /api/contribute?repo=<owner/repo>&gh=<path>, with the same method and body (proxyUrl). The proxy acts with Bridge's
// GitHub App under a strict policy: the person's own branches, pull requests, issues and comments, never an approval,
// a merge or the default branch. Paths outside the team's repository never go to the proxy: they are read as a guest.

import { isSampleTeam, onBridge, teamDisplayName } from './demo';

/** The stand-in token of an email contributor's session. Never sent to GitHub: the proxy rewrites every call. */
export const CONTRIB_TOKEN = 'bridge-email-contributor';

/** True when an Authorization header (or a token) is the email contributor's stand-in. */
export const isContribAuth = (value: string | null | undefined): boolean => Boolean(value && value.replace(/^(Bearer|token)\s+/i, '') === CONTRIB_TOKEN);

export const GITHUB_API = 'https://api.github.com';
export const CONTRIBUTE_API = '/api/contribute';

/** The detail of an error Bridge's proxy answered itself (not GitHub): its message is shown as is. */
export const CONTRIB_REFUSAL = 'bridge-contribute:';

/** The header every proxied call carries, so the server tells it from a page's own call. */
export const CONTRIBUTE_HEADER = 'X-Bridge-Contribute';

/** An email contributor of one team, as the server says it. */
export interface ContributeMember {
  email: string;
  name: string;
  /** 'admin' only in `npm run dev:full`, for a member seeded as admin (api/_lib/local-admin.ts). */
  role: 'edit' | 'admin';
}

/**
 * The proxy address of a GitHub REST call made for `repo` ("owner/name"), or null when the call is not the team's
 * (another host, another repository, the account itself): those go to GitHub as a guest. Case-insensitive on the
 * repository, the path and its query are kept as they are.
 */
export function proxyUrl(url: string, repo: string): string | null {
  if (!url.startsWith(GITHUB_API)) return null;
  const path = url.slice(GITHUB_API.length) || '/';
  if (!path.startsWith('/')) return null;
  const base = `/repos/${repo}`.toLowerCase();
  const head = path.split(/[?#]/)[0]!.toLowerCase();
  if (head !== base && !head.startsWith(`${base}/`)) return null;
  return `${CONTRIBUTE_API}?repo=${encodeURIComponent(repo)}&gh=${encodeURIComponent(path)}`;
}

/** The sign-in link's token from `#contribute=<token>` (the email Bridge sends), or null. */
export function contributeHashToken(hash: string): string | null {
  const m = /(?:^#|&)contribute=([A-Za-z0-9_-]{20,128})(?:&|$)/.exec(hash);
  return m ? m[1]! : null;
}

/**
 * Whether a team page may offer or use an email session: real teams only. The sample team (Acme Design) and Bridge's
 * own demo have their own guided flow, and the browser workspace has no team yet.
 */
export function contributeEligible(repo: string | null | undefined, hosted: boolean): boolean {
  return hosted && Boolean(repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) && !isSampleTeam(repo);
}

/**
 * True on a page served by `npm run dev:full` on this computer (localhost): the only place a member may read as admin
 * (a member seeded as admin, api/_lib/local-admin.ts). Everywhere else an email member is Can edit, whatever is said.
 */
export const localDevHost = (hostname: string | null | undefined = typeof location === 'undefined' ? null : location.hostname): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

/** A member record read back from storage or the server, or null when it is not one. Always Can edit, but locally. */
export function parseMember(v: unknown, local = localDevHost()): ContributeMember | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  if (typeof m.email !== 'string' || !m.email.includes('@')) return null;
  const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : m.email;
  return { email: m.email, name, role: local && m.role === 'admin' ? 'admin' : 'edit' };
}

/** What an invite link is, before it is accepted: the server's answer to peek (null when it cannot say). */
export interface InvitePeek {
  repo: string;
  /** The team as people call it, when the server knows it. */
  team?: string;
  role: 'view' | 'edit' | 'reviewer' | 'admin';
  /** Where the invite was sent, masked ("m•••@acme.design"). */
  sentTo?: string;
}

/** The team's name for a join button: the server's, else the repository's name. */
export const teamWord = (peek: Pick<InvitePeek, 'repo' | 'team'> | null | undefined): string => peek?.team?.trim() || (peek?.repo ? teamDisplayName(peek.repo) : '') || 'the team';

/** Every designer-facing sentence of the email path, in one place. */
export const CONTRIBUTE_WORDS = {
  // The invite page, "Can edit" invites.
  joinTitle: (team: string) => `Join ${team}${onBridge(team)}`,
  joinLead: (sentTo: string | undefined) =>
    sentTo ? `Your invitation was sent to ${sentTo}. Add your name and you are in. No GitHub account needed.` : 'Add your name and you are in. No GitHub account needed.',
  nameLabel: 'Your name',
  nameHelp: 'Your team sees it on what you change and suggest.',
  namePlaceholder: 'Leo Martin',
  nameMissing: 'Add your name, so your team knows who made a change.',
  join: (team: string) => `Join ${team}`,
  joining: 'Joining the team',
  githubRequired: 'This invitation is for a reviewer or an admin. They approve changes on GitHub, so sign in with GitHub to join.',
  // Reviewer and admin invites.
  newToGitHub: 'New to GitHub?',
  createAccount: 'Create a free account with this email',
  mismatch: (sentTo: string, login: string) => `It was sent to ${sentTo || 'another email'}. You're signed in to GitHub as @${login}.`,
  useAnother: 'Use another GitHub account',
  addEmail: (login: string) => `Add this email to @${login} on GitHub`,
  // Team pages, signed out.
  invitedWithEmail: 'Invited with your email?',
  // Opens the one sign-in screen of Bridge (pages/signin.astro, lib/account.ts ACCOUNT_WORDS.email).
  continueWithEmail: 'Continue with email',
  emailLabel: 'Work email',
  emailPlaceholder: 'name@company.com',
  send: 'Send me a link',
  badEmail: 'Enter your work email, like name@company.com.',
  sentTitle: 'Check your inbox',
  sentText: (masked: string) => `If ${masked} is on this team, Bridge sent it a link. Open it on this device. It works once, for 15 minutes.`,
  otherEmail: 'Use another email',
  expired: 'This link expired or was already used. Enter your email to get a new one.',
  unavailable: 'Email sign-in is not available yet on this site.',
  network: 'Bridge did not answer. Check your connection and try again.',
  // The account menu.
  account: 'Your account',
  signedInWithEmail: 'Signed in with your email',
  signOut: 'Sign out',
  // Members.
  newBrandOff: 'A new brand changes the team settings, so a developer or an admin creates it. You can still draft it here.',
  emailRoleNote: 'Reviewers and admins approve changes on GitHub. Invite them with the email of their GitHub account.',
} as const;

/** Where a person creates a GitHub account. */
export const GITHUB_SIGNUP_URL = 'https://github.com/signup';
