// A Bridge account whose linked GitHub account is on the team, in a browser without the GitHub sign-in (the server
// reads the role with the Bridge app: GET /api/entry?linked=, scripts/linked-role.ts). Its real role shows on the team
// chip and in "Your teams", the team page never treats it as a visitor (no read-only strip on Bridge's own team), and
// one calm banner asks to reconnect GitHub, since changes are made with the person's own GitHub sign-in.
import type { RepoAccessState } from '@bridge-ds/core';
import type { AccessScreen } from './access-view';
import { teamDisplayName } from './demo';

export type LinkedRole = 'admin' | 'edit' | 'view';

/** The access state the chip and "Your teams" show for that role (Admin, Can edit, Can view). */
export function linkedAccessState(role: LinkedRole | null | undefined): RepoAccessState | null {
  return role === 'admin' ? 'admin' : role === 'edit' ? 'writer' : role === 'view' ? 'reader' : null;
}

/** On the team: makes changes once GitHub is reconnected. A GitHub reader stays a visitor of the page as before. */
export const linkedMember = (role: LinkedRole | null | undefined): boolean => role === 'admin' || role === 'edit';

export const RECONNECT_WORDS = {
  title: 'Reconnect GitHub to make changes',
  action: 'Reconnect GitHub',
  /** The GitHub dialog, opened by a change: why it asks. */
  dialog: 'Your Bridge account knows your GitHub, but this browser is not signed in to it. Sign in with GitHub to make this change.',
} as const;

/**
 * The banner over the team page: who they are on GitHub, and the one action. `layout: 'block'` when the page cannot
 * show anything without GitHub (a private repository), else a banner over the page.
 */
export function reconnectScreen(x: { owner: string; repo: string; role: 'admin' | 'edit'; login?: string | null; name?: string | null; block?: boolean }): AccessScreen {
  const team = teamDisplayName(`${x.owner}/${x.repo}`, { name: x.name });
  const who = x.role === 'admin' ? `an admin of ${team}` : `on ${team} and can edit it`;
  const as = x.login ? ` as ${x.login}` : '';
  return {
    layout: x.block ? 'block' : 'banner',
    tone: 'info',
    title: RECONNECT_WORDS.title,
    body: `You are ${who} on GitHub${as}. Sign in with GitHub again in this browser to review, approve and ship.`,
    primary: { kind: 'signin', label: RECONNECT_WORDS.action },
  };
}
