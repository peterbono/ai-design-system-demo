// While the team's Claude fixes a component, what it is doing: the real steps Bridge records from Claude's calls to the
// Bridge connector (docs/FIGMA-FIXES.md, "Work in progress: fix sessions", Contract). When the read is not available
// (offline, the site down), the plugin falls back to watching GitHub for the fix (claude-connector.ts findFix) and the
// row says "Waiting for Claude".

export const FIX_SESSION_PATH = '/api/fix-sessions';

/** One step, in designer words: `label` is shown as is ("Claude read the differences (12)"). */
export interface SessionStep {
  label: string;
  /** current: the last step while working; failed: refused, stopped, quiet. */
  status: 'done' | 'current' | 'failed';
  kind?: 'read' | 'try' | 'proposed' | 'refused' | 'stopped' | 'quiet' | undefined;
  at: string;
  /** Who triggered it (a name). */
  by?: string | undefined;
  round?: number | undefined;
}

/** SessionView of the contract, with only what the designer reads. */
export interface FixSession {
  component: string;
  /** waiting: no session yet for this component. */
  state: 'waiting' | 'working' | 'ready' | 'stopped';
  startedAt: string | null;
  updatedAt: string | null;
  /** Seconds since it started (to the last step once ready, stopped or quiet). */
  elapsed: number;
  /** Working, but no step for 10 minutes: "Claude went quiet" (the state stays working; a new step resumes it). */
  quiet: boolean;
  /** stopped: Claude's reason, without "Claude stopped: ". */
  reason?: string | undefined;
  pr?: { number: number; url: string } | undefined;
  round?: number | undefined;
  maxRounds: number;
  steps: SessionStep[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const STATES = ['waiting', 'working', 'ready', 'stopped'] as const;
const STEP_STATUS = ['done', 'current', 'failed'] as const;
const KINDS = ['read', 'try', 'proposed', 'refused', 'stopped', 'quiet'] as const;

/** The contract's SessionView, keeping only what the designer reads (never anything else the server adds). */
export function parseSession(x: unknown): FixSession | undefined {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o.component !== 'string' || !(STATES as readonly string[]).includes(String(o.state))) return undefined;
  const steps = Array.isArray(o.steps)
    ? o.steps.flatMap((s): SessionStep[] => {
        const r = s as Record<string, unknown>;
        if (typeof r?.label !== 'string' || !(STEP_STATUS as readonly string[]).includes(String(r.status))) return [];
        return [
          {
            label: r.label,
            status: r.status as SessionStep['status'],
            ...((KINDS as readonly string[]).includes(String(r.kind)) ? { kind: r.kind as SessionStep['kind'] } : {}),
            at: str(r.at),
            ...(typeof r.by === 'string' ? { by: r.by } : {}),
            ...(typeof r.round === 'number' ? { round: r.round } : {}),
          },
        ];
      })
    : [];
  const pr = o.pr as { number?: unknown; url?: unknown } | undefined;
  return {
    component: o.component,
    state: o.state as FixSession['state'],
    startedAt: typeof o.startedAt === 'string' ? o.startedAt : null,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    elapsed: typeof o.elapsed === 'number' && Number.isFinite(o.elapsed) ? o.elapsed : 0,
    quiet: o.quiet === true,
    ...(typeof o.reason === 'string' && o.reason ? { reason: o.reason.replace(/^Claude stopped:\s*/i, '') } : {}),
    ...(pr && typeof pr.url === 'string' ? { pr: { number: Number(pr.number), url: pr.url } } : {}),
    ...(typeof o.round === 'number' ? { round: o.round } : {}),
    maxRounds: typeof o.maxRounds === 'number' ? o.maxRounds : 3,
    steps,
  };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The session for a component, or undefined when the read is not available (the row falls back to the GitHub watch). */
export async function readFixSession(f: Fetch, origin: string, token: string, repo: string, component: string): Promise<FixSession | undefined> {
  try {
    const res = await f(`${origin}${FIX_SESSION_PATH}?repo=${encodeURIComponent(repo)}&component=${encodeURIComponent(component)}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    const body = (await res.json().catch(() => undefined)) as { session?: unknown } | undefined;
    return parseSession(body?.session);
  } catch {
    return undefined;
  }
}

/** "4 min", "1 h 5 min", "just started", from the session's own elapsed seconds. */
export function elapsedText(seconds: number): string {
  const min = Math.floor(seconds / 60);
  if (min < 1) return 'just started';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** The row's head, in one line. Quiet comes from the server's flag, never as a stop. */
export function sessionHead(s: FixSession | undefined, component: string): { kind: 'waiting' | 'working' | 'ready' | 'stopped' | 'quiet'; text: string } {
  if (!s || s.state === 'waiting' || (s.state === 'working' && !s.steps.length && !s.quiet)) return { kind: 'waiting', text: 'Waiting for Claude' };
  if (s.state === 'ready') return { kind: 'ready', text: "Claude's fix is ready" };
  if (s.state === 'stopped') return { kind: 'stopped', text: `Claude stopped: ${s.reason ?? 'it found no fix that brings it closer to the code'}` };
  if (s.quiet) return { kind: 'quiet', text: 'Claude went quiet' };
  const round = s.round ? `, round ${s.round} of up to ${s.maxRounds}` : '';
  return { kind: 'working', text: `Claude is working on ${component} · ${elapsedText(s.elapsed)}${round}` };
}
