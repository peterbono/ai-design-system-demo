// What the visitor may do on one repository, as the Studio uses it (multi-team plan, section 3.3). Core's
// resolveRepoAccess reads the facts from GitHub and names one of eight states; this module turns a state into the
// flags the Studio scripts already act on (write, reach) and keeps the per-repository cache rules. Pure: no DOM, no
// storage, covered by access.test.ts.

import { accessAtLeast, type RepoAccess as CoreRepoAccess, type RepoAccessState } from '@bridge-ds/core';

export type { RepoAccessState };

/** One visitor's access to one repository. */
export interface RepoAccess {
  state: RepoAccessState;
  /** May change the code (push, maintain or admin) and, with Sign in with GitHub, the app reaches the repository. */
  write: boolean;
  /** Admin of the repository: settings and protection. */
  admin: boolean;
  /**
   * Signed in with the app: false when the app does not reach the repository for this account (not installed there,
   * or the account cannot see it), true when an installation was found. Absent when not checked or GitHub would not
   * say (a pasted token; a read-only outside contributor, whose installations GitHub does not list).
   */
  reach?: boolean;
  /** GitHub said the repository is private. Absent when it did not show the repository. */
  private?: boolean;
  /**
   * Bridge is not set up on the repository (not-installed) and GitHub says this account administers it: it sees the
   * "Install Bridge" link (lib/access-view.ts). Absent otherwise (`admin` says it once Bridge is set up).
   */
  repoAdmin?: boolean;
  /**
   * An email contributor (lib/contribute.ts): edits through Bridge's proxy, never admin (but in local mode), and reviews nothing (no
   * approve, request changes, merge or owner override). Absent for a GitHub account.
   */
  contributor?: true;
}

/**
 * What an email contributor may do: edit, never review. Never administer, except an email admin (`admin`). Can view
 * (`view`) is the read-only Studio a GitHub reader gets: state reader, no write. Reachable through Bridge's own app.
 */
export function contributorAccess(admin = false, view = false): RepoAccess {
  if (view && !admin) return { state: 'reader', write: false, admin: false, reach: true, contributor: true };
  return { state: 'writer', write: true, admin, reach: true, contributor: true };
}

/**
 * The state the team pill and the team menu show: GitHub's, except an email member, whose role is the one
 * /api/contribute gives (`role`, else the access's own admin flag): an admin reads "Admin", never "Can edit".
 */
export function pillState(a: Pick<RepoAccess, 'state' | 'admin' | 'contributor'> | null | undefined, role?: string | null): RepoAccessState | null {
  if (!a) return null;
  if (!a.contributor) return a.state;
  if (role === 'admin' || (role == null && a.admin)) return 'admin';
  return a.state;
}

/** A read made without a sign-in (the team's public state): it says nothing about a signed-in person's role. */
export const anonymousAccess = (a: Pick<RepoAccess, 'state'> | null | undefined): boolean => a?.state === 'anonymous-public' || a?.state === 'anonymous-unknown';

/** May approve, request changes, merge or override: a GitHub account with write access, never an email contributor. */
export const canReview = (a: Pick<RepoAccess, 'write' | 'contributor'> | null | undefined): boolean => Boolean(a?.write && !a.contributor);

/** How long a resolved access is reused before GitHub is asked again (memory and sessionStorage). */
export const ACCESS_MAX_AGE_MS = 10 * 60 * 1000;

/** The Studio's view of core's access result. `app`: the token is a Sign in with GitHub token. */
export function accessView(a: Pick<CoreRepoAccess, 'state' | 'private' | 'installationId'> & { permissions?: CoreRepoAccess['permissions'] }, app: boolean): RepoAccess {
  const { state } = a;
  const closed = state === 'not-installed' || state === 'no-access';
  const reach = closed ? false : app && (a.installationId !== undefined || (a.private === true && accessAtLeast(state, 'reader'))) ? true : undefined;
  return {
    state,
    write: accessAtLeast(state, 'writer'),
    admin: state === 'admin',
    ...(reach !== undefined ? { reach } : {}),
    ...(typeof a.private === 'boolean' ? { private: a.private } : {}),
    // Only where it says more than `admin`: Bridge is not set up, but this account could install it.
    ...(state === 'not-installed' && a.permissions?.admin === true ? { repoAdmin: true } : {}),
  };
}

/**
 * The access a token check remembers (lib/token-session.ts TokenCheck), so a page shows it before asking GitHub:
 * the state saved for this repository, or, on the self-hosted site (one repository), the write and reach flags saved
 * before states existed. Null when the check says nothing usable.
 */
export function accessFromCheck(
  check: { write?: boolean | null; reach?: boolean | null; access?: { repo: string; state: RepoAccessState; read?: number } | null } | null | undefined,
  repo: string,
  hosted: boolean,
): RepoAccess | null {
  if (!check) return null;
  // An access kept before ACCESS_READ: nothing to show at once (it may be the app's permissions), GitHub says it again.
  if (check.access && check.access.read !== ACCESS_READ) return null;
  if (check.access && check.access.repo.toLowerCase() === repo.toLowerCase()) {
    const { state } = check.access;
    return {
      state,
      write: accessAtLeast(state, 'writer'),
      admin: state === 'admin',
      ...(typeof check.reach === 'boolean' ? { reach: check.reach } : {}),
    };
  }
  if (hosted || typeof check.write !== 'boolean') return null;
  if (check.reach === false) return { state: 'not-installed', write: false, admin: false, reach: false };
  return { state: check.write ? 'writer' : 'reader', write: check.write, admin: false, ...(check.reach === true ? { reach: true } : {}) };
}

/** The sessionStorage key of one access: per app slot, account and repository. */
export const accessStorageKey = (slot: string, login: string, repo: string) => `bridge.github.access:${ACCESS_READ}:${slot}:${login.toLowerCase()}:${repo.toLowerCase()}`;

/**
 * The version of an access read, kept with it (the sessionStorage key above, the token check's `access.read`). Reads
 * kept before it may hold the Bridge app's permissions instead of the viewer's (a GitHub admin kept as "Can view"):
 * they are never shown again, the page asks GitHub once more.
 */
export const ACCESS_READ = 2;

/** A stored access, when it is still fresh. */
export function freshAccess(raw: string | null, now: number, maxAge = ACCESS_MAX_AGE_MS): RepoAccess | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { at?: unknown; access?: RepoAccess };
    return typeof v.at === 'number' && now - v.at < maxAge && v.access && typeof v.access.state === 'string' ? v.access : null;
  } catch {
    return null;
  }
}

/**
 * The access as last read, whatever its age, for a page GitHub will not answer now (busy for the viewer's account):
 * this tab's kept read (`raw`, freshAccess's form), else the token check's last state for this repository. Null when
 * nothing was ever read here: the badge then reads neutral, never "Checking" for the whole wait.
 */
export function lastKnownAccess(raw: string | null, check: { repo: string; state: RepoAccessState; read?: number } | null | undefined, repo: string, app: boolean): RepoAccess | null {
  const kept = freshAccess(raw, Date.now(), Number.POSITIVE_INFINITY);
  if (kept) return kept;
  return check && check.read === ACCESS_READ && check.repo.toLowerCase() === repo.toLowerCase() ? accessView({ state: check.state, private: undefined, installationId: undefined }, app) : null;
}

/** The badge text of an access ('' when signed out, 'Unknown' until read). */
export function accessLabel(signedIn: boolean, a: RepoAccess | null): string {
  if (!signedIn) return '';
  if (!a) return 'Unknown';
  if (a.reach === false) return 'No access';
  // The one set of role names (lib/invites ROLE_WORDS): Admin, Can edit, Can view.
  return a.admin ? 'Admin' : a.write ? 'Can edit' : 'Can view';
}
