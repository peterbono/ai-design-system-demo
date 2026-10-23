// Bridge accounts (one per person, by email; no password, no username): the words, the routing rules and the parsing
// of /api/account answers (api/account/index.ts). Pure, no DOM, no fetch, covered by account.test.ts. The browser side
// lives in scripts/account-session.ts, the screens in components/ds/account/.
//
// One sign-in screen for sign in and sign up (pages/signin.astro, board E1): the work email and a 6-digit code (10
// minutes, single use). Then lib/entry.ts picks the room: the team, an invite, a team found by work domain, or
// "Create your team". GitHub comes back only to link a repository, or in Settings > Account (reviewers and admins
// approve on GitHub). A site without accounts keeps Continue with GitHub.
import { ROLE_WORDS, type MemberRole } from './invites';
import { START_PAGE } from './start';
import { CALLBACK_PATH } from './github-signin';
import { teamHref } from './team-path';

export const ACCOUNT_API = '/api/account';
/** Every action carries it, the server refuses one without it (CSRF), like /api/contribute. */
export const ACCOUNT_HEADER = 'X-Bridge-Account';
export const SIGNIN_PAGE = '/signin/';
export const PRIVACY_PAGE = '/privacy/';
/** "Get started" opens the sign-in screen with sign-up words. */
export const NEW_PARAM = 'new';
export const NEXT_PARAM = 'next';
export const CODE_LENGTH = 6;
/** Set before leaving for GitHub from Bridge: back on the sign-in screen, the GitHub sign-in becomes (or links to) an
 * account (sessionStorage). */
export const GITHUB_PENDING_KEY = 'bridge.account.github';
/** Seconds before "Send a new code" works again. */
export const RESEND_COOLDOWN = 30;

export interface AccountTeam {
  /** "owner/repo". */
  repo: string;
  /** The team's name, when the server knows it. */
  name: string | null;
  role: MemberRole | string;
  /** How the person belongs to it: 'email' (a Bridge membership) or 'github'. */
  via: string;
}

export interface Account {
  email: string;
  name: string | null;
  /** False while the name is a stand-in made from the email: Bridge asks the person their name once. */
  nameSet?: boolean;
  github: { login: string; id: number } | null;
  teams: AccountTeam[];
}

export interface AccountInfo {
  /** The site has accounts (the server piece is there and set up). */
  available: boolean;
  account: Account | null;
}

/** What verify and github answer: the account, whether it was just made, and where to go. */
export interface SignedIn {
  account: Account;
  created: boolean;
  next: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** An account from the server, or null when the answer is not one. Unknown fields are dropped. */
export function parseAccount(v: unknown): Account | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const email = str(o.email);
  if (!email) return null;
  const gh = o.github && typeof o.github === 'object' ? (o.github as Record<string, unknown>) : null;
  const login = gh ? str(gh.login) : null;
  const teams = Array.isArray(o.teams)
    ? o.teams.flatMap((t): AccountTeam[] => {
        if (!t || typeof t !== 'object') return [];
        const x = t as Record<string, unknown>;
        const repo = str(x.repo);
        if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return [];
        return [{ repo, name: str(x.name), role: str(x.role) ?? 'view', via: str(x.via) ?? 'email' }];
      })
    : [];
  return { email, name: str(o.name), nameSet: o.nameSet !== false && Boolean(str(o.name)), github: login ? { login, id: typeof gh?.id === 'number' ? gh.id : 0 } : null, teams };
}

/** Only a same-site path is a place to go after signing in; never the sign-in screen itself or the GitHub callback. */
export function safeNext(path: string | null | undefined): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  if (path.startsWith(SIGNIN_PAGE) || path.startsWith(CALLBACK_PATH)) return null;
  return path;
}

/** The sign-in screen, coming back to `next` (a same-site path) afterwards. `fresh`: opened from Get started. */
export function signInHref(next?: string | null, fresh = false): string {
  const q = new URLSearchParams();
  if (fresh) q.set(NEW_PARAM, '1');
  const back = safeNext(next ?? null);
  if (back) q.set(NEXT_PARAM, back);
  const s = q.toString();
  return s ? `${SIGNIN_PAGE}?${s}` : SIGNIN_PAGE;
}

/** What the sign-in screen read from its address. */
export function readSignInQuery(search: string): { fresh: boolean; next: string | null } {
  const q = new URLSearchParams(search);
  return { fresh: q.get(NEW_PARAM) === '1', next: safeNext(q.get(NEXT_PARAM)) };
}

/**
 * Where a signed-in person goes when the address names nowhere: the most recent of their teams this browser opened,
 * else their first team, else "How do you want to start?".
 */
export function defaultNext(account: Account, recent: readonly string[] = []): string {
  const mine = new Map(account.teams.map((t) => [t.repo.toLowerCase(), t.repo]));
  const team = recent.map((r) => mine.get(r.toLowerCase())).find(Boolean) ?? account.teams[0]?.repo;
  if (!team) return START_PAGE;
  const [o = '', r = ''] = team.split('/');
  return teamHref(o, r, null);
}

/** The digits of what was typed or pasted ("123 456", "123-456"), at most six. */
export const codeDigits = (text: string): string => text.replace(/\D/g, '').slice(0, CODE_LENGTH);

/** A team role in words ("Can edit", "Admin"), from the invites vocabulary. */
export const roleWord = (role: string): string => (role in ROLE_WORDS ? ROLE_WORDS[role as MemberRole].label : role.charAt(0).toUpperCase() + role.slice(1));

/** Reviewers and admins approve on GitHub: an account with such a role and no GitHub linked needs it. */
export const needsGitHub = (a: Account): boolean => !a.github && a.teams.some((t) => t.role === 'reviewer' || t.role === 'admin');

/**
 * What this browser keeps about the person and their teams, forgotten on sign-out and when the account is deleted:
 * their email memberships, their teams, roles and team names, their counts, and every read kept from GitHub (private
 * bodies must not outlive the session). Preferences that say nothing about the person (theme, a tour seen) stay.
 */
const PERSONAL_KEYS = new Set(['bridge.reviews.mine', 'bridge.reviews.open', 'bridge.teamRoles', 'bridge.recentTeams', 'bridge.teamNames', 'bridge.accountTeamNames', 'bridge.gh.maintainer', 'bridge.xp.rows']);
const PERSONAL_PREFIXES = [
  'bridge.contribute.member:',
  'bridge.gh.cache:',
  'bridge.github.access:',
  'bridge.requests:',
  'bridge.changes.list:',
  'bridge.prstatus:',
  'bridge.view.',
  'bridge.people.names.',
  'bridge.suggestions.needs.',
  'bridge.review.looked.',
];

/** A browser storage key that holds something personal (see above). */
export const isPersonalKey = (k: string): boolean => PERSONAL_KEYS.has(k) || PERSONAL_PREFIXES.some((p) => k.startsWith(p));

/** Set for the next page when the session ended here: the sign-in screen says so once. */
export const SIGNED_OUT_PARAM = 'bye';
export type SignedOutKind = 'out' | 'deleted';

/** The sign-in screen after a sign-out or a deleted account, back to `next` once signed in again. */
export function signedOutHref(kind: SignedOutKind, next?: string | null): string {
  const base = signInHref(next);
  return `${base}${base.includes('?') ? '&' : '?'}${SIGNED_OUT_PARAM}=${kind}`;
}

/** What the sign-in screen says once after a sign-out, or null. */
export function signedOutNote(search: string): string | null {
  const v = new URLSearchParams(search).get(SIGNED_OUT_PARAM);
  return v === 'out' ? ACCOUNT_WORDS.signedOut : v === 'deleted' ? ACCOUNT_WORDS.deleted : null;
}

/** The name the account goes by: its name, else the part of the email before the @. */
export const accountName = (a: Pick<Account, 'name' | 'email'>): string => a.name || a.email.split('@')[0] || a.email;

/** Every designer-facing sentence of accounts, in one place. */
export const ACCOUNT_WORDS = {
  /** Sign in and sign up alike (board E1): email only. */
  signInTitle: 'Welcome to Bridge',
  signInShort: 'Sign in',
  signInLead: "Use your work email. We'll take you to your team, or help you start one.",
  /** A site without accounts (a fork, `astro dev`) keeps GitHub as its one way in. */
  github: 'Continue with GitHub',
  githubBusy: 'Signing in with GitHub',
  email: 'Continue with email',
  emailLabel: 'Work email',
  emailPlaceholder: 'name@company.com',
  badEmail: 'Enter your work email, like name@company.com.',
  sendCode: 'Send code',
  codeTitle: 'Check your inbox',
  codeLead: (masked: string) => `Bridge sent a 6-digit code to ${masked}. It works once, for 10 minutes.`,
  codeLabel: 'Code',
  codeHint: 'Paste it or type it, spaces are fine.',
  badCode: 'Enter the 6 digits from the email.',
  triesLeft: (n: number) => (n === 1 ? '1 try left.' : `${n} tries left.`),
  haveCode: 'I have a code',
  verify: 'Continue',
  resend: 'Send a new code',
  resendIn: (s: number) => `Send a new code in ${s} s`,
  resent: 'A new code is on its way.',
  otherEmail: 'Use another email',
  nameTitle: 'One last thing: your name',
  nameLead: 'Your team sees your name on what you change and suggest.',
  nameLabel: 'Your name',
  namePlaceholder: 'Leo Martin',
  nameMissing: 'Add your name, so your team knows who made a change.',
  nameSave: 'Continue',
  privacy: 'What Bridge keeps about you',
  demoLead: 'Just looking?',
  demo: 'Open the demo',
  unavailable: 'Email sign-in is not available on this site yet. Continue with GitHub.',
  githubOff: 'GitHub sign-in is not set up on this site.',
  network: 'Bridge did not answer. Check your connection and try again.',
  failed: 'Something went wrong. Try again in a minute.',
  wrongCode: 'That code does not match. Check the latest email and try again.',
  expiredCode: 'This code expired or was already used. Send a new code.',
  tooMany: 'Too many tries. Wait a few minutes, then send a new code.',
  githubFailed: 'GitHub did not confirm your email. Add a verified email to your GitHub account, then try again.',
  // Account menu and Settings > Account.
  accountTitle: 'Account',
  accountIntro: 'Your Bridge account. Teams see your name and email.',
  signedInAs: (name: string) => `Signed in as ${name}`,
  githubLinked: (login: string) => `GitHub @${login}`,
  githubNone: 'GitHub not linked',
  linkGitHub: 'Link GitHub',
  linkGitHubWhy: 'Reviewers and admins approve on GitHub: link your GitHub account.',
  teams: 'Your teams',
  noTeams: 'No team yet.',
  rename: 'Rename',
  renameSave: 'Save name',
  cancel: 'Cancel',
  renamed: 'Name saved.',
  settings: 'Account settings',
  signOut: 'Sign out',
  signOutEverywhere: 'Sign out everywhere',
  signOutEverywhereHelp: 'Ends your sessions on every device, this one included.',
  signedOut: "You're signed out.",
  deleted: 'Your account is deleted.',
  deleteTitle: 'Delete my account',
  deleteHelp: 'Removes your account, your email memberships and your sessions. Your teams keep the changes you made.',
  deleteConfirmLabel: 'Type DELETE to confirm',
  deleteConfirmWord: 'DELETE',
  deleteConfirm: 'Delete my account',
  lastAdmin: 'You are the only admin of a team with other members. Make someone else an admin first, then delete your account.',
} as const;

/** The sentence for a refusal: the server's own when it sends one, else one per status. */
export function accountErrorText(status: number, code?: string | null, message?: string | null): string {
  if (message) return message;
  if (code === 'last-admin' || code === 'last_admin') return ACCOUNT_WORDS.lastAdmin;
  if (code === 'expired' || status === 410) return ACCOUNT_WORDS.expiredCode;
  if (status === 429 || code === 'too-many' || code === 'rate-limited') return ACCOUNT_WORDS.tooMany;
  if (status === 409) return ACCOUNT_WORDS.lastAdmin;
  if (status === 400 || status === 401 || status === 403) return code === 'github' ? ACCOUNT_WORDS.githubFailed : ACCOUNT_WORDS.wrongCode;
  if (status === 0) return ACCOUNT_WORDS.network;
  return ACCOUNT_WORDS.failed;
}
