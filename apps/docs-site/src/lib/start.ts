// How a visitor starts with Bridge (boards EmptyC, EmptyB, EmptyA2): "Get started" opens "How do you want to start?"
// (pages/start.astro) while this browser remembers no workspace, else it goes straight to the workspace. Pure rules
// and words, no DOM, covered by start.test.ts; the storage lives in scripts/start.ts.
//
// There are no accounts: a workspace is what this browser remembers.
//   - A team opened here (the team chip's recent teams, lib/recent-teams.ts), the demo teams left out: the most recent
//     one is the workspace.
//   - Else the Storybook quick start (lib/workspace.ts), or "Connect my design system" started from the start screen:
//     the browser workspace at WORKSPACE_HOME, empty until a Storybook or a repository is connected.
//   - Else none: "Get started" shows the start screen.
import { isDemoRepo, SAMPLE_TEAM } from './demo';
import { ANY_STEP_IDS, type Step, type StepId } from './onboarding';
import { isTeamKey, STUDIO_ROOT, teamHref, teamKeyId, type ReservedPaths } from './team-path';

/** The start screen: Connect your design system, or Look around first. */
export const START_PAGE = '/start/';

/** The browser workspace: a Studio home with nothing bound yet (pages/studio/workspace.astro). */
export const WORKSPACE_HOME = `${STUDIO_ROOT}workspace/`;

/** The Settings of a team made in Bridge before any repository (pages/studio/workspace/settings.astro, ?team=<id>). */
export const WORKSPACE_SETTINGS = `${WORKSPACE_HOME}settings/`;

/** The demo team on the hosted site (lib/demo.ts DEMO_REPOS), for browser code that cannot read lib/nav.ts. */
export const DEMO_HOME = `${STUDIO_ROOT}peterbono/bridge-demo-ds/`;

/** What this browser remembers of the start (localStorage, a per-viewer convenience). */
export const START_KEY = 'bridge.start';

export interface StartMemory {
  /** "Connect my design system" was started here: the browser workspace exists from then on. */
  connect: boolean;
  /** The setup step open when the visitor left it, to resume there. */
  step: StepId | null;
  /** "Look around first": the demo was opened from the start screen. */
  demo: boolean;
  /**
   * A repository picked on step 2 of "Create your team" that could not be linked yet (Bridge not installed there): the
   * team's key and the repository. The team page links it once its admin opened it (Onboarding.tsx HostedOnboarding).
   * The team itself lives on the server from step 1 (api/entry create-team), never here.
   */
  link: PendingLink | null;
}

export interface PendingLink {
  /** The key of the team made in Bridge, `_team/<id>`. */
  team: string;
  /** owner/repo. */
  repo: string;
}

export const EMPTY_START: StartMemory = { connect: false, step: null, demo: false, link: null };

function parseLink(v: unknown): PendingLink | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const team = typeof o.team === 'string' && isTeamKey(o.team) ? o.team.toLowerCase() : null;
  const repo = typeof o.repo === 'string' && /^[^/\s]+\/[^/\s]+$/.test(o.repo) ? o.repo.toLowerCase() : null;
  return team && repo ? { team, repo } : null;
}

/** Reads what was stored, dropping anything malformed. */
export function parseStartMemory(text: string | null): StartMemory {
  if (!text) return { ...EMPTY_START };
  try {
    const v = JSON.parse(text) as Partial<StartMemory> | null;
    if (!v || typeof v !== 'object') return { ...EMPTY_START };
    return {
      connect: v.connect === true,
      step: typeof v.step === 'string' && (ANY_STEP_IDS as readonly string[]).includes(v.step) ? v.step : null,
      demo: v.demo === true,
      link: parseLink(v.link),
    };
  } catch {
    return { ...EMPTY_START };
  }
}

/** Everything the routing rules read, from this browser. */
export interface StartFacts {
  /** The team chip's recent teams, newest first. */
  recent: readonly string[];
  /** A Storybook added with the quick start. */
  storybook: boolean;
  memory: StartMemory;
}

/** The recent teams that are the visitor's own: the demo teams are never a workspace. */
export const ownTeams = (recent: readonly string[]): string[] => recent.filter((t) => !isDemoRepo(t));

/** The browser workspace exists: a Storybook was added, or "Connect my design system" was started. */
export const hasBrowserWorkspace = (f: StartFacts): boolean => f.storybook || f.memory.connect;

/** This browser remembers a workspace: a team of the visitor's own, or the browser workspace. */
export const hasWorkspace = (f: StartFacts): boolean => ownTeams(f.recent).length > 0 || hasBrowserWorkspace(f);

/** The start screen shows only while no workspace is remembered. */
export const showsStartScreen = (f: StartFacts): boolean => !hasWorkspace(f);

/** The visitor's workspace: the most recent team of their own, else the browser workspace, else none. */
export function workspaceHref(f: StartFacts, reserved: ReservedPaths | null = null): string | null {
  const [team] = ownTeams(f.recent);
  if (team) {
    const [owner = '', repo = ''] = team.split('/');
    return teamHref(owner, repo, reserved);
  }
  return hasBrowserWorkspace(f) ? WORKSPACE_HOME : null;
}

/** Where "Get started" goes: the workspace, else the start screen. */
export const getStartedHref = (f: StartFacts, reserved: ReservedPaths | null = null): string => workspaceHref(f, reserved) ?? START_PAGE;

/**
 * The Sample data banner's button: "Back to your workspace" when there is one, else "Connect your design system",
 * which starts the setup as the start screen's card does (never a "back" that lands on the start screen).
 */
export const demoBack = (f: StartFacts, reserved: ReservedPaths | null = null): { href: string; connect: boolean } => {
  const href = workspaceHref(f, reserved);
  return href ? { href, connect: false } : { href: CONNECT_HREF, connect: true };
};


/**
 * The team made in Bridge (no repository yet) the workspace page shows: the one its address names (?team=<id>) when
 * the account is on it, else the first one the account administers, else the first one it is on. Null for none.
 */
export function workspaceTeamKey(teams: readonly { repo: string; role: string }[], search: string): string | null {
  const keys = teams.filter((t) => isTeamKey(t.repo));
  const asked = new URLSearchParams(search).get('team');
  const named = asked ? keys.find((t) => teamKeyId(t.repo) === asked.trim().toLowerCase()) : undefined;
  return (named ?? keys.find((t) => t.role === 'admin') ?? keys[0])?.repo.toLowerCase() ?? null;
}

/** Where "Connect my design system" leads: the browser workspace, on the step that picks the design system. */
export const CONNECT_HREF = `${WORKSPACE_HOME}?setup=library`;

/**
 * The step to resume the setup at: where the visitor left it while it is still to do, else the open step, else the
 * first one left, else "Your design system".
 */
export function resumeStep(steps: readonly Step[], left: StepId | null): StepId {
  const kept = left ? steps.find((s) => s.id === left && s.state !== 'done') : undefined;
  return kept?.id ?? steps.find((s) => s.state === 'current')?.id ?? steps.find((s) => s.state !== 'done')?.id ?? 'library';
}

/** A team picked in the setup opens at its next step, naming it (Onboarding.tsx HostedOnboarding, opened with ?setup=). */
export const NEXT_AFTER_LIBRARY: StepId = 'name';

// ---------------------------------------------------------------------------------------------------------------
// The words

/** "Ann's workspace"; "Your workspace" while the name is not known. */
export const workspaceName = (name: string | null | undefined): string => (name?.trim() ? `${name.trim()}'s workspace` : 'Your workspace');

/** The start screen's title (board EmptyC): the first name when signed in, none when signed out. */
export const startTitle = (name: string | null | undefined): string => (name?.trim() ? `How do you want to start, ${name.trim()}?` : 'How do you want to start?');

export const START_WORDS = {
  /** Shown to a visitor with no team and no workspace yet: never points at a team menu they do not have. */
  sub: 'Pick one to begin. The other stays one click away.',
  connectTitle: 'Connect your design system',
  connectText: 'Your Storybook or your repository. Your tokens, components and branches show up in your Studio.',
  connectChecks: ['About 2 minutes with a Storybook URL', 'Read only: Bridge writes nothing in your code'],
  connectButton: 'Connect my design system',
  demoTitle: 'Look around first',
  demoText: 'Acme Design, a sample team: a design system, its branches and changes waiting for review.',
  demoChecks: ['No setup', 'Your edits stay in this browser, nothing is sent'],
  demoButton: 'Open the demo',
} as const;

/** The empty workspace (board EmptyB). */
export const WORKSPACE_WORDS = {
  welcome: (name: string | null | undefined) => (name?.trim() ? `Welcome, ${name.trim()}.` : 'Welcome.'),
  nothing: 'Nothing is connected yet. Connect your design system and your tokens, components and branches show up here.',
  connect: 'Connect your design system',
  hint: 'Storybook URL or the repository. About 2 minutes.',
  library: 'Your library',
  notConnected: 'Not connected',
  tokens: { title: 'Tokens', line: 'Show here once your design system is connected' },
  components: { title: 'Components', line: 'Read from your Storybook or your code' },
  products: { title: 'Products', line: 'The apps that use your library' },
  branches: 'Your branches',
  noBranches: 'None yet. Branches you start or review show up here.',
  /** The chip's tooltip: the workspace is this browser's, not an account's. */
  kept: 'Kept in this browser',
} as const;

/**
 * The home of a team made in Bridge with no design system yet (api/entry create-team): the real team, never the sample
 * team nor Bridge's own. It says what to connect next; only an admin connects.
 */
export const TEAM_HOME_WORDS = {
  ready: (team: string) => `${team} is set up. Connect your design system next, and your tokens, components and branches show up here.`,
  waiting: (team: string) => `${team} has no design system connected yet. An admin of the team connects it, and it shows up here.`,
  storybook: (team: string) => `${team} reads your Storybook. Connect the repository too, and your tokens and branches show up here.`,
  members: (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`,
  findable: (domain: string) => `People with @${domain} can find it`,
  inviteOnly: 'People join by invite',
  /** The chip's line under the team name. */
  chipLine: 'No design system yet',
} as const;

/** The team menu's sections (board EmptyB). */
export const MENU_WORDS = {
  yourTeams: 'Your teams',
  tryIt: 'Try it',
  demo: SAMPLE_TEAM,
  demoLine: 'Sample data, read only',
  workspaceLine: 'Not connected yet',
} as const;
