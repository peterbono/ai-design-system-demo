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
   * An email contributor (lib/contribute.ts): edits through Bridge's proxy, never admin, and reviews nothing (no
   * approve, request changes, merge or owner override). Absent for a GitHub account.
   */
  contributor?: true;
}

/** What an email contributor may do: edit, never administer, never review. Reachable through Bridge's own app. */
export function contributorAccess(): RepoAccess {
  return { state: 'writer', write: true, admin: false, reach: true, contributor: true };
}

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
  check: { write?: boolean | null; reach?: boolean | null; access?: { repo: string; state: RepoAccessState } | null } | null | undefined,
  repo: string,
  hosted: boolean,
): RepoAccess | null {
  if (!check) return null;
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
export const accessStorageKey = (slot: string, login: string, repo: string) => `bridge.github.access:${slot}:${login.toLowerCase()}:${repo.toLowerCase()}`;

/** A stored access, when it is still fresh. */
export function freshAccess(raw: string | null, now: number): RepoAccess | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { at?: unknown; access?: RepoAccess };
    return typeof v.at === 'number' && now - v.at < ACCESS_MAX_AGE_MS && v.access && typeof v.access.state === 'string' ? v.access : null;
  } catch {
    return null;
  }
}

/** The badge text of an access ('' when signed out, 'Unknown' until read). */
export function accessLabel(signedIn: boolean, a: RepoAccess | null): string {
  if (!signedIn) return '';
  if (!a) return 'Unknown';
  if (a.reach === false) return 'No access';
  return a.write ? 'Read and write' : 'Read only';
}
