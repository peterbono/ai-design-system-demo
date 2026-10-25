// Studio: Bridge inside the team's Claude (the hosted MCP connector, api/mcp). Settings, Claude (how to add it, who
// connected it: components/ds/studio/ClaudeConnector.tsx) and Being built, Claude's fixes (the fix sessions:
// components/ds/studio/ClaudeFixes.tsx). Words and small rules; pure, so tests read them.
//
// True copy (settled rule "Claude copy must be true"): the team's own Claude does the work through Bridge; Claude
// opens its fix for review; someone on the team approves it; the steps are real tool calls, never a percentage.

export const CONNECTOR_WORDS = {
  title: 'Claude',
  intro: "Use Bridge inside your team's Claude. Claude reads your design system and fixes components that differ in Figma; someone on your team reviews each fix.",
  step1: 'In Claude, open Settings, Connectors, Add custom connector, and paste this address.',
  step2: 'Sign in with Bridge when Claude asks.',
  orgAdmins: 'On Claude Team or Enterprise, an Owner can add it once for everyone in the organization.',
  address: 'Connector address',
  copy: 'Copy address',
  copied: 'Address copied',
  status: 'In Claude',
  notConnected: 'Not connected yet.',
  remove: 'Remove',
  removed: 'Removed. That Claude no longer works with Bridge until it connects again.',
  noRepo: 'Connect your design system first. Then use Bridge inside your Claude.',
  sample: 'On the sample team, nothing is connected.',
} as const;

export interface Connection {
  id: string;
  client: string;
  by: string;
  createdAt: string;
  lastUsedAt: string;
  mine: boolean;
}

/** "Oct 25, 2026" */
export function shortDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : iso;
}

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** "Connected in Claude by Dana Kim and Malik, last used Oct 25, 2026." or "Not connected yet." */
export function connectionSentence(list: readonly Connection[]): string {
  if (!list.length) return CONNECTOR_WORDS.notConnected;
  const names = [...new Set(list.map((c) => c.by.trim()).filter(Boolean))];
  const last = [...list].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0]!.lastUsedAt;
  return `Connected in Claude by ${andList(names)}, last used ${shortDay(last)}.`;
}

/** The connector address of this site: <origin>/mcp. */
export const connectorUrl = (origin: string) => `${origin.replace(/\/+$/, '')}/mcp`;

/** For developers: Claude Code with the hosted connector, and the local server with a token. */
export function developerSnippets(url: string, repo: string) {
  return {
    claudeCode: `claude mcp add --transport http bridge ${url}`,
    local: JSON.stringify({ mcpServers: { bridge: { command: 'npx', args: ['-y', '@bridge-ds/mcp', '--repo', repo], env: { GITHUB_TOKEN: '<a fine-grained token for this repository>' } } } }, null, 2),
  };
}

// --- Fix sessions -------------------------------------------------------------------------------------------------

export type SessionState = 'waiting' | 'working' | 'ready' | 'stopped';

export interface SessionStep {
  kind: string;
  text: string;
  at: string;
  by: string;
  review?: string;
}

export interface Session {
  component: string;
  state: SessionState;
  startedAt: string | null;
  updatedAt: string | null;
  elapsed: number;
  steps: SessionStep[];
}

export const FIXES_WORDS = {
  title: "Claude's fixes",
  intro: "What your team's Claude does on components that differ in Figma, step by step. Someone on your team reviews each fix.",
  see: "See Claude's fix",
  steps: 'Steps',
} as const;

const STATES: readonly SessionState[] = ['waiting', 'working', 'ready', 'stopped'];

/** A session as the server sent it, or null. Review paths are Studio paths only. */
export function parseSession(v: unknown): Session | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (typeof s.component !== 'string' || !STATES.includes(s.state as SessionState) || !Array.isArray(s.steps)) return null;
  const steps = s.steps.flatMap((x): SessionStep[] => {
    const t = x as Record<string, unknown>;
    if (!t || typeof t.text !== 'string' || typeof t.at !== 'string') return [];
    const review = typeof t.review === 'string' && /^changes\/\?pr=\d{1,10}$/.test(t.review) ? t.review : undefined;
    return [{ kind: typeof t.kind === 'string' ? t.kind : 'step', text: t.text, at: t.at, by: typeof t.by === 'string' ? t.by : '', ...(review ? { review } : {}) }];
  });
  return { component: s.component, state: s.state as SessionState, startedAt: typeof s.startedAt === 'string' ? s.startedAt : null, updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null, elapsed: typeof s.elapsed === 'number' ? s.elapsed : 0, steps };
}

/** The one tag: where it stands. */
export function sessionTag(s: Pick<Session, 'state' | 'steps'>): { label: string; tone: 'info' | 'success' | 'neutral' | 'warning' } {
  // Went quiet: the server keeps it working and adds a last step that says so (no step for 10 minutes).
  if (s.state === 'working' && s.steps.at(-1)?.kind === 'quiet') return { label: 'Went quiet', tone: 'warning' };
  if (s.state === 'working') return { label: 'Claude is working', tone: 'info' };
  if (s.state === 'ready') return { label: 'Ready for review', tone: 'success' };
  if (s.state === 'stopped') return { label: 'Stopped', tone: 'neutral' };
  return { label: 'Waiting', tone: 'neutral' };
}

/** "4 min", "1 h 5 min", "under a minute": how long it has run (no percentage: rounds vary). */
export function elapsedLabel(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** The row's line: the last step, how long, who. */
export function sessionLine(s: Session): string {
  const last = s.steps.at(-1);
  const who = last?.by ? ` Asked by ${s.steps[0]?.by || last.by}.` : '';
  return `${last?.text ?? 'Nothing yet'}. ${s.state === 'working' ? 'For' : 'Took'} ${elapsedLabel(s.elapsed)}.${who}`;
}

/** The review of the fix, when it opened one. */
export const reviewOf = (s: Session) => [...s.steps].reverse().find((x) => x.review)?.review ?? null;
