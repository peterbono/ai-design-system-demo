// "Sign in with Bridge" when Claude adds the Bridge connector (/studio/connect-claude/?request=…, api/mcp and
// api/_lib/oauth.ts): which step the person is at, and the words. Pure, covered by connect-claude.test.ts. The page is
// ConnectClaude.tsx.
//
// True copy (settled rule "Claude copy must be true"): Claude works as the person, on the team they pick; what it
// changes goes for review like any of their changes; nothing reaches the library without a person's approval.

import type { Account, AccountTeam } from './account';
import { teamLabel } from './connect-figma';

export { teamLabel };

const REQUEST = /^[A-Za-z0-9_-]{20,40}$/;

export interface ConnectQuery {
  request: string | null;
  error: 'no_access' | null;
}

export function readQuery(search: string): ConnectQuery {
  const q = new URLSearchParams(search);
  const r = q.get('request')?.trim() ?? '';
  return { request: REQUEST.test(r) ? r : null, error: q.get('error') === 'no_access' ? 'no_access' : null };
}

export interface RequestInfo {
  client: string;
  redirectHost: string;
  sameBrowser: boolean;
}

export type ClaudeConnectStep =
  | { kind: 'no-request' }
  | { kind: 'no-access' }
  | { kind: 'expired' }
  | { kind: 'other-browser' }
  | { kind: 'signin'; info: RequestInfo }
  | { kind: 'no-teams'; info: RequestInfo }
  | { kind: 'pick'; info: RequestInfo; teams: AccountTeam[] };

/** Where the person is, from the address, the request Bridge kept and their Bridge account. */
export function connectClaudeStep(q: ConnectQuery, info: RequestInfo | null, account: Pick<Account, 'teams'> | null): ClaudeConnectStep {
  if (q.error === 'no_access') return { kind: 'no-access' };
  if (!q.request) return { kind: 'no-request' };
  if (!info) return { kind: 'expired' };
  if (!info.sameBrowser) return { kind: 'other-browser' };
  if (!account) return { kind: 'signin', info };
  const teams = [...account.teams].sort((a, b) => (a.name ?? a.repo).localeCompare(b.name ?? b.repo));
  return teams.length ? { kind: 'pick', info, teams } : { kind: 'no-teams', info };
}

/** "Claude" for the hosted apps, the app's own name otherwise. */
export const appName = (info: Pick<RequestInfo, 'client'>) => info.client.trim() || 'An app';

export const CLAUDE_CONNECT_WORDS = {
  title: 'Use Bridge in Claude',
  lede: (app: string) => `${app} asks to use Bridge with your team's design system.`,
  what: 'Claude works as you, on the team you pick: it reads the design system and opens its changes for review in your name. Nothing reaches the library until someone on your team approves it.',
  back: (host: string) => `When you allow it, you go back to ${host}.`,
  noRequest: 'Open this page from Claude: Settings, Connectors, Add custom connector, then Connect.',
  noAccess: "Your GitHub account cannot change this team's design system. Start again from Claude and pick a team you can edit, or ask its admin for access.",
  expired: 'This sign-in took too long. Start again from Claude.',
  otherBrowser: 'Finish signing in in the browser where you started from Claude.',
  signin: 'Sign in to Bridge first, then come back here.',
  signinAction: 'Sign in',
  noTeams: 'You are not in a team yet. Ask your design system owner to invite you, then start again from Claude.',
  teamLabel: 'Team',
  allow: 'Allow',
  allowing: 'Going to GitHub',
  cancel: 'Cancel',
  github: 'GitHub confirms it is you next.',
  failed: 'Bridge could not connect Claude. Try again in a minute.',
} as const;
