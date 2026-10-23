// The browser side of /api/entry (lib/entry.ts says what each answer is): where to go after the email code, accepting
// an invite, asking to join a team, and for admins the join requests and team discovery. The account session is the
// httpOnly cookie of /api/account; every action carries X-Bridge-Contribute (CSRF), like scripts/contribute-session.ts.
// With GitHub linked and signed in on this browser, the GitHub sign-in goes along (Bearer) so the server can find the
// teams GitHub gives the person and accept reviewer or admin invites; the server never keeps it.
import { CONTRIBUTE_HEADER } from '../lib/contribute';
import { noteAccountTeamNames } from '../lib/recent-teams';
import { ENTRY_API, parseDiscovery, parseEntry, parseRequests, type Discovery, type Entry, type EntryRole, type JoinRequest } from '../lib/entry';

/** The server refused or failed: its sentence, its code ("github-required", "forbidden", "expired"), the status. */
export class EntryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EntryError';
  }
}

const FAILED = 'Something went wrong. Try again in a minute.';
const NETWORK = 'Bridge did not answer. Check your connection and try again.';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: Fetch = (input, init) => fetch(input, init);

/** Tests swap the network. */
export function setEntryFetch(f: Fetch | null) {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
}

/** The GitHub sign-in of this browser, for the server to check; null for an email-only account. */
async function bearer(): Promise<Record<string, string>> {
  try {
    const { workingGitHubToken } = await import('./account-session');
    const token = await workingGitHubToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function call<T>(method: 'GET' | 'POST', query: string, body?: unknown, withGitHub = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(withGitHub ? await bearer() : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers[CONTRIBUTE_HEADER] = '1';
  let res: Response;
  try {
    res = await fetchImpl(`${ENTRY_API}${query}`, { method, headers, credentials: 'same-origin', cache: 'no-store', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new EntryError(NETWORK, 'network', 0);
  }
  const json = /json/i.test(res.headers.get('content-type') ?? '');
  // No function here (an older deploy, `astro dev`): the caller falls back to what it did before.
  if (!json) throw new EntryError(FAILED, 'unavailable', res.status === 200 ? 404 : res.status);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : 'failed';
    const message = typeof data.message === 'string' && data.message ? data.message : FAILED;
    throw new EntryError(message, code, res.status);
  }
  return data as T;
}

/** Where the signed-in account goes (the server decides the kind). */
export async function getEntry(): Promise<Entry> {
  const e = parseEntry(await call('GET', '', undefined, true));
  if (!e) throw new EntryError(FAILED, 'failed', 500);
  // The teams by the names the server keeps: the team page names its team from its first paint, no flip.
  if (e.kind === 'teams') noteAccountTeamNames(e.teams);
  return e;
}

export interface Accepted {
  status: 'joined' | 'accept-on-github';
  repo: string;
  role: EntryRole | string;
  next: string;
  acceptUrl?: string;
}

/** Accepts an invite sent to the account's email. 409 github-required for a reviewer or admin invite without GitHub. */
export async function acceptInvite(repo: string, id: string): Promise<Accepted> {
  const r = await call<Partial<Accepted>>('POST', '', { action: 'accept-invite', repo, id }, true);
  return { status: r.status === 'accept-on-github' ? 'accept-on-github' : 'joined', repo: r.repo ?? repo, role: r.role ?? 'edit', next: typeof r.next === 'string' ? r.next : '', ...(r.acceptUrl ? { acceptUrl: r.acceptUrl } : {}) };
}

/** Asks to join a team open to the work domain; an invite for it is accepted instead (`joined`). */
export async function requestJoin(repo: string): Promise<{ requested: true } | ({ joined: true } & Accepted)> {
  const r = await call<Record<string, unknown>>('POST', '', { action: 'request', repo }, true);
  if (r.joined === true) return { joined: true, status: r.status === 'accept-on-github' ? 'accept-on-github' : 'joined', repo: String(r.repo ?? repo), role: String(r.role ?? 'edit'), next: typeof r.next === 'string' ? r.next : '', ...(typeof r.acceptUrl === 'string' ? { acceptUrl: r.acceptUrl } : {}) };
  return { requested: true };
}

/** Takes back the account's own pending request to join a team. A request already gone (404) counts as cancelled. */
export async function cancelJoinRequest(repo: string): Promise<void> {
  try {
    await call('POST', '', { action: 'cancel-request', repo });
  } catch (err) {
    if (err instanceof EntryError && err.status === 404) return;
    throw err;
  }
}

/** Admins: the join requests of a team. */
export async function listJoinRequests(repo: string): Promise<JoinRequest[]> {
  return parseRequests(await call('GET', `?requests=${encodeURIComponent(repo)}`));
}

/** Admins: whether people with the team's work domain can find it. */
export async function getDiscovery(repo: string): Promise<Discovery | null> {
  return parseDiscovery(await call('GET', `?discovery=${encodeURIComponent(repo)}`));
}

/** Admins: the requester joins with Can edit. */
export async function approveRequest(repo: string, id: string): Promise<{ name: string }> {
  const r = await call<{ member?: { name?: string } }>('POST', '', { action: 'approve', repo, id });
  return { name: r.member?.name ?? '' };
}

export async function declineRequest(repo: string, id: string): Promise<void> {
  await call('POST', '', { action: 'decline', repo, id });
}

/** Admins: takes back an approve or decline within 30 seconds; the request waits again. 410 once too late. */
export async function undoDecision(repo: string, id: string): Promise<void> {
  await call('POST', '', { action: 'undo', repo, id });
}

/** Admins: opens the team to their own work domain, or closes it. 409 public-domain for a public email. */
export async function setDiscovery(repo: string, enabled: boolean): Promise<{ domain: string | null; enabled: boolean }> {
  const r = await call<{ domain?: string | null; enabled?: boolean }>('POST', '', { action: 'discovery', repo, enabled });
  return { domain: r.domain ?? null, enabled: r.enabled === true };
}

/** The refusal of an admin action because no GitHub admin account is linked: shown as a calm link, not an error. */
export const needsGitHubAdmin = (err: unknown): boolean => err instanceof EntryError && err.status === 403 && err.code === 'forbidden';
