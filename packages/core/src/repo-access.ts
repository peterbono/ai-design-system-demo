// What one visitor can do in one repository, from GitHub alone (multi-team plan, section 3.3). Pure: the facts come
// from GET /repos/{owner}/{repo} (visibility and the viewer's permissions) and, for a GitHub App sign-in, from the
// user's installations. Roles from bridge.config.json (owners, rights) are evaluated on top by the caller, as today.

import { GitHubClient, GitHubError, type RepoInfo } from './github-client';

/**
 * - anonymous-public: not signed in, the repository is public (read-only Studio).
 * - anonymous-unknown: not signed in, GitHub answers 404 (private or missing: GitHub does not say which).
 * - no-access: signed in, GitHub answers 404 (no such repo, not a collaborator, or the App is not installed on it).
 * - not-installed: signed in with explicit permission (triage or more) on a public repository, and the App's
 *   installations do not cover it: it is not installed there.
 * - outside-contributor: signed in, public repository, read access only, and no App installation lists it. GitHub
 *   lists installations only where the user has explicit permission, so this may be a non-collaborator of a repo
 *   where Bridge is installed: never say "not installed" here. Browse only; ask an admin for access.
 * - reader: pull or triage. Browse, comment, file suggestions.
 * - writer: push or maintain. Plus direct changes.
 * - admin: admin. Plus settings and protection.
 */
export type RepoAccessState = 'anonymous-public' | 'anonymous-unknown' | 'no-access' | 'not-installed' | 'outside-contributor' | 'reader' | 'writer' | 'admin';

/** The viewer's permissions on a repository, as GET /repos returns them. */
export type RepoPermissions = NonNullable<RepoInfo['permissions']>;

export interface AccessFacts {
  /** A token was sent. */
  signedIn: boolean;
  /** GET /repos answered 200 (false on 404). */
  visible: boolean;
  /**
   * An installation of the App the user can reach covers the repository; null or undefined when not checked
   * (personal token) or GitHub would not say.
   */
  installed?: boolean | null | undefined;
  /** GET /repos said the repository is private. */
  private?: boolean | undefined;
  permissions?: RepoPermissions | undefined;
}

/** The access state from the facts (section 3.3 table). */
export function accessState(f: AccessFacts): RepoAccessState {
  if (!f.visible) return f.signedIn ? 'no-access' : 'anonymous-unknown';
  if (!f.signedIn) return 'anonymous-public';
  const p = f.permissions ?? {};
  // A private repository an App token can see is one the App is installed on, whatever the listing said.
  if (f.installed === false && !f.private) return p.admin || p.maintain || p.push || p.triage ? 'not-installed' : 'outside-contributor';
  if (p.admin) return 'admin';
  if (p.push || p.maintain) return 'writer';
  return 'reader';
}

const RANK: Record<RepoAccessState, number> = {
  'anonymous-unknown': 0,
  'no-access': 0,
  'anonymous-public': 1,
  'not-installed': 1,
  'outside-contributor': 1,
  reader: 2,
  writer: 3,
  admin: 4,
};

/**
 * True when `state` grants at least what `min` grants: 'reader' (suggest, comment), 'writer' (direct changes),
 * 'admin' (settings). The read-only states rank as 'anonymous-public'; the closed ones rank lowest.
 */
export function accessAtLeast(state: RepoAccessState, min: 'anonymous-public' | 'reader' | 'writer' | 'admin'): boolean {
  return RANK[state] >= RANK[min];
}

export interface RepoAccess {
  state: RepoAccessState;
  owner: string;
  repo: string;
  /** Undefined when GitHub did not show the repository. */
  private: boolean | undefined;
  defaultBranch: string | undefined;
  permissions: RepoPermissions | undefined;
  /** The App installation that gives the user this repository, when checked and found. */
  installationId?: number | undefined;
  /** With a Direct App client: whether that App is installed for the user on the repository (null when unknown). */
  directInstalled?: boolean | null | undefined;
}

export interface ResolveAccessOptions {
  /**
   * The client's token is a GitHub App user-to-server token: check its installations (2 or 3 calls). Leave off for a
   * personal token or anonymous reads; the state then comes from GET /repos alone.
   */
  app?: boolean;
  /** A client with the Direct App's token, to learn whether that App is installed too (changes: "direct"). */
  direct?: GitHubClient;
}

/** Installed, not installed, or null when GitHub would not say (personal token, missing permission, network). */
async function installed(client: GitHubClient, owner: string, repo: string): Promise<{ installed: boolean | null; id?: number }> {
  try {
    const found = await client.findInstallation(owner, repo);
    return found ? { installed: true, id: found.id } : { installed: false };
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 401 || err.status === 429)) throw err;
    return { installed: null };
  }
}

/**
 * Reads what the client's token (or no token) can do on the client's repository. With `app`, the client's token must
 * be a user token of the signing-in App (each App lists only its own installations). A 404 is a state, not an error;
 * a rejected token (401) and an exhausted rate limit (429) are thrown for the caller to handle as today.
 */
export async function resolveRepoAccess(client: GitHubClient, opts: ResolveAccessOptions = {}): Promise<RepoAccess> {
  const signedIn = client.canWrite;
  const base = { owner: client.owner, repo: client.name };
  let info: RepoInfo;
  try {
    info = await client.getRepo();
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return { ...base, state: accessState({ signedIn, visible: false }), private: undefined, defaultBranch: undefined, permissions: undefined };
    }
    throw err;
  }
  const inst = signedIn && opts.app ? await installed(client, client.owner, client.name) : { installed: null };
  const direct = signedIn && opts.direct ? (await installed(opts.direct, client.owner, client.name)).installed : undefined;
  return {
    ...base,
    state: accessState({ signedIn, visible: true, installed: inst.installed, private: info.private, permissions: info.permissions }),
    private: info.private,
    defaultBranch: info.defaultBranch,
    permissions: info.permissions,
    ...(inst.id !== undefined ? { installationId: inst.id } : {}),
    ...(direct !== undefined ? { directInstalled: direct } : {}),
  };
}
