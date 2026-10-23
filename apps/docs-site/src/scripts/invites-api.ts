// The browser side of /api/invites (api/invites/index.ts): send, resend and cancel invites, change a role, remove
// someone, accept an invitation. Every call carries the visitor's GitHub sign-in; the server checks on GitHub who they
// are and that they administer the repository before it changes anything, so nothing here is trusted for access. An
// email admin (no GitHub sign-in) is sent as their Bridge account instead: the httpOnly cookie and X-Bridge-Account,
// checked by the server against the team's email admins.
// When the site has no invites server (an older deploy, a fork, `astro dev`) or it is not set up yet, every call
// fails with InvitesUnavailable and the screens say "Invites are not available yet on this site." Never a fake success.
import type { MemberRole, PendingInvite, ReviewAs } from '../lib/invites';
import { MEMBERS_WORDS } from '../lib/invites';
import { getToken } from './github-session';
import { isContribAuth } from '../lib/contribute';
import { ACCOUNT_HEADER } from '../lib/account';

export const INVITES_API = '/api/invites';

/** The site cannot send invites (no server piece, or not configured). */
export class InvitesUnavailable extends Error {
  constructor() {
    super(MEMBERS_WORDS.unavailable);
    this.name = 'InvitesUnavailable';
  }
}

/** The server refused or failed, with a sentence a designer can act on. */
export class InvitesError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    /** The rest of the answer: `limit` on a 429, `sentTo` (masked) and `login` when an invite is for another email. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'InvitesError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: Fetch = (input, init) => fetch(input, init);

/** Tests swap the network. */
export function setInvitesFetch(f: Fetch | null) {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
}

async function call<T>(method: 'GET' | 'POST', query: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? getToken() : null;
  // A GitHub sign-in goes along; without one (an email admin), the Bridge account cookie speaks for the person.
  if (token && !isContribAuth(token)) headers.Authorization = `Bearer ${token}`;
  else if (auth) headers[ACCOUNT_HEADER] = '1';
  let res: Response;
  try {
    res = await fetchImpl(`${INVITES_API}${query}`, { method, headers, credentials: 'same-origin', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new InvitesError('Bridge did not answer. Check your connection and try again.', 'network', 0);
  }
  // No function at this address (404, or the static host's HTML page): this site has no invites server yet.
  const json = /json/i.test(res.headers.get('content-type') ?? '');
  if (res.status === 404 || res.status === 405 || !json) throw new InvitesUnavailable();
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 503 && data.error === 'not_configured') throw new InvitesUnavailable();
  if (!res.ok) {
    // A daily cap or a resend too soon: never silent, and in the server's words when it gave some.
    const fallback = res.status === 429 ? MEMBERS_WORDS.limitReached : 'Something went wrong. Try again in a minute.';
    const message = typeof data.message === 'string' && data.message ? data.message : fallback;
    const { error: _e, message: _m, ...details } = data;
    throw new InvitesError(message, typeof data.error === 'string' ? data.error : 'failed', res.status, details);
  }
  return data as T;
}

let available: Promise<boolean> | null = null;

/** Whether this site can send invites at all (asked once per page, no sign-in needed). */
export function invitesAvailable(): Promise<boolean> {
  available ??= call<{ available?: boolean }>('GET', '', undefined, false).then(
    (r) => r.available === true,
    () => false,
  );
  return available;
}

/**
 * Pending invites of a team (people with write access may read them), whether the repository is a person's, and the
 * team's email contributors (`members`, rows with `via: 'email'`; lib/invites emailMembers reads them).
 */
export function listInvites(repo: string): Promise<{ invites: PendingInvite[]; personal: boolean; members: unknown[] }> {
  return call<{ invites?: PendingInvite[]; personal?: boolean; members?: unknown[] }>('GET', `?repo=${encodeURIComponent(repo)}`).then((r) => ({
    invites: Array.isArray(r.invites) ? r.invites : [],
    personal: r.personal === true,
    members: Array.isArray(r.members) ? r.members : [],
  }));
}

export type SendStatus = 'sent' | 'added' | 'already' | 'failed';

export interface SendResult {
  email: string;
  status: SendStatus;
  message?: string;
}

export function sendInvites(repo: string, choice: { role: MemberRole; reviewAs?: ReviewAs }, people: { email: string; login?: string }[]): Promise<SendResult[]> {
  return call<{ results?: SendResult[] }>('POST', '', { action: 'invite', repo, role: choice.role, ...(choice.reviewAs ? { reviewAs: choice.reviewAs } : {}), people }).then((r) => r.results ?? []);
}

export const resendInvite = (repo: string, id: string) => call<{ invite?: PendingInvite }>('POST', '', { action: 'resend', repo, id });

/** The role a pending invite will get: same link, no new email. */
export const setInviteRole = (repo: string, id: string, choice: { role: MemberRole; reviewAs?: ReviewAs }) =>
  call<{ invite?: PendingInvite }>('POST', '', { action: 'invite-role', repo, id, role: choice.role, ...(choice.reviewAs ? { reviewAs: choice.reviewAs } : {}) });

export const cancelInvite = (repo: string, id: string) => call<{ ok: boolean }>('POST', '', { action: 'cancel', repo, id });

export interface OwnersPr {
  number: number;
  url: string;
}

export const setMemberRole = (repo: string, login: string, choice: { role: MemberRole; reviewAs?: ReviewAs }) =>
  call<{ ok: boolean; ownersPr?: OwnersPr; ownersError?: string }>('POST', '', { action: 'set-role', repo, login, role: choice.role, ...(choice.reviewAs ? { reviewAs: choice.reviewAs } : {}) });

export const removeMember = (repo: string, login: string) => call<{ ok: boolean; ownersPr?: OwnersPr; ownersError?: string }>('POST', '', { action: 'remove', repo, login });

/** An email member's role: Can edit or Admin (Reviewer answers 409 github-required: reviewers approve on GitHub). */
export const setEmailMemberRole = (repo: string, email: string, choice: { role: MemberRole; reviewAs?: ReviewAs }) =>
  call<{ ok: boolean; ownersPr?: OwnersPr; ownersError?: string }>('POST', '', { action: 'set-role', repo, email, role: choice.role, ...(choice.reviewAs ? { reviewAs: choice.reviewAs } : {}) });

/** Removes an email contributor: their session ends at once (the server drops the member record). */
export const removeEmailMember = (repo: string, email: string) => call<{ ok: boolean }>('POST', '', { action: 'remove', repo, email });

