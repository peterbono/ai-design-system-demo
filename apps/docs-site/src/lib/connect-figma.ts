// "Sign in with Bridge" from the Figma plugin, the Studio side (/studio/connect-figma/?code=…, api/plugin-link): which
// step the person is at, and the words. Pure, covered by connect-figma.test.ts. The page is ConnectFigma.tsx.

import type { Account, AccountTeam } from './account';

export const LINK_API = '/api/plugin-link';
export const CODE_PARAM = 'code';
const CODE = /^[A-Z2-7]{10}$/;

/** The code in the address, or null when there is none or it is not one of ours. */
export function codeFrom(search: string): string | null {
  const c = new URLSearchParams(search).get(CODE_PARAM)?.trim().toUpperCase() ?? '';
  return CODE.test(c) ? c : null;
}

export type ConnectStep =
  | { kind: 'no-code' }
  | { kind: 'signin' }
  | { kind: 'github' }
  | { kind: 'no-teams' }
  | { kind: 'pick'; teams: PickTeam[] };

/** A team to pick: its repository and the name it goes by. */
export type PickTeam = Pick<AccountTeam, 'repo'> & { name: string | null };

/**
 * Where the person is: no code, not signed in, no GitHub sign-in in this browser, no team, or pick a team. `teams` is
 * the list the team switcher shows (scripts/pickable-teams.ts: the account's teams, the site's own design system when
 * GitHub lets this person push to it, the teams this browser opened); without it, the account's teams.
 */
export function connectStep(code: string | null, account: Account | null, hasGitHub: boolean, pickable?: readonly PickTeam[]): ConnectStep {
  if (!code) return { kind: 'no-code' };
  if (!account) return { kind: 'signin' };
  if (!hasGitHub) return { kind: 'github' };
  const teams = [...(pickable ?? account.teams)].sort((a, b) => (a.name ?? a.repo).localeCompare(b.name ?? b.repo));
  return teams.length ? { kind: 'pick', teams } : { kind: 'no-teams' };
}

export const teamLabel = (t: Pick<AccountTeam, 'name' | 'repo'>) => t.name?.trim() || t.repo.split('/')[1] || t.repo;

export const CONNECT_WORDS = {
  title: 'Connect Figma',
  lede: 'Pick the team whose design system this Figma file uses. Bridge connects the plugin, nothing else changes.',
  noCode: 'Open this page from the Bridge plugin in Figma: Settings, Sign in with Bridge.',
  signin: 'Sign in to Bridge first, then come back here.',
  signinAction: 'Sign in',
  github: 'The plugin works on your design system through GitHub. Connect your GitHub account once, then pick the team.',
  githubAction: 'Connect GitHub',
  noTeams: 'You are not in a team yet. Ask your design system owner to invite you, then open this page again from Figma.',
  teamLabel: 'Team',
  connect: 'Connect Figma',
  connecting: 'Connecting',
  doneTitle: 'Figma is connected',
  done: (team: string) => `Go back to Figma: the plugin now works with ${team}. You can close this tab.`,
  failed: 'Bridge could not connect Figma. Try again in a minute.',
} as const;
