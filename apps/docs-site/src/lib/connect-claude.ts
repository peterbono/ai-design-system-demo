// "Sign in with Bridge" when Claude adds the Bridge connector (/studio/connect-claude/?request=…, api/mcp and
// api/_lib/oauth.ts): which step the person is at, and the words. Pure, covered by connect-claude.test.ts. The page is
// ConnectClaude.tsx, standalone (no team, no demo, no Studio nav: the three contexts are never mixed).
//
// Everything the page needs comes from one read, GET /oauth/request?id=: the app, where it returns, whether this is the
// browser that started it, and who is signed in with their teams that have a design system. Signing in on the way comes
// back to the same request (?next=), so the person never has to find this page again.
//
// True copy (settled rule "Claude copy must be true"): Claude works as the person, on the team they pick; it reads the
// design system and opens changes for review in their name; nothing reaches the library until someone approves it.

export interface ConnectQuery {
  request: string | null;
  error: 'no_access' | null;
}

const REQUEST = /^[A-Za-z0-9_-]{20,40}$/;

export function readQuery(search: string): ConnectQuery {
  const q = new URLSearchParams(search);
  const r = q.get('request')?.trim() ?? '';
  return { request: REQUEST.test(r) ? r : null, error: q.get('error') === 'no_access' ? 'no_access' : null };
}

export interface ClaudeTeam {
  repo: string;
  name: string;
}

/** What GET /oauth/request answers. */
export interface RequestInfo {
  client: string;
  redirectHost: string;
  sameBrowser: boolean;
  signedIn: boolean;
  name: string | null;
  teams: ClaudeTeam[];
}

export function parseRequestInfo(d: unknown): RequestInfo | null {
  const o = d as Record<string, unknown> | null;
  if (!o || typeof o.client !== 'string' || typeof o.redirectHost !== 'string') return null;
  const teams = Array.isArray(o.teams)
    ? o.teams.flatMap((t): ClaudeTeam[] => {
        const x = t as Record<string, unknown>;
        return x && typeof x.repo === 'string' ? [{ repo: x.repo, name: typeof x.name === 'string' && x.name.trim() ? x.name.trim() : x.repo.split('/')[1] ?? x.repo }] : [];
      })
    : [];
  return { client: o.client, redirectHost: o.redirectHost, sameBrowser: o.sameBrowser === true, signedIn: o.signedIn === true, name: typeof o.name === 'string' ? o.name : null, teams };
}

export type ClaudeConnectStep =
  | { kind: 'no-request' }
  | { kind: 'no-access' }
  | { kind: 'expired' }
  | { kind: 'other-browser' }
  | { kind: 'signin'; info: RequestInfo }
  | { kind: 'no-teams'; info: RequestInfo }
  | { kind: 'pick'; info: RequestInfo; teams: ClaudeTeam[] };

/** Where the person is. One team: it is preselected; several: a picker, sorted by name. */
export function connectClaudeStep(q: ConnectQuery, info: RequestInfo | null): ClaudeConnectStep {
  if (q.error === 'no_access') return { kind: 'no-access' };
  if (!q.request) return { kind: 'no-request' };
  if (!info) return { kind: 'expired' };
  if (!info.sameBrowser) return { kind: 'other-browser' };
  if (!info.signedIn) return { kind: 'signin', info };
  const teams = [...info.teams].sort((a, b) => a.name.localeCompare(b.name));
  return teams.length ? { kind: 'pick', info, teams } : { kind: 'no-teams', info };
}

/** "Claude" for the hosted apps, the app's own name otherwise. */
export const appName = (info: Pick<RequestInfo, 'client'>) => info.client.trim() || 'An app';

export const CLAUDE_CONNECT_WORDS = {
  title: 'Use Bridge in Claude',
  lede: (app: string) => `${app} asks to use Bridge with your team's design system.`,
  gets: 'Claude will be able to:',
  canRead: 'Read your design system',
  canPropose: 'Open changes for review in your name',
  approval: 'Nothing reaches the library until someone on your team approves it.',
  back: (host: string) => `GitHub confirms it is you, then you go back to ${host}.`,
  teamLabel: 'Team',
  allow: 'Allow',
  allowing: 'Going to GitHub',
  cancel: 'Cancel',
  cancelling: 'Going back to Claude',
  signin: 'Sign in to Bridge to connect Claude. Bridge brings you back to this step afterwards.',
  signinAction: 'Sign in',
  signedInAs: (name: string) => `Signed in as ${name}.`,
  noTeams: "Your Bridge account isn't in a team with a design system yet.",
  createTeam: 'Create your team',
  askInvite: 'Or ask your admin for an invite, then connect Claude again.',
  otherAccount: 'Use another account',
  noRequest: 'Open this page from Claude: Settings, Connectors, Add custom connector, then Connect.',
  noAccess: "Your GitHub account cannot change this team's design system. Start again from Claude and pick a team you can edit, or ask its admin for access.",
  expired: 'This sign-in took too long. Start again from Claude.',
  otherBrowser: 'Finish signing in in the browser where you started from Claude.',
  failed: 'Bridge could not connect Claude. Try again in a minute.',
} as const;
