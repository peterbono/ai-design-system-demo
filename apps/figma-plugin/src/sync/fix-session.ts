// While the team's Claude fixes a component, what it is doing: the real steps Bridge records from Claude's calls to the
// Bridge connector (read the differences, tried a fix, opened it for review). Read from the Bridge site; when that read
// is not available (not deployed yet, offline), the plugin falls back to watching GitHub for the fix
// (claude-connector.ts findFix) and the row says "Waiting for Claude".
//
// PROVISIONAL: the read endpoint and its shape follow the server agent's announced contract (docs/FIGMA-FIXES.md, "fix
// session", once merged). FIX_SESSION_PATH and `parseSession` are the only places to adjust.

export const FIX_SESSION_PATH = '/api/fix-sessions';

export interface SessionStep {
  /** In designer words, from the server: "Read the differences (12)", "Tried a fix, round 1: closer". */
  label: string;
  status: 'done' | 'current' | 'failed';
  at: string;
}

export interface FixSession {
  component: string;
  /** working: steps are arriving; ready: the fix is open for review; stopped: Claude gave up (with why). */
  state: 'working' | 'ready' | 'stopped';
  startedAt: string;
  updatedAt: string;
  steps: SessionStep[];
  /** stopped: the sentence for the designer. */
  reason?: string | undefined;
  /** ready: the pull request to review. */
  pr?: { number: number; url: string } | undefined;
  /** "round 2 of up to 3", when the server knows the round. */
  round?: number | undefined;
  maxRounds?: number | undefined;
}

/** No step for this long while working: Claude went quiet (the designer may have closed the chat). */
export const QUIET_MS = 10 * 60 * 1000;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Only what the designer reads, whatever else the server sends (never a developer cause). */
export function parseSession(x: unknown): FixSession | undefined {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o.component !== 'string' || !['working', 'ready', 'stopped'].includes(String(o.state))) return undefined;
  const steps = Array.isArray(o.steps)
    ? o.steps.flatMap((s): SessionStep[] => {
        const r = s as Record<string, unknown>;
        return typeof r?.label === 'string' && ['done', 'current', 'failed'].includes(String(r.status)) ? [{ label: r.label, status: r.status as SessionStep['status'], at: str(r.at) }] : [];
      })
    : [];
  const pr = o.pr as { number?: unknown; url?: unknown } | undefined;
  return {
    component: o.component,
    state: o.state as FixSession['state'],
    startedAt: str(o.startedAt),
    updatedAt: str(o.updatedAt),
    steps,
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
    ...(pr && typeof pr.url === 'string' ? { pr: { number: Number(pr.number), url: pr.url } } : {}),
    ...(typeof o.round === 'number' ? { round: o.round } : {}),
    ...(typeof o.maxRounds === 'number' ? { maxRounds: o.maxRounds } : {}),
  };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The latest session for a component, or undefined when there is none or the read is not available (fallback). */
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

/** The row's head, in one line. */
export function sessionHead(s: FixSession | undefined, component: string, now: number): { kind: 'waiting' | 'working' | 'ready' | 'stopped' | 'quiet'; text: string } {
  if (!s || (!s.steps.length && s.state === 'working')) return { kind: 'waiting', text: 'Waiting for Claude' };
  if (s.state === 'ready') return { kind: 'ready', text: "Claude's fix is ready" };
  if (s.state === 'stopped') return { kind: 'stopped', text: `Claude stopped: ${s.reason ?? 'it found no fix that brings it closer to the code'}` };
  const last = Date.parse(s.updatedAt);
  if (Number.isFinite(last) && now - last > QUIET_MS) return { kind: 'quiet', text: 'Claude went quiet' };
  const started = Date.parse(s.startedAt);
  const min = Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 60_000)) : 0;
  const round = s.round ? `, round ${s.round}${s.maxRounds ? ` of up to ${s.maxRounds}` : ''}` : '';
  return { kind: 'working', text: `Claude is working on ${component} · ${min < 1 ? 'just started' : `${min} min`}${round}` };
}
