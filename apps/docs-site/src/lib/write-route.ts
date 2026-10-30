// Which way a write goes for the viewer, and who keeps an exploration. Pure, unit tested in write-route.test.ts.
//
// A GitHub account that can read the library but not change it (RepoAccess.write false, not an email member) gets
// nothing that fails at GitHub after the click. In direct mode its change goes as a suggestion when the action has one
// (a new brand, a missing piece); an action with no suggestion path (sending an exploration for review, closing it) is
// not offered, and one line says who can do it.

import type { ChangesMode } from '@bridge-ds/core';

export type WriteRoute = 'direct' | 'suggest' | 'none';

/**
 * How this viewer's write goes. `access` null: not known yet (signed out, or GitHub not asked): the team's mode, the
 * page asks to sign in first. An email member keeps the team's mode (Bridge's proxy writes for them). `canSuggest`:
 * the action can be filed as a suggestion.
 */
export function routeFor(access: { write: boolean; contributor?: boolean | undefined } | null | undefined, mode: ChangesMode, canSuggest = true): WriteRoute {
  if (!access || access.contributor) return mode;
  if (mode === 'suggest') return canSuggest ? 'suggest' : 'none';
  if (access.write) return 'direct';
  return canSuggest ? 'suggest' : 'none';
}

/** The mode a send uses: a reader in direct mode suggests. */
export const sendModeFor = (access: Parameters<typeof routeFor>[0], mode: ChangesMode): ChangesMode => (routeFor(access, mode) === 'suggest' ? 'suggest' : mode);

/** Told once under the send when a reader's change goes as a suggestion in a direct-mode team. */
export const READER_SUGGESTS = 'You can view this library but not change it, so this goes as a suggestion for your DS lead.';

/**
 * Whether the viewer may send an exploration for review or close it: the person who started it, or a reviewer, with
 * write access (no suggestion path exists for either).
 */
export function canKeepExploration(x: { viewer: string | null | undefined; author: string; reviewer: boolean; write: boolean | null | undefined }): boolean {
  if (!x.viewer || x.write === false) return false;
  return x.reviewer || x.viewer.replace(/^@/, '').toLowerCase() === x.author.replace(/^@/, '').toLowerCase();
}

/** The line in place of Done exploring and Archive for everyone else. */
export function keepExplorationLine(author: string): string {
  return `Only ${author ? `@${author.replace(/^@/, '')}, who started it,` : 'the person who started it'} or a reviewer can say it is done exploring or archive it.`;
}
