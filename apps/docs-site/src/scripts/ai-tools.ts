// The browser side of "Your AI tools" (rules and words: lib/ai-tools.ts). Reads the person's choice and the team
// default, saves them, and tells every mounted panel (the exploration page, the Start dialog, Settings, onboarding)
// when the choice changes (`bridge:ai-tools`).
//   - A Bridge account: the choice lives on the server (api/account `aiTools`), this browser keeps a copy so the page
//     paints the right tabs before the read answers.
//   - No account (a GitHub session, a self-hosted Studio, signed out): this browser only (`bridge.ai-tools`).
//   - The team default (api/entry `ai-tools`): read for a real team, kept here per team for the next first paint.
// The last tab a viewer used (`bridge.ai-tab`) is a convenience of this browser only. Every storage call is wrapped:
// a blocked storage leaves the page on the fallback, never broken.
import { parseAiTools, type AiTool } from '../lib/ai-tools';
import { accessContext } from '../lib/library-access';
import { repoContext } from './repo-context';

export const AI_TOOLS_KEY = 'bridge.ai-tools';
export const AI_TAB_KEY = 'bridge.ai-tab';
const TEAM_KEY = 'bridge.ai-tools.team.';
export const AI_TOOLS_EVENT = 'bridge:ai-tools';

export interface AiToolsState {
  mine: AiTool[] | null;
  teamDefault: AiTool[] | null;
  /** The team this page works on, when it is a real one (its default can be read and, by an admin, set). */
  team: string | null;
  /** Signed in with a Bridge account: the choice is kept on the server. */
  account: boolean;
}

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice still holds for this page.
  }
}

/** The real team of this page (owner/name, or a team made in Bridge), else null (the sample team, no repository). */
export function pageTeam(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const ctx = repoContext();
    const repo = `${ctx.owner}/${ctx.repo}`;
    return accessContext(repo, document.documentElement.hasAttribute('data-no-repo')) === 'real' ? repo : null;
  } catch {
    return null;
  }
}

/** What this browser knows now, for the first paint: no network. */
export function knownAiTools(): AiToolsState {
  const team = pageTeam();
  return { mine: parseAiTools(get(AI_TOOLS_KEY)), teamDefault: team ? parseAiTools(get(TEAM_KEY + team.toLowerCase())) : null, team, account: false };
}

let read: Promise<AiToolsState> | null = null;

/** The person's choice and the team default from the server (once per page), else what this browser keeps. */
export function readAiTools(fresh = false): Promise<AiToolsState> {
  if (read && !fresh) return read;
  read = (async () => {
    const known = knownAiTools();
    let mine = known.mine;
    let account = false;
    try {
      const { getAccount } = await import('./account-session');
      const info = await getAccount();
      if (info.account) {
        account = true;
        const server = parseAiTools(info.account.aiTools);
        // The server is the source of truth; a choice made here before signing in goes up once.
        if (server) {
          mine = server;
          put(AI_TOOLS_KEY, JSON.stringify(server));
        } else if (mine) void saveOnServer(mine);
      }
    } catch {
      // No accounts on this site, or the read failed: this browser's copy.
    }
    let teamDefault = known.teamDefault;
    if (known.team && account) {
      try {
        const { getTeamAiTools } = await import('./entry-session');
        teamDefault = await getTeamAiTools(known.team);
        put(TEAM_KEY + known.team.toLowerCase(), teamDefault ? JSON.stringify(teamDefault) : null);
      } catch {
        // Not a member through Bridge, or the read failed: the copy kept here.
      }
    }
    return { mine, teamDefault, team: known.team, account };
  })();
  return read;
}

async function saveOnServer(tools: AiTool[]): Promise<void> {
  try {
    const { saveAiTools } = await import('./account-session');
    await saveAiTools(tools);
  } catch {
    // Kept in this browser; the next save tries again.
  }
}

function announce(): void {
  read = null;
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(AI_TOOLS_EVENT));
}

/** Saves the person's choice: this browser at once, the account when signed in. */
export async function saveMyAiTools(tools: AiTool[]): Promise<void> {
  const clean = parseAiTools(tools);
  if (!clean) throw new Error('Pick at least one.');
  put(AI_TOOLS_KEY, JSON.stringify(clean));
  const state = await (read ?? readAiTools());
  if (state.account) {
    const { saveAiTools } = await import('./account-session');
    await saveAiTools(clean);
  }
  announce();
}

/** An admin sets (or clears, null) the default new members of this team start from. */
export async function saveTeamAiTools(team: string, tools: AiTool[] | null): Promise<AiTool[] | null> {
  const { setTeamAiTools } = await import('./entry-session');
  const saved = await setTeamAiTools(team, tools?.length ? tools : null);
  put(TEAM_KEY + team.toLowerCase(), saved ? JSON.stringify(saved) : null);
  announce();
  return saved;
}

export const lastAiTab = (): string | null => get(AI_TAB_KEY);
export const rememberAiTab = (tab: AiTool): void => put(AI_TAB_KEY, tab);
