// Opening a team from what someone types (multi-team plan 4.3): one place for the Studio home launcher
// (components/ds/studio/TeamLauncher.tsx) and the "Create a new team" dialog of the team chip
// (components/ds/studio/NewTeamDialog.tsx). The parser itself is lib/team-path.ts parseTeamInput; this module adds
// what both screens say about it, where the team opens, and the words of the optional access check. No DOM.

import type { RepoAccessState } from '@bridge-ds/core';
import { parseTeamInput, RESERVED_PATHS_URL, teamHref, type ReservedPaths, type TeamInputError } from './team-path';

/** What to fix, per error (Bridge voice: says how to fix it). */
export const TEAM_INPUT_ERRORS: Record<TeamInputError, string> = {
  empty: 'Enter a repository, like acme/design-system.',
  'no-repo': 'Add the repository after the owner, like acme/design-system.',
  'not-github': 'Bridge opens repositories on GitHub. Paste a github.com address or owner/repo.',
  invalid: 'That is not a GitHub repository name. Use owner/repo, like acme/design-system.',
};

/** The repository in a field, or the sentence to show under it. */
export type TeamField = { ok: true; owner: string; repo: string } | { ok: false; error: TeamInputError; message: string };

/** parseTeamInput, with the sentence for an error. */
export function readTeamField(value: string): TeamField {
  const parsed = parseTeamInput(value);
  return parsed.ok ? parsed : { ...parsed, message: TEAM_INPUT_ERRORS[parsed.error] };
}

/** The reserved pairs of this build, read once per page; null when they cannot be read (teamHref then escapes). */
let reserved: Promise<ReservedPaths | null> | null = null;
export function loadReserved(fetcher: typeof fetch = fetch): Promise<ReservedPaths | null> {
  reserved ??= fetcher(RESERVED_PATHS_URL)
    .then((r) => (r.ok ? (r.json() as Promise<ReservedPaths>) : null))
    .then((v) => (v && Array.isArray(v.pairs) ? v : null))
    .catch(() => null);
  return reserved;
}

/** Where a team opens: its Studio address, the escape form when this build takes the pair. */
export async function openTeamHref(owner: string, repo: string, load: () => Promise<ReservedPaths | null> = loadReserved): Promise<string> {
  return teamHref(owner, repo, await load());
}

// --- The live check in the dialog ------------------------------------------------------------------------------------

/** How long the field waits after the last keystroke before asking GitHub. */
export const TEAM_CHECK_DEBOUNCE_MS = 600;

export type TeamCheckKind = 'ready' | 'read-only' | 'not-installed' | 'not-found' | 'sign-in';

export interface TeamCheck {
  kind: TeamCheckKind;
  /** The badge words. */
  label: string;
  tone: 'success' | 'info' | 'warning' | 'neutral';
  /** One sentence after the badge. */
  text: string;
  /** "Install Bridge": only for an admin of the repository where Bridge is not set up. */
  install?: boolean;
}

/**
 * What the dialog says about a repository, from the access state (core resolveRepoAccess) and whether the viewer is
 * signed in. Null state: GitHub could not be asked (rate limit, network); signed out that still reads "Sign in to
 * check", signed in it says nothing (the team page will tell).
 */
export function teamCheck(state: RepoAccessState | null, f: { signedIn: boolean; repoAdmin?: boolean | undefined }): TeamCheck | null {
  switch (state) {
    case 'admin':
    case 'writer':
      return { kind: 'ready', label: 'Ready', tone: 'success', text: 'You can review, suggest and edit here.' };
    case 'reader':
      return { kind: 'ready', label: 'Ready', tone: 'success', text: 'You can review and send suggestions.' };
    case 'outside-contributor':
      return { kind: 'read-only', label: 'Read only', tone: 'info', text: 'You are not on this team on GitHub. You can look around and suggest.' };
    case 'not-installed':
      return f.repoAdmin
        ? { kind: 'not-installed', label: 'Bridge is not installed yet', tone: 'warning', text: 'Install it once for your whole team.', install: true }
        : { kind: 'not-installed', label: 'Bridge is not installed yet', tone: 'warning', text: 'An admin of the repository installs it once.' };
    case 'no-access':
      return { kind: 'not-found', label: 'Not found or private', tone: 'neutral', text: 'Check the spelling, or ask your lead for access.' };
    case 'anonymous-public':
      return { kind: 'sign-in', label: 'Sign in to check', tone: 'neutral', text: 'This repository is public. Sign in with GitHub to see what you can do.' };
    case 'anonymous-unknown':
      return { kind: 'sign-in', label: 'Sign in to check', tone: 'neutral', text: 'Not found, or private. Sign in with GitHub to check.' };
    default:
      return f.signedIn ? null : { kind: 'sign-in', label: 'Sign in to check', tone: 'neutral', text: 'Sign in with GitHub to see what you can do.' };
  }
}
