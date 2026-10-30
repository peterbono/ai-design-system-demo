// Studio: Bridge inside the team's Claude (the hosted MCP connector, api/mcp). Settings, Claude (how to add it, who
// connected it: components/ds/studio/ClaudeConnector.tsx) and Being built, where each fix session is one more row of
// the one list (fixRows below, read by scripts/building-data.ts). Words and small rules; pure, so tests read them.
//
// True copy (settled rule "Claude copy must be true"): the team's own Claude does the work through Bridge; Claude
// opens its fix for review; someone on the team approves it; the steps are real tool calls, never a percentage.
import { BUILD_STATUS_LABEL, type BuildRequestView, type BuildStatus } from '@bridge-ds/core';
import type { RestPull } from './building-view';
import { daysSince } from './home-model';

export const CONNECTOR_WORDS = {
  title: 'Claude',
  intro: "Use Bridge inside your team's Claude. Claude reads your design system and fixes components that differ in Figma; someone on your team reviews each fix.",
  step1: 'In Claude, open Settings, Connectors, Add custom connector, name it Bridge, and paste this address.',
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

/** "4 min", "1 h 5 min", "under a minute": how long it has run (no percentage: rounds vary). */
export function elapsedLabel(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** The review of the fix, when it opened one. */
export const reviewOf = (s: Session) => [...s.steps].reverse().find((x) => x.review)?.review ?? null;

// --- Being built: one row per fix session ---------------------------------------------------------------------------
//
// A fix session is one more row of the Being built list (one queue, settled 2026-10-23), with the list's tag words.
// Where it stands comes from its pull request when the list read it (merged: Shipped, on its merge date; closed without
// merging: Not planned; open: In review), else from the session (working: In progress; stopped without a pull request:
// Not planned). The row opens Claude's fix in Studio (its review), never GitHub; while Claude works, the line is the
// last real step, never a percentage.

export interface FixRow extends BuildRequestView {
  fix: {
    /** The Studio path the row opens: the review of Claude's fix, else the component. */
    href: string;
    /** Line 2: what it is, who asked, then where it stands. */
    line: string;
    /** Claude is still on it: the page reads the sessions again. */
    working: boolean;
  };
}

export const FIX_ROW_TITLE = "Claude's fix from Figma";

const componentSlug = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A GitHub login Bridge can look a name up for; a name the server wrote ("Priya Shah") stays as written. */
export const isLoginLike = (by: string) => /^[a-z0-9][a-z0-9-]{0,38}$/i.test(by.trim());

const ago = (verb: string, iso: string, now: number) => {
  const d = daysSince(iso, now);
  return d === 0 ? `${verb} today` : `${verb} ${d} ${d === 1 ? 'day' : 'days'} ago`;
};

type PullState = Pick<RestPull, 'number' | 'state' | 'merged_at' | 'updated_at'>;

/** The rows of the team's fix sessions, reconciled with the pull requests the list already read (no read per row). */
export function fixRows(sessions: readonly Session[], pulls: readonly PullState[], now: number, nameOf: (login: string) => string = (l) => l): FixRow[] {
  return sessions.map((s) => {
    const review = reviewOf(s);
    const prNumber = review ? Number(/pr=(\d+)/.exec(review)?.[1]) || null : null;
    const pull = prNumber ? pulls.find((p) => Number(p.number) === prNumber) : undefined;
    const last = s.steps.at(-1);
    const quiet = s.state === 'working' && last?.kind === 'quiet';
    let status: BuildStatus;
    let closedAt: string | null = null;
    if (pull?.merged_at) status = 'shipped';
    else if (pull && pull.state === 'closed') {
      status = 'not-planned';
      closedAt = pull.updated_at ?? s.updatedAt;
    } else if (pull || (review && s.state !== 'working')) status = 'in-review';
    else if (s.state === 'working') status = 'in-progress';
    else if (s.state === 'stopped') {
      status = 'not-planned';
      closedAt = s.updatedAt;
    } else status = 'requested';
    const shippedAt = status === 'shipped' ? (pull?.merged_at ?? null) : null;
    const createdAt = s.startedAt ?? s.updatedAt ?? new Date(now).toISOString();
    const asker = s.steps[0]?.by || last?.by || '';
    const who = asker ? nameOf(asker) : '';
    const stopped = (last?.text ?? 'Claude stopped').replace(/\.$/, '');
    const where: Record<BuildStatus, string> = {
      requested: 'Not started yet',
      'picked-up': 'Claude is on it',
      'in-progress': quiet ? `Claude went quiet after ${elapsedLabel(s.elapsed)}` : `${last?.text ?? 'Claude started'}, for ${elapsedLabel(s.elapsed)}`,
      'in-review': `Ready for your team to review, took ${elapsedLabel(s.elapsed)}`,
      shipped: shippedAt ? ago('Shipped', shippedAt, now) : 'In the library',
      'not-planned': pull ? 'Your team closed it without keeping it' : stopped,
    };
    const sentence: Record<BuildStatus, string> = {
      requested: 'Not started yet.',
      'picked-up': 'Claude is on it.',
      'in-progress': quiet ? 'Claude went quiet.' : 'Claude is fixing it.',
      'in-review': "Claude's fix is ready. Someone on your team reviews it before it ships.",
      shipped: 'In the library. Figma is closer to the code.',
      'not-planned': `${where['not-planned']}.`,
    };
    const timeline: BuildRequestView['timeline'] = [{ status: 'requested', at: createdAt, ...(asker ? { who: asker } : {}) }];
    if (status === 'shipped') timeline.push({ status: 'shipped', ...(shippedAt ? { at: shippedAt } : {}) });
    if (status === 'not-planned') timeline.push({ status: 'not-planned', ...(closedAt ? { at: closedAt } : {}) });
    const slug = componentSlug(s.component);
    return {
      id: `fix-${slug}`,
      kind: 'pull',
      number: prNumber ?? 0,
      url: '',
      component: s.component,
      title: FIX_ROW_TITLE,
      requestKind: null,
      status,
      label: BUILD_STATUS_LABEL[status],
      sentence: sentence[status],
      builders: ['claude'],
      requestedBy: asker || null,
      createdAt,
      ageDays: daysSince(createdAt, now),
      stale: quiet,
      shippedAt,
      pull: prNumber ? { number: prNumber, state: pull?.merged_at ? 'merged' : (pull?.state ?? 'open') } : null,
      jira: null,
      figmaUrl: null,
      timeline,
      fix: {
        href: review ?? `components/?c=${encodeURIComponent(slug)}`,
        line: `${FIX_ROW_TITLE}${who ? `, asked by ${who}` : ''} · ${where[status]}`,
        working: s.state === 'working',
      },
    };
  });
}
