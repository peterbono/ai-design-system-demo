// Invite collaborators and Settings > Members (boards I1 to I4): the roles in designer words, how each one maps to
// GitHub, who may change what, the people in a team, the email field's suggestions and the sample team's people.
// Pure: no DOM, no fetch, no storage, covered by invites.test.ts. The page side is scripts/members.ts (reads) and
// scripts/invites-api.ts (the /api/invites calls); the screens are components/ds/studio/{InviteDialog,RolePicker,
// MembersSection}.tsx.
//
// Role mapping, invisible to designers (they only read the four roles below). The server applies it
// (api/invites/index.ts), and re-checks on GitHub that the caller is a repository admin before any change:
//   Can view  = GitHub "read" (pull)
//   Can edit  = GitHub "write" (push)
//   Reviewer  = GitHub "write" + listed in bridge.config.json governance.owners: `design` when they review as a
//               Designer, `tech` as a Developer. The owner lists are the ones Settings > Review rules edits, and a change
//               to them is a pull request on bridge.config.json like every other rule change.
//   Admin     = GitHub "admin"
// Reading it back (roleOf): GitHub admin is Admin whatever the owner lists say; write (or maintain) plus an owner
// entry is Reviewer; write alone is Can edit; read (or triage) is Can view.
// A repository owned by a personal account has no read-only or admin collaborators on GitHub (everyone added can
// write, only the account itself is admin), so the picker offers Can view and Admin only on an organization's
// repository (roleChoices) and says why.

import type { Owners } from '@bridge-ds/core';
import { isSampleTeam } from './demo';
import { loginKey } from './people';

export type MemberRole = 'view' | 'edit' | 'reviewer' | 'admin';

/** What a Reviewer reviews: design (Designer) or code (Developer). */
export type ReviewAs = 'design' | 'tech';

export interface RoleChoice {
  role: MemberRole;
  /** Only for a Reviewer. */
  reviewAs?: ReviewAs;
}

export const ROLE_ORDER: readonly MemberRole[] = ['view', 'edit', 'reviewer', 'admin'];

/** The four roles as the picker shows them (board I2): each one "Also" adds to the one before. */
export const ROLE_WORDS: Record<MemberRole, { label: string; help: string }> = {
  view: { label: 'Can view', help: 'Sees everything, comments and suggests.' },
  edit: { label: 'Can edit', help: 'Also explores and changes the library.' },
  reviewer: { label: 'Reviewer', help: 'Also approves changes before they ship.' },
  admin: { label: 'Admin', help: 'Also invites people and changes settings.' },
};

export const REVIEW_AS_ORDER: readonly ReviewAs[] = ['design', 'tech'];

/** "They review as" (board I2): two mini cards, each with its own drawing. */
export const REVIEW_AS_WORDS: Record<ReviewAs, { label: string; help: string; short: string }> = {
  design: { label: 'Designer', help: 'How it looks and works', short: 'design' },
  tech: { label: 'Developer', help: 'How it is built', short: 'tech' },
};

/** The GitHub permission behind each role (documented above). Never shown to designers. */
export const GITHUB_PERMISSION: Record<MemberRole, 'pull' | 'push' | 'admin'> = {
  view: 'pull',
  edit: 'push',
  reviewer: 'push',
  admin: 'admin',
};

/** The owner group a role adds the person to, or null. */
export const ownerGroupOf = (c: RoleChoice): ReviewAs | null => (c.role === 'reviewer' ? (c.reviewAs ?? 'design') : null);

/** The trigger's words: "Can edit", "Reviewer: design" (board I2). */
export function roleLabel(c: RoleChoice): string {
  if (c.role !== 'reviewer') return ROLE_WORDS[c.role].label;
  return `${ROLE_WORDS.reviewer.label}: ${REVIEW_AS_WORDS[c.reviewAs ?? 'design'].short}`;
}

/** A choice made whole: a Reviewer always says what they review (design first, the board's default). */
export function normalizeChoice(c: RoleChoice): RoleChoice {
  return c.role === 'reviewer' ? { role: 'reviewer', reviewAs: c.reviewAs ?? 'design' } : { role: c.role };
}

export const sameChoice = (a: RoleChoice, b: RoleChoice) => {
  const x = normalizeChoice(a);
  const y = normalizeChoice(b);
  return x.role === y.role && x.reviewAs === y.reviewAs;
};

/** The role a pending invite will get. */
export const inviteChoice = (p: Pick<PendingInvite, 'role' | 'reviewAs'>): RoleChoice => normalizeChoice({ role: p.role, ...(p.reviewAs ? { reviewAs: p.reviewAs } : {}) });

/** The default role of a new invite: Can edit (board I1). */
export const DEFAULT_CHOICE: RoleChoice = { role: 'edit' };

/**
 * The roles the picker offers on this repository. A personal account's repository cannot hold read-only or admin
 * people on GitHub, so those two are shown but disabled, with `note` saying why.
 */
export function roleChoices(personal: boolean): { role: MemberRole; disabled: boolean }[] {
  return ROLE_ORDER.map((role) => ({ role, disabled: personal && (role === 'view' || role === 'admin') }));
}

export const PERSONAL_NOTE = 'This design system belongs to one person on GitHub, so everyone you add can edit it.';

// --- Reading roles back -----------------------------------------------------------------------------------------

/** The GitHub role of a collaborator, as GET /repos/{o}/{r}/collaborators lists it. */
export interface CollaboratorLike {
  login: string;
  role_name?: string | null;
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean } | null;
}

/** Which owner lists name `login` (people entries only; a GitHub team entry never matches a login). */
export function ownerGroups(login: string, owners: Owners): ReviewAs[] {
  const k = loginKey(login);
  return REVIEW_AS_ORDER.filter((g) => (owners[g] ?? []).some((e) => !e.includes('/') && loginKey(e) === k));
}

/** A member's role, read back from GitHub and the owner lists (mapping at the top of this file). */
export function roleOf(c: CollaboratorLike, owners: Owners): { role: MemberRole; reviews: ReviewAs[] } {
  const reviews = ownerGroups(c.login, owners);
  const name = (c.role_name ?? '').toLowerCase();
  const p = c.permissions ?? {};
  if (name === 'admin' || p.admin) return { role: 'admin', reviews };
  const writes = name === 'write' || name === 'maintain' || Boolean(p.push || p.maintain);
  if (writes) return { role: reviews.length ? 'reviewer' : 'edit', reviews };
  return { role: 'view', reviews: [] };
}

/** The role a member's picker shows: a Reviewer of design and code keeps design (one card is chosen). */
export const choiceOf = (m: { role: MemberRole; reviews: ReviewAs[] }): RoleChoice =>
  m.role === 'reviewer' ? { role: 'reviewer', reviewAs: m.reviews.includes('design') ? 'design' : 'tech' } : { role: m.role };

/** The muted line under a member's name (boards I1, I3): what they do, in a few words. */
export function memberLine(m: { role: MemberRole; reviews: ReviewAs[] }): string {
  const d = m.reviews.includes('design');
  const t = m.reviews.includes('tech');
  if (d && t) return 'Reviews design and code';
  if (d) return 'Reviews design';
  if (t) return 'Reviews code';
  if (m.role === 'admin') return 'Invites people and changes settings';
  if (m.role === 'edit' || m.role === 'reviewer') return 'Explores and changes the library';
  return 'Sees everything, comments and suggests';
}

/** The role as plain text, for a reader who cannot change it (board I4): "Reviewer: design", "Can view". */
export function roleText(m: { role: MemberRole; reviews: ReviewAs[] }): string {
  return roleLabel(choiceOf(m));
}

// --- People -----------------------------------------------------------------------------------------------------

export interface Member {
  login: string;
  /** Display name: the profile name when known, else the login. */
  name: string;
  role: MemberRole;
  reviews: ReviewAs[];
  /** The viewer. */
  you?: boolean;
  /** Profile photo, when GitHub has one. */
  avatar?: string;
  /** Work email, when known (the sample team). */
  email?: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: MemberRole;
  reviewAs?: ReviewAs;
  /** ISO time it was sent last. */
  sentAt: string;
  /** Seed of the drawn face, when the person is known (the sample team's Sofia); else the email seeds it. */
  face?: string;
}

/** Someone the email field suggests: in the team or its organization, known to Bridge. */
export interface KnownPerson {
  name: string;
  /** What the invite is sent to: their work email, when known. */
  email?: string;
  /** Their GitHub account, when known: the server may add an organization member directly. */
  login?: string;
}

/** You first, then admins, reviewers, editors and viewers, by name inside each. */
export function sortMembers<M extends Pick<Member, 'role' | 'name' | 'you'>>(xs: readonly M[]): M[] {
  const rank: Record<MemberRole, number> = { admin: 0, reviewer: 1, edit: 2, view: 3 };
  return [...xs].sort((a, b) => Number(Boolean(b.you)) - Number(Boolean(a.you)) || rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
}

/** How many admins: the last one cannot be removed or made something else. */
export const adminCount = (xs: readonly Pick<Member, 'role'>[]) => xs.filter((m) => m.role === 'admin').length;

/** What a viewer may do to one member (board I3): never to themselves, never leave the team without an admin. */
export function memberActions(m: Pick<Member, 'role' | 'you'>, f: { canManage: boolean; admins: number }): { changeRole: boolean; makeAdmin: boolean; remove: boolean } {
  if (!f.canManage || m.you) return { changeRole: false, makeAdmin: false, remove: false };
  const lastAdmin = m.role === 'admin' && f.admins <= 1;
  return { changeRole: !lastAdmin, makeAdmin: m.role !== 'admin', remove: !lastAdmin };
}

/** "Invited 2 days ago, not joined yet" (boards I1, I3). */
export function pendingLine(sentAt: string, now: number): string {
  const s = Math.max(0, (now - new Date(sentAt).getTime()) / 1000);
  const d = Math.floor(s / 86400);
  const when = s < 3600 ? 'just now' : d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  return `Invited ${when}, not joined yet`;
}

// --- The email field ------------------------------------------------------------------------------------------

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[A-Za-z]{2,}$/;

/** A plausible work email (the server checks again). */
export const isEmail = (s: string) => s.length <= 254 && EMAIL.test(s.trim());

/** Emails pasted or typed at once ("ann@acme.design, leo@acme.design"), lower case, valid and new ones only. */
export function parseEmails(text: string, already: readonly string[] = []): string[] {
  const seen = new Set(already.map((e) => e.toLowerCase()));
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const e = raw.trim().replace(/^<|>$/g, '').toLowerCase();
    if (!e || !isEmail(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** At most this many people in one send (the server keeps the same cap). */
export const MAX_INVITES = 10;

/** One option of the email field (DS Combobox): a person or the typed address. */
export interface InviteOption {
  /** The email the invite goes to: the option's value, unique. */
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * The email field's options for what is typed: known people whose name or email matches (people already in the team
 * are listed, disabled, "Already in Acme Design"), and the typed address itself when it is a new valid email.
 * Known people without an email are left out: an invite always goes to an address.
 */
export function inviteOptions(query: string, f: { people: readonly KnownPerson[]; members: readonly Pick<Member, 'email' | 'login'>[]; pending: readonly Pick<PendingInvite, 'email'>[]; chosen: readonly string[]; team: string }): InviteOption[] {
  const q = query.trim().toLowerCase();
  const taken = new Set([...f.members.map((m) => m.email?.toLowerCase()), ...f.pending.map((p) => p.email.toLowerCase())].filter(Boolean) as string[]);
  const memberLogins = new Set(f.members.map((m) => loginKey(m.login ?? '')).filter(Boolean));
  const out: InviteOption[] = [];
  for (const p of f.people) {
    if (!p.email) continue;
    const email = p.email.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q) && !email.includes(q)) continue;
    const inTeam = taken.has(email) || (p.login ? memberLogins.has(loginKey(p.login)) : false);
    // A chosen person's chip shows the address the invite goes to (board I1), their name under it in the list.
    if (f.chosen.includes(email)) {
      out.push({ value: email, label: email, description: p.name });
      continue;
    }
    out.push({ value: email, label: p.name, description: inTeam ? `${email} · Already in ${f.team}` : email, ...(inTeam ? { disabled: true } : {}) });
  }
  // Keep the chosen ones in the list so their chips keep a label, and offer the typed address when it is new.
  for (const c of f.chosen) if (!out.some((o) => o.value === c)) out.push({ value: c, label: c });
  if (isEmail(q) && !out.some((o) => o.value === q)) out.push(taken.has(q) ? { value: q, label: q, description: `Already in ${f.team}`, disabled: true } : { value: q, label: q, description: 'Invite by email' });
  return out;
}

/** The login of a known person invited by email, so the server may add an organization member directly. */
export function inviteePeople(emails: readonly string[], people: readonly KnownPerson[]): { email: string; login?: string }[] {
  return emails.map((email) => {
    const p = people.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    return p?.login ? { email, login: p.login } : { email };
  });
}

/** The primary button: "Send 2 invites" (board I1). */
export function sendLabel(n: number): string {
  if (n <= 0) return 'Send invites';
  return n === 1 ? 'Send 1 invite' : `Send ${n} invites`;
}

/** What happened to a send, in one sentence for the dialog's live line. */
export function sentSummary(results: readonly { status: 'sent' | 'added' | 'already' | 'failed' }[]): string {
  const n = (s: string) => results.filter((r) => r.status === s).length;
  const parts: string[] = [];
  const sent = n('sent');
  const added = n('added');
  if (sent) parts.push(`${sent} ${sent === 1 ? 'invite' : 'invites'} sent`);
  if (added) parts.push(`${added} added to the team`);
  if (n('already')) parts.push(`${n('already')} already invited`);
  if (n('failed')) parts.push(`${n('failed')} not sent`);
  const s = parts.join(', ');
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}.` : '';
}

// --- Contexts -------------------------------------------------------------------------------------------------

/**
 * Which people a page shows, never mixed: the sample team's (fixed, no GitHub call), a real team's (GitHub and this
 * site's invites), or none at all for the browser workspace, which has no repository yet.
 */
export type MembersContext = 'sample' | 'real' | 'none';

export function membersContext(repo: string | null, noRepo: boolean): MembersContext {
  if (noRepo || !repo) return 'none';
  return isSampleTeam(repo) ? 'sample' : 'real';
}

/** The words of each state of the Members band and the dialog. */
export const MEMBERS_WORDS = {
  title: 'Invite collaborators',
  intro: 'They get an email, sign in with GitHub, and land in your team with the role you pick.',
  email: 'Work email',
  emailHint: 'Add several people at once. They all get the role on the right.',
  emailPlaceholder: 'name@company.com',
  who: 'Who has access',
  onlyAdmins: 'Only admins can invite.',
  readOnly: 'Only admins can invite people or change roles.',
  noRepo: 'Connect your design system first',
  noRepoText: 'Members come from your design system on GitHub. Once it is connected, invite your team from here.',
  unavailable: 'Invites are not available yet on this site.',
  membersTitle: 'Members',
  membersIntro: (team: string) => `Who is in ${team} and what each person can do. Changes apply the next time they open Bridge.`,
  membersIntroReader: (team: string) => `Who is in ${team} and what each person can do. Only admins can invite people or change roles.`,
  unreadable: 'GitHub shows the full list to people who can edit. Here are the reviewers from your settings.',
  resend: 'Resend',
  resent: 'Sent again.',
  makeAdmin: 'Make admin',
  remove: 'Remove from team',
  cancelInvite: 'Cancel invite',
  removeConfirm: (name: string, team: string) => `Remove ${name} from ${team}? They lose access on GitHub too.`,
  reviewerNote: 'Reviewers start once the settings change is approved.',
  limitReached: "You reached today's invite limit. Try again tomorrow.",
} as const;

/** Where a person adds and verifies the emails of their GitHub account. */
export const GITHUB_EMAILS_URL = 'https://github.com/settings/emails';

export type AcceptEmailCode = 'email_mismatch' | 'email_unverified' | 'email_access';

/**
 * The invite page when the signed-in GitHub account is not the invited one (api/invites accept): what happened, with
 * the address the invite was sent to (masked by the server, "m•••@acme.design"), and how to fix it.
 */
export function acceptEmailWords(code: AcceptEmailCode, sentTo: string, login: string): { title: string; sub: string; action: string } {
  const to = sentTo || 'another email';
  if (code === 'email_unverified')
    return {
      title: 'Verify your email on GitHub first',
      sub: `This invitation was sent to ${to}. That email is on your GitHub account but not verified yet. Verify it on GitHub, then try again.`,
      action: 'Verify on GitHub',
    };
  if (code === 'email_access')
    return {
      title: 'Sign in again to join',
      sub: 'Bridge needs to see the emails on your GitHub account to check this invitation is yours. Sign in with GitHub again and allow it.',
      action: 'Sign in with GitHub',
    };
  return {
    title: 'This invitation is for another email',
    sub: `It was sent to ${to}, which is not an email of your GitHub account${login ? ` @${login}` : ''}. Add and verify that email on GitHub, then try again. Or ask your admin to invite the email you use on GitHub.`,
    action: 'Add the email on GitHub',
  };
}

// --- The sample team ------------------------------------------------------------------------------------------

/**
 * Acme Design's people (boards I3, I4): the visitor sits in Dana's seat (the demo persona, bridge.config.json "demo"),
 * Ann reviews design, Leo edits, Malik reviews code and Sofia has not joined yet. Fixed sample data, never read from
 * GitHub, so a guest's Members page and invite dialog make no GitHub call. Their logins are the ones the demo home
 * gives them ("Requested by Ann Leroy." becomes ~ann-leroy, lib/home-model requesterPerson), so each drawn face is
 * the same person on the home, in Members and in the dialog.
 */
export function sampleTeam(lead = 'Dana'): { members: Member[]; pending: PendingInvite[]; people: KnownPerson[] } {
  const members: Member[] = [
    { login: '~dana', name: lead, role: 'admin', reviews: ['design'], you: true, email: 'dana@acme.design' },
    { login: '~ann-leroy', name: 'Ann', role: 'reviewer', reviews: ['design'], email: 'ann@acme.design' },
    { login: '~leo-martin', name: 'Leo', role: 'edit', reviews: [], email: 'leo@acme.design' },
    { login: '~malik-haddad', name: 'Malik', role: 'reviewer', reviews: ['tech'], email: 'malik@acme.design' },
  ];
  const twoDaysAgo = new Date(Date.UTC(2026, 9, 20, 9)).toISOString();
  const pending: PendingInvite[] = [{ id: 'sample-sofia', email: 'sofia@acme.design', role: 'view', sentAt: twoDaysAgo, face: '~sofia-reyes' }];
  // The organization's people the field suggests: the team itself (disabled, already in) and two who are not in it yet.
  const people: KnownPerson[] = [
    ...members.filter((m) => !m.you).map((m) => ({ name: m.name, email: m.email!, login: m.login })),
    { name: 'Mal Reyes', email: 'mal.reyes@acme.design' },
    { name: 'Priya Natarajan', email: 'priya@acme.design' },
  ];
  return { members, pending, people };
}

/** The sample team's "now", so its pending line always reads the same ("Invited 2 days ago"). */
export const SAMPLE_NOW = Date.UTC(2026, 9, 22, 9);
