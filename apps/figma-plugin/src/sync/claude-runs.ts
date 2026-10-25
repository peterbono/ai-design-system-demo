// "Ask Claude to fix it", run by Bridge for the team (docs/FIGMA-FIXES.md, "Claude runs it for the team", API
// contract): POST /api/claude { action: "fix" } starts a run; GET ?run= moves it one step and says where it stands. A
// run only moves while someone asks, so the plugin keeps asking while it is open, one request at a time, waiting
// `retryAfter` between answers (one answer can take about two minutes). The designer reads `label` and `sentence` as
// they come; `developer` is never shown.

export interface RunView {
  id: string;
  component: string;
  status: 'queued' | 'running' | 'ready' | 'no-fix' | 'failed';
  label: string;
  sentence: string;
  round?: number | undefined;
  maxRounds: number;
  startedBy: string;
  createdAt: string;
  updatedAt: string;
  retryAfter?: number | undefined;
  pr?: { number: number; url: string; draft: boolean } | undefined;
  reviewUrl?: string | undefined;
  applied?: string[] | undefined;
}

export const isFinal = (r: Pick<RunView, 'status'>) => r.status === 'ready' || r.status === 'no-fix' || r.status === 'failed';

/** The server refused to start (409 not_connected, 429 limit, …): its sentence, shown as is, and the code. */
export class RunRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const CLAUDE_RUN_WORDS = {
  unreachable: 'Bridge did not answer. Check your connection, then ask again.',
  round: (r: Pick<RunView, 'round' | 'maxRounds'>) => (r.round ? `Round ${r.round} of ${r.maxRounds}` : 'Starting'),
  next: 'Once the fix is approved, Check for updates brings it into this file. Then check fidelity again.',
} as const;

/** Only what a designer may read: never `developer` or `reason`'s twin, whatever the server adds later. */
function view(x: unknown): RunView | undefined {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o.id !== 'string' || typeof o.component !== 'string' || typeof o.status !== 'string') return undefined;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const pr = o.pr as RunView['pr'];
  return {
    id: o.id,
    component: o.component,
    status: o.status as RunView['status'],
    label: str(o.label),
    sentence: str(o.sentence),
    ...(typeof o.round === 'number' ? { round: o.round } : {}),
    maxRounds: typeof o.maxRounds === 'number' ? o.maxRounds : 3,
    startedBy: str(o.startedBy),
    createdAt: str(o.createdAt),
    updatedAt: str(o.updatedAt),
    ...(typeof o.retryAfter === 'number' ? { retryAfter: o.retryAfter } : {}),
    ...(pr && typeof pr.url === 'string' ? { pr: { number: Number(pr.number), url: pr.url, draft: !!pr.draft } } : {}),
    ...(typeof o.reviewUrl === 'string' ? { reviewUrl: o.reviewUrl } : {}),
    ...(Array.isArray(o.applied) ? { applied: o.applied.filter((s): s is string => typeof s === 'string') } : {}),
  };
}

const api = (origin: string) => `${origin}/api/claude`;
const headers = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

async function call(f: Fetch, url: string, init: Parameters<Fetch>[1]): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await f(url, init);
  } catch {
    throw new Error(CLAUDE_RUN_WORDS.unreachable);
  }
  return { status: res.status, ok: res.ok, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

/** Starts a run for one component (or answers the one in progress). A refusal carries the server's sentence. */
export async function startClaudeFix(f: Fetch, origin: string, token: string, repo: string, component: string): Promise<{ run: RunView; existing: boolean }> {
  const r = await call(f, api(origin), { method: 'POST', headers: headers(token), body: JSON.stringify({ action: 'fix', repo, component }) });
  const run = r.ok ? view(r.data.run) : undefined;
  if (run) return { run, existing: r.data.existing === true };
  throw new RunRefused(typeof r.data.error === 'string' ? r.data.error : 'failed', typeof r.data.message === 'string' ? r.data.message : CLAUDE_RUN_WORDS.unreachable);
}

/** Where a run stands, after moving it one step (`peek`: as it stands). Undefined when it is gone (404). */
export async function readClaudeRun(f: Fetch, origin: string, token: string, repo: string, id: string, peek = false): Promise<RunView | undefined> {
  const r = await call(f, `${api(origin)}?repo=${encodeURIComponent(repo)}&run=${encodeURIComponent(id)}${peek ? '&peek=1' : ''}`, { method: 'GET', headers: headers(token) });
  if (r.status === 404) return undefined;
  const run = r.ok ? view(r.data.run) : undefined;
  if (!run) throw new Error(typeof r.data.message === 'string' ? r.data.message : CLAUDE_RUN_WORDS.unreachable);
  return run;
}

/** The team's runs of the last 7 days, newest first: reopening the plugin picks up the ones still moving. */
export async function listClaudeRuns(f: Fetch, origin: string, token: string, repo: string): Promise<RunView[]> {
  const r = await call(f, `${api(origin)}?repo=${encodeURIComponent(repo)}&runs=1`, { method: 'GET', headers: headers(token) });
  if (!r.ok || !Array.isArray(r.data.runs)) return [];
  return r.data.runs.map(view).filter((x): x is RunView => !!x);
}

/**
 * Keeps one run moving: asks, waits `retryAfter` (5 s when the server does not say), asks again, one request at a
 * time, until the run is final or the poller stops. A failed request (offline a moment) waits and tries again.
 */
export class ClaudeRunPoller {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly read: () => Promise<RunView | undefined>,
    private readonly on: (run: RunView | undefined) => void,
    private readonly wait: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
  ) {}

  start(first: RunView): this {
    this.next(first.retryAfter);
    return this;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private next(seconds?: number): void {
    if (this.stopped) return;
    this.timer = this.wait(() => void this.tick(), Math.max(1, seconds ?? 5) * 1000);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    let run: RunView | undefined;
    try {
      run = await this.read();
    } catch {
      return this.next(10);
    }
    if (this.stopped) return;
    this.on(run);
    if (run && !isFinal(run)) this.next(run.retryAfter);
  }
}
